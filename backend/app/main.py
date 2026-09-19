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
import logging
import re
import shutil

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
BIG_CHANGE = float(os.environ.get("BIG_CHANGE", "20"))  # mean pixel diff (0-255) that forces analysis, e.g. a workspace switch
LOCAL_CHANGE = float(os.environ.get("LOCAL_CHANGE", "28"))  # strongest 4x4-block diff that forces analysis, e.g. a toast
STRETCH_REFRESH_S = float(os.environ.get("STRETCH_REFRESH_S", "60"))  # how often the open stretch's narrative is rewritten
MAX_MODEL_CALLS = int(os.environ.get("MAX_MODEL_CALLS", "6"))  # concurrent vision-model requests across all devices
RETAIN_H = float(os.environ.get("RETAIN_H", "24"))  # frames older than this are deleted
SIGHTING_GAP_S = float(os.environ.get("SIGHTING_GAP_S", "15"))  # unseen longer than this breaks a lane's visible run

llm = AsyncOpenAI(base_url=LLM_BASE_URL, api_key="none")
bearer = HTTPBearer(auto_error=False)
store = Store(DATA_DIR / "silmari.db")
tracker = Tracker(
    store, llm, LLM_MODEL, close_after_s=CLOSE_AFTER_S, analyze_every=ANALYZE_EVERY, big_change=BIG_CHANGE,
    stretch_refresh_s=STRETCH_REFRESH_S, max_model_calls=MAX_MODEL_CALLS, local_change=LOCAL_CHANGE,
)

