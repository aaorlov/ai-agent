import type { HonoRequest } from "hono";

import { HttpStatus } from "@/common/enums";
import { HttpError } from "@/common/errors";

const USER_ID_HEADER = "x-user-id";

/**
 * Pulls the caller's user id from the `x-user-id` request header. The header
 * is the contract between the gateway/auth layer and this service; missing
 * or empty values are treated as unauthenticated and rejected at the edge.
 */
export const resolveUserId = (req: HonoRequest): string => {
	const userId = req.header(USER_ID_HEADER)?.trim();
	if (!userId) {
		throw new HttpError(HttpStatus.Unauthorized, "Missing user identity");
	}
	return userId;
};
