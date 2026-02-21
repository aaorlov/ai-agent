# Prism Invest AI Agent

A Hono server with Zod validation and LangGraph integration for AI agent communication via SSE (Server-Sent Events).

## Features

- 🚀 **Hono** - Fast web framework for the Edge
- ✅ **Zod** - Type-safe schema validation
- 🤖 **LangGraph** - Agent workflow orchestration
- 📡 **SSE** - Real-time streaming communication
- 🔒 **TypeScript** - Full type safety

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable).

## API Endpoints

### Health Check
```
GET /health
```

### Stream Chat (SSE)
```
POST /api/chat/stream
Content-Type: application/json

{
  "message": "Hello, agent!",
  "sessionId": "optional-session-id",
  "context": { "optional": "context" }
}
```

The response will be streamed via SSE with events:
- `message` - Agent response chunks
- `done` - Stream completion
- `error` - Error occurred

### Non-Streaming Chat
```
POST /api/chat
Content-Type: application/json

{
  "message": "Hello, agent!",
  "sessionId": "optional-session-id",
  "context": { "optional": "context" }
}
```

Returns a complete response:
```json
{
  "content": "Agent response",
  "sessionId": "session-id",
  "metadata": {}
}
```

## Usage Example (Frontend)

```javascript
const eventSource = new EventSource('/api/chat/stream', {
  method: 'POST',
  body: JSON.stringify({
    message: 'Hello!',
    sessionId: 'my-session'
  })
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'message') {
    console.log('Agent:', data.data.content);
  } else if (data.type === 'done') {
    eventSource.close();
  }
};
```

Or using fetch with SSE:

```javascript
const response = await fetch('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello!' })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  // Process SSE chunk
}
```

## Project Structure

The server is organized in a modular architecture:

```
src/
├── index.ts              # Main server entry point
├── agent.ts              # LangGraph agent configuration
├── schemas.ts            # Zod validation schemas
├── middleware/           # Shared middleware
│   ├── cors.ts          # CORS configuration
│   ├── error-handler.ts # Error handling utilities
│   └── index.ts         # Middleware exports
└── routes/               # Route modules (split by entity)
    ├── health.ts        # Health check endpoints
    ├── chat.ts          # Chat endpoints
    └── index.ts         # Route exports
```

### Adding New Routes

To add a new entity/route module:

1. Create a new route file in `src/routes/`:
```typescript
// src/routes/example.ts
import { Hono } from "hono";

const example = new Hono();

example.get("/", (c) => {
  return c.json({ message: "Example route" });
});

export { example };
```

2. Mount it in `src/index.ts`:
```typescript
import { example } from "./routes/example.js";

app.route("/api/example", example);
```

3. Export it from `src/routes/index.ts` (optional, for convenience):
```typescript
export { example } from "./example.js";
```

## Customization

### Integrating Your LLM

Edit `src/agent.ts` to replace the placeholder agent logic with your actual LLM provider:

```typescript
import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({ modelName: "gpt-4" });

async function agentNode(state: AgentState): Promise<Partial<AgentState>> {
  const response = await llm.invoke(state.messages);
  return {
    messages: [...state.messages, response],
  };
}
```

### Adding More Nodes to LangGraph

You can extend the graph in `src/agent.ts`:

```typescript
workflow.addNode("preprocessor", preprocessNode);
workflow.addNode("agent", agentNode);
workflow.addNode("postprocessor", postprocessNode);

workflow.addEdge(START, "preprocessor");
workflow.addEdge("preprocessor", "agent");
workflow.addEdge("agent", "postprocessor");
workflow.addEdge("postprocessor", END);
```

## Build

```bash
npm run build
```

## Production

```bash
npm start
```
