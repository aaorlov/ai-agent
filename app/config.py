"""Environment configuration with Pydantic validation."""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings from environment (and .env in dev)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: Literal["dev", "prod", "test"] = "dev"
    PORT: int = 8000

    @field_validator("PORT", mode="before")
    @classmethod
    def port_positive(cls, v: object) -> int:
        if isinstance(v, str):
            v = int(v)
        if not isinstance(v, int) or v <= 0:
            raise ValueError("PORT must be a positive integer")
        return v


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()


env = get_settings()
