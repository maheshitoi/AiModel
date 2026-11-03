"""Turn a conversation history into a reply. Shared by evaluation and the inference service."""

from __future__ import annotations

from dataclasses import dataclass

import torch

from dataset.schema import Turn
from tokenizer import BPETokenizer

from .gpt import GPT


@dataclass(frozen=True)
class GenerationSettings:
    max_new_tokens: int = 64
    temperature: float = 0.0  # 0 = greedy (deterministic)
    top_k: int = 0
    top_p: float = 1.0
    seed: int | None = None


@dataclass(frozen=True)
class Reply:
    text: str
    input_tokens: int
    output_tokens: int
    finished: bool  # True if the model emitted <|end|> before hitting max_new_tokens


def build_prompt(tokenizer: BPETokenizer, history: list[Turn], context_length: int, reserve: int) -> list[int]:
    """Encodes the history followed by <|assistant|>, dropping the oldest whole turns until it fits.

    `reserve` tokens are kept free for the reply. The latest customer turn is always kept, truncated
    from the left if it alone is too long.
    """
    budget = context_length - reserve
    assistant = tokenizer.special_id("<|assistant|>")
    turns = list(history)
    while True:
        ids = tokenizer.encode_conversation(turns) + [assistant]
        if len(ids) <= budget or len(turns) <= 1:
            return ids[-budget:]
        turns = turns[1:]


@torch.no_grad()
def generate_reply(model: GPT, tokenizer: BPETokenizer, history: list[Turn], settings: GenerationSettings) -> Reply:
    reserve = min(settings.max_new_tokens, model.cfg.context_length // 2)
    prompt = build_prompt(tokenizer, history, model.cfg.context_length, reserve)
    device = next(model.parameters()).device
    generator = torch.Generator(device=device).manual_seed(settings.seed) if settings.seed is not None else None
    stop = {tokenizer.end_id, *(tokenizer.special_id(t) for t in ("<|customer|>", "<|assistant|>", "<|system|>", "<|pad|>"))}
    out = model.generate(
        torch.tensor([prompt], device=device),
        max_new_tokens=settings.max_new_tokens,
        temperature=settings.temperature,
        top_k=settings.top_k,
        top_p=settings.top_p,
        stop_ids=stop,
        generator=generator,
    ).tolist()
    finished = bool(out) and out[-1] == tokenizer.end_id
    content = [i for i in out if i not in stop]
    return Reply(text=tokenizer.decode(content).strip(), input_tokens=len(prompt), output_tokens=len(out), finished=finished)
