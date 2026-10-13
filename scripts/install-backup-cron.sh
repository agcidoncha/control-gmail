#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador como root (sudo)." >&2
  exit 1
fi

app_dir="${APP_DIR:-/opt/asistente-comercial}"
compose_file="${COMPOSE_FILE:-docker-compose.hostinger.yml}"
cron_schedule="${BACKUP_CRON_SCHEDULE:-15 3 * * *}"
cron_file="/etc/cron.d/asistente-comercial-mysql-backup"
log_file="${BACKUP_LOG_FILE:-/var/log/asistente-comercial-mysql-backup.log}"

if [[ ! -d "$app_dir" ]]; then
  echo "No existe APP_DIR: $app_dir" >&2
  exit 1
fi

if [[ ! -f "$app_dir/$compose_file" ]]; then
  echo "No existe el compose: $app_dir/$compose_file" >&2
  exit 1
fi

if [[ ! "$cron_schedule" =~ ^[^#]+$ ]]; then
  echo "BACKUP_CRON_SCHEDULE no puede estar vacío ni contener #." >&2
  exit 1
fi

touch "$log_file"
chmod 0600 "$log_file"

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
{
  echo "# Copia diaria de MySQL para asistente-comercial. Gestionado por install-backup-cron.sh."
  echo "SHELL=/bin/bash"
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  echo
  printf '%s root flock -n /run/lock/asistente-comercial-mysql-backup.lock -c "cd %q && APP_DIR=%q COMPOSE_FILE=%q /usr/bin/env bash scripts/backup-mysql.sh >> %q 2>&1"\n' \
    "$cron_schedule" "$app_dir" "$app_dir" "$compose_file" "$log_file"
} > "$tmp_file"

install -m 0644 "$tmp_file" "$cron_file"
echo "Programación instalada en $cron_file"
echo "Horario: $cron_schedule"
echo "Registro: $log_file"
