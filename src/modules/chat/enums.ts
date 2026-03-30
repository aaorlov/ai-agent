export enum ChatRequestType {
  Message = "message",
  ToolAction = "tool_action",
}

export enum SSEEventType {
  Session = "session",
  TextDelta = "text-delta",
  Message = "message",
  ContextRetrieved = "context-retrieved",
  Error = "error",
  Finish = "finish",
}

export enum FinishReason {
  Stop = "stop",
  Approval = "approval",
  Error = "error",
  Abort = "abort",
  MaxSteps = "max-steps",
}
