"""
Camera ownership for the vision service.

A USB webcam can only be opened by ONE process at a time, so a single shared
CameraStream owns it. A background thread continuously grabs frames into a
latest-frame buffer; both the "see" (object detection) and "hands" (cursor
control) features read from that same buffer instead of each opening the camera.
"""
import os
import sys
import threading
import time

import cv2

# Which camera to PREFER. Auto-scan finds a working one if this fails. Override
# with VISION_CAM_INDEX if the wrong one opens.
CAM_INDEX = int(os.environ.get("VISION_CAM_INDEX", "0"))
IS_WINDOWS = sys.platform.startswith("win")


class CameraStream:
    def __init__(self, index: int = CAM_INDEX):
        self.index = index
        self._cap = None
        self._frame = None
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self.width = 0
        self.height = 0

    @property
    def opened(self) -> bool:
        return self._running and self._cap is not None and self._cap.isOpened()

    def _try_open(self, index: int):
        """Open ONE index with the right backend for this OS; verify a frame reads."""
        # Windows: DirectShow. Linux (Pi): V4L2. Fall back to the auto backend.
        backends = ([cv2.CAP_DSHOW, cv2.CAP_ANY] if IS_WINDOWS else [cv2.CAP_V4L2, cv2.CAP_ANY])
        for be in backends:
            try:
                cap = cv2.VideoCapture(index, be)
            except Exception:
                cap = cv2.VideoCapture(index)
            if not cap.isOpened():
                cap.release()
                continue
            # Many USB cams on Linux need MJPG to deliver frames at speed.
            if not IS_WINDOWS:
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            # A device can "open" but never deliver frames — verify with a real read.
            ok = False
            for _ in range(10):
                ok, _f = cap.read()
                if ok and _f is not None:
                    break
                time.sleep(0.05)
            if ok:
                return cap
            cap.release()
        return None

    def start(self) -> bool:
        """Open the camera and begin grabbing frames. Auto-scans indices. Idempotent."""
        if self._running:
            return True
        # Try the preferred index first, then scan 0..5 (USB cam is often not 0).
        candidates = [self.index] + [i for i in range(6) if i != self.index]
        cap = None
        for idx in candidates:
            cap = self._try_open(idx)
            if cap is not None:
                self.index = idx
                print(f"[camera] using index {idx}")
                break
        if cap is None:
            print("[camera] no working camera found (checked indices 0-5)")
            return False
        self._cap = cap
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        for _ in range(50):
            if self._frame is not None:
                break
            time.sleep(0.02)
        return self._frame is not None

    def _loop(self):
        while self._running:
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(0.01)
                continue
            with self._lock:
                self._frame = frame
                self.height, self.width = frame.shape[:2]

    def read(self):
        """Return the most recent BGR frame (or None if not started)."""
        with self._lock:
            return None if self._frame is None else self._frame.copy()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
        if self._cap:
            self._cap.release()
        self._cap = None
        self._frame = None
