export enum MessageRole {
  Human = "human",
  System = "system",
  Assistant = "assistant",
  Tool = "tool",
}

/**
 * How a tool call was resolved.
 * - Executed: auto-executed (no approval needed)
 * - Approved / Cancelled / Skipped: human decision
 * - Error: tool errored during execution
 */
export enum ToolAction {
  Executed = "executed",
  Approved = "approved",
  Cancelled = "cancelled",
  Skipped = "skipped",
  Error = "error",
}

export enum AgentStatusPhase {
  Planning = "planning",
  Thinking = "thinking",
  Executing = "executing",
  ToolResult = "tool_result",
}
