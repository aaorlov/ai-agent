import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors.js";
import { health } from "./routes/health.js";
import { chat } from "./routes/chat.js";

const app = new Hono();

// Global middleware
app.use("*", corsMiddleware);

// Mount route modules
app.route("/health", health);
app.route("/api/chat", chat);

// Start the server
const port = Number(process.env.PORT) || 3000;

serve({
  fetch: app.fetch,
  port,
});

console.log(`🚀 Server is running on http://localhost:${port}`);
console.log(`📡 SSE endpoint: POST http://localhost:${port}/api/chat/stream`);
console.log(`💬 Chat endpoint: POST http://localhost:${port}/api/chat`);
console.log(`❤️  Health check: GET http://localhost:${port}/health`);
