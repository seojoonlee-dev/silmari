import hmac
import os
import secrets
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
import asyncio
import json

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel

from .store import Store
from .tracker import Tracker

load_dotenv()

PASSWORD = os.environ.get("APP_PASSWORD")
if not PASSWORD:
    raise SystemExit("APP_PASSWORD is not set")
# Rotating APP_SECRET invalidates every client; if unset, a restart does the same.
SECRET = os.environ.get("APP_SECRET") or secrets.token_hex(32)
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3.6-35b-a3b")

# One shared bearer token derived from the password.
SESSION_TOKEN = hmac.new(SECRET.encode(), PASSWORD.encode(), "sha256").hexdigest()

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
CLOSE_AFTER_S = float(os.environ.get("CLOSE_AFTER_S", "600"))
ANALYZE_EVERY = int(os.environ.get("ANALYZE_EVERY", "5"))  # run the model on every Nth image frame

llm = AsyncOpenAI(base_url=LLM_BASE_URL, api_key="none")
bearer = HTTPBearer(auto_error=False)
store = Store(DATA_DIR / "silmari.db")
tracker = Tracker(store, llm, LLM_MODEL, close_after_s=CLOSE_AFTER_S, analyze_every=ANALYZE_EVERY)

app = FastAPI(title="silmari-backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_auth(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
    if creds is None or not hmac.compare_digest(creds.credentials, SESSION_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


def require_auth_or_query(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), token: str | None = Query(default=None)
) -> None:
    """Images are loaded by <img>, which cannot send headers, so accept ?token= too."""
    t = creds.credentials if creds else token
    if not t or not hmac.compare_digest(t, SESSION_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


DEVICE_RE = r"^[A-Za-z0-9_-]{4,64}$"


class LoginBody(BaseModel):
    password: str


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "silmari-backend",
        "host": socket.gethostname(),
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/login")
async def login(body: LoginBody):
    if not hmac.compare_digest(body.password, PASSWORD):
        raise HTTPException(status_code=401, detail="wrong password")
    return {"ok": True, "token": SESSION_TOKEN}


@app.get("/api/me", dependencies=[Depends(require_auth)])
async def me():
    return {"ok": True, "host": socket.gethostname(), "model": LLM_MODEL}


@app.post("/api/ping", dependencies=[Depends(require_auth)])
async def ping():
    """Round-trip through vLLM to prove the whole path works."""
    started = time.monotonic()
    try:
        res = await llm.chat.completions.create(
            model=LLM_MODEL,
            max_tokens=40,
            messages=[{"role": "user", "content": "Reply with one short friendly sentence confirming you are online."}],
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"llm error: {e}") from e
    reply = (res.choices[0].message.content or "").strip()
    return {"ok": True, "reply": reply, "ms": int((time.monotonic() - started) * 1000)}


@app.post("/api/frames", dependencies=[Depends(require_auth)])
async def post_frame(
    background: BackgroundTasks,
    device: str = Form(pattern=DEVICE_RE),
    ts: float = Form(),
    unchanged: bool = Form(default=False),
    image: UploadFile | None = File(default=None),
):
    """One captured frame. `ts` is epoch seconds from the client; `unchanged` means the screen
    looked identical to the previous frame and no image is attached."""
    if not unchanged and image is None:
        raise HTTPException(status_code=400, detail="image required unless unchanged")
    ts = min(ts, time.time() + 60)
    path = None
    if image is not None:
        d = DATA_DIR / "frames" / device
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{int(ts * 1000)}.jpg"
        p.write_bytes(await image.read())
        path = str(p)
    frame_id = store.add_frame(device, ts, path, unchanged)
    background.add_task(tracker.process, device, frame_id)
    return {"ok": True, "id": frame_id}


@app.get("/api/frames/{frame_id}/image", dependencies=[Depends(require_auth_or_query)])
async def frame_image(frame_id: int):
    row = store.frame(frame_id)
    if row is None or not row["path"]:
        raise HTTPException(status_code=404, detail="no image")
    return FileResponse(row["path"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/timeline", dependencies=[Depends(require_auth)])
async def timeline(device: str = Query(pattern=DEVICE_RE)):
    now = time.time()
    windows = [
        {
            "id": r["id"], "app": r["app"], "what": r["what"], "category": r["category"],
            "start": r["first_seen"], "end": r["closed_at"], "lastSeen": r["last_seen"], "summary": r["summary"],
        }
        for r in store.all_windows(device)
    ]
    stretches = [
        {"id": r["id"], "start": r["start"], "end": r["end"], "windowIds": json.loads(r["window_ids"]), "summary": r["summary"] or ""}
        for r in store.all_stretches(device)
    ]
    notifications = [
        {"id": r["id"], "app": r["app"], "text": r["text"], "time": r["first_seen"], "dismissed": bool(r["dismissed"])}
        for r in store.notifications(device)
    ]
    latest = store.latest_analyzed_frame(device)
    latest_img = store.latest_image_frame(device)
    frames = [
        {"id": r["id"], "ts": r["ts"]}
        for r in store.db.execute("SELECT id, ts FROM frames WHERE device=? AND path IS NOT NULL ORDER BY ts", (device,)).fetchall()
    ]
    return {
        "ok": True,
        "now": now,
        "windows": windows,
        "stretches": stretches,
        "notifications": notifications,
        "latest": {"id": latest["id"], "ts": latest["ts"], "analysis": json.loads(latest["analysis"])} if latest else None,
        "latestImage": {"id": latest_img["id"], "ts": latest_img["ts"]} if latest_img else None,
        "frames": frames,
    }


# Single origin: serve the built frontend from the same port as the API, so the browser
# talks to /api on its own origin and Funnel exposes one port. Built by deploy.sh.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
