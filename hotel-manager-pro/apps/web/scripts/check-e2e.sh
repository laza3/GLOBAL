#!/usr/bin/env bash
# Vérification de bout en bout COMPLÈTE : démarre la pile réelle (base jetable + API + interface construite), exécute les
# parcours et le balayage d'accessibilité, puis arrête tout. Usage : pnpm check:e2e   (captures dans apps/web/.shots/e2e)
set -euo pipefail
cd "$(dirname "$0")/.."
trap './scripts/stack.sh stop >/dev/null 2>&1 || true' EXIT
./scripts/stack.sh start
node scripts/e2e.cjs
