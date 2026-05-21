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

export interface AgentRunInput {
	userId: string;
	threadId: string;
	messages: AgentMessage[];
	resume?: AgentResume;
	/**
	 * When true, the run resumes the existing thread from its last successful
	 * checkpoint without applying any new input. Used to retry a failed node
	 * after the previous run aborted with an error.
	 */
	retry?: boolean;
	/**
	 * Messages to seed state with before applying `messages`. Used by the
	 * threads layer to rebuild working memory from the message log when the
	 * checkpoint TTL has expired, and to inject synthetic `Expired` tool
	 * results that close out abandoned approvals. Order is preserved:
	 * `[...hydrationMessages, ...messages]` is what the reducer sees.
	 */
	hydrationMessages?: AgentMessage[];
}

/**
 * Per-run runtime context set when invoking the graph. Available to nodes
 * and tools via `LangGraphRunnableConfig.context` / `ToolRuntime.context`.
 */
export interface AgentContext {
	userId: string;
}

