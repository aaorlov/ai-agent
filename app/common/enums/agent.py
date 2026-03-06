"""Chat and agent enums (message roles, part types, tool results, node names)."""

from enum import Enum


class MessageRole(str, Enum):
    """Chat message role (Vercel AI SDK)."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    DATA = "data"
    TOOL = "tool"


class MessagePartType(str, Enum):
    """UI message part type (Vercel AI SDK / useChat)."""

    TEXT = "text"
    TOOL_INVOCATION = "tool-invocation"
    TOOL_RESULT = "tool-result"


class ToolActionResult(str, Enum):
    """Tool result action (approved, rejected, cancelled)."""

    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class AgentNode(str, Enum):
    """LangGraph node names."""

    AGENT = "agent"
    PLAN = "plan"
    PROPOSE = "propose"
    APPLY = "apply"


DEFAULT_APPROVE_TOOL_NAME = "approve"
