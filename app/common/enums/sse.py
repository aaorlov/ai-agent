"""SSE event enums (Vercel AI SDK–aligned, Cursor-style)."""

from enum import Enum


class SSEEventType(str, Enum):
    """SSE event type discriminator."""

    SESSION = "session"
    STATUS = "status"
    TEXT_DELTA = "text-delta"
    TEXT_END = "text-end"
    TOOL_CALL = "tool-call"
    TOOL_RESULT = "tool-result"
    APPROVAL_REQUESTED = "approval-requested"
    ERROR = "error"
    FINISH = "finish"


class StatusCode(str, Enum):
    """Status code for 'status' events."""

    THINKING = "thinking"
    EXECUTING = "executing"
    TIMEOUT = "timeout"


class StatusMessage(str, Enum):
    """Human-readable status messages."""

    PLANNING = "Planning"
    APPLYING = "Applying"
    CANCELLING = "Cancelling"


class FinishReason(str, Enum):
    """Finish reason for 'finish' events."""

    STOP = "stop"
    LENGTH = "length"
    TOOL_CALL = "tool-call"
    CONTENT_FILTER = "content-filter"
    ERROR = "error"
    ABORT = "abort"
