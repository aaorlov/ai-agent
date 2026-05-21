import type { SSEStreamingApi } from "hono/streaming";

import type { ThreadRequest } from "./dto/request.dto";
import { FinishReason, SSEEventType } from "./enums";
import { streamThreadEvents } from "./service";
import { sseEventToMessage } from "./utils";

/**
 * SSE protocol adapter: mints a threadId when missing (announcing it to the
 * client as a `session` event), then forwards each event yielded by the
 * service to the wire. Aborts collapse to a terminal `Finish(Abort)`.
 */
export const handleThreadStream = async (
	userId: string,
	body: ThreadRequest,
	stream: SSEStreamingApi,
	signal: AbortSignal,
): Promise<void> => {
	const threadId = body.threadId ?? crypto.randomUUID();

	if (!body.threadId) {
		await stream.writeSSE(sseEventToMessage({ type: SSEEventType.Session, threadId }));
	}

	for await (const event of streamThreadEvents(userId, body, threadId, signal)) {
		if (signal.aborted) {
			await stream.writeSSE(
				sseEventToMessage({
					type: SSEEventType.Finish,
					finishReason: FinishReason.Abort,
				}),
			);
			break;
		}
		await stream.writeSSE(sseEventToMessage(event));
	}
};
