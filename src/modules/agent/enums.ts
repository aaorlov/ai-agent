/**
 * Message role (system, user, assistant, tool).
 * Used by agent state and chat UIMessage.
 */
export enum MessageRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
  Tool = "tool",
}

/**
 * UI message part type (text, tool invocation, tool result).
 */
export enum MessagePartType {
  Text = "text",
  ToolInvocation = "tool-invocation",
  ToolResult = "tool-result",
}

/**
 * Tool result action: approve, cancel, skip, retry.
 * Used when user responds to an approval request or when retrying.
 */
export enum ToolActionResult {
  Approved = "approved",
  Cancelled = "cancelled",
  Skipped = "skipped"
}

/** Status phase for agent streaming (planning, thinking, executing, tool result). */
export enum AgentStatusPhase {
  Planning = "planning",
  Thinking = "thinking",
  Executing = "executing",
  ToolResult = "tool_result",
}
