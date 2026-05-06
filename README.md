# AI Agent

A Hono server with Zod validation and LangGraph integration. Streams chat
responses over Server-Sent Events.

## Stack

- **Hono** — HTTP framework
- **Zod** — schema validation at every external boundary
- **LangGraph** — agent workflow orchestration
- **@langchain/anthropic** — LLM provider
- **TypeScript** (strict, `noUncheckedIndexedAccess`)

## Setup

```bash
bun install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
```

You also need a MongoDB instance reachable at `MONGODB_URL`. The easiest way
locally is via Docker Compose (see below), which boots both the server and a
MongoDB container.

## Scripts

```bash
bun run dev       # hot-reload dev server
bun run start     # run with bun
bun run start:node # run with node --experimental-strip-types
bun run build     # build to ./dist
bun run lint      # biome check + fix
bun test
```

## Docker

```bash
docker compose up --build
```

Boots two services:

- `mongodb` — MongoDB 7, persisted to a named volume, exposed on `:27017`.
- `server`  — this app, running `bun run dev` with hot reload (source is
  bind-mounted). Reachable on `:8000`.

The server reads `ANTHROPIC_API_KEY` (and other vars) from your project-root
`.env` via Compose interpolation. `MONGODB_URL` is hard-set to
`mongodb://mongodb:27017` inside the compose network and overrides any
value in `.env`.

The Dockerfile is multi-stage with two runnable targets:

- `dev`  — full deps + source, runs `bun run dev` (hot reload). Used by
  `docker compose up`.
- `prod` — minimal `oven/bun:1-slim` image with only the `bun build` bundle.
  Build it manually with `docker build --target prod -t ai-agent:prod .`.

## Environment

| Variable             | Required | Default     |
| -------------------- | -------- | ----------- |
| `ENV`                | no       | `dev`       |
| `PORT`               | no       | `8000`      |
| `ANTHROPIC_API_KEY`  | yes      | —           |
| `ANTHROPIC_MODEL`    | yes      | —           |
| `MONGODB_URL`        | yes      | —           |
| `MONGODB_DB_NAME`    | yes      | —           |

## Endpoints

| Method | Path             | Description                                  |
| ------ | ---------------- | -------------------------------------------- |
| GET    | `/`              | Service metadata                             |
| GET    | `/health`        | Liveness check                               |
| GET    | `/health/detailed` | Readiness check                            |
| POST   | `/chat`          | SSE chat stream (message or tool action)     |
| DELETE | `/chat/:threadId`| Delete all checkpoints for a thread          |
| GET    | `/openapi.json`  | OpenAPI 3.1 spec                             |
| GET    | `/docs`          | Scalar API reference UI (non-prod only)      |

### `POST /chat`

Accepts a discriminated union body — either a new/continued message, or an
action on a pending tool call:

```json
{ "type": "message", "threadId": "optional-uuid", "content": "Hello" }
```

```json
{
  "type": "tool_action",
  "threadId": "uuid",
  "toolCallId": "uuid",
  "action": "approved"
}
```

Streams SSE events: `session`, `text-delta`, `message`, `context-retrieved`,
`error`, `finish`.

## Project layout

```
src/
├── index.ts           # entrypoint (Bun fetch handler)
├── app.ts             # Hono app: middleware, error handling, route mounting
├── config.ts          # env loading + Zod-validated config
├── openapi.ts         # OpenAPI / Scalar docs setup
├── common/            # cross-cutting: enums, logger, errors
├── constants/         # named values grouped by context
└── modules/
    ├── agent/         # LangGraph agent + LLM
    ├── chat/          # SSE chat endpoint
    └── health/        # liveness / readiness
```

Each module exposes its public surface through `index.ts` (barrel). Code
outside a module imports only from that barrel, never from internal files.
