"""Batches of (input, target) windows from the uint16 token files written by dataset.build."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from tokenizer import BPETokenizer

IGNORE = -100


def assistant_mask(tokens: np.ndarray, tokenizer: BPETokenizer) -> np.ndarray:
    """True for tokens inside an assistant turn (its text and its closing <|end|>), False elsewhere.

    Computed once for the whole stream: each position looks up the most recent role marker.
    """
    markers = np.array([tokenizer.special_id(t) for t in ("<|customer|>", "<|assistant|>", "<|system|>")])
    is_marker = np.isin(tokens, markers)
    last_marker = np.maximum.accumulate(np.where(is_marker, np.arange(len(tokens)), -1))
    role = np.where(last_marker >= 0, tokens[np.maximum(last_marker, 0)], -1)
    return (role == tokenizer.special_id("<|assistant|>")) & ~is_marker


class TokenSplit:
    """One split (train or validation) held in memory with its loss mask."""

    def __init__(self, path: Path, tokenizer: BPETokenizer, loss_on: str):
        if loss_on not in ("assistant", "all"):
            raise ValueError("loss_on must be 'assistant' or 'all'")
        tokens = np.fromfile(path, dtype=np.uint16).astype(np.int64)
        self.tokens = torch.from_numpy(tokens)
        mask = assistant_mask(tokens, tokenizer) if loss_on == "assistant" else np.ones(len(tokens), dtype=bool)
        self.mask = torch.from_numpy(mask)

    def __len__(self) -> int:
        return len(self.tokens)

    def batch(self, batch_size: int, context: int, generator: torch.Generator) -> tuple[torch.Tensor, torch.Tensor]:
        """Random windows; targets are the inputs shifted by one, with non-trained positions set to -100."""
        if len(self.tokens) <= context + 1:
            raise ValueError(f"split has {len(self.tokens)} tokens, fewer than context_length + 1")
        starts = torch.randint(len(self.tokens) - context - 1, (batch_size,), generator=generator)
        offsets = torch.arange(context)
        idx = starts[:, None] + offsets[None, :]
        x = self.tokens[idx]
        y = self.tokens[idx + 1].masked_fill(~self.mask[idx + 1], IGNORE)
        return x, y


def load_splits(data_dir: Path, loss_on: str) -> tuple[BPETokenizer, TokenSplit, TokenSplit]:
    tokenizer = BPETokenizer.load(data_dir / "tokenizer.json")
    return tokenizer, TokenSplit(data_dir / "train.bin", tokenizer, loss_on), TokenSplit(data_dir / "val.bin", tokenizer, loss_on)
