import {
  StateGraph,
  MemorySaver,
  interrupt,
  Command,
  END,
  START,
} from "@langchain/langgraph";
import { AgentStateAnnotation, type AgentState } from "./state.js";
import type { AgentRunInput, AgentResume } from "./types.js";
import { AgentStatusPhase, MessageRole, ToolAction } from "./enums.js";

const checkpointer = new MemorySaver();

async function plan(state: AgentState): Promise<Partial<AgentState>> {
  return {
    status: AgentStatusPhase.Planning,
    textDelta: "",
  };
}

async function thinking(state: AgentState): Promise<Partial<AgentState>> {
  return { status: AgentStatusPhase.Thinking };
}

/**
 * Stub: creates an assistant message with a tool call that requires approval.
 * Replace with real LLM + tool-binding logic.
 */
async function executeTool(state: AgentState): Promise<Partial<AgentState>> {
  const toolCallId = crypto.randomUUID();
  const toolName = "example_approval_tool";
  const args = { message: "Executing tool" };

  return {
    status: AgentStatusPhase.Executing,
    pendingTools: [{ toolCallId, toolName, args, requiresApproval: true }],
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content: "",
        toolCalls: [{ toolCallId, toolName, args, requiresApproval: true }],
      },
    ],
  };
}

/**
 * Interrupt for human approval, then append a ToolMessage with the resolution.
 */
async function requestApproval(
  state: AgentState
): Promise<Partial<AgentState>> {
  const pending = state.pendingTools;
  if (!pending.length) {
    return { status: null, pendingTools: [] };
  }

  const tool = pending[0];
  const resumeValue = interrupt({
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    args: tool.args,
  }) as AgentResume | undefined;

  return {
    status: AgentStatusPhase.ToolResult,
    pendingTools: [],
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Tool,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        result: resumeValue?.modifiedArgs ?? {},
        action: resumeValue?.action ?? ToolAction.Approved,
      },
    ],
  };
}

async function respond(state: AgentState): Promise<Partial<AgentState>> {
  return {
    status: null,
    textDelta: "",
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content: "Response based on conversation and tool results.",
      },
    ],
  };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("plan", plan)
  .addNode("thinking", thinking)
  .addNode("execute_tool", executeTool)
  .addNode("request_approval", requestApproval)
  .addNode("respond", respond)
  .addEdge(START, "plan")
  .addEdge("plan", "thinking")
  .addEdge("thinking", "execute_tool")
  .addEdge("execute_tool", "request_approval")
  .addEdge("request_approval", "respond")
  .addEdge("respond", END);

export const agentGraph = workflow.compile({ checkpointer });

export type AgentGraph = typeof agentGraph;

export async function getThreadState(
  threadId: string
): Promise<{ values: Partial<AgentState> }> {
  const config = { configurable: { thread_id: threadId } };
  try {
    const snapshot = await agentGraph.getState(config);
    return { values: snapshot.values ?? {} };
  } catch {
    return { values: {} };
  }
}

export function toGraphInput(
  input: AgentRunInput
): Record<string, unknown> | Command {
  if (input.resume) {
    return new Command({ resume: input.resume });
  }
  return {
    messages: input.messages,
    status: null,
    pendingTools: [],
  };
}

export async function* streamAgent(
  input: AgentRunInput,
  options: { signal?: AbortSignal }
): AsyncGenerator<Record<string, Partial<AgentState>>> {
  const streamOptions = {
    configurable: { thread_id: input.threadId },
    signal: options.signal,
    streamMode: "updates" as const,
  };

  const graphInput = toGraphInput(input);
  const stream = await agentGraph.stream(graphInput, streamOptions);

  for await (const chunk of stream) {
    yield chunk as Record<string, Partial<AgentState>>;
  }
}
