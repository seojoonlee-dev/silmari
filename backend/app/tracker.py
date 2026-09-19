"""Turn frames into windows, stretches and notifications with the vision model."""
import asyncio
import base64
import difflib
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
# Generic application types. Brands are unreliable (a custom app looks like a famous one) so
# windows are told apart by TYPE + CONTENT, never by a guessed product name.
APP_TYPES = ("browser", "editor", "terminal", "notes", "music", "video", "chat", "mail", "calendar", "files", "design", "document", "other")
APP_LABEL = {t: t.capitalize() for t in APP_TYPES}

SYSTEM = """You analyze one screenshot of a person's computer screen for a memory aid that later
tells them exactly what they were doing. Every visible application window counts equally.

Return ONLY a JSON object of this exact shape:
{
  "windows": [
    {
      "id": "w-q7k2",
      "type": "editor",
      "title": "App.tsx - frontend",
      "what": "frontend/src/App.tsx, useRecorder call around line 30",
      "category": "work",
      "summary": "Two short sentences, under 35 words: what this window shows and what the person is doing in it. Quote names, titles, file paths, functions, headings, track names, commands and numbers you can actually read.",
      "bbox": [x1, y1, x2, y2]
    }
  ],
  "notifications": [{"app": "Slack", "text": "Minji: did you send the intro draft yet?"}],
  "activity": "One or two specific sentences, second person ('You are ...'), about what the person is doing across the windows right now, naming the concrete things involved."
}

Rules:
- "type" is one of: browser, editor, terminal, notes, music (any music player: tracks, albums,
  playback controls), video, chat, mail, calendar, files (a file manager: Explorer, Finder),
  design, document (word processor, slides, spreadsheet), other. NEVER guess a product or brand name; a custom app that looks like a
  known product is still just its type. A terminal emulator (monospace text on a dark background,
  a shell prompt, command output, or a running text program such as an AI coding assistant's
  transcript) is ALWAYS type "terminal", never "editor", "notes" or "chat".
- "title": the window's own title text if one is visible (title bar, tab title), else "".
- "what": the specific content that tells THIS window apart from another of the same type: the
  document or file path, the web page and site, the note name, the track and artist, the running
  program. Quote what you can read; never invent.
- A window that is PARTLY hidden behind another window is still visible: list it, and give its
  full rectangle including the hidden part as best you can.
- Adjacent windows often share the same very dark background with no visible border between
  them. Look for a change of CONTENT, not of color: a region with a shell prompt or monospaced
  command output is a terminal window, and a document, note or page above or beside it is a
  separate window. On a tiled desktop, if a KNOWN window's rectangle sits entirely inside an area
  you were about to report as one window, that area holds more than one window: split it. System bars (taskbar, dock, menu bar),
  desktop icons and wallpaper are never windows.
- One entry per visible TOP-LEVEL application window. Panels, sidebars, split panes, tabs and
  embedded terminals INSIDE an application (an editor's terminal panel, its file tree, a browser's
  tabs) are parts of that ONE window, never separate entries. On a tiled desktop the screen is
  split into 1 to 4 (rarely more) non-overlapping areas and each area is exactly one window; count
  the areas first. Two windows of the same type with different content are two entries with
  different ids.
- A window is type "browser" ONLY if browser chrome is visible (tab strip, address bar). Text that
  talks about web pages, dashboards or apps inside a terminal or editor does not make it a browser.
- KNOWN windows are listed in the user message as ids with a type and a last position only. If a
  visible window is clearly the same window as a known one of the same type at the same position,
  reuse that id; otherwise give a new id "w-" plus four RANDOM letters or digits (like w-q7k2 or
  w-8ma3). Identity is checked separately, so when unsure prefer a new id.
- Describe every window from THIS screenshot's pixels only. A nearly empty window is described as
  what it is (for example a terminal showing only a shell prompt in ~).
- List ONLY windows actually visible in this screenshot. Omit known windows that are off screen.
  Text that merely mentions an app or a window (a dashboard, a list, a chat message) is not that
  window.
- If a browser shows the Silmari dashboard (this memory aid: a screen preview, a timeline with
  colored lanes and cards), it is ONE browser window. The dashboard contains a PICTURE of the
  screen: windows seen inside that picture, and names in its lists, are NOT windows on the screen.
- "bbox": the window's rectangle as [x1, y1, x2, y2], integers 0-1000 where 1000 is the full image
  width or height (top-left is 0,0). Cover the whole window including its title bar.
- "notifications": toasts, banners, badges with text, popups. "app" is the app the banner itself
  names or shows an icon for (Slack, Gmail, Mail, Teams, ...), never a guess from the text.
  Empty list if none.
- Be concrete and specific everywhere. Never pad with generalities."""

STRETCH_SYSTEM = """You write the memory of one stretch of someone's screen time from a sequence of snapshots
(each: time, the windows visible with what they showed, and a one-line activity).
Write "narrative": 3 to 6 sentences, second person, past tense, in time order, naming the files,
pages, notes, tracks, commands, people and topics that appear in the snapshots, and saying when you
moved between windows. Concrete, no generalities. Light Markdown is welcome: **bold** for names of
files, pages and people, `code` for commands and paths, and a short bullet list when several
separate things happened.
Write "left_here": up to 3 unfinished things that a snapshot shows DIRECT evidence of (text typed but
not sent, an unsaved-changes marker, a page read halfway, a command still running). Usually empty.
Write "questions": exactly 3 short questions this person might later ask about this stretch, in
first person as they would type them ("What did the ping error say?", "Which track was playing?",
"What was the notes page about?", "Which repo was I looking at?"). Each must be answerable from the
snapshots, but keep them at the level of what a person forgets: an error message, a page, a file, a
track, a person, a command, a topic. NO clock times or seconds in questions, no line numbers, no
claims about actions the snapshots do not show (a file being open is not a file being edited or
added). Nothing generic either ("What was I doing?").
Never invent anything that is not in the snapshots."""

