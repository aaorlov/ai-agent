/**
 * SSE chat: stream agent runs and handle approve/reject via separate endpoints.
 * Emits Cursor-style events (Vercel AI SDK–aligned): session, status, text-delta, text-end, tool-call, approval-requested, tool-result, finish, error.
 */

import type { ChatRequest } from "./schemas";
import { createInterruptibleGraph, Command, MemorySaver, type AgentState } from "../../agent";
import { HumanMessage } from "@langchain/core/messages";
import { SSEEventType, StatusCode, FinishReason, StreamTriggerType } from "../../common/enums/sse";
import { MessagePartType, MessageRole, ToolActionResult } from "@/common/enums";
import type { SSEEvent } from "./events.js";
import { normalizeInterruptToToolCall } from "./events.js";
import { sseEventToMessage } from "./utils.js";
import type { SSEStreamingApi } from "hono/streaming";

export type { SSEEvent } from "./events.js";

export interface IMessageTrigger {
  type: StreamTriggerType.Message;
  text: string;
}

export interface IToolTrigger {
  type: StreamTriggerType.Tool;
  action: ToolActionResult;
  toolCallId: string;
  result: unknown;
}

export interface ISystemTrigger {
  type: StreamTriggerType.System;
  context: Record<string, unknown> | undefined;
}

export type StreamTrigger = IMessageTrigger | IToolTrigger | ISystemTrigger;


const checkpointer = new MemorySaver();
const graph = createInterruptibleGraph(checkpointer);

function lastMessageText(state: AgentState): string {
  const last = state.messages?.[state.messages.length - 1];
  return last && "content" in last && typeof last.content === "string" ? last.content : "";
}

function hasInterrupt(chunk: unknown): unknown[] | null {
  const interrupt = (chunk as { __interrupt__?: unknown[] }).__interrupt__;
  return interrupt && Array.isArray(interrupt) && interrupt.length > 0 ? interrupt : null;
}

export async function* streamChatEvents(body: ChatRequest, signal: AbortSignal): AsyncGenerator<SSEEvent> {
  const trigger: StreamTrigger = resolveChatTrigger(body);
  const config = { configurable: { thread_id: body.threadId }, signal };

  try {
    const input: AgentState = {
      messages: [new HumanMessage(trigger.text)],
      sessionId: trigger.threadId,
      context: {},
    };

    const stream = await graph.streamEvents(input, {
      version: "v2", // Always use v2 for the latest schema
      configurable: { thread_id: body.threadId },
      signal, // Connects to the UI's stop button
    });


    if (trigger.type === StreamTriggerType.Message) {
      const input: AgentState = {
        messages: [new HumanMessage(trigger.text)],
        sessionId: trigger.threadId,
        context: {},
      };
      const stream = await graph.streamEvents(input, { version: "v2", ...config });

      let lastSent = "";
      let lastState: AgentState | null = null;
      yield { type: SSEEventType.Status, message: "Planning", code: StatusCode.Thinking };

      for await (const chunk of stream) {
        const state = chunk as AgentState;
        lastState = state;
        const interrupt = hasInterrupt(chunk);

        if (interrupt) {
          const value = interrupt[0];
          const tool = normalizeInterruptToToolCall(value);
          yield { type: SSEEventType.ToolCall, toolCallId: tool.toolCallId, toolName: tool.toolName, args: tool.args };
          yield {
            type: SSEEventType.ApprovalRequested,
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            args: tool.args,
          };
          return;
        }

        const text = lastMessageText(state);
        if (text && text !== lastSent) {
          const content = lastSent ? text.slice(lastSent.length) : text;
          lastSent = text;
          if (content) yield { type: SSEEventType.TextDelta, content };
        }
      }

      yield { type: SSEEventType.TextEnd };
      yield { type: SSEEventType.Finish, finishReason: FinishReason.Stop };
      return;
    }

    if (trigger.type === StreamTriggerType.Approve || trigger.type === StreamTriggerType.Reject) {
      const resumeValue =
        trigger.type === StreamTriggerType.Approve ? (trigger.payload ?? { approved: true }) : { approved: false };
      const stream = await graph.stream(new Command({ resume: resumeValue }), config);
      let lastSent = "";
      let lastState: AgentState | null = null;
      const toolCallId = trigger.toolCallId ?? DEFAULT_APPROVE_TOOL_NAME;
      const approved = trigger.type === StreamTriggerType.Approve;

      yield {
        type: SSEEventType.Status,
        message: approved ? "Applying" : "Cancelling",
        code: StatusCode.Executing,
      };

      for await (const chunk of stream) {
        const state = chunk as AgentState;
        lastState = state;
        const interrupt = hasInterrupt(chunk);
        if (interrupt) {
          const value = interrupt[0];
          const tool = normalizeInterruptToToolCall(value);
          yield { type: SSEEventType.ToolCall, toolCallId: tool.toolCallId, toolName: tool.toolName, args: tool.args };
          yield {
            type: SSEEventType.ApprovalRequested,
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            args: tool.args,
          };
          return;
        }

        const text = lastMessageText(state);
        if (text && text !== lastSent) {
          const content = lastSent ? text.slice(lastSent.length) : text;
          lastSent = text;
          if (content) yield { type: SSEEventType.TextDelta, content };
        }
      }

      yield { type: SSEEventType.TextEnd };
      yield {
        type: SSEEventType.ToolResult,
        toolCallId,
        result: lastState?.context ?? (approved ? { applied: true } : { applied: false }),
      };
      yield {
        type: SSEEventType.Finish,
        finishReason: approved ? FinishReason.Stop : FinishReason.Error,
      };
    }
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Resolve trigger, threadId, and isNewThread from validated chat request body. Handles message, approve, and reject. */
export function resolveChatTrigger(body: ChatRequest): StreamTrigger {
  if (body.messages.length === 0 && body.context) {
    return { type: StreamTriggerType.System, context: body.context }
  }

  const lastUserMessage = body.messages.filter((m) => m.role === MessageRole.User).pop();
  const actionPart = lastUserMessage?.parts?.find((p) => p.type === MessagePartType.ToolResult);

  if (actionPart) {
    return {
      type: StreamTriggerType.Tool,
      action: actionPart.action,
      toolCallId: actionPart.toolCallId,
      result: actionPart.result
    }
  }

  return {type: StreamTriggerType.Message, text: lastUserMessage?.content ?? ""}
}

/** Run the SSE chat stream: optional session event, then streamChatEvents written as SSE. */
export const handleChatStream = async (
  body: ChatRequest,
  stream: SSEStreamingApi,
  signal: AbortSignal
): Promise<void> => {
  const threadId = body.threadId ?? crypto.randomUUID();

  if (!body.threadId) {
    await stream.writeSSE(sseEventToMessage({ type: SSEEventType.Session, threadId }));
  }

  const enrichedBody = {
    ...body,
    threadId,
  }

  for await (const ev of streamChatEvents(enrichedBody, signal)) {
    if (signal.aborted) {
      await stream.writeSSE(sseEventToMessage({ 
        type: SSEEventType.Finish, 
        finishReason: FinishReason.Abort
      }));
      break;
    }

    await stream.writeSSE(sseEventToMessage(ev));
  }
}
