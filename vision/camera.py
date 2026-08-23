"""
Camera ownership for the vision service.

Prefers the NATIVE Raspberry Pi camera (CSI ribbon) via picamera2 — the reliable
path on Pi OS. Falls back to a USB webcam via OpenCV (V4L2) if there's no Pi cam.
A background thread grabs frames into a shared latest-frame buffer that both the
"see" (object detection) and "gesture" features read from.
"""
import os
import sys
import threading
import time

# Force OpenCV to use the direct V4L2 camera backend, not GStreamer (which fails
# to allocate the buffer on the Pi). Must be set before `import cv2`.
os.environ.setdefault("OPENCV_VIDEOIO_PRIORITY_GSTREAMER", "0")

import cv2

CAM_INDEX = int(os.environ.get("VISION_CAM_INDEX", "0"))
CAM_W = int(os.environ.get("VISION_CAM_W", "640"))
CAM_H = int(os.environ.get("VISION_CAM_H", "480"))
IS_WINDOWS = sys.platform.startswith("win")


class CameraStream:
    def __init__(self, index: int = CAM_INDEX):
        self.index = index
        self._cap = None       # OpenCV VideoCapture (USB webcam)
        self._picam = None      # picamera2 (native Pi camera)
        self._frame = None
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self.width = 0
        self.height = 0

    @property
    def opened(self) -> bool:
        if not self._running:
            return False
        return self._picam is not None or (self._cap is not None and self._cap.isOpened())

    # ── Native Pi camera (CSI ribbon) via picamera2 ──────────────────────────
    def _start_picam(self) -> bool:
        try:
            from picamera2 import Picamera2
        except Exception:
            return False
        try:
            picam = Picamera2()
            # "RGB888" gives a BGR-ordered array — exactly what OpenCV expects.
            cfg = picam.create_video_configuration(main={"size": (CAM_W, CAM_H), "format": "RGB888"})
            picam.configure(cfg)
            picam.start()
            time.sleep(0.5)  # warm up
            frame = picam.capture_array()
            if frame is None:
                picam.stop(); picam.close(); return False
            self._picam = picam
            print(f"[camera] using NATIVE Pi camera {CAM_W}x{CAM_H}")
            return True
        except Exception as e:
            print(f"[camera] Pi camera (picamera2) unavailable: {e}")
            return False

    # ── USB webcam via OpenCV (V4L2 / DirectShow) ────────────────────────────
    def _reads(self, cap) -> bool:
        for _ in range(8):
            ok, f = cap.read()
            if ok and f is not None:
                return True
            time.sleep(0.05)
        return False

    def _try_open(self, index: int):
        backends = ([cv2.CAP_DSHOW, cv2.CAP_ANY] if IS_WINDOWS else [cv2.CAP_V4L2, cv2.CAP_ANY])
        combos = [("MJPG", CAM_W, CAM_H), ("MJPG", 640, 480), ("MJPG", 320, 240),
                  ("MJPG", 1280, 720), ("YUYV", 640, 480), ("", 640, 480), ("", 320, 240)]
        for be in backends:
            for fourcc, w, h in combos:
                try:
                    cap = cv2.VideoCapture(index, be)
                except Exception:
                    cap = cv2.VideoCapture(index)
                if not cap.isOpened():
                    cap.release(); continue
                if fourcc:
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc))
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
                if self._reads(cap):
                    print(f"[camera] using USB cam index {index}: {fourcc or 'default'} {w}x{h}")
                    return cap
                cap.release()
        return None

    def _start_usb(self) -> bool:
        for idx in [self.index] + [i for i in range(6) if i != self.index]:
            cap = self._try_open(idx)
            if cap is not None:
                self.index = idx
                self._cap = cap
                return True
        return False

    def start(self) -> bool:
        """Open a camera (Pi cam preferred, USB fallback) and start grabbing. Idempotent."""
        if self._running:
            return True
        ok = False
        if not IS_WINDOWS:
            ok = self._start_picam()      # native Pi camera first
        if not ok:
            ok = self._start_usb()        # USB webcam fallback
        if not ok:
            print("[camera] no camera found (no Pi cam, no working USB cam)")
            return False
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        for _ in range(60):
            if self._frame is not None:
                break
            time.sleep(0.02)
        return self._frame is not None

    def _loop(self):
        while self._running:
            if self._picam is not None:
                try:
                    frame = self._picam.capture_array()
                except Exception:
                    time.sleep(0.02); continue
            else:
                ok, frame = self._cap.read()
                if not ok:
                    time.sleep(0.01); continue
            if frame is None:
                time.sleep(0.01); continue
            # picamera2 may hand back RGBA — drop alpha for OpenCV.
            if frame.ndim == 3 and frame.shape[2] == 4:
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            with self._lock:
                self._frame = frame
                self.height, self.width = frame.shape[:2]

    def read(self):
        with self._lock:
            return None if self._frame is None else self._frame.copy()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
        if self._picam is not None:
            try: self._picam.stop(); self._picam.close()
            except Exception: pass
            self._picam = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._frame = None
