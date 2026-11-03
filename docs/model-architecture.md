# Model architecture (Phase 7)

`ai-model/model/gpt.py` contains a GPT-style, decoder-only Transformer written from scratch in PyTorch.
All weights start random; no pretrained weights are used anywhere.

## Data flow

```
token ids (B, T)
  │ token embedding (V × C) + learned position embedding (T × C), dropout
  ▼
┌─ Block × n_layer ─────────────────────────────────────────────────┐
│  x = x + Attention(LayerNorm(x))     causal multi-head attention   │
│  x = x + FeedForward(LayerNorm(x))   C → 4C → GELU → C             │
└────────────────────────────────────────────────────────────────────┘
  │ final LayerNorm
  ▼
LM head (C × V; shares weights with the token embedding) → logits (B, T, V)
```

`B` = batch size, `T` = sequence length, `C` = `n_embd`, `H` = `n_head`, `D = C/H` = head size, `V` = vocabulary size.

## Components

| Component | Class | What it does |
|---|---|---|
| Token embedding | `nn.Embedding(V, C)` | Maps each token id to a learned C-dim vector |
| Positional embedding | `nn.Embedding(T, C)` | Learned vector per position, added to the token vector |
| Layer normalisation | `LayerNorm` | Normalises each vector to mean 0 / variance 1, then learned scale and shift. Written out by hand and tested against `F.layer_norm` |
| Self-attention | `MultiHeadAttention.attention_weights` | `softmax(Q·Kᵀ/√D)` with future positions masked to −∞, so each token sees only itself and earlier tokens |
| Multi-head attention | `MultiHeadAttention` | Splits C into H heads that attend independently, then concatenates and projects back |
| Feed-forward | `FeedForward` | Per-position MLP with a 4× expansion and GELU |
| Transformer block | `Block` | Pre-LayerNorm + residual connections around attention and the MLP |
| GPT | `GPT` | Embeddings → blocks → final LN → LM head; cross-entropy loss, where target `-100` means "ignore" |
| Sampling | `sample_next`, `GPT.generate` | Temperature (0 = greedy), top-k, top-p; stops at given ids; crops the prompt to the context length |

**Attention implementations.** `attention: "manual"` runs the explicit maths above.
`attention: "sdpa"` (the default) calls PyTorch's fused `scaled_dot_product_attention`, which
computes the same function. A test checks the two give the same output, and the fused one is
about 20% faster on this CPU.

**Initialisation (GPT-2).** Weights start as normal(0, 0.02), with biases zero. The residual output
projections are scaled down by `1/√(2·n_layer)` so the residual stream's variance stays stable with depth.

**Weight tying.** The LM head reuses the token-embedding matrix. That saves `V·C` parameters, and
encoding and decoding share one representation of each token.

## Parameter count

```
total = V·C (tokens) + T·C (positions) + L·(12C² + 13C) + 2C (final LN)
```

| Config | V | T | C | H | L | Params |
|---|---|---|---|---|---|---|
| `tiny-cpu` | 1,129* | 128 | 128 | 4 | 4 | **954,240** |
| `small-cpu` | 1,129* | 256 | 256 | 8 | 6 | **5,093,632** |

\* actual tokenizer vocabulary on the current synthetic data (see [dataset-and-tokenizer.md](dataset-and-tokenizer.md)).

The model's input/output layout is the tokenizer's conversation format:
`<|customer|>…<|end|><|assistant|>…<|end|>`. At inference the prompt ends with `<|assistant|>`,
and generation stops at `<|end|>`.

## Verified by tests (`ai-model/tests/test_model.py`)

- **LayerNorm:** matches PyTorch's own.
- **Attention:** rows sum to 1 and nothing attends to the future. The readable and fused versions give the same output.
- **Causality:** changing future tokens never changes earlier outputs, with either attention path.
- **Parameters:** the count matches the formula above exactly, and the head shares the embedding weights.
- **Starting loss:** about ln V, which is what an untrained model should score.
- **Backpropagation:** every parameter receives a gradient, and a small model memorises one batch (loss 4.1 → < 0.1).
- **Generation:** greedy decoding is deterministic, seeded sampling is reproducible, and top-k / top-p filtering is correct.

Speed measurements are in [hardware-and-model-sizing.md](hardware-and-model-sizing.md).
