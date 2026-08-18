# C.H.A.N.C.E — Raspberry Pi build

The **headless** Chance — no web UI, no Electron. Same brain + tools as the
desktop build (it imports the shared `../src`), controlled over **Telegram**.
This is the "projects & building / robotics" Chance.

> The desktop build (business focus) and this Pi build share `src/` but run
> differently: desktop = orb + dashboard; Pi = headless Telegram. They can
> diverge over time.

---

## 0. What runs where
- **Runs on the Pi:** `pi/boot.ts` (Telegram + all the API-based tools: web
  search, news, stocks, Spotify, Zapier, Google, media, saved values…).
- **Set up separately on the Pi later:** the Python bits — `vision/` (webcam +
  MediaPipe/Hailo) and `smarthome/` (Geeni). They're ARM-specific, so they get
  their own install when you wire up the robotics/camera.
- **Not on the Pi:** `frontend/` and `desktop/` (that's the computer's UI).

## 1. One-time Pi prep
On the Pi (via its screen, or SSH once it's on your network):
```bash
# Node 22 (matches the dev machine)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # should print v22.x
```

## 2. Get the CODE onto the Pi — WITHOUT an SD-card reader
Your Pi already boots an OS, so we send the code **over your WiFi network**.
First, on the Pi, find its address and make sure SSH is on:
```bash
sudo raspi-config    # Interface Options → SSH → Enable   (once)
hostname -I          # note the IP, e.g. 192.168.1.50
```

Then, **on the computer** (Git Bash, in `D:\Agents`), pick ONE:

### Option A — Tar + SCP (works out of the box on Windows) ✅ recommended
```bash
tar --exclude=node_modules --exclude=frontend --exclude=desktop \
    --exclude=vision/.venv --exclude=smarthome/.venv --exclude=.git \
    --exclude=audio_cache --exclude=.browser-agent -czf chance-pi.tar.gz -C /d/Agents .
scp chance-pi.tar.gz pi@<PI_IP>:~/
```
Then on the Pi:
```bash
mkdir -p ~/chance && tar -xzf ~/chance-pi.tar.gz -C ~/chance && cd ~/chance
```

### Option B — rsync (if you have it; fast for re-syncs later)
```bash
rsync -avz --exclude node_modules --exclude frontend --exclude desktop \
  --exclude '*.venv' --exclude .git /d/Agents/ pi@<PI_IP>:~/chance/
```

### Option C — GitHub (best long-term: `git pull` to update)
Push this project to a private GitHub repo, then on the Pi:
`git clone <your-repo-url> ~/chance`

## 3. Install + configure on the Pi
```bash
cd ~/chance
# Skip Puppeteer's Chromium download (heavy on ARM; browser tools stay off).
PUPPETEER_SKIP_DOWNLOAD=true npm install
```
Make sure `.env` is present (the tar/rsync includes it; over Git/USB, copy it
across yourself). It holds all the keys — keep it private.

## 4. Run him
```bash
npm run pi
```
You should see **"C.H.A.N.C.E — Pi build ONLINE (headless)"** and the Telegram
channel goes live. Message his bot from your phone — he's running on the Pi now.

### Keep him running 24/7 (after a reboot)
```bash
sudo npm install -g pm2
pm2 start "npm run pi" --name chance && pm2 save && pm2 startup
```

---

## Notes
- **Browser tools** are off on the Pi (we skip Chromium). Web *search* still
  works — it's an API, not a browser.
- **Vision / smart-home** need their Python envs rebuilt on ARM (and the Hailo
  AI HAT for accelerated vision) — a separate step when you add the camera/robot.
- To **update** the Pi later: re-run the rsync (Option B) or `git pull` (Option C),
  then `npm install` if deps changed, and restart (`pm2 restart chance`).
