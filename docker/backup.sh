#!/usr/bin/env sh
# Back up the production data: the database, trained checkpoints and uploaded datasets.
#   sh docker/backup.sh [backup-dir]          (run from the repo root on the server)
# Also keep a copy of .env.production somewhere safe: without CREDENTIALS_ENCRYPTION_KEY the stored
# WhatsApp credentials can't be decrypted, and the backup files below contain customer conversations.
set -eu
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
DIR="${1:-backups}/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"

# Database: a consistent dump taken while the app keeps running.
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$DIR/database.dump"

# Checkpoints and datasets: tar the volumes through the AI service container.
$COMPOSE exec -T ai-service tar -C /app/ai-model -czf - checkpoints > "$DIR/checkpoints.tar.gz"
$COMPOSE exec -T ai-service tar -C /app/ai-model/dataset -czf - uploads > "$DIR/datasets.tar.gz"

chmod 600 "$DIR"/*
ls -lh "$DIR"
echo "Backup written to $DIR"
