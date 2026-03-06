"""SSE chat: stream LangGraph runs and handle approve/reject (Cursor-style events)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage
from langgraph.types import Command

from app.agent import create_interruptible_graph
from app.common.enums import (
    DEFAULT_APPROVE_TOOL_NAME,
    FinishReason,
    MessagePartType,
    MessageRole,
    StatusCode,
    StatusMessage,
)
from app.common.enums.sse import SSEEventType
from app.modules.chat.events import normalize_interrupt_to_tool_call
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.utils import build_sse_event

from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
graph = create_interruptible_graph(checkpointer)


# --- Trigger resolution (message vs approve vs reject) ---


class StreamTriggerType:
    MESSAGE = "message"
    APPROVE = "approve"
    REJECT = "reject"


def _last_message_text(state: Dict[str, Any]) -> str:
    messages = state.get("messages") or []
    if not messages:
        return ""
    last = messages[-1]
    content = getattr(last, "content", None)
    return content if isinstance(content, str) else ""


def _has_interrupt(chunk: Dict[str, Any]) -> Optional[List]:
    val = chunk.get("__interrupt__")
    if isinstance(val, list) and len(val) > 0:
        return val
    return None


def _get_approval_trigger(body: ChatRequest) -> Optional[Dict]:
    """Detect approve/reject from last user message parts (tool-result with isApproval)."""
    thread_id = body.thread_id or str(uuid.uuid4())
    user_messages = [m for m in (body.messages or []) if m.role == MessageRole.USER]
    last_user = user_messages[-1] if user_messages else None
    if not last_user or not last_user.parts:
        return None
    approval_part = None
    for p in last_user.parts:
        if getattr(p, "type", None) == MessagePartType.TOOL_RESULT:
            if getattr(p, "action", None) in ("approved", "approve") or getattr(
                p, "is_approval", False
            ):
                approval_part = p
                break
    if not approval_part:
        return None
    result = getattr(approval_part, "result", None)
    rejected = isinstance(result, dict) and result.get("approved") is False
    tool_call_id = approval_part.tool_call_id
    if rejected:
        return {
            "type": StreamTriggerType.REJECT,
            "thread_id": thread_id,
            "tool_call_id": tool_call_id,
        }
    return {
        "type": StreamTriggerType.APPROVE,
        "thread_id": thread_id,
        "tool_call_id": tool_call_id,
        "payload": result,
    }


def resolve_chat_trigger(body: ChatRequest) -> tuple[dict, str, bool]:
    """Return (trigger, thread_id, is_new_thread)."""
    thread_id = body.thread_id or str(uuid.uuid4())
    is_new_thread = body.thread_id is None
    approval = _get_approval_trigger(body)
    if approval:
        return approval, approval["thread_id"], is_new_thread
    user_messages = [m for m in (body.messages or []) if m.role == MessageRole.USER]
    last_user = user_messages[-1] if user_messages else None
    text = ""
    if last_user:
        for p in last_user.parts or []:
            if getattr(p, "type", None) == MessagePartType.TEXT:
                text = getattr(p, "text", "") or ""
                break
        if not text and last_user.content:
            text = last_user.content or ""
    trigger = {
        "type": StreamTriggerType.MESSAGE,
        "text": text,
        "thread_id": thread_id,
    }
    return trigger, thread_id, is_new_thread


async def stream_chat_events(
    body: ChatRequest,
    thread_id: str,
    trigger: dict,
    signal: Any = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Stream SSE events for one chat request (message or approve/reject)."""
    config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    try:
        if trigger["type"] == StreamTriggerType.MESSAGE:
            input_state: Dict[str, Any] = {
                "messages": [HumanMessage(content=trigger["text"])],
                "session_id": thread_id,
                "context": {},
            }
            stream = graph.astream(
                input_state,
                config=config,
                stream_mode="values",
            )
            last_sent = ""
            last_state: Optional[Dict] = None

            yield build_sse_event(
                type=SSEEventType.STATUS.value,
                message=StatusMessage.PLANNING.value,
                code=StatusCode.THINKING.value,
            )

            async for chunk in stream:
                if isinstance(chunk, dict):
                    last_state = chunk
                    interrupt = _has_interrupt(chunk)
                    if interrupt:
                        value = interrupt[0] if isinstance(interrupt[0], dict) else {}
                        tool = normalize_interrupt_to_tool_call(value)
                        yield build_sse_event(
                            type=SSEEventType.TOOL_CALL.value,
                            tool_call_id=tool["toolCallId"],
                            tool_name=tool["toolName"],
                            args=tool.get("args"),
                        )
                        yield build_sse_event(
                            type=SSEEventType.APPROVAL_REQUESTED.value,
                            tool_call_id=tool["toolCallId"],
                            tool_name=tool["toolName"],
                            args=tool.get("args"),
                        )
                        return
                    text = _last_message_text(chunk)
                    if text and text != last_sent:
                        content = text[len(last_sent) :] if last_sent else text
                        last_sent = text
                        if content:
                            yield build_sse_event(
                                type=SSEEventType.TEXT_DELTA.value,
                                content=content,
                            )

            yield build_sse_event(type=SSEEventType.TEXT_END.value)
            yield build_sse_event(
                type=SSEEventType.FINISH.value,
                finish_reason=FinishReason.STOP.value,
            )
            return

        if trigger["type"] in (StreamTriggerType.APPROVE, StreamTriggerType.REJECT):
            resume_value = (
                trigger.get("payload") or {"approved": True}
                if trigger["type"] == StreamTriggerType.APPROVE
                else {"approved": False}
            )
            cmd = Command(resume=resume_value)
            stream = graph.astream(cmd, config=config)
            last_sent = ""
            last_state = None
            tool_call_id = trigger.get("tool_call_id") or DEFAULT_APPROVE_TOOL_NAME
            approved = trigger["type"] == StreamTriggerType.APPROVE

            yield build_sse_event(
                type=SSEEventType.STATUS.value,
                message=StatusMessage.APPLYING.value if approved else StatusMessage.CANCELLING.value,
                code=StatusCode.EXECUTING.value,
            )

            async for chunk in stream:
                if isinstance(chunk, dict):
                    last_state = chunk
                    interrupt = _has_interrupt(chunk)
                    if interrupt:
                        value = interrupt[0] if isinstance(interrupt[0], dict) else {}
                        tool = normalize_interrupt_to_tool_call(value)
                        yield build_sse_event(
                            type=SSEEventType.TOOL_CALL.value,
                            tool_call_id=tool["toolCallId"],
                            tool_name=tool["toolName"],
                            args=tool.get("args"),
                        )
                        yield build_sse_event(
                            type=SSEEventType.APPROVAL_REQUESTED.value,
                            tool_call_id=tool["toolCallId"],
                            tool_name=tool["toolName"],
                            args=tool.get("args"),
                        )
                        return
                    text = _last_message_text(chunk)
                    if text and text != last_sent:
                        content = text[len(last_sent) :] if last_sent else text
                        last_sent = text
                        if content:
                            yield build_sse_event(
                                type=SSEEventType.TEXT_DELTA.value,
                                content=content,
                            )

            yield build_sse_event(type=SSEEventType.TEXT_END.value)
            ctx = (last_state or {}).get("context") if last_state else None
            result = ctx if isinstance(ctx, dict) else ({"applied": True} if approved else {"applied": False})
            yield build_sse_event(
                type=SSEEventType.TOOL_RESULT.value,
                tool_call_id=tool_call_id,
                result=result,
            )
            yield build_sse_event(
                type=SSEEventType.FINISH.value,
                finish_reason=FinishReason.STOP.value if approved else FinishReason.ERROR.value,
            )

    except Exception as err:
        yield build_sse_event(
            type=SSEEventType.ERROR.value,
            message=str(err),
        )
