#!/usr/bin/env bash
set -euo pipefail

cd /opt/asistente-comercial

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

set_env PORT 3000
set_env HOST 0.0.0.0
set_env DATA_STORE mysql
set_env MYSQL_HOST mysql
set_env MYSQL_PORT 3306
set_env MYSQL_DATABASE asistente_comercial
set_env MYSQL_USER asistente

if ! grep -q '^MYSQL_PASSWORD=.' .env; then
  set_env MYSQL_PASSWORD "$(openssl rand -hex 24)"
fi
if ! grep -q '^MYSQL_ROOT_PASSWORD=.' .env; then
  set_env MYSQL_ROOT_PASSWORD "$(openssl rand -hex 32)"
fi

set_env MYSQL_SSL false
set_env FRONTEND_URL https://lab.thelocalhost.es
set_env GOOGLE_REDIRECT_URI https://lab.thelocalhost.es/auth/google/callback

if ! grep -q '^SESSION_SECRET=.' .env; then
  set_env SESSION_SECRET "$(openssl rand -hex 32)"
fi
if ! grep -q '^TOKEN_ENCRYPTION_KEY=.' .env; then
  set_env TOKEN_ENCRYPTION_KEY "$(openssl rand -hex 32)"
fi
if ! grep -q '^AI_CONNECTION_ENCRYPTION_KEY=.' .env; then
  set_env AI_CONNECTION_ENCRYPTION_KEY "$(openssl rand -hex 32)"
fi

set_env TOKEN_STORE_FILE .data/google-tokens.enc
set_env AI_CONNECTION_STORE_FILE .data/ai-connections.enc
set_env GMAIL_STORE_FILE .data/gmail-store.json
set_env GMAIL_SYNC_MAX_MESSAGES 250
set_env GMAIL_SYNC_INTERVAL_SECONDS 900
set_env AI_ANALYSIS_DAYS 30
set_env AI_MAX_MESSAGES 100

chmod 600 .env
docker compose -f docker-compose.hostinger.yml config --quiet
docker compose -f docker-compose.hostinger.yml up -d --build
docker compose -f docker-compose.hostinger.yml ps
