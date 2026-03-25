import { AgentStatusPhase, ToolAction } from "@/modules/agent/enums";

export enum SSEEventType {
  Session = "session",
  Status = "status",
  TextDelta = "text-delta",
  TextEnd = "text-end",
  ToolCall = "tool-call",
  ToolResult = "tool-result",
  ApprovalRequired = "approval-required",
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

export type SSEEvent =
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.Status; code: AgentStatusPhase; message: string }
  | { type: SSEEventType.TextDelta; content: string; messageId?: string }
  | { type: SSEEventType.TextEnd; messageId?: string }
  | {
      type: SSEEventType.ToolCall;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      messageId?: string;
    }
  | {
      type: SSEEventType.ToolResult;
      toolCallId: string;
      toolName: string;
      action: ToolAction;
      result?: unknown;
      error?: string;
    }
  | {
      type: SSEEventType.ApprovalRequired;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      description: string;
    }
  | {
      type: SSEEventType.ContextRetrieved;
      documents: Array<{
        id: string;
        title?: string;
        snippet: string;
        score?: number;
      }>;
    }
  | { type: SSEEventType.Error; message: string; code?: string }
  | {
      type: SSEEventType.Finish;
      finishReason: FinishReason;
      usage?: { promptTokens: number; completionTokens: number };
    };
