"""
Camera ownership for the vision service.

A USB webcam can only be opened by ONE process at a time, so a single shared
CameraStream owns it. A background thread continuously grabs frames into a
latest-frame buffer; both the "see" (object detection) and "hands" (cursor
control) features read from that same buffer instead of each opening the camera.
"""
import os
import threading
import time

import cv2

# Which camera. A USB cam is often index 1 when a built-in cam is 0 — override
# with VISION_CAM_INDEX if the wrong one opens.
CAM_INDEX = int(os.environ.get("VISION_CAM_INDEX", "0"))


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

    def start(self) -> bool:
        """Open the camera and begin grabbing frames. Idempotent."""
        if self._running:
            return True
        # CAP_DSHOW = DirectShow: opens faster and more reliably on Windows.
        cap = cv2.VideoCapture(self.index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            # Fall back to the default backend if DirectShow refused.
            cap = cv2.VideoCapture(self.index)
        if not cap.isOpened():
            cap.release()
            return False
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self._cap = cap
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        # Give the grabber a moment to land the first frame.
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
