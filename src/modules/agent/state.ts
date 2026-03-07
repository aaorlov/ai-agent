import {
  StateGraph,
  END,
  START,
  interrupt,
  Command,
  MemorySaver,
} from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { AgentNode, AgentStatusPhase } from "./enums.js";
import type { AgentState, AgentContext } from "./types.js";

export { Command, MemorySaver };
export type { AgentState, AgentContext } from "./types.js";
export { AgentNode, AgentStatusPhase, type ToolActionResult } from "./enums.js";

// Simple agent node (non-interruptible graph)
async function agentNode(state: AgentState): Promise<Partial<AgentState>> {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  const response = `I received your message: "${lastMessage.content}". This is a placeholder response.`;
  return {
    messages: [...messages, new AIMessage(response)],
    context: {
      ...state.context,
      status: { phase: AgentStatusPhase.Thinking, message: "Thinking" },
    },
  };
}

/** Simple graph: single agent node. Use for flows that don't require approval. */
export function createAgentGraph() {
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      sessionId: {
        reducer: (x: string, y: string) => y || x,
        default: () => crypto.randomUUID(),
      },
      context: {
        reducer: (
          x: AgentContext | undefined,
          y: AgentContext | undefined
        ): AgentContext | undefined =>
          y ? { ...(x || {}), ...y } : x,
        default: () => ({}),
      },
    },
  });

  workflow.addNode(AgentNode.Agent as "agent", agentNode);
  workflow.addEdge(START, AgentNode.Agent as "agent");
  workflow.addEdge(AgentNode.Agent as "agent", END);

  return workflow.compile();
}

const APPROVAL_WAIT_MS = 60_000;

/** Interruptible graph: Plan -> Propose (interrupt) -> Apply. Use with checkpointer + thread_id. */
export function createInterruptibleGraph(
  checkpointer: InstanceType<typeof MemorySaver>
) {
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      sessionId: {
        reducer: (x: string, y: string) => y || x,
        default: () => crypto.randomUUID(),
      },
      context: {
        reducer: (
          x: AgentContext | undefined,
          y: AgentContext | undefined
        ): AgentContext | undefined =>
          y ? { ...(x || {}), ...y } : x,
        default: () => ({}),
      },
    },
  });

  async function planNode(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    const toolCallId = `propose-${state.sessionId}-${Date.now()}`;
    const toolName = "apply_edit";
    const args = { diff: "(placeholder diff - replace with real proposal)" };
    return {
      messages: [
        ...state.messages,
        new AIMessage(`I will edit the file based on: "${lastMessage.content}"`),
      ],
      context: {
        ...state.context,
        plan: "edit_file",
        approvalRequest: {
          toolCallId,
          toolName,
          args,
          question: "Approve this change?",
          diff: "(placeholder diff - replace with real proposal)",
        },
        status: {
          phase: AgentStatusPhase.Planning,
          message: "Planning",
        },
      },
    };
  }

  async function proposeNode(state: AgentState): Promise<Partial<AgentState>> {
    const approvalRequest = state.context?.approvalRequest;
    const approvalPayload = approvalRequest
      ? {
          question: approvalRequest.question,
          diff: approvalRequest.diff,
          toolCallId: approvalRequest.toolCallId,
          toolName: approvalRequest.toolName,
          args: approvalRequest.args,
        }
      : { question: "Approve this change?", diff: "(placeholder)" };
    const resume = interrupt(approvalPayload) as
      | { approved?: boolean; skipped?: boolean }
      | boolean;
    const ok =
      typeof resume === "object" && resume !== null && "approved" in resume
        ? (resume as { approved: boolean }).approved
        : Boolean(resume);
    const skipped =
      typeof resume === "object" &&
      resume !== null &&
      "skipped" in resume &&
      (resume as { skipped: boolean }).skipped;
    return {
      messages: [
        ...state.messages,
        new AIMessage(
          ok ? "Applying changes..." : skipped ? "Skipped." : "Change cancelled."
        ),
      ],
      context: {
        ...state.context,
        approvalRequest: undefined,
        approved: ok,
        status: {
          phase: AgentStatusPhase.Executing,
          message: ok ? "Applying" : skipped ? "Skipped" : "Cancelling",
        },
      },
    };
  }

  async function applyNode(state: AgentState): Promise<Partial<AgentState>> {
    const approved = (state.context?.approved as boolean) ?? false;
    return {
      messages: [
        ...state.messages,
        new AIMessage(
          approved ? "Done. Changes applied." : "No changes made."
        ),
      ],
      context: {
        ...state.context,
        status: {
          phase: AgentStatusPhase.Idle,
          message: approved ? "Done" : "No changes",
        },
      },
    };
  }

  workflow.addNode(AgentNode.Plan as "plan", planNode);
  workflow.addNode(AgentNode.Propose as "propose", proposeNode);
  workflow.addNode(AgentNode.Apply as "apply", applyNode);
  workflow.addEdge(START, AgentNode.Plan as "plan");
  workflow.addEdge(AgentNode.Plan as "plan", AgentNode.Propose as "propose");
  workflow.addEdge(AgentNode.Propose as "propose", AgentNode.Apply as "apply");
  workflow.addEdge(AgentNode.Apply as "apply", END);

  return workflow.compile({ checkpointer });
}

export { APPROVAL_WAIT_MS };
