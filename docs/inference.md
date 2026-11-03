# Inference service (Phase 9)

`apps/ai-service` is a FastAPI service that loads a trained checkpoint and decides the reply to a
customer message. Only the NestJS backend calls it. It never sends WhatsApp messages itself.

```powershell
npm run dev:ai                                      # http://localhost:8000  (OpenAPI docs: /docs)
npm run test:ai                                     # 97 tests
npm run ai:evaluate-guarded -- tiny-cpu-v1/best.pt  # what customers would receive, per prompt
```

## Configuration (root `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `AI_SERVICE_TOKEN` | (none) | Shared secret, at least 32 characters. The backend sends it as `X-Internal-Token`. If it isn't set, every `/v1` route returns 503 |
| `AI_MODEL_CHECKPOINT` | (none) | Checkpoint loaded at startup, relative to `CHECKPOINT_DIR`, e.g. `tiny-cpu-v1/best.pt` |
| `AI_MIN_CONFIDENCE` | `0.5` | The confidence gate (see below) |
| `AI_QUEUE_TIMEOUT_SECONDS` | `10` | How long a request waits for the model before getting 503 |
| `AI_TORCH_THREADS` | PyTorch default | CPU threads used for inference |
| `AI_SERVICE_HOST` / `AI_SERVICE_PORT` | `127.0.0.1` / `8000` | Bind address. Keep it on localhost or a private network |

## How a reply is decided

```
customer message(s)
   │
   ▼
1. Safety rules ── match ──▶ handoff: fixed reply, handoff_required, the model never runs
   │ no match
   ▼
2. Model (greedy)  ─────────▶ records each token's probability
   │
   ▼
3. Reply checks ── fail ───▶ fallback: generic reply, handoff_required
   │   no end token · claims an action ("I've booked…") · dosages
   │   · details neither the customer nor the business facts gave
   │     (names, booking day/time/service, prices, phone, email)
   ▼
4. Confidence gate ── lowest token probability < AI_MIN_CONFIDENCE ──▶ fallback
   │
   ▼
reply: the model's text, no handoff needed
```

1. **Safety rules** (`app/guardrails/safety.py`) check every customer message since the last
   assistant turn, in this order: self-harm → emergency → medical advice → request for a person.
   Each match has a fixed reply (`app/guardrails/replies.py`), built from the business facts.
2. **Business facts:** replies are checked against the `business.json` saved with the training run.
   Runs trained before this phase fall back to `ai-model/config/business.json` (`facts_source` says which).
3. **Every response carries text that is safe to send.** Whether it actually gets sent, and whether
   a person must approve it first, is the backend's decision. Auto-reply is off by default.

## API

All `/v1` routes need `X-Internal-Token`. `/health` is public.

| Route | Purpose |
|---|---|
| `GET /health` | Runtime and loaded-model name |
| `POST /v1/generate` | Decide the reply. Body: `{ request_id?, messages: [{role: customer\|assistant, text}], options? }` |
| `GET /v1/models/current` | Loaded model details and the last load error |
| `GET /v1/models/checkpoints` | `.pt` files under `CHECKPOINT_DIR` |
| `POST /v1/models/load` | `{ checkpoint: "run/best.pt" }`: load and swap in. The old model keeps serving until the new one is ready. Paths outside `CHECKPOINT_DIR` get 400 |

`options`: `max_new_tokens` (1–256, default 64), `temperature` (default 0 = greedy), `top_k`, `top_p`,
`seed`, `min_confidence`, `fallback_reply`.

A response has these fields:

- `action`: `reply`, `fallback` or `handoff`.
- `text`: the text to send.
- `reason`: one of:
  - `model_reply`
  - `emergency`, `self_harm`, `medical_advice`, `human_request`
  - `no_reply`, `incomplete`, `action_claim`, `medical_content`, `ungrounded`, `low_confidence`
- `detail`: which rule or check matched.
- `handoff_required`.
- `confidence`: the lowest token probability.
- `model_text`: the model's own reply, kept for review. Never send it when `action != reply`.
- `usage`, `latency_ms`, `model`.

Errors:

| Status | Meaning |
|---|---|
| 401 | Bad token |
| 422 | Invalid request. Errors give the field and reason only, never the submitted text |
| 503 | No model is loaded, the model is busy (`Retry-After`), or no token is configured |

Safety rules still answer when no model is loaded.

**Privacy:** the service logs request ids, decisions, confidence, token counts and latency, never
message text. Tests check this.

## Results with `tiny-cpu-v1` (2026-11-03)

These are the same 22 prompts as the Phase 8 evaluation, sent through the full pipeline at
`AI_MIN_CONFIDENCE=0.5`:

| Group | Correct | Fallback | Wrong |
|---|---|---|---|
| in_distribution | 11 | 0 | 0 |
| paraphrased | 1 | 3 | 3 |
| safety | **3** | 0 | 0 |
| out_of_scope | 0 | 2 | 0 |
| **Total** | **15** | **5** | **3** |

Without guardrails (Phase 8), the same prompts gave 14 correct and 8 wrong. Those 8 included the
invented booking for a person who "collapsed and is not breathing".

Now, every emergency and medical-advice prompt gets the fixed reply. Every invented booking is
caught by the reply checks: the made-up names Aisha and Anna didn't appear anywhere in the
conversation.

The 3 remaining wrong replies are paraphrases the model misread, and the model was confident
about them:

| Customer | Reply sent | Confidence |
|---|---|---|
| "can i pay with my phone" | Gave the phone number | 0.99 |
| "r u open sundays?" | Gave the off-topic refusal | 0.74 |
| "I'd like to schedule a visit for next week" | Gave the off-topic refusal | 0.50 |

These replies are unhelpful, not dangerous, and no check can catch them without understanding
the question.

Effect of the confidence threshold:

| Threshold | 0.0 | 0.3 | 0.5 | 0.6 | 0.8 | 0.9 |
|---|---|---|---|---|---|---|
| Correct / fallback / wrong | 17/3/3 | 16/4/3 | 15/5/3 | 12/9/2 | 12/10/1 | 11/11/1 |

The default stays at 0.5. Going higher mostly turns correct answers into fallbacks. With only 22
prompts, the exact threshold isn't statistically meaningful, so re-run `ai:evaluate-guarded` on
real (approved) conversations before relying on it.

The safety rules match all 94 emergency, 437 medical-advice and 452 handoff conversations in the
dataset, and flag none of the other 6,423. They also catch 35 test phrasings that aren't in the
templates. They are still keyword rules: they **will** miss misspellings, slang and other
languages, and they deliberately err towards escalating. Treat them as a floor, not as a guarantee.

## Limits

- **Single process:** one generation runs at a time. On this CPU, a reply takes about 0.1–0.35 s,
  so a queue only forms under bursts. Requests that wait longer than `AI_QUEUE_TIMEOUT_SECONDS`
  get 503.
- **No system prompt:** the `ai.generation.systemInstructions` setting isn't used. The model wasn't
  trained with `<|system|>` turns and would ignore them.
- **Sampling:** the backend's `ai.generation` defaults (temperature 0.8, top-k 40) were set before
  evaluation. Greedy decoding (temperature 0) is what was evaluated. Phase 10 sends temperature 0
  unless changed.
