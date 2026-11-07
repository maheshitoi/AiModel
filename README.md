# My Own AI

A self-hosted AI platform: a GPT-style language model **trained from scratch** in PyTorch, which
answers customers on an existing **WhatsApp Business** number through the official Cloud API. It is
managed from a Next.js dashboard backed by NestJS and PostgreSQL.

> Status: **Phase 15 complete (integration testing)**. See [docs/PROGRESS.md](docs/PROGRESS.md).
> The model itself still fails on emergencies and unfamiliar requests. The inference service puts
> safety rules, reply checks and a confidence gate around it ([docs/inference.md](docs/inference.md)).
> It still sends 3 wrong (not dangerous) replies out of 22 test prompts, so keep auto-reply off.

## Architecture

```
WhatsApp Cloud API ──webhook──▶ NestJS backend (apps/backend, :4000) ──▶ PostgreSQL (Prisma)
                                    │   ▲
                         HTTP       ▼   │ REST + Socket.IO
              FastAPI AI service (apps/ai-service, :8000)      Next.js dashboard (apps/frontend, :3000)
                     │
                     ▼
         ai-model/ (tokenizer, GPT, training, checkpoints)
```

| Path | Responsibility |
|---|---|
| `apps/frontend` | Next.js 16 + TypeScript + Tailwind dashboard |
| `apps/backend` | NestJS 11 REST API, auth, WhatsApp webhooks, Socket.IO, Prisma |
| `apps/ai-service` | FastAPI inference service; loads checkpoints produced by `ai-model` |
| `ai-model` | From-scratch tokenizer, Transformer, training and evaluation code |
| `prisma` | Database schema and migrations (shared by the backend) |
| `docs` | Hardware sizing, progress checklist, design notes |

## Prerequisites

- Node.js ≥ 22, npm
- Python 3.11
- PostgreSQL 16+ (a local Windows service is fine)

Hardware notes and the recommended model size are in
[docs/hardware-and-model-sizing.md](docs/hardware-and-model-sizing.md).

## Setup

### 1. Environment

```powershell
Copy-Item .env.example .env
Copy-Item apps\frontend\.env.example apps\frontend\.env.local
```

Edit `.env` and set `DATABASE_URL`. The root `.env` is shared by the backend, Prisma and the AI service.

### 2. Database

Local development uses PostgreSQL 17 on port 5433 with a database named `Ai-model`. Create it if
needed (pgAdmin or `psql -p 5433 -U postgres`):

```sql
CREATE DATABASE "Ai-model";
```

For production, use a dedicated non-superuser role that owns only this database.

Then:

```powershell
npm install
npm run prisma:deploy   # apply migrations
npm run db:seed         # roles, default settings, and the first admin (from SEED_ADMIN_* in .env)
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then change the password
(`POST /api/v1/auth/change-password`). The seed only creates the admin when no users exist.

### 3. Python environment

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps\ai-service\requirements.txt
```

### 4. Training data

```powershell
npm run ai:data   # synthetic conversations + BPE tokenizer → ai-model/dataset/processed/
```

Edit `ai-model/config/business.json` with your real business details first. See
[docs/dataset-and-tokenizer.md](docs/dataset-and-tokenizer.md).

### 5. Train and evaluate

```powershell
npm run ai:train                                          # ~55 min on a 2-core laptop CPU
npm run ai:evaluate -- checkpoints/<run>/best.pt          # writes evaluation.md next to the checkpoint
```

See [docs/training.md](docs/training.md). Once everything is running you can also do this from the
dashboard (Datasets → Training → Models), see [docs/training-dashboard.md](docs/training-dashboard.md).

### 6. Inference service

Set `AI_SERVICE_TOKEN` (at least 32 random characters) and `AI_MODEL_CHECKPOINT` (for example
`tiny-cpu-v1/best.pt`) in `.env`, then check what customers would receive:

```powershell
npm run ai:evaluate-guarded -- tiny-cpu-v1/best.pt   # writes evaluation-guarded.md next to the checkpoint
```

See [docs/inference.md](docs/inference.md).

## Running locally

Use three terminals from the repo root:

```powershell
# AI service  → http://localhost:8000/health  (docs: /docs)
npm run dev:ai

# Backend     → http://localhost:4000/api/v1/health  (Swagger: /api/docs)
npm run dev:backend

# Frontend    → http://localhost:3000
npm run dev:frontend
```

The frontend home page shows live status for the backend, the database and the AI service.

## API

