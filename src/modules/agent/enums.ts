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
}

/** Names of the nodes registered on the agent graph. Single source of truth. */
export enum AgentNode {
	CallModel = "call_model",
	ExecuteTool = "execute_tool",
	RequestApproval = "request_approval",
}
