import { z } from "zod";

// Request schema for chat messages
export const ChatMessageSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
  sessionId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

// Response schema for agent responses
export const AgentResponseSchema = z.object({
  content: z.string(),
  sessionId: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

// Stream event schema
export const StreamEventSchema = z.object({
  type: z.enum(["message", "error", "done", "metadata"]),
  data: z.unknown(),
  sessionId: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
