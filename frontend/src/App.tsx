import { useEffect, useState } from "react";
import { clearToken, getToken, me, type Me } from "./api";
import Login from "./components/Login";
import Panel from "./components/Panel";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import Wordmark from "./components/Wordmark";
import { sampleDay } from "./data/sample";
import { useRecorder, useTimeline } from "./live";
import { midpoint, openAt } from "./model";

type Auth = { state: "checking" } | { state: "out" } | { state: "in"; me: Me };
const CAPTURE_MS = 3000;
const POLL_MS = 5000;
const SAMPLE = sampleDay();

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
  const [selIdx, setSel] = useState<number | null>(null); // null = now
  const rec = useRecorder(CAPTURE_MS);
  const { day: liveDay, error } = useTimeline(POLL_MS);
  const day = liveDay ?? SAMPLE;

  const LAST = day.stretches.length - 1;
  const sel = selIdx === null || selIdx > LAST ? LAST : selIdx;
  const live = sel === LAST;
  const stretch = day.stretches[sel];
  const t = live ? day.now : midpoint(stretch);
  // Saved frames only when rewinding; while live the preview is the screen share itself
  // (or the last saved frame if not currently recording).
  const imageUrl = day.imageAt && (!live || !rec.stream) ? day.imageAt(t) : null;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

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
          {day.source === "sample" && <span className="chip chip-plain">Sample day · start recording to see yours</span>}
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
              <button className="btn btn-secondary" onClick={onSignOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      <div className="main">
        <section className="left">
          <Preview
            windows={openAt(day, t)}
            caption={!live ? `frame from ${t}` : rec.stream ? "live · every 3 s" : day.source === "live" ? "last saved frame · not recording" : "sample"}
            rewound={!live}
            imageUrl={imageUrl}
            stream={rec.stream}
          />
        </section>
        <Panel day={day} stretch={stretch} live={live} onJumpNow={() => setSel(null)} onGoTo={setSel} />
      </div>

      <Timeline day={day} sel={sel} onSelect={(i) => setSel(i === LAST ? null : i)} />
    </div>
  );
}
