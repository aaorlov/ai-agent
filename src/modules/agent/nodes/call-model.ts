import { type AIMessage, type BaseMessage, SystemMessage } from "@langchain/core/messages";
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

const extractContent = (message: AIMessage): string =>
	typeof message.content === "string" ? message.content : JSON.stringify(message.content);

const extractToolCalls = (message: AIMessage): ToolCall[] | undefined => {
	if (!message.tool_calls?.length) return undefined;
	return message.tool_calls.map((call) => ({
		toolCallId: call.id ?? crypto.randomUUID(),
		toolName: call.name,
		args: call.args ?? {},
		requiresApproval: TOOLS_REQUIRING_APPROVAL.has(call.name),
	}));
};

/**
 * Calls the LLM via `invoke`, not `stream`. `invoke` goes through Core's
 * `_generateUncached`, which — when a handler with
 * `lc_prefer_chat_model_stream_events` is present (the LangGraph v2 messages
 * handler always sets this) and the model implements `_streamChatModelEvents`
 * (ChatAnthropic does) — internally streams and dispatches per-chunk
 * `handleChatModelStreamEvent` callbacks. Those become per-token
 * `content-block-delta` events on the graph's `messages` channel that the
 * SSE layer forwards as `TextDelta`s. Using `.stream()` here silently falls
 * back to a path that emits one synthesized full-text delta at end-of-call.
 */
export const callModel = async (state: AgentState): Promise<Partial<AgentState>> => {
	const history = toLangChainHistory(state);
	const result = await llm.invoke(history);
	const toolCalls = extractToolCalls(result);

	const message: AssistantMessage = {
		id: result.id ?? crypto.randomUUID(),
		role: MessageRole.Assistant,
		content: extractContent(result),
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
