# Silmari

Built in one night for the GDGoC Korea University BYPP Hackathon (September 18–19, 2026).

*Silmari* (실마리) is the loose end of a thread, and figuratively the clue that lets you untangle something.

Silmari watches your screen and remembers it for you. It was designed for ADHD working memory,
the constant "where was I?" after every interruption, and turns out to be useful to anyone who
loses the thread after a meeting. A frame of your screen every few seconds goes to a vision model
running on your own machine, which turns it into a timeline of what was on screen, what you were
doing, what you left unfinished, and which notifications you dismissed. You can scrub back to any
moment, read a narrative of each stretch, and ask questions that are answered from the actual
screenshots.

Nothing leaves your own server. There is no cloud API in the loop.

## What it does

- **Records** your screen from the browser with `getDisplayMedia`, one frame every 3 seconds.
  Works in Chrome, Edge, Firefox and Safari on Windows, macOS and Linux. No install.
- **Identifies every window** on screen with a vision model: type (browser, editor, terminal,
  notes, music, …), the content that tells it apart from another window of the same type, a
  short description, and its rectangle. Two browser windows are two windows. Windows are typed
  generically, never by brand, so custom apps are not mislabelled as famous ones.
- **Keeps window identity** across frames server-side: by position on an unchanged scene, by
  recognizing a previously seen layout on a workspace switch, and by content as a fallback.
  Workspace-switch animation frames are skipped. Works on tiling and stacking desktops.
- **Stretches**: periods where the same set of windows stayed on screen. Each gets a past-tense
  narrative naming files, pages, tracks, commands and people, a list of things left unfinished,
  and three suggested questions.
- **Notifications** are recorded when they appear and marked dismissed when they vanish.
- **Timeline**: one lane per window, drawn while it was on screen. Hover to scrub (the preview
  shows the saved screenshot), click to pin. Cards per stretch open a full detail view.
- **Ask your day**: a chat that reads the day's stretches plus the actual screenshots around the
  moment you're looking at, and links the times it mentions. Conversation persists per device.
- **Korean and English**, for the UI and for everything the model writes.
- **Guided tour** on first launch over an example day.
- **Multi-user**: everyone shares one password; each browser gets an unguessable device id and
  its data is invisible to others. A per-browser reset deletes everything recorded.

## Architecture

```
browser ── https (Tailscale Funnel) ──> FastAPI :8787 ── http localhost ──> vLLM :8000
   capture, UI                            ├─ /            static frontend build     (Qwen 3.6 35B-A3B)
                                          ├─ /api/frames  ingest, SQLite + JPEGs
                                          ├─ /api/timeline, /api/ask, /api/chat
                                          └─ tracker: identity, stretches, narratives
```

- `frontend/`: React + TypeScript + Vite. Capture, live preview with window boxes, scrubber
  timeline, chat, tour, i18n.
- `backend/`: Python + FastAPI. Frame ingestion, the vision-model tracker (`app/tracker.py`),
  SQLite storage (`app/store.py`), the API.
- `deploy.sh`: rsyncs the repo to the server named in `deploy.env`, builds the frontend there,
  installs the backend with `uv`, runs it as a systemd user service and exposes one port with
  Tailscale Funnel.
- `demo/notify.sh`: fires mock Slack and Gmail notifications for a live demo.
- `docs/HOWTO.ko.md`: user guide in Korean.
- `PLAN.md`: priorities, detection layers and status.

## Running it

Requirements: Node 20+, Python 3.12+ with `uv`, and an OpenAI-compatible vision model endpoint
(the hackathon build used vLLM serving `Qwen/Qwen3.6-35B-A3B-FP8` on an RTX A6000).

```
# backend
cd backend
cp .env.example .env        # set APP_PASSWORD, LLM_BASE_URL, LLM_MODEL
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8787

# frontend (dev)
cd frontend
cp .env.example .env.local  # DEV_API_PROXY points at the backend
npm install
npm run dev
```

In production the backend serves `frontend/dist` on the same origin as the API, so
`npm run build` and one port are all that's needed. Screen capture requires HTTPS or localhost.

Deploy to a server: copy `deploy.env.example` to `deploy.env`, fill in the host, and run
`./deploy.sh`.

## Testing notes

- Six simulated devices uploading concurrently: no cross-device access, no backlog.
- Ten synthetic Windows 11 and macOS desktops with stacked, overlapping and maximized windows,
  taskbar, dock, menu bar and toasts: all window counts, types, identities across
  front-to-back changes, and notifications correct.
- Real sessions on a Hyprland desktop with several workspaces.

## Status

A working prototype. Known limits: one shared password (device ids provide the isolation),
identification can lag the screen by up to 15 seconds between model runs, and the model
occasionally misreads text on small banners. See `PLAN.md` for what's next.
