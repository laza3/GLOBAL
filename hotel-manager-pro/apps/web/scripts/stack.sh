#!/usr/bin/env bash
# Pile de vérification COMPLÈTE, en conditions réelles : base PostgreSQL jetable + API réelle (deux pools, rôles à moindre
# privilège, sans superutilisateur) + interface construite servie en même origine (proxy /api).
#
#   scripts/stack.sh start     construit et démarre (base neuve, 1 super-administrateur)
#   scripts/stack.sh stop      arrête tout et supprime la base jetable
#   scripts/stack.sh status
#
# Variables : E2E_DB (hmp_e2e) · E2E_API_PORT (3917) · E2E_WEB_PORT (4173) · E2E_NO_BUILD=1 (réutilise dist/)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
STATE=".stack"
DB="${E2E_DB:-hmp_e2e}"
API_PORT="${E2E_API_PORT:-3917}"
WEB_PORT="${E2E_WEB_PORT:-4173}"
PG="postgres://hmp_dev:hmp_dev@127.0.0.1:5432"
ADMIN_EMAIL="admin@e2e.test"
ADMIN_PASSWORD="Mot-de-passe-solide-42"

psql_admin() { PGPASSWORD=hmp_dev psql -h 127.0.0.1 -U hmp_dev -qtA -v ON_ERROR_STOP=1 "$@"; }

stop() {
  for f in api web; do
    [ -f "$STATE/$f.pid" ] && kill "$(cat "$STATE/$f.pid")" 2>/dev/null || true
    rm -f "$STATE/$f.pid"
  done
  pkill -f "vite preview --host 127.0.0.1 --port $WEB_PORT" 2>/dev/null || true
  pkill -f "src/index.ts" 2>/dev/null || true
  psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
  psql_admin -d postgres -c "ALTER ROLE hmp_app NOLOGIN PASSWORD NULL" -c "ALTER ROLE hmp_platform NOLOGIN PASSWORD NULL" >/dev/null 2>&1 || true
}

wait_for() {
  for _ in $(seq 1 60); do curl -sf "$1" >/dev/null && return 0; sleep 0.5; done
  echo "Délai dépassé : $1" >&2; return 1
}

case "${1:-}" in
  start)
    stop
    mkdir -p "$STATE"
    psql_admin -d postgres -c "CREATE DATABASE $DB OWNER hmp_dev" >/dev/null
    DATABASE_ADMIN_URL="$PG/$DB" pnpm --silent --filter @hmp/db migrate >/dev/null
    psql_admin -d "$DB" -c "ALTER ROLE hmp_app LOGIN PASSWORD 'e2e-app-pw'" -c "ALTER ROLE hmp_platform LOGIN PASSWORD 'e2e-platform-pw'" >/dev/null

    export DATABASE_URL_APP="postgres://hmp_app:e2e-app-pw@127.0.0.1:5432/$DB"
    export DATABASE_URL_PLATFORM="postgres://hmp_platform:e2e-platform-pw@127.0.0.1:5432/$DB"
    export CSRF_SECRET="e2e-secret-e2e-secret-e2e-secret-e2e-secret"
    export ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT"
    export PORT="$API_PORT" LOG_LEVEL=warn RATE_LIMIT_MAX=100000 AUTH_RATE_LIMIT_MAX=1000 PLATFORM_AUTH_RATE_LIMIT_MAX=1000

    DATABASE_ADMIN_URL="$PG/$DB" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="Administrateur E2E" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      pnpm --silent --filter @hmp/api create-admin >/dev/null

    (cd "$ROOT/apps/api" && setsid nohup pnpm --silent start >"$ROOT/apps/web/$STATE/api.log" 2>&1 </dev/null & echo $! >"$ROOT/apps/web/$STATE/api.pid")
    wait_for "http://127.0.0.1:$API_PORT/health/ready"

    [ "${E2E_NO_BUILD:-0}" = "1" ] || pnpm exec vite build >"$STATE/build.log" 2>&1
    API_URL="http://127.0.0.1:$API_PORT" setsid nohup pnpm exec vite preview --host 127.0.0.1 --port "$WEB_PORT" --strictPort >"$STATE/web.log" 2>&1 </dev/null &
    echo $! >"$STATE/web.pid"
    wait_for "http://127.0.0.1:$WEB_PORT"
    echo "Pile prête : http://127.0.0.1:$WEB_PORT   (API :$API_PORT, base $DB, admin $ADMIN_EMAIL)"
    ;;
  stop) stop; echo "Pile arrêtée." ;;
  status) curl -sf "http://127.0.0.1:$WEB_PORT" >/dev/null && echo "web OK" || echo "web arrêté"; curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && echo "api OK" || echo "api arrêtée" ;;
  *) echo "Usage : scripts/stack.sh start|stop|status" >&2; exit 2 ;;
esac
