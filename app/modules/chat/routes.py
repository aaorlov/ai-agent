"""Chat routes: POST /chat with SSE streaming."""

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.common.enums.sse import SSEEventType
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.sse import resolve_chat_trigger, stream_chat_events
from app.modules.chat.utils import build_sse_event, sse_event_to_message

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.post("/")
async def chat_post(request: Request, body: ChatRequest):
    """POST /chat — SSE chat stream (LangGraph + Vercel AI SDK–style). Supports new message or approve/reject via body.messages."""
    trigger, thread_id, is_new_thread = resolve_chat_trigger(body)

    async def gen():
        if is_new_thread:
            yield sse_event_to_message(
                build_sse_event(type=SSEEventType.SESSION.value, thread_id=thread_id)
            )
        async for ev in stream_chat_events(body, thread_id, trigger, signal=None):
            if await request.is_disconnected():
                break
            yield sse_event_to_message(ev)

    return EventSourceResponse(gen())
