# client/detector.py
import os
import time
import cv2
from ultralytics import YOLO

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ANOMALY_CLASSES = ["Arrest", "Fighting", "Shooting", "Theft", "Vandalism"]

# ── Model loader ───────────────────────────────────────────────────────────────
def _load_model():
    global_path   = os.path.join(BASE_DIR, "model", "global_model.pt")
    fallback_path = os.path.join(BASE_DIR, "model", "best.pt")
    if os.path.exists(global_path):
        print("[ARES] detector: loading global_model.pt")
        return YOLO(global_path)
    print("[ARES] detector: global_model.pt not found, using best.pt")
    return YOLO(fallback_path)

model = _load_model()


# ── Source resolver ────────────────────────────────────────────────────────────
def _resolve_source(source: str):
    """
    Convert the source string into what cv2.VideoCapture expects.

    Accepted formats:
      '0', '1', '2'                     → int   USB / built-in webcam index
      'rtsp://…'                         → str   DVR or IP camera RTSP stream
      'http://192.168.x.x:8080/video'   → str   IP Webcam app (Android/iPhone)
      '/path/to/file.mp4'               → str   pre-recorded footage file
    """
    stripped = source.strip()
    if stripped.isdigit():
        return int(stripped)          # webcam index
    return stripped                   # RTSP URL, HTTP URL, or file path


def _open_capture(source) -> cv2.VideoCapture:
    """
    Open VideoCapture with correct settings for the source type.
    For RTSP streams forces TCP transport to prevent packet loss lag.
    Raises RuntimeError if the source cannot be opened.
    """
    # Force TCP for RTSP — prevents 5-10 second lag on LAN streams
    if isinstance(source, str) and source.startswith("rtsp"):
        os.environ.setdefault(
            "OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp"
        )

    cap = cv2.VideoCapture(source)

    if isinstance(source, str) and (
        source.startswith("rtsp") or source.startswith("http")
    ):
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # always read the latest frame

    if not cap.isOpened():
        raise RuntimeError(f"[ARES] Cannot open source: {source}")

    return cap


# ── Core detection loop ────────────────────────────────────────────────────────
def process_video(
    video_path,               # str (file / RTSP / HTTP URL) or int (webcam)
    client_id: str = "client1",
    sample_every: int = 10,   # run YOLO every Nth frame
    max_frames: int = None,   # None = until stream ends / file finishes
    conf: float = 0.5,
) -> list:
    """
    Read frames from video_path and run YOLO detection.

    Works identically for:
      • Pre-recorded file      process_video("footage/clip.mp4", "client1")
      • DVR RTSP stream        process_video("rtsp://admin:pass@192.168.1.64:554/Streaming/Channels/101", "client1")
      • Phone (IP Webcam app)  process_video("rtsp://192.168.1.5:8080/video", "client1")
      •                        process_video("http://192.168.1.5:8080/video", "client1")
      • USB webcam             process_video("0", "client1")
    """
    resolved = _resolve_source(str(video_path)) if not isinstance(video_path, int) else video_path

    try:
        cap = _open_capture(resolved)
    except RuntimeError as e:
        print(e)
        return []

    fps       = int(cap.get(cv2.CAP_PROP_FPS)) or 25
    alerts    = []
    frame_num = 0

    os.makedirs(os.path.join(BASE_DIR, "alerts"), exist_ok=True)
    print(f"[{client_id}] Source: {video_path}")

    while cap.isOpened():
        ret, frame = cap.read()

        # Stream lost — auto-reconnect for live sources, stop for files
        if not ret:
            if isinstance(resolved, str) and (
                resolved.startswith("rtsp") or resolved.startswith("http")
            ):
                print(f"[{client_id}] Stream lost — reconnecting in 2s…")
                time.sleep(2)
                cap.open(resolved)
                continue
            break   # end of file

        frame_num += 1

        if max_frames and frame_num > max_frames:
            break

        if frame_num % sample_every != 0:
            continue

        results = model(frame, conf=conf, verbose=False)

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
                    "bbox":       [x1, y1, x2, y2],
                }

                alerts.append(alert)
                print(f"  🚨 [{minutes}:{seconds:02d}] {cls_name} — {confidence:.0%}")

    cap.release()
    print(f"[{client_id}] Done. {len(alerts)} detections found.\n")
    return alerts