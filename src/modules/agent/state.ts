import { Annotation } from "@langchain/langgraph";
import { AgentMessage } from "./types.js";
import { AgentStatusPhase } from "./enums.js";

/**
 * Agent graph state.
 * - messages: conversation messages (reducer appends).
 * - pendingTool: set when a tool requires approval (interrupt); cleared on resume.
 * - status: current phase for SSE status events.
 */
export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<AgentMessage[]>({
    reducer: (left, right) => (Array.isArray(right) ? left.concat(right) : left.concat([right])),
    default: () => [],
  }),
  /** When interrupt is active: { toolCallId, toolName, args } */
  pendingTool: Annotation<{ toolCallId: string; toolName: string; args: unknown } | null>({
    reducer: (_, right) => right ?? null,
    default: () => null,
  }),
  /** Current phase for UI status (planning, thinking, executing, tool_result). */
  status: Annotation<AgentStatusPhase | null>({
    reducer: (_, right) => right ?? null,
    default: () => null,
  }),
  /** Last text delta for streaming (optional) */
  textDelta: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
