import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoRequestLogger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { SERVER } from "./common/constants";
import { Environment, HttpStatus, Routes } from "./common/enums";
import { HttpError, toErrorMessage } from "./common/errors";
import { logger } from "./common/utils";
import { env } from "./config";
import { health } from "./modules/health";
import { threads } from "./modules/threads";
import { mountOpenApi } from "./openapi";

const app = new Hono();

app.use("*", honoRequestLogger());
if (env.ENV === Environment.DEV) app.use("*", prettyJSON());
app.use(cors());

app.onError((err, c) => {
	const message = toErrorMessage(err);
	logger.error("Request failed", {
		path: c.req.path,
		method: c.req.method,
		error: message,
	});

	if (err instanceof HttpError) {
		return c.json({ error: err.message }, err.status);
	}
	const exposedMessage = env.ENV === Environment.PROD ? "Internal Server Error" : message;
	return c.json({ error: exposedMessage }, HttpStatus.InternalServerError);
});

app.notFound((c) => c.json({ error: "Not Found", path: c.req.path }, HttpStatus.NotFound));

app.route(Routes.Health, health);
app.route(Routes.Threads, threads);

app.get(Routes.Root, (c) =>
	c.json({
		name: SERVER.name,
		version: SERVER.version,
		description: SERVER.description,
		endpoints: {
			health: Routes.Health,
			threads: `${Routes.Threads} (POST stream, GET history, DELETE)`,
			docs: Routes.Docs,
			openapi: Routes.OpenApi,
		},
	}),
);

mountOpenApi(app);

export { app };
