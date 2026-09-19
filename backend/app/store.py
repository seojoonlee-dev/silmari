"""SQLite storage. One database, tables keyed by device (one browser = one device)."""
import json
import sqlite3
import threading
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  ts REAL NOT NULL,
  path TEXT,
  unchanged INTEGER NOT NULL DEFAULT 0,
  analysis TEXT,
  width INTEGER,
  height INTEGER,
  diff REAL,
  local REAL
);
CREATE INDEX IF NOT EXISTS frames_device_ts ON frames(device, ts);

CREATE TABLE IF NOT EXISTS windows (
  id TEXT PRIMARY KEY,
  device TEXT NOT NULL,
  app TEXT NOT NULL,
  what TEXT NOT NULL,
  category TEXT NOT NULL,
  first_seen REAL NOT NULL,
  last_seen REAL NOT NULL,
  closed_at REAL,
  summary TEXT,
  bbox TEXT,
  title TEXT
);
CREATE INDEX IF NOT EXISTS windows_device ON windows(device);

CREATE TABLE IF NOT EXISTS stretches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  start REAL NOT NULL,
  end REAL,
  window_ids TEXT NOT NULL,
  summary TEXT,
  narrative TEXT,
  left_here TEXT,
  summarized_at REAL,
  summarized_n INTEGER,
  questions TEXT
);
CREATE INDEX IF NOT EXISTS stretches_device ON stretches(device);

