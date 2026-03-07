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
import { AgentStatusPhase, MessageRole, ToolActionResult } from "./enums.js";

const checkpointer = new MemorySaver();

/**
 * Plan node: set status to planning/thinking (stub; replace with LLM when needed).
 */
async function plan(state: AgentState): Promise<Partial<AgentState>> {
  return {
    status: AgentStatusPhase.Planning,
    textDelta: "",
  };
}

/**
 * After planning, move to "thinking" then hand off to execute_tool.
 */
async function thinking(state: AgentState): Promise<Partial<AgentState>> {
  return { status: AgentStatusPhase.Thinking };
}

/**
 * Execute tool node: sets status, pendingTool, and adds an assistant message
 * with the tool invocation (approval requested). Messages are the source of truth:
 * when the user reopens the thread, this message is in the thread so the UI
 * can show the pending approval without relying on pendingTool alone.
 */
async function executeTool(state: AgentState): Promise<Partial<AgentState>> {
  const toolCallId = crypto.randomUUID();
  const toolName = "example_approval_tool";
  const args = { message: "Executing tool" };

  return {
    status: AgentStatusPhase.Executing,
    pendingTool: { toolCallId, toolName, args },
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content: "",
        toolCallId,
        toolName,
        args,
      },
    ],
  };
}

/**
 * Node that triggers interrupt for approval. When resumed, interrupt() returns the resume value.
 * Appends a Tool-role message with the result/action so the thread has: assistant (invocation) → tool (result).
 */
async function requestApproval(state: AgentState): Promise<Partial<AgentState>> {
  const pending = state.pendingTool;
  if (!pending) {
    return { status: null, pendingTool: null };
  }
  const resumeValue = interrupt({
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    args: pending.args,
  }) as AgentResume | undefined;
  return {
    status: AgentStatusPhase.ToolResult,
    pendingTool: null,
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Tool,
        content: "",
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        result: resumeValue?.result,
        action: resumeValue?.action ?? ToolActionResult.Approved,
      },
    ],
  };
}

/**
 * Respond node: clear status, produce final assistant message (stub).
 */
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

/**
 * Get current state for a thread (from MemorySaver checkpoint).
 * Returns empty values when the thread has no checkpoint yet.
 */
export async function getThreadState(threadId: string): Promise<{
  values: Partial<AgentState>;
}> {
  const config = { configurable: { thread_id: threadId } };
  try {
    const snapshot = await agentGraph.getState(config);
    return { values: snapshot.values ?? {} };
  } catch {
    return { values: {} };
  }
}

/**
 * Build run input for the graph: either initial state update or Command to resume.
 */
export function toGraphInput(input: AgentRunInput): Record<string, unknown> | Command {
  if (input.resume) {
    return new Command({
      resume: input.resume,
    });
  }
  return {
    messages: input.messages,
    status: null,
    pendingTool: null,
  };
}

/**
 * Stream agent run. Yields state updates (streamMode: "updates").
 * Use same threadId and optional resume to continue after an interrupt.
 */
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
