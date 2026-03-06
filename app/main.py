"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.modules.chat import chat_router
from app.modules.health import health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="AI Agent API",
    version="1.0.0",
    description="AI Agent API with LangGraph and SSE chat",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

settings = get_settings()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health_router)
app.include_router(chat_router)


@app.get("/")
async def root():
    """Root: API info and links."""
    return {
        "name": "AI Agent API",
        "version": "1.0.0",
        "description": "AI Agent API",
        "endpoints": {
            "health": "/health",
            "chat": "/chat",
            "chatStream": "/chat",
            "docs": "/docs",
            "openapi": "/openapi.json",
        },
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Return 500 with message in dev, generic in prod."""
    message = str(exc) if settings.ENV != "prod" else "Internal Server Error"
    return JSONResponse(
        status_code=500,
        content={"error": message},
    )
