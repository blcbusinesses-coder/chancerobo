# C.H.A.N.C.E Smart Outlets (Geeni / Tuya)

Local control of Geeni smart plugs — **on your LAN, no cloud at runtime, no AI
credits.** Chance turns them on/off by name.

Geeni is a rebranded Tuya platform, so we use `tinytuya`. The only setup is a
one-time credential fetch (Tuya requires this for *any* control method); after
that, everything is local.

## One-time setup

**0. Put this PC on the same WiFi as the plugs.** Local control needs them on the
same network. (A phone hotspot won't work — the plugs live on your home WiFi.)

**1. Create a free Tuya IoT Cloud project** (this is just to fetch each plug's
local key — you never use it again after setup):

1. Go to <https://iot.tuya.com> → sign up / log in.
2. **Cloud → Development → Create Cloud Project.**
   - Development Method: **Smart Home**. Data Center: **the one for your region**
     (Americas = US for the United States).
3. When it's created you'll see **Access ID / Client ID** and **Access Secret /
   Client Secret** — copy both.
4. **Link your Geeni account:** in the project → **Devices → Link App Account →
   Add App Account** → a QR code appears. Open the **Geeni app → Me → the scan
   icon (top-right)** and scan it. Your plugs now show under the project's Devices.
   - If the Geeni app has no scanner, add the plugs to the **Smart Life** app
     instead (same Tuya backend) and scan from there.

**2. Fetch the keys** (writes `devices.json`, then scans the LAN for IPs):

```bash
npm run outlets:setup -- <ACCESS_ID> <ACCESS_SECRET> <REGION>
```

`REGION` = `us` | `eu` | `cn` | `in`.

You should see your plugs listed with `key OK`. Done — control is now local.

## Everyday use

Just talk to Chance: *"turn on the lamp"*, *"turn off outlet 2"*, *"is the fan
on?"*, *"what outlets do you have?"*. Under the hood:

```bash
smarthome/.venv/Scripts/python.exe smarthome/outlets.py on "lamp"
smarthome/.venv/Scripts/python.exe smarthome/outlets.py list
```

## Notes

- `npm run outlets:scan` — find Tuya devices on the current LAN (sanity check that
  the PC and plugs are on the same network).
- Plug names come from whatever you named them in the Geeni app; matching is
  fuzzy ("lamp" matches "Living Room Lamp").
- If a plug's IP changes (DHCP), `outlets.py` auto-discovers it on the LAN.
