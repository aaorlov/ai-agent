import { END, START, StateGraph } from "@langchain/langgraph";

import { AgentNode, StreamMode } from "./enums";
import {
	callModel,
	executeTool,
	requestApproval,
	routeAfterCallModel,
	routeAfterRequestApproval,
} from "./nodes";
import { AgentStateAnnotation } from "./state";
import { checkpointer, store } from "./store";
import type { AgentRunInput, AgentStreamEvent } from "./types";
import { toGraphInput } from "./utils";

const STREAM_MODES = [StreamMode.Updates, StreamMode.Custom];

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

export async function* streamAgent(
	input: AgentRunInput,
	options: { signal?: AbortSignal },
): AsyncGenerator<AgentStreamEvent> {
	// langgraph's `Command` has a generic shape that doesn't infer against the
	// narrowly-typed AgentStateAnnotation channels. Cast at the boundary only.
	const graphInput = toGraphInput(input) as Parameters<AgentGraph["stream"]>[0];
	const stream = await agentGraph.stream(graphInput, {
		configurable: { thread_id: input.threadId },
		context: { userId: input.userId },
		signal: options.signal,
		streamMode: STREAM_MODES,
	});

  for await (const [mode, data] of stream) {
    yield { mode: mode as StreamMode, data }
  }
}
