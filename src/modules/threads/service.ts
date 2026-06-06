import type { MessagesEventData, UpdatesEventData } from "@langchain/langgraph";

import { HttpStatus } from "@/common/enums";
import { AppError, HttpError, toErrorMessage } from "@/common/errors";
import {
	type AgentRunInput,
	type AgentState,
	buildExpiredToolMessages,
	deleteCheckpoint,
	findLatestPlan,
	findOrphanToolCalls,
	getCheckpointState,
	hasCheckpoint,
	isCheckpointHealthy,
	MAX_HISTORY_MESSAGES,
	MessageRole,
	newHumanMessage,
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
 * prepares input (restoring working memory from the persisted history when
 * the checkpoint is missing or unsafe to resume), invokes the graph,
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

/**
 * Builds `AgentRunInput` for a new user message. Two paths:
 *
 *  1. Healthy checkpoint present → append only the new human message; the
 *     graph reducer concatenates it onto the live state.
 *  2. No checkpoint, or one that's unsafe to resume (pending interrupt or an
 *     assistant tool call missing its `tool_result`) → drop the checkpoint,
 *     restore working memory from the persisted history, close out any
 *     orphan tool calls with synthetic `Expired` results, and seed the graph
 *     with `[...history, ...expired, newHuman]` in one shot.
 *
 * The persisted message log is the canonical history. The checkpoint is a
 * pure performance optimization — when missing (new thread / TTL expired)
 * we transparently rebuild it from history on the next turn.
 */
const prepareMessageInput = async (
	userId: string,
	threadId: string,
	body: SendMessageRequest,
): Promise<AgentRunInput> => {
	const humanMessage = newHumanMessage(body.content);
	const checkpointState = await getCheckpointState(threadId);

	if (isCheckpointHealthy(checkpointState)) {
		await appendMessage(userId, threadId, humanMessage);
		return { userId, threadId, messages: [humanMessage] };
	}

	if (checkpointState !== null) {
		await deleteCheckpoint(threadId);
	}

	const history = await getRecentMessages(userId, threadId, MAX_HISTORY_MESSAGES);
	const expired = buildExpiredToolMessages(findOrphanToolCalls(history));

	if (expired.length > 0) {
		await appendMessages(userId, threadId, expired);
	}
	await appendMessage(userId, threadId, humanMessage);

	// The plan channel defaults to `null` on a fresh state; without seeding
	// it from history the agent would forget any plan it had set before the
	// checkpoint was lost. Pass `null` (not `undefined`) when no plan is
	// found, so the channel reducer explicitly resets it.
	const plan = findLatestPlan(history) ?? null;

	return {
		userId,
		threadId,
		messages: [...history, ...expired, humanMessage],
		plan,
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
