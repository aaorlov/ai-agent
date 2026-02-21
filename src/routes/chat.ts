import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ChatMessageSchema } from "../schemas.js";
import { createAgentGraph, processMessage } from "../agent.js";
import type { AgentState } from "../agent.js";
import { handleError } from "../middleware/error-handler.js";

const chat = new Hono();

// SSE endpoint for streaming agent responses
chat.post("/stream", async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = ChatMessageSchema.parse(body);

    const graph = createAgentGraph();
    const agentStream = processMessage(graph, validatedData);

    return streamSSE(c, async (stream) => {
      try {
        let sessionId = validatedData.sessionId || crypto.randomUUID();
        
        for await (const state of agentStream) {
          const currentState = state as AgentState;
          sessionId = currentState.sessionId || sessionId;
          
          const lastMessage = currentState.messages?.[currentState.messages.length - 1];
          
          if (lastMessage && "content" in lastMessage && typeof lastMessage.content === "string") {
            // Send message chunk
            await stream.writeSSE({
              data: JSON.stringify({
                type: "message",
                data: {
                  content: lastMessage.content,
                  sessionId: sessionId,
                },
                sessionId: sessionId,
              }),
            });
          }
        }

        // Send done event
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            data: { sessionId: sessionId },
            sessionId: sessionId,
          }),
        });
      } catch (error) {
        // Send error event
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            data: {
              message: error instanceof Error ? error.message : "Unknown error",
            },
            sessionId: validatedData.sessionId,
          }),
        });
      }
    });
  } catch (error) {
    return handleError(c, error);
  }
});

// Non-streaming chat endpoint (for compatibility)
chat.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = ChatMessageSchema.parse(body);

    const graph = createAgentGraph();
    const stream = processMessage(graph, validatedData);

    let finalState: AgentState | null = null;
    for await (const state of stream) {
      finalState = state as AgentState;
    }

    if (!finalState) {
      return c.json({ error: "No response from agent" }, 500);
    }

    const lastMessage = finalState.messages[finalState.messages.length - 1];

    return c.json({
      content: "content" in lastMessage ? lastMessage.content : "",
      sessionId: finalState.sessionId,
      metadata: finalState.context,
    });
  } catch (error) {
    return handleError(c, error);
  }
});

export { chat };
