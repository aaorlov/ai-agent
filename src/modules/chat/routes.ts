import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { ChatRequestSchema } from "./schemas";
import { validationError } from "@/common/utils";
import { resolveChatTrigger, handleChatStream } from "./sse";

const chat = new Hono();

/** POST /chat — SSE chat (LangGraph + Vercel AI SDK). Supports new message or task approval/rejection via body.messages. */
chat.post(
  "/",
  zValidator("json", ChatRequestSchema, (result, c) => {
    if (!result.success) return validationError(result, c);
  }),
  async (c) => {
    const body = c.req.valid("json");
    return streamSSE(c, async (stream) => await handleChatStream(body, stream, c.req.raw.signal));
  }
);

export { chat };
