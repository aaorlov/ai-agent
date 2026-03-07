/**
 * Agent graph node names.
 */
export enum AgentNode {
  Agent = "agent",
  Plan = "plan",
  Propose = "propose",
  Apply = "apply",
}

/**
 * Tool result action (approved, rejected, skipped, retried).
 */
export enum ToolActionResult {
  Approved = "approved",
  Rejected = "rejected",
  Skipped = "skipped",
  Retried = "retried",
}

/**
 * Status phase for UI (planning, thinking, executing tool).
 */
export enum AgentStatusPhase {
  Planning = "planning",
  Thinking = "thinking",
  Executing = "executing",
  Idle = "idle",
}