Interactive docs: http://localhost:4000/api/docs (Swagger). All routes are under `/api/v1` and
require `Authorization: Bearer <accessToken>` unless noted.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login` (public), `POST /auth/refresh` (cookie), `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Users | `GET/POST /users`, `PATCH /users/:id`, `GET /roles` (`users:manage`) |
| Settings | `GET /settings`, `GET /settings/:key` (`settings:read`), `PATCH /settings/:key` (`settings:manage`) |
| Logs | `GET /logs` (`logs:read`), `GET /logs/audit` (`audit:read`) |
| Dashboard | `GET /dashboard/overview`, `GET /dashboard/messages-chart?range=daily\|weekly\|monthly` (`dashboard:read`) |
| AI | `GET /ai/status`, `GET /ai/checkpoints` (`models:read`), `POST /ai/models/activate` (`models:manage`), `POST /ai/test`, `GET /ai/decisions`, `POST /ai/decisions/:id/approve\|dismiss` (`conversations:*`). See [docs/ai-integration.md](docs/ai-integration.md) |
| WhatsApp | `GET /whatsapp/accounts` (`settings:read`), `POST /whatsapp/accounts`, `PATCH /whatsapp/accounts/:id`, `POST /whatsapp/accounts/:id/verify` (`whatsapp:manage`); webhook `GET/POST /webhooks/whatsapp` (public, signature-checked). See [docs/whatsapp.md](docs/whatsapp.md) |
| Inbox | `GET /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`, `POST /conversations/:id/read` (`conversations:read`), `PATCH /conversations/:id` (`conversations:manage`), `POST /conversations/:id/messages`, `POST …/messages/:messageId/retry` (`conversations:reply`); live updates over Socket.IO. See [docs/inbox.md](docs/inbox.md) |
| Datasets | `GET /datasets`, `GET /datasets/:id`, `GET /datasets/:id/preview` (`datasets:read`); `POST /datasets` (multipart upload), `POST /datasets/from-conversations` (+ `conversations:read`), `POST /datasets/:id/validate\|approve\|activate\|deactivate`, `DELETE /datasets/:id` (`datasets:manage`) |
| Training | `GET /training/presets`, `GET /training/jobs`, `GET /training/jobs/current`, `GET /training/jobs/:id`, `GET /training/jobs/:id/metrics` (`training:read`); `POST /training/jobs`, `POST /training/jobs/:id/stop` (`training:manage`); live updates over Socket.IO |
| Models | `GET /models`, `GET /models/versions/:id/evaluation` (`models:read`); `POST /models/versions/:id/activate`, `POST /models/versions/:id/evaluate` (`models:manage`). See [docs/training-dashboard.md](docs/training-dashboard.md) |
| Analytics | `GET /usage?days=7\|30\|90` (`usage:read`), `GET /messages` (`messages:read`, filters: direction, source, status, type, text, dates), `GET /users/:id/sessions` (`users:manage`) |
| Health | `GET /health` (public) |

The AI service (`:8000`) has its own internal API, which only the backend calls with
`X-Internal-Token`: `POST /v1/generate`, `/v1/models/*` ([docs/inference.md](docs/inference.md)) and
`/v1/datasets/*`, `/v1/training/*`, `/v1/evaluations` ([docs/training-dashboard.md](docs/training-dashboard.md)).

Responses are `{ "success": true, "data": ..., "meta"?: { page, pageSize, total, totalPages } }`;
errors are `{ "success": false, "error": { statusCode, message, details?, path, timestamp } }`.

The access token lives 15 minutes and is kept in memory by the frontend. The refresh token is an
HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. It rotates on every refresh, and reusing
an old one revokes the session.

## Tests

```powershell
npm test -w apps/frontend                                       # Next.js component/client tests (Vitest)
npm test -w apps/backend                                        # NestJS unit tests (Jest)
npm run test:db -w apps/backend                                 # DB integration + full-stack test with the real AI service (resets Ai-model-test)
npm run test:ai-model                                           # tokenizer, dataset, model, training (pytest)
npm run test:ai                                                 # inference service, guardrails, dataset/training jobs (pytest)
```

What each suite covers, the latest results and what isn't covered: [docs/testing.md](docs/testing.md).

## Frontend notes

- UI components live in `apps/frontend/src/components/ui` (shadcn/ui, Radix base). New components:
  `npx shadcn@4.23.0 add <name>` from `apps/frontend`. The CLI writes `import { cn } from "cn"`;
  change it to `@/lib/utils`, because this project uses the established `clsx` + `tailwind-merge` helper.
- Chart series colors are the validated `--chart-1` / `--chart-2` tokens in `globals.css`.
- npm 9 can crash while resolving vitest's optional peers (`edgesOut`). Add `--legacy-peer-deps`
  when installing frontend dev tools.

## Security notes

- Secrets live only in `.env` (git-ignored). Never commit real credentials.
- WhatsApp credentials are encrypted at rest (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`), never returned by the API
  or shipped to the browser. Webhooks must carry a valid Meta signature.
- No pretrained weights and no hosted LLM APIs are used for response generation.
- The AI service accepts `/v1` requests only with `AI_SERVICE_TOKEN`, binds to localhost by default,
  and never logs message text. Validation errors don't echo the submitted text either.

## Deployment

Covered in Phase 16.
