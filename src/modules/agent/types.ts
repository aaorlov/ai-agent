import { MessageRole, ToolAction } from "./enums.js";

// ---------------------------------------------------------------------------
// Messages — discriminated union on `role`
// ---------------------------------------------------------------------------

interface MessageBase {
  id: string;
  createdAt?: string;
}

export interface HumanMessage extends MessageBase {
  role: MessageRole.Human;
  content: string;
}

export interface SystemMessage extends MessageBase {
  role: MessageRole.System;
  content: string;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface AssistantMessage extends MessageBase {
  role: MessageRole.Assistant;
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage extends MessageBase {
  role: MessageRole.Tool;
  toolCallId: string;
  toolName: string;
  result: unknown;
  action: ToolAction;
  error?: string;
}

export type AgentMessage =
  | HumanMessage
  | SystemMessage
  | AssistantMessage
  | ToolMessage;

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export interface PendingTool {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface RetrievedDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score?: number;
}

// ---------------------------------------------------------------------------
// Run / Resume
// ---------------------------------------------------------------------------

export interface AgentResume {
  toolCallId: string;
  action: ToolAction;
  modifiedArgs?: Record<string, unknown>;
}

export interface AgentRunInput {
  threadId: string;
  messages: AgentMessage[];
  resume?: AgentResume;
}

export type AgentStreamChunk = Record<string, unknown>;
