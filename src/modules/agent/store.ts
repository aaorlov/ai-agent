import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import { MongoDBSaver, MongoDBStore } from "@langchain/langgraph-checkpoint-mongodb";
import type { RunnableConfig } from "@langchain/core/runnables";

import { mongoService } from "@/common/db";
import { logger } from "@/common/utils";
import { env } from "@/config";

import {
	CHECKPOINT_COLLECTION,
	CHECKPOINT_TTL_SECONDS,
	CHECKPOINT_WRITES_COLLECTION,
	CHECKPOINT_WRITES_TTL_SECONDS,
	STORE_COLLECTION,
} from "./constants";

/**
 * `MongoDBSaver` keeps the full history of checkpoints per thread, but the
 * runtime only ever reads the latest one (`getTuple` sorts by `checkpoint_id`
 * desc + limit 1). This subclass prunes obsolete docs after every successful
 * `put`, so the steady-state footprint per thread is one checkpoint + its
 * pending writes — independent of conversation length.
 *
 * Cleanup runs only on `put` (i.e. when a new checkpoint is committed) so
 * `putWrites` against the current latest is never touched. The TTL on the two
 * collections is still kept as a safety net for abandoned / crashed threads
 * that never reach a final `put`.
 */
class LatestOnlyMongoDBSaver extends MongoDBSaver {
	async put(
		config: RunnableConfig,
		checkpoint: Checkpoint,
		metadata: CheckpointMetadata,
	): Promise<RunnableConfig> {
		const result = await super.put(config, checkpoint, metadata);

		const threadId = config.configurable?.thread_id;
		if (typeof threadId !== "string") return result;

		const namespace = config.configurable?.checkpoint_ns ?? "";
		const filter = {
			thread_id: threadId,
			checkpoint_ns: namespace,
			checkpoint_id: { $ne: checkpoint.id },
		};

		try {
			await Promise.all([
				this.db.collection(this.checkpointCollectionName).deleteMany(filter),
				this.db.collection(this.checkpointWritesCollectionName).deleteMany(filter),
			]);
		} catch (error) {
			// Non-fatal: a failed prune leaves stale docs that the next successful
			// put — or, ultimately, the TTL index — will clean up.
			logger.warn("Agent: checkpoint prune failed", { threadId, error });
		}

		return result;
	}
}

export const checkpointer = new LatestOnlyMongoDBSaver({
	client: mongoService.client,
	dbName: env.MONGODB_DB_NAME,
	checkpointCollectionName: CHECKPOINT_COLLECTION,
	checkpointWritesCollectionName: CHECKPOINT_WRITES_COLLECTION,
	enableTimestamps: true,
});

export const store = new MongoDBStore({
	client: mongoService.client,
	dbName: env.MONGODB_DB_NAME,
	collectionName: STORE_COLLECTION,
	enableTimestamps: true,
});

/**
 * Initializes the long-term store and creates TTL indexes on the two
 * checkpointer collections. Requires an active connection — must be called
 * only after `mongoService.connect()`.
 *
 * The TTLs are now a safety net: in steady state, `LatestOnlyMongoDBSaver`
 * keeps a single checkpoint per thread, so TTL only matters for threads that
 * are abandoned mid-run or never resumed.
 *
 * Note: `createIndex` is idempotent only when options match. Changing TTL
 * values requires dropping the existing index first (or using `collMod`).
 */
export const initAgent = async (): Promise<void> => {
	const db = mongoService.client.db(env.MONGODB_DB_NAME);

	await Promise.all([
		store.start(),
		db.collection(CHECKPOINT_COLLECTION).createIndex(
			{ upserted_at: 1 },
			{ expireAfterSeconds: CHECKPOINT_TTL_SECONDS },
		),
		db.collection(CHECKPOINT_WRITES_COLLECTION).createIndex(
			{ upserted_at: 1 },
			{ expireAfterSeconds: CHECKPOINT_WRITES_TTL_SECONDS },
		),
	]);
};

/**
 * Removes the LangGraph checkpoint (full state snapshot) and pending writes
 * for the given thread — i.e. the agent's working memory. Does NOT remove
 * persisted message history; that lives in the threads module. Idempotent.
 */
export const deleteCheckpoint = (threadId: string): Promise<void> =>
	checkpointer.deleteThread(threadId);
