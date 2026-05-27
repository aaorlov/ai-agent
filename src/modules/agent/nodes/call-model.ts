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

/**
 * Type guard for an LLM content block carrying spoken text.
 * Provider-side content arrays mix text blocks with `tool_use`, `thinking`,
 * and other provider-specific shapes; only `text` blocks contribute to the
 * user-visible message body.
 */
const isTextContentBlock = (block: unknown): block is { type: "text"; text: string } =>
	typeof block === "object"
	&& block !== null
	&& "type" in block
	&& block.type === "text"
	&& "text" in block
	&& typeof block.text === "string";

/**
 * Reduces an `AIMessage` to its plain-text body.
 *
 * Anthropic returns content as either a string or an array of content blocks
 * (text, tool_use, thinking, …). Tool calls are captured separately in
 * `extractToolCalls`, so here we keep only the text blocks and concatenate
 * them. This produces a stable, UI-friendly string regardless of provider
 * shape, and avoids leaking JSON envelopes into the persisted history.
 */
const extractContent = (message: AIMessage): string => {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter(isTextContentBlock).map((block) => block.text).join("");
};

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
