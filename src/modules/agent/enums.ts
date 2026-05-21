export enum MessageRole {
	Human = "human",
	System = "system",
	Assistant = "assistant",
	Tool = "tool",
}

export enum ToolAction {
	Executed = "executed",
	Approved = "approved",
	Cancelled = "cancelled",
	Skipped = "skipped",
	Error = "error",
	Expired = "expired",
}

/** Names of the nodes registered on the agent graph. Single source of truth. */
export enum AgentNode {
	LoadMemory = "load_memory",
	CallModel = "call_model",
	ExecuteTool = "execute_tool",
	RequestApproval = "request_approval",
}

/**
 * Sub-namespaces under each user in the long-term store. Each member is a
 * separate bucket (`[userId, Memories.<Member>]`). `General` is the catch-all
 * the `save_memory` tool writes to; task-specific buckets will be added here
 * as new members.
 */
export enum Memories {
	General = "general_memory",
}
