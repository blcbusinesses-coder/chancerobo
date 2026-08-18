"""
Local Geeni/Tuya outlet control for Chance — no cloud, no credits.

Reads smarthome/devices.json (produced once by setup.py) and drives the plugs
directly over the LAN with tinytuya. Invoked as a CLI by the Node side:

    outlets.py list
    outlets.py status <name>
    outlets.py on <name>
    outlets.py off <name>
    outlets.py toggle <name>

Always prints a single JSON line so Node can parse the result.
"""
import difflib
import json
import os
import sys

import tinytuya

HERE = os.path.dirname(__file__)
DEVICES = os.path.join(HERE, "devices.json")


def out(obj):
    print(json.dumps(obj))
    sys.exit(0)


def load_devices():
    if not os.path.exists(DEVICES):
        out({"error": "No devices.json yet. Run setup.py first (Tuya credential step)."})
    with open(DEVICES, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Accept either a bare list or {"devices": [...]}.
    return data.get("devices", data) if isinstance(data, dict) else data


def match(devices, name):
    """Find a device by fuzzy name (case-insensitive contains, then closest)."""
    name = (name or "").strip().lower()
    if not name:
        return devices[0] if len(devices) == 1 else None
    for d in devices:
        if d.get("name", "").strip().lower() == name:
            return d
    for d in devices:
        if name in d.get("name", "").strip().lower():
            return d
    names = [d.get("name", "") for d in devices]
    close = difflib.get_close_matches(name, [n.lower() for n in names], n=1, cutoff=0.5)
    if close:
        for d in devices:
            if d.get("name", "").strip().lower() == close[0]:
                return d
    return None


def connect(d):
    dev = tinytuya.OutletDevice(
        dev_id=d["id"],
        address=d.get("ip") or "Auto",   # Auto = discover on the LAN if IP unknown/changed
        local_key=d["key"],
        version=float(d.get("version", 3.3)),
    )
    dev.set_socketTimeout(5)
    return dev


def switch_dps(status):
    """Find the on/off boolean DPS (usually '1')."""
    dps = (status or {}).get("dps", {})
    if "1" in dps and isinstance(dps["1"], bool):
        return "1"
    for k, v in dps.items():
        if isinstance(v, bool):
            return k
    return "1"


def main():
    args = sys.argv[1:]
    if not args:
        out({"error": "usage: outlets.py <list|status|on|off|toggle> [name]"})
    cmd = args[0].lower()
    devices = load_devices()

    if cmd == "list":
        out({"ok": True, "devices": [{"name": d.get("name"), "ip": d.get("ip")} for d in devices]})

    name = args[1] if len(args) > 1 else ""
    d = match(devices, name)
    if not d:
        out({"error": f'No outlet matched "{name}". Known: ' + ", ".join(x.get("name", "?") for x in devices)})

    dev = connect(d)
    status = dev.status()
    if not status or "Error" in status or "dps" not in status:
        out({"error": f'Could not reach "{d.get("name")}" on the LAN. Is this PC on the same WiFi? ({status})'})
    key = switch_dps(status)
    is_on = bool(status["dps"].get(key, False))

    if cmd == "status":
        out({"ok": True, "name": d.get("name"), "on": is_on})
    if cmd == "on":
        dev.set_value(key, True)
        out({"ok": True, "name": d.get("name"), "on": True})
    if cmd == "off":
        dev.set_value(key, False)
        out({"ok": True, "name": d.get("name"), "on": False})
    if cmd == "toggle":
        dev.set_value(key, not is_on)
        out({"ok": True, "name": d.get("name"), "on": not is_on})

    out({"error": f"unknown command: {cmd}"})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        out({"error": str(e)})
