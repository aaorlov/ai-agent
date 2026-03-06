"""Health check routes."""

from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.common.enums import HealthStatus

router = APIRouter(prefix="/health", tags=["Health"])


@router.get(
    "/",
    summary="Health check",
    description="Basic health check endpoint",
    responses={200: {"description": "Service is healthy"}},
)
async def health_check():
    """GET /health — basic liveness."""
    return {
        "status": HealthStatus.HEALTHY.value,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }


@router.get(
    "/detailed",
    summary="Detailed health check",
    description="Health check with integrations status",
    responses={
        200: {"description": "All systems healthy"},
        503: {"description": "Service unhealthy"},
    },
)
async def health_detailed():
    """GET /health/detailed — readiness with checks."""
    checks = {
        "server": HealthStatus.HEALTHY.value,
    }
    is_healthy = all(c == HealthStatus.HEALTHY.value for c in checks.values())
    return JSONResponse(
        content={
            "status": HealthStatus.HEALTHY.value if is_healthy else HealthStatus.UNHEALTHY.value,
            "checks": checks,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        },
        status_code=200 if is_healthy else 503,
    )
