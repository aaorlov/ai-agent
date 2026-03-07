import type { MessageRole, ToolActionResult } from "./enums.js";

/**
 * Input passed into the agent for each run.
 * - threadId: conversation thread (required for checkpointing).
 * - messages: current conversation messages from UI.
 * - resume: when continuing after an interrupt (approve/cancel/skip/retry).
 */
export interface AgentRunInput {
  threadId: string;
  messages: AgentMessage[];
  /** When resuming after interrupt: { toolCallId, action, result? } */
  resume?: AgentResume;
  context?: Record<string, unknown>;
}

/**
 * Single message in agent format (flattened from UI if needed).
 */
export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Optional tool-related payload */
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  action?: ToolActionResult;
}

/**
 * Resume payload when continuing after an approval interrupt.
 */
export interface AgentResume {
  toolCallId: string;
  toolName: string;
  action?: ToolActionResult;
  result?: unknown;
}

/**
 * Chunk yielded by agent.stream().
 * Keys are state channel names; values are the update for that step.
 */
export type AgentStreamChunk = Record<string, unknown>;
