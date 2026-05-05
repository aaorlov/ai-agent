import { z } from "zod";

import { DEFAULT_PORT, ENV_FILE } from "./common/constants";
import { Environment } from "./common/enums";
import { ConfigError } from "./common/errors";

const envSchema = z.object({
	ENV: z.enum(Environment).default(Environment.DEV),
	PORT: z
		.string()
		.default(String(DEFAULT_PORT))
		.transform((value) => Number.parseInt(value, 10))
		.pipe(z.number().positive()),
	ANTHROPIC_API_KEY: z.string().min(1),
	ANTHROPIC_MODEL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

const isDevRuntime = (): boolean =>
	!process.env.ENV || process.env.ENV === Environment.DEV;

const parseDotEnvLine = (
	line: string,
): readonly [string, string] | undefined => {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return undefined;
	const eqIndex = trimmed.indexOf("=");
	if (eqIndex <= 0) return undefined;
	const key = trimmed.slice(0, eqIndex).trim();
	const value = trimmed.slice(eqIndex + 1).replace(/^["']|["']$/g, "");
	return [key, value];
};

const loadDotEnv = async (): Promise<void> => {
	const file = Bun.file(ENV_FILE);
	if (!(await file.exists())) return;
	const text = await file.text();
	for (const line of text.split("\n")) {
		const entry = parseDotEnvLine(line);
		if (!entry) continue;
		const [key, value] = entry;
		// System/runtime env takes precedence over .env file values.
		if (process.env[key] === undefined) process.env[key] = value;
	}
};

const parseEnv = (): Env => {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		throw new ConfigError(
			`Invalid environment variables: ${JSON.stringify(z.treeifyError(result.error))}`,
		);
	}
	return result.data;
};

if (isDevRuntime()) await loadDotEnv();

export const env = parseEnv();