CREATE TABLE IF NOT EXISTS settings (
  device TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (device, key)
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  ts REAL NOT NULL,
  at REAL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  cites TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_device ON chats(device);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  app TEXT NOT NULL,
  text TEXT NOT NULL,
  first_seen REAL NOT NULL,
  last_seen REAL NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notifications_device ON notifications(device);
"""


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()
        # migrations for databases created before these columns existed
        for table, col, typ in (
            ("frames", "width", "INTEGER"), ("frames", "height", "INTEGER"), ("frames", "diff", "REAL"), ("frames", "local", "REAL"),
            ("windows", "bbox", "TEXT"), ("windows", "title", "TEXT"),
            ("stretches", "narrative", "TEXT"), ("stretches", "left_here", "TEXT"),
            ("stretches", "summarized_at", "REAL"), ("stretches", "summarized_n", "INTEGER"),
            ("stretches", "questions", "TEXT"),
        ):
            if col not in {r["name"] for r in self.db.execute(f"PRAGMA table_info({table})")}:
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        self.db.commit()
        # windows are keyed "<device>/<id>" so two devices can produce the same model id
        rows = self.db.execute("SELECT id, device FROM windows WHERE id NOT LIKE '%/%'").fetchall()
        for r in rows:
            new = f"{r['device']}/{r['id']}"
            self.db.execute("UPDATE windows SET id=? WHERE id=?", (new, r["id"]))
        if rows:
            for s in self.db.execute("SELECT id, device, window_ids FROM stretches").fetchall():
                ids = [i if "/" in i else f"{s['device']}/{i}" for i in json.loads(s["window_ids"])]
                self.db.execute("UPDATE stretches SET window_ids=? WHERE id=?", (json.dumps(ids), s["id"]))
            self.db.commit()

    @staticmethod
    def key(device: str, wid: str) -> str:
        return f"{device}/{wid}"

    @staticmethod
    def unkey(key: str) -> str:
        return key.split("/", 1)[1] if "/" in key else key

    # -- frames --
    def add_frame(
        self, device: str, ts: float, path: str | None, unchanged: bool, size: tuple[int, int] | None = None,
        diff: float | None = None, local: float | None = None,
    ) -> int:
        with self.lock:
            w, h = size if size else (None, None)
            cur = self.db.execute(
                "INSERT INTO frames(device, ts, path, unchanged, width, height, diff, local) VALUES (?,?,?,?,?,?,?,?)",
                (device, ts, path, int(unchanged), w, h, diff, local),
            )
            self.db.commit()
            return int(cur.lastrowid)

    def old_frame_paths(self, before: float) -> list[str]:
        return [r[0] for r in self.db.execute("SELECT path FROM frames WHERE ts<? AND path IS NOT NULL", (before,)).fetchall()]

    def delete_frames_before(self, before: float) -> int:
        with self.lock:
            n = self.db.execute("DELETE FROM frames WHERE ts<?", (before,)).rowcount
            self.db.commit()
            return n

    def set_analysis(self, frame_id: int, analysis: dict) -> None:
        with self.lock:
            self.db.execute("UPDATE frames SET analysis=? WHERE id=?", (json.dumps(analysis), frame_id))
            self.db.commit()

    def frame(self, frame_id: int) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM frames WHERE id=?", (frame_id,)).fetchone()

    def latest_real_analysis(self, device: str) -> dict | None:
        """Most recent analysis that is not a transition placeholder."""
        for r in self.db.execute(
            "SELECT analysis FROM frames WHERE device=? AND analysis IS NOT NULL ORDER BY ts DESC LIMIT 20", (device,)
        ).fetchall():
            a = json.loads(r["analysis"])
            if not a.get("transition"):
                return a
        return None

    def latest_analyzed_frame(self, device: str) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT * FROM frames WHERE device=? AND analysis IS NOT NULL ORDER BY ts DESC LIMIT 1", (device,)
        ).fetchone()

    def latest_image_frame(self, device: str, before: float | None = None) -> sqlite3.Row | None:
        if before is None:
            return self.db.execute(
                "SELECT * FROM frames WHERE device=? AND path IS NOT NULL ORDER BY ts DESC LIMIT 1", (device,)
            ).fetchone()
        return self.db.execute(
            "SELECT * FROM frames WHERE device=? AND path IS NOT NULL AND ts<=? ORDER BY ts DESC LIMIT 1", (device, before)
        ).fetchone()

    # -- windows --
    def open_windows(self, device: str) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT * FROM windows WHERE device=? AND closed_at IS NULL ORDER BY first_seen", (device,)
        ).fetchall()

    def all_windows(self, device: str) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM windows WHERE device=? ORDER BY first_seen", (device,)).fetchall()

    def upsert_window(
        self, device: str, wid: str, app: str, what: str, category: str, ts: float, summary: str | None,
        bbox: list[float] | None = None, title: str | None = None,
    ) -> None:
        bb = json.dumps(bbox) if bbox else None
        wid = self.key(device, wid)
        with self.lock:
            row = self.db.execute("SELECT id FROM windows WHERE id=?", (wid,)).fetchone()
            if row:
                self.db.execute(
                    "UPDATE windows SET app=?, what=?, category=?, last_seen=?, closed_at=NULL, summary=COALESCE(?, summary), bbox=COALESCE(?, bbox), title=COALESCE(?, title) WHERE id=?",
                    (app, what, category, ts, summary, bb, title, wid),
                )
            else:
                self.db.execute(
                    "INSERT INTO windows(id, device, app, what, category, first_seen, last_seen, summary, bbox, title) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (wid, device, app, what, category, ts, ts, summary, bb, title),
                )
            self.db.commit()

    def window(self, device: str, wid: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM windows WHERE id=?", (self.key(device, wid),)).fetchone()

    def touch_windows(self, ids: list[str], ts: float) -> None:
        if not ids:
            return
        with self.lock:
            self.db.executemany("UPDATE windows SET last_seen=? WHERE id=?", [(ts, i) for i in ids])
            self.db.commit()

    def close_stale(self, device: str, before: float) -> list[str]:
        """Close windows not seen since `before`; their end is their last sighting."""
        with self.lock:
            rows = self.db.execute(
                "SELECT id FROM windows WHERE device=? AND closed_at IS NULL AND last_seen<?", (device, before)
            ).fetchall()
            ids = [r["id"] for r in rows]
            if ids:
                self.db.executemany("UPDATE windows SET closed_at=last_seen WHERE id=?", [(i,) for i in ids])
                self.db.commit()
            return ids

    # -- stretches --
    def current_stretch(self, device: str) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT * FROM stretches WHERE device=? AND end IS NULL ORDER BY start DESC LIMIT 1", (device,)
        ).fetchone()

    def all_stretches(self, device: str) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM stretches WHERE device=? ORDER BY start", (device,)).fetchall()

    def end_stretch(self, stretch_id: int, ts: float) -> None:
        with self.lock:
            self.db.execute("UPDATE stretches SET end=? WHERE id=?", (ts, stretch_id))
            self.db.commit()

    def start_stretch(self, device: str, ts: float, window_ids: list[str], summary: str) -> int:
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO stretches(device, start, window_ids, summary) VALUES (?,?,?,?)",
                (device, ts, json.dumps(window_ids), summary),
            )
            self.db.commit()
            return int(cur.lastrowid)

    def set_stretch_summary(self, stretch_id: int, summary: str) -> None:
        with self.lock:
            self.db.execute("UPDATE stretches SET summary=? WHERE id=?", (summary, stretch_id))
            self.db.commit()

    def set_stretch_narrative(
        self, stretch_id: int, narrative: str, left_here: list[dict], n: int, ts: float, questions: list[str] | None = None
    ) -> None:
        with self.lock:
            self.db.execute(
                "UPDATE stretches SET narrative=?, left_here=?, summarized_n=?, summarized_at=?, questions=? WHERE id=?",
                (narrative, json.dumps(left_here), n, ts, json.dumps(questions or []), stretch_id),
            )
            self.db.commit()

    def stretch(self, stretch_id: int) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM stretches WHERE id=?", (stretch_id,)).fetchone()

    def analyses_between(self, device: str, start: float, end: float | None) -> list[sqlite3.Row]:
        """Distinct analyses (in time order) for frames inside a stretch."""
        q = "SELECT id, ts, analysis FROM frames WHERE device=? AND analysis IS NOT NULL AND ts>=?"
        args: list = [device, start]
        if end is not None:
            q += " AND ts<?"
            args.append(end)
        rows = self.db.execute(q + " ORDER BY ts", args).fetchall()
        out, prev = [], None
        for r in rows:
            if r["analysis"] != prev:
                out.append(r)
                prev = r["analysis"]
        return out

    def delete_device(self, device: str) -> dict:
        """Remove every row for a device. Frame files are removed by the caller."""
        with self.lock:
            counts = {}
            for table in ("frames", "windows", "stretches", "notifications", "chats", "settings"):
                counts[table] = self.db.execute(f"SELECT COUNT(*) FROM {table} WHERE device=?", (device,)).fetchone()[0]
                self.db.execute(f"DELETE FROM {table} WHERE device=?", (device,))
            self.db.commit()
            return counts

    # -- settings --
    def setting(self, device: str, key: str, default: str = "") -> str:
        r = self.db.execute("SELECT value FROM settings WHERE device=? AND key=?", (device, key)).fetchone()
        return r["value"] if r else default

    def set_setting(self, device: str, key: str, value: str) -> None:
        with self.lock:
            self.db.execute("INSERT INTO settings(device, key, value) VALUES (?,?,?) ON CONFLICT(device, key) DO UPDATE SET value=excluded.value", (device, key, value))
            self.db.commit()

    def clear_narratives(self, device: str) -> None:
        with self.lock:
            self.db.execute("UPDATE stretches SET narrative=NULL, questions=NULL, summarized_n=NULL, summarized_at=NULL WHERE device=?", (device,))
            self.db.commit()

    # -- chats --
    def add_chat(self, device: str, ts: float, at: float | None, question: str, answer: str, cites: list[dict]) -> int:
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO chats(device, ts, at, question, answer, cites) VALUES (?,?,?,?,?,?)",
                (device, ts, at, question, answer, json.dumps(cites)),
            )
            self.db.commit()
            return int(cur.lastrowid)

    def chats(self, device: str, limit: int = 200) -> list[sqlite3.Row]:
        rows = self.db.execute("SELECT * FROM chats WHERE device=? ORDER BY ts DESC LIMIT ?", (device, limit)).fetchall()
        return rows[::-1]

    # -- notifications --
    def notifications(self, device: str) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM notifications WHERE device=? ORDER BY first_seen", (device,)).fetchall()

    def see_notification(self, device: str, app: str, text: str, ts: float) -> None:
        with self.lock:
            row = self.db.execute(
                "SELECT id FROM notifications WHERE device=? AND app=? AND text=? AND last_seen>?",
                (device, app, text, ts - 3600),
            ).fetchone()
            if row:
                self.db.execute("UPDATE notifications SET last_seen=? WHERE id=?", (ts, row["id"]))
            else:
                self.db.execute(
                    "INSERT INTO notifications(device, app, text, first_seen, last_seen) VALUES (?,?,?,?,?)",
                    (device, app, text, ts, ts),
                )
            self.db.commit()

    def mark_dismissed(self, device: str, ts: float, seen_texts: set[str]) -> None:
        """A notification that was visible and now is not, with its app still on screen, was dismissed."""
        with self.lock:
            rows = self.db.execute(
                "SELECT id, app, text FROM notifications WHERE device=? AND dismissed=0 AND last_seen<?", (device, ts)
            ).fetchall()
            for r in rows:
                if r["text"] not in seen_texts:
                    self.db.execute("UPDATE notifications SET dismissed=1 WHERE id=?", (r["id"],))
            self.db.commit()
