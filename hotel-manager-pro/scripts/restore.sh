#!/usr/bin/env bash
# Restaure une sauvegarde dans une base VIDE (créée si besoin). Refuse d'écraser une base qui contient déjà des données.
#   scripts/restore.sh fichier.dump postgres://admin:mdp@hote:5432/hmp_restore
set -euo pipefail
DUMP="${1:?usage : restore.sh fichier.dump URL_BASE_CIBLE}"
TARGET="${2:?usage : restore.sh fichier.dump URL_BASE_CIBLE}"
ADMIN="${TARGET%/*}/postgres"
DB="${TARGET##*/}"
CREATED=0
if [ "$(psql "$ADMIN" -qtA -c "SELECT 1 FROM pg_database WHERE datname = '$DB'")" != "1" ]; then
  psql "$ADMIN" -qtA -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\""
  CREATED=1
fi
if [ "$(psql "$TARGET" -qtA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" != "0" ]; then
  echo "La base cible n'est pas vide : restauration refusée (supprimez-la d'abord si c'est voulu)." >&2
  exit 1
fi
# Les trois rôles doivent exister sur le serveur cible (même serveur, ou après deploy/prepare-managed-db.sql sur un nouveau serveur)
if [ "$(psql "$ADMIN" -qtA -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('hmp_owner', 'hmp_app', 'hmp_platform')")" != "3" ]; then
  echo "Rôles hmp_owner / hmp_app / hmp_platform absents du serveur cible : exécutez d'abord deploy/prepare-managed-db.sql." >&2
  exit 1
fi
# hmp_owner doit pouvoir créer dans le schéma public AVANT que les propriétaires ne lui soient rendus (sans cela, un compte non-superuser échoue)
psql "$TARGET" -qtA -v ON_ERROR_STOP=1 -c "GRANT USAGE, CREATE ON SCHEMA public TO hmp_owner" >/dev/null
if ! pg_restore --exit-on-error --dbname="$TARGET" "$DUMP"; then
  if [ "$CREATED" = "1" ]; then psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null; echo "Restauration échouée : la base partielle a été supprimée." >&2; fi
  exit 1
fi
echo "Restauré dans $DB."
