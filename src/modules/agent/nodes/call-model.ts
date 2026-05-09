import { type AIMessageChunk, type BaseMessage, SystemMessage } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { END, type LangGraphRunnableConfig } from "@langchain/langgraph";

import { AgentNode, CustomEventType, MessageRole } from "../enums";
import { llm } from "../llm";
import type { AgentState } from "../state";
import { TOOLS_REQUIRING_APPROVAL } from "../tools";
import type { AssistantMessage, PendingTool, ToolCall } from "../types";
import { toLangChainMessage } from "../utils";

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

const extractToolCalls = (chunk: AIMessageChunk | undefined): ToolCall[] | undefined => {
	if (!chunk?.tool_calls?.length) return undefined;
	return chunk.tool_calls.map((call) => ({
		toolCallId: call.id ?? crypto.randomUUID(),
		toolName: call.name,
		args: call.args ?? {},
		requiresApproval: TOOLS_REQUIRING_APPROVAL.has(call.name),
	}));
};

const streamLLM = async (
	history: BaseMessage[],
	config: LangGraphRunnableConfig,
): Promise<AIMessageChunk | undefined> => {
	let aggregated: AIMessageChunk | undefined;
	const stream = await llm.stream(history);

	for await (const chunk of stream) {
		aggregated = aggregated ? concat(aggregated, chunk) : chunk;
		// stream if not a tool call, or mark somehow that response is a tool call
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
	const toolCalls = extractToolCalls(aggregated);

	const message: AssistantMessage = {
		id: aggregated?.id ?? crypto.randomUUID(),
		role: MessageRole.Assistant,
		content: extractContent(aggregated),
		createdAt: new Date().toISOString(),
		...(toolCalls ? { toolCalls } : {}),
	};

	return {
		messages: [message],
		pendingTools: toolCalls?.filter((call) => call.requiresApproval) ?? [],
	};
};

/**
 * Routes the graph after `callModel` runs:
 *  - any tool call needs approval → `request_approval` (it loops until the
 *    approval queue drains, then hands off to `execute_tool`).
 *  - any auto-executable tool call → `execute_tool`.
 *  - no tool calls → end the run.
 */
export const routeAfterCallModel = (
	state: AgentState,
): AgentNode.RequestApproval | AgentNode.ExecuteTool | typeof END => {
	if (state.pendingTools.length > 0) return AgentNode.RequestApproval;

	const last = state.messages.at(-1);
	if (last?.role !== MessageRole.Assistant) return END;
	const hasExecutable = last.toolCalls?.some((call) => !call.requiresApproval) ?? false;
	return hasExecutable ? AgentNode.ExecuteTool : END;
};
