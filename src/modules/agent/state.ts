import { Annotation } from "@langchain/langgraph";

import { MAX_HISTORY_MESSAGES } from "./constants";
import { MessageRole } from "./enums";
import type { AgentMessage, PendingTool, RetrievedDocument } from "./types";

/**
 * Tail-trims `messages` to `MAX_HISTORY_MESSAGES`, advancing the cut further
 * when needed so the kept window never starts with a `Tool` message whose
 * matching assistant `tool_use` was dropped. Without this guard Anthropic
 * rejects the next call with "tool_result without matching tool_use".
 */
const appendCappedMessages = (
	left: AgentMessage[],
	right: AgentMessage | AgentMessage[],
): AgentMessage[] => {
	const next = left.concat(Array.isArray(right) ? right : [right]);
	if (next.length <= MAX_HISTORY_MESSAGES) return next;

	let cutIndex = next.length - MAX_HISTORY_MESSAGES;
	while (cutIndex < next.length && next[cutIndex]?.role === MessageRole.Tool) {
		cutIndex++;
	}
	return next.slice(cutIndex);
};

export const AgentStateAnnotation = Annotation.Root({
	messages: Annotation<AgentMessage[]>({
		reducer: appendCappedMessages,
		default: () => [],
	}),

	/** Tools awaiting human approval. Plural — LLM can request multiple in one turn. */
	pendingTools: Annotation<PendingTool[]>({
		reducer: (_, right) => right ?? [],
		default: () => [],
	}),

	/** RAG: retrieved documents/chunks used for the current turn. */
	retrievedContext: Annotation<RetrievedDocument[]>({
		reducer: (_, right) => right ?? [],
		default: () => [],
	}),

	/** Incremented each agent iteration. Use to cap max steps. */
	steps: Annotation<number>({
		reducer: (left, right) => (right === 0 ? 0 : left + right),
		default: () => 0,
	}),

	/** Per-thread system prompt / instructions. Set once on thread creation. */
	systemPrompt: Annotation<string>({
		reducer: (_, right) => right ?? "",
		default: () => "",
	}),

	/**
	 * Snapshot of the user's `general_memory` entries loaded for the current
	 * turn. Refreshed by `load_memory` whenever the graph restarts from START
	 * (i.e. on each new user input); resumes from interrupts keep the prior
	 * snapshot. Strings only — the LLM never sees per-item metadata.
	 */
	longTermMemories: Annotation<string[]>({
		reducer: (_, right) => right ?? [],
		default: () => [],
	}),
});

export type AgentState = typeof AgentStateAnnotation.State;
