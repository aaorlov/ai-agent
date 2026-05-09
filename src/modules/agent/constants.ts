const SECONDS_IN_DAY = 60 * 60 * 24;

export const CHECKPOINT_COLLECTION = "agent_checkpoints";
export const CHECKPOINT_WRITES_COLLECTION = "agent_checkpoints_writes";
export const STORE_COLLECTION = "agent_store";

/** Retention for full checkpoint snapshots — long enough to resume idle threads. */
export const CHECKPOINT_TTL_SECONDS = 30 * SECONDS_IN_DAY;

/**
 * Retention for intermediate per-task writes. These exist only to recover an
 * in-flight super-step; anything that hasn't completed within this window
 * belongs to abandoned executions and is safe to drop.
 */
export const CHECKPOINT_WRITES_TTL_SECONDS = 7 * SECONDS_IN_DAY;

/**
 * Hard cap on messages kept in agent state. The reducer drops the oldest
 * entries past this threshold so per-checkpoint size and per-turn LLM
 * context cost stay bounded regardless of conversation length.
 */
export const MAX_HISTORY_MESSAGES = 30;

/**
 * Sub-namespace under each user in the long-term store for facts the LLM
 * persists via the `save_memory` tool. Full namespace: `[userId, MEMORIES_NAMESPACE]`.
 */
export const MEMORIES_NAMESPACE = "memories";
