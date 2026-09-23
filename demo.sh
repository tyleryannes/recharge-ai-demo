#!/usr/bin/env bash
# Growth Planner (V2) demo on localhost: installs dependencies if needed, starts the
# server on demo data only (no agents, no API calls, no cost) and opens the browser.
#   ./demo.sh            → http://localhost:4100
#   ./demo.sh --port 4200
#   ./demo.sh --play 5   → also starts a run straight away at 5× speed
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required (https://nodejs.org)." >&2
  exit 1
fi
# Older corepack builds ship stale npm signing keys and refuse to fetch pnpm; skip that check.
export COREPACK_INTEGRITY_KEYS=0
if ! command -v pnpm >/dev/null 2>&1; then corepack enable >/dev/null 2>&1 || npm install -g pnpm@9; fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  pnpm install --silent
fi
# Already running? Just open it instead of failing on the busy port.
PORT=4100
for ((i=1; i<=$#; i++)); do if [ "${!i}" = "--port" ]; then j=$((i+1)); PORT="${!j}"; fi; done
if curl -fs "http://localhost:$PORT/api/store" 2>/dev/null | grep -q '"demo":true'; then
  echo "The demo is already running at http://localhost:$PORT/"
  command -v open >/dev/null && open "http://localhost:$PORT/"
  exit 0
fi
exec pnpm --silent research demo "$@"
