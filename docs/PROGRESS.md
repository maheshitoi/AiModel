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
## Phase 6 – Dataset pipeline & tokenizer
## Phase 7 – Transformer implementation
## Phase 8 – Training from scratch + evaluation
## Phase 9 – FastAPI inference service
## Phase 10 – NestJS ↔ AI service integration
## Phase 11 – WhatsApp Cloud API integration
## Phase 12 – Live inbox
## Phase 13 – Logs, usage, analytics
## Phase 14 – Training & model management UI
## Phase 15 – Integration testing
## Phase 16 – Production deployment
