# api/main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil, os, sys, json, sqlite3, socket
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client.detector import process_video

app = FastAPI(title="A.R.E.S API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

# ── Same credentials as main.js ──
CREDENTIALS = {
    "admin":    "ares2024",
    "operator": "ares1234",
    "guest":    "view"
}

# ── Database ──
def init_db():
    conn = sqlite3.connect("alerts.db")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   TEXT,
            client_id   TEXT,
            event_type  TEXT,
            confidence  REAL,
            frame_time  TEXT,
            video_name  TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ── Models ──
class LoginRequest(BaseModel):
    username: str
    password: str

# ── Routes ──
@app.get("/")
def root():
    return {"status": "A.R.E.S API is running ✅", "system": "ARES"}

@app.post("/login")
def login(req: LoginRequest):
    """Verify credentials against ARES credential store."""
    expected = CREDENTIALS.get(req.username)
    if expected and expected == req.password:
        return {
            "success": True,
            "username": req.username,
            "role": req.username.upper()
        }
    return {"success": False, "message": "Invalid credentials"}

@app.get("/latest-alert")
def get_latest_alert():
    """Most recent alert — used by mobile app for notification polling."""
    conn = sqlite3.connect("alerts.db")
    row = conn.execute(
        "SELECT * FROM alerts ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return {}
    return {
        "id":           row[0],
        "timestamp":    row[1],
        "client_id":    row[2],
        "event_type":   row[3],
        "confidence":   row[4],
        "time_in_video": row[5],
        "video":        row[6],
    }

@app.post("/upload-video/{client_id}")
async def upload_video(client_id: str, file: UploadFile = File(...)):
    upload_path = f"uploads/{client_id}_{file.filename}"
    with open(upload_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    alerts = process_video(upload_path, client_id)

    conn = sqlite3.connect("alerts.db")
    for alert in alerts:
        conn.execute("""
            INSERT INTO alerts (timestamp, client_id, event_type, confidence, frame_time, video_name)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            client_id,
            alert["event_type"],
            alert["confidence"],
            alert["timestamp"],
            file.filename
        ))
    conn.commit()
    conn.close()

    return {
        "status":           "success",
        "client_id":        client_id,
        "video":            file.filename,
        "total_detections": len(alerts),
        "alerts":           alerts
    }

@app.get("/alerts")
def get_alerts():
    conn   = sqlite3.connect("alerts.db")
    rows   = conn.execute("SELECT * FROM alerts ORDER BY id DESC").fetchall()
    conn.close()
    return {"alerts": [
        {"id": r[0], "timestamp": r[1], "client_id": r[2],
         "event_type": r[3], "confidence": r[4],
         "time_in_video": r[5], "video": r[6]}
        for r in rows
    ]}

@app.get("/training-history")
def get_training_history():
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    history_path = os.path.join(BASE_DIR, "outputs", "training_history.json")
    try:
        with open(history_path) as f:
            return {"history": json.load(f)}
    except FileNotFoundError:
        return {"history": []}

@app.get("/node-status")
def get_node_status():
    return {"nodes": [
        {"id": "Client_1", "status": "Active", "footage": "Street Scene"},
        {"id": "Client_2", "status": "Active", "footage": "Indoor Scene"},
        {"id": "Client_3", "status": "Active", "footage": "Mixed Scene"},
    ]}

# ── Print QR on startup ──
def print_connection_info():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "127.0.0.1"

    url = f"http://{ip}:8000"
    print("\n" + "="*50)
    print("  A.R.E.S API SERVER READY")
    print("="*50)
    print(f"  Local URL : {url}")
    print(f"  Mobile    : Scan QR in dashboard or enter IP manually")
    print("="*50 + "\n")

print_connection_info()
