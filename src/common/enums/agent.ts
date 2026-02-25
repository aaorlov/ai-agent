/**
 * Chat message role (system, user, assistant, data, tool).
 */
export enum MessageRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
  Data = "data",
  Tool = "tool",
}

/**
 * UI message part type (Vercel AI SDK / useChat).
 */
export enum MessagePartType {
  Text = "text",
  ToolInvocation = "tool-invocation",
  ToolResult = "tool-result",
}

/**
 * Tool result action (approved, rejected, cancelled).
 */
export enum ToolActionResult {
  Approved = "approved",
  Rejected = "rejected",
  Cancelled = "cancelled",
}