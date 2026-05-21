import type { Collection, Document } from "mongodb";
import { MongoServerError } from "mongodb";

import { mongoService } from "@/common/db";
import { MongoErrorCode } from "@/common/enums";
import { logger } from "@/common/utils";
import { env } from "@/config";
import type { AgentMessage } from "@/modules/agent";

import { MESSAGES_COLLECTION, THREADS_COLLECTION } from "./constants";
import type {
	MessageDoc,
	MessagesPage,
	ThreadDoc,
	ThreadsPage,
	ThreadSummary,
} from "./types";

// -----------------------------------------------------------------------------
// Collections + setup
// -----------------------------------------------------------------------------

const threads = (): Collection<ThreadDoc> =>
	mongoService.client.db(env.MONGODB_DB_NAME).collection<ThreadDoc>(THREADS_COLLECTION);

const messages = (): Collection<MessageDoc> =>
	mongoService.client.db(env.MONGODB_DB_NAME).collection<MessageDoc>(MESSAGES_COLLECTION);

/**
 * Creates indexes for both collections. Idempotent — Mongo skips existing
 * indexes with matching options.
 *
 * `threads`:
 *  - `threadId` UNIQUE: point lookups and the idempotent upsert in
 *    `appendMessage`.
 *  - `userId + updatedAt`: per-user recent-first listing (the only multi-
 *    field query against this collection).
 *
 * `messages`:
 *  - `threadId + message.id` UNIQUE: idempotent writes; if the same message
 *    id is appended twice, Mongo rejects with E11000 and we swallow it.
 *  - `userId + threadId + createdAt`: per-thread paged reads, filtered by
 *    user as a defense-in-depth check on the denormalized owner field.
 */
export const initThreads = async (): Promise<void> => {
	await Promise.all([
		threads().createIndex({ threadId: 1 }, { unique: true }),
		threads().createIndex({ userId: 1, updatedAt: -1 }),
		messages().createIndex({ threadId: 1, "message.id": 1 }, { unique: true }),
		messages().createIndex({ userId: 1, threadId: 1, createdAt: 1 }),
	]);
};

// -----------------------------------------------------------------------------
// Messages: writes
// -----------------------------------------------------------------------------

const toMessageDoc = (userId: string, threadId: string, message: AgentMessage): MessageDoc => ({
	threadId,
	userId,
	message,
	createdAt: new Date(message.createdAt),
});

/**
 * Appends one message to a thread and updates the parent thread snapshot in
 * a single repository call. Order is intentional:
 *
 *  1. Insert into `messages`. The unique `(threadId, message.id)` index makes
 *     this idempotent — a retry on an already-inserted message bails before
 *     touching the thread doc, so `messageCount` can't inflate from duplicates.
 *  2. Upsert the thread: sets `lastMessage`/`updatedAt`, stamps `userId` and
 *     `createdAt` on first insert, and bumps `messageCount`.
 *
 * Known limitation: if (2) fails after (1) succeeds (e.g. network) and the
 * caller never retries, `messageCount` drifts by 1. A transaction would
 * close the gap; not worth the complexity here.
 */
export const appendMessage = async (
	userId: string,
	threadId: string,
	message: AgentMessage,
): Promise<void> => {
	const createdAt = new Date(message.createdAt);

	try {
		await messages().insertOne(toMessageDoc(userId, threadId, message));
	} catch (error) {
		if (error instanceof MongoServerError && error.code === MongoErrorCode.DuplicateKey) {
			logger.debug("Threads: duplicate message ignored", {
				threadId,
				messageId: message.id,
			});
			return;
		}
		throw error;
	}

	await threads().updateOne(
		{ threadId },
		{
			$setOnInsert: { userId, createdAt },
			$set: { lastMessage: message, updatedAt: createdAt },
			$inc: { messageCount: 1 },
		},
		{ upsert: true },
	);
};

