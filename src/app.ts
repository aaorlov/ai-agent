import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { openAPIRouteHandler } from "hono-openapi";

import { env } from "./config";
import { health } from "./modules/health";
import { chat } from "./modules/chat";

// Create the main Hono app
const app = new Hono();

// === GLOBAL MIDDLEWARE ===

// Request logging
app.use("*", logger());

// Pretty JSON responses in development
if (env.ENV === "dev") {
  app.use("*", prettyJSON());
}

// CORS configuration
app.use(cors());

// === ERROR HANDLING ===

app.onError((err, c) => {
  console.error(`[Error] ${err.message}`, err.stack);

  // Default error response
  return c.json(
    {
      error: env.ENV === "prod" ? "Internal Server Error" : err.message,
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      path: c.req.path,
    },
    404
  );
});

// === ROUTES ===

// Mount health routes
app.route("/health", health);

// Chat SSE routes: /chat/stream, /chat/approve, /chat/reject
app.route("/chat", chat);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "AI Agent API",
    version: "1.0.0",
    description: "AI Agent API",
    endpoints: {
      health: "/health",
      chat: "/chat (POST, SSE)",
      docs: "/docs",
      openapi: "/openapi.json",
    },
  });
});

// === OPENAPI DOCUMENTATION ===

// OpenAPI 3.1 JSON spec endpoint using hono-openapi
app.get(
  "/openapi.json",
  openAPIRouteHandler(app, {
    documentation: {
  openapi: "3.1.0",
  info: {
    title: "AI Agent API",
    version: "1.0.0",
        description:
          "AI Agent API",
        contact: {
          name: "API Support",
        },
        license: {
          name: "MIT",
        },
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: "Local development server",
    },
        {
          url: "https://api.prisminvest.com",
          description: "Production server",
        },
  ],
  tags: [
    { name: "Health", description: "Health check endpoints" },
  ],
    },
  })
);

// Scalar API Reference UI
app.get(
  "/docs",
  Scalar({
    url: "/openapi.json",
    theme: "purple",
    pageTitle: "AI Agent API",
  })
);

export { app };
