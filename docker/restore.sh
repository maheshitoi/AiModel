#!/usr/bin/env sh
# Restore a backup made by docker/backup.sh. This REPLACES the current database, checkpoints and datasets.
#   sh docker/restore.sh backups/20261107-120000
# The stack must be running with the same CREDENTIALS_ENCRYPTION_KEY as when the backup was taken.
set -eu
DIR="${1:?usage: sh docker/restore.sh <backup-dir>}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

printf 'This replaces ALL current data with %s. Type "restore" to continue: ' "$DIR"
read -r answer
[ "$answer" = "restore" ] || { echo "Cancelled"; exit 1; }

$COMPOSE stop backend
$COMPOSE exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$DIR/database.dump"
$COMPOSE exec -T ai-service sh -c 'rm -rf /app/ai-model/checkpoints/* && tar -C /app/ai-model -xzf -' < "$DIR/checkpoints.tar.gz"
$COMPOSE exec -T ai-service sh -c 'rm -rf /app/ai-model/dataset/uploads/* && tar -C /app/ai-model/dataset -xzf -' < "$DIR/datasets.tar.gz"
$COMPOSE start backend
echo "Restored from $DIR. The backend reloads the active model version into the AI service on start."
