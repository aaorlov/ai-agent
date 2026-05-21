import { z } from "zod";

import { ToolAction } from "@/modules/agent/enums";

import {
	DEFAULT_PAGE_SIZE,
	DEFAULT_SUMMARY_PAGE_SIZE,
	MAX_PAGE_SIZE,
	MAX_SUMMARY_PAGE_SIZE,
} from "../constants";
import { ThreadRequestType } from "../enums";

const SendMessageSchema = z.object({
	type: z.literal(ThreadRequestType.Message),
	threadId: z.string().optional(),
	content: z.string().min(1),
	context: z.record(z.string(), z.unknown()).optional(),
});

const ToolActionSchema = z.object({
	type: z.literal(ThreadRequestType.ToolAction),
	threadId: z.string(),
	toolCallId: z.string(),
	action: z.enum(ToolAction),
	modifiedArgs: z.record(z.string(), z.unknown()).optional(),
});

const RetrySchema = z.object({
	type: z.literal(ThreadRequestType.Retry),
	threadId: z.string(),
});

export const ThreadRequestSchema = z.discriminatedUnion("type", [
	SendMessageSchema,
	ToolActionSchema,
	RetrySchema,
]);

export const ThreadIdParamSchema = z.object({
	threadId: z.uuid(),
});

export const ThreadMessagesQuerySchema = z.object({
	limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
	before: z.iso.datetime().optional(),
});

export const ThreadsQuerySchema = z.object({
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(MAX_SUMMARY_PAGE_SIZE)
		.default(DEFAULT_SUMMARY_PAGE_SIZE),
	before: z.iso.datetime().optional(),
});

export type ThreadRequest = z.infer<typeof ThreadRequestSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export type ToolActionRequest = z.infer<typeof ToolActionSchema>;
export type RetryRequest = z.infer<typeof RetrySchema>;
export type ThreadIdParam = z.infer<typeof ThreadIdParamSchema>;
export type ThreadMessagesQuery = z.infer<typeof ThreadMessagesQuerySchema>;
export type ThreadsQuery = z.infer<typeof ThreadsQuerySchema>;
