"""
C.H.A.N.C.E vision service — a small local HTTP server Chance calls.

Owns the webcam and exposes:
  GET  /health          -> service + camera + hand-control status
  POST /see             -> object detection on the current frame (+ annotated image)
  POST /hands/start     -> begin hand -> cursor control
  POST /hands/stop      -> stop it
  GET  /hands/status    -> is hand control running

Everything runs locally (MediaPipe). No cloud, no API credits. Detection models
are lazy-loaded on first use so the service boots instantly.
"""
import os

from flask import Flask, jsonify, request

from camera import CameraStream
from hands import HandController

app = Flask(__name__)

camera = CameraStream()
hands = HandController(camera)
_seer = None  # lazy: importing/creating the detector is the slow part


def get_seer():
    global _seer
    if _seer is None:
        from detect import ObjectSeer
        _seer = ObjectSeer()
    return _seer


@app.get("/health")
def health():
    return jsonify(
        ok=True,
        camera_open=camera.opened,
        cam_index=camera.index,
        hands_running=hands.running,
    )


@app.post("/see")
def see():
    if not camera.opened and not camera.start():
        return jsonify(error=f"Could not open camera index {camera.index}. Is it plugged in / used by another app?"), 503
    frame = camera.read()
    if frame is None:
        return jsonify(error="No frame from camera yet."), 503
    result = get_seer().see(frame)
    return jsonify(ok=True, width=camera.width, height=camera.height, **result)


@app.post("/hands/start")
def hands_start():
    if hands.start():
        return jsonify(ok=True, running=True)
    return jsonify(error=f"Could not start hand control (camera index {camera.index}).", running=False), 503


@app.post("/hands/stop")
def hands_stop():
    hands.stop()
    return jsonify(ok=True, running=False)


@app.get("/hands/status")
def hands_status():
    return jsonify(running=hands.running)


@app.get("/hands/config")
def hands_config_get():
    return jsonify(hands.describe())


@app.post("/hands/config")
def hands_config_set():
    patch = request.get_json(force=True, silent=True) or {}
    return jsonify(hands.set_config(patch))


@app.get("/monitors")
def monitors():
    from hands import list_monitors
    return jsonify(monitors=list_monitors())


@app.get("/screens")
def screens_list():
    from hands import screens
    return jsonify(screens=screens())


if __name__ == "__main__":
    port = int(os.environ.get("VISION_PORT", "8788"))
    print(f"[vision] C.H.A.N.C.E vision service on http://127.0.0.1:{port}")
    print("[vision]   POST /see  /hands/start  /hands/stop   GET /health  /hands/status")
    app.run(host="127.0.0.1", port=port, threaded=True)
