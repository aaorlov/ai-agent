import type { AgentMessage } from "@/modules/agent/types";
import { SSEEventType, FinishReason } from "./enums";

export type SSEEvent =
  | { type: SSEEventType.Session; threadId: string }
  | { type: SSEEventType.TextDelta; content: string; id: string }
  | { type: SSEEventType.Message; message: AgentMessage }
  | {
      type: SSEEventType.ContextRetrieved;
      documents: Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        score?: number;
      }>;
    }
  | { type: SSEEventType.Error; message: string; code?: string }
  | {
      type: SSEEventType.Finish;
      finishReason: FinishReason;
      usage?: { promptTokens: number; completionTokens: number };
    };
