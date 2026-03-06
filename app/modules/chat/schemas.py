"""Pydantic schemas for chat API (Vercel AI SDK–aligned)."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import MessagePartType, MessageRole


# --- Message parts (discriminated union by type) ---


class TextPart(BaseModel):
    type: Literal[MessagePartType.TEXT] = MessagePartType.TEXT
    text: str = ""


class ToolInvocationPart(BaseModel):
    type: Literal[MessagePartType.TOOL_INVOCATION] = MessagePartType.TOOL_INVOCATION
    tool_call_id: str = Field("", alias="toolCallId")
    tool_name: str = Field("", alias="toolName")
    state: Optional[str] = None
    args: Optional[Dict[str, Any]] = None
    result: Any = None

    model_config = ConfigDict(populate_by_name=True)


class ToolResultPart(BaseModel):
    type: Literal[MessagePartType.TOOL_RESULT] = MessagePartType.TOOL_RESULT
    tool_call_id: str = Field("", alias="toolCallId")
    tool_name: str = Field("", alias="toolName")
    result: Any = None
    action: Optional[str] = None  # approved | rejected | cancelled
    is_approval: bool = Field(False, alias="isApproval")

    model_config = ConfigDict(populate_by_name=True)


MessagePart = Union[TextPart, ToolInvocationPart, ToolResultPart]


class UIMessage(BaseModel):
    """Single UI message (Vercel AI SDK useChat)."""

    id: str = ""
    role: MessageRole
    content: str = ""
    parts: List[Union[TextPart, ToolInvocationPart, ToolResultPart]] = Field(
        default_factory=list
    )


class ChatRequest(BaseModel):
    """POST /chat body: messages and optional thread_id."""

    thread_id: Optional[str] = Field(None, alias="threadId")
    messages: List[UIMessage]
    context: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(populate_by_name=True)
