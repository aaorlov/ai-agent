import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";

import { OPENAPI, SERVER } from "./common/constants";
import { Routes } from "./common/enums";
import { env } from "./config";

const buildDocumentation = () => ({
	openapi: OPENAPI.version,
	info: {
		title: SERVER.name,
		version: SERVER.version,
		description: SERVER.description,
		contact: OPENAPI.contact,
		license: OPENAPI.license,
	},
	servers: [
		{
			url: `http://localhost:${env.PORT}`,
			description: "Local development server",
		},
	],
	tags: OPENAPI.tags,
});

export const mountOpenApi = (app: Hono): void => {
	app.get(Routes.OpenApi, openAPIRouteHandler(app, { documentation: buildDocumentation() }));

	app.get(
		Routes.Docs,
		Scalar({
			url: Routes.OpenApi,
			theme: OPENAPI.docsTheme,
			pageTitle: SERVER.name,
		}),
	);
};
