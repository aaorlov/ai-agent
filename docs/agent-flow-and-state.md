# Agent flow: messages, who sends what, and state at each phase

This document gives a **clear view at each phase** of:
- **Messages in the thread** (what is in `state.messages`)
- **Who sends which data** (UI → server, agent → UI via SSE)
- **Full agent state** (`messages`, `pendingTool`, `status`, `textDelta`)

Flow covered: new thread → user question → tool execution → approval requested → user approves → agent response; then user retries the action.

---

## Enums used in this doc

- **Agent** (`@/modules/agent`): `MessageRole` (User, Assistant, Tool, System), `MessagePartType` (Text, ToolInvocation, ToolResult), `ToolActionResult` (Approved, Cancelled, Skipped), `AgentStatusPhase` (Planning, Thinking, Executing, ToolResult).
- **Chat** (`@/modules/chat/events`): `SSEEventType` (Session, Status, TextDelta, TextEnd, ToolCall, ToolResult, ApprovalRequested, Error, Finish), `StatusCode` (Planning, Thinking, Executing, ToolResult), `FinishReason` (Stop, Length, ToolCall, Error, Abort).

---

## Concepts

- **Messages as source of truth:** Tool requests live in an **assistant** message (`MessageRole.Assistant`: toolCallId, toolName, args). Tool results live in a **tool** message (`MessageRole.Tool`: toolCallId, result, action). The thread is fully restorable from `state.messages`; `pendingTool` is for workflow/routing only.
- **Sending messages:** With an existing `threadId` (and not resuming), the server merges your `messages` with the checkpoint, so you can send only the new message(s). For resume, send the message that contains the tool-result part; the graph runs with `Command({ resume })`.

---

## Overview table

| Phase | Messages in thread | User sends | Agent sends | Agent state (summary) |
|-------|--------------------|------------|-------------|------------------------|
| **1. New thread** | [user] | POST body: messages (no threadId) | SSE: `SSEEventType.Session` | messages: [user], pendingTool: null, status: null |
| **2. After plan** | [user] | — | SSE: `SSEEventType.Status`, `StatusCode.Planning` | messages: [user], pendingTool: null, status: `AgentStatusPhase.Planning` |
| **3. After thinking** | [user] | — | SSE: `SSEEventType.Status`, `StatusCode.Thinking` | messages: [user], pendingTool: null, status: `AgentStatusPhase.Thinking` |
| **4. After execute_tool** | [user, assistant (tool invocation)] | — | SSE: Status, `SSEEventType.ToolCall`, `SSEEventType.ApprovalRequested`, `SSEEventType.Finish`(`FinishReason.ToolCall`); stream stops | messages: [user, asst], pendingTool: {...}, status: `AgentStatusPhase.Executing` |
| **5. User approves** | (unchanged) | POST body: threadId + messages (last = tool-result `ToolActionResult.Approved`) | — (then phase 6) | — |
| **6. After request_approval** | [user, assistant, tool (result)] | — | SSE: Status(`StatusCode.ToolResult`), `SSEEventType.ToolResult` | messages: [user, asst, tool], pendingTool: null, status: `AgentStatusPhase.ToolResult` |
| **7. After respond** | [..., assistant (text)] | — | SSE: `SSEEventType.TextDelta`, `SSEEventType.TextEnd`, `SSEEventType.Finish`(`FinishReason.Stop`) | messages: [..., asst text], pendingTool: null, status: null |
| **8. User retries** | (unchanged) | POST body: threadId + messages (last = tool-result retried) | SSE: Status, ToolResult, TextDelta, TextEnd, Finish | Same as 6→7 with action retried |

---

## Phase 1: User initiates new thread

**Messages in thread at this point:**
| # | Role    | Content                         | Tool (id, name, args, result, action) |
|---|--------|----------------------------------|----------------------------------------|
| 1 | user   | "Please run the approval tool"   | —                                       |

**User sends (UI → server):**
```json
POST /chat
{
  "messages": [
    { "id": "msg-1", "role": "user", "content": "Please run the approval tool", "parts": [] }
  ]
}
```
No `threadId` = new thread. In the request, `role` values are `MessageRole` (e.g. `"user"` = MessageRole.User); `parts[].type` is `MessagePartType`; `parts[].action` is `ToolActionResult` when present.

**Agent sends (server → UI, SSE):**
```ts
{ type: SSEEventType.Session, threadId: "generated-uuid" }
```

**Agent state (after request is applied, before graph runs):**
```ts
{
  messages: [
    { id: "msg-1", role: MessageRole.User, content: "Please run the approval tool" }
  ],
  pendingTool: null,
  status: null,
  textDelta: ""
}
```

