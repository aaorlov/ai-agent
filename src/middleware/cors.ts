import { cors } from "hono/cors";
import type { Context, Next } from "hono";

export const corsMiddleware = cors({
  origin: process.env.CORS_ORIGIN || "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["Content-Length"],
  maxAge: 86400,
  credentials: true,
});