export const appendMessages = async (
	userId: string,
	threadId: string,
	batch: readonly AgentMessage[],
): Promise<void> => {
	if (batch.length === 0) return;
	await Promise.all(batch.map((message) => appendMessage(userId, threadId, message)));
};

/**
 * Removes every message in a thread owned by `userId` and returns the count.
 * Kept user-scoped as defense-in-depth even though `deleteThread` is the real
 * ownership gate — should the thread doc be missing, this still won't reach
 * another user's data.
 */
export const deleteThreadMessages = async (
	userId: string,
	threadId: string,
): Promise<number> => {
	const result = await messages().deleteMany({ userId, threadId });
	return result.deletedCount;
};

// -----------------------------------------------------------------------------
// Messages: reads
// -----------------------------------------------------------------------------

/**
 * Returns the most recent `limit` messages of a thread in chronological
 * order (oldest first). Used by the agent runtime to rehydrate working
 * memory when the checkpoint TTL has expired.
 */
export const getRecentMessages = async (
	userId: string,
	threadId: string,
	limit: number,
): Promise<AgentMessage[]> => {
	const docs = await messages()
		.find({ userId, threadId })
		.sort({ createdAt: -1 })
		.limit(limit)
		.toArray();
	return docs.map((doc) => doc.message).reverse();
};

/**
 * Cursor-paginated reader for the UI. `before` is an ISO timestamp; results
 * are messages strictly older than `before`, returned chronological (oldest
 * first) so callers can render and prepend on scroll-up.
 */
export const getMessagesPage = async (
	userId: string,
	threadId: string,
	limit: number,
	before?: string,
): Promise<MessagesPage> => {
	const query: Document = { userId, threadId };
	if (before) query.createdAt = { $lt: new Date(before) };

	const docs = await messages()
		.find(query)
		.sort({ createdAt: -1 })
		.limit(limit + 1)
		.toArray();

	const hasMore = docs.length > limit;
	const page = hasMore ? docs.slice(0, limit) : docs;
	const oldest = page.at(-1);

	return {
		messages: page.map((doc) => doc.message).reverse(),
		hasMore,
		nextBefore: hasMore && oldest ? oldest.createdAt.toISOString() : null,
	};
};

// -----------------------------------------------------------------------------
// Threads: writes
// -----------------------------------------------------------------------------

/**
 * Deletes a thread by `(userId, threadId)`. Returns `1` when the caller owns
 * the thread (and it existed), `0` otherwise — the ownership gate for the
 * service-level cascade.
 */
export const deleteThread = async (userId: string, threadId: string): Promise<number> => {
	const result = await threads().deleteOne({ userId, threadId });
	return result.deletedCount;
};

// -----------------------------------------------------------------------------
// Threads: reads
// -----------------------------------------------------------------------------

/**
 * Lists a user's threads, most-recently-updated first, cursor-paginated on
 * `updatedAt`. Reads straight from the `threads` snapshot — no aggregation,
 * one indexed scan against `(userId, updatedAt)`.
 */
export const getThreads = async (
	userId: string,
	limit: number,
	before?: string,
): Promise<ThreadsPage> => {
	const query: Document = { userId };
	if (before) query.updatedAt = { $lt: new Date(before) };

	const docs = await threads()
		.find(query)
		.sort({ updatedAt: -1 })
		.limit(limit + 1)
		.toArray();

	const hasMore = docs.length > limit;
	const page = hasMore ? docs.slice(0, limit) : docs;
	const oldest = page.at(-1);

	const summaries: ThreadSummary[] = page.map((doc) => ({
		threadId: doc.threadId,
		lastMessage: doc.lastMessage,
		messageCount: doc.messageCount,
		updatedAt: doc.updatedAt.toISOString(),
	}));

	return {
		threads: summaries,
		hasMore,
		nextBefore: hasMore && oldest ? oldest.updatedAt.toISOString() : null,
	};
};
