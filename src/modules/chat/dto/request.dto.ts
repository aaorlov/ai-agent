import { z } from "zod";
import { ToolAction } from "@/modules/agent/enums";
import { ChatRequestType } from "../enums";

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

const RetrySchema = z.object({
	type: z.literal(ChatRequestType.Retry),
	threadId: z.string(),
});

export const ChatRequestSchema = z.discriminatedUnion("type", [
	SendMessageSchema,
	ToolActionSchema,
	RetrySchema,
]);

export const ThreadIdParamSchema = z.object({
	threadId: z.uuid(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export type ToolActionRequest = z.infer<typeof ToolActionSchema>;
export type RetryRequest = z.infer<typeof RetrySchema>;
export type ThreadIdParam = z.infer<typeof ThreadIdParamSchema>;
