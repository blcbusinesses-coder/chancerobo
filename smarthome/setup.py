"""
One-time credential fetch for the outlets — writes smarthome/devices.json.

Uses YOUR Tuya IoT Cloud project keys (which you create once) to pull each
plug's device id + local key, then scans the LAN to fill in current IPs. After
this runs, all control is fully local (outlets.py) — the cloud is never touched
again.

Run it with your Tuya IoT project credentials:

    setup.py <API_KEY> <API_SECRET> <REGION>

REGION is one of: us  eu  cn  in   (us = Americas data center).
"""
import json
import os
import sys

import tinytuya

HERE = os.path.dirname(__file__)
DEVICES = os.path.join(HERE, "devices.json")


def main():
    if len(sys.argv) < 4:
        print("usage: setup.py <API_KEY> <API_SECRET> <REGION us|eu|cn|in>")
        sys.exit(1)
    api_key, api_secret, region = sys.argv[1], sys.argv[2], sys.argv[3].lower()

    print("[setup] Connecting to Tuya IoT Cloud to fetch your devices...")
    cloud = tinytuya.Cloud(apiRegion=region, apiKey=api_key, apiSecret=api_secret)
    devices = cloud.getdevices(verbose=False)
    if isinstance(devices, dict) and devices.get("Error"):
        print("[setup] ERROR from Tuya Cloud:", devices)
        sys.exit(2)

    # tinytuya's getdevices() returns each device's LOCAL KEY as 'key'.
    records = [
        {
            "name": d.get("name") or d.get("id"),
            "id": d.get("id"),
            "key": d.get("key", "") or d.get("local_key", ""),
            "version": str(d.get("version", "3.3")),
        }
        for d in devices
    ]

    print(f"[setup] Got {len(records)} device(s). Scanning LAN for their IPs (~18s)...")
    found = tinytuya.deviceScan(False, 18)
    by_id = {}
    for ip, info in (found or {}).items():
        gwid = info.get("gwId") or info.get("id")
        if gwid:
            by_id[gwid] = {"ip": ip, "version": str(info.get("version", "3.3"))}

    for r in records:
        hit = by_id.get(r["id"])
        if hit:
            r["ip"] = hit["ip"]
            r["version"] = hit["version"]
        else:
            r["ip"] = ""  # outlets.py will auto-discover if blank

    with open(DEVICES, "w", encoding="utf-8") as f:
        json.dump({"devices": records}, f, indent=2)

    print(f"[setup] Wrote {DEVICES}:")
    for r in records:
        have_key = "key OK" if r["key"] else "NO KEY"
        have_ip = r["ip"] or "ip: auto"
        print(f"  - {r['name']}  ({have_key}, {have_ip})")
    print("[setup] Done. Now control locally with outlets.py.")


if __name__ == "__main__":
    main()
