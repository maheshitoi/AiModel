"""GPT-style decoder-only Transformer, written from scratch in PyTorch.

Every weight starts from random initialisation; nothing is loaded from a pretrained model.

Shapes: B = batch, T = sequence length, C = n_embd, H = n_head, D = C // H, V = vocab_size.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, fields
from typing import Any

import torch
import torch.nn.functional as F
from torch import nn


@dataclass(frozen=True)
class GPTConfig:
    vocab_size: int
    context_length: int = 128
    n_embd: int = 128
    n_head: int = 4
    n_layer: int = 4
    dropout: float = 0.1
    tie_embeddings: bool = True
    # "sdpa" uses PyTorch's fused kernel; "manual" spells the maths out. Both compute the same result.
    attention: str = "sdpa"

    def __post_init__(self) -> None:
        if self.n_embd % self.n_head:
            raise ValueError(f"n_embd ({self.n_embd}) must be divisible by n_head ({self.n_head})")
        if self.attention not in ("sdpa", "manual"):
            raise ValueError("attention must be 'sdpa' or 'manual'")

    @classmethod
    def from_dict(cls, data: dict[str, Any], **overrides: Any) -> "GPTConfig":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in {**data, **overrides}.items() if k in known})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LayerNorm(nn.Module):
    """Normalises each token vector to zero mean / unit variance, then applies a learned scale and shift."""

    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))
        self.bias = nn.Parameter(torch.zeros(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        mean = x.mean(dim=-1, keepdim=True)
        var = x.var(dim=-1, keepdim=True, unbiased=False)
        return (x - mean) / torch.sqrt(var + self.eps) * self.weight + self.bias


class MultiHeadAttention(nn.Module):
    """Causal multi-head self-attention: each position attends only to itself and earlier positions."""

    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.n_head = cfg.n_head
        self.head_dim = cfg.n_embd // cfg.n_head
        self.use_sdpa = cfg.attention == "sdpa"
        self.dropout = cfg.dropout
        self.qkv = nn.Linear(cfg.n_embd, 3 * cfg.n_embd)  # query, key and value projections in one matmul
        self.proj = nn.Linear(cfg.n_embd, cfg.n_embd)  # recombines the heads
        self.attn_dropout = nn.Dropout(cfg.dropout)
        self.resid_dropout = nn.Dropout(cfg.dropout)
        mask = torch.tril(torch.ones(cfg.context_length, cfg.context_length, dtype=torch.bool))
        self.register_buffer("causal_mask", mask.view(1, 1, cfg.context_length, cfg.context_length), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.shape
        # (B, T, 3C) → three tensors of (B, H, T, D)
        q, k, v = self.qkv(x).split(C, dim=2)
        q, k, v = (t.view(B, T, self.n_head, self.head_dim).transpose(1, 2) for t in (q, k, v))

        if self.use_sdpa:
            y = F.scaled_dot_product_attention(q, k, v, dropout_p=self.dropout if self.training else 0.0, is_causal=True)
        else:
            y = self.attend(q, k, v)

        y = y.transpose(1, 2).contiguous().view(B, T, C)  # concatenate heads
        return self.resid_dropout(self.proj(y))

    def attention_weights(self, q: torch.Tensor, k: torch.Tensor) -> torch.Tensor:
        """softmax(Q·Kᵀ / √D) with future positions masked out. Returns (B, H, T, T); rows sum to 1."""
        T = q.size(-2)
        scores = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        scores = scores.masked_fill(~self.causal_mask[:, :, :T, :T], float("-inf"))
        return F.softmax(scores, dim=-1)

    def attend(self, q: torch.Tensor, k: torch.Tensor, v: torch.Tensor) -> torch.Tensor:
        return self.attn_dropout(self.attention_weights(q, k)) @ v


class FeedForward(nn.Module):
    """Position-wise MLP: expand to 4C, GELU non-linearity, project back to C."""

    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.fc = nn.Linear(cfg.n_embd, 4 * cfg.n_embd)
        self.proj = nn.Linear(4 * cfg.n_embd, cfg.n_embd)
        self.dropout = nn.Dropout(cfg.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.dropout(self.proj(F.gelu(self.fc(x))))


class Block(nn.Module):
    """Pre-LayerNorm Transformer block with residual connections around attention and the MLP."""

    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.ln1 = LayerNorm(cfg.n_embd)
        self.attn = MultiHeadAttention(cfg)
        self.ln2 = LayerNorm(cfg.n_embd)
        self.ff = FeedForward(cfg)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln1(x))
        return x + self.ff(self.ln2(x))


class GPT(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.cfg = cfg
        self.token_emb = nn.Embedding(cfg.vocab_size, cfg.n_embd)
        self.pos_emb = nn.Embedding(cfg.context_length, cfg.n_embd)
        self.dropout = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList(Block(cfg) for _ in range(cfg.n_layer))
        self.ln_f = LayerNorm(cfg.n_embd)
        self.lm_head = nn.Linear(cfg.n_embd, cfg.vocab_size, bias=False)
        if cfg.tie_embeddings:
            self.lm_head.weight = self.token_emb.weight  # same matrix reads and writes token meaning

        self.apply(self._init_weights)
        # GPT-2: scale residual projections so the residual stream's variance doesn't grow with depth.
        for name, p in self.named_parameters():
            if name.endswith("proj.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * cfg.n_layer))

    @staticmethod
    def _init_weights(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_parameters(self, include_embeddings: bool = True) -> int:
        n = sum(p.numel() for p in self.parameters())  # shared tensors are counted once
        if not include_embeddings:
            n -= self.token_emb.weight.numel() + self.pos_emb.weight.numel()
        return n

    def forward(self, idx: torch.Tensor, targets: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor | None]:
        """idx: (B, T) token ids. targets: (B, T) next-token ids; -100 marks positions excluded from the loss."""
        B, T = idx.shape
        if T > self.cfg.context_length:
            raise ValueError(f"sequence length {T} exceeds context length {self.cfg.context_length}")
        pos = torch.arange(T, device=idx.device)
        x = self.dropout(self.token_emb(idx) + self.pos_emb(pos))
        for block in self.blocks:
            x = block(x)
        logits = self.lm_head(self.ln_f(x))  # (B, T, V)

        loss = None
        if targets is not None:
            # reshape (not view): targets are often a non-contiguous slice of a larger batch tensor.
            loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)), targets.reshape(-1), ignore_index=-100)
        return logits, loss

    @torch.no_grad()
    def generate(
        self,
        idx: torch.Tensor,
        max_new_tokens: int,
        temperature: float = 1.0,
        top_k: int = 0,
        top_p: float = 1.0,
        stop_ids: set[int] | None = None,
        generator: torch.Generator | None = None,
        token_probs: list[float] | None = None,
    ) -> torch.Tensor:
        """Autoregressive sampling for a single sequence (B = 1). Returns only the newly generated ids.

        temperature 0 means greedy decoding. The prompt is left-cropped to the context length.
        If `token_probs` is given, the model's unscaled probability of each chosen token (before
        temperature / top-k / top-p) is appended to it: a confidence signal for the caller.
        """
        if idx.size(0) != 1:
            raise ValueError("generate() expects a single sequence")
        was_training = self.training
        self.eval()
        new: list[int] = []
        for _ in range(max_new_tokens):
            window = idx[:, -self.cfg.context_length :]
            logits, _ = self(window)
            next_id = sample_next(logits[0, -1], temperature, top_k, top_p, generator)
            if token_probs is not None:
                token_probs.append(F.softmax(logits[0, -1].float(), dim=-1)[next_id].item())
            new.append(next_id)
            if stop_ids and next_id in stop_ids:
                break
            idx = torch.cat([idx, torch.tensor([[next_id]], device=idx.device)], dim=1)
        self.train(was_training)
        return torch.tensor(new, dtype=torch.long)


def sample_next(
    logits: torch.Tensor,
    temperature: float = 1.0,
    top_k: int = 0,
    top_p: float = 1.0,
    generator: torch.Generator | None = None,
) -> int:
    """Picks the next token id from a (V,) logits vector."""
    if temperature <= 0:
        return int(torch.argmax(logits))
    logits = logits / temperature
    if 0 < top_k < logits.size(-1):
        kth = torch.topk(logits, top_k).values[-1]
        logits = logits.masked_fill(logits < kth, float("-inf"))
    if top_p < 1.0:
        sorted_logits, order = torch.sort(logits, descending=True)
        cumulative = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
        # Drop tokens once the cumulative probability *before* them already exceeds top_p (keeps at least one).
        drop = cumulative - F.softmax(sorted_logits, dim=-1) > top_p
        logits = logits.masked_fill(drop.scatter(0, order, drop), float("-inf"))
    probs = F.softmax(logits, dim=-1)
    return int(torch.multinomial(probs, 1, generator=generator))
