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

echo ">> Installing backend deps (first run takes a few min)..."
npm config set fetch-timeout 600000 >/dev/null 2>&1 || true
npm config set fetch-retries 5 >/dev/null 2>&1 || true
PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit --no-fund
# The UI is pre-built and committed (frontend/dist) — nothing to build on the Pi.

echo ">> Starting backend..."
npm run server &
for i in $(seq 1 40); do curl -s http://localhost:8787/api/health >/dev/null 2>&1 && break; sleep 1; done

# Start the vision service (hand tracking / gestures) alongside Chance, so you
# never need a second terminal. Skips silently if it isn't set up yet.
if [ -x vision/.venv/bin/python ]; then
  echo ">> Starting vision service..."
  pkill -f "vision/service.py" 2>/dev/null || true
  (cd "$(pwd)" && vision/.venv/bin/python vision/service.py > /tmp/chance-vision.log 2>&1 &)
fi

# Clear any stale cached page so an update never shows a white/old screen.
rm -rf ~/.cache/chromium/Default/Cache ~/.cache/chromium/Default/"Code Cache" 2>/dev/null || true

CHROME="$(command -v chromium-browser || command -v chromium || echo chromium-browser)"
echo ">> Opening his brain fullscreen..."
"$CHROME" --kiosk --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream \
  --disk-cache-size=1 --disable-application-cache \
  --noerrdialogs --disable-infobars "http://localhost:8787/?orb=1" &

echo ">> Chance is live. (Alt+F4 to exit, Ctrl+C to stop.)"
wait
