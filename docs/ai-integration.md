# Backend ↔ AI service (Phase 10)

The NestJS backend is the only caller of the AI service. It decides when the AI runs, stores what
the AI decided, and controls what gets sent. Code: `apps/backend/src/ai/`.

| File | Responsibility |
|---|---|
| `ai-client.service.ts` | HTTP client. Sends `X-Internal-Token`, applies a timeout, retries once when the model is busy, and maps failures to typed errors whose messages never include the request body |
| `ai-reply.service.ts` | `handleInbound(messageId)`: builds the history, calls the AI, stores the decision and usage, and queues or suggests the reply. Also approve and dismiss for suggestions |
| `model-registry.service.ts` | Maps checkpoints to `ModelVersion` rows, handles activation, and reloads the active version if the AI service is serving something else |
| `ai.controller.ts` | Dashboard endpoints (below) |

## One inbound message

```
inbound TEXT message (Phase 11 webhook calls handleInbound)
  │  skip if: a decision exists already (returned as is) · not text · AI off for the conversation
  │           · conversation HUMAN/CLOSED · a newer customer message is waiting (that one is answered)
  ▼
last `historyMessages` text messages → POST /v1/generate (settings from ai.generation)
  │  AI service fails → AIUsage(success=false), SystemLog ai.request_failed (no text),
  │                     conversation flagged "ai_unavailable"; can be retried later
  ▼
one transaction:
  AIDecision (unique per inbound message) + AIUsage (tokens, latency, model version)
  send now?  ──yes──▶ outbound Message QUEUED (aiReplyToId = inbound, unique) → Phase 11 sends it
     │ no
     └──────────────▶ AIDecision SUGGESTED, waiting for staff
  handoff_required → conversation.needsAttention + attentionReason
  action handoff   → conversation.status = HUMAN (the AI stops answering it)
```

**Sent now** means one of:

- the WhatsApp account has `autoReplyEnabled` (off by default), or
- the reply is the fixed **emergency or self-harm** reply and `ai.generation.sendSafetyRepliesImmediately`
  is true (the default). Waiting for staff could cost time the customer doesn't have.

Everything else waits as a suggestion:

| Staff action | Result |
|---|---|
| Approve | Queues the text. If staff edited it, the message is recorded as `HUMAN`, sent by them |
| Dismiss | Nothing is sent |

Both actions are atomic: a second approval gets 409.

**Concurrency:** the same message processed twice, even at the same moment, still gives one
decision and at most one reply. Unique `AIDecision.inboundMessageId` and `Message.aiReplyToId`
enforce this. The integration tests cover it.

## Endpoints (`/api/v1/ai`)

| Route | Permission | Purpose |
|---|---|---|
| `GET /ai/status` | `models:read` | Whether the AI service is reachable, the loaded model, the active version, and whether they match (`inSync`) |
| `GET /ai/checkpoints` | `models:read` | Checkpoint files the AI service can load |
| `POST /ai/models/activate` | `models:manage` | `{ checkpoint }`: load it in the AI service, then make it the single active `ModelVersion` (audited) |
| `POST /ai/test` | `conversations:reply` | Playground: `{ messages }` → the full decision. Records usage only. Limited to 20/min |
| `GET /ai/decisions` | `conversations:read` | Paginated, filter by `status` and `conversationId` |
| `POST /ai/decisions/:id/approve` | `conversations:reply` | `{ text? }`: queue the suggestion, optionally edited |
| `POST /ai/decisions/:id/dismiss` | `conversations:reply` | Don't send it |

AI service failures map to these statuses:

| Status | Cause |
|---|---|
| 503 | Unreachable, timeout, no model loaded, or busy |
| 502 | Token mismatch or a bad response from the AI service |
| 400 / 404 | Rejected request, or an unknown checkpoint |

## Settings: `ai.generation`

| Field | Default | Notes |
|---|---|---|
| `temperature` / `topK` / `topP` | 0 / 0 / 1 | Greedy decoding is what was evaluated. Older untouched defaults (0.8 / 40 / 0.9) are upgraded by `npm run db:seed` |
| `maxNewTokens` | 64 | |
| `minConfidence` | 0.5 | The confidence gate ([inference.md](inference.md)) |
| `historyMessages` | 20 | Text messages sent as context |
| `fallbackReply` | "Thanks for your message…" | Sent when the model's reply is rejected |
| `sendSafetyRepliesImmediately` | true | See above |
| `systemInstructions` | "" | Not used yet: the model wasn't trained with system turns |

## Environment

| Variable | Purpose |
|---|---|
| `AI_SERVICE_URL` | Address of the AI service |
| `AI_SERVICE_TOKEN` | Must equal the AI service's value. The backend refuses to start without it (minimum 32 characters) |
| `AI_REQUEST_TIMEOUT_MS` | Per-request timeout (default 15,000) |

Model loading uses a longer, fixed 120 s timeout.

## Model versions

A checkpoint gets a `ModelVersion` the first time the AI service reports it, linked from `AIUsage`
and `AIDecision`. The active version is the single source of truth:

- When the backend starts, and after AI replies, it checks what the AI service is serving.
- If that differs (for example, the AI service restarted with another `AI_MODEL_CHECKPOINT`), the
  backend loads the active version again and logs `model.reloaded`.
