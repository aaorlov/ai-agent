import type { SSEEvent } from "./events";

export const sseEventToMessage = (ev: SSEEvent): { data: string } => ({
  data: JSON.stringify(ev),
});
