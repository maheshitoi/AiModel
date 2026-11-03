"""Measure real training-step speed for a config on this machine.

    python -m model.benchmark --config config/tiny-cpu.json [--steps 20] [--attention manual]

Uses the tokenizer and train.bin produced by `python -m dataset.build`.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from tokenizer import BPETokenizer

from .gpt import GPT, GPTConfig

AI_MODEL_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark training steps for a model config")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=AI_MODEL_ROOT / "dataset" / "processed")
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--attention", choices=["sdpa", "manual"], default="sdpa")
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    train_cfg = config["training"]
    torch.manual_seed(config["seed"])
    torch.set_num_threads(train_cfg["num_threads"])

    tokenizer = BPETokenizer.load(args.data / "tokenizer.json")
    data = torch.from_numpy(np.fromfile(args.data / "train.bin", dtype=np.uint16).astype(np.int64))
    cfg = GPTConfig.from_dict(config["model"], vocab_size=tokenizer.vocab_size, attention=args.attention)
    model = GPT(cfg).train()
    opt = torch.optim.AdamW(model.parameters(), lr=train_cfg["learning_rate"], weight_decay=train_cfg["weight_decay"])
    B, T = train_cfg["batch_size"], cfg.context_length

    def step() -> float:
        ix = torch.randint(len(data) - T - 1, (B,))
        x = torch.stack([data[i : i + T] for i in ix])
        y = torch.stack([data[i + 1 : i + T + 1] for i in ix])
        _, loss = model(x, y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), train_cfg["grad_clip"])
        opt.step()
        return loss.item()

    for _ in range(3):  # warm-up: allocator and kernel selection
        step()
    start = time.perf_counter()
    for _ in range(args.steps):
        loss = step()
    per_step = (time.perf_counter() - start) / args.steps

    total_steps = train_cfg["max_steps"]
    print(f"config            {config['name']}  (attention={args.attention}, threads={torch.get_num_threads()})")
    print(f"vocab / context   {cfg.vocab_size} / {cfg.context_length}")
    print(f"parameters        {model.num_parameters():,} total, {model.num_parameters(include_embeddings=False):,} non-embedding")
    print(f"batch             {B} x {T} = {B * T:,} tokens/step")
    print(f"step time         {per_step * 1000:.0f} ms  ({B * T / per_step:,.0f} tokens/s)")
    print(f"{total_steps} steps        ~{total_steps * per_step / 60:.0f} min  (≈{total_steps * B * T / len(data):.1f} epochs over {len(data):,} train tokens)")
    print(f"loss after warm-up {loss:.3f}  (ln V = {np.log(cfg.vocab_size):.3f})")


if __name__ == "__main__":
    main()
