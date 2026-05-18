import type { MessagesEventData, UpdatesEventData } from "@langchain/langgraph";
import type { SSEStreamingApi } from "hono/streaming";

import { toErrorMessage } from "@/common/errors";
import {
	type AgentMessage,
	type AgentRunInput,
	type AgentState,
	MessageRole,
	streamAgent,
} from "@/modules/agent";

import type { ChatRequest } from "./dto/request.dto";
import { ChatRequestType, FinishReason, SSEEventType } from "./enums";
import type { SSEEvent } from "./events";
import { sseEventToMessage } from "./utils";

const newHumanMessage = (content: string): AgentMessage => ({
	id: crypto.randomUUID(),
	role: MessageRole.Human,
	content,
	createdAt: new Date().toISOString(),
});

const toAgentRunInput = (userId: string, threadId: string, body: ChatRequest): AgentRunInput => {
	switch (body.type) {
		case ChatRequestType.ToolAction:
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
		case ChatRequestType.Message:
			return {
				userId,
				threadId,
				messages: [newHumanMessage(body.content)],
			};
		case ChatRequestType.Retry:
			return {
				userId,
				threadId,
				messages: [],
				retry: true,
			};
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

export async function* streamChatEvents(
	userId: string,
	body: ChatRequest,
	threadId: string,
	signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
	const input = toAgentRunInput(userId, threadId, body);
	let approvalRequested = false;
	let messageId: string | undefined;

	try {
		const run = await streamAgent(input, { signal });
		for await (const event of run) {
			if (event.method === "updates") {
				for (const sseEvent of updateToSseEvents(event.params.data as UpdatesEventData)) {
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

export const handleChatStream = async (
	userId: string,
	body: ChatRequest,
	stream: SSEStreamingApi,
	signal: AbortSignal,
): Promise<void> => {
	const threadId = body.threadId ?? crypto.randomUUID();

	if (!body.threadId) {
		await stream.writeSSE(sseEventToMessage({ type: SSEEventType.Session, threadId }));
	}

	for await (const event of streamChatEvents(userId, body, threadId, signal)) {
		if (signal.aborted) {
			await stream.writeSSE(
				sseEventToMessage({
					type: SSEEventType.Finish,
					finishReason: FinishReason.Abort,
				}),
			);
			break;
		}
		await stream.writeSSE(sseEventToMessage(event));
	}
};
