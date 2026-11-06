"""Train the GPT model from random initialisation.

    python -m training.train --config config/tiny-cpu.json [--out checkpoints/my-run] [--max-steps N]
    python -m training.train --config config/tiny-cpu.json --out checkpoints/my-run --resume

Run directory contents:
    config.json     the exact config + dataset fingerprint used
    tokenizer.json  copy of the tokenizer the model was trained with
    business.json   copy of the business facts in the synthetic data (if any)
    best.pt         checkpoint with the lowest validation loss (use this one for inference)
    last.pt         latest checkpoint (for --resume)
    metrics.jsonl   one JSON object per log/eval event (read by the backend/dashboard)
    status.json     current state: running / completed / early_stopped / stopped / interrupted / failed
    STOP            create this file to stop safely; a checkpoint is saved first
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil
import torch

from model import GPT, GPTConfig
from model.checkpoint import read_checkpoint, save_checkpoint

from .data import TokenSplit, load_splits

AI_MODEL_ROOT = Path(__file__).resolve().parents[1]


def lr_at(step: int, cfg: dict[str, Any]) -> float:
    """Linear warm-up to the peak rate, then cosine decay to the minimum by max_steps."""
    peak, low, warmup, total = cfg["learning_rate"], cfg["min_learning_rate"], cfg["warmup_steps"], cfg["max_steps"]
    if step < warmup:
        return peak * (step + 1) / warmup
    progress = min(1.0, (step - warmup) / max(1, total - warmup))
    return low + 0.5 * (peak - low) * (1 + math.cos(math.pi * progress))


def make_optimizer(model: GPT, lr: float, weight_decay: float) -> torch.optim.AdamW:
    """Weight decay on matrices (linear weights, embeddings); none on biases and LayerNorm parameters."""
    params = dict(model.named_parameters())  # tied weights appear once
    decay = [p for p in params.values() if p.dim() >= 2]
    no_decay = [p for p in params.values() if p.dim() < 2]
    return torch.optim.AdamW(
        [{"params": decay, "weight_decay": weight_decay}, {"params": no_decay, "weight_decay": 0.0}],
        lr=lr,
        betas=(0.9, 0.95),
    )


@torch.no_grad()
def estimate_loss(model: GPT, split: TokenSplit, batch_size: int, batches: int, seed: int, device: str) -> float:
    """Mean loss over a fixed set of windows (same seed every time, so evaluations are comparable)."""
    generator = torch.Generator().manual_seed(seed)
    model.eval()
    total = 0.0
    for _ in range(batches):
        x, y = split.batch(batch_size, model.cfg.context_length, generator)
        total += model(x.to(device), y.to(device))[1].item()
    model.train()
    return total / batches


def resolve_device(setting: str) -> str:
    if setting == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return setting


class RunLog:
    def __init__(self, out_dir: Path):
        self.out_dir = out_dir
        self.metrics = (out_dir / "metrics.jsonl").open("a", encoding="utf-8")

    def event(self, **data: Any) -> None:
        self.metrics.write(json.dumps({"time": datetime.now(timezone.utc).isoformat(timespec="seconds"), **data}) + "\n")
        self.metrics.flush()

    def status(self, **data: Any) -> None:
        tmp = self.out_dir / "status.json.tmp"
        tmp.write_text(json.dumps({"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **data}, indent=2))
        tmp.replace(self.out_dir / "status.json")

    def close(self) -> None:
        self.metrics.close()


def train(config_path: Path, data_dir: Path, out_dir: Path, resume: bool = False, max_steps: int | None = None) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    tcfg = {**config["training"], **({"max_steps": max_steps} if max_steps else {})}
    seed, device = config["seed"], resolve_device(tcfg["device"])
    torch.manual_seed(seed)
    if device == "cpu":
        torch.set_num_threads(tcfg["num_threads"])

    tokenizer, train_split, val_split = load_splits(data_dir, tcfg["loss_on"])
    model_cfg = GPTConfig.from_dict(config["model"], vocab_size=tokenizer.vocab_size)
    model = GPT(model_cfg).to(device)
    optimizer = make_optimizer(model, tcfg["learning_rate"], tcfg["weight_decay"])
    data_gen = torch.Generator().manual_seed(seed)

    out_dir.mkdir(parents=True, exist_ok=True)
    step, best_val, best_step, evals_since_best = 0, math.inf, 0, 0
    if resume:
        state = read_checkpoint(out_dir / "last.pt")
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        data_gen.set_state(state["rng_state"])
        step, best_val, best_step, evals_since_best = state["step"], state["best_val_loss"], state["best_step"], state["evals_since_best"]
    else:
        stats_file = data_dir / "stats.json"
        dataset_stats = json.loads(stats_file.read_text(encoding="utf-8")) if stats_file.exists() else None
        run_config = {**config, "training": tcfg, "model_resolved": model_cfg.to_dict(), "device": device, "dataset_stats": dataset_stats}
        (out_dir / "config.json").write_text(json.dumps(run_config, indent=2), encoding="utf-8")
        shutil.copyfile(data_dir / "tokenizer.json", out_dir / "tokenizer.json")
        # The inference guardrails check replies against the facts the model was trained on.
        if (data_dir / "business.json").exists():
            shutil.copyfile(data_dir / "business.json", out_dir / "business.json")
    (out_dir / "STOP").unlink(missing_ok=True)

    B, T = tcfg["batch_size"], model_cfg.context_length
    tokens_per_step = B * T
    log = RunLog(out_dir)
    proc = psutil.Process()
    proc.cpu_percent(None)  # prime the counter

    def checkpoint(name: str) -> None:
        save_checkpoint(
            out_dir / name,
            model,
            optimizer=optimizer.state_dict(),
            rng_state=data_gen.get_state(),
            step=step,
            best_val_loss=best_val,
            best_step=best_step,
            evals_since_best=evals_since_best,
            config_name=config["name"],
            saved_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )

    summary_base = {"config": config["name"], "parameters": model.num_parameters(), "max_steps": tcfg["max_steps"]}
    status, started = "completed", time.perf_counter()
    window_loss, window_steps, window_start = 0.0, 0, time.perf_counter()
    try:
        log.status(status="running", step=step, **summary_base, device=device, pid=proc.pid)
        log.event(type="start", step=step, resumed=resume, device=device, parameters=model.num_parameters(),
                  train_tokens=len(train_split), val_tokens=len(val_split))
        print(f"Training {config['name']}: {model.num_parameters():,} parameters on {device}, "
              f"{len(train_split):,} train tokens, steps {step} -> {tcfg['max_steps']}")
        while step < tcfg["max_steps"]:
            if (out_dir / "STOP").exists():
                status = "stopped"
                break
            lr = lr_at(step, tcfg)
            for group in optimizer.param_groups:
                group["lr"] = lr
            x, y = train_split.batch(B, T, data_gen)
            _, loss = model(x.to(device), y.to(device))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), tcfg["grad_clip"]).item()
            optimizer.step()
            step += 1
            window_loss += loss.item()
            window_steps += 1

            if step % tcfg["log_interval"] == 0 or step == 1:
                elapsed = time.perf_counter() - window_start
                event = {
                    "type": "train",
                    "step": step,
                    "epoch": round(step * tokens_per_step / len(train_split), 3),
                    "train_loss": round(window_loss / window_steps, 4),
                    "lr": lr,
                    "grad_norm": round(grad_norm, 4),
                    "tokens_per_sec": round(window_steps * tokens_per_step / elapsed),
                    "cpu_percent": psutil.cpu_percent(None),
                    "process_cpu_percent": proc.cpu_percent(None),
                    "rss_mb": round(proc.memory_info().rss / 2**20),
                    "elapsed_s": round(time.perf_counter() - started),
                }
                if device == "cuda":
                    event["gpu_memory_mb"] = round(torch.cuda.memory_allocated() / 2**20)
                log.event(**event)
                log.status(status="running", step=step, best_val_loss=None if math.isinf(best_val) else best_val, **summary_base, device=device, pid=proc.pid)
                print(f"step {step:5d}  loss {event['train_loss']:.4f}  lr {lr:.2e}  {event['tokens_per_sec']:,} tok/s")
                window_loss, window_steps, window_start = 0.0, 0, time.perf_counter()

            if step % tcfg["eval_interval"] == 0 or step == tcfg["max_steps"]:
                train_loss = estimate_loss(model, train_split, B, tcfg["eval_batches"], seed + 1, device)
                val_loss = estimate_loss(model, val_split, B, tcfg["eval_batches"], seed + 2, device)
                improved = val_loss < best_val
                if improved:
                    best_val, best_step, evals_since_best = val_loss, step, 0
                    checkpoint("best.pt")
                else:
                    evals_since_best += 1
                log.event(type="eval", step=step, train_loss=round(train_loss, 4), val_loss=round(val_loss, 4),
                          val_perplexity=round(math.exp(val_loss), 3), best=improved)
                print(f"  eval: train {train_loss:.4f}  val {val_loss:.4f}  (ppl {math.exp(val_loss):.2f}){'  * best' if improved else ''}")
                patience = tcfg.get("early_stop_patience") or 0
                if patience and evals_since_best >= patience:
                    status = "early_stopped"
                    break

            if step % tcfg["checkpoint_interval"] == 0:
                checkpoint("last.pt")
    except KeyboardInterrupt:
        status = "interrupted"
    except Exception as error:
        checkpoint("last.pt")
        log.event(type="end", step=step, status="failed", error=str(error))
        log.status(status="failed", step=step, error=str(error), **summary_base)
        log.close()
        raise

    checkpoint("last.pt")
    summary = {
        **summary_base,
        "status": status,
        "steps": step,
        "best_val_loss": None if math.isinf(best_val) else round(best_val, 4),
        "best_val_perplexity": None if math.isinf(best_val) else round(math.exp(best_val), 3),
        "best_step": best_step,
        "duration_s": round(time.perf_counter() - started),
        "out_dir": str(out_dir),
    }
    log.event(type="end", **summary)
    log.status(**summary)
    log.close()
    # Only after the final status is written, so a watcher never sees "running" without a stop request.
    (out_dir / "STOP").unlink(missing_ok=True)
    print(f"Finished ({status}) at step {step}; best val loss {summary['best_val_loss']} at step {best_step}")
    return summary


def main() -> None:
    # Redirected output on Windows defaults to cp1252; the backend captures this process's output.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Train the GPT model from scratch")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=AI_MODEL_ROOT / "dataset" / "processed")
    parser.add_argument("--out", type=Path, help="run directory (default: checkpoints/<config>-<timestamp>)")
    parser.add_argument("--resume", action="store_true", help="continue from <out>/last.pt")
    parser.add_argument("--max-steps", type=int, help="override training.max_steps")
    args = parser.parse_args()
    if args.resume and not args.out:
        parser.error("--resume requires --out")
    name = json.loads(args.config.read_text(encoding="utf-8"))["name"]
    out = args.out or AI_MODEL_ROOT / "checkpoints" / f"{name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    train(args.config, args.data, out, resume=args.resume, max_steps=args.max_steps)


if __name__ == "__main__":
    main()
