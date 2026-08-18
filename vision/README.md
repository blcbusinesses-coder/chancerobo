# C.H.A.N.C.E Vision Service

A small **local** Python service that gives Chance eyes and hand-control — all
on-device with MediaPipe. **No API credits, no cloud.** Chance (the Node app)
just makes HTTP calls to it.

## What it does

| Feature | How | Trigger |
|---|---|---|
| **See objects** (item 2) | MediaPipe ObjectDetector (EfficientDet-Lite0) | 👁 eye button in the dashboard, or say *"what do you see"* |
| **Hand → cursor** (item 1) | MediaPipe HandLandmarker → PyAutoGUI | say *"start hand control"* / *"stop hand control"* |

Index fingertip drives the pointer; **pinch** (thumb + index together) = click.

## Run it

```bash
npm run vision          # starts the service on http://127.0.0.1:8788
```

First-time setup (already done once):

```bash
py -m venv vision/.venv
vision/.venv/Scripts/python.exe -m pip install -r vision/requirements.txt
npm run vision:models   # downloads the two MediaPipe model files
```

## Endpoints

- `GET  /health` — service + camera + hand-control status
- `POST /see` — object detection on the current frame (+ annotated image as a data URI)
- `POST /hands/start` · `POST /hands/stop` · `GET /hands/status`

## Tuning (environment variables)

- `VISION_CAM_INDEX` (default `0`) — if the wrong camera opens (e.g. a built-in
  cam is 0 and the USB cam is 1), set this.
- `VISION_HAND_MARGIN` (default `0.15`) — trims the edges of the camera view that
  map to the full screen; smaller = you must reach further to hit screen corners.
- `VISION_HAND_SMOOTH` (default `0.35`) — cursor smoothing; higher = snappier but jumpier.
- `VISION_HAND_PINCH` (default `0.05`) — pinch distance that counts as a click.
- `VISION_PORT` (default `8788`).

## Notes

- The webcam can only be opened by one process, so this service owns it and both
  features share one feed.
- Detection is only as good as the light — a dim room makes the detector unsure.
- Roadmap: screen-region control mapping (item 3), a second cursor for two-person
  control (item 4), projector "hologram" integration (item 5).
