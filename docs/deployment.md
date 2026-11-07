# Production deployment (Phase 16)

One Linux server, Docker Compose, automatic HTTPS. Everything in this guide runs from the repo root on that server.

## Architecture

```text
Internet ──443/80──► Caddy ──┬── /api/*, /socket.io/* ──► backend :4000 ──┬──► postgres :5432   (volume pgdata)
  (WhatsApp webhooks,        │                                             └──► ai-service :8000 (volumes checkpoints, datasets)
   staff browsers)           └── everything else ────────► frontend :3000
```

| Container | Image | Notes |
|---|---|---|
| `caddy` | `caddy:2-alpine` | **The only published ports.** Gets and renews the Let's Encrypt certificate for `DOMAIN`, and adds HSTS and other security headers |
| `frontend` | `docker/frontend.Dockerfile` | Next.js standalone server. `NEXT_PUBLIC_API_URL=https://DOMAIN/api/v1` is compiled in at build time |
| `backend` | `docker/backend.Dockerfile` | NestJS. `TRUST_PROXY=1`, so client IPs come from Caddy. Swagger is off unless `SWAGGER_ENABLED=true` |
| `migrate` | backend build stage | One-shot `prisma migrate deploy` before every backend start. The backend doesn't start if it fails |
| `ai-service` | `docker/ai-service.Dockerfile` | CPU PyTorch. Inference, training and evaluation. Never exposed outside the stack |
| `postgres` | `postgres:17-alpine` | Never exposed. Data on the `pgdata` volume |

Everything is on one domain, so the refresh-token cookie (`Secure`, `SameSite=Strict`, HttpOnly) and CORS need no special setup.

## Server requirements

- Linux with Docker Engine 24+ and the Compose plugin. 2+ CPU cores; 4 GB RAM is enough for `tiny-cpu` inference and training,
  8 GB if you train `small-cpu`. 10 GB of disk for images, plus your data.
- A domain name whose DNS A/AAAA record points at the server. Ports 80 and 443 open: Let's Encrypt needs 80, and WhatsApp needs a valid HTTPS certificate.

## First deployment

```bash
git clone https://github.com/maheshk13122000/AiModel.git && cd AiModel
cp .env.production.example .env.production
nano .env.production                      # DOMAIN and every CHANGE_ME (commands are at the top of the file)
chmod 600 .env.production

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps          # all "healthy"/"running"; migrate "exited (0)"

# Roles, default settings and the first admin (only if the database has no users yet)
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backend node apps/backend/dist/database/seed.cli.js
```

Open `https://DOMAIN`, sign in as `SEED_ADMIN_EMAIL`, and **change the password** (Account page). Then you can
remove `SEED_ADMIN_PASSWORD` from `.env.production`.

Tip: `alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'` shortens every command below.

### Put a model in place

The checkpoints volume starts empty. Either:

- **Train in the dashboard:** Datasets (optional) → Training → Start training → Models → Evaluate → Activate. Or
- **Copy a model you trained on your PC** (the whole run folder: `best.pt`, `tokenizer.json`, `config.json`, `business.json`):
  ```bash
  dc cp ./tiny-cpu-v1 ai-service:/app/ai-model/checkpoints/      # then Settings → AI → choose tiny-cpu-v1/best.pt → Activate
  dc exec -u root ai-service chown -R app:app /app/ai-model/checkpoints
  ```

Edit `ai-model/config/business.json` with your real details **before building**: it's baked into the AI service image and drives the synthetic training data.

### Connect WhatsApp

In the Meta app dashboard, set the webhook to `https://DOMAIN/api/v1/webhooks/whatsapp` with the verify token you
enter on the dashboard's WhatsApp settings page, and subscribe to `messages`. See [whatsapp.md](whatsapp.md). Keep
auto-reply off until you've reviewed the model's suggestions for a while.

## Updating

```bash
git pull
dc up -d --build          # rebuilds changed images; "migrate" applies new migrations before the backend restarts
dc image prune -f
```

Before an update with migrations, take a backup (below). Prisma migrations only move forward. To roll back,
restore the backup and check out the previous commit.

## Backups

```bash
sh docker/backup.sh            # → backups/<UTC time>/database.dump, checkpoints.tar.gz, datasets.tar.gz
sh docker/restore.sh backups/20261107-120000     # asks for confirmation; replaces all current data
```

Run the backup daily from cron (`0 3 * * * cd /path/to/AiModel && sh docker/backup.sh >> backups/backup.log 2>&1`),
and copy `backups/` **off the server**. Backups contain customer conversations: store them encrypted and with restricted access.
Keep a copy of `.env.production` too. Without its `CREDENTIALS_ENCRYPTION_KEY`, the stored WhatsApp credentials can't be decrypted.

## Operations

| Task | Command |
|---|---|
| Logs | `dc logs -f backend` (also `ai-service`, `caddy`, `frontend`). The dashboard's System logs page has the application events |
| Health | `curl https://DOMAIN/api/v1/health` (database and AI service status) |
| Restart one service | `dc restart backend` |
| Database shell | `dc exec postgres psql -U myownai myownai` |
| GPU training (NVIDIA) | Build the AI service with `--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124`, install the NVIDIA Container Toolkit, and add `deploy.resources.reservations.devices: [{driver: nvidia, count: 1, capabilities: [gpu]}]` to `ai-service` |

## Security checklist

- [ ] Every secret in `.env.production` is newly generated (not copied from development), and the file is `chmod 600`.
- [ ] Only ports 80 and 443 are open in the firewall (`ufw allow 80,443/tcp`), plus SSH.
- [ ] `SWAGGER_ENABLED=false`.
- [ ] The seed admin password is changed, and each person has their own account with the least role they need (Users & security).
- [ ] WhatsApp auto-reply stays off until the model's evaluation and reviewed suggestions justify it.
- [ ] Backups run daily, are copied off the server, and a restore has been tested once.
- [ ] OS security updates are enabled (`unattended-upgrades`).
