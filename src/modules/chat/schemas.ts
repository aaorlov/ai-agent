import { z } from "zod";
import { MessagePartType, MessageRole, ToolActionResult } from "@/common/enums";

// Vercel AI SDK useChat sends { messages: UIMessage[] }
const MessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(MessagePartType.Text), text: z.string() }),
  z.object({
    type: z.literal(MessagePartType.ToolInvocation),
    toolCallId: z.string(),
    toolName: z.string(),
    state: z.string().optional(),
    args: z.unknown().optional(),
    result: z.unknown().optional()
  }),
  z.object({
    type: z.literal(MessagePartType.ToolResult),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    action: z.enum(ToolActionResult).optional(), // Flag to distinguish simple results from user approvals
  })
]);

export const UIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(MessageRole),
  content: z.string(),
  parts: z.array(MessagePartSchema).optional().default([]),
});

/** Request body for POST /chat: message and optional thread_id (omit for new thread) */
export const ChatRequestSchema = z.object({
  threadId: z.string().optional(),
  messages: z.array(UIMessageSchema),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type UIMessage = z.infer<typeof UIMessageSchema>;