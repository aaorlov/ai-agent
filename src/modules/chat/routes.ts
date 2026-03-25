import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute, validator as zValidator } from "hono-openapi";

import { ChatRequestSchema } from "./schemas";
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
    return streamSSE(
      c,
      async (stream) =>
        await handleChatStream(body, stream, c.req.raw.signal)
    );
  }
);

export { chat };
