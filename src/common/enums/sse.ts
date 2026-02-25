/**
 * SSE event type discriminator (Vercel AI SDK–aligned, Cursor-style).
 */
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

/**
 * Status code for "status" events (thinking | executing | timeout).
 */
export enum StatusCode {
  Thinking = "thinking",
  Executing = "executing",
  Timeout = "timeout",
}

/**
 * Finish reason for "finish" events.
 */
export enum FinishReason {
  Stop = "stop",
  Length = "length",
  ToolCall = "tool-call",
  ContentFilter = "content-filter",
  Error = "error",
  Abort = "abort",
}
