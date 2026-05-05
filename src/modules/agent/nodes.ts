import { type AIMessageChunk, type BaseMessage, SystemMessage } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";

import { CustomEventType, MessageRole, ToolAction } from "./enums";
import { llm } from "./llm";
import type { AgentState } from "./state";
import type { PendingTool } from "./types";
import { toLangChainMessage } from "./utils";

const toLangChainHistory = (state: AgentState): BaseMessage[] => {
	const history: BaseMessage[] = [];
	if (state.systemPrompt) {
		history.push(new SystemMessage({ content: state.systemPrompt }));
	}
	for (const message of state.messages) {
		history.push(toLangChainMessage(message));
	}
	return history;
};

const extractContent = (chunk: AIMessageChunk | undefined): string => {
	if (!chunk) return "";
	if (typeof chunk.content === "string") return chunk.content;
	return JSON.stringify(chunk.content);
};

const streamLLM = async (
	history: BaseMessage[],
	config: LangGraphRunnableConfig,
): Promise<AIMessageChunk | undefined> => {
	let aggregated: AIMessageChunk | undefined;
	const stream = await llm.stream(history);
	for await (const chunk of stream) {
		aggregated = aggregated ? concat(aggregated, chunk) : chunk;
		if (chunk.content) {
			config.writer?.({
				type: CustomEventType.TextDelta,
				content: chunk.content,
				messageId: aggregated.id,
			});
		}
	}
	return aggregated;
};

export const callModel = async (
	state: AgentState,
	config: LangGraphRunnableConfig,
): Promise<Partial<AgentState>> => {
	const history = toLangChainHistory(state);
	const aggregated = await streamLLM(history, config);

	return {
		messages: [
			{
				id: aggregated?.id ?? crypto.randomUUID(),
				role: MessageRole.Assistant,
				content: extractContent(aggregated),
				createdAt: new Date().toISOString(),
			},
		],
	};
};

// Stub: emits an assistant message with a tool call that requires approval.
// Replace with real LLM + tool-binding once tools are wired in.
export const executeTool = async (_state: AgentState): Promise<Partial<AgentState>> => ({
	messages: [
		{
			id: crypto.randomUUID(),
			role: MessageRole.Assistant,
			content: "",
			toolCalls: [
				{
					toolCallId: crypto.randomUUID(),
					toolName: "example_approval_tool",
					args: { message: "Executing tool" },
					requiresApproval: true,
				},
			],
			createdAt: new Date().toISOString(),
		},
	],
});

const firstPending = (pending: PendingTool[]): PendingTool => {
	const tool = pending[0];
	if (!tool) {
		throw new Error("requestApproval invoked with no pending tools");
	}
	return tool;
};

export const requestApproval = async (state: AgentState): Promise<Partial<AgentState>> => {
	const tool = firstPending(state.pendingTools);
	const resumeValue = interrupt({
		toolCallId: tool.toolCallId,
		toolName: tool.toolName,
		args: tool.args,
	});

	return {
		pendingTools: [],
		messages: [
			{
				id: crypto.randomUUID(),
				role: MessageRole.Tool,
				toolCallId: tool.toolCallId,
				toolName: tool.toolName,
				result: resumeValue?.modifiedArgs ?? {},
				action: resumeValue?.action ?? ToolAction.Approved,
				createdAt: new Date().toISOString(),
			},
		],
	};
};
