import { ChatAnthropic } from "@langchain/anthropic";

import { env } from "@/config";

import { TOOLS } from "./tools";

const baseLlm = new ChatAnthropic({
	model: env.ANTHROPIC_MODEL,
	apiKey: env.ANTHROPIC_API_KEY,
});

export const llm = baseLlm.bindTools([...TOOLS]);
