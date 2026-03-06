"""Shared helpers."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from pydantic import ValidationError


async def delay(ms: int) -> None:
    """Sleep for given milliseconds."""
    await asyncio.sleep(ms / 1000.0)


def validation_issues(err: Exception) -> List[Dict[str, Any]]:
    """Extract Pydantic validation issues for 400 response."""
    if isinstance(err, ValidationError):
        return [e.get("msg", str(e)) for e in err.errors()]
    return [{"msg": str(err)}]
