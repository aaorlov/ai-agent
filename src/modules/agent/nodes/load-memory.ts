import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { SearchItem } from "@langchain/langgraph-checkpoint";

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

const extractMemory = (res: Array<string>, item: SearchItem): Array<string> => {
	const content = item?.value?.content;
	if (typeof content !== "string" || content.length === 0) return res;
	return [...res, content];
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

	const items: Array<SearchItem> = await store.search([userId, Memories.General], {
		limit: MAX_MEMORIES_PER_USER,
	});

	const memories = items
		.sort((a, b) => a?.value?.createdAt?.localeCompare(b?.value?.createdAt ?? "") ?? 0)
		.reduce(extractMemory, []);

	return { longTermMemories: memories };
};
