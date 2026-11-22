#!/usr/bin/env bash
# Restaure une sauvegarde dans une base VIDE (créée si besoin). Refuse d'écraser une base qui contient déjà des données.
#   scripts/restore.sh fichier.dump postgres://admin:mdp@hote:5432/hmp_restore
set -euo pipefail
DUMP="${1:?usage : restore.sh fichier.dump URL_BASE_CIBLE}"
TARGET="${2:?usage : restore.sh fichier.dump URL_BASE_CIBLE}"
# L'adresse peut porter des options (?sslmode=require chez un hébergeur) : on les sépare du nom de la base
BASE="${TARGET%%\?*}"
QUERY="${TARGET#"$BASE"}"
DB="${BASE##*/}"
# Connexion d'administration (pour CREATE/DROP DATABASE) : RESTORE_ADMIN_URL, sinon la base « postgres » du même serveur
ADMIN="${RESTORE_ADMIN_URL:-${BASE%/*}/postgres$QUERY}"
CREATED=0
if ! psql "$TARGET" -qtA -c "SELECT 1" >/dev/null 2>&1; then
  psql "$ADMIN" -qtA -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\""
  CREATED=1
fi
if [ "$(psql "$TARGET" -qtA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" != "0" ]; then
  echo "La base cible n'est pas vide : restauration refusée (supprimez-la d'abord si c'est voulu)." >&2
  exit 1
fi
# Les trois rôles doivent exister sur le serveur cible (même serveur, ou après deploy/prepare-managed-db.sql sur un nouveau serveur)
if [ "$(psql "$TARGET" -qtA -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('hmp_owner', 'hmp_app', 'hmp_platform')")" != "3" ]; then
  echo "Rôles hmp_owner / hmp_app / hmp_platform absents du serveur cible : exécutez d'abord deploy/prepare-managed-db.sql." >&2
  exit 1
fi
# Comptes cités par la sauvegarde (propriétaires, droits, droits par défaut) mais absents du serveur cible : ex. « neondb_owner » (compte
# d'administration de l'hébergeur d'origine), « cloud_admin » et « neon_superuser » (réglages internes de Neon). Ils sont créés SANS
# droit de connexion : on restaure les DONNÉES et les droits applicatifs, pas l'infrastructure de l'ancien hébergeur.
roles_in_dump() {
  pg_restore --schema-only --file=- "$DUMP" | awk '
    /OWNER TO / { r = $0; sub(/.*OWNER TO /, "", r); sub(/;.*/, "", r); print r }
    /FOR ROLE / { r = $0; sub(/.*FOR ROLE /, "", r); sub(/ .*/, "", r); print r }
    /^(ALTER DEFAULT PRIVILEGES|GRANT|REVOKE) / && / (TO|FROM) / {
      r = $0; sub(/.* (TO|FROM) /, "", r); sub(/ WITH .*/, "", r); sub(/;.*/, "", r)
      n = split(r, parts, ","); for (i = 1; i <= n; i++) { gsub(/^ +| +$/, "", parts[i]); print parts[i] }
    }' | tr -d '"' | sort -u
}
create_missing_roles() {
  local role
  for role in $(roles_in_dump); do
    case "$role" in PUBLIC|GROUP|CURRENT_USER|SESSION_USER|CURRENT_ROLE|pg_*|"") continue ;; esac
    if [ "$(psql "$TARGET" -qtA -c "SELECT 1 FROM pg_roles WHERE rolname = '$role'")" != "1" ]; then
      psql "$TARGET" -qtA -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$role\" NOLOGIN" >/dev/null
    fi
  done
}
[ -n "${RESTORE_SKIP_PRESCAN:-}" ] || create_missing_roles   # (RESTORE_SKIP_PRESCAN : diagnostic du filet de sécurité ci-dessous)
# hmp_owner doit pouvoir créer dans le schéma public AVANT que les propriétaires ne lui soient rendus (sans cela, un compte non-superuser échoue)
psql "$TARGET" -qtA -v ON_ERROR_STOP=1 -c "GRANT USAGE, CREATE ON SCHEMA public TO hmp_owner" >/dev/null
# Filet de sécurité : si un compte inattendu manque encore (« role "x" does not exist »), on le crée, on repart d'une base vide et on recommence
attempt=0
while :; do
  attempt=$((attempt + 1))
  if err="$(pg_restore --exit-on-error --dbname="$TARGET" "$DUMP" 2>&1)"; then break; fi
  missing="$(printf '%s\n' "$err" | sed -nE 's/.*role "([^"]+)" does not exist.*/\1/p' | head -n1)"
  if [ "$CREATED" = "1" ] && [ -n "$missing" ] && [ "$attempt" -lt 8 ]; then
    psql "$ADMIN" -qtA -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$missing\" NOLOGIN" >/dev/null
    psql "$ADMIN" -qtA -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\"" >/dev/null
    psql "$TARGET" -qtA -v ON_ERROR_STOP=1 -c "GRANT USAGE, CREATE ON SCHEMA public TO hmp_owner" >/dev/null
    continue
  fi
  printf '%s\n' "$err" >&2
  if [ "$CREATED" = "1" ]; then psql "$ADMIN" -qtA -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null; echo "Restauration échouée : la base partielle a été supprimée." >&2; fi
  exit 1
done
echo "Restauré dans $DB."
