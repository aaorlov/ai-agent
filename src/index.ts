import { app } from "./app";
import { SERVER } from "./common/constants";
import { mongoService } from "./common/db";
import { toErrorMessage } from "./common/errors";
import { logger } from "./common/utils";
import { env } from "./config";
import { initAgent } from "./modules/agent";
import { initThreads } from "./modules/threads";

interface RuntimeInfo {
	readonly name: string;
	readonly version: string;
}

const detectRuntime = (): RuntimeInfo => {
	if (typeof Bun !== "undefined") {
		return { name: "Bun", version: Bun.version };
	}
	if (typeof process !== "undefined" && process.versions?.node) {
		return { name: "Node.js", version: process.versions.node };
	}
	return { name: "Unknown", version: "unknown" };
};

const runtime = detectRuntime();

logger.info("Server starting", {
	service: SERVER.name,
	version: SERVER.version,
	port: env.PORT,
	env: env.ENV,
	runtime: `${runtime.name} ${runtime.version}`,
});

await mongoService.connect();
await Promise.all([initAgent(), initThreads()]);

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

const shutdown = async (signal: string): Promise<void> => {
	logger.info("Server shutting down", { signal });
	try {
		await mongoService.disconnect();
	} catch (error) {
		logger.error("Failed to disconnect MongoDB", { error: toErrorMessage(error) });
	}
	process.exit(0);
};

for (const signal of SHUTDOWN_SIGNALS) {
	process.on(signal, () => {
		void shutdown(signal);
	});
}

export default {
	port: env.PORT,
	fetch(request: Request) {
		return app.fetch(request);
	},
};
