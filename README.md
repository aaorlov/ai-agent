# AI Agent

A streaming AI agent server built on **Hono**, **Zod**, and **LangGraph**.
Wraps an Anthropic chat model with persistent threads, short- and long-term
memory, human-in-the-loop tool approval, and live task plans — all delivered
to clients as a Server-Sent Events stream.

## Stack

- **Hono** — HTTP framework
- **Zod** — schema validation at every external boundary
- **LangGraph** — agent workflow orchestration (graph + checkpointing)
- **@langchain/anthropic** — LLM provider
- **MongoDB** — message log, agent checkpoints, long-term store
- **TypeScript** (strict, `noUncheckedIndexedAccess`)

---

## Setup

```bash
bun install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY, ANTHROPIC_MODEL
```

You also need a MongoDB instance reachable at `MONGODB_URL`. The easiest way
locally is via Docker Compose (see below), which boots both the server and a
MongoDB container.

## Scripts

```bash
bun run dev        # hot-reload dev server
bun run start      # run with bun
bun run start:node # run with node --experimental-strip-types
bun run build      # build to ./dist
bun run typecheck  # tsc --noEmit
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

---

## Agent features

The agent is a LangGraph state machine that runs once per user turn. Each
node mutates a typed slice of state and routes to the next node based on
what the LLM produced.

### Graph topology

```
START
  └─▶ load_memory ──▶ call_model ──┬──▶ request_approval ──┐
                                    │           ▲          │
                                    │           └──────────┘  (loop while
                                    │                          approvals
                                    │                          remain)
                                    │           │
                                    │           ▼
                                    └──▶ execute_tool ──▶ call_model
                                    │
                                    └──▶ END  (no tool calls)
