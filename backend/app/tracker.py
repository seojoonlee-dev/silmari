"""Turn frames into windows, stretches and notifications with the vision model."""
import asyncio
import base64
import json
import logging
import re
import secrets
import time
from pathlib import Path

from openai import AsyncOpenAI

from .store import Store

log = logging.getLogger("silmari.tracker")

CATEGORIES = ("work", "comms", "leisure", "meet", "other")

SYSTEM = """You analyze one screenshot of a person's computer screen for a memory aid.
Every visible application window counts equally; there is no main window.

Return ONLY a JSON object of this exact shape:
{
  "windows": [
    {"id": "w-xxxx", "app": "VS Code", "what": "frontend · App.tsx", "category": "work", "summary": "one or two sentences on what this window shows"}
  ],
  "notifications": [
    {"app": "Slack", "text": "Minji: did you send the intro draft yet?"}
  ],
  "activity": "one plain sentence, second person, describing what the person is doing across the windows"
}

Rules:
- One entry per visible application window. Two windows of the same app with different projects,
  documents or threads are two entries with different ids.
- "app": the application name. "what": the document, project, page or thread it shows, short.
- "category": one of work, comms, leisure, meet, other.
- KNOWN windows are listed in the user message with their ids. If a visible window is the same
  window (same app and same document/project/thread), REUSE its id exactly. Otherwise give a new
  id "w-" plus four random letters or digits.
- "notifications": toasts, banners, badges with text, popups. Empty list if none.
- Never invent windows or text you cannot see. Keep everything short."""


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def _extract_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


class Tracker:
    def __init__(self, store: Store, llm: AsyncOpenAI, model: str, close_after_s: float = 600.0, analyze_every: int = 5):
        self.store = store
        self.llm = llm
        self.model = model
        self.close_after = close_after_s
        self.analyze_every = max(1, analyze_every)
        self._locks: dict[str, asyncio.Lock] = {}
        # image frames seen per device since the last analysis; the first frame is analyzed
        self._since: dict[str, int] = {}

    def lock(self, device: str) -> asyncio.Lock:
        return self._locks.setdefault(device, asyncio.Lock())

    async def analyze_image(self, path: Path, known: list[dict]) -> dict:
        known_txt = json.dumps(known, ensure_ascii=False) if known else "[]"
        res = await self.llm.chat.completions.create(
            model=self.model,
            max_tokens=700,
            temperature=0.1,
            messages=[
                {"role": "system", "content": SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"KNOWN windows currently open (reuse ids when matching): {known_txt}"},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{_b64(path)}"}},
                    ],
                },
            ],
            response_format={"type": "json_object"},
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        content = res.choices[0].message.content or "{}"
        data = _extract_json(content)
        # normalise
        wins = []
        seen_ids: set[str] = set()
        for w in data.get("windows", []) or []:
            if not isinstance(w, dict) or not w.get("app"):
                continue
            wid = str(w.get("id") or "").strip()
            if not re.fullmatch(r"w-[A-Za-z0-9]{2,12}", wid) or wid in seen_ids:
                wid = "w-" + secrets.token_hex(2)
            seen_ids.add(wid)
            cat = str(w.get("category", "other")).lower()
            wins.append(
                {
                    "id": wid,
                    "app": str(w["app"])[:60],
                    "what": str(w.get("what") or "")[:120],
                    "category": cat if cat in CATEGORIES else "other",
                    "summary": (str(w.get("summary") or "")[:600] or None),
                }
            )
        notes = [
            {"app": str(n.get("app") or "")[:60], "text": str(n.get("text") or "")[:300]}
            for n in (data.get("notifications", []) or [])
            if isinstance(n, dict) and n.get("text")
        ]
        return {"windows": wins, "notifications": notes, "activity": str(data.get("activity") or "")[:400]}

    async def process(self, device: str, frame_id: int) -> None:
        """Analyze one frame and update the tracker. Serialized per device."""
        async with self.lock(device):
            frame = self.store.frame(frame_id)
            if frame is None:
                return
            ts = float(frame["ts"])
            has_image = bool(frame["path"]) and not frame["unchanged"]
            due = has_image and self._since.get(device, 0) % self.analyze_every == 0
            if has_image:
                self._since[device] = self._since.get(device, 0) + 1
            try:
                if not due:
                    # Not this frame's turn: carry the last analysis forward so windows stay "seen".
                    prev = self.store.latest_analyzed_frame(device)
                    analysis = json.loads(prev["analysis"]) if prev else {"windows": [], "notifications": [], "activity": ""}
                else:
                    known = [
                        {"id": r["id"], "app": r["app"], "what": r["what"]} for r in self.store.open_windows(device)
                    ]
                    analysis = await self.analyze_image(Path(frame["path"]), known)
            except Exception as e:  # noqa: BLE001
                log.warning("frame %s analysis failed: %s", frame_id, e)
                self.store.set_analysis(frame_id, {"error": str(e)[:300], "windows": [], "notifications": [], "activity": ""})
                return
            self.store.set_analysis(frame_id, analysis)
            self._apply(device, ts, analysis)

    def _apply(self, device: str, ts: float, analysis: dict) -> None:
        for w in analysis["windows"]:
            self.store.upsert_window(device, w["id"], w["app"], w["what"], w["category"], ts, w.get("summary"))
        self.store.close_stale(device, ts - self.close_after)

        seen = set()
        for n in analysis["notifications"]:
            self.store.see_notification(device, n["app"], n["text"], ts)
            seen.add(n["text"])
        self.store.mark_dismissed(device, ts, seen)

        # A stretch is a period where the set of open windows did not change.
        open_ids = sorted(r["id"] for r in self.store.open_windows(device))
        cur = self.store.current_stretch(device)
        activity = analysis.get("activity") or ""
        if cur is None or json.loads(cur["window_ids"]) != open_ids:
            if cur is not None:
                self.store.end_stretch(int(cur["id"]), ts)
            self.store.start_stretch(device, ts, open_ids, activity)
        elif activity:
            self.store.set_stretch_summary(int(cur["id"]), activity)


def now() -> float:
    return time.time()
