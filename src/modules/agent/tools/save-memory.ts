import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";

import { AppError } from "@/common/errors";
import { logger } from "@/common/utils";

import { MAX_MEMORIES_PER_USER } from "../constants";
import { Memories } from "../enums";
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
 * Drops the oldest entries (by `createdAt`) so that after writing one new
 * memory the user's stored count is `<= MAX_MEMORIES_PER_USER`. No-op when
 * the user is below the cap. The search fetches `MAX + 1` to detect — and
 * self-heal — any legacy overflow from before this cap existed.
 */
const evictOldestIfFull = async (
	store: BaseStore,
	namespace: readonly string[],
): Promise<void> => {
	const existing = await store.search([...namespace], {
		limit: MAX_MEMORIES_PER_USER + 1,
	});
	if (existing.length < MAX_MEMORIES_PER_USER) return;

	const sortedOldestFirst = [...existing].sort((a, b) => {
		const aCreatedAt = (a.value as SavedMemory).createdAt ?? "";
		const bCreatedAt = (b.value as SavedMemory).createdAt ?? "";
		return aCreatedAt.localeCompare(bCreatedAt);
	});
	const evictCount = existing.length - MAX_MEMORIES_PER_USER + 1;
	await Promise.all(
		sortedOldestFirst
			.slice(0, evictCount)
			.map((item) => store.delete(item.namespace, item.key)),
	);
};

export const SAVE_MEMORY_TOOL_NAME = "save_memory";

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
		if(!content) {
			logger.info("Saved long-term memory: no content to save");
			return "No content to save";
		}

		const userId = config.context?.userId;
		if (!userId) {
			throw new AppError("save_memory: userId missing from runtime context");
		}

		const store = config.store;
		if (!store) {
			throw new AppError("save_memory: long-term store is unavailable");
		}

		const namespace = [userId, Memories.General] as const;
		await evictOldestIfFull(store, namespace);

		const memoryId = crypto.randomUUID();
		const memory: SavedMemory = {
			content,
			createdAt: new Date().toISOString(),
		};

		await store.put([...namespace], memoryId, memory);

		logger.info("Saved long-term memory", { userId, memoryId });

		return "Saved to long-term memory.";
	},
	{
		name: SAVE_MEMORY_TOOL_NAME,
		description:
			"Persist a piece of general information to the user's long-term memory so it can be recalled in future conversations across any topic. Use this when the user shares a stable preference, fact, or instruction worth remembering across sessions. Do not use for transient context that only matters within the current thread. Storage is capped per user; the oldest entry is evicted when full.",
		schema: SaveMemoryInputSchema,
	},
);
