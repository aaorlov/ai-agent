/**
 * SSE chat: stream agent via graph.stream(), map agent updates to SSE events.
 * Supports: new thread, continue thread, tool approval (approve/cancel/skip/retry).
 */

import type { SSEStreamingApi } from "hono/streaming";
import { streamAgent, getThreadState, MessagePartType } from "@/modules/agent";
import type { AgentMessage, AgentResume, AgentState, AgentRunInput } from "@/modules/agent";
import { AgentStatusPhase } from "@/modules/agent";

import type { ChatRequest, UIMessage } from "./schemas.js";
import type { SSEEvent } from "./events.js";
import { SSEEventType, StatusCode, FinishReason } from "./events.js";
import { sseEventToMessage } from "./utils.js";

async function toAgentInput(
  threadId: string,
  body: ChatRequest
): Promise<AgentRunInput> {
  const agentInput: AgentRunInput = {
    threadId,
    messages: [],
  }

  const lastToolResult = body.messages.at(-1)?.parts.find((p) => p.type === MessagePartType.ToolResult);
  
  // Agent will use resume command and restore messages from the checkpoint
  if (lastToolResult) {
    agentInput.resume = lastToolResult;
    return agentInput
  }

  const { values } = await getThreadState(threadId);
  const existing: AgentMessage[] = values.messages ?? [];
  agentInput.messages = existing.concat(body.messages.map((m: UIMessage) => ({
    id: m.id,
    role: m.role,
    content: m.content
  })));

  return agentInput;
}

/** Map agent stream chunk (node name -> partial state update) to zero or more SSE events. */
function* chunkToSSEEvents(chunk: Record<string, Partial<AgentState>>): Generator<SSEEvent> {
  for (const u of Object.values(chunk)) {
    if (!u || typeof u !== "object") continue;

    switch (u.status) {
      case AgentStatusPhase.Planning:
        yield { type: SSEEventType.Status, message: "Planning", code: StatusCode.Planning };
        break;
      case AgentStatusPhase.Thinking:
        yield { type: SSEEventType.Status, message: "Thinking", code: StatusCode.Thinking };
        break;
      case AgentStatusPhase.Executing:
        yield { type: SSEEventType.Status, message: "Executing tool", code: StatusCode.Executing };
        break;
      case AgentStatusPhase.ToolResult:
        yield { type: SSEEventType.Status, message: "Tool result", code: StatusCode.ToolResult };
        break;
    }

    if (u.pendingTool) {
      const pending = u.pendingTool;
      yield {
        type: SSEEventType.ApprovalRequested,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        args: pending.args,
      };
    }

    if (Array.isArray(u.messages)) {
      for (const msg of u.messages) {
        if (msg.toolCallId && msg.toolName) {
          if (!msg.action) {
            yield {
              type: SSEEventType.ToolCall,
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              args: msg.args ?? {},
            };
          } else {
            yield {
              type: SSEEventType.ToolResult,
              toolCallId: msg.toolCallId,
              result: msg.result ?? { action: msg.action },
              action: msg.action,
            };
          }
        }
        if (msg.content) {
          yield { type: SSEEventType.TextDelta, content: msg.content };
          yield { type: SSEEventType.TextEnd };
        }
      }
    }

    if (typeof u.textDelta === "string" && u.textDelta) {
      yield { type: SSEEventType.TextDelta, content: u.textDelta };
    }
  }
}

export async function* streamChatEvents(
  body: ChatRequest,
  threadId: string,
  signal: AbortSignal
): AsyncGenerator<SSEEvent> {
  const input = await toAgentInput(threadId, body);

  try {
    let hadApprovalRequest = false;

    for await (const chunk of streamAgent(input, { signal })) {
      for (const ev of chunkToSSEEvents(chunk)) {
        if (ev.type === SSEEventType.ApprovalRequested) hadApprovalRequest = true;
        yield ev;
      }
    }

    yield {
      type: SSEEventType.Finish,
      finishReason: hadApprovalRequest ? FinishReason.ToolCall : FinishReason.Stop,
    };
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
    yield { type: SSEEventType.Finish, finishReason: FinishReason.Error };
  }
}

/** Run the SSE chat stream: optional session event, then streamChatEvents written as SSE. */
export const handleChatStream = async (
  body: ChatRequest,
  stream: SSEStreamingApi,
  signal: AbortSignal
): Promise<void> => {
  const threadId = body.threadId ?? crypto.randomUUID();

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
