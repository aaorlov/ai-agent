import type { LangGraphRunnableConfig } from "@langchain/langgraph";

import { AppError } from "@/common/errors";
import { logger } from "@/common/utils";

import { MAX_MEMORIES_PER_USER } from "../constants";
import { Memories } from "../enums";
import type { AgentState } from "../state";

const extractUserId = (context: unknown): string | undefined => {
	if (typeof context !== "object" || context === null) return undefined;
	const { userId } = context as { userId?: unknown };
	return typeof userId === "string" && userId.length > 0 ? userId : undefined;
};

const extractMemory = (value: unknown): { content: string; createdAt: string } | null => {
	if (typeof value !== "object" || value === null) return null;
	const { content, createdAt } = value as { content?: unknown; createdAt?: unknown };
	if (typeof content !== "string" || content.length === 0) return null;
	return { content, createdAt: typeof createdAt === "string" ? createdAt : "" };
};

/**
 * Loads the user's `general_memory` from the long-term store and writes it to
 * the `longTermMemories` channel for `callModel` to render into the LLM
 * prompt. Capped at `MAX_MEMORIES_PER_USER` items; sorted oldest → newest so
 * the LLM reads them chronologically.
 *
 * Failures here are non-fatal: a missing store or unexpected value shape
 * results in an empty memories list rather than aborting the turn.
 */
export const loadMemory = async (
	_state: AgentState,
	config: LangGraphRunnableConfig,
): Promise<Partial<AgentState>> => {
	const userId = extractUserId(config.context);
	if (!userId) {
		throw new AppError("load_memory: userId missing from runtime context");
	}

	const store = config.store;
	if (!store) {
		logger.warn("load_memory: long-term store unavailable; skipping");
		return { longTermMemories: [] };
	}

	const items = await store.search([userId, Memories.General], {
		limit: MAX_MEMORIES_PER_USER,
	});

	const memories = items
		.map((item) => extractMemory(item.value))
		.filter((memory): memory is { content: string; createdAt: string } => memory !== null)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
		.map((memory) => memory.content);

	return { longTermMemories: memories };
};
