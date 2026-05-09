import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";

import { AppError } from "@/common/errors";
import { logger } from "@/common/utils";

import { MEMORIES_NAMESPACE } from "../constants";
import type { AgentContext } from "../types";

const SaveMemoryInputSchema = z.object({
	content: z
		.string()
		.min(1)
		.describe(
			"The piece of information to persist verbatim. Should be a self-contained fact, preference, or instruction that will make sense without surrounding conversation.",
		),
});

interface SavedMemory extends Record<string, unknown> {
	content: string;
	createdAt: string;
}

/**
 * Subset of `LangGraphRunnableConfig` that the tool actually depends on.
 * Declared as a structural supertype so it satisfies `tool()`'s overload
 * constraint (the second parameter must accept `ToolRunnableConfig`) while
 * still typing the LangGraph-specific extras we read.
 */
interface AgentToolConfig extends RunnableConfig {
	context?: AgentContext;
	store?: BaseStore;
}

export const saveMemoryTool = tool(
	async ({ content }, config: AgentToolConfig): Promise<string> => {
		const userId = config.context?.userId;
		if (!userId) {
			throw new AppError("save_memory: userId missing from runtime context");
		}

		const store = config.store;
		if (!store) {
			throw new AppError("save_memory: long-term store is unavailable");
		}

		const memoryId = crypto.randomUUID();
		const memory: SavedMemory = {
			content,
			createdAt: new Date().toISOString(),
		};

		await store.put([userId, MEMORIES_NAMESPACE], memoryId, memory);

		logger.info("Saved long-term memory", { userId, memoryId });

		return "Saved to long-term memory.";
	},
	{
		name: "save_memory",
		description:
			"Persist a piece of information to the user's long-term memory so it can be recalled in future conversations. Use this when the user shares a stable preference, fact, or instruction worth remembering across sessions. Do not use for transient context that only matters within the current thread.",
		schema: SaveMemoryInputSchema,
	},
);
