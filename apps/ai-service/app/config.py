from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from . import REPO_ROOT


class Settings(BaseSettings):
    """AI service settings, read from the monorepo root .env (shared with the backend)."""

    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore", env_ignore_empty=True)

    ai_service_host: str = "127.0.0.1"
    ai_service_port: int = 8000
    checkpoint_dir: Path = Path("ai-model/checkpoints")
    # Shared secret the backend sends as X-Internal-Token. Without it, the /v1 routes refuse every request.
    ai_service_token: SecretStr | None = None
    # Checkpoint loaded at startup, relative to CHECKPOINT_DIR (e.g. tiny-cpu-v1/best.pt).
    ai_model_checkpoint: str | None = None
    # Replies whose least confident token is below this get the fallback reply instead (see docs/inference.md).
    ai_min_confidence: float = Field(0.5, ge=0, le=1)
    # How long a request waits for the model before getting 503 (generation runs one request at a time).
    ai_queue_timeout_seconds: float = Field(10, gt=0, le=120)
    ai_torch_threads: int | None = Field(None, ge=1, le=64)

    @field_validator("ai_service_token")
    @classmethod
    def _token_length(cls, v: SecretStr | None) -> SecretStr | None:
        if v is not None and len(v.get_secret_value()) < 32:
            raise ValueError("AI_SERVICE_TOKEN must be at least 32 characters")
        return v

    @property
    def checkpoint_path(self) -> Path:
        return self.checkpoint_dir if self.checkpoint_dir.is_absolute() else REPO_ROOT / self.checkpoint_dir


@lru_cache
def get_settings() -> Settings:
    return Settings()
