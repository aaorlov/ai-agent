import type { SSEStreamingApi } from "hono/streaming";
import { streamAgent, MessageRole, type AgentState } from "@/modules/agent";
import { CustomEventType, StreamMode } from "@/modules/agent/enums";
import type {
  AgentRunInput,
  CustomEventData,
  ToolCall
} from "@/modules/agent/types";

import type { ChatRequest } from "./dto/request.dto";
import { ChatRequestType, SSEEventType, FinishReason } from "./enums";
import type { SSEEvent } from "./events";
import { sseEventToMessage } from "./utils";

// ---------------------------------------------------------------------------
// Request → AgentRunInput
// ---------------------------------------------------------------------------

const toAgentInput = (
  threadId: string,
  body: ChatRequest
): AgentRunInput => {
  const agentInput: AgentRunInput = {
    threadId,
    messages: [],
  };
  switch(body.type) {
    case ChatRequestType.ToolAction:
      agentInput.resume = {
        toolCallId: body.toolCallId,
        action: body.action,
        modifiedArgs: body.modifiedArgs,
      };
      break;
    case ChatRequestType.Message:
      agentInput.messages.push({
        id: crypto.randomUUID(),
        role: MessageRole.Human,
        content: body.content,
        createdAt: new Date().toISOString(),
      });
      break;
    default:
      throw new Error(`Invalid chat request type: ${body}`);
  }

  return agentInput;
}

function* updateAgentStateToSSEEvents(
  chunk: Record<string, Partial<AgentState>>
): Generator<SSEEvent> {
  for (const [nodeName, u] of Object.entries(chunk)) {
    if (!u || typeof u !== "object") continue;

    if (Array.isArray(u.retrievedContext) && u.retrievedContext.length) {
      yield {
        type: SSEEventType.ContextRetrieved,
        documents: u.retrievedContext.map((doc) => ({
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
          score: doc.score,
        })),
      };
    }

    if (Array.isArray(u.messages)) {
      for (const msg of u.messages) {
        yield {
          type: SSEEventType.Message,
          message: msg,
        };
      }
    }
  }
}
// ---------------------------------------------------------------------------
// Custom events → SSE events
// ---------------------------------------------------------------------------
const customEventToSSEEvent = (
  event: CustomEventData
): SSEEvent | null => {
  switch(event.type) {
    case CustomEventType.TextDelta:
      return { type: SSEEventType.TextDelta, content: event.content, id: event.id };
    default:
      return null;
  }
}
// ---------------------------------------------------------------------------
// Public streaming generators
// ---------------------------------------------------------------------------

export async function* streamChatEvents(
  body: ChatRequest,
  threadId: string,
  signal: AbortSignal
): AsyncGenerator<SSEEvent> {
  const input = toAgentInput(threadId, body);

  try {
    let approvalRequested = false;

    for await (const event of streamAgent(input, { signal })) {
      // Stream custom / intermediate events, not a part of chat history
      if (event.mode === StreamMode.Custom) {
        const sseEvent = customEventToSSEEvent(event.data);
        if(sseEvent) yield sseEvent;
      }

      if(event.mode === StreamMode.Updates) {
        for (const ev of updateAgentStateToSSEEvents(event.data)) {
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
      finishReason: approvalRequested
        ? FinishReason.Approval
        : FinishReason.Stop,
    };
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
    yield { type: SSEEventType.Finish, finishReason: FinishReason.Error };
  }
}

export const handleChatStream = async (
  body: ChatRequest,
  stream: SSEStreamingApi,
  signal: AbortSignal
): Promise<void> => {
  const threadId = body.threadId || crypto.randomUUID();

  if (!body.threadId) {
    await stream.writeSSE(
      sseEventToMessage({ type: SSEEventType.Session, threadId })
    );
  }

  for await (const ev of streamChatEvents(body, threadId, signal)) {
    if (signal.aborted) {
      await stream.writeSSE(
        sseEventToMessage({
          type: SSEEventType.Finish,
          finishReason: FinishReason.Abort,
        })
      );
      break;
    }
    await stream.writeSSE(sseEventToMessage(ev));
  }
};