---

## Phase 2: After “plan” node

**Messages in thread:** unchanged → [user].

**User sends:** Nothing (same request; graph continues from phase 1).

**Agent sends (server → UI, SSE):**
```ts
{ type: SSEEventType.Status, message: "Planning", code: StatusCode.Planning }
```

**Agent state:**
```ts
{
  messages: [ { id: "msg-1", role: MessageRole.User, content: "Please run the approval tool" } ],
  pendingTool: null,
  status: AgentStatusPhase.Planning,
  textDelta: ""
}
```

---

## Phase 3: After “thinking” node

**Messages in thread:** unchanged → [user].

**User sends:** Nothing (same request; graph continues).

**Agent sends (server → UI, SSE):**
```ts
{ type: SSEEventType.Status, message: "Thinking", code: StatusCode.Thinking }
```

**Agent state:**
```ts
{
  messages: [ { id: "msg-1", role: MessageRole.User, content: "Please run the approval tool" } ],
  pendingTool: null,
  status: AgentStatusPhase.Thinking,
  textDelta: ""
}
```

---

## Phase 4: After “execute_tool” node (approval requested, stream stops)

**Messages in thread at this point:**
| # | Role     | Content | Tool (id, name, args, result, action) |
|---|----------|---------|----------------------------------------|
| 1 | user     | "Please run the approval tool" | — |
| 2 | assistant| ""      | call-abc-123, example_approval_tool, args, **no result/action** (pending) |

**User sends:** Nothing (same request; graph continues until interrupt).

**Agent sends (server → UI, SSE), in order:**
```ts
{ type: SSEEventType.Status, message: "Executing tool", code: StatusCode.Executing }
{ type: SSEEventType.ToolCall, toolCallId: "call-abc-123", toolName: "example_approval_tool", args: { reason: "Human approval required for this action" } }
{ type: SSEEventType.ApprovalRequested, toolCallId: "call-abc-123", toolName: "example_approval_tool", args: { reason: "Human approval required for this action" } }
{ type: SSEEventType.Finish, finishReason: FinishReason.ToolCall }
```
Stream stops (interrupt). No further SSE until the user sends a new request.

**Agent state:**
```ts
{
  messages: [
    { id: "msg-1", role: MessageRole.User, content: "Please run the approval tool" },
    {
      id: "invocation-uuid",
      role: MessageRole.Assistant,
      content: "",
      toolCallId: "call-abc-123",
      toolName: "example_approval_tool",
      args: { reason: "Human approval required for this action" }
    }
  ],
  pendingTool: {
    toolCallId: "call-abc-123",
    toolName: "example_approval_tool",
    args: { reason: "Human approval required for this action" }
  },
  status: AgentStatusPhase.Executing,
  textDelta: ""
}
```

**Reopening the thread:** Load `getThreadState(threadId).values.messages` → last message is the assistant tool invocation (pending). Use `values.pendingTool` to show the approval card and route the next request.

---

## Phase 5: User approves – UI sends response (no state change yet)

**Messages in thread (in checkpoint):** still [user, assistant (tool invocation)] from phase 4.

**User sends (UI → server):**
```json
POST /chat
{
  "threadId": "generated-uuid",
  "messages": [
    { "id": "msg-1", "role": "user", "content": "Please run the approval tool", "parts": [] },
    {
      "id": "msg-2",
      "role": "user",
      "content": "",
      "parts": [
        {
          "type": "tool-result",
          "toolCallId": "call-abc-123",
          "toolName": "example_approval_tool",
          "action": "approved",
          "result": { "confirmed": true }
        }
      ]
    }
  ]
}
```
Server uses the **last** message’s tool-result part to build `resume` and invokes the graph with **Command({ resume })**. Execution resumes in `request_approval`.

**Agent sends:** Nothing yet; after processing this request the agent will send the phase 6 SSE events.

**Agent state:** Unchanged in this step; the graph runs from the checkpoint and updates state in phase 6.

---

## Phase 6: After “request_approval” (resumed) – tool result applied

**Messages in thread at this point:**
| # | Role     | Content | Tool (id, name, args, result, action) |
|---|----------|---------|----------------------------------------|
| 1 | user     | "Please run the approval tool" | — |
| 2 | assistant| ""      | call-abc-123, example_approval_tool, args, no result (invocation) |
| 3 | tool     | ""      | call-abc-123, example_approval_tool, result: { confirmed: true }, action: ToolActionResult.Approved |

**User sends:** Nothing (this is the agent’s response to the user’s approval request from phase 5).

