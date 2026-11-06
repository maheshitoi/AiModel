# Training & model management (Phase 14)

The dashboard's **Datasets**, **Training** and **Models** pages manage the whole loop: add reviewed data,
train a new version from scratch, evaluate it, then activate it.

## Who does what

| Part | Responsibility |
|---|---|
| **AI service** (`apps/ai-service/app/jobs.py`, `routes/datasets.py`, `routes/training.py`) | Stores dataset files, validates them, runs training (`training.pipeline`) and evaluation (`evaluation.evaluate`) **as separate processes**. All job state lives in files in the run directory (`job.json`, `status.json`, `metrics.jsonl`, `evaluation.json`), so jobs survive a restart of the service. One training job and one evaluation at a time. |
| **Backend** (`apps/backend/src/training/`, `src/ai/models.controller.ts`) | Metadata in PostgreSQL, permissions, review rules, audit log. Polls the running job every `TRAINING_POLL_INTERVAL_MS` (default 3 s) and copies its metrics into `TrainingMetric`. Registers the model version a job produces. Sends id-only Socket.IO `training` events. |
| **Frontend** (`app/(dashboard)/{datasets,training,models}`) | The three pages. They refetch over REST when a socket event arrives, and poll every 15 s as a fallback. |

## Datasets: the review rules

1. **Upload** a `.json`, `.jsonl` or `.txt` file (max 20 MB), or build one with **From conversations**. That option exports conversations with only the replies that were actually delivered, merges consecutive messages and drops unanswered endings.
2. The file is **validated** immediately with the same steps training uses: format check, cleaning, PII masking of customer turns, de-duplication and the train/validation split. A file is `VALID` only if every record is usable. Otherwise it is `INVALID`, and up to 50 problems are listed by record number.
3. A person **approves** it after reading the preview. Datasets with real customer conversations are flagged, and approval requires an explicit "I have read these conversations" confirmation. Opening their preview is recorded in the audit log.
4. It is **activated**. Training uses only datasets that are approved **and** active, plus, optionally, the synthetic conversations generated from `business.json`.
5. **Delete** removes the row and the file. A dataset a training job used is **archived** instead, so that job stays reproducible.

Customer messages are never added to training automatically.

## Training

- **Start:** choose a preset (`ai-model/config/*.json`), optionally a step count, and whether to include synthetic data. The job builds its own dataset and tokenizer into `checkpoints/<run>/data/` and then trains into `checkpoints/<run>/`.
- **Stop:** writes the `STOP` file. The run saves `last.pt` and stops, and the best checkpoint so far still becomes a model version.
- **Monitoring:** progress, epoch, training and validation loss, learning rate, CPU, process memory, duration, and the device. On a computer without a CUDA GPU, the page says so instead of showing a GPU figure.
- **Status mapping:** starting or preparing → `QUEUED`; `RUNNING`; `STOPPING`; completed or early-stopped → `COMPLETED`; stopped or interrupted → `STOPPED`; `FAILED`. A run whose process has died is reported as `FAILED`.

## Models

- A version is registered as `TRAINING` when its job starts training, and becomes `READY` when it finishes with a checkpoint (or `FAILED` without one). Only `READY` versions can be activated.
- **Evaluate** runs `evaluation.evaluate` on the run's own validation data. It reports validation loss and perplexity, prompt checks by group, every reply, and how many replies were copied verbatim from training. The summary is saved on the version.
- **Activate** loads the checkpoint into the AI service. The guardrails and confidence check apply as before.

## APIs

Backend (all under `/api/v1`; permissions in brackets):

| Endpoint | Purpose |
|---|---|
| `GET /datasets`, `GET /datasets/:id`, `GET /datasets/:id/preview` (`datasets:read`) | List, detail, cleaned preview |
| `POST /datasets` (multipart: `file`, `name`, `description?`, `containsCustomerData?`) (`datasets:manage`) | Upload. The same name creates the next version, and identical bytes are refused (409) |
| `POST /datasets/from-conversations` (`datasets:manage` + `conversations:read`) | `{name, since, until?, closedOnly?, limit?}` |
| `POST /datasets/:id/validate`, `/approve` (`{reviewedCustomerData}`), `/activate`, `/deactivate`, `DELETE /datasets/:id` (`datasets:manage`) | Review flow |
| `GET /training/presets`, `/training/jobs`, `/training/jobs/current`, `/training/jobs/:id`, `/training/jobs/:id/metrics` (`training:read`) | Monitoring |
| `POST /training/jobs` (`{preset, maxSteps?, includeSynthetic?}`), `POST /training/jobs/:id/stop` (`training:manage`) | Start (409 while another job runs) and stop |
| `GET /models`, `GET /models/versions/:id/evaluation` (`models:read`) | Versions and evaluation |
| `POST /models/versions/:id/evaluate`, `POST /models/versions/:id/activate` (`models:manage`) | Evaluate and activate |

AI service (internal, `X-Internal-Token`): `PUT/DELETE /v1/datasets/{id}`, `POST /v1/datasets/{id}/validate`,
`GET /v1/datasets/{id}/preview`, `GET /v1/training/presets`, `POST /v1/training/jobs`,
`GET /v1/training/jobs/{id}?since_step=`, `POST /v1/training/jobs/{id}/stop`, `POST/GET /v1/evaluations`.

Settings: `TRAINING_POLL_INTERVAL_MS` (backend); `DATASET_DIR`, `TRAINING_PRESETS_DIR`, `DATASET_MAX_BYTES` (AI service).

## Measured end-to-end run (2026-11-04, the real stack on the 2-core laptop CPU)

| Step | Result |
|---|---|
| Upload a 4-conversation sample | `VALID`; the phone number shows as `<phone>` in the preview |
| Approve, activate, start `tiny-cpu` for 300 steps with synthetic data | Preparing for 15 s, then training. About 1.2 steps/s (≈2,450 tokens/s, CPU at 100%, about 400 MB of memory) |
| Finished | `COMPLETED` after 251 s. Best validation loss 0.24; v3 registered and `READY` |
| Evaluation | 10 s. Validation loss 0.246 (untrained ≈ 7.04). Prompt checks 48%: in-distribution 7/11, paraphrased 1/7, safety 2/3, out-of-scope 1/2. 70% of replies copied verbatim |

300 steps is a smoke test, not a useful model. It scores below the 5,000-step `tiny-cpu-v1`. Inference gets
slower while training runs, because both share the CPU.
