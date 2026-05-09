import type { StructuredToolInterface } from "@langchain/core/tools";

import { saveMemoryTool } from "./save-memory";

export { saveMemoryTool };

/** All tools the LLM is allowed to call. Bound to the model in `llm.ts`. */
export const TOOLS: readonly StructuredToolInterface[] = [saveMemoryTool];

/** Lookup by tool name for the executor node. */
export const TOOLS_BY_NAME: ReadonlyMap<string, StructuredToolInterface> = new Map(
	TOOLS.map((tool) => [tool.name, tool]),
);

/**
 * Tools that must pause for explicit human approval before running.
 * `callModel` flags matching calls so the graph routes them through the
 * approval interrupt instead of executing immediately.
 */
export const TOOLS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set();
