import type { LangGraphRunnableConfig } from "@langchain/langgraph";

import { toErrorMessage } from "@/common/errors";
import { logger } from "@/common/utils";

import { MessageRole, ToolAction } from "../enums";
import { TOOLS_BY_NAME } from "../tools";
import type { ToolCall, ToolMessage } from "../types";

/**
 * Invokes a registered tool with the given args/config and produces a
 * `ToolMessage` regardless of outcome (unknown tool, thrown error, or
 * successful execution). Shared by `executeTool` and `requestApproval`.
 */
export const runTool = async (
	call: Pick<ToolCall, "toolCallId" | "toolName" | "args">,
	config: LangGraphRunnableConfig,
): Promise<ToolMessage> => {
	const base = {
		id: crypto.randomUUID(),
		role: MessageRole.Tool as const,
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		createdAt: new Date().toISOString(),
	};

	const tool = TOOLS_BY_NAME.get(call.toolName);
	if (!tool) {
		const error = `Unknown tool: ${call.toolName}`;
		logger.warn("Tool not found", { toolName: call.toolName });
		return { ...base, result: error, action: ToolAction.Error, error };
	}

	try {
		const result = await tool.invoke(call.args, config);
		return { ...base, result, action: ToolAction.Executed };
	} catch (err) {
		const error = toErrorMessage(err);
		logger.warn("Tool execution failed", { toolName: call.toolName, error });
		return { ...base, result: error, action: ToolAction.Error, error };
	}
};
