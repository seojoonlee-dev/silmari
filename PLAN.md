# Silmari plan

*Silmari* (실마리): the loose end of a thread, and figuratively the clue that lets you untangle something.

A screen-recording memory aid designed for ADHD working memory and useful to everyone.
A client captures the screen every few seconds, a vision model on a home GPU turns the
frames into a timeline of what was on screen, and the app answers "where was I", "what
do I need to do", and "what was that thing I was reading".

## Priorities

1. **Notification tracking.** ADHD brains either ignore notifications or forget them.
   Every notification that appears on screen is recorded with its time and whether it was
   dismissed, and the model turns them into a "what to do" list. This is the top feature.
2. **Summaries of on-screen content.** The model reads what is on screen and can summarize
   it on request: a paper being read, a long thread, a document. Attached to the window it
   came from, so "what was that paper" has an answer.
3. **Multitasking as a first-class case.** No window has priority. A stretch is a period
   where the set of open windows did not change. See detection layers below.
4. **Deployment as a website.** Everyone opens a URL, no install.

## Detection layers (backend, not built yet)

- **Windows are tracked from first appearance.** A window record starts the first time it
  shows up in a frame.
- **Identity by app and content, not just app.** Two VS Code windows with different projects
  are two windows. The model names each window by what it shows (project, document, thread)
  and the tracker keys on that.
- **Closure by absence.** A window not seen for N consecutive minutes of frames (start with
  10, tune later) is considered closed, with its end time set to when it was last seen, not
  when the timeout fired.
- **Fast multitaskers.** People who keep many windows across several workspaces and flip
  quickly. The capture interval and the switch logic must not create a stretch per glance:
  debounce short flips, treat workspace as part of context, and key everything on the set of
  windows rather than on which one is in front.

- **Environment profile (later).** The model should learn each device from its frames: the
  OS and desktop, what the workspaces or virtual desktops look like and how to tell them
  apart, where notifications pop up and what they look like, the usual apps. Stored per
  device and fed back into every analysis prompt so identification gets better over time.

## Deployment

Single origin on the home GPU machine. The FastAPI backend serves the built frontend as
static files and the API under `/api`, on one local port. Tailscale Funnel exposes that one
port publicly. The browser talks to `/api` on the same origin, so no CORS and no backend URL
in the frontend build. vLLM stays on its own local port, reachable only by the backend.

```
browser ── https funnel ──> backend :8787 ── http localhost ──> vLLM :8000
                              ├─ /            static frontend build
                              └─ /api/*       FastAPI
```

Password login returns a bearer token stored in the browser.

## Status

- Done: backend with password auth and a Qwen round-trip; frontend UI with a sample day
  (tiled preview, playhead-driven panel, per-window timeline lanes, canned ask answers);
  single-origin deploy behind Funnel.
- Not built: screen capture, frame upload, window tracking, notification tracking,
  summaries, real `/api/ask`, "back to it" actions.
