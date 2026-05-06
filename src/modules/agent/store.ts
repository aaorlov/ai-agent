import { MongoDBSaver, MongoDBStore } from "@langchain/langgraph-checkpoint-mongodb";

import { mongoService } from "@/common/db";
import { env } from "@/config";

import {
	CHECKPOINT_COLLECTION,
	CHECKPOINT_TTL_SECONDS,
	CHECKPOINT_WRITES_COLLECTION,
	CHECKPOINT_WRITES_TTL_SECONDS,
	STORE_COLLECTION,
} from "./constants";

export const checkpointer = new MongoDBSaver({
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
 * Removes all checkpoints (full state snapshots) and pending writes for the
 * given thread. Idempotent — deleting a non-existent thread is a no-op.
 */
export const deleteThread = (threadId: string): Promise<void> =>
	checkpointer.deleteThread(threadId);
