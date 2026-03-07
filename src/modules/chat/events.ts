/**
 * SSE event types used by the chat module to notify the UI during the agent flow.
 */

import { ToolActionResult } from "../agent";

export enum SSEEventType {
  Session = "session",
  Status = "status",
  TextDelta = "text-delta",
  TextEnd = "text-end",
  ToolCall = "tool-call",
  ToolResult = "tool-result",
  ApprovalRequested = "approval-requested",
  Error = "error",
  Finish = "finish",
}

/** Status code for "status" events: planning | thinking | executing | tool_result. */
export enum StatusCode {
  Planning = "planning",
  Thinking = "thinking",
  Executing = "executing",
  ToolResult = "tool_result",
}

/** Finish reason for "finish" events. */
export enum FinishReason {
  Stop = "stop",
  Length = "length",
  ToolCall = "tool-call",
  ContentFilter = "content-filter",
  Error = "error",
  Abort = "abort",
}

/**
 * UI message part type (tool result).
 */
export enum MessagePartType {
  ToolResult = "tool-result",
}


export type SSEEvent =
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.Status; message: string; code?: StatusCode }
  | { type: SSEEventType.TextDelta; content: string; messageId?: string }
  | { type: SSEEventType.TextEnd; messageId?: string; metadata?: Record<string, unknown> }
  | {
      type: SSEEventType.ToolCall;
      toolCallId: string;
      toolName: string;
      args: unknown;
      messageId?: string;
    }
  | {
      type: SSEEventType.ToolResult;
      toolCallId: string;
      action: ToolActionResult;
      result?: unknown;
      messageId?: string;
    }
  | {
      type: SSEEventType.ApprovalRequested;
      toolCallId: string;
      toolName: string;
      args: unknown;
      messageId?: string;
    }
  | { type: SSEEventType.Error; messageId?: string; message: string; code?: string }
  | {
      type: SSEEventType.Finish;
      finishReason: FinishReason;
      usage?: { promptTokens: number; completionTokens: number };
    };
