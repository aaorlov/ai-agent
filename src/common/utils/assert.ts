import { AppError } from "@/common/errors";

/**
 * Narrows `T | undefined` to `T`, throwing `AppError(message)` when the value
 * is `undefined`. Use at boundaries where a missing value indicates a bug or
 * an invariant violation rather than a user-recoverable error.
 */
export const requireField = <T>(value: T | undefined, message: string): T => {
	if (value === undefined) throw new AppError(message);
	return value;
};