**Agent sends (server → UI, SSE), in order:**
```ts
{ type: SSEEventType.Status, message: "Tool result", code: StatusCode.ToolResult }
{ type: SSEEventType.ToolResult, toolCallId: "call-abc-123", result: { confirmed: true }, action: ToolActionResult.Approved }
```

**Agent state:**
```ts
{
  messages: [
    { id: "msg-1", role: MessageRole.User, content: "Please run the approval tool" },
    {
      id: "invocation-uuid",
      role: MessageRole.Assistant,
      content: "",
      toolCallId: "call-abc-123",
      toolName: "example_approval_tool",
      args: { reason: "Human approval required for this action" }
    },
    {
      id: "result-uuid",
      role: MessageRole.Tool,
      content: "",
      toolCallId: "call-abc-123",
      toolName: "example_approval_tool",
      result: { confirmed: true },
      action: ToolActionResult.Approved
    }
  ],
  pendingTool: null,
  status: AgentStatusPhase.ToolResult,
  textDelta: ""
}
```

---

## Phase 7: After “respond” node – agent sends final reply

**Messages in thread at this point:**
| # | Role     | Content |
|---|----------|---------|
| 1 | user     | "Please run the approval tool" |
| 2 | assistant| "" (tool invocation) |
| 3 | tool     | "" (result, action: ToolActionResult.Approved) |
| 4 | assistant| "Response based on conversation and tool results." |

**User sends:** Nothing (same request; graph continues after phase 6).

**Agent sends (server → UI, SSE), in order:**
```ts
{ type: SSEEventType.TextDelta, content: "Response based on conversation and tool results." }
{ type: SSEEventType.TextEnd }
{ type: SSEEventType.Finish, finishReason: FinishReason.Stop }
```

**Agent state:**
```ts
{
  messages: [
    { id: "msg-1", role: MessageRole.User, content: "Please run the approval tool" },
    { id: "invocation-uuid", role: MessageRole.Assistant, content: "", toolCallId: "call-abc-123", toolName: "example_approval_tool", args: { ... } },
    { id: "result-uuid", role: MessageRole.Tool, content: "", toolCallId: "call-abc-123", toolName: "example_approval_tool", result: { confirmed: true }, action: ToolActionResult.Approved },
    { id: "resp-uuid", role: MessageRole.Assistant, content: "Response based on conversation and tool results." }
  ],
  pendingTool: null,
  status: null,
  textDelta: ""
}
```

---

## Phase 8: User retries the action

**User sends (UI → server):**
```json
POST /chat
{
  "threadId": "generated-uuid",
  "messages": [
    { "id": "msg-1", "role": "user", "content": "Please run the approval tool", "parts": [] },
    {
      "id": "msg-2",
      "role": "user",
      "content": "",
      "parts": [
        {
          "type": "tool-result",
          "toolCallId": "call-abc-123",
          "toolName": "example_approval_tool",
          "action": "retried",
          "result": null
        }
      ]
    }
  ]
}
```

**Agent sends (server → UI, SSE), in order:**
```ts
{ type: SSEEventType.Status, message: "Tool result", code: StatusCode.ToolResult }
{ type: SSEEventType.ToolResult, toolCallId: "call-abc-123", result: { action: "retried" }, action: "retried" }
{ type: SSEEventType.TextDelta, content: "Response based on conversation and tool results." }
{ type: SSEEventType.TextEnd }
{ type: SSEEventType.Finish, finishReason: FinishReason.Stop }
```

**Agent state after request_approval (resume):** Same as phase 6 but the new tool message has `action: ToolActionResult.Retried`. Then after respond, same shape as phase 7 with the updated tool result in the thread.

---

## Summary: messages and state by phase

| Phase   | messages in thread | pendingTool | status   |
|---------|--------------------|------------|----------|
| 1       | [user]             | null       | null     |
| 2       | [user]             | null       | AgentStatusPhase.Planning |
| 3       | [user]             | null       | AgentStatusPhase.Thinking |
| 4       | [user, assistant (tool invocation)] | { toolCallId, toolName, args } | AgentStatusPhase.Executing |
| 5       | (no change; UI sends approval) | — | — |
| 6       | [user, assistant (invocation), tool (result)] | null | AgentStatusPhase.ToolResult |
| 7       | [..., assistant (text)] | null | null |
| 8       | Same as 6→7 with action retried | null after resume | AgentStatusPhase.ToolResult then null |

**Thread shape (source of truth):** For each tool approval the thread has: **assistant** (toolCallId, toolName, args, no result) then **tool** (toolCallId, result, action). Pending approval = last assistant message is a tool invocation with no following tool message for that toolCallId; `pendingTool` in state is used for routing.
