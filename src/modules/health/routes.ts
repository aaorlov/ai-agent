import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { HttpStatus } from "@/common/enums";

import { HealthStatus } from "./enums";
import { DetailedHealthResponseSchema, type HealthChecks, HealthResponseSchema } from "./schemas";

const health = new Hono();

const isAllHealthy = (checks: HealthChecks): boolean =>
	Object.values(checks).every((status) => status === HealthStatus.Healthy);

health.get(
	"/",
	describeRoute({
		operationId: "healthCheck",
		tags: ["Health"],
		summary: "Health check",
		description: "Basic health check endpoint",
		responses: {
			200: {
				description: "Service is healthy",
				content: {
					"application/json": { schema: resolver(HealthResponseSchema) },
				},
			},
		},
	}),
	(c) =>
		c.json(
			{
				status: HealthStatus.Healthy,
				timestamp: new Date().toISOString(),
			},
			HttpStatus.OK,
		),
);

health.get(
	"/detailed",
	describeRoute({
		operationId: "detailedHealthCheck",
		tags: ["Health"],
		summary: "Detailed health check",
		description: "Detailed health check with integrations status",
		responses: {
			200: {
				description: "All systems healthy",
				content: {
					"application/json": {
						schema: resolver(DetailedHealthResponseSchema),
					},
				},
			},
			503: {
				description: "Service unhealthy",
				content: {
					"application/json": {
						schema: resolver(DetailedHealthResponseSchema),
					},
				},
			},
		},
	}),
	(c) => {
		const checks: HealthChecks = { server: HealthStatus.Healthy };
		const healthy = isAllHealthy(checks);
		return c.json(
			{
				status: healthy ? HealthStatus.Healthy : HealthStatus.Unhealthy,
				checks,
				timestamp: new Date().toISOString(),
			},
			healthy ? HttpStatus.OK : HttpStatus.ServiceUnavailable,
		);
	},
);

export { health };
