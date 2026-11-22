#!/usr/bin/env bash
# Sauvegarde logique de la base (format « custom » compressé) avec rotation.
#   DATABASE_ADMIN_URL=postgres://… BACKUP_DIR=/var/backups/hmp KEEP=14 scripts/backup.sh
# À planifier (cron quotidien) et à COPIER HORS DU SERVEUR. Sauvegarder aussi ENCRYPTION_KEY, séparément.
set -euo pipefail
: "${DATABASE_ADMIN_URL:?définir DATABASE_ADMIN_URL}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/hmp-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE.partial" "$DATABASE_ADMIN_URL"
mv "$FILE.partial" "$FILE"
# Un fichier vide ou illisible n'est pas une sauvegarde : on vérifie qu'on peut en lire la table des matières
pg_restore --list "$FILE" >/dev/null
ls -1t "$DIR"/hmp-*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "Sauvegarde : $FILE ($(du -h "$FILE" | cut -f1))"
