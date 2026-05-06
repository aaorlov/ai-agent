import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute, validator as zValidator } from "hono-openapi";

import { HttpStatus } from "@/common/enums";
import { deleteThread } from "@/modules/agent";

import { ChatRequestSchema, ThreadIdParamSchema } from "./dto/request.dto";
import { handleChatStream } from "./sse";

const chat = new Hono();

chat.post(
	"/",
	describeRoute({
		operationId: "chat",
		tags: ["Chat"],
		summary: "Send chat message or tool action",
		description:
			"SSE chat endpoint. Accepts { type: 'message' } for new/continued messages or { type: 'tool_action' } for approval/cancel/skip decisions.",
		responses: {
			200: {
				description: "SSE stream of chat responses",
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
	zValidator("json", ChatRequestSchema),
	async (c) => {
		const body = c.req.valid("json");
		const userId = c.req.header("x-user-id") || '1';
		return streamSSE(c, async (stream) => handleChatStream(userId, body, stream, c.req.raw.signal));
	},
);

chat.delete(
	"/:threadId",
	describeRoute({
		operationId: "deleteChat",
		tags: ["Chat"],
		summary: "Delete a chat thread",
		description:
			"Removes all checkpoints and pending writes for the given thread id. Idempotent: 204 even if the thread does not exist.",
		responses: {
			204: { description: "Thread deleted (or did not exist)" },
			400: { description: "Invalid thread id" },
		},
	}),
	zValidator("param", ThreadIdParamSchema),
	async (c) => {
		const { threadId } = c.req.valid("param");
		await deleteThread(threadId);
		return c.body(null, HttpStatus.NoContent);
	},
);

export { chat };
