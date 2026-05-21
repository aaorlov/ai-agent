import type { AgentMessage } from "@/modules/agent";

import type { FinishReason, SSEEventType } from "./enums";

export interface RetrievedDocumentEvent {
	id: string;
	content: string;
	metadata: Record<string, unknown>;
	score?: number;
}

export interface UsageStats {
	promptTokens: number;
	completionTokens: number;
}

export type SSEEvent =
	| { type: SSEEventType.Session; threadId: string }
	| { type: SSEEventType.TextDelta; content: string; id: string }
	| { type: SSEEventType.Message; message: AgentMessage }
	| { type: SSEEventType.ContextRetrieved; documents: RetrievedDocumentEvent[] }
	| { type: SSEEventType.Error; message: string; code?: string }
	| {
			type: SSEEventType.Finish;
			finishReason: FinishReason;
			usage?: UsageStats;
		};
