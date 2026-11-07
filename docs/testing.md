# Testing (Phase 15)

## Commands

```powershell
npm test                                # everything below, in order
npm test -w apps/frontend               # components and API client (Vitest + Testing Library)
npm test -w apps/backend                # backend unit tests (Jest)
npm run test:db -w apps/backend         # database integration + full stack (resets Ai-model-test first)
npm run test:ai-model                   # tokenizer, dataset, model, training (pytest)
npm run test:ai                         # inference service, guardrails, dataset/training/evaluation jobs (pytest)
```

`test:db` needs PostgreSQL with the `Ai-model-test` database (`TEST_DATABASE_URL`). The full-stack suite also
needs the Python venv at `.venv`. Without it, that suite is skipped and prints why.

## What each layer proves

| Layer | Suite | What it checks |
|---|---|---|
| Unit | `apps/backend/src/**/*.spec.ts` | Auth, guards, settings, the AI client's error mapping, the send policy, the webhook parser, credential encryption |
| Unit | `ai-model/tests` | Tokenizer, dataset formats and cleaning, the model, training (including resume and safe stop), evaluation |
| Service | `apps/ai-service/tests` | Safety rules, reply checks, the confidence gate, the API, plus real subprocess training, stop and evaluation runs |
| Integration (DB) | `apps/backend/test/*.int-spec.ts` | The backend against PostgreSQL with fake Graph and AI servers: constraints, the webhook → AI → send → status flow, the inbox and sockets, analytics, datasets and training |
| **Full stack** | `apps/backend/test/full-stack.int-spec.ts` | The **real AI service process**, the backend, the database and a fake Graph API, in one lifecycle (below) |
| UI | `apps/frontend/src/**/*.test.tsx` | Forms, dialogs, permission-dependent controls, the job card, the dataset review flow |

### The full-stack lifecycle

1. Upload a dataset → validated by the real cleaning code (phone number masked) → approve → activate.
2. Start training → the real AI service trains a tiny model from scratch in a subprocess → the backend poller mirrors
   progress and metrics → version `READY`.
3. Evaluate → validation loss below an untrained model's. Activate → the AI service loads the new version and reports it in sync.
4. A signed WhatsApp webhook "My father collapsed and is not breathing" → the safety rule hands off and the fixed
   emergency reply is **sent at once**, even with auto-reply off.
5. "What are your opening hours?" → the real model and guardrails produce a decision, which waits as a **suggestion**
   (auto-reply off). AI usage is recorded.
6. Staff approve the suggestion → sent to Graph → a delivery receipt webhook → `DELIVERED`.

It uses a temporary checkpoint folder and deletes it afterwards. Your real checkpoints and model are not touched.

## Results (2026-11-07, Windows 10, 2-core CPU, no GPU)

| Suite | Result |
|---|---|
| Frontend | 44 passed |
| Backend unit | 66 passed |
| DB integration + full stack | **57 passed**, three consecutive runs without a database reset (7 suites; full stack ≈ 40–60 s) |
| ai-model | 62 passed |
| AI service | 105 passed |

## Problems found and fixed in this phase

| Problem | Cause | Fix |
|---|---|---|
| A training job that finished normally could be recorded as **failed** (intermittent) | The AI service read `status.json` ("running") just before the process wrote its final status and exited, then saw a dead process | Re-read the status before declaring a process dead (`app/jobs.py`) |
| A training process could crash writing its status on Windows | Replacing `status.json` fails while another process is reading it | Retry the replace briefly (`training/train.py: replace_with_retry`); readers treat a locked file as "not readable yet" |
| `database.int-spec.ts` failed on a database that wasn't reset | Fixed message IDs, counting all models, and assuming no version is active yet | Per-run IDs; count only the seeded model; an active-version test that works either way |
| Inbox and full-stack sends occasionally read `SENDING` | Replying also kicks the sender in the background, which can claim the message before the test's `processDue()` | Tests wait for the in-flight send to finish |

## Not covered (needs you)

- **Meta's real WhatsApp servers.** All WhatsApp traffic in tests goes to a fake Graph API. Test with your app
  credentials and a test number (see [whatsapp.md](whatsapp.md)).
- **Browser end-to-end tests.** Pages were checked by hand and with headless screenshots, not by an automated browser suite.
- **Load.** One CPU-bound model serves one generation at a time. No load tests were run.
