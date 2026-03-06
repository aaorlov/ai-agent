"""SSE event types (Cursor-style, Vercel AI SDK–aligned)."""

from __future__ import annotations

import uuid
from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field

from app.common.enums import FinishReason, SSEEventType, StatusCode


# Discriminated union of SSE events (by type)


class SessionEvent(BaseModel):
    type: Literal[SSEEventType.SESSION] = SSEEventType.SESSION
    thread_id: str = Field(..., alias="threadId")


class StatusEvent(BaseModel):
    type: Literal[SSEEventType.STATUS] = SSEEventType.STATUS
    message: str = ""
    code: Optional[StatusCode] = None


class TextDeltaEvent(BaseModel):
    type: Literal[SSEEventType.TEXT_DELTA] = SSEEventType.TEXT_DELTA
    message_id: Optional[str] = Field(None, alias="messageId")
    content: str = ""


class TextEndEvent(BaseModel):
    type: Literal[SSEEventType.TEXT_END] = SSEEventType.TEXT_END
    message_id: Optional[str] = Field(None, alias="messageId")
    metadata: Optional[Dict[str, Any]] = None


class ToolCallEvent(BaseModel):
    type: Literal[SSEEventType.TOOL_CALL] = SSEEventType.TOOL_CALL
    message_id: Optional[str] = Field(None, alias="messageId")
    tool_call_id: str = Field(..., alias="toolCallId")
    tool_name: str = Field(..., alias="toolName")
    args: Any = None


class ToolResultEvent(BaseModel):
    type: Literal[SSEEventType.TOOL_RESULT] = SSEEventType.TOOL_RESULT
    message_id: Optional[str] = Field(None, alias="messageId")
    tool_call_id: str = Field(..., alias="toolCallId")
    result: Any = None


class ApprovalRequestedEvent(BaseModel):
    type: Literal[SSEEventType.APPROVAL_REQUESTED] = SSEEventType.APPROVAL_REQUESTED
    message_id: Optional[str] = Field(None, alias="messageId")
    tool_call_id: str = Field(..., alias="toolCallId")
    tool_name: str = Field(..., alias="toolName")
    args: Any = None


class ErrorEvent(BaseModel):
    type: Literal[SSEEventType.ERROR] = SSEEventType.ERROR
    message_id: Optional[str] = Field(None, alias="messageId")
    message: str = ""
    code: Optional[str] = None


class FinishEvent(BaseModel):
    type: Literal[SSEEventType.FINISH] = SSEEventType.FINISH
    finish_reason: FinishReason = Field(..., alias="finishReason")
    usage: Optional[Dict[str, int]] = None


SSEEvent = Union[
    SessionEvent,
    StatusEvent,
    TextDeltaEvent,
    TextEndEvent,
    ToolCallEvent,
    ToolResultEvent,
    ApprovalRequestedEvent,
    ErrorEvent,
    FinishEvent,
]


def normalize_interrupt_to_tool_call(value: dict) -> Dict[str, Any]:
    """Map LangGraph interrupt payload to tool-call shape (toolCallId, toolName, args)."""
    return {
        "toolCallId": value.get("tool_call_id") or value.get("toolCallId") or str(uuid.uuid4()),
        "toolName": value.get("tool_name") or value.get("toolName") or "approve",
        "args": value.get("args", value),
    }
