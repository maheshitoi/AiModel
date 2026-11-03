"""Checkpoint format shared by training (save/resume) and inference (load)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import torch

from tokenizer import BPETokenizer

from .gpt import GPT, GPTConfig

FORMAT_VERSION = 1


def save_checkpoint(path: Path, model: GPT, **extra: Any) -> None:
    """Writes atomically (temp file + rename) so a crash never leaves a half-written checkpoint.

    `extra` may hold optimizer state, step, metrics, RNG state and the run config: anything torch.save
    can store with plain tensors, numbers, strings, lists and dicts.
    """
    payload = {"format_version": FORMAT_VERSION, "model_config": model.cfg.to_dict(), "model": model.state_dict(), **extra}
    tmp = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, tmp)
    os.replace(tmp, path)


def read_checkpoint(path: Path) -> dict[str, Any]:
    # weights_only=True: refuses to unpickle arbitrary objects from an untrusted checkpoint file.
    payload = torch.load(path, map_location="cpu", weights_only=True)
    if payload.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"{path} is not a version-{FORMAT_VERSION} checkpoint")
    return payload


def load_model(path: Path, device: str = "cpu") -> tuple[GPT, BPETokenizer, dict[str, Any]]:
    """Loads a trained model for inference, with the tokenizer stored next to the checkpoint."""
    payload = read_checkpoint(path)
    model = GPT(GPTConfig(**payload["model_config"]))
    model.load_state_dict(payload["model"])
    model.to(device).eval()
    tokenizer = BPETokenizer.load(Path(path).parent / "tokenizer.json")
    if tokenizer.vocab_size != model.cfg.vocab_size:
        raise ValueError("tokenizer.json does not match the checkpoint's vocabulary size")
    meta = {k: v for k, v in payload.items() if k not in ("model", "optimizer", "rng_state")}
    return model, tokenizer, meta
