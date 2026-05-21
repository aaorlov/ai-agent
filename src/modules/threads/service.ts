import type { MessagesEventData, UpdatesEventData } from "@langchain/langgraph";

import { HttpStatus } from "@/common/enums";
import { AppError, HttpError, toErrorMessage } from "@/common/errors";
import {
	type AgentMessage,
	type AgentRunInput,
	type AgentState,
	buildExpiredToolMessages,
	deleteCheckpoint,
	findOrphanToolCalls,
	getCheckpointState,
	hasCheckpoint,
	MAX_HISTORY_MESSAGES,
	MessageRole,
	streamAgent,
} from "@/modules/agent";

import type { SendMessageRequest, ThreadRequest } from "./dto/request.dto";
import { FinishReason, SSEEventType, ThreadRequestType } from "./enums";
import type { SSEEvent } from "./events";
import {
	appendMessage,
	appendMessages,
	deleteThread as deleteThreadDoc,
	deleteThreadMessages,
	getMessagesPage,
	getRecentMessages,
	getThreads,
} from "./repository";
import type { MessagesPage, ThreadsPage } from "./types";

export const listThreads = (
	userId: string,
	limit: number,
	before?: string,
): Promise<ThreadsPage> => getThreads(userId, limit, before);

export const listThreadMessages = (
	userId: string,
	threadId: string,
	limit: number,
	before?: string,
): Promise<MessagesPage> => getMessagesPage(userId, threadId, limit, before);

export const deleteThread = async (userId: string, threadId: string): Promise<void> => {
	const deleted = await deleteThreadDoc(userId, threadId);

	if (deleted === 0) {
		throw new HttpError(HttpStatus.NotFound, "Thread not found");
	}

	await Promise.all([deleteThreadMessages(userId, threadId), deleteCheckpoint(threadId)]);
};

/**
 * Streams a thread turn as SSE-shaped events. Owns the full agent run:
 * prepares input (with hydration / interrupt recovery), invokes the graph,
 * persists every produced message, and yields events for the protocol layer
 * to serialize. Errors are translated into terminal `Error` + `Finish`
 * events so the consumer always sees a clean termination.
 */
export async function* streamThreadEvents(
	userId: string,
	body: ThreadRequest,
	threadId: string,
	signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
	let input: AgentRunInput;
	try {
		input = await prepareInput(userId, threadId, body);
	} catch (error) {
		yield { type: SSEEventType.Error, message: toErrorMessage(error) };
		yield { type: SSEEventType.Finish, finishReason: FinishReason.Error };
		return;
	}

	let approvalRequested = false;
	let messageId: string | undefined;

	try {
		const run = await streamAgent(input, { signal });
		for await (const event of run) {
			if (event.method === "updates") {
				for (const sseEvent of updateToSseEvents(event.params.data as UpdatesEventData)) {
					if (sseEvent.type === SSEEventType.Message) {
						await appendMessage(userId, threadId, sseEvent.message);
					}
					if (isApprovalRequest(sseEvent)) approvalRequested = true;
					yield sseEvent;
				}
				continue;
			}

			if (event.method === "messages") {
				const data = event.params.data as MessagesEventData;
				if (data.event === "message-start") {
					messageId = data.id;
					continue;
				}
				if (
					data.event === "content-block-delta"
					&& data.delta.type === "text-delta"
					&& messageId
				) {
					yield { type: SSEEventType.TextDelta, content: data.delta.text, id: messageId };
				}
			}
		}

		yield {
			type: SSEEventType.Finish,
			finishReason: approvalRequested ? FinishReason.Approval : FinishReason.Stop,
		};
	} catch (error) {
		yield { type: SSEEventType.Error, message: toErrorMessage(error) };
		yield { type: SSEEventType.Finish, finishReason: FinishReason.Error };
	}
}

// -----------------------------------------------------------------------------
// Private helpers
// -----------------------------------------------------------------------------

const newHumanMessage = (content: string): AgentMessage => ({
	id: crypto.randomUUID(),
	role: MessageRole.Human,
	content,
	createdAt: new Date().toISOString(),
});

