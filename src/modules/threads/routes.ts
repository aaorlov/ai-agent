import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute, validator as zValidator } from "hono-openapi";

import { HttpStatus } from "@/common/enums";
import { resolveUserId } from "@/common/utils";

import {
	ThreadIdParamSchema,
	ThreadMessagesQuerySchema,
	ThreadRequestSchema,
	ThreadsQuerySchema,
} from "./dto/request.dto";
import { deleteThread, listThreadMessages, listThreads } from "./service";
import { handleThreadStream } from "./sse";

const threads = new Hono();

threads.post(
	"/",
	describeRoute({
		operationId: "sendThreadMessage",
		tags: ["Threads"],
		summary: "Send thread message or tool action",
		description:
			"SSE thread endpoint. Accepts { type: 'message' } for new/continued messages or { type: 'tool_action' } for approval/cancel/skip decisions.",
		responses: {
			200: {
				description: "SSE stream of thread responses",
				content: {
					"text/event-stream": {
						schema: {
							type: "string",
							description: "Server-Sent Events stream",
						},
					},
				},
			},
		},
	}),
	zValidator("json", ThreadRequestSchema),
	async (c) => {
		const userId = resolveUserId(c.req);
		const body = c.req.valid("json");
		return streamSSE(c, async (stream) =>
			handleThreadStream(userId, body, stream, c.req.raw.signal),
		);
	},
);

threads.get(
	"/",
	describeRoute({
		operationId: "listThreads",
		tags: ["Threads"],
		summary: "List the user's threads (summaries)",
		description:
			"Cursor-paginated by `updatedAt`. Returns the latest message in each thread plus its total message count.",
		responses: {
			200: { description: "Threads page" },
		},
	}),
	zValidator("query", ThreadsQuerySchema),
	async (c) => {
		const userId = resolveUserId(c.req);
		const { limit, before } = c.req.valid("query");
		const page = await listThreads(userId, limit, before);
		return c.json(page, HttpStatus.OK);
	},
);

threads.get(
	"/:threadId/messages",
	describeRoute({
		operationId: "listThreadMessages",
		tags: ["Threads"],
		summary: "List messages of a thread (chronological)",
		description:
			"Cursor-paginated by `createdAt`. Use `before=<iso>` to load older pages when scrolling up.",
		responses: {
			200: { description: "Messages page" },
		},
	}),
	zValidator("param", ThreadIdParamSchema),
	zValidator("query", ThreadMessagesQuerySchema),
	async (c) => {
		const userId = resolveUserId(c.req);
		const { threadId } = c.req.valid("param");
		const { limit, before } = c.req.valid("query");
		const page = await listThreadMessages(userId, threadId, limit, before);
		return c.json(page, HttpStatus.OK);
	},
);

threads.delete(
	"/:threadId",
	describeRoute({
		operationId: "deleteThread",
		tags: ["Threads"],
		summary: "Delete a thread",
		description:
			"Deletes the thread for the calling user: persisted message history and the agent's checkpoint state. Only the thread's owner can delete it; non-owners receive 404 to avoid leaking existence.",
		responses: {
			204: { description: "Thread deleted" },
			400: { description: "Invalid thread id" },
			404: { description: "Thread not found" },
		},
	}),
	zValidator("param", ThreadIdParamSchema),
	async (c) => {
		const userId = resolveUserId(c.req);
		const { threadId } = c.req.valid("param");
		await deleteThread(userId, threadId);
		return c.body(null, HttpStatus.NoContent);
	},
);

export { threads };
