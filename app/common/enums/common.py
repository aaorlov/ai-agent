"""Common enums (health, environment)."""

from enum import Enum


class HealthStatus(str, Enum):
    """Health check status."""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class Environment(str, Enum):
    """Runtime environment."""

    DEV = "dev"
    PROD = "prod"
    TEST = "test"
