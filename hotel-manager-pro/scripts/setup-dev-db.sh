#!/usr/bin/env bash
# Prépare une base de DÉVELOPPEMENT locale : compte superuser « hmp_dev », base « hmp_dev », migrations.
# Ne pas utiliser en production (mot de passe de développement, superuser).
set -euo pipefail

cd "$(dirname "$0")/.."

ADMIN_USER="${HMP_DEV_USER:-hmp_dev}"
ADMIN_PASS="${HMP_DEV_PASSWORD:-hmp_dev}"
DB_NAME="${HMP_DEV_DB:-hmp_dev}"
HOST="${HMP_DEV_HOST:-127.0.0.1}"
PORT="${HMP_DEV_PORT:-5432}"

as_postgres() {
  if id postgres >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo -n -u postgres psql -v ON_ERROR_STOP=1 -qtA "$@"
  elif id postgres >/dev/null 2>&1; then
    su postgres -c "psql -v ON_ERROR_STOP=1 -qtA $(printf '%q ' "$@")"
  else
    echo "Compte système 'postgres' introuvable : créez le superuser ${ADMIN_USER} à la main, puis relancez." >&2
    exit 1
  fi
}

as_postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ADMIN_USER}') THEN CREATE ROLE ${ADMIN_USER} SUPERUSER LOGIN PASSWORD '${ADMIN_PASS}'; END IF; END \$\$;"
if [ "$(as_postgres -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]; then
  as_postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${ADMIN_USER}"
fi

export DATABASE_ADMIN_URL="postgres://${ADMIN_USER}:${ADMIN_PASS}@${HOST}:${PORT}/${DB_NAME}"
pnpm --filter @hmp/db migrate
echo "Base de développement prête : ${DATABASE_ADMIN_URL}"
