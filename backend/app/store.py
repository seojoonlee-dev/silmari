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
  analysis TEXT
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
  summary TEXT
);
CREATE INDEX IF NOT EXISTS windows_device ON windows(device);

CREATE TABLE IF NOT EXISTS stretches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  start REAL NOT NULL,
  end REAL,
  window_ids TEXT NOT NULL,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS stretches_device ON stretches(device);

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

    # -- frames --
    def add_frame(self, device: str, ts: float, path: str | None, unchanged: bool) -> int:
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO frames(device, ts, path, unchanged) VALUES (?,?,?,?)", (device, ts, path, int(unchanged))
            )
            self.db.commit()
            return int(cur.lastrowid)

    def set_analysis(self, frame_id: int, analysis: dict) -> None:
        with self.lock:
            self.db.execute("UPDATE frames SET analysis=? WHERE id=?", (json.dumps(analysis), frame_id))
            self.db.commit()

    def frame(self, frame_id: int) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM frames WHERE id=?", (frame_id,)).fetchone()

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

    def upsert_window(self, device: str, wid: str, app: str, what: str, category: str, ts: float, summary: str | None) -> None:
        with self.lock:
            row = self.db.execute("SELECT id FROM windows WHERE id=?", (wid,)).fetchone()
            if row:
                self.db.execute(
                    "UPDATE windows SET app=?, what=?, category=?, last_seen=?, closed_at=NULL, summary=COALESCE(?, summary) WHERE id=?",
                    (app, what, category, ts, summary, wid),
                )
            else:
                self.db.execute(
                    "INSERT INTO windows(id, device, app, what, category, first_seen, last_seen, summary) VALUES (?,?,?,?,?,?,?,?)",
                    (wid, device, app, what, category, ts, ts, summary),
                )
            self.db.commit()

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
