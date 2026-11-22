#!/usr/bin/env bash
# Restaure une sauvegarde dans une base VIDE (créée si besoin). Refuse d'écraser une base qui contient déjà des données.
#   scripts/restore.sh fichier.dump postgres://admin:mdp@hote:5432/hmp_restore
set -euo pipefail
DUMP="${1:?usage : restore.sh fichier.dump URL_BASE_CIBLE}"
TARGET="${2:?usage : restore.sh fichier.dump URL_BASE_CIBLE}"
ADMIN="${TARGET%/*}/postgres"
DB="${TARGET##*/}"
if [ "$(psql "$ADMIN" -qtA -c "SELECT 1 FROM pg_database WHERE datname = '$DB'")" != "1" ]; then
  psql "$ADMIN" -qtA -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\""
fi
if [ "$(psql "$TARGET" -qtA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" != "0" ]; then
  echo "La base cible n'est pas vide : restauration refusée (supprimez-la d'abord si c'est voulu)." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$DUMP"
echo "Restauré dans $DB."
