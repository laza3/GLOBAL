#!/usr/bin/env bash
# Prouve qu'une sauvegarde est RESTAURABLE : la restaure dans une base jetable, compare des comptages, puis supprime la base.
# À exécuter régulièrement (une sauvegarde jamais restaurée est une hypothèse, pas une sauvegarde).
#   DATABASE_ADMIN_URL=postgres://… scripts/verify-backup.sh [fichier.dump]
set -euo pipefail
: "${DATABASE_ADMIN_URL:?définir DATABASE_ADMIN_URL}"
cd "$(dirname "$0")/.."
DUMP="${1:-$(ls -1t "${BACKUP_DIR:-./backups}"/hmp-*.dump | head -1)}"
SCRATCH="hmp_verify_$$"
BASE="${DATABASE_ADMIN_URL%%\?*}"
QUERY="${DATABASE_ADMIN_URL#"$BASE"}"            # options éventuelles (?sslmode=require)
ADMIN="$DATABASE_ADMIN_URL"                       # base existante : sert à créer/supprimer la base jetable
TARGET="${BASE%/*}/$SCRATCH$QUERY"
export RESTORE_ADMIN_URL="$ADMIN"
cleanup() { psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
scripts/restore.sh "$DUMP" "$TARGET" >/dev/null
count() { psql "$1" -qtA -c "SELECT count(*) FROM $2"; }
for table in hotels users reservations payments invoices audit_logs; do
  a="$(count "$DATABASE_ADMIN_URL" "$table")"; b="$(count "$TARGET" "$table")"
  # La sauvegarde peut dater de quelques minutes : la base vivante ne peut qu'avoir AUTANT ou PLUS de lignes
  if [ "$b" -gt "$a" ]; then echo "ANOMALIE : $table a plus de lignes dans la sauvegarde ($b) que dans la base ($a)." >&2; exit 1; fi
  echo "ok  $table : $b ligne(s) restaurée(s)"
done
# La base restaurée doit rester UTILISABLE PAR L'APPLICATION : propriétaire hmp_owner et droits des rôles applicatifs conservés
owner="$(psql "$TARGET" -qtA -c "SELECT relowner::regrole FROM pg_class WHERE relname = 'plans'")"
grants="$(psql "$TARGET" -qtA -c "SELECT has_table_privilege('hmp_app', 'plans', 'SELECT')")"
if [ "$owner" != "hmp_owner" ] || [ "$grants" != "t" ]; then echo "ANOMALIE : propriétaire ($owner) ou droits applicatifs ($grants) non conservés." >&2; exit 1; fi
echo "ok  propriétaire hmp_owner et droits des rôles applicatifs conservés"
echo "Sauvegarde $DUMP : restaurable."
