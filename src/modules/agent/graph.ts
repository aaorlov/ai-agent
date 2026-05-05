import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { StreamMode } from "./enums";
import { callModel } from "./nodes";
import { type AgentState, AgentStateAnnotation } from "./state";
import type { AgentRunInput, AgentStreamEvent } from "./types";
import { toGraphInput } from "./utils";

const STREAM_MODES = [StreamMode.Updates, StreamMode.Custom];

const checkpointer = new MemorySaver();

const workflow = new StateGraph(AgentStateAnnotation)
	.addNode("call_model", callModel)
	.addEdge(START, "call_model")
	.addEdge("call_model", END);

export const agentGraph = workflow.compile({ checkpointer });

export type AgentGraph = typeof agentGraph;

export const getThreadState = async (
	threadId: string,
): Promise<{ values: Partial<AgentState> }> => {
	const config = { configurable: { thread_id: threadId } };
	try {
		const snapshot = await agentGraph.getState(config);
		return { values: snapshot.values ?? {} };
	} catch {
		return { values: {} };
	}
};

export async function* streamAgent(
	input: AgentRunInput,
	options: { signal?: AbortSignal },
): AsyncGenerator<AgentStreamEvent> {
	// langgraph's `Command` has a generic shape that doesn't infer against the
	// narrowly-typed AgentStateAnnotation channels. Cast at the boundary only.
	const graphInput = toGraphInput(input) as Parameters<AgentGraph["stream"]>[0];
	const stream = await agentGraph.stream(graphInput, {
		configurable: { thread_id: input.threadId },
		signal: options.signal,
		streamMode: STREAM_MODES,
	});

  for await (const [mode, data] of stream) {
    yield { mode: mode as StreamMode, data }
  }
}
