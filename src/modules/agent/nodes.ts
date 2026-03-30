import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, BaseMessage, AIMessageChunk } from "@langchain/core/messages";
import { interrupt, LangGraphRunnableConfig } from "@langchain/langgraph";
import { concat } from '@langchain/core/utils/stream';
import { AgentState } from "./state";
import { AgentResume } from "./types";
import { CustomEventType, MessageRole, ToolAction } from "./enums";
import { env } from "@/config";
import { toLC } from "./utils";

const llm = new ChatAnthropic({
  model: env.ANTROPIC_MODEL,
  apiKey: env.ANTROPIC_API_KEY,
});

export const callModel = async (state: AgentState, config: LangGraphRunnableConfig): Promise<Partial<AgentState>> => {
  const messages: BaseMessage[] = [];

  if (state.systemPrompt) {
    messages.push(new SystemMessage({ content: state.systemPrompt }));
  }

  for (const m of state.messages) {
    messages.push(toLC(m));
  }

  let fullMessage: AIMessageChunk | undefined;
  const llmStream = await llm.stream(messages);
  for await (const chunk of llmStream) {
    fullMessage = fullMessage ? concat(fullMessage, chunk) : chunk;

    if(chunk.content) config.writer?.({ type: CustomEventType.TextDelta, content: chunk.content, messageId: fullMessage.id });
  }

  const content = typeof fullMessage?.content === "string" ? fullMessage.content : fullMessage ? JSON.stringify(fullMessage.content) : "";
  
  return {
    messages: [
      {
        id: fullMessage?.id ?? crypto.randomUUID(),
        role: MessageRole.Assistant,
        content,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Stub: creates an assistant message with a tool call that requires approval.
 * Replace with real LLM + tool-binding logic.
 */
export async function executeTool(
  state: AgentState
): Promise<Partial<AgentState>> {
  const toolCallId = crypto.randomUUID();
  const toolName = "example_approval_tool";
  const args = { message: "Executing tool" };

  return {
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Assistant,
        content: "",
        toolCalls: [{ toolCallId, toolName, args, requiresApproval: true }],
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Interrupt for human approval, then append a ToolMessage with the resolution.
 */
export async function requestApproval(
  state: AgentState
): Promise<Partial<AgentState>> {
  const pending = state.pendingTools;
  const tool = pending[0];
  const resumeValue = interrupt({
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    args: tool.args,
  }) as AgentResume | undefined;

  return {
    pendingTools: [],
    messages: [
      {
        id: crypto.randomUUID(),
        role: MessageRole.Tool,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        result: resumeValue?.modifiedArgs ?? {},
        action: resumeValue?.action ?? ToolAction.Approved,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