ASK_SYSTEM = """You are the memory of one person's screen time today. You get their day as stretches (time
span, windows on screen, a narrative of what they did, unfinished things), detailed snapshots around
the moment they are looking at, the actual SCREENSHOTS of the most relevant moments (each labelled
with its time), and their question. Answer in second person, briefly and concretely, in light
Markdown. When the question is about what something said, showed, printed or contained, READ the
screenshots and quote the exact text you see there; the written summaries are only hints. Name the
actual names, paths, errors, tracks and commands. Every answer includes at least one time, written exactly as [[HH:MM:SS]] (taken from the
material's "time", "from" or "to" fields), for the moment it talks about, so it becomes a link.
If the material does not contain the answer, say so plainly instead of guessing."""

STRETCH_SCHEMA = {
    "type": "object",
    "properties": {
        "narrative": {"type": "string", "minLength": 80},
        "left_here": {
            "type": "array", "maxItems": 3,
            "items": {"type": "object", "properties": {"text": {"type": "string"}, "where": {"type": "string"}}, "required": ["text", "where"]},
        },
        "questions": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    },
    "required": ["narrative", "left_here", "questions"],
}


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


CROP_PROMPT = """This is a CROP of part of a computer screen, first read as ONE window. Check whether it actually
holds two or more SEPARATE top-level application windows tiled next to each other or stacked.
Adjacent windows can share the same dark background with no visible border; tell them apart by
CONTENT: a code editor, a terminal with a shell prompt, a notes document, a web page, a music
player are different applications. PANELS INSIDE ONE APPLICATION ARE NOT WINDOWS: an editor's
integrated terminal panel, its file tree and its tabs belong to the editor (one window); a
browser's tabs belong to the browser. A terminal showing code, a chat-like transcript or an AI
assistant is still one terminal window. If the crop is one window, return just that one.
Return ONLY JSON: {"windows": [{"type": "terminal|editor|browser|notes|music|video|chat|mail|calendar|files|design|document|other", "title": "window title if visible else empty", "what": "the specific content: file path, page, note name, track, command", "summary": "two specific sentences on what it shows", "bbox": [x1, y1, x2, y2]}]}
bbox as integers 0-1000 relative to THIS crop. Count carefully and never merge two different apps."""
LARGE_BOX = 0.3  # fraction of the screen above which a reported window is re-checked for hidden splits


def _norm_bbox(raw, size: tuple[int, int] | None) -> list[float] | None:
    """Model boxes come as 0..1000 fractions, or occasionally pixels; return fractions 0..1."""
    try:
        x1, y1, x2, y2 = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None
    if size and (max(x1, x2) > 1000 or max(y1, y2) > 1000):
        w, h = size
        x1, x2, y1, y2 = x1 / w, x2 / w, y1 / h, y2 / h
    else:
        x1, x2, y1, y2 = x1 / 1000, x2 / 1000, y1 / 1000, y2 / 1000
    x1, x2 = sorted((min(max(x1, 0), 1), min(max(x2, 0), 1)))
    y1, y2 = sorted((min(max(y1, 0), 1), min(max(y2, 0), 1)))
    if x2 - x1 < 0.02 or y2 - y1 < 0.02:
        return None
    return [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]


