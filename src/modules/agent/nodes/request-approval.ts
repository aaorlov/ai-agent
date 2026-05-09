import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";

import { AgentNode, MessageRole, ToolAction } from "../enums";
import type { AgentState } from "../state";
import type { AgentResume, PendingTool, ToolMessage } from "../types";
import { runTool } from "./utils";

const firstPending = (pending: PendingTool[]): PendingTool => {
	const tool = pending[0];
	if (!tool) {
		throw new Error("requestApproval invoked with no pending tools");
	}
	return tool;
};

const recordDecision = (pending: PendingTool, action: ToolAction): ToolMessage => ({
	id: crypto.randomUUID(),
	role: MessageRole.Tool,
	toolCallId: pending.toolCallId,
	toolName: pending.toolName,
	result: `Tool execution ${action} by user.`,
	action,
	createdAt: new Date().toISOString(),
});

/**
 * Pauses execution to ask the user whether to run the next pending tool call.
 * On `Approved`, the tool runs immediately with the user's (possibly modified)
 * args and produces a normal `ToolMessage`. On any other action, the decision
 * is recorded as a `ToolMessage` and the tool is skipped.
 *
 * Operates on one pending tool per invocation; the router below loops back
 * here as long as `pendingTools` is non-empty.
 */
export const requestApproval = async (
	state: AgentState,
	config: LangGraphRunnableConfig,
): Promise<Partial<AgentState>> => {
	const pending = firstPending(state.pendingTools);

	// `interrupt` returns whatever the client sends in `Command({ resume })`.
	// In this app the chat endpoint always supplies an `AgentResume` payload.
	const resume: AgentResume | undefined = interrupt({
		toolCallId: pending.toolCallId,
		toolName: pending.toolName,
		args: pending.args,
	});

	const action = resume?.action ?? ToolAction.Approved;
	const args = resume?.modifiedArgs ?? pending.args;
	const remaining = state.pendingTools.slice(1);

	const message =
		action === ToolAction.Approved
			? await runTool(
					{ toolCallId: pending.toolCallId, toolName: pending.toolName, args },
					config,
				)
			: recordDecision(pending, action);

	return { pendingTools: remaining, messages: [message] };
};

/**
 * After an approval round, loop back into `request_approval` while pending
 * tools remain; otherwise hand off to `execute_tool` to run any non-approval
 * tool calls from the same assistant turn (it's a no-op if none).
 */
export const routeAfterRequestApproval = (
	state: AgentState,
): AgentNode.RequestApproval | AgentNode.ExecuteTool => {
	return state.pendingTools.length > 0
		? AgentNode.RequestApproval
		: AgentNode.ExecuteTool;
};
