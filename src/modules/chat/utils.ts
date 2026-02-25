import type { SSEEvent } from "./sse.js";

/** Map SSEEvent (discriminated by `type`) to SSE envelope: data = full payload JSON string. */
export const sseEventToMessage = (ev: SSEEvent): { data: string } => ({
  data: JSON.stringify(ev),
});
