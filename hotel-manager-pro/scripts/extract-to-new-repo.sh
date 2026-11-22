#!/usr/bin/env bash
# Crée le dépôt DÉDIÉ de Hotel Manager Pro à partir du dépôt « GLOBAL » : on extrait l'historique du seul dossier
# hotel-manager-pro/ (sans la vidéo Remotion). Rien n'est supprimé ni copié à la main : tous les commits du logiciel sont conservés.
#
#   1. Créez sur GitHub un dépôt PRIVÉ VIDE (sans README, sans .gitignore, sans licence), par ex. hotel-manager-pro
#   2. Depuis le dépôt GLOBAL :   scripts/extract-to-new-repo.sh https://github.com/VOTRE-COMPTE/hotel-manager-pro.git
#
# Résultat dans le nouveau dépôt : branche « main » (= Production) et branche « staging » (= Tests), identiques au départ.
set -euo pipefail

NEW_REMOTE="${1:?usage : extract-to-new-repo.sh URL_DU_NOUVEAU_DEPOT_VIDE [branche-source]}"
PREFIX="hotel-manager-pro"
cd "$(git rev-parse --show-toplevel)"
[ -d "$PREFIX" ] || { echo "Dossier $PREFIX introuvable : lancez ce script depuis le dépôt GLOBAL." >&2; exit 1; }
SOURCE="${2:-$(git rev-parse --abbrev-ref HEAD)}"

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "Clone partiel détecté : récupération de l'historique complet…"
  git fetch --unshallow
fi
git diff --quiet HEAD -- "$PREFIX" || { echo "Des modifications non enregistrées existent dans $PREFIX : faites d'abord « git commit »." >&2; exit 1; }

git branch -D hmp-export >/dev/null 2>&1 || true
git subtree split --prefix="$PREFIX" -b hmp-export "$SOURCE" >/dev/null
echo "Historique extrait : $(git rev-list --count hmp-export) commit(s) depuis « $SOURCE »."
trap 'git branch -D hmp-export >/dev/null 2>&1 || true' EXIT

git push "$NEW_REMOTE" hmp-export:refs/heads/main hmp-export:refs/heads/staging
echo "Terminé : branches main et staging créées dans $NEW_REMOTE"
echo "Suite : GitHub > Settings > General > Default branch = main, puis protégez main (voir docs/environnements.md)."
