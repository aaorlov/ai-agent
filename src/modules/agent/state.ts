import { Annotation } from "@langchain/langgraph";
import type { AgentMessage, PendingTool, RetrievedDocument } from "./types";

export const AgentStateAnnotation = Annotation.Root({
	messages: Annotation<AgentMessage[]>({
		reducer: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
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
