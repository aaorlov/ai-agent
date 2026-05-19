import { type AIMessageChunk, type BaseMessage, SystemMessage } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { END } from "@langchain/langgraph";

import { AgentNode, MessageRole } from "../enums";
import { llm } from "../llm";
import type { AgentState } from "../state";
import { TOOLS_REQUIRING_APPROVAL } from "../tools";
import type { AssistantMessage, ToolCall } from "../types";
import { toLangChainMessage } from "../utils";

const renderMemoriesSystemMessage = (memories: readonly string[]): SystemMessage =>
	new SystemMessage({
		content: `Known facts, preferences, and instructions about the user (from memories). Treat as stable context; do not restate unless relevant:\n${memories
			.map((memory) => `- ${memory}`)
			.join("\n")}`,
	});

const toLangChainHistory = (state: AgentState): BaseMessage[] => {
	const history: BaseMessage[] = [];
	if (state.systemPrompt) {
		history.push(new SystemMessage({ content: state.systemPrompt }));
	}
	if (state.longTermMemories.length > 0) {
		history.push(renderMemoriesSystemMessage(state.longTermMemories));
	}
	for (const message of state.messages) {
		history.push(toLangChainMessage(message));
	}
	return history;
};

const extractContent = (chunk: AIMessageChunk): string =>
	typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);

const extractToolCalls = (chunk: AIMessageChunk): ToolCall[] | undefined => {
	if (!chunk.tool_calls?.length) return undefined;
	return chunk.tool_calls.map((call) => ({
		toolCallId: call.id ?? crypto.randomUUID(),
		toolName: call.name,
		args: call.args ?? {},
		requiresApproval: TOOLS_REQUIRING_APPROVAL.has(call.name),
	}));
};

/**
 * Streams the LLM to drive token-level emissions on the graph's `messages`
 * channel (consumed via `streamEvents({ version: "v3" })` at the boundary),
 * while locally aggregating the chunks into a single `AIMessageChunk` for
 * tool-call and content extraction.
 */
const aggregateLLM = async (history: BaseMessage[]): Promise<AIMessageChunk | undefined> => {
	let aggregated: AIMessageChunk | undefined;
	for await (const chunk of await llm.stream(history)) {
		aggregated = aggregated ? concat(aggregated, chunk) : chunk;
	}
	return aggregated;
};

export const callModel = async (state: AgentState): Promise<Partial<AgentState>> => {
	const history = toLangChainHistory(state);
	const aggregated = await aggregateLLM(history);
	const toolCalls = aggregated ? extractToolCalls(aggregated) : undefined;

	const message: AssistantMessage = {
		id: aggregated?.id ?? crypto.randomUUID(),
		role: MessageRole.Assistant,
		content: aggregated ? extractContent(aggregated) : "",
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
