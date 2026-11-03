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
## Phase 11 – WhatsApp Cloud API integration
## Phase 12 – Live inbox
## Phase 13 – Logs, usage, analytics
## Phase 14 – Training & model management UI
## Phase 15 – Integration testing
## Phase 16 – Production deployment
