#!/usr/bin/env bash
# Prouve qu'une sauvegarde est RESTAURABLE : la restaure dans une base jetable, compare des comptages, puis supprime la base.
# À exécuter régulièrement (une sauvegarde jamais restaurée est une hypothèse, pas une sauvegarde).
#   DATABASE_ADMIN_URL=postgres://… scripts/verify-backup.sh [fichier.dump]
set -euo pipefail
: "${DATABASE_ADMIN_URL:?définir DATABASE_ADMIN_URL}"
cd "$(dirname "$0")/.."
DUMP="${1:-$(ls -1t "${BACKUP_DIR:-./backups}"/hmp-*.dump | head -1)}"
SCRATCH="hmp_verify_$$"
ADMIN="${DATABASE_ADMIN_URL%/*}/postgres"
TARGET="${DATABASE_ADMIN_URL%/*}/$SCRATCH"
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
echo "Sauvegarde $DUMP : restaurable."