def _iou(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b:
        return 0.0
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _contains(a: list[float] | None, b: list[float] | None) -> bool:
    """One box holds most of the other (a tile reported twice at different sizes)."""
    if not a or not b:
        return False
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return small > 0 and inter / small >= 0.8


def _norm(s) -> str:
    return " ".join(str(s or "").lower().split())


def _similar(a, b) -> float:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _extract_json(text: str) -> dict:
    """Parse the model's JSON, salvaging a reply that was cut off mid-object: keep the complete
    entries and drop the partial tail (flagged with "truncated")."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    log.warning("model reply was not valid JSON (%d chars), salvaging", len(text))
    m = re.search(r"\{.*", text, re.S)
    if not m:
        raise ValueError("no JSON object in reply")
    body = m.group(0)
    for cut in [i.end() for i in re.finditer(r"\}\s*(?=,|\])", body)][::-1]:
        candidate = body[:cut]
        opens = candidate.count("[") - candidate.count("]")
        closes = candidate.count("{") - candidate.count("}")
        try:
            data = json.loads(candidate + "]" * opens + "}" * closes)
            data["truncated"] = True
            return data
        except json.JSONDecodeError:
            continue
    raise ValueError("unparseable JSON reply")


class Tracker:
    def __init__(
        self, store: Store, llm: AsyncOpenAI, model: str, close_after_s: float = 600.0, analyze_every: int = 5,
        big_change: float = 20.0, stretch_refresh_s: float = 60.0, max_model_calls: int = 6, local_change: float = 28.0,
    ):
        self.local_change = local_change
        self.store = store
        self.llm = llm
        self.model = model
        self.close_after = close_after_s
        self.analyze_every = max(1, analyze_every)
        self.big_change = big_change
        self.stretch_refresh_s = stretch_refresh_s
        self._locks: dict[str, asyncio.Lock] = {}
        self._since: dict[str, int] = {}
        self._summarizing: set[int] = set()
        self._pending_set: dict[str, tuple[list[str], float]] = {}
        self._latest_frame: dict[str, int] = {}  # newest uploaded frame per device, for coalescing
        self._hints: dict[str, tuple[float, list[dict]]] = {}  # native layout hints per device
        self._sem = asyncio.Semaphore(max(1, max_model_calls))  # shared across devices
        self._settling: dict[str, int] = {}  # frames skipped since a big change, per device
        self._transition_at: dict[str, float] = {}  # last frame of the old scene before a switch, per device
        self._last_stable_ts: dict[str, float] = {}  # most recent non-transition frame, per device

    async def _create(self, **kw):
        return await self.llm.chat.completions.create(**kw)

    def lang(self, device: str) -> str:
        return "ko" if self.store.setting(device, "lang", "en") == "ko" else "en"

    @staticmethod
    def _lang_note(lang: str, what: str) -> str:
        return f"\n\nLANGUAGE: write {what} in Korean, polite style (한국어 존댓말, '~했습니다/~입니다'체). Keep file names, paths, commands, URLs and product names as they appear on screen." if lang == "ko" else ""

    def lock(self, device: str) -> asyncio.Lock:
        return self._locks.setdefault(device, asyncio.Lock())

    def forget(self, device: str) -> None:
        self._since.pop(device, None)
        self._latest_frame.pop(device, None)

    def set_hint(self, device: str, windows: list[dict]) -> None:
        clean = []
        for w in windows:
            bb = w.get("bbox")
            if not (isinstance(bb, list) and len(bb) == 4):
                continue
            x1, y1, x2, y2 = (min(max(float(v), 0.0), 1.0) for v in bb)
            if x2 - x1 < 0.03 or y2 - y1 < 0.03:
                continue
            clean.append({"cls": str(w.get("cls") or "")[:60], "title": str(w.get("title") or "")[:120], "bbox": [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]})
        self._hints[device] = (time.time(), clean)

    def hint(self, device: str, max_age: float = 8.0) -> list[dict] | None:
        h = self._hints.get(device)
        return h[1] if h and time.time() - h[0] <= max_age else None

    async def apply_hint(self, path: Path, analysis: dict, hint: list[dict]) -> None:
        """Rebuild the window list from the hinted rectangles. Each rectangle takes the model window
        whose center falls inside it (or the largest such); a rectangle with none is described by a
        crop call; extra model windows inside an already-taken rectangle are dropped."""
        try:
            from PIL import Image
        except ImportError:
            return
        img = None
        out: list[dict] = []
        used: set[int] = set()
        for h in hint:
            x1, y1, x2, y2 = h["bbox"]
            cands = []
            for i, w in enumerate(analysis["windows"]):
                if i in used or not w.get("bbox"):
                    continue
                cx, cy = (w["bbox"][0] + w["bbox"][2]) / 2, (w["bbox"][1] + w["bbox"][3]) / 2
                if x1 <= cx <= x2 and y1 <= cy <= y2:
                    cands.append((_iou(w["bbox"], h["bbox"]), i))
            if cands:
                cands.sort(reverse=True)
                i = cands[0][1]
                used.add(i)
                w = dict(analysis["windows"][i]); w["bbox"] = h["bbox"]
                if h.get("title") and not w.get("title"):
                    w["title"] = h["title"]
                out.append(w)
                continue
            # nothing matched: describe the rectangle itself
            if img is None:
                img = Image.open(path).convert("RGB")
            W, H = img.size
            crop = img.crop((int(x1 * W), int(y1 * H), int(x2 * W), int(y2 * H)))
            import io
            buf = io.BytesIO(); crop.save(buf, "JPEG", quality=70)
            try:
                async with self._sem:
                    res = await self._create(
                        model=self.model, max_tokens=500, temperature=0.1,
                        messages=[{"role": "user", "content": [
                            {"type": "text", "text": "This crop is exactly ONE application window" + (f' (its title bar says "{h["title"]}")' if h.get("title") else "") + '. Return ONLY JSON: {"type": "terminal|editor|browser|notes|music|video|chat|mail|calendar|files|design|document|other", "what": "the specific content: file path, page, note name, track, command", "summary": "two specific sentences on what it shows"}. A terminal showing a transcript or code is still a terminal.'},
                            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}},
                        ]}],
                        response_format={"type": "json_object"},
                        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                    )
                d = _extract_json(res.choices[0].message.content or "{}")
            except Exception as e:  # noqa: BLE001
                log.warning("hint crop failed: %s", e)
                d = {}
            typ = _norm(d.get("type") or "other")
            typ = typ if typ in APP_TYPES else "other"
            out.append({
                "id": "w-" + secrets.token_hex(2), "type": typ, "app": APP_LABEL[typ], "title": h.get("title") or "",
                "what": str(d.get("what") or h.get("title") or "")[:160], "category": "work",
                "summary": (str(d.get("summary") or "")[:900] or None), "bbox": h["bbox"],
            })
        analysis["windows"] = out

    def note_latest(self, device: str, frame_id: int) -> None:
        self._latest_frame[device] = frame_id

    # ---------------- per-frame analysis ----------------
    async def analyze_image(self, path: Path, known: list[dict], size: tuple[int, int] | None = None, lang: str = "en") -> dict:
        known_txt = json.dumps(known, ensure_ascii=False) if known else "[]"
        system = SYSTEM + self._lang_note(lang, 'the "what", "summary" and "activity" fields')
        async with self._sem:
            res = await self._create(
            model=self.model,
            max_tokens=3000,
            temperature=0.1,
            messages=[
                {"role": "system", "content": system},
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
        data = _extract_json(res.choices[0].message.content or "{}")
        wins, seen_ids = [], set()
        for w in data.get("windows", []) or []:
            if not isinstance(w, dict):
                continue
            typ = _norm(w.get("type") or w.get("app") or "other")
            if typ not in APP_TYPES:
                typ = "other"
            wid = str(w.get("id") or "").strip()
            if not re.fullmatch(r"w-[A-Za-z0-9]{2,12}", wid) or wid in seen_ids:
                wid = "w-" + secrets.token_hex(2)
            seen_ids.add(wid)
            cat = _norm(w.get("category", "other"))
            wins.append(
                {
                    "id": wid,
                    "type": typ,
                    "app": APP_LABEL[typ],
                    "title": str(w.get("title") or "")[:160],
                    "what": str(w.get("what") or w.get("title") or "")[:160],
                    "category": cat if cat in CATEGORIES else "other",
                    "summary": (str(w.get("summary") or "")[:900] or None),
                    "bbox": _norm_bbox(w.get("bbox"), size),
                }
            )
        # The same window reported twice: near-identical boxes, or one box inside another of the
        # same type with the same content. Stacked windows of one type (two browsers) stay separate.
        deduped: list[dict] = []
        for w in wins:
            dup = False
            for d in deduped:
                if d["type"] != w["type"] or not d["bbox"] or not w["bbox"]:
                    continue
                o = _iou(d["bbox"], w["bbox"])
                a, b = d["bbox"], w["bbox"]
                inside = (a[0] <= b[0] and a[1] <= b[1] and a[2] >= b[2] and a[3] >= b[3]) or (b[0] <= a[0] and b[1] <= a[1] and b[2] >= a[2] and b[3] >= a[3])
                if o >= 0.8 or (inside and _similar(d["what"], w["what"]) >= 0.7):
                    dup = True
                    break
            if not dup:
                deduped.append(w)
        notes = [
            {"app": str(n.get("app") or "")[:60], "text": str(n.get("text") or "")[:300]}
            for n in (data.get("notifications", []) or [])
            if isinstance(n, dict) and n.get("text")
        ]
        out = {"windows": deduped, "notifications": notes, "activity": str(data.get("activity") or "")[:600]}
        if data.get("truncated"):
            out["truncated"] = True
        return out

    async def refine_large(self, path: Path, analysis: dict) -> None:
        """A box covering a large part of the screen is often two tiled windows read as one
        (same dark theme, no border). Re-read each such box as a crop; if the crop holds two or
        more windows, replace the box with them. At most two crops per frame."""
        try:
            from PIL import Image
        except ImportError:
            return
        big = [w for w in analysis["windows"] if w.get("bbox") and (w["bbox"][2] - w["bbox"][0]) * (w["bbox"][3] - w["bbox"][1]) >= LARGE_BOX]
        if not big:
            return
        img = Image.open(path).convert("RGB")
        W, H = img.size
        out: list[dict] = []
        checked = 0
        for w in analysis["windows"]:
            if w not in big or checked >= 2:
                out.append(w)
                continue
            checked += 1
            x1, y1, x2, y2 = w["bbox"]
            crop = img.crop((int(x1 * W), int(y1 * H), int(x2 * W), int(y2 * H)))
            import io
            buf = io.BytesIO()
            crop.save(buf, "JPEG", quality=70)
            try:
                async with self._sem:
                    res = await self._create(
                        model=self.model, max_tokens=700, temperature=0.1,
                        messages=[{"role": "user", "content": [
                            {"type": "text", "text": CROP_PROMPT},
                            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}},
                        ]}],
                        response_format={"type": "json_object"},
                        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                    )
                data = _extract_json(res.choices[0].message.content or "{}")
                parts = data.get("windows") or []
            except Exception as e:  # noqa: BLE001
                log.warning("crop refine failed: %s", e)
                out.append(w)
                continue
            good = []
            for p in parts:
                if not isinstance(p, dict):
                    continue
                bb = _norm_bbox(p.get("bbox"), None)
                if not bb:
                    continue
                typ = _norm(p.get("type") or "other")
                good.append({
                    "id": "w-" + secrets.token_hex(2),
                    "type": typ if typ in APP_TYPES else "other",
                    "app": APP_LABEL.get(typ if typ in APP_TYPES else "other"),
                    "title": str(p.get("title") or "")[:160],
                    "what": str(p.get("what") or "")[:160],
                    "category": w.get("category", "other"),
                    "summary": (str(p.get("summary") or "")[:900] or None),
                    # crop coordinates back to the full frame
                    "bbox": [round(x1 + bb[0] * (x2 - x1), 4), round(y1 + bb[1] * (y2 - y1), 4), round(x1 + bb[2] * (x2 - x1), 4), round(y1 + bb[3] * (y2 - y1), 4)],
                })
            # accept a split only between DIFFERENT applications; two parts of one type are one app
            if len(good) >= 2 and len({g["type"] for g in good}) >= 2 and not (
                {g["type"] for g in good} == {"editor", "terminal"} and w["type"] == "editor"
            ):
                out.extend(good)
            else:
                out.append(w)
        analysis["windows"] = out

    async def process(self, device: str, frame_id: int) -> None:
        """Analyze one frame and update the tracker. Serialized per device."""
        async with self.lock(device):
            frame = self.store.frame(frame_id)
            if frame is None:
                return
            ts = float(frame["ts"])
            has_image = bool(frame["path"]) and not frame["unchanged"]
            prev_row = self.store.latest_analyzed_frame(device)
            prev = json.loads(prev_row["analysis"]) if prev_row else None
            stale = prev is None or not prev.get("windows") or any(not w.get("bbox") for w in prev["windows"])
            diff = float(frame["diff"]) if frame["diff"] is not None else None
            big = diff is not None and diff >= self.big_change
            # A big change is usually a workspace switch, and the frame that shows it is often taken
            # mid-animation with two workspaces blended. That frame is marked a transition and not
            # analyzed; the next stable frame (small diff) is analyzed instead.
            # the very first frame of a session is "big" by definition; analyze it right away
            if big and has_image and prev is not None:
                self._settling[device] = self._settling.get(device, 0) + 1
                if self._settling[device] <= 3:
                    if self._settling[device] == 1:
                        # the old scene ends at this frame, which is also where its lanes end
                        self._transition_at[device] = ts
                    self.store.set_analysis(frame_id, {"windows": [], "notifications": [], "activity": "", "transition": True})
                    return
            waiting = self._settling.get(device, 0) > 0
            if not big:
                self._settling[device] = 0
            self._last_stable_ts[device] = ts
            # a strong change confined to one part of the screen (a notification toast) is analyzed
            # at once, as a same-scene frame
            local = float(frame["local"]) if frame["local"] is not None else 0.0
            localhit = has_image and not big and local >= self.local_change
            due = has_image and (self._since.get(device, 0) % self.analyze_every == 0 or stale or waiting or big or localhit)
            # Backlog (several devices busy at once): only the newest queued frame of a device is
            # worth a model call; older ones inherit and the next frame becomes due immediately.
            if due and self._latest_frame.get(device, frame_id) != frame_id:
                due = False
                self._since[device] = 0
                if waiting:
                    self._settling[device] = 1  # keep waiting so the next frame is analyzed as a new scene
            elif has_image:
                self._since[device] = 1 if due else self._since.get(device, 0) + 1
            if prev is not None and prev.get("transition"):
                prev = self.store.latest_real_analysis(device)
                stale = prev is None or not prev.get("windows")
            try:
                if not due:
                    # carried forward so the UI has something for this frame; flagged so lanes,
                    # stretches and narratives only use REAL analyses
                    analysis = dict(prev) if prev else {"windows": [], "notifications": [], "activity": ""}
                    analysis["inherited"] = True
                else:
                    known = self._known(device, prev)
                    size = (int(frame["width"]), int(frame["height"])) if frame["width"] and frame["height"] else None
                    analysis = await self.analyze_image(Path(frame["path"]), known, size, self.lang(device))
                    hint = self.hint(device)
                    if hint:
                        await self.apply_hint(Path(frame["path"]), analysis, hint)
                    else:
                        await self.refine_large(Path(frame["path"]), analysis)
            except Exception as e:  # noqa: BLE001
                log.warning("frame %s analysis failed: %s", frame_id, e)
                carried = dict(prev) if prev else {"windows": [], "notifications": [], "activity": ""}
                carried["error"] = str(e)[:300]
                self.store.set_analysis(frame_id, carried)
                return
            if due:
                # Same scene as the previous frame? Then a window's position is a reliable identity cue.
                # After a transition the scene is new even though this frame's own diff is small.
                same_scene = not big and not waiting and prev is not None and bool(prev.get("windows"))
                self._resolve_ids(device, analysis["windows"], same_scene, prev.get("windows") if prev else None)
            self.store.set_analysis(frame_id, analysis)
            self._apply(device, ts, analysis, real=due)
        # Stretch narratives run outside the per-device lock (they are slow and read-only).
        asyncio.create_task(self._refresh_narratives(device))

    def _known(self, device: str, prev: dict | None) -> list[dict]:
        """Open windows as the model gets them: id, type and last box only. No content, so there
        is nothing to copy; identity is settled server-side in _resolve_ids."""
        out = []
        for r in self.store.open_windows(device):
            bb = json.loads(r["bbox"]) if r["bbox"] else None
            out.append({"id": self.store.unkey(r["id"]), "type": r["app"].lower(), "bbox": [int(v * 1000) for v in bb] if bb else None})
        return out

    def _layouts(self, device: str) -> list[dict[str, list[float]]]:
        """Layouts seen recently: for each distinct set of visible window ids, the boxes from the
        most recent frame that showed exactly that set. A rearranged workspace therefore updates
        its layout the next time it is seen."""
        seen_sets: dict[frozenset, dict[str, list[float]]] = {}
        for fr in self.store.db.execute(
            "SELECT analysis FROM frames WHERE device=? AND analysis IS NOT NULL ORDER BY ts DESC LIMIT 400", (device,)
        ).fetchall():
            try:
                wins = json.loads(fr["analysis"]).get("windows", [])
            except (ValueError, TypeError, AttributeError):
                continue
            boxes = {w["id"]: w["bbox"] for w in wins if w.get("bbox")}
            if not boxes:
                continue
            key = frozenset(boxes)
            if key not in seen_sets:
                seen_sets[key] = boxes
        return list(seen_sets.values())

    def _match_layout(self, windows: list[dict], layout: dict[str, list[float]], types: dict[str, str]) -> tuple[float, dict[int, str]]:
        """Greedy one-to-one pairing of visible windows with layout members of the same type by box
        overlap. Returns (score, {window index: id}). Score is pairs / the larger side, so extra or
        missing windows cost partial credit rather than failing the match."""
        pairs = []
        for i, w in enumerate(windows):
            if not w.get("bbox"):
                continue
            for wid, box in layout.items():
                if types.get(wid) == w["type"]:
                    o = _iou(w["bbox"], box)
                    if o >= 0.5:
                        pairs.append((o, i, wid))
        pairs.sort(reverse=True)
        used_i, used_w, assign = set(), set(), {}
        for o, i, wid in pairs:
            if i in used_i or wid in used_w:
                continue
            used_i.add(i); used_w.add(wid); assign[i] = wid
        denom = max(len(windows), len(layout), 1)
        return len(assign) / denom, assign

    def _resolve_ids(self, device: str, windows: list[dict], same_scene: bool, prev_windows: list[dict] | None = None) -> None:
        """Settle window identity BEFORE the analysis is saved.
        Same scene as the previous frame: a window keeps the id of the known window its box
        overlaps (the model may have renamed it). New scene (workspace switch): recognize the
        layout, i.e. the set of windows previously seen together whose types and positions best
        match what is visible now, and take ids from it. Whatever neither step explains is matched
        by content, and failing that gets a fresh id."""
        open_rows = self.store.open_windows(device)
        info = {
            self.store.unkey(r["id"]): {
                "type": r["app"].lower(), "what": r["what"], "title": r["title"] or "",
                "bbox": json.loads(r["bbox"]) if r["bbox"] else None,
            }
            for r in open_rows
        }
        types = {wid: i["type"] for wid, i in info.items()}
        assigned: dict[int, str] = {}
        members: set[str] = set()

        if same_scene and prev_windows:
            # the previous frame IS the layout; other workspaces' windows are not candidates
            layout = {w["id"]: w["bbox"] for w in prev_windows if w.get("bbox") and w["id"] in info}
            # Merge guard: a reported box that covers two or more previous-frame windows almost
            # exactly (each at least 85% inside it, together filling it) is those windows read as
            # one, usually a translucent terminal next to another dark window. Split it back.
            def inside(a, b):  # fraction of a inside b
                ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
                aa = (a[2] - a[0]) * (a[3] - a[1])
                return (ix * iy) / aa if aa > 0 else 0.0
            expanded: list[dict] = []
            for w in windows:
                if not w.get("bbox"):
                    expanded.append(w); continue
                parts = [wid for wid, box in layout.items() if inside(box, w["bbox"]) >= 0.85]
                area = (w["bbox"][2] - w["bbox"][0]) * (w["bbox"][3] - w["bbox"][1])
                parts_area = sum((layout[p][2] - layout[p][0]) * (layout[p][3] - layout[p][1]) for p in parts)
                if len(parts) >= 2 and area > 0 and parts_area / area >= 0.8:
                    for p in parts:
                        pw = next((x for x in prev_windows if x["id"] == p), None)
                        if pw is None:
                            continue
                        expanded.append({**pw, "bbox": layout[p]})
                else:
                    expanded.append(w)
            windows[:] = expanded
            _, assign = self._match_layout(windows, layout, types)
            assigned.update(assign)
            members = set(layout)
            # A window sitting almost exactly where a previous-frame window sat is that window even
            # if the model changed its mind about the type (a notes app read as a browser). Keep the
            # type the window already has.
            taken = set(assigned.values())
            for i, w in enumerate(windows):
                if i in assigned or not w.get("bbox"):
                    continue
                best = max(((_iou(w["bbox"], box), wid) for wid, box in layout.items() if wid not in taken), default=(0.0, None))
                if best[0] >= 0.85 and best[1] is not None:
                    assigned[i] = best[1]; taken.add(best[1])
                    w["type"] = info[best[1]]["type"]; w["app"] = APP_LABEL.get(w["type"], "Other")
        else:
            best_score, best_assign, best_layout = 0.0, {}, {}
            for layout in self._layouts(device):
                layout = {wid: box for wid, box in layout.items() if wid in info}  # closed windows are gone
                if not layout:
                    continue
                score, assign = self._match_layout(windows, layout, types)
                if score > best_score or (score == best_score and len(assign) > len(best_assign)):
                    best_score, best_assign, best_layout = score, assign, layout
            if best_score >= 0.6 and len(best_assign) >= min(2, len(windows)):
                assigned.update(best_assign)
                members = set(best_layout)
                # Same slot as an unclaimed member but the model changed its mind about the type: keep
                # the member's id and its established type (a music player read as "files").
                taken = set(assigned.values())
                for i, w in enumerate(windows):
                    if i in assigned or not w.get("bbox"):
                        continue
                    best = max(((_iou(w["bbox"], best_layout[wid]), wid) for wid in members if wid not in taken), default=(0.0, None))
                    if best[0] >= 0.8 and best[1] is not None:
                        assigned[i] = best[1]; taken.add(best[1])
                        w["type"] = info[best[1]]["type"]; w["app"] = APP_LABEL.get(w["type"], "Other")

        # Content check WITHIN the adopted layout only: two same-type members that traded slots are
        # put back by their text. Windows of other layouts are never candidates here, so copied
        # text from another workspace cannot pull an id across.
        def sim(w: dict, wid: str) -> float:
            return max(_similar(w["what"], info[wid]["what"]), _similar(w["title"], info[wid]["title"]))
        for i, cur in list(assigned.items()):
            w = windows[i]
            if sim(w, cur) >= 0.6:
                continue
            alt = max(((sim(w, jid), jid) for jid in members if jid != cur and types.get(jid) == w["type"]), default=(0.0, None))
            if alt[1] is None or alt[0] < 0.9:
                continue
            holder = next((k for k, v in assigned.items() if v == alt[1]), None)
            if holder is None:
                assigned[i] = alt[1]
            elif sim(windows[holder], alt[1]) < 0.9:
                assigned[i], assigned[holder] = alt[1], cur

        used = set(assigned.values())
        for i, w in enumerate(windows):
            if i in assigned:
                w["id"] = assigned[i]
                continue
            # content match among the still-unclaimed known windows of the same type
            scored = sorted(
                ((max(_similar(w["what"], j["what"]), _similar(w["title"], j["title"])), wid == w["id"], wid)
                 for wid, j in info.items() if j["type"] == w["type"] and wid not in used),
                reverse=True,
            )
            if scored and scored[0][0] >= 0.8:
                w["id"] = scored[0][2]
            elif w["id"] in used or (w["id"] in info and info[w["id"]]["type"] != w["type"]):
                w["id"] = "w-" + secrets.token_hex(2)
            elif w["id"] in info and (not same_scene or w["id"] not in members):
                # a known id the model picked without layout or content support (on a new scene, or a
                # window from another workspace while the scene did not change): distrust it
                w["id"] = "w-" + secrets.token_hex(2)
            used.add(w["id"])

    def _apply(self, device: str, ts: float, analysis: dict, real: bool = True) -> None:
        if analysis.get("transition"):
            return
        for w in analysis["windows"]:
            self.store.upsert_window(
                device, w["id"], w.get("app") or APP_LABEL.get(w.get("type", "other"), "Other"), w["what"], w["category"], ts,
                w.get("summary"), w.get("bbox"), w.get("title"),
            )
        self.store.close_stale(device, ts - self.close_after)

        seen = set()
        for n in analysis["notifications"]:
            self.store.see_notification(device, n["app"], n["text"], ts)
            seen.add(n["text"])
        self.store.mark_dismissed(device, ts, seen)

        if not real:
            return
        # A stretch is a period where the set of windows VISIBLE on screen did not change. A new set
        # has to show up in two consecutive REAL analyses before it starts a stretch, so a single
        # misdetection or a glance at another workspace does not fragment the timeline.
        vis_ids = sorted(w["id"] for w in analysis["windows"])
        cur = self.store.current_stretch(device)
        activity = analysis.get("activity") or ""
        pending = self._pending_set.get(device)
        if cur is None or json.loads(cur["window_ids"]) != vis_ids:
            if pending is not None and pending[0] == vis_ids:
                # The old stretch ends where its scene was last seen; the new one starts at the first
                # clean analysis of the new scene. The transition frames in between stay a gap.
                cut = self._transition_at.get(device)
                end_old = cut if cut is not None and (cur is None or float(cur["start"]) < cut <= pending[1]) else pending[1]
                if cur is not None:
                    self.store.end_stretch(int(cur["id"]), end_old)
                self.store.start_stretch(device, pending[1], vis_ids, activity)
                self._pending_set.pop(device, None)
            else:
                self._pending_set[device] = (vis_ids, ts)
        else:
            self._pending_set.pop(device, None)
            if activity:
                self.store.set_stretch_summary(int(cur["id"]), activity)

    # ---------------- stretch narratives ----------------
    async def regenerate_all(self, device: str) -> None:
        """After a language change: rewrite every stretch narrative, a few at a time."""
        self.store.clear_narratives(device)
        for _ in range(20):
            before = sum(1 for r in self.store.all_stretches(device) if r["narrative"] is None)
            if before == 0:
                return
            await self._refresh_narratives(device)
            if sum(1 for r in self.store.all_stretches(device) if r["narrative"] is None) >= before:
                return

    async def _refresh_narratives(self, device: str) -> None:
        """Write or refresh the narrative of the current stretch (every stretch_refresh_s while it
        has new analyses) and of the last ended stretch that has none yet."""
        now = time.time()
        todo = []
        cur = self.store.current_stretch(device)
        if cur is not None and (cur["summarized_at"] is None or cur["narrative"] is None or now - float(cur["summarized_at"]) >= self.stretch_refresh_s):
            todo.append(cur)
        for r in self.store.all_stretches(device):
            if r["end"] is not None and r["narrative"] is None and (cur is None or r["id"] != cur["id"]):
                todo.append(r)
        for r in todo[-3:]:
            sid = int(r["id"])
            if sid in self._summarizing:
                continue
            self._summarizing.add(sid)
            try:
                await self.summarize_stretch(device, sid)
            except Exception as e:  # noqa: BLE001
                log.warning("stretch %s narrative failed: %s", sid, e)
            finally:
                self._summarizing.discard(sid)

    async def summarize_stretch(self, device: str, stretch_id: int) -> None:
        r = self.store.stretch(stretch_id)
        if r is None:
            return
        rows = self.store.analyses_between(device, float(r["start"]), r["end"])
        if not rows or (r["summarized_n"] is not None and len(rows) == int(r["summarized_n"]) and r["end"] is None):
            return
        snaps = []
        for fr in rows[-40:]:
            a = json.loads(fr["analysis"])
            if a.get("transition") or a.get("inherited") or (a.get("error") and not a.get("windows")):
                continue
            snaps.append(
                {
                    "time": time.strftime("%H:%M:%S", time.localtime(float(fr["ts"]))),
                    "activity": a.get("activity", ""),
                    "windows": [
                        {"type": w.get("type") or (w.get("app") or "").lower(), "what": w.get("what"), "title": w.get("title"), "summary": w.get("summary")}
                        for w in a.get("windows", [])
                    ],
                    "notifications": a.get("notifications", []),
                }
            )
        if not snaps:
            return
        async with self._sem:
            res = await self._create(
            model=self.model,
            max_tokens=900,
            temperature=0.2,
            messages=[
                {"role": "system", "content": STRETCH_SYSTEM + self._lang_note(self.lang(device), 'the "narrative", every "left_here" text and every question')},
                {"role": "user", "content": "Snapshots, oldest first:\n" + json.dumps(snaps, ensure_ascii=False)},
            ],
            # schema-constrained: the model otherwise shortens keys ("narr") or leaves the text empty
            response_format={"type": "json_schema", "json_schema": {"name": "stretch", "schema": STRETCH_SCHEMA}},
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        data = _extract_json(res.choices[0].message.content or "{}")
        narrative = str(data.get("narrative") or "")[:1500]
        left = [
            {"text": str(x.get("text") or "")[:300], "where": str(x.get("where") or "")[:80]}
            for x in (data.get("left_here") or [])
            if isinstance(x, dict) and x.get("text")
        ][:3]
        questions = [str(q)[:160] for q in (data.get("questions") or []) if isinstance(q, str) and q.strip()][:3]
        self.store.set_stretch_narrative(stretch_id, narrative, left, len(rows), time.time(), questions)


    # ---------------- questions ----------------
    async def ask(self, device: str, question: str, at: float | None, history: list[dict]) -> dict:
        """Answer a question about the day from stretch narratives plus the snapshots around `at`."""
        hhmmss = lambda t: time.strftime("%H:%M:%S", time.localtime(float(t)))  # noqa: E731
        stretches = []
        for r in self.store.all_stretches(device):
            wins = []
            for wid in json.loads(r["window_ids"]):
                w = self.store.window(device, wid)
                if w is not None:
                    wins.append(f"{w['app']} · {w['what']}")
            stretches.append(
                {
                    "from": hhmmss(r["start"]), "to": hhmmss(r["end"]) if r["end"] else "now",
                    "windows": wins, "narrative": r["narrative"] or r["summary"] or "",
                    "left_here": json.loads(r["left_here"]) if r["left_here"] else [],
                }
            )
        if at is not None:
            rows = self.store.db.execute(
                "SELECT ts, analysis FROM frames WHERE device=? AND analysis IS NOT NULL AND ts BETWEEN ? AND ? ORDER BY ts",
                (device, at - 240, at + 240),
            ).fetchall()
        else:
            rows = self.store.db.execute(
                "SELECT ts, analysis FROM frames WHERE device=? AND analysis IS NOT NULL ORDER BY ts DESC LIMIT 60", (device,)
            ).fetchall()[::-1]
        snaps, prev = [], None
        for fr in rows:
            a = json.loads(fr["analysis"])
            if a.get("transition") or a.get("inherited") or fr["analysis"] == prev:
                continue
            prev = fr["analysis"]
            snaps.append(
                {
                    "time": hhmmss(fr["ts"]), "activity": a.get("activity", ""),
                    "windows": [{"type": w.get("type"), "what": w.get("what"), "summary": w.get("summary")} for w in a.get("windows", [])],
                    "notifications": a.get("notifications", []),
                }
            )
        notes = [
            {"time": hhmmss(n["first_seen"]), "app": n["app"], "text": n["text"], "dismissed": bool(n["dismissed"])}
            for n in self.store.notifications(device)
        ]
        material = {"stretches": stretches, "snapshots_near_the_moment": snaps[-24:], "notifications": notes}
        messages = [{"role": "system", "content": ASK_SYSTEM + self._lang_note(self.lang(device), "your answer")}]
        # Earlier turns of this device's conversation, kept server-side so they survive reloads.
        turns = [{"q": r["question"], "a": r["answer"]} for r in self.store.chats(device, limit=8)] or history
        for h in turns[-8:]:
            if h.get("q"):
                messages.append({"role": "user", "content": str(h["q"])[:1000]})
            if h.get("a"):
                messages.append({"role": "assistant", "content": str(h["a"])[:2000]})
        looking = f"The person is looking at {hhmmss(at)}." if at is not None else "The person is looking at now."
        # Screenshots to read: the moment being looked at, moments named in the question, and one
        # from the middle of the stretch being looked at. At most three, nearest real frames.
        wanted: list[float] = [at if at is not None else time.time()]
        today = time.strftime("%Y-%m-%d")
        for m in re.finditer(r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b", question):
            t = m.group(1)
            try:
                fmt = "%Y-%m-%d %H:%M:%S" if t.count(":") == 2 else "%Y-%m-%d %H:%M"
                wanted.append(time.mktime(time.strptime(f"{today} {t}", fmt)))
            except ValueError:
                pass
        for r in self.store.all_stretches(device):
            end = float(r["end"]) if r["end"] else time.time()
            if float(r["start"]) <= wanted[0] <= end:
                wanted.append((float(r["start"]) + end) / 2)
                break
        shots: list[tuple[float, str]] = []
        for w in wanted[:4]:
            row = self.store.db.execute(
                "SELECT id, ts, path FROM frames WHERE device=? AND path IS NOT NULL AND analysis IS NOT NULL "
                "AND analysis NOT LIKE '%\"transition\": true%' ORDER BY ABS(ts-?) LIMIT 1",
                (device, w),
            ).fetchone()
            if row and all(abs(row["ts"] - s[0]) > 2 for s in shots):
                shots.append((float(row["ts"]), row["path"]))
        shots = shots[:3]
        content: list[dict] = [{"type": "text", "text": f"{looking}\n\nMATERIAL:\n{json.dumps(material, ensure_ascii=False)}"}]
        for ts_, path in shots:
            try:
                content.append({"type": "text", "text": f"Screenshot at {hhmmss(ts_)}:"})
                content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{_b64(Path(path))}"}})
            except OSError:
                continue
        content.append({"type": "text", "text": f"QUESTION: {question.strip()[:1000]}"})
        messages.append({"role": "user", "content": content})
        async with self._sem:
            res = await self._create(
            model=self.model, max_tokens=900, temperature=0.2, messages=messages,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        answer = (res.choices[0].message.content or "").strip()
        cites, seen = [], set()
        for m in re.finditer(r"\[\[(\d{1,2}:\d{2}(?::\d{2})?)\]\]", answer):
            t = m.group(1)
            if t in seen:
                continue
            try:
                fmt = "%Y-%m-%d %H:%M:%S" if t.count(":") == 2 else "%Y-%m-%d %H:%M"
                cites.append({"time": time.mktime(time.strptime(f"{today} {t}", fmt)), "label": t})
                seen.add(t)
            except ValueError:
                continue
        # the model sometimes bolds the marker itself; avoid ****time****
        answer = re.sub(r"\*{0,2}\[\[(\d{1,2}:\d{2}(?::\d{2})?)\]\]\*{0,2}", r"**\1**", answer)
        cid = self.store.add_chat(device, time.time(), at, question.strip()[:1000], answer, cites[:6])
        return {"id": cid, "answer": answer, "cites": cites[:6]}


def now() -> float:
    return time.time()
