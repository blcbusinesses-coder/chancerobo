#!/usr/bin/env bash
# ── Update Pi Chance to the latest code. Your .env is NEVER touched. ──
set -e
cd "$(dirname "$0")/.."     # repo root (this script lives in pi/)

echo ">> Pulling latest code..."
git pull --ff-only

echo ">> Syncing dependencies..."
PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit --no-fund
# UI is pre-built in the repo (frontend/dist) — pulled in by git, no build needed.

echo ">> Restarting Chance..."
if command -v pm2 >/dev/null 2>&1 && pm2 describe chance >/dev/null 2>&1; then
  pm2 restart chance
else
  echo ">> (Not under pm2 — restart him with your start command, e.g. bash pi/start.sh)"
fi
echo ">> Done. .env left untouched."
