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

/**
 * Maps an `AgentRunInput` to the value passed to `graph.stream`.
 *
 * - `retry` -> `null`: LangGraph convention to resume the thread from its last
 *   committed checkpoint without mutating state. The failed super-step's
 *   uncommitted writes were dropped, so the failing node re-executes from its
 *   prior input.
 * - `resume` -> `Command({ resume })`: provides the human-in-the-loop value to
 *   an `interrupt()` call.
 * - default -> initial state with appended messages.
 */
export const toGraphInput = (input: AgentRunInput): GraphInvocation | Command | null => {
	if (input.retry) return null;
	if (input.resume) return new Command({ resume: input.resume });
	return {
		messages: [...(input.hydrationMessages ?? []), ...input.messages],
		pendingTools: [],
	};
};