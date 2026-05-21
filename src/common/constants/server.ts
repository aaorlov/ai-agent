interface OpenApiTag {
	readonly name: string;
	readonly description: string;
}

interface OpenApiConfig {
	readonly version: string;
	readonly contact: { readonly name: string };
	readonly license: { readonly name: string };
	readonly tags: OpenApiTag[];
	readonly docsTheme: "purple";
}

export const SERVER = {
	name: "AI Agent API",
	version: "1.0.0",
	description: "AI Agent API",
};

export const OPENAPI: OpenApiConfig = {
	version: "3.1.0",
	contact: { name: "API Support" },
	license: { name: "MIT" },
	tags: [
		{ name: "Health", description: "Health check endpoints" },
		{ name: "Threads", description: "Thread streaming, history, and management" },
	],
	docsTheme: "purple",
};

export const DEFAULT_PORT = 8000;
export const ENV_FILE = ".env";