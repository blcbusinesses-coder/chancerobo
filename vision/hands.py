"""
Hand tracking -> cursor control — MediaPipe HandLandmarker, local.

Maps your index fingertip to the cursor and pinch (thumb+index) to a click.
Movement uses the Windows API (SetCursorPos) so it works correctly across the
full multi-monitor desktop, including a merged/spanned display.

ITEM 3 — CONTROL MAPPING. Two independently configurable rectangles:
  * cam_region   — the part of the CAMERA view that's "live" (fractions 0..1).
                   Smaller = more sensitive (small hand move = big cursor move).
  * screen_region— the part of the SCREEN the hand controls (absolute pixels).
                   Confine control to one monitor / third instead of all 5760px.
Config persists in hands_config.json and can be changed live via the service.
"""
import json
import os
import threading
import time

import cv2
import numpy as np
import requests

# MediaPipe + pyautogui are imported LAZILY (inside the methods that need them),
# because MediaPipe has no ARM/Raspberry-Pi wheels — on the Pi we use OpenCV for
# gesture control instead, and this module must still import fine without them.

MODEL = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "hands_config.json")


def _user32():
    import ctypes
    return ctypes.windll.user32

INDEX_TIP = 8
THUMB_TIP = 4

# Sensitivity presets → size of the live camera region (smaller = twitchier).
SENSITIVITY = {"low": 0.9, "medium": 0.7, "high": 0.5, "precise": 0.95}

DEFAULT_CONFIG = {
    "cam_region": {"x": 0.15, "y": 0.15, "w": 0.70, "h": 0.70},
    "screen_region": None,   # None = the whole desktop
    "smooth": 0.35,          # 0..1, higher = snappier
    "pinch": 0.05,           # thumb-index distance that counts as a click
}


def virtual_screen():
    """Full virtual desktop bounds (handles multi-monitor, incl. negative origins)."""
    return {
        "left": _user32().GetSystemMetrics(76),
        "top": _user32().GetSystemMetrics(77),
        "width": _user32().GetSystemMetrics(78),
        "height": _user32().GetSystemMetrics(79),
    }


def list_monitors():
    try:
        from screeninfo import get_monitors
        mons = sorted(get_monitors(), key=lambda m: m.x)
        return [
            {"index": i, "name": m.name or f"Monitor {i + 1}", "left": m.x, "top": m.y,
             "width": m.width, "height": m.height, "primary": bool(getattr(m, "is_primary", False))}
            for i, m in enumerate(mons)
        ]
    except Exception:
        v = virtual_screen()
        return [{"index": 0, "name": "Desktop", **v, "primary": True}]


def _rect(m):
    return {"left": m["left"], "top": m["top"], "width": m["width"], "height": m["height"]}


def screens():
    """
    Flat, numbered list of targetable screens — the thing you say "screen 4" to.

    A merged multi-monitor display (Surround, e.g. 5760x1080 = 3 panels) is split
    back into its individual panels; separate monitors (like a projector plugged
    in as an Extended display) each get their own number. So a 3-monitor array +
    projector becomes screens 1,2,3 (the array, left→right) and 4 (the projector).
    """
    import re  # noqa: F401 (kept local; re used elsewhere)
    mons = list_monitors()  # sorted left→right
    out = []
    n = 1
    for m in mons:
        ratio = m["width"] / max(1, m["height"])
        panels = max(1, int(round(ratio / (16 / 9))))  # how many ~16:9 panels fit
        if m.get("primary"):
            panels = int(os.environ.get("VISION_SURROUND_PANELS", panels))
        if panels <= 1:
            out.append({"n": n, "label": f"Screen {n}", "kind": "external" if not m.get("primary") else "single",
                        "part_of_primary": bool(m.get("primary")), "rect": _rect(m)})
            n += 1
        else:
            w = m["width"] // panels
            for i in range(panels):
                left = m["left"] + i * w
                width = (m["width"] - (panels - 1) * w) if i == panels - 1 else w
                out.append({"n": n, "label": f"Screen {n}", "kind": "array",
                            "part_of_primary": bool(m.get("primary")),
                            "rect": {"left": left, "top": m["top"], "width": width, "height": m["height"]}})
                n += 1
    # Tag the first non-primary/external screen as the likely projector.
    for s in out:
        if s["kind"] in ("external", "single") and not s["part_of_primary"]:
            s["label"] = f"Screen {s['n']} (projector / external)"
            s["projector"] = True
            break
    return out


