import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AppError";
	}
}

export class ConfigError extends AppError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ConfigError";
	}
}

export class HttpError extends AppError {
	constructor(
		public readonly status: ContentfulStatusCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "HttpError";
	}
}

export const toErrorMessage = (error: unknown): string => 
	error instanceof Error ? error.message : "Unknown error";
