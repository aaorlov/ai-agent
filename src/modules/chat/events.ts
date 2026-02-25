import { SSEEventType, StatusCode, FinishReason } from "@/common/enums";

export type SSEEvent =
  // 1. Lifecycle & Identity
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.Status; message: string; code?: StatusCode }

  // 2. Content Streaming (Vercel AI SDK Standard)
  | { type: SSEEventType.TextDelta; messageId: string; content: string }
  | { type: SSEEventType.TextEnd; messageId: string; metadata?: Record<string, unknown> }

  // 3. Tool Orchestration (The "Cursor" Core)
  | { type: SSEEventType.ToolCall; messageId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: SSEEventType.ToolResult; messageId: string; toolCallId: string; result: unknown }

  // 4. Human-in-the-Loop (LangGraph Interrupts)
  | { type: SSEEventType.ApprovalRequested; messageId: string; toolCallId: string; toolName: string; args: unknown }

  // 5. Termination
  | { type: SSEEventType.Error; messageId?: string; message: string; code?: string }
  | { type: SSEEventType.Finish; finishReason: FinishReason; usage?: { promptTokens: number; completionTokens: number } };
