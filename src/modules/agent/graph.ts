import { END, type GraphRunStream, START, StateGraph } from "@langchain/langgraph";

import { AgentNode } from "./enums";
import {
	callModel,
	executeTool,
	requestApproval,
	routeAfterCallModel,
	routeAfterRequestApproval,
} from "./nodes";
import { type AgentState, AgentStateAnnotation } from "./state";
import { checkpointer, store } from "./store";
import type { AgentRunInput } from "./types";
import { toGraphInput } from "./utils";

const workflow = new StateGraph(AgentStateAnnotation)
	.addNode(AgentNode.CallModel, callModel)
	.addNode(AgentNode.ExecuteTool, executeTool)
	.addNode(AgentNode.RequestApproval, requestApproval)
	.addEdge(START, AgentNode.CallModel)
	.addConditionalEdges(AgentNode.CallModel, routeAfterCallModel, [
		AgentNode.RequestApproval,
		AgentNode.ExecuteTool,
		END,
	])
	.addConditionalEdges(AgentNode.RequestApproval, routeAfterRequestApproval, [
		AgentNode.RequestApproval,
		AgentNode.ExecuteTool,
	])
	.addEdge(AgentNode.ExecuteTool, AgentNode.CallModel);

export const agentGraph = workflow.compile({ checkpointer, store });

export type AgentGraph = typeof agentGraph;

/**
 * Starts a run on the agent graph and returns the raw v3 protocol stream
 * (a `GraphRunStream`). Consumers iterate `ProtocolEvent`s and decide which
 * channels to react to (`updates`, `messages`, `lifecycle`, `tools`, …) or
 * use the higher-level projections (`run.values`, `run.messages`, `run.output`).
 */
export const streamAgent = (
	input: AgentRunInput,
	options: { signal?: AbortSignal },
): Promise<GraphRunStream<AgentState>> => {
	// langgraph's `Command` has a generic shape that doesn't infer against the
	// narrowly-typed AgentStateAnnotation channels. Cast at the boundary only.
	const graphInput = toGraphInput(input) as Parameters<AgentGraph["streamEvents"]>[0];
	return agentGraph.streamEvents(graphInput, {
		version: "v3",
		configurable: { thread_id: input.threadId },
		context: { userId: input.userId },
		signal: options.signal,
	});
};
