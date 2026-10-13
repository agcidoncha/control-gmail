#!/usr/bin/env bash
set -euo pipefail

cd "${APP_DIR:-/opt/asistente-comercial}"

compose_file="${COMPOSE_FILE:-docker-compose.hostinger.yml}"
backup_dir="${BACKUP_DIR:-backups}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_file="${backup_dir}/mysql-${timestamp}.sql.gz"

mkdir -p "$backup_dir"
docker compose -f "$compose_file" exec -T mysql sh -c \
  'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events "$MYSQL_DATABASE"' \
  | gzip -c > "$output_file"

find "$backup_dir" -maxdepth 1 -type f -name 'mysql-*.sql.gz' -mtime "+$retention_days" -delete

printf 'Copia creada: %s\n' "$output_file"
