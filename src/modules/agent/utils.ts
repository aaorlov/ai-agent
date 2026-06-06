import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

import { MessageRole } from "./enums";
import type { Plan } from "./tools/manage-plan";
import type { AgentMessage, HumanMessage as HumanAgentMessage, AgentRunInput } from "./types";

/** Factory for a freshly-stamped human turn message. */
export const newHumanMessage = (content: string): HumanAgentMessage => ({
	id: crypto.randomUUID(),
	role: MessageRole.Human,
	content,
	createdAt: new Date().toISOString(),
});

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
	plan?: Plan | null;
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
 * - default -> partial state with `messages` to append. The caller decides
 *   whether the array is just the new turn input or also includes restored
 *   history (when no checkpoint exists). When reseeding, the caller may also
 *   pass `plan` so the graph picks up the last known plan; otherwise the
 *   channel keeps its current value (the reducer treats `undefined` as
 *   no-op).
 */
export const toGraphInput = (input: AgentRunInput): GraphInvocation | Command | null => {
	if (input.retry) return null;
	if (input.resume) return new Command({ resume: input.resume });
	return {
		messages: input.messages,
		pendingTools: [],
		...(input.plan !== undefined ? { plan: input.plan } : {}),
	};
};