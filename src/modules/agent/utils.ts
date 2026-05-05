import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

import { MessageRole } from "./enums";
import type { AgentMessage, AgentRunInput } from "./types";


export const toLangChainMessage = (message: AgentMessage): BaseMessage => {
	switch (message.role) {
		case MessageRole.Human:
			return new HumanMessage({ content: message.content });
		case MessageRole.System:
			return new SystemMessage({ content: message.content });
		case MessageRole.Assistant:
			return new AIMessage({
				content: message.content,
				tool_calls: message.toolCalls?.map((toolCall) => ({
					id: toolCall.toolCallId,
					name: toolCall.toolName,
					args: toolCall.args,
				})),
			});
		case MessageRole.Tool:
			return new ToolMessage({
				content: typeof message.result === "string" ? message.result : JSON.stringify(message.result),
				tool_call_id: message.toolCallId,
				name: message.toolName,
			});
	}
};

export interface GraphInvocation {
	messages: AgentMessage[];
	pendingTools: never[];
}

export const toGraphInput = (input: AgentRunInput): GraphInvocation | Command => {
	if (input.resume) {
		return new Command({ resume: input.resume });
	}
	return {
		messages: input.messages,
		pendingTools: [],
	};
};