def region_for_selection(sel):
    """
    Resolve a friendly selection to a screen rectangle (or None for the whole
    desktop). Understands: all/full; a number ("screen 4", "3"); left/middle/
    right (the main array); projector/external.
    """
    import re
    s = str(sel).lower().strip()
    if s in ("", "all", "full", "everything", "desktop", "whole", "both", "all screens"):
        return None
    scr = screens()
    if not scr:
        return None

    # Explicit number: "screen 4", "monitor 2", "#3", "4".
    num = re.search(r"\d+", s)
    if num:
        i = int(num.group())
        for x in scr:
            if x["n"] == i:
                return x["rect"]

    # Projector / external.
    if any(k in s for k in ("projector", "external", "beamer")):
        ext = [x for x in scr if x.get("projector") or x["kind"] in ("external",)]
        if ext:
            return ext[-1]["rect"]

    # Left / middle / right refer to the main array panels.
    array = [x for x in scr if x["part_of_primary"]] or scr
    if s in ("left", "first"):
        return array[0]["rect"]
    if s in ("right", "last"):
        return array[-1]["rect"]
    if s in ("middle", "center", "centre", "mid"):
        return array[len(array) // 2]["rect"]
    return None


def _centered_region(size):
    size = max(0.2, min(1.0, float(size)))
    off = (1.0 - size) / 2.0
    return {"x": off, "y": off, "w": size, "h": size}


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception:
            pass
    return cfg


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass


class HandController:
    def __init__(self, camera):
        self.camera = camera
        self._thread = None
        self._running = False
        self._landmarker = None
        self.cfg = load_config()
        self._sx = None
        self._sy = None
        self._pinched = False

    @property
    def running(self) -> bool:
        return self._running

    def set_config(self, patch: dict) -> dict:
        """Update mapping config (monitor/sensitivity/smooth/pinch/raw regions) and persist."""
        if "monitor" in patch or "screen" in patch:
            self.cfg["screen_region"] = region_for_selection(patch.get("monitor", patch.get("screen")))
        if "sensitivity" in patch:
            size = SENSITIVITY.get(str(patch["sensitivity"]).lower())
            if size is not None:
                self.cfg["cam_region"] = _centered_region(size)
        for k in ("cam_region", "screen_region", "smooth", "pinch"):
            if k in patch:
                self.cfg[k] = patch[k]
        save_config(self.cfg)
        return self.describe()

    def describe(self) -> dict:
        sr = self.cfg.get("screen_region")
        active = "whole desktop"
        if sr:
            for s in screens():
                if s["rect"] == sr:
                    active = s["label"]
                    break
            else:
                active = sr
        return {
            "running": self._running,
            "active_screen": active,
            "screen_region": sr or "whole desktop",
            "cam_region": self.cfg["cam_region"],
            "smooth": self.cfg["smooth"],
            "pinch": self.cfg["pinch"],
            "screens": screens(),
        }

    def _make_landmarker(self):
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        import pyautogui
        pyautogui.FAILSAFE = False
        pyautogui.PAUSE = 0
        base = python.BaseOptions(model_asset_path=MODEL)
        opts = vision.HandLandmarkerOptions(
            base_options=base, num_hands=1, running_mode=vision.RunningMode.VIDEO
        )
        return vision.HandLandmarker.create_from_options(opts)

    def start(self) -> bool:
        if self._running:
            return True
        if not self.camera.opened and not self.camera.start():
            return False
        self._landmarker = self._make_landmarker()
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return True

    def _target_screen(self):
        return self.cfg.get("screen_region") or virtual_screen()

    def _map(self, nx: float, ny: float):
        nx = 1.0 - nx  # mirror for natural control
        cr = self.cfg["cam_region"]
        cx = min(max((nx - cr["x"]) / cr["w"], 0.0), 1.0)
        cy = min(max((ny - cr["y"]) / cr["h"], 0.0), 1.0)
        sr = self._target_screen()
        return sr["left"] + cx * sr["width"], sr["top"] + cy * sr["height"]

    def _loop(self):
        import mediapipe as mp
        import pyautogui
        u = _user32()
        while self._running:
            frame = self.camera.read()
            if frame is None:
                time.sleep(0.01)
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            ts = int(time.monotonic() * 1000)
            try:
                result = self._landmarker.detect_for_video(mp_image, ts)
            except Exception:
                continue
            if not result.hand_landmarks:
                continue
            lm = result.hand_landmarks[0]
            tx, ty = self._map(lm[INDEX_TIP].x, lm[INDEX_TIP].y)

            smooth = float(self.cfg.get("smooth", 0.35))
            if self._sx is None:
                self._sx, self._sy = tx, ty
            else:
                self._sx += (tx - self._sx) * smooth
                self._sy += (ty - self._sy) * smooth
            u.SetCursorPos(int(self._sx), int(self._sy))

            dx = lm[THUMB_TIP].x - lm[INDEX_TIP].x
            dy = lm[THUMB_TIP].y - lm[INDEX_TIP].y
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < float(self.cfg.get("pinch", 0.05)) and not self._pinched:
                pyautogui.click()
                self._pinched = True
            elif dist >= float(self.cfg.get("pinch", 0.05)):
                self._pinched = False

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
        if self._landmarker:
            self._landmarker.close()
            self._landmarker = None
        self._sx = self._sy = None


class GestureController:
    """
    PROJECTOR GESTURE CONTROL — OpenCV only (works on the Raspberry Pi, no
    MediaPipe needed). Uses motion (background subtraction) to find your moving
    hand: the largest moving blob's centroid becomes a normalized cursor (0..1),
    and an open-vs-closed hand (convexity defects = finger count) is the pinch.
    Streams {x, y, pinch} to the Node backend, which drives the projector.

    Basic but dependency-free. The Hailo AI HAT can replace this later for
    precise, hardware-accelerated finger tracking.
    """
    def __init__(self, camera):
        self.camera = camera
        self._thread = None
        self._running = False
        self.target = None
        self._sx = None
        self._sy = None
        self._bg = None

    @property
    def running(self) -> bool:
        return self._running

    def start(self, target_url: str) -> bool:
        if self._running:
            return True
        if not self.camera.opened and not self.camera.start():
            return False
        self.target = target_url
        self._bg = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=40, detectShadows=False)
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return True

    @staticmethod
    def _closed(contour) -> bool:
        """Few convexity defects (extended fingers) => closed hand / pinch."""
        try:
            hull = cv2.convexHull(contour, returnPoints=False)
            defects = cv2.convexityDefects(contour, hull)
            if defects is None:
                return True
            fingers = sum(1 for i in range(defects.shape[0]) if defects[i, 0][3] > 9000)
            return fingers < 2
        except Exception:
            return False

    def _loop(self):
        kernel = np.ones((5, 5), np.uint8)
        while self._running:
            frame = self.camera.read()
            if frame is None:
                time.sleep(0.01)
                continue
            h, w = frame.shape[:2]
            blur = cv2.GaussianBlur(frame, (7, 7), 0)
            fg = self._bg.apply(blur)
            fg = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)[1]
            fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, kernel)
            fg = cv2.dilate(fg, kernel, iterations=2)
            cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cnts:
                c = max(cnts, key=cv2.contourArea)
                if cv2.contourArea(c) > 2500:
                    m = cv2.moments(c)
                    if m["m00"] != 0:
                        cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
                        nx, ny = 1.0 - cx / w, cy / h  # mirror
                        if self._sx is None:
                            self._sx, self._sy = nx, ny
                        else:
                            self._sx += (nx - self._sx) * 0.4
                            self._sy += (ny - self._sy) * 0.4
                        pinch = self._closed(c)
                        try:
                            requests.post(self.target, json={"x": self._sx, "y": self._sy, "pinch": pinch, "active": True}, timeout=0.3)
                        except Exception:
                            pass
            time.sleep(0.03)

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
        try:
            if self.target:
                requests.post(self.target, json={"active": False}, timeout=0.3)
        except Exception:
            pass
        self._sx = self._sy = self._bg = None
