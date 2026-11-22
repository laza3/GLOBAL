#!/usr/bin/env bash
# Prouve qu'un fichier de sauvegarde se RESTAURE vraiment, sur un serveur PostgreSQL JETABLE (jamais sur la vraie base) :
# rôles, restauration, propriétaire hmp_owner, droits des rôles applicatifs, comptages. Supprime la base de contrôle à la fin.
#   scripts/check-restore.sh fichier.dump postgres://compte-admin:mdp@hote:5432/postgres
# Utilisé par la sauvegarde nocturne (.github/workflows/backup.yml) avec un PostgreSQL de test fourni par GitHub.
set -euo pipefail
DUMP="${1:?usage : check-restore.sh fichier.dump URL_ADMIN_DU_SERVEUR_JETABLE}"
ADMIN="${2:?usage : check-restore.sh fichier.dump URL_ADMIN_DU_SERVEUR_JETABLE}"
cd "$(dirname "$0")/.."
DB="restore_check_$$"
BASE="${ADMIN%%\?*}"; QUERY="${ADMIN#"$BASE"}"
TARGET="${BASE%/*}/$DB$QUERY"
cleanup() { psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$ADMIN" -qtA -v ON_ERROR_STOP=1 -f deploy/prepare-managed-db.sql >/dev/null 2>&1
RESTORE_ADMIN_URL="$ADMIN" scripts/restore.sh "$DUMP" "$TARGET" >/dev/null

q() { psql "$TARGET" -qtA -c "$1"; }
tables="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
[ "$tables" -ge 20 ] || { echo "ANOMALIE : seulement $tables tables restaurées." >&2; exit 1; }
owner="$(q "SELECT relowner::regrole FROM pg_class WHERE relname = 'plans'")"
grants="$(q "SELECT has_table_privilege('hmp_app', 'plans', 'SELECT')")"
if [ "$owner" != "hmp_owner" ] || [ "$grants" != "t" ]; then echo "ANOMALIE : propriétaire ($owner) ou droits applicatifs ($grants) non conservés." >&2; exit 1; fi
migrations="$(q "SELECT count(*) FROM hmp_migrations.applied")"
marker="$(q "SELECT environment FROM deployment_marker" 2>/dev/null || echo aucun)"
echo "Restauration vérifiée : $tables tables, $migrations migrations, environnement « $marker »."
for t in hotels users reservations invoices payments; do echo "  $t : $(q "SELECT count(*) FROM $t") ligne(s)"; done
