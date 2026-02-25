/**
 * SSE chat: stream agent runs and handle approve/reject via separate endpoints.
 * Emits Cursor-style events (Vercel AI SDK–aligned): session, status, text-delta, text-end, tool-call, approval-requested, tool-result, finish, error.
 */

import type { ChatRequest } from "./schemas";
import { createInterruptibleGraph, Command, MemorySaver, type AgentState } from "../../agent.js";
import { HumanMessage } from "@langchain/core/messages";
import { SSEEventType, StatusCode, FinishReason, StatusMessage } from "../../common/enums/sse.js";
import { MessagePartType, MessageRole, DEFAULT_APPROVE_TOOL_NAME } from "@/common/enums";
import type { SSEEvent } from "./events.js";
import { normalizeInterruptToToolCall } from "./events.js";
import { sseEventToMessage } from "./utils.js";
import type { SSEStreamingApi } from "hono/streaming";

export type { SSEEvent } from "./events.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum StreamTriggerType {
  Message = "message",
  Approve = "approve",
  Reject = "reject",
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ISSEData {
  event: string;
  data: string;
}

export interface ITextPart {
  type: MessagePartType.Text;
  text?: string;
}

export interface IToolResultPart {
  type: MessagePartType.ToolResult;
  toolCallId: string;
  result?: unknown;
  isApproval?: boolean;
}

export interface IMessagePart {
  type: string;
  text?: string;
  toolCallId?: string;
  result?: unknown;
  isApproval?: boolean;
}

export interface IChatRequestMessage {
  role: string;
  content?: string;
  parts?: IMessagePart[];
}

export interface IChatRequestBody {
  threadId?: string;
  messages: IChatRequestMessage[];
}

export interface IMessageTrigger {
  type: StreamTriggerType.Message;
  text: string;
  threadId: string;
}

export interface IApproveTrigger {
  type: StreamTriggerType.Approve;
  threadId: string;
  payload?: unknown;
  toolCallId?: string;
}

export interface IRejectTrigger {
  type: StreamTriggerType.Reject;
  threadId: string;
  toolCallId?: string;
}

export type StreamTrigger = IMessageTrigger | IApproveTrigger | IRejectTrigger;

export interface IResolveChatTriggerResult {
  trigger: StreamTrigger;
  threadId: string;
  isNewThread: boolean;
}

export interface IHandleChatStreamParams {
  trigger: StreamTrigger;
  threadId: string;
  isNewThread: boolean;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

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
  

  try {
    if (trigger.type === StreamTriggerType.Message) {
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

      let lastSent = "";
      let lastState: AgentState | null = null;

      yield { type: SSEEventType.Status, message: StatusMessage.Planning, code: StatusCode.Thinking };

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
        message: approved ? StatusMessage.Applying : StatusMessage.Cancelling,
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
    const stream = await graph.streamEvents(input, {
      version: "v2", // Always use v2 for the latest schema
      configurable: { thread_id: body.threadId },
      signal, // Connects to the UI's stop button
    });
    
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Detect approval/rejection from last user message parts (Vercel AI SDK tool-result with isApproval). */
function getApprovalTrigger(body: IChatRequestBody): IApproveTrigger | IRejectTrigger | null {
  const threadId = body.threadId ?? crypto.randomUUID();
  const lastUser = body.messages?.filter((m) => m.role === MessageRole.User).pop();
  const approvalPart = lastUser?.parts?.find(
    (p) => p.type === MessagePartType.ToolResult && p.isApproval === true
  ) as IToolResultPart | undefined;
  if (!approvalPart) return null;
  const result = approvalPart.result;
  const rejected =
    result !== null &&
    typeof result === "object" &&
    "approved" in result &&
    (result as { approved: unknown }).approved === false;
  return rejected
    ? { type: StreamTriggerType.Reject, threadId, toolCallId: approvalPart.toolCallId }
    : { type: StreamTriggerType.Approve, threadId, toolCallId: approvalPart.toolCallId, payload: result };
}

/** Resolve trigger, threadId, and isNewThread from validated chat request body. */
export const resolveChatTrigger = (body: ChatRequest): IResolveChatTriggerResult => {
  const threadId = body.threadId ?? crypto.randomUUID();
  const isNewThread = !body.threadId;
  const approvalTrigger = getApprovalTrigger(body);
  const trigger: StreamTrigger =
    approvalTrigger ??
    (() => {
      const lastUser = body.messages?.filter((m) => m.role === MessageRole.User).pop();
      const textPart = lastUser?.parts?.find((p) => p.type === MessagePartType.Text) as ITextPart | undefined;
      const text = (textPart?.text ?? (lastUser?.content ? String(lastUser.content) : "")) || "";
      return { type: StreamTriggerType.Message, text, threadId };
    })();
  return { trigger, threadId, isNewThread };
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
