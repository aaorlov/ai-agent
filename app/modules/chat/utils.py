"""SSE formatting and helpers."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional


def sse_event_to_message(ev: Dict[str, Any]) -> Dict[str, str]:
    """Map event dict to SSE envelope: data = JSON string."""
    return {"data": json.dumps(ev)}


def build_sse_event(
    *,
    type: str,
    thread_id: Optional[str] = None,
    message_id: Optional[str] = None,
    content: Optional[str] = None,
    message: Optional[str] = None,
    code: Optional[str] = None,
    tool_call_id: Optional[str] = None,
    tool_name: Optional[str] = None,
    args: Any = None,
    result: Any = None,
    finish_reason: Optional[str] = None,
    usage: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Build one SSE event dict (camelCase for frontend)."""
    out: Dict[str, Any] = {"type": type}
    if thread_id is not None:
        out["threadId"] = thread_id
    if message_id is not None:
        out["messageId"] = message_id
    if content is not None:
        out["content"] = content
    if message is not None:
        out["message"] = message
    if code is not None:
        out["code"] = code
    if tool_call_id is not None:
        out["toolCallId"] = tool_call_id
    if tool_name is not None:
        out["toolName"] = tool_name
    if args is not None:
        out["args"] = args
    if result is not None:
        out["result"] = result
    if finish_reason is not None:
        out["finishReason"] = finish_reason
    if usage is not None:
        out["usage"] = usage
    return out
