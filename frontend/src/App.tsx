import { useEffect, useState } from "react";
import { clearToken, getToken, me, resetDevice, type Me } from "./api";
import { deviceId } from "./capture";
import Login from "./components/Login";
import Panel from "./components/Panel";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import Wordmark from "./components/Wordmark";
import { emptyDay } from "./data/empty";
import { useFrameAnalysis, useRecorder, useTimeline } from "./live";
import { fromMin, windowColor, type Stretch } from "./model";

type Auth = { state: "checking" } | { state: "out" } | { state: "in"; me: Me };
/** epoch seconds for a fractional minute of today */
const epochOfMin = (m: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000 + m * 60;
};
const CAPTURE_MS = 3000;
const POLL_MS = 5000;
const EMPTY = emptyDay();

export default function App() {
  const [auth, setAuth] = useState<Auth>({ state: "checking" });
  async function check() {
    if (!getToken()) return setAuth({ state: "out" });
    try {
      setAuth({ state: "in", me: await me() });
    } catch {
      setAuth({ state: "out" });
    }
  }
  useEffect(() => {
    void check();
  }, []);
  if (auth.state === "checking") return <main className="login" />;
  if (auth.state === "out") return <Login onDone={check} />;
  return <Screen me={auth.me} onSignOut={() => { clearToken(); setAuth({ state: "out" }); }} />;
}

function Screen({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [menu, setMenu] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [pinned, setPinned] = useState<number | null>(null); // fixed playhead, fractional minutes; null = live
  const [hover, setHover] = useState<number | null>(null); // transient preview while hovering the track
  const scrub = hover ?? pinned;
  const { day: liveDay, error, refresh } = useTimeline(POLL_MS);
  // Each upload refreshes the timeline immediately, so a new frame is scrubbable right away.
  const rec = useRecorder(CAPTURE_MS, refresh);
  const day = liveDay ?? EMPTY;

  const nowMin = day.nowMin;
  const live = scrub === null || scrub >= nowMin;
  const tMin = live ? nowMin : scrub;
  const t = live ? day.now : fromMin(Math.floor(tMin));
  const sel = Math.max(0, day.stretches.findLastIndex((s) => s.startMin <= tMin));
  const stretch: Stretch | undefined = day.stretches[sel];
  // Saved frames only when rewinding; while live the preview is the screen share itself
  // (or the last saved frame if not currently recording).
  const imageUrl = day.imageAt && !live ? day.imageAt(tMin) : null;
  // What is on screen comes from the frame being shown: the latest analysis while live, the
  // saved frame's own analysis when rewound. The tracker's open set (lanes) can be wider.
  const saved = useFrameAnalysis(imageUrl && day.frameIdAt ? day.frameIdAt(tMin) : null);
  // Live view with no active screen share: black preview and nothing listed.
  const blank = live && day.source !== "sample" && !rec.stream;
  const boxes = blank ? [] : imageUrl ? saved.boxes : day.liveBoxes;
  // Only what the frame being shown actually contains. Nothing is listed for a frame without an analysis.
  const seen = imageUrl ? saved.windows : day.liveWindows;
  const onScreen = blank ? [] : (seen ?? []);
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

  async function doReset() {
    setResetting("Deleting…");
    try {
      if (rec.status.state === "recording") rec.stop();
      const r = await resetDevice(deviceId());
      setPinned(null);
      setHover(null);
      refresh();
      setConfirmReset(false);
      setMenu(false);
      setResetting(null);
      console.info("reset", r.deleted);
    } catch (e) {
      setResetting(`Could not reset: ${String(e)}`);
    }
  }

  const st = rec.status;
  const chip =
    st.state === "recording" ? (
      <button className="rec" onClick={rec.stop} title="Stop recording">
        <span className="rec-dot" />Recording · {st.frames} frames{st.skipped ? ` · ${st.skipped} unchanged` : ""}
      </button>
    ) : st.state === "starting" ? (
      <button className="rec rec-off" disabled>Choose a screen…</button>
    ) : (
      <button className="rec rec-off" onClick={rec.start} title="Share your screen to start">
        <span className="rec-dot rec-dot-off" />Start recording
      </button>
    );

  return (
    <div className="app">
      <header className="topbar">
        <div className="row-gap" style={{ gap: 14 }}>
          <Wordmark />
          <span className="muted small">{dateLabel}</span>

        </div>
        <div className="row-gap" style={{ gap: 16, position: "relative" }}>
          {st.state === "error" && <span className="small" style={{ color: "#9a2e24" }}>{st.message}</span>}
          {error && <span className="small muted">timeline: {error}</span>}
          {chip}
          <button className="mono muted menu-btn" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>{day.now}</button>
          {menu && (
            <div className="menu" role="menu">
              <div className="small">Connected to <b className="mono">{me.host}</b></div>
              <div className="small muted">Model {me.model}</div>
              <button className="btn btn-secondary btn-danger" onClick={() => { setMenu(false); setConfirmReset(true); }}>Reset my data</button>
              <button className="btn btn-secondary" onClick={onSignOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      {confirmReset && (
        <div className="modal-backdrop" onClick={() => !resetting && setConfirmReset(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="reset-title" className="modal-title">Delete everything from this browser?</h2>
            <p className="muted">Every screenshot and everything Silmari learned about this device is removed from the server. Other browsers are not affected. This cannot be undone.</p>
            {resetting && <div className="small" style={{ color: resetting.startsWith("Could") ? "#9a2e24" : undefined }}>{resetting}</div>}
            <div className="row-gap" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setConfirmReset(false)} disabled={resetting === "Deleting…"}>Cancel</button>
              <button className="btn btn-primary btn-danger-solid" onClick={doReset} disabled={resetting === "Deleting…"}>Delete everything</button>
            </div>
          </div>
        </div>
      )}

      <div className="main">
        <Preview
            windows={onScreen}
            caption={!live ? `frame from ${t}` : rec.stream ? "live · every 3 s" : day.source === "live" ? `not recording · last frame ${day.now}` : "not recording"}
            rewound={!live}
            imageUrl={imageUrl}
            stream={rec.stream}
            boxes={boxes}
            colorOf={(id) => windowColor(day, id)}
            blank={blank}
          />
        <Panel
          day={day}
          stretch={stretch}
          time={t}
          atEpoch={live ? null : epochOfMin(tMin)}
          live={live}
          onJumpNow={() => setPinned(null)}
          onGoToMin={(m) => setPinned(m)}
        />
      </div>

      <Timeline day={day} playMin={tMin} pinnedAt={pinned} hoverAt={hover} onHover={setHover} onPin={setPinned} />
    </div>
  );
}
