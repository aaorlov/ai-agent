"""LangGraph agent: simple and interruptible (plan → propose → apply) workflows."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, AsyncIterator, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Command, interrupt
from typing_extensions import TypedDict

from app.common.enums import AgentNode

# Re-export for chat module
__all__ = ["Command", "MemorySaver", "create_agent_graph", "create_interruptible_graph", "process_message"]

AgentContext = Dict[str, Any]


class AgentState(TypedDict, total=False):
    """Graph state: messages, session_id, optional context."""

    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    context: AgentContext


def _merge_context(
    left: Optional[AgentContext], right: Optional[AgentContext]
) -> AgentContext:
    out: AgentContext = dict(left or {})
    if right:
        out.update(right)
    return out


# Custom state with reducers: messages use add_messages; session_id last wins; context merge
class _StateChannels(TypedDict, total=False):
    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    context: AgentContext


def _agent_node(state: AgentState) -> Dict[str, Any]:
    """Simple agent node (placeholder). Replace with real LLM call."""
    messages = state.get("messages") or []
    last = messages[-1] if messages else None
    content = getattr(last, "content", "") or ""
    response = f'I received your message: "{content}". This is a placeholder response. Please integrate your actual LLM provider here.'
    return {"messages": [AIMessage(content=response)]}


def create_agent_graph() -> Any:
    """Build simple linear graph: START -> agent -> END."""
    workflow: StateGraph[AgentState] = StateGraph(AgentState)
    workflow.add_node(AgentNode.AGENT.value, _agent_node)
    workflow.add_edge(START, AgentNode.AGENT.value)
    workflow.add_edge(AgentNode.AGENT.value, END)
    return workflow.compile()


def _plan_node(state: AgentState) -> Dict[str, Any]:
    last = (state.get("messages") or [])[-1]
    content = getattr(last, "content", "") or ""
    return {
        "messages": [AIMessage(content=f'I will edit the file based on: "{content}"')],
        "context": _merge_context(state.get("context"), {"plan": "edit_file"}),
    }


def _propose_node(state: AgentState) -> Dict[str, Any]:
    value = interrupt(
        {"question": "Approve this change?", "diff": "(placeholder diff - replace with real proposal)"}
    )
    if isinstance(value, dict) and "approved" in value:
        approved = bool(value["approved"])
    else:
        approved = bool(value)
    return {
        "messages": [
            AIMessage(
                content="Applying changes..." if approved else "Change cancelled."
            )
        ],
        "context": _merge_context(state.get("context"), {"approved": approved}),
    }


def _apply_node(state: AgentState) -> Dict[str, Any]:
    ctx = state.get("context") or {}
    approved = ctx.get("approved", False)
    return {
        "messages": [
            AIMessage(
                content="Done. Changes applied." if approved else "No changes made."
            )
        ],
    }


def create_interruptible_graph(checkpointer: MemorySaver) -> Any:
    """Interruptible graph: Plan -> Propose (interrupt) -> Apply. Use with thread_id."""
    workflow: StateGraph[AgentState] = StateGraph(AgentState)
    workflow.add_node(AgentNode.PLAN.value, _plan_node)
    workflow.add_node(AgentNode.PROPOSE.value, _propose_node)
    workflow.add_node(AgentNode.APPLY.value, _apply_node)
    workflow.add_edge(START, AgentNode.PLAN.value)
    workflow.add_edge(AgentNode.PLAN.value, AgentNode.PROPOSE.value)
    workflow.add_edge(AgentNode.PROPOSE.value, AgentNode.APPLY.value)
    workflow.add_edge(AgentNode.APPLY.value, END)
    return workflow.compile(checkpointer=checkpointer)


async def process_message(
    graph: Any,
    *,
    message: str,
    session_id: Optional[str] = None,
    context: Optional[AgentContext] = None,
    messages: Optional[List[Any]] = None,
) -> AsyncIterator[AgentState]:
    """Run a user message through the simple agent graph and stream state updates."""
    sid = session_id or str(uuid.uuid4())
    ctx: AgentContext = dict(context or {})
    if messages:
        ctx["ui_messages"] = messages
    initial: AgentState = {
        "messages": [HumanMessage(content=message)],
        "session_id": sid,
        "context": ctx,
    }
    async for chunk in graph.astream(initial):
        yield chunk
