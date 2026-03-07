import type { BaseMessage } from "@langchain/core/messages";
import type { AgentStatusPhase } from "./enums.js";

/** Optional UI messages passed from chat layer */
export interface UIMessageRef {
  id: string;
  role: string;
  content: string;
  parts?: unknown[];
}

/** Approval request stored in context when propose node interrupts (so stream consumer can emit approval-requested) */
export interface ApprovalRequest {
  toolCallId: string;
  toolName: string;
  args: unknown;
  question?: string;
  diff?: string;
}

/** Context may include pendingToolCalls when the agent is waiting for user approval */
export interface AgentContext extends Record<string, unknown> {
  uiMessages?: UIMessageRef[];
  pendingToolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  /** Set by propose node before interrupt so stream consumer can emit approval-requested */
  approvalRequest?: ApprovalRequest;
  /** Set by nodes for UI status (planning, thinking, which tool executed) */
  status?: AgentStatusUpdate;
  /** Set after plan node */
  plan?: string;
  /** Set after propose (interrupt resume) */
  approved?: boolean;
}

/** Status update emitted in state for UI (planning, thinking, tool execution) */
export interface AgentStatusUpdate {
  phase: AgentStatusPhase | string;
  message?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
}

export interface AgentState {
  messages: BaseMessage[];
  sessionId: string;
  context?: AgentContext;
}

/** Resume value for interrupt (approve / cancel / skip) */
export interface InterruptResume {
  approved?: boolean;
  skipped?: boolean;
  [key: string]: unknown;
}
