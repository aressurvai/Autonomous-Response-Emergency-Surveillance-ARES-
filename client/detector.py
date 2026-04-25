# client/detector.py
import os
from ultralytics import YOLO
import cv2

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _load_model():
    global_path   = os.path.join(BASE_DIR, "model", "global_model.pt")
    fallback_path = os.path.join(BASE_DIR, "model", "best.pt")
    if os.path.exists(global_path):
        print("[ARES] detector: loading global_model.pt")
        return YOLO(global_path)
    print("[ARES] detector: global_model.pt not found, using best.pt")
    return YOLO(fallback_path)

model = _load_model()

ANOMALY_CLASSES = ["Arrest", "Fighting", "Shooting", "Theft", "Vandalism"]

def process_video(video_path, client_id="client1"):
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return []

    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 25
    alerts = []
    frame_num = 0

    os.makedirs(os.path.join(BASE_DIR, "alerts"), exist_ok=True)

    print(f"[{client_id}] Processing video: {video_path}")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_num += 1

        if frame_num % 10 != 0:
            continue

        results = model(frame, conf=0.5, verbose=False)

        for result in results:
            for box in result.boxes:
                cls_id     = int(box.cls[0])
                cls_name   = model.names[cls_id]
                confidence = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])

                timestamp_sec = frame_num / fps
                minutes = int(timestamp_sec // 60)
                seconds = int(timestamp_sec % 60)

                alert = {
                    "client_id":  client_id,
                    "frame":      frame_num,
                    "timestamp":  f"{minutes}:{seconds:02d}",
                    "event_type": cls_name,
                    "confidence": round(confidence, 3),
                    "bbox":       [x1, y1, x2, y2]
                }

                alerts.append(alert)
                print(f"  🚨 [{minutes}:{seconds:02d}] {cls_name} — {confidence:.0%}")

    cap.release()
    print(f"[{client_id}] Done. {len(alerts)} detections found.\n")
    return alerts