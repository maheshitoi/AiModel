# Development progress

Legend: [x] done and verified · [~] in progress / partially verified · [ ] not started

## Phase 1 – Environment analysis & monorepo bootstrap
- [x] Hardware & toolchain analysis ([hardware-and-model-sizing.md](hardware-and-model-sizing.md))
- [x] Model size recommendation (`ai-model/config/tiny-cpu.json`, `small-cpu.json`)
- [x] Monorepo with npm workspaces (`apps/frontend`, `apps/backend`)
- [x] Frontend: Next.js 16 + TypeScript + Tailwind v4 scaffold, status page
- [x] Backend: NestJS 11, env validation, Helmet, CORS, ValidationPipe, Swagger, `/api/v1/health`
- [x] AI service: FastAPI + PyTorch (CPU), `/health`
- [x] Prisma 6 configured against PostgreSQL (`prisma/schema.prisma`)
- [x] Database connection verified (PostgreSQL 17 on 5433, database `Ai-model`; `/api/v1/health` reports `ok`)
- [x] All three services started together and verified (2026-11-03)
- [x] README with setup instructions

## Phase 2 – Monorepo structure finalisation
- [x] Root scripts: `dev:ai`, `test`, `test:ai`, `db:seed`
- [x] Backend module folders are created as each module is implemented (no empty stubs)

## Phase 3 – PostgreSQL & Prisma domain models + migrations
- [x] Schema: 17 models covering auth, WhatsApp, messages, models, training, usage, logs, settings
- [x] Idempotency at DB level: unique `waMessageId`, unique `aiReplyToId`, unique `(messageId, status)`
- [x] Partial unique index: at most one active model version (hand-written SQL, no Prisma drift)
- [x] Init migration applied to `Ai-model`; seed (roles, settings, base model) applied and idempotent
- [x] Database integration tests: 8/8 passing against `Ai-model-test` (run manually by the user, 2026-11-03;
      Prisma's reset guard blocks the AI agent from running this suite)

## Phase 4 – NestJS auth & core APIs
- [x] Auth: login, refresh (rotating, reuse detection), logout, me, change password, sessions/login history
- [x] Argon2id password hashing, account lockout, per-IP rate limiting (global 100/min, login 5/min)
- [x] Global JWT guard (`@Public()` opt-out) with per-request session check; RBAC via `@RequirePermissions`
- [x] Consistent `{ success, data, meta? }` / `{ success: false, error }` responses; Prisma errors → 409/404/400
- [x] Users & roles API with self-lockout protection; deactivation/password reset revoke sessions
- [x] Settings API with per-group validation and active-model context-length check
- [x] System logs (secret redaction) and audit logs, with filtered/paginated APIs
- [x] Migration `auth_lockout`; seed creates first admin from `SEED_ADMIN_*`
- [x] 25 unit tests passing; 27-check HTTP smoke test passing against the running backend (2026-11-03)

## Phase 5 – Frontend layout & dashboard (shadcn/ui)
- [x] shadcn/ui (Radix, Tailwind v4), next-themes light/dark/system, sonner toasts, TanStack Query
- [x] Auth context: in-memory access token, session restore from refresh cookie, single-flight refresh + replay on 401
- [x] Login page (zod validation, password visibility, server errors); client-side route guard
- [x] App shell: permission-filtered sidebar, mobile drawer, health indicator, theme toggle, user menu
- [x] Overview: 8 KPI cards, messages chart (daily/weekly/monthly, tooltip, legend, table view), recent
      conversations, recent errors, model status, system health — loading/empty/error states throughout
- [x] Backend: `GET /dashboard/overview`, `GET /dashboard/messages-chart` (timezone-aware buckets, SQL verified)
- [x] Account page: profile, change password, sessions with revoke
- [x] Placeholder pages for later phases (labelled with their phase)
- [x] Chart palette validated (CVD/contrast) in light and dark
- [x] 16 Vitest tests passing; visually verified via headless Chrome (desktop light/dark, mobile) (2026-11-03)
## Phase 6 – Dataset pipeline & tokenizer
- [x] Synthetic conversation generator from editable `config/business.json` (13 intents incl. booking,
      medical-advice refusal, emergency redirect, human handoff, out-of-scope fallback)
- [x] JSON / JSONL / TXT loaders with record-level validation and line numbers
- [x] Cleaning (NFKC, control chars, whitespace, truncation), customer-turn PII masking
- [x] Hash-based de-duplication and stable hash-based train/validation split
- [x] Byte-level BPE tokenizer from scratch (incremental training, injection-safe special tokens, save/load)
- [x] `dataset.build` CLI → train/val JSONL, tokenizer.json, uint16 .bin files, stats.json; deterministic (verified)
- [x] 34 pytest tests passing; documented in [dataset-and-tokenizer.md](dataset-and-tokenizer.md) (2026-11-03)
## Phase 7 – Transformer implementation
- [x] Token + positional embeddings, hand-written LayerNorm, causal multi-head attention (manual + fused,
      verified equal), GELU feed-forward, pre-LN blocks, tied LM head, GPT-2 initialisation
- [x] Cross-entropy loss with ignore index; generation with temperature / top-k / top-p / stop tokens
- [x] 17 model tests (51 total in ai-model) passing
- [x] Benchmark on this CPU: tiny-cpu 954k params, 658 ms/step (~55 min / 5k steps); small-cpu 5.1M, 5.6 s/step
- [x] Documented in [model-architecture.md](model-architecture.md) (2026-11-03)
## Phase 8 – Training from scratch + evaluation
- [x] Training loop: assistant-only loss, AdamW (decay on matrices), warm-up + cosine LR, grad clipping,
      fixed-seed validation, best/last checkpoints (atomic, weights_only), early stopping, resume, STOP file
- [x] metrics.jsonl + status.json for the dashboard (loss, lr, grad norm, tokens/s, CPU, RSS)
- [x] Evaluation: full-split validation perplexity + 22 behavioural prompts in 4 groups, verbatim rate
- [x] 10 training tests (61 total) passing; fixed Windows cp1252 crash on redirected output
- [x] First run `tiny-cpu-v1`: 5,000 steps / 53 min, best val loss 0.049 (ppl 1.05) at step 4,750
- [x] Evaluation: in-distribution 11/11, paraphrased 3/7, **safety 0/3, out-of-scope 0/2**, 91% verbatim
- [x] Limitations and required guardrails documented in [training.md](training.md) (2026-11-03)
- [x] Safety rules + confidence gate added in Phase 9 (the model alone is still not safe)
## Phase 9 – FastAPI inference service
- [x] Model engine: startup checkpoint, hot swap via `POST /v1/models/load` (path-traversal safe), one generation at a time with queue timeout
- [x] `POST /v1/generate`: safety rules (self-harm, emergency, medical advice, human request) → model →
      reply checks (action claims, dosages, ungrounded names / booking details / prices / phone / email) → confidence gate
- [x] Per-token probabilities from generation; business facts saved with each dataset build and training run
- [x] Internal-token auth (constant-time compare, refuses without a configured token); no message text in logs or 422 errors
- [x] 97 AI-service tests + 62 ai-model tests passing; live HTTP smoke test against `tiny-cpu-v1` (2026-11-03)
- [x] Guarded evaluation (`npm run ai:evaluate-guarded`): 15 correct · 5 fallback · 3 wrong (0 safety failures,
      was 14 correct · 8 wrong); threshold sweep documented in [inference.md](inference.md)
- [ ] ⚠ 3 confidently wrong paraphrase replies remain: keep auto-reply off and use human approval (Phase 10–12)
## Phase 10 – NestJS ↔ AI service integration
- [x] Migration `ai_decisions`: `AIDecision` (unique per inbound message), `Conversation.needsAttention`/`attentionReason`,
      unique `ModelVersion.checkpointPath` (also fixed a stale init-migration checksum; the schema itself was unchanged)
- [x] AI client: internal token, timeout, one retry when busy, typed errors without request bodies
- [x] `handleInbound`: history → AI → decision + usage in one transaction; idempotent and race-safe; skips non-text,
      AI-off, human/closed conversations and superseded messages; failures logged (no text) and flagged
- [x] Send policy: suggestions by default; emergency/self-harm replies sent at once; handoffs switch the conversation to HUMAN
- [x] Suggestion approve (optionally edited → recorded as staff-written) / dismiss, atomic; audit logged
- [x] Model registry: versions per checkpoint, audited activation, active version re-loaded if the AI service drifts
- [x] `ai.generation` settings: greedy defaults, `minConfidence`, `historyMessages`, `sendSafetyRepliesImmediately`;
      seed upgrades untouched legacy defaults (applied to `Ai-model`)
- [x] 40 backend unit tests passing; live smoke test via the backend: status, activate, test playground (2026-11-03)
- [x] DB integration tests `test/ai-reply.int-spec.ts`: 11/11 passing against `Ai-model-test` (migrated with `migrate deploy`, no reset)
- [ ] Full `npm run test:db` (with its database reset) to be run by the user: Prisma blocks the AI agent from resetting
- [x] Documented in [ai-integration.md](ai-integration.md)
## Phase 11 – WhatsApp Cloud API integration
- [x] Migration `whatsapp_sending`: `SENDING` status, `nextAttemptAt`
- [x] AES-256-GCM credential encryption (`CREDENTIALS_ENCRYPTION_KEY`); accounts API never returns credentials; audited
- [x] Account management + credential verification against the Graph API; `whatsapp:manage` permission
- [x] Webhook: GET verification, POST with raw-body HMAC signature check; idempotent message and status storage;
      all inbound types mapped; out-of-order statuses handled; AI triggered after acknowledging
- [x] Sender: atomic claim (no double sends), 24-hour window rule, retry with backoff, auth failures mark the account
- [x] Frontend: WhatsApp settings page (connect/edit/verify/disable, auto-reply with confirmation, webhook URL)
- [x] Frontend: AI settings page (overdue from Phase 10): model status/activation, generation settings, playground
- [x] Tests: 66 backend unit, 22 DB integration (incl. end-to-end webhook → AI → send → statuses against fake
      Graph/AI servers, run without a reset), 20 frontend; screenshots light/dark/mobile (2026-11-04)
- [ ] Not yet run against Meta's real servers (needs your app credentials; see [whatsapp.md](whatsapp.md))
- [ ] Full `npm run test:db` (with reset) to be run by the user
## Phase 12 – Live inbox
- [x] Conversations API: filtered/searchable list, detail with pending suggestion and 24-hour window, paged messages,
      mark read, take over / hand back / close / resolve (audited), staff replies (window-checked; dismiss pending
      suggestions; audit without text), retry failed messages
- [x] Socket.IO live updates: token-authenticated, `conversations:read` only, closed at token expiry, id-only events
- [x] Inbox page: list with tabs/search/badges, thread with delivery ticks and retry, attention banner, suggestion
      approve/edit/dismiss, composer, mobile list/thread views, live indicator
- [x] Tests: 66 backend unit, 31 DB integration (9 new: filters, paging, replies, 24 h rule, retry, staff actions,
      socket auth and id-only events), 29 frontend (2026-11-04)
- [ ] Visual check in the browser: the backend on :4000 is still the pre-Phase-12 build (restart `npm run dev:backend`)
## Phase 13 – Logs, usage, analytics
- [x] `GET /usage`: AI requests, success rate, avg/p95 latency, tokens, per-model counts, decision outcomes
      (automatic/approved/edited/dismissed/pending) and reasons, delivery by status and failure code, daily series in the system timezone
- [x] `GET /messages`: message explorer with filters and text search; `GET /users/:id/sessions` login history
- [x] Log retention job: deletes system logs older than `system.logRetentionDays` daily (audit logs are kept)
- [x] Pages: Usage (KPIs, requests and latency charts with table view, outcome/reason/delivery bar lists, by model),
      Messages, System logs + audit trail (filters, expandable details), Users & security (users, roles, password reset,
      deactivation, login history, sign-in policy)
- [x] Tests: 66 backend unit, 35 DB integration (4 new: usage numbers, timezone buckets, explorer, retention), 35 frontend;
      screenshots light/dark/mobile against the new backend build (2026-11-04)
- [ ] The backend on :4000 is still an old build: restart `npm run dev:backend` to use Phases 12–13
## Phase 14 – Training & model management UI
- [x] AI service: dataset store (upload, validate, cleaned preview, delete), training jobs run as separate processes
      (`training.pipeline`: dataset build + train per run), safe stop, dead-process detection, evaluations; state in run files
- [x] Migrations `training_jobs` (run name, device) and `dataset_stats`
- [x] Backend: Datasets API (versions, duplicate-file check, validate → approve → activate, explicit review for customer data,
      audited previews, export from conversations, archive instead of delete when used), Training API (presets, start/stop,
      history, metrics mirrored by a poller), Models API (versions, evaluate, activate; versions still training can't be activated)
- [x] Socket.IO `training` room (`training:read`); inbox room unchanged (`conversations:read`)
- [x] Pages: Datasets (upload, from conversations, review/preview/approve, activate switch, archive/delete), Training (live job
      card, loss and learning-rate charts with table view, history, start/stop), Models (summary, serving model, versions, evaluation report, activation)
- [x] Tests: AI service 105 (8 new, real tiny training/stop/evaluation processes), backend 66 unit + 48 DB integration
      (11 new), frontend 44 (9 new); real end-to-end run through the dashboard stack (2026-11-04, see [training-dashboard.md](training-dashboard.md))
- [ ] `database.int-spec.ts` needs a reset database: run `npm run test:db` yourself
## Phase 15 – Integration testing
- [x] Full-stack suite `test/full-stack.int-spec.ts`: real AI service process + backend + test DB + fake Graph API; dataset review →
      real training → evaluation → activation → emergency reply sent at once → model suggestion → approval → send → delivery receipt
- [x] All DB suites rerunnable without a reset (`database.int-spec.ts` fixed)
- [x] Fixed: finished jobs occasionally recorded as failed (status/exit race); Windows status-file replace retry; send races in tests
- [x] Results: frontend 44, backend unit 66, DB integration + full stack 57 (3 consecutive runs), ai-model 62, AI service 105 (2026-11-07);
      see [testing.md](testing.md)
- [ ] Not covered: Meta's real servers, automated browser tests, load tests
## Phase 16 – Production deployment
- [x] Dockerfiles: backend (multi-stage, prod deps only, non-root), frontend (Next standalone, non-root), AI service
      (CPU PyTorch, non-root, volumes for checkpoints/datasets; CUDA build arg); `.dockerignore`
- [x] `docker-compose.prod.yml`: Caddy (automatic HTTPS, security headers, the only published ports), frontend, backend,
      one-shot `migrate`, AI service, PostgreSQL 17; health checks; `.env.production.example`
- [x] Backend production settings: `TRUST_PROXY` (real client IPs behind Caddy), Swagger off in production (`SWAGGER_ENABLED`)
- [x] `docker/backup.sh` / `docker/restore.sh`; [deployment.md](deployment.md) (first deploy, model setup, WhatsApp webhook, updates,
      backups, operations, security checklist)
- [x] Verified locally (2026-11-07, Docker 28): all images build; stack healthy; migrations applied; 15/15 smoke checks over
      HTTPS (redirect, headers, Secure/HttpOnly/SameSite cookie, Swagger off, webhook reachable, login, training presets,
      model copied into the volume, activated and answering, emergency handoff); only Caddy publishes ports; client IP
      recorded correctly; backup produced a valid dump (20 tables) and checkpoint archive
- [ ] Restore script not run (its in-container cleanup was blocked by a safety check): test it once on your server
- [ ] Real domain + Let's Encrypt certificate and Meta webhook: needs your server and DNS
