import { z } from "zod";
import { ToolAction } from "@/modules/agent/enums";

export enum ChatRequestType {
  Message = "message",
  ToolAction = "tool_action",
}

const SendMessageSchema = z.object({
  type: z.literal(ChatRequestType.Message),
  threadId: z.string().optional(),
  content: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
});

const ToolActionSchema = z.object({
  type: z.literal(ChatRequestType.ToolAction),
  threadId: z.string(),
  toolCallId: z.string(),
  action: z.enum(ToolAction),
  modifiedArgs: z.record(z.string(), z.unknown()).optional(),
});

export const ChatRequestSchema = z.discriminatedUnion("type", [
  SendMessageSchema,
  ToolActionSchema,
]);

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export type ToolActionRequest = z.infer<typeof ToolActionSchema>;
