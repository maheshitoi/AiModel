# My Own AI

A self-hosted AI platform: a GPT-style language model **trained from scratch** in PyTorch, which
answers customers on an existing **WhatsApp Business** number through the official Cloud API. It is
managed from a Next.js dashboard backed by NestJS and PostgreSQL.

> Status: **Phase 4 complete (auth & core APIs)**. See [docs/PROGRESS.md](docs/PROGRESS.md).

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

## Running locally

Use three terminals from the repo root:

```powershell
# AI service  → http://localhost:8000/health  (docs: /docs)
cd apps\ai-service; ..\..\.venv\Scripts\python.exe -m uvicorn main:app --port 8000

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
| Health | `GET /health` (public) |

Responses are `{ "success": true, "data": ..., "meta"?: { page, pageSize, total, totalPages } }`;
errors are `{ "success": false, "error": { statusCode, message, details?, path, timestamp } }`.

The access token lives 15 minutes and is kept in memory by the frontend. The refresh token is an
HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. It rotates on every refresh, and reusing
an old one revokes the session.

## Tests

```powershell
npm test -w apps/backend                                        # NestJS unit tests (Jest)
npm run test:db -w apps/backend                                 # DB integration tests (resets Ai-model-test)
cd apps\ai-service; ..\..\.venv\Scripts\python.exe -m pytest    # AI service tests
```

## Security notes

- Secrets live only in `.env` (git-ignored). Never commit real credentials.
- WhatsApp access tokens are never returned by the API or shipped to the browser.
- No pretrained weights and no hosted LLM APIs are used for response generation.

## Deployment

Covered in Phase 16.
