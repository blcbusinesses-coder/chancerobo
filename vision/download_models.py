"""
One-time model fetch for the vision service.

Downloads the two MediaPipe model files (from Google's official model CDN) that
the object detector and hand tracker need. Run once during setup; skips files
that already exist.
"""
import os

import requests

MODELS = {
    "efficientdet_lite0.tflite": "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite",
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
}

HERE = os.path.join(os.path.dirname(__file__), "models")


def main():
    os.makedirs(HERE, exist_ok=True)
    for name, url in MODELS.items():
        dest = os.path.join(HERE, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"[models] have {name} ({os.path.getsize(dest)//1024} KB) — skip")
            continue
        print(f"[models] downloading {name} ...")
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        with open(dest, "wb") as f:
            f.write(r.content)
        print(f"[models]   saved {name} ({len(r.content)//1024} KB)")
    print("[models] done.")


if __name__ == "__main__":
    main()
