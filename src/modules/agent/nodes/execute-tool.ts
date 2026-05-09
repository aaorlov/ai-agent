import type { LangGraphRunnableConfig } from "@langchain/langgraph";

import { MessageRole } from "../enums";
import type { AgentState } from "../state";
import type { AgentMessage, AssistantMessage } from "../types";
import { runTool } from "./utils";

const findLastAssistant = (
	messages: readonly AgentMessage[],
): AssistantMessage | undefined => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === MessageRole.Assistant) return message;
	}
	return undefined;
};

const collectResolvedToolCallIds = (messages: readonly AgentMessage[]): Set<string> => {
	const ids = new Set<string>();
	for (const message of messages) {
		if (message.role === MessageRole.Tool) ids.add(message.toolCallId);
	}
	return ids;
};

export const executeTool = async (
	state: AgentState,
	config: LangGraphRunnableConfig,
): Promise<Partial<AgentState>> => {
	const last = findLastAssistant(state.messages);
	if (!last?.toolCalls?.length) return {};

	// Skip approval-required calls (handled by `requestApproval`) and any call
	// already resolved earlier in the run (e.g. approved+executed via the
	// approval node before control reached us).
	const resolvedIds = collectResolvedToolCallIds(state.messages);
	const calls = last.toolCalls.filter(
		(call) => !call.requiresApproval && !resolvedIds.has(call.toolCallId),
	);
	if (calls.length === 0) return {};

	const messages = await Promise.all(calls.map((call) => runTool(call, config)));
	return { messages };
};
