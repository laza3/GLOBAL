#!/usr/bin/env bash
# Vérification complète de l'interface : contrastes, build, puis rendu + accessibilité + comportements (Playwright).
# Usage : pnpm check:ui     (captures dans apps/web/.shots, ou SHOTS_DIR)
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm check:contrast
pnpm exec vite build

PORT="${PORT:-4173}"
pnpm exec vite preview --host 127.0.0.1 --port "$PORT" --strictPort >/tmp/hmp-preview.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT" >/dev/null && break
  sleep 0.3
done

BASE_URL="http://127.0.0.1:$PORT" node scripts/visual-check.cjs
