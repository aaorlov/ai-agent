import { app } from "./app";
import { SERVER } from "./common/constants";
import { logger } from "./common/utils";
import { env } from "./config";

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

export default {
	port: env.PORT,
	fetch(request: Request) {
		return app.fetch(request);
	},
};
