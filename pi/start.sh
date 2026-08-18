#!/usr/bin/env bash
# ── Start Pi Chance from source + show his brain fullscreen on the monitor. ──
set -e
cd "$(dirname "$0")/.."     # repo root

need_node() { command -v node >/dev/null 2>&1 || return 0; [ "$(node -v | sed 's/v//;s/\..*//')" -lt 18 ]; }
if need_node; then
  echo ">> Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo ">> Installing deps (first run only takes a few min)..."
PUPPETEER_SKIP_DOWNLOAD=true npm install
( cd frontend && PUPPETEER_SKIP_DOWNLOAD=true npm install && npm run build )

echo ">> Starting backend..."
npm run server &
for i in $(seq 1 40); do curl -s http://localhost:8787/api/health >/dev/null 2>&1 && break; sleep 1; done

CHROME="$(command -v chromium-browser || command -v chromium || echo chromium-browser)"
echo ">> Opening his brain fullscreen..."
"$CHROME" --kiosk --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream \
  --noerrdialogs --disable-infobars "http://localhost:8787/?orb=1" &

echo ">> Chance is live. (Alt+F4 to exit, Ctrl+C to stop.)"
wait