```

Nodes live in `src/modules/agent/nodes/`; the wiring is in `graph.ts`.

### State channels

Every channel is reduced explicitly so retries, resumes, and partial updates
stay deterministic. See `src/modules/agent/state.ts`.

| Channel              | Purpose                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `messages`           | Conversation history. Tail-trimmed to `MAX_HISTORY_MESSAGES`, never starting on an orphan tool message (Anthropic rejects unmatched tool_results). |
| `pendingTools`       | Tool calls awaiting human approval. Populated by `call_model`, drained by `request_approval`.                                                     |
| `retrievedContext`   | RAG documents retrieved for the current turn (forwarded to clients as `context-retrieved` SSE events).                                            |
| `steps`              | Iteration counter. Reset to 0 each turn; used as a max-steps guard.                                                                              |
| `systemPrompt`       | Per-thread system instructions (set once on thread creation).                                                                                    |
| `longTermMemories`   | Snapshot of the user's `general_memory` loaded by `load_memory` for this turn.                                                                   |
| `plan`               | Authoritative current plan. Survives history trimming; rendered as a `<system-reminder>` to the LLM each turn.                                   |

### Persistence layers

The agent has **three** independent stores. Each one is owned by a different
layer, and losing one does not destroy the others:

1. **Message log** (`messages` collection) — the canonical conversation
   history, owned by the threads module. Used for the UI's pagination view
   and as the source of truth when rebuilding the agent's working memory.
2. **Checkpoint** (`agent_checkpoints` + `agent_checkpoints_writes`) — a
   LangGraph snapshot of the entire `AgentState` after each super-step. This
   is the agent's working memory; resuming a thread reads the latest tuple
   here. We use a custom `LatestOnlyMongoDBSaver` that prunes obsolete
   checkpoints on every successful `put`, so the steady-state footprint is
   one document per thread regardless of conversation length. A TTL index
   (`CHECKPOINT_TTL_SECONDS = 30 days`) is kept as a safety net for
   abandoned/crashed threads.
3. **Long-term store** (`agent_store` collection) — a per-user namespaced
   key-value store provided by `MongoDBStore`. Currently houses
   `general_memory` entries written by the `save_memory` tool.

### Short-term memory (conversation history)

- The `messages` channel is the rolling conversation window passed to the
  LLM each turn.
- Capped at `MAX_HISTORY_MESSAGES = 30`. The reducer
  (`appendCappedMessages`) drops the oldest entries past the cap and
  advances the cut further if it would otherwise leave a `Tool` message
  whose matching assistant `tool_use` was already dropped (Anthropic
  rejects orphaned `tool_result` blocks).
- `manage_plan` tool calls are stripped from the history before it's sent
  to the LLM (the plan is conveyed via `<system-reminder>` instead) — the
  originals stay in the persisted log for UI replay/audit.

### Long-term memory

Per-user, cross-thread memory backed by the LangGraph store
(`MongoDBStore`, namespaced by `[userId, "general_memory"]`).

- **Read** — the `load_memory` node runs at the start of every turn,
  fetches up to `MAX_MEMORIES_PER_USER = 20` entries (oldest → newest), and
  writes them to `state.longTermMemories`. `call_model` renders them into a
  dedicated system message so the LLM sees stable user context without
  re-asking.
- **Write** — the `save_memory` tool lets the LLM persist a self-contained
  fact, preference, or instruction. When the user is at the cap, the
  oldest entries are FIFO-evicted before the new one is inserted, so each
  user's bucket size is bounded forever.
- Failures here are non-fatal: a missing store yields an empty memories
  list rather than aborting the turn.

### Memory saver (checkpointer)

`LatestOnlyMongoDBSaver` (a `MongoDBSaver` subclass — see
`src/modules/agent/store.ts`) keeps **one** committed checkpoint per
thread by deleting older docs after every successful `put`. Combined with
the TTL safety net this means:

- Resuming an idle thread always reads the most recent state in O(1).
- The pending-writes collection contains only in-flight super-step
  artifacts, never historical noise.
- Deleting a thread (`DELETE /threads/:threadId`) cascades to
  `deleteCheckpoint(threadId)`, removing both the checkpoint and any
  pending writes.

### Checkpoint health & history rebuild

A checkpoint is **healthy** when the next turn can resume on top of it
without surgery. `isCheckpointHealthy` rejects checkpoints that:

- still have a pending `interrupt()` (an abandoned approval), or
- contain an assistant `tool_use` with no matching `tool_result` (Anthropic
  rejects the next call on a mismatched pair).

When the threads layer detects an unhealthy or missing checkpoint, it:

1. Drops the bad checkpoint.
2. Loads the most recent `MAX_HISTORY_MESSAGES` from the persisted log.
3. Synthesises `Expired`-action `tool_result` messages for any orphan tool
   calls (`buildExpiredToolMessages`) so the LLM sees a balanced
   tool_use/tool_result history.
4. Reseeds `state.plan` from the latest successful `manage_plan` tool
   message in history (so plans survive checkpoint loss).
5. Streams the human turn on top of the rebuilt history.

The result: the message log is the canonical history; the checkpoint is a
pure performance optimization, transparently rebuilt when it goes stale.

### Tools

Tools are registered in `src/modules/agent/tools/index.ts`. They're bound
to the LLM in `llm.ts` via `bindTools(...)`. Currently shipped:

| Tool          | Purpose                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `save_memory` | Append a stable fact/preference/instruction to the user's long-term memory (FIFO-evicts when at cap).            |
| `manage_plan` | Create or update the live task plan the user sees as a checklist.                                                |

Two helper sets drive routing:

- `TOOLS_BY_NAME` — lookup used by the executor node.
- `TOOLS_REQUIRING_APPROVAL` — names whose calls must pause for explicit
  human approval before running. `call_model` flags matching calls so the
  graph routes them through `request_approval` instead of executing
  immediately. Currently empty; add tool names here to gate them.

### Plan management (live task plans)

The `manage_plan` tool is a structured TODO-list interface for multi-step
work. Its design:

- **Dedicated state channel** — the resolved plan lives on `state.plan`,
  not in the messages array, so it survives history trimming.
- **System-reminder rendering** — `call_model` injects the plan as a
  `<system-reminder>` system message every turn. While work is in flight
  the full checklist is shipped; once every step is terminal
  (completed/cancelled) it collapses to a one-liner that nudges the LLM to
  start a fresh plan with `merge=false` if the next request is a new task.
- **Atomic returns** — every successful `manage_plan` call returns a fully
  resolved `Plan`. The latest tool message wins; older ones are stale
  snapshots. This makes plan history trivially replayable.
- **Bounded** — `MAX_PLAN_STEPS = 7` per plan to keep the UI compact and
  prevent runaway todo lists.
- **Step lifecycle** — `pending` → `in_progress` → `completed` (or
  `cancelled`). The tool description nudges the LLM to flip to
  `in_progress` before starting and `completed` immediately after
  finishing, so the user sees real-time progress.
- **Merge vs replace** — `merge=false` (default) replaces the plan
  entirely (every step needs description + status); `merge=true` patches
  by step `id` (omitted fields are kept).

Plan tool messages are filtered out of the prompt sent to the LLM (the
plan is in the system reminder); they remain in the persisted history for
the UI's audit trail.

### Human-in-the-loop (HITL) tool approval

`request_approval` uses LangGraph's `interrupt()` to pause the run and
ask the human whether to execute a flagged tool call.

Flow:

1. `call_model` returns. If any tool call's name is in
   `TOOLS_REQUIRING_APPROVAL`, it's added to `state.pendingTools`.
2. The router sends control to `request_approval`, which calls
   `interrupt({ toolCallId, toolName, args })` for the first pending tool.
   The graph snapshots state and returns to the caller; the SSE stream
   ends with `finish: "approval"`.
3. The client makes a second `POST /threads` request with
   `type: "tool_action"` and an `action`:
   - `approved` (with optional `modifiedArgs`) — the tool runs immediately.
   - `cancelled` / `skipped` / any non-approved action — the decision is
     recorded as a `ToolMessage` and the tool is skipped.
4. The router loops back into `request_approval` while
   `pendingTools.length > 0`; once drained, control passes to
   `execute_tool` (a no-op if there are no auto-executable calls left in
   the same assistant turn).

Multiple flagged tool calls in a single turn are processed one approval at
a time. After approvals drain, any non-approval tool calls from the same
assistant message are executed in parallel by `execute_tool` (its
`collectResolvedToolCallIds` filter ensures already-approved calls aren't
re-executed).

### Tool execution

`execute_tool` runs every non-approval tool call from the latest
assistant message in parallel via `Promise.all`. Each call resolves to a
`ToolMessage` regardless of outcome:

- Unknown tool name → `action: "error"` with a human-readable error.
- Thrown exception → `action: "error"` with the underlying message.
- Success → `action: "executed"` with the tool's return value as `result`.

After execution, `findLatestPlan` scans the new tool messages for the
most recent `manage_plan` result and folds it into the `plan` channel.

### Retry

`POST /threads` with `type: "retry"` re-runs the last super-step from the
live checkpoint without taking new input. LangGraph's convention: the
failed super-step's uncommitted writes were dropped, so the failing node
re-executes from its prior input. Useful when an LLM call or tool failed
mid-turn and the user wants to try again without retyping.

### Streaming protocol

`call_model` invokes the LLM through `llm.invoke(...)` (not `.stream()`).
Under LangGraph v2's messages handler this internally streams and
dispatches per-chunk callbacks, which surface as `content-block-delta`
events on the `messages` channel. The threads layer translates these into
SSE `text-delta` events per token, while `updates` events become
high-level `message`/`context-retrieved` events.

---

## HTTP API

| Method | Path                            | Description                                          |
| ------ | ------------------------------- | ---------------------------------------------------- |
| GET    | `/`                             | Service metadata                                     |
| GET    | `/health`                       | Liveness check                                       |
| GET    | `/health/detailed`              | Readiness check                                      |
| POST   | `/threads`                      | SSE thread stream (message, tool action, or retry)   |
| GET    | `/threads`                      | List the user's threads (summaries)                  |
| GET    | `/threads/:threadId/messages`   | Paginated messages of a thread                       |
| DELETE | `/threads/:threadId`            | Delete a thread (history + agent checkpoint)         |
| GET    | `/openapi.json`                 | OpenAPI 3.1 spec                                     |
| GET    | `/docs`                         | Scalar API reference UI (non-prod only)              |

### `POST /threads`

Accepts a discriminated union body:

**New / continued message** — starts a fresh thread (when `threadId` is
omitted) or appends to an existing one.

```json
{ "type": "message", "threadId": "optional-uuid", "content": "Hello" }
```

**Tool action** — resolves a pending approval interrupt.

```json
{
  "type": "tool_action",
  "threadId": "uuid",
  "toolCallId": "uuid",
  "action": "approved",
  "modifiedArgs": { "...": "optional override" }
}
```

`action` is one of `approved`, `cancelled`, `skipped`. `modifiedArgs` is
optional and lets the user edit the LLM's proposed args before approval.

**Retry** — re-runs the last super-step from the live checkpoint.

```json
{ "type": "retry", "threadId": "uuid" }
```

### SSE event stream

The response is `text/event-stream`. Event types:

| Event                | Payload                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `session`            | `{ threadId }` — emitted once when the server mints a new thread id.                     |
| `text-delta`         | `{ id, content }` — incremental assistant text token.                                    |
| `message`            | `{ message }` — a complete `AgentMessage` (human, assistant, tool).                      |
| `context-retrieved`  | `{ documents: [...] }` — RAG documents retrieved for the turn.                           |
| `error`              | `{ message, code? }` — translated runtime error.                                         |
| `finish`             | `{ finishReason }` — terminal event. Reasons: `stop`, `approval`, `error`, `abort`, `max-steps`. |

A `finishReason: "approval"` means the run paused on an approval
interrupt; the client should follow up with `type: "tool_action"`.

---

## Project layout

```
src/
├── index.ts            # entrypoint (Bun fetch handler)
├── app.ts              # Hono app: middleware, error handling, route mounting
├── config.ts           # env loading + Zod-validated config
├── openapi.ts          # OpenAPI / Scalar docs setup
├── common/             # cross-cutting: enums, logger, errors, db, utils
├── constants/          # named values grouped by context
└── modules/
    ├── agent/
    │   ├── graph.ts          # StateGraph wiring + streamAgent()
    │   ├── state.ts          # AgentStateAnnotation (channels + reducers)
    │   ├── store.ts          # MongoDB checkpointer + long-term store
    │   ├── runtime.ts        # checkpoint-health & orphan-tool helpers
    │   ├── llm.ts            # ChatAnthropic + bindTools
    │   ├── nodes/            # load_memory, call_model, execute_tool, request_approval
    │   ├── tools/            # save_memory, manage_plan
    │   ├── enums.ts / constants.ts / types.ts / utils.ts
    │   └── index.ts          # public barrel
    ├── threads/        # SSE endpoint, message log, request/SSE adapters
    └── health/         # liveness / readiness
```

Each module exposes its public surface through `index.ts` (barrel). Code
outside a module imports only from that barrel, never from internal files.
