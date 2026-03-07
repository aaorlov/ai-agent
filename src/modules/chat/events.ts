import {
  SSEEventType,
  StatusCode,
  FinishReason,
} from "@/common/enums";

export { SSEEventType, StatusCode, FinishReason };

/** Normalize interrupt payload (from LangGraph or context.approvalRequest) to tool-call shape. */
export function normalizeInterruptToToolCall(value: unknown): {
  toolCallId: string;
  toolName: string;
  args: unknown;
} {
  if (value && typeof value === "object" && "toolCallId" in value) {
    const v = value as { toolCallId?: string; toolName?: string; args?: unknown };
    return {
      toolCallId: v.toolCallId ?? "unknown",
      toolName: v.toolName ?? "approval",
      args: v.args ?? {},
    };
  }
  return {
    toolCallId: "approval-1",
    toolName: "approval",
    args: value ?? {},
  };
}

export type SSEEvent =
  // 1. Lifecycle & Identity
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.Status; message: string; code?: StatusCode }

  // 2. Content Streaming (Vercel AI SDK Standard)
  | { type: SSEEventType.TextDelta; content: string; messageId?: string }
  | { type: SSEEventType.TextEnd; messageId?: string; metadata?: Record<string, unknown> }

  // 3. Tool Orchestration (The "Cursor" Core)
  | { type: SSEEventType.ToolCall; toolCallId: string; toolName: string; args: unknown; messageId?: string }
  | { type: SSEEventType.ToolResult; toolCallId: string; result: unknown; messageId?: string }

  // 4. Human-in-the-Loop (LangGraph Interrupts)
  | { type: SSEEventType.ApprovalRequested; toolCallId: string; toolName: string; args: unknown; messageId?: string }

  // 5. Termination
  | { type: SSEEventType.Error; messageId?: string; message: string; code?: string }
  | { type: SSEEventType.Finish; finishReason: FinishReason; usage?: { promptTokens: number; completionTokens: number } };
