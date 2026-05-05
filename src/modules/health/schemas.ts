import { z } from "zod";

import { HealthStatus } from "./enums";

export const HealthResponseSchema = z.object({
	status: z.enum(HealthStatus),
	timestamp: z.string(),
});

export const HealthChecksSchema = z.object({
	server: z.enum(HealthStatus),
});

export const DetailedHealthResponseSchema = z.object({
	status: z.enum(HealthStatus),
	checks: HealthChecksSchema,
	timestamp: z.string(),
});

export type HealthChecks = z.infer<typeof HealthChecksSchema>;
