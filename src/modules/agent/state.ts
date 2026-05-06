import { Annotation } from "@langchain/langgraph";

import { MAX_HISTORY_MESSAGES } from "./constants";
import type { AgentMessage, PendingTool, RetrievedDocument } from "./types";

const appendCappedMessages = (
	left: AgentMessage[],
	right: AgentMessage | AgentMessage[],
): AgentMessage[] => {
	const next = left.concat(Array.isArray(right) ? right : [right]);
	// Naive tail trim: callers should be aware that this can break tool_use /
	// tool_result pairing if a cut falls between them. Safe today because the
	// graph doesn't yet produce tool-call sequences; revisit when tools land.
	return next.length > MAX_HISTORY_MESSAGES
		? next.slice(-MAX_HISTORY_MESSAGES)
		: next;
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
});

export type AgentState = typeof AgentStateAnnotation.State;
