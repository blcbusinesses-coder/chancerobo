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

# Force OpenCV to use the direct V4L2 camera backend, not GStreamer (which fails
# to allocate the buffer on the Pi). Must be set before `import cv2`.
os.environ.setdefault("OPENCV_VIDEOIO_PRIORITY_GSTREAMER", "0")

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

    def _reads(self, cap) -> bool:
        """A device can 'open' but never deliver frames — verify with a real read."""
        for _ in range(8):
            ok, f = cap.read()
            if ok and f is not None:
                return True
            time.sleep(0.05)
        return False

    def _try_open(self, index: int):
        """Open ONE index, trying formats/resolutions until one actually streams."""
        backends = ([cv2.CAP_DSHOW, cv2.CAP_ANY] if IS_WINDOWS else [cv2.CAP_V4L2, cv2.CAP_ANY])
        # (fourcc, width, height). USB-2.0 cams usually stream MJPG at set sizes;
        # the default (raw YUYV) fails with VIDIOC_STREAMON: Invalid argument.
        env_w = os.environ.get("VISION_CAM_W")
        env_h = os.environ.get("VISION_CAM_H")
        combos = []
        if env_w and env_h:
            combos.append(("MJPG", int(env_w), int(env_h)))
        combos += [
            ("MJPG", 640, 480), ("MJPG", 320, 240), ("MJPG", 800, 600),
            ("MJPG", 1280, 720), ("YUYV", 640, 480), ("", 640, 480), ("", 320, 240),
        ]
        for be in backends:
            for fourcc, w, h in combos:
                try:
                    cap = cv2.VideoCapture(index, be)
                except Exception:
                    cap = cv2.VideoCapture(index)
                if not cap.isOpened():
                    cap.release()
                    continue
                if fourcc:
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc))
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
                if self._reads(cap):
                    print(f"[camera] index {index}: {fourcc or 'default'} {w}x{h}")
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
