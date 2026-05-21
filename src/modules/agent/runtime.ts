import { MessageRole, ToolAction } from "./enums";
import { agentGraph } from "./graph";
import type { AgentState } from "./state";
import { checkpointer } from "./store";
import type { AgentMessage, ToolCall, ToolMessage } from "./types";

export const hasCheckpoint = async (threadId: string): Promise<boolean> => {
	const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } });
	return tuple !== undefined;
};

/**
 * Returns the latest committed state values for a thread, or `null` if no
 * checkpoint exists. Used by the threads layer to inspect pending tools and
 * unresolved tool calls before starting a new turn.
 */
export const getCheckpointState = async (threadId: string): Promise<AgentState | null> => {
	const snapshot = await agentGraph.getState({ configurable: { thread_id: threadId } });
	if (snapshot.config.configurable?.checkpoint_id == null) return null;
	return snapshot.values as AgentState;
};

/**
 * Returns the assistant tool calls anywhere in `messages` that don't yet
 * have a matching `Tool` message recorded. These are the calls that need to
 * be closed out with a synthetic `Expired` tool message before the LLM is
 * called again — otherwise the Anthropic API rejects the next request for
 * a missing tool_result.
 */
export const findOrphanToolCalls = (messages: readonly AgentMessage[]): ToolCall[] => {
	const resolvedIds = new Set<string>();
	for (const message of messages) {
		if (message.role === MessageRole.Tool) resolvedIds.add(message.toolCallId);
	}

	const orphans: ToolCall[] = [];
	for (const message of messages) {
		if (message.role === MessageRole.Assistant && message.toolCalls?.length! > 0) {
			for (const call of message.toolCalls!) {
				if (!resolvedIds.has(call.toolCallId)) orphans.push(call);
			}
		}
	}
	return orphans;
};

/** Synthesises `Expired`-action tool messages for each orphaned call. */
export const buildExpiredToolMessages = (orphans: readonly ToolCall[]): ToolMessage[] => {
	const now = new Date().toISOString();
	return orphans.map((call) => ({
		id: crypto.randomUUID(),
		role: MessageRole.Tool,
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		result: "Tool call expired without a user response and was closed out.",
		action: ToolAction.Expired,
		createdAt: now,
	}));
};
