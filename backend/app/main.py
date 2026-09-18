import hmac
import os
import secrets
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel

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

llm = AsyncOpenAI(base_url=LLM_BASE_URL, api_key="none")
bearer = HTTPBearer(auto_error=False)

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


# Single origin: serve the built frontend from the same port as the API, so the browser
# talks to /api on its own origin and Funnel exposes one port. Built by deploy.sh.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
