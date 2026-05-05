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

export enum CustomEventType {
	TextDelta = "text-delta",
}

export enum StreamMode {
	Updates = "updates",
	Custom = "custom",
}
