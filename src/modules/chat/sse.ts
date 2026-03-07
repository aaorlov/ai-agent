/**
 * SSE chat: stream agent runs via graph.stream(), handle approve/reject/skip via body.messages.
 * Emits: session, status (planning/thinking/executing), text-delta, text-end, tool-call, approval-requested, tool-result, finish, error.
 */

import type { ChatRequest } from "./schemas.js";
import {
  createInterruptibleGraph,
  Command,
  MemorySaver,
  type AgentState,
} from "@/modules/agent";
import { HumanMessage } from "@langchain/core/messages";
import {
  SSEEventType,
  StatusCode,
  FinishReason,
  StreamTriggerType,
} from "@/common/enums/sse.js";
import { MessagePartType, MessageRole } from "@/common/enums";
import { ToolActionResult } from "@/modules/agent";
import type { SSEEvent } from "./events.js";
import { sseEventToMessage } from "./utils.js";
import type { SSEStreamingApi } from "hono/streaming";
import { AgentStatusPhase } from "@/modules/agent";

export type { SSEEvent } from "./events.js";

const DEFAULT_APPROVE_TOOL_NAME = "approval";

export function newThreadId(): string {
  return crypto.randomUUID();
}

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

export interface IApproveTrigger {
  type: StreamTriggerType.Approve;
  toolCallId: string;
  payload?: { approved?: boolean; [k: string]: unknown };
}

export interface IRejectTrigger {
  type: StreamTriggerType.Reject;
  toolCallId: string;
  payload?: { approved?: boolean; [k: string]: unknown };
}

export interface ISkipTrigger {
  type: StreamTriggerType.Skip;
  toolCallId: string;
}

export interface ISystemTrigger {
  type: StreamTriggerType.System;
  context: Record<string, unknown> | undefined;
}

export type StreamTrigger =
  | IMessageTrigger
  | IToolTrigger
  | IApproveTrigger
  | IRejectTrigger
  | ISkipTrigger
  | ISystemTrigger;

const checkpointer = new MemorySaver();
const graph = createInterruptibleGraph(checkpointer);

function lastMessageText(state: AgentState): string {
  const last = state.messages?.[state.messages.length - 1];
  return last && "content" in last && typeof last.content === "string"
    ? last.content
    : "";
}

function statusPhaseToStatusCode(
  phase: string | undefined
): StatusCode | undefined {
  if (phase === AgentStatusPhase.Planning) return StatusCode.Planning;
  if (phase === AgentStatusPhase.Thinking) return StatusCode.Thinking;
  if (phase === AgentStatusPhase.Executing) return StatusCode.Executing;
  return undefined;
}

