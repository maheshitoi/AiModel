from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """AI service settings, read from the monorepo root .env (shared with the backend)."""

    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    ai_service_host: str = "127.0.0.1"
    ai_service_port: int = 8000
    checkpoint_dir: Path = Path("ai-model/checkpoints")

    @property
    def checkpoint_path(self) -> Path:
        return self.checkpoint_dir if self.checkpoint_dir.is_absolute() else REPO_ROOT / self.checkpoint_dir


@lru_cache
def get_settings() -> Settings:
    return Settings()
