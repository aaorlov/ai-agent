import type { CustomEventType, MessageRole, StreamMode, ToolAction } from "./enums";
import type { AgentState } from "./state";

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
}

export interface CustomTextDelta {
	type: CustomEventType.TextDelta;
	content: string;
	id: string;
}

export type CustomEventData = CustomTextDelta;

export type AgentStreamEvent =
	| { mode: StreamMode.Updates; data: Record<string, Partial<AgentState>> }
	| { mode: StreamMode.Custom; data: CustomEventData };
