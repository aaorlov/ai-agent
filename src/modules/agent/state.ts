import { Annotation } from "@langchain/langgraph";
import type { AgentMessage, PendingTool, RetrievedDocument } from "./types.js";
import { AgentStatusPhase } from "./enums.js";

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<AgentMessage[]>({
    reducer: (left, right) =>
      left.concat(Array.isArray(right) ? right : [right]),
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

  /** Current phase for UI status events (transient — overwritten each step). */
  status: Annotation<AgentStatusPhase | null>({
    reducer: (_, right) => right ?? null,
    default: () => null,
  }),

  /** Streaming text delta (transient). */
  textDelta: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),

  /** ID of the assistant message currently being streamed. Set alongside textDelta. */
  currentMessageId: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
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
