# Hardware analysis & model sizing

Analysed on 2026-11-03 (Phase 1).

## Development machine

| Item | Value | Impact |
|---|---|---|
| OS | Windows 10 Pro 22H2 (build 19045) | OK |
| CPU | Intel Core i5-7300U, 2 cores / 4 threads, 2.6 GHz (laptop, 7th gen) | **The training bottleneck** |
| RAM | 15.8 GB total (~5 GB free while idle apps run) | Enough for small models + all services |
| GPU | Intel HD Graphics 620 (integrated, 1 GB shared) | **Not usable by PyTorch** |
| NVIDIA CUDA | Not available (no `nvidia-smi`, no `nvcc`) | CPU-only training |
| Disk | C: 49 GB free, D: 99 GB free | Project lives on D: |
| Node.js / npm | v22.15.0 / 9.1.2 | OK |
| Python | 3.11.5 | OK (PyTorch supports it) |
| PostgreSQL | 16 (port 5432), 17 (5433), 18 (5434) as Windows services | Using 17 on 5433 (database `Ai-model`) |
| Docker | 28.4.0 installed, daemon not running | Optional; not needed for local dev |
| Git | 2.38.1 | OK |

## What this means for the model

Without a CUDA GPU, every training step runs on two laptop CPU cores. A rough estimate
is about 6 × parameters × tokens FLOPs per step. PyTorch on this CPU realistically sustains
around 25–40 GFLOP/s on small matrices. So:

| Config | Params | Tokens/step | Est. time/step | 5,000 steps |
|---|---|---|---|---|
| `tiny-cpu` (d=128, L=4, H=4, ctx=128, vocab=4096) | ~1.3M | 2,048 | ~0.4–0.7 s | **~40–60 min** |
| `small-cpu` (d=256, L=6, H=8, ctx=256, vocab=8192) | ~6.8M | 4,096 | ~4–6 s | ~6–8 h (overnight) |
| 25M+ params | — | — | — | days; use a cloud GPU instead |

Measured on 2026-11-03: PyTorch 2.15 (CPU, 4 threads) reaches **~65 GFLOP/s** on a 2048×128·128×512
matmul.

### Measured training speed (Phase 7, `python -m model.benchmark`)

Full steps (forward + backward + AdamW + grad clipping) on the real tokenized data. The vocabulary
is 1,129 (what the synthetic data supports), not the configured 4,096/8,192, so parameter counts
are lower than the estimates above.

| Config | Params | Step time | Throughput | 5,000 steps | Epochs over current data |
|---|---|---|---|---|---|
| `tiny-cpu` | 954k | **658 ms** | 3,115 tok/s | **~55 min** | ~22 |
| `tiny-cpu`, manual attention | 954k | 796 ms | 2,572 tok/s | ~66 min | ~22 |
| `small-cpu` | 5.1M | **5.6 s** | 730 tok/s | **~7.8 h** | ~44 |

Both are within the original estimates. The binding constraint is now **data, not compute**:
5,000 steps already cycles through the synthetic dataset 22 times on `tiny-cpu`. Phase 8 therefore
trains `tiny-cpu` with validation-loss tracking and keeps the best checkpoint. `small-cpu` only
makes sense once more varied (approved real) data exists.

## Recommendation

1. **Start with `ai-model/config/tiny-cpu.json`.** It trains in under an hour, so the whole pipeline
   (tokenizer → training → checkpoint → FastAPI → NestJS → WhatsApp) can be built and tested quickly.
2. Move to **`small-cpu.json`** for an overnight run once the pipeline works.
3. For anything larger, rent a GPU (any NVIDIA card with CUDA). The same code runs unchanged
   because `device: "auto"` picks CUDA when it's present.

## Honest expectations

A 1–7M parameter model trained from scratch on a small synthetic dataset will:

- learn the *format* of short customer-service replies and frequent phrases,
- **not** understand open-ended questions, reason, or reliably state facts,
- often produce repetitive or off-topic text on inputs unlike its training data.

For that reason, the platform keeps human takeover, per-conversation AI on/off switches, and
evaluation reports in scope from the start. Treat auto-replies as low-trust until evaluation in
Phase 8 shows otherwise.
