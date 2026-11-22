#!/bin/sh
# Donne un mot de passe aux deux rôles applicatifs (créés NOLOGIN par la migration 0001) : un rôle par pool de l'API.
# Exécuté APRÈS les migrations, avec le compte d'administration. Les mots de passe viennent de l'environnement, jamais du dépôt.
set -eu
: "${DATABASE_ADMIN_URL:?}" "${APP_DB_PASSWORD:?}" "${PLATFORM_DB_PASSWORD:?}"
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -v app_pw="$APP_DB_PASSWORD" -v platform_pw="$PLATFORM_DB_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE hmp_app LOGIN PASSWORD %L', :'app_pw') \gexec
SELECT format('ALTER ROLE hmp_platform LOGIN PASSWORD %L', :'platform_pw') \gexec
SQL
echo "Rôles hmp_app et hmp_platform prêts."
