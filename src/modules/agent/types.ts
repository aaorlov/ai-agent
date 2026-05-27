import type { MessageRole, ToolAction } from "./enums";

interface MessageBase {
	id: string;
	createdAt: string;
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

export type AgentMessage = HumanMessage | SystemMessage | AssistantMessage | ToolMessage;

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

export interface AgentResume {
	toolCallId: string;
	action: ToolAction;
	modifiedArgs?: Record<string, unknown>;
}

/**
 * Single-shot input describing what the threads layer wants the graph to do
 * for the next turn. Mutually-exclusive modes:
 *
 *  - `retry`: replay the last super-step from the live checkpoint, no input.
 *  - `resume`: resolve a pending `interrupt()` (e.g. tool-call approval).
 *  - default: append `messages` to graph state and run a normal turn.
 *
 * In the default mode `messages` is whatever the graph reducer should see for
 * this turn. The caller decides whether to pass just the new human message
 * (healthy checkpoint exists) or to also re-seed prior history (no checkpoint
 * yet — restored from the persisted message log).
 */
export interface AgentRunInput {
	userId: string;
	threadId: string;
	messages: AgentMessage[];
	resume?: AgentResume;
	retry?: boolean;
}

/**
 * Per-run runtime context set when invoking the graph. Available to nodes
 * and tools via `LangGraphRunnableConfig.context` / `ToolRuntime.context`.
 */
export interface AgentContext {
	userId: string;
}