/**
 * Builds `AgentRunInput` for a new user message. Side-effects:
 *  - resets the LangGraph checkpoint if it carries an unresolved interrupt
 *    or orphaned assistant tool calls (the only reliable way to drop
 *    `interrupt()` state — `updateState` doesn't always cancel it);
 *  - persists synthetic `Expired` tool messages for any orphaned calls so
 *    the next LLM call sees valid `tool_use`/`tool_result` pairing;
 *  - persists the incoming human message to the thread log.
 *
 * Returns hydration messages so `toGraphInput` rebuilds working memory
 * for fresh / reset threads.
 */
const prepareMessageInput = async (
	userId: string,
	threadId: string,
	body: SendMessageRequest,
): Promise<AgentRunInput> => {
	const checkpointState = await getCheckpointState(threadId);
	const checkpointPresent = checkpointState !== null;

	const hasPendingInterrupt = (checkpointState?.pendingTools.length ?? 0) > 0;
	const checkpointHasOrphans = findOrphanToolCalls(checkpointState?.messages ?? []).length > 0;
	const mustResetCheckpoint = hasPendingInterrupt || checkpointHasOrphans;

	if (mustResetCheckpoint) {
		await deleteCheckpoint(threadId);
	}

	const useExistingCheckpoint = checkpointPresent && !mustResetCheckpoint;
	const baseline =
		useExistingCheckpoint && checkpointState
			? checkpointState.messages
			: await getRecentMessages(userId, threadId, MAX_HISTORY_MESSAGES);

	const expired = buildExpiredToolMessages(findOrphanToolCalls(baseline));
	if (expired.length > 0) {
		await appendMessages(userId, threadId, expired);
	}

	const humanMessage = newHumanMessage(body.content);
	await appendMessage(userId, threadId, humanMessage);

	const hydrationMessages: AgentMessage[] = useExistingCheckpoint
		? expired
		: [...baseline, ...expired];

	return {
		userId,
		threadId,
		messages: [humanMessage],
		hydrationMessages,
	};
};

const prepareInput = async (
	userId: string,
	threadId: string,
	body: ThreadRequest,
): Promise<AgentRunInput> => {
	switch (body.type) {
		case ThreadRequestType.ToolAction: {
			if (!(await hasCheckpoint(threadId))) {
				throw new AppError(
					"Cannot resolve tool action: no active checkpoint for this thread.",
				);
			}
			return {
				userId,
				threadId,
				messages: [],
				resume: {
					toolCallId: body.toolCallId,
					action: body.action,
					modifiedArgs: body.modifiedArgs,
				},
			};
		}
		case ThreadRequestType.Retry: {
			if (!(await hasCheckpoint(threadId))) {
				throw new AppError("Cannot retry: no active checkpoint for this thread.");
			}
			return { userId, threadId, messages: [], retry: true };
		}
		case ThreadRequestType.Message:
			return prepareMessageInput(userId, threadId, body);
	}
};

function* updateToSseEvents(data: UpdatesEventData): Generator<SSEEvent> {
	// Graph nodes return Partial<AgentState>; the protocol erases that to
	// Record<string, any>, so re-narrow at this boundary.
	const update = data.values as Partial<AgentState>;

	if (Array.isArray(update.retrievedContext) && update.retrievedContext.length > 0) {
		yield {
			type: SSEEventType.ContextRetrieved,
			documents: update.retrievedContext.map((doc) => ({
				id: doc.id,
				content: doc.content,
				metadata: doc.metadata,
				score: doc.score,
			})),
		};
	}

	if (Array.isArray(update.messages)) {
		for (const message of update.messages) {
			yield { type: SSEEventType.Message, message };
		}
	}
}

const isApprovalRequest = (event: SSEEvent): boolean =>
	event.type === SSEEventType.Message
	&& event.message.role === MessageRole.Assistant
	&& (event.message.toolCalls?.some((toolCall) => toolCall.requiresApproval) ?? false);
