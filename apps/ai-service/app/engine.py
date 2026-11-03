"""Holds the active model and runs generation, one request at a time."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel

from dataset.schema import Turn
from dataset.synthetic import Business
from model import GPT
from model.chat import GenerationSettings, Reply, generate_reply
from model.checkpoint import load_model
from tokenizer import BPETokenizer

from . import AI_MODEL_DIR

DEFAULT_FACTS = AI_MODEL_DIR / "config" / "business.json"
log = logging.getLogger("ai_service.engine")


class CheckpointPathError(ValueError):
    """The requested checkpoint is not a .pt file inside the checkpoint directory."""


class NoModelLoaded(RuntimeError):
    pass


class EngineBusy(RuntimeError):
    pass


class ModelInfo(BaseModel):
    name: str  # run directory name
    checkpoint: str  # relative to CHECKPOINT_DIR, forward slashes
    parameters: int
    context_length: int
    vocab_size: int
    step: int | None
    best_val_loss: float | None
    # "run": business.json saved with the training run; "default": ai-model/config/business.json
    facts_source: str
    business_name: str
    loaded_at: str


@dataclass(frozen=True)
class LoadedModel:
    model: GPT
    tokenizer: BPETokenizer
    business: Business
    info: ModelInfo


class Engine:
    def __init__(self, checkpoint_root: Path, queue_timeout: float):
        self.checkpoint_root = checkpoint_root.resolve()
        self.queue_timeout = queue_timeout
        self.default_business = Business.load(DEFAULT_FACTS)
        self.last_load_error: str | None = None
        self._current: LoadedModel | None = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()  # CPU inference: concurrent requests would only fight over cores

    @property
    def current(self) -> LoadedModel | None:
        return self._current

    def business(self) -> Business:
        current = self._current
        return current.business if current else self.default_business

    def resolve(self, checkpoint: str) -> Path:
        path = (self.checkpoint_root / checkpoint).resolve()
        if path.suffix != ".pt" or not path.is_relative_to(self.checkpoint_root):
            raise CheckpointPathError("checkpoint must be a .pt file inside the checkpoint directory")
        if not path.is_file():
            raise FileNotFoundError(checkpoint)
        return path

    def checkpoints(self) -> list[dict]:
        if not self.checkpoint_root.is_dir():
            return []
        return [
            {
                "checkpoint": p.relative_to(self.checkpoint_root).as_posix(),
                "size_bytes": p.stat().st_size,
                "modified_at": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
            }
            for p in sorted(self.checkpoint_root.rglob("*.pt"))
        ]

    def load(self, checkpoint: str) -> ModelInfo:
        """Loads a checkpoint and swaps it in. Requests already running finish on the previous model."""
        path = self.resolve(checkpoint)
        with self._load_lock:
            started = time.perf_counter()
            try:
                model, tokenizer, meta = load_model(path)
                run_facts = path.parent / "business.json"
                business = Business.load(run_facts if run_facts.exists() else DEFAULT_FACTS)
            except Exception as exc:
                self.last_load_error = f"{type(exc).__name__}: {exc}"
                raise
            info = ModelInfo(
                name=path.parent.name,
                checkpoint=path.relative_to(self.checkpoint_root).as_posix(),
                parameters=model.num_parameters(),
                context_length=model.cfg.context_length,
                vocab_size=model.cfg.vocab_size,
                step=meta.get("step"),
                best_val_loss=meta.get("best_val_loss"),
                facts_source="run" if run_facts.exists() else "default",
                business_name=business.name,
                loaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            )
            self._current = LoadedModel(model, tokenizer, business, info)
            self.last_load_error = None
        log.info("loaded %s (%d parameters) in %.1f s", info.checkpoint, info.parameters, time.perf_counter() - started)
        if info.facts_source == "default":
            log.warning("%s has no business.json; checking replies against ai-model/config/business.json", info.name)
        return info

    def generate(self, history: list[Turn], settings: GenerationSettings) -> tuple[Reply, LoadedModel]:
        current = self._current
        if current is None:
            raise NoModelLoaded()
        if not self._run_lock.acquire(timeout=self.queue_timeout):
            raise EngineBusy()
        try:
            return generate_reply(current.model, current.tokenizer, history, settings), current
        finally:
            self._run_lock.release()