app = FastAPI(title="silmari-backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


async def _retention_loop() -> None:
    """Delete frame files and rows older than RETAIN_H, every 10 minutes."""
    while True:
        try:
            cutoff = time.time() - RETAIN_H * 3600
            for p in store.old_frame_paths(cutoff):
                Path(p).unlink(missing_ok=True)
            store.delete_frames_before(cutoff)
        except Exception as e:  # noqa: BLE001
            logging.getLogger("silmari").warning("retention: %s", e)
        await asyncio.sleep(600)


@app.on_event("startup")
async def _start_background() -> None:
    asyncio.create_task(_retention_loop())


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


class SettingsBody(BaseModel):
    device: str
    lang: str


class AskBody(BaseModel):
    device: str
    question: str
    at: float | None = None
    history: list[dict] = []


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
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    diff: float | None = Form(default=None),
    local: float | None = Form(default=None),
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
    frame_id = store.add_frame(device, ts, path, unchanged, (width, height) if width and height else None, diff, local)
    tracker.note_latest(device, frame_id)
    background.add_task(tracker.process, device, frame_id)
    return {"ok": True, "id": frame_id}


@app.delete("/api/device", dependencies=[Depends(require_auth)])
async def delete_device(device: str = Query(pattern=DEVICE_RE)):
    """Erase everything the server holds for one device: screenshots on disk and every row."""
    async with tracker.lock(device):
        counts = store.delete_device(device)
        tracker.forget(device)
        shutil.rmtree(DATA_DIR / "frames" / device, ignore_errors=True)
    return {"ok": True, "deleted": counts}


@app.get("/api/frames/{frame_id}/image", dependencies=[Depends(require_auth_or_query)])
async def frame_image(frame_id: int, device: str = Query(pattern=DEVICE_RE)):
    """Frames are addressed by id but scoped to the device that recorded them: every user shares
    the password, so the (unguessable) device id is what keeps one person's screen from another."""
    row = store.frame(frame_id)
    if row is None or not row["path"] or row["device"] != device:
        raise HTTPException(status_code=404, detail="no image")
    return FileResponse(row["path"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.post("/api/settings", dependencies=[Depends(require_auth)])
async def set_settings(body: SettingsBody):
    """Per-device settings. Changing the language rewrites the stretch narratives in that language."""
    if not re.fullmatch(DEVICE_RE, body.device) or body.lang not in ("en", "ko"):
        raise HTTPException(status_code=400, detail="bad request")
    changed = store.setting(body.device, "lang", "en") != body.lang
    store.set_setting(body.device, "lang", body.lang)
    if changed:
        asyncio.create_task(tracker.regenerate_all(body.device))
    return {"ok": True, "lang": body.lang, "regenerating": changed}


@app.post("/api/ask", dependencies=[Depends(require_auth)])
async def ask(body: AskBody):
    if not re.fullmatch(DEVICE_RE, body.device) or not body.question.strip():
        raise HTTPException(status_code=400, detail="bad request")
    try:
        return {"ok": True, **(await tracker.ask(body.device, body.question, body.at, body.history))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"model error: {e}") from e


@app.get("/api/chat", dependencies=[Depends(require_auth)])
async def chat_history(device: str = Query(pattern=DEVICE_RE)):
    """The device's conversation so far, oldest first."""
    return {
        "ok": True,
        "turns": [
            {"id": r["id"], "ts": r["ts"], "at": r["at"], "q": r["question"], "a": r["answer"], "cites": json.loads(r["cites"])}
            for r in store.chats(device)
        ],
    }


@app.get("/api/frames/{frame_id}/analysis", dependencies=[Depends(require_auth)])
async def frame_analysis(frame_id: int, device: str = Query(pattern=DEVICE_RE)):
    """What the model saw in this frame (or the analysis it inherited): windows with boxes."""
    row = store.frame(frame_id)
    if row is None or row["device"] != device:
        raise HTTPException(status_code=404, detail="no frame")
    return {"ok": True, "id": frame_id, "ts": row["ts"], "analysis": json.loads(row["analysis"]) if row["analysis"] else None}


@app.get("/api/timeline", dependencies=[Depends(require_auth)])
async def timeline(device: str = Query(pattern=DEVICE_RE)):
    now = time.time()
    # Lanes draw only when a window was actually on screen. A run extends through every frame whose
    # analysis lists the window, inherited ones included (a frame inherits only when the scene did
    # not change, so it is evidence the window was still there), and ends at a transition frame
    # (workspace switch), at the first analysis that lacks the window, or after a long silence.
    visible: dict[str, list[list[float]]] = {}
    open_run: dict[str, list[float]] = {}
    for fr in store.db.execute("SELECT ts, analysis FROM frames WHERE device=? AND analysis IS NOT NULL ORDER BY ts", (device,)).fetchall():
        try:
            a = json.loads(fr["analysis"])
        except (ValueError, TypeError):
            continue
        ts = float(fr["ts"])
        if a.get("transition"):
            for run in open_run.values():
                run[1] = max(run[1], ts)
            open_run.clear()
            continue
        if a.get("error") and not a.get("windows"):
            continue
        ids = {w["id"] for w in a.get("windows", [])}
        for wid, run in list(open_run.items()):
            if wid not in ids or ts - run[1] > SIGHTING_GAP_S * 2:
                del open_run[wid]
        for wid in ids:
            if wid in open_run:
                open_run[wid][1] = ts
            else:
                run = [ts, ts]
                visible.setdefault(wid, []).append(run)
                open_run[wid] = run
    windows = [
        {
            "id": store.unkey(r["id"]), "app": r["app"], "what": r["what"], "title": r["title"], "category": r["category"],
            "start": r["first_seen"], "end": r["closed_at"], "lastSeen": r["last_seen"], "summary": r["summary"],
            "visible": visible.get(store.unkey(r["id"]), []),
        }
        for r in store.all_windows(device)
    ]
    stretches = [
        {
            "id": r["id"], "start": r["start"], "end": r["end"], "windowIds": [store.unkey(i) for i in json.loads(r["window_ids"])],
            "summary": r["summary"] or "", "narrative": r["narrative"] or "", "leftHere": json.loads(r["left_here"]) if r["left_here"] else [],
            "questions": json.loads(r["questions"]) if r["questions"] else [],
        }
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
