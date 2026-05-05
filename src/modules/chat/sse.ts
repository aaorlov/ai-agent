import type { SSEStreamingApi } from "hono/streaming";

import { toErrorMessage } from "@/common/errors";
import {
	type AgentMessage,
	type AgentRunInput,
	type AgentState,
	type CustomEventData,
	CustomEventType,
	MessageRole,
	StreamMode,
	streamAgent,
	type ToolCall,
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

const toAgentRunInput = (threadId: string, body: ChatRequest): AgentRunInput => {
	switch (body.type) {
		case ChatRequestType.ToolAction:
			return {
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
				threadId,
				messages: [newHumanMessage(body.content)],
			};
	}
};

function* stateUpdateToSseEvents(chunk: Record<string, Partial<AgentState>>): Generator<SSEEvent> {
	for (const update of Object.values(chunk)) {
		if (!update || typeof update !== "object") continue;

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
}

const customEventToSseEvent = (event: CustomEventData): SSEEvent | undefined => {
	switch (event.type) {
		case CustomEventType.TextDelta:
			return { type: SSEEventType.TextDelta, content: event.content, id: event.id };
	}
};

export async function* streamChatEvents(
	body: ChatRequest,
	threadId: string,
	signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
	const input = toAgentRunInput(threadId, body);
	let approvalRequested = false;

  try {
    for await (const event of streamAgent(input, { signal })) {
      // Stream custom / intermediate events, not a part of chat history
      if (event.mode === StreamMode.Custom) {
        const sseEvent = customEventToSseEvent(event.data);
        if(sseEvent) yield sseEvent;
      }

      if(event.mode === StreamMode.Updates) {
        for (const ev of stateUpdateToSseEvents(event.data)) {
          if (
            ev.type === SSEEventType.Message
            && ev.message.role === MessageRole.Assistant 
            && ev.message?.toolCalls?.some((toolCall: ToolCall) => toolCall.requiresApproval)
          ) approvalRequested = true;
          yield ev;
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
	body: ChatRequest,
	stream: SSEStreamingApi,
	signal: AbortSignal,
): Promise<void> => {
	const threadId = body.threadId ?? crypto.randomUUID();

	if (!body.threadId) {
		await stream.writeSSE(sseEventToMessage({ type: SSEEventType.Session, threadId }));
	}

	for await (const event of streamChatEvents(body, threadId, signal)) {
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