export async function* streamChatEvents(
  body: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<SSEEvent> {
  const trigger = resolveChatTrigger(body);
  const config = {
    configurable: { thread_id: body.threadId ?? newThreadId() },
    signal,
  };
  const threadId = body.threadId ?? newThreadId();

  try {
    // Approve / Reject / Skip: resume the interrupted graph
    if (
      trigger.type === StreamTriggerType.Approve ||
      trigger.type === StreamTriggerType.Reject ||
      trigger.type === StreamTriggerType.Skip
    ) {
      const resumeValue =
        trigger.type === StreamTriggerType.Approve
          ? { approved: true, ...trigger.payload }
          : trigger.type === StreamTriggerType.Skip
            ? { approved: false, skipped: true }
            : { approved: false };
      const stream = graph.stream(new Command({ resume: resumeValue }), config);
      let lastSent = "";
      let lastState: AgentState | null = null;
      const toolCallId =
        trigger.type === StreamTriggerType.Approve ||
        trigger.type === StreamTriggerType.Reject
          ? trigger.toolCallId
          : (trigger as ISkipTrigger).toolCallId;
      const approved = trigger.type === StreamTriggerType.Approve;

      yield {
        type: SSEEventType.Status,
        message: approved ? "Applying" : "Skipping / Cancelling",
        code: StatusCode.Executing,
      };

      for await (const chunk of stream) {
        const state = chunk as AgentState;
        lastState = state;
        if (state.context?.status) {
          const code = statusPhaseToStatusCode(state.context.status.phase);
          yield {
            type: SSEEventType.Status,
            message: state.context.status.message ?? state.context.status.phase,
            code,
          };
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
      return;
    }

    // New message or system/tool trigger: run graph from input
    const input: AgentState = {
      messages: [
        new HumanMessage(
          trigger.type === StreamTriggerType.Message ? trigger.text : ""
        ),
      ],
      sessionId: threadId,
      context:
        trigger.type === StreamTriggerType.System ? trigger.context ?? {} : {},
    };

    const stream = graph.stream(input, config);
    let lastSent = "";
    let lastState: AgentState | null = null;

    for await (const chunk of stream) {
      if (signal.aborted) break;
      const state = chunk as AgentState;
      lastState = state;

      if (state.context?.status) {
        const code = statusPhaseToStatusCode(state.context.status.phase);
        yield {
          type: SSEEventType.Status,
          message: state.context.status.message ?? state.context.status.phase,
          code,
        };
      }

      const text = lastMessageText(state);
      if (text && text !== lastSent) {
        const content = lastSent ? text.slice(lastSent.length) : text;
        lastSent = text;
        if (content) yield { type: SSEEventType.TextDelta, content };
      }
    }

    // Stream ended: if we have approvalRequest, graph paused for human-in-the-loop
    const approvalRequest = lastState?.context?.approvalRequest;
    if (approvalRequest) {
      yield {
        type: SSEEventType.ToolCall,
        toolCallId: approvalRequest.toolCallId,
        toolName: approvalRequest.toolName,
        args: approvalRequest.args,
      };
      yield {
        type: SSEEventType.ApprovalRequested,
        toolCallId: approvalRequest.toolCallId,
        toolName: approvalRequest.toolName,
        args: approvalRequest.args,
      };
      return;
    }

    yield { type: SSEEventType.TextEnd };
    yield { type: SSEEventType.Finish, finishReason: FinishReason.Stop };
  } catch (err) {
    yield {
      type: SSEEventType.Error,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Resolve trigger from validated chat request: message, approve, reject, skip, system, or tool result. */
export function resolveChatTrigger(body: ChatRequest): StreamTrigger {
  if (body.messages.length === 0 && body.context) {
    return { type: StreamTriggerType.System, context: body.context };
  }

  const lastUserMessage = body.messages
    .filter((m) => m.role === MessageRole.User)
    .pop();
  const actionPart = lastUserMessage?.parts?.find(
    (p) => p.type === MessagePartType.ToolResult
  );

  if (actionPart && "action" in actionPart) {
    const action = actionPart.action as ToolActionResult;
    if (action === ToolActionResult.Approved) {
      return {
        type: StreamTriggerType.Approve,
        toolCallId: actionPart.toolCallId,
        payload: actionPart.result as Record<string, unknown> | undefined,
      };
    }
    if (action === ToolActionResult.Rejected) {
      return {
        type: StreamTriggerType.Reject,
        toolCallId: actionPart.toolCallId,
        payload: actionPart.result as Record<string, unknown> | undefined,
      };
    }
    if (action === ToolActionResult.Skipped) {
      return {
        type: StreamTriggerType.Skip,
        toolCallId: actionPart.toolCallId,
      };
    }
    return {
      type: StreamTriggerType.Tool,
      action,
      toolCallId: actionPart.toolCallId,
      result: actionPart.result,
    };
  }

  return {
    type: StreamTriggerType.Message,
    text: lastUserMessage?.content ?? "",
  };
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

  const enrichedBody = { ...body, threadId };

  for await (const ev of streamChatEvents(enrichedBody, signal)) {
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
