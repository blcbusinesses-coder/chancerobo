"""
Object detection — MediaPipe ObjectDetector (EfficientDet-Lite0), fully local.

Given a BGR frame, returns the detected objects (label + confidence + box) and
an annotated JPEG. No network, no API credits — this is how Chance "sees" for
free. A richer natural-language description stays opt-in via the cloud brain.
"""
import base64
import os

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL = os.path.join(os.path.dirname(__file__), "models", "efficientdet_lite0.tflite")


class ObjectSeer:
    def __init__(self, score_threshold: float = 0.4, max_results: int = 12):
        base = python.BaseOptions(model_asset_path=MODEL)
        opts = vision.ObjectDetectorOptions(
            base_options=base,
            score_threshold=score_threshold,
            max_results=max_results,
            running_mode=vision.RunningMode.IMAGE,
        )
        self._detector = vision.ObjectDetector.create_from_options(opts)

    def see(self, frame_bgr):
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._detector.detect(mp_image)

        objects = []
        annotated = frame_bgr.copy()
        for det in result.detections:
            cat = det.categories[0]
            box = det.bounding_box
            objects.append(
                {
                    "label": cat.category_name,
                    "score": round(float(cat.score), 3),
                    "box": [int(box.origin_x), int(box.origin_y), int(box.width), int(box.height)],
                }
            )
            x, y, w, h = box.origin_x, box.origin_y, box.width, box.height
            cv2.rectangle(annotated, (x, y), (x + w, y + h), (255, 111, 47), 2)
            cv2.putText(
                annotated,
                f"{cat.category_name} {cat.score:.0%}",
                (x, max(0, y - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 111, 47),
                2,
            )

        # Collapse duplicates into a friendly summary list ("2 person, 1 laptop").
        counts = {}
        for o in objects:
            counts[o["label"]] = counts.get(o["label"], 0) + 1
        summary = [{"label": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]

        ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
        image_data = "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii") if ok else None

        return {"objects": objects, "summary": summary, "imageData": image_data}
