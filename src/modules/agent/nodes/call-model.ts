import { type AIMessage, type BaseMessage, SystemMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";

import { AgentNode, MessageRole } from "../enums";
import { llm } from "../llm";
import type { AgentState } from "../state";
import {
	MANAGE_PLAN_TOOL_NAME,
	type Plan,
	PlanStepStatus,
	renderPlanChecklist,
	TOOLS_REQUIRING_APPROVAL,
} from "../tools";
import type { AgentMessage, AssistantMessage, ToolCall } from "../types";
import { toLangChainMessage } from "../utils";

const renderMemoriesSystemMessage = (memories: readonly string[]): SystemMessage =>
	new SystemMessage({
		content: `Known facts, preferences, and instructions about the user (from memories). Treat as stable context; do not restate unless relevant:\n${memories
			.map((memory) => `- ${memory}`)
			.join("\n")}`,
	});

const TERMINAL_PLAN_STATUSES: ReadonlySet<PlanStepStatus> = new Set([
	PlanStepStatus.Completed,
	PlanStepStatus.Cancelled,
]);

const isPlanFinished = (plan: Plan): boolean =>
	plan.steps.length > 0
	&& plan.steps.every((step) => TERMINAL_PLAN_STATUSES.has(step.status));

/**
 * Renders the active plan as a system reminder. While work is in flight the
 * full checklist is shipped so the model can see what's pending. Once every
 * step is terminal (completed/cancelled), we collapse to a one-liner — no
 * point burning tokens redrawing finished work each turn — and nudge the
 * model to start a fresh plan with `merge=false` if the next request is a
 * new task.
 */
const renderPlanSystemMessage = (plan: Plan): SystemMessage => {
	const goal = plan.goal ? ` for "${plan.goal}"` : "";
	const body = isPlanFinished(plan)
		? `Previous plan${goal} finished (${plan.steps.length} step(s) resolved). If the next request is a new task, call \`manage_plan\` with merge=false to start a fresh plan.`
		: `Active plan (keep statuses up to date via the \`manage_plan\` tool):\n${renderPlanChecklist(plan)}`;
	return new SystemMessage({ content: `<system-reminder>\n${body}\n</system-reminder>` });
};

/**
 * Drops `manage_plan` tool calls and their tool-result messages from the
 * conversation we ship to the LLM. The model already gets the resolved plan
 * via the `<system-reminder>` block, so the per-call audit trail is
 * redundant context cost. The originals stay in `state.messages` for the
 * UI/audit log.
 *
 * Edge cases handled:
 *  - assistant message with mixed tool calls: keep the message, strip just
 *    the `manage_plan` entries; the matching tool messages are also dropped
 *    so Anthropic's tool_use/tool_result pairing stays balanced.
 *  - assistant message whose only tool calls were `manage_plan` and whose
 *    text body is empty: drop the message entirely.
 */
const stripPlanInteractions = (messages: readonly AgentMessage[]): AgentMessage[] => {
	const planCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role === MessageRole.Assistant && message.toolCalls) {
			for (const call of message.toolCalls) {
				if (call.toolName === MANAGE_PLAN_TOOL_NAME) planCallIds.add(call.toolCallId);
			}
		}
	}

	const result: AgentMessage[] = [];
	for (const message of messages) {
		if (message.role === MessageRole.Tool && planCallIds.has(message.toolCallId)) {
			continue;
		}
		if (message.role === MessageRole.Assistant && message.toolCalls?.length) {
			const remaining = message.toolCalls.filter(
				(call) => call.toolName !== MANAGE_PLAN_TOOL_NAME,
			);
			if (message.content || remaining.length > 0) {
				result.push({...message, toolCalls: remaining});
			}
			continue;
		}
		result.push(message);
	}
	return result;
};

const toLangChainHistory = (state: AgentState): BaseMessage[] => {
	const history: BaseMessage[] = [];
	if (state.systemPrompt) {
		history.push(new SystemMessage({ content: state.systemPrompt }));
	}
	if (state.longTermMemories.length > 0) {
		history.push(renderMemoriesSystemMessage(state.longTermMemories));
	}
	if (state.plan) {
		history.push(renderPlanSystemMessage(state.plan));
	}
	for (const message of stripPlanInteractions(state.messages)) {
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
