import { Hono } from "hono";

const health = new Hono();

// Health check endpoint
health.get("/", (c) => {
  return c.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    service: "prism-invest-agent"
  });
});

// Detailed health check
health.get("/detailed", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "prism-invest-agent",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

export { health };
