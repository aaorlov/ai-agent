import { ChatAnthropic } from "@langchain/anthropic";

import { env } from "@/config";

export const llm = new ChatAnthropic({
	model: env.ANTHROPIC_MODEL,
	apiKey: env.ANTHROPIC_API_KEY,
});
