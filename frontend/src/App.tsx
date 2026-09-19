import { useEffect, useState } from "react";
import { clearToken, getToken, me, resetDevice, type Me } from "./api";
import { deviceId } from "./capture";
import Login from "./components/Login";
import Panel from "./components/Panel";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import Tour from "./components/Tour";
import { sampleDay } from "./data/sample";
import Wordmark from "./components/Wordmark";
import { IconGear } from "./components/icons";
import { emptyDay } from "./data/empty";
import { useFrameAnalysis, useRecorder, useTimeline } from "./live";
import { setLang, useLang, useT } from "./i18n";
import { setSettings } from "./api";
import { fromMin, openAt, toMin, windowColor, type Stretch } from "./model";

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
const SAMPLES = { en: sampleDay("en"), ko: sampleDay("ko") };
const TOUR_KEY = "silmari.tourDone";

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
  const [tour, setTour] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TOUR_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const onTutorial = () => setTour(true);
  const endTour = () => {
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch {}
    setTour(false);
    setPinned(null);
    setHover(null);
  };
  const t = useT();
  const lang = useLang();
  // tell the server the language once per session so model output matches the UI
  useEffect(() => {
    void setSettings(deviceId(), lang).catch(() => {});
  }, [lang]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [pinned, setPinned] = useState<number | null>(null); // fixed playhead, fractional minutes; null = live
  const [hover, setHover] = useState<number | null>(null); // transient preview while hovering the track
  const scrub = hover ?? pinned;
  const { day: liveDay, error, refresh } = useTimeline(POLL_MS);
  // Each upload refreshes the timeline immediately, so a new frame is scrubbable right away.
  const rec = useRecorder(CAPTURE_MS, refresh);
  // During the tour every element needs content, so the example day stands in.
  const day = tour ? SAMPLES[lang] : (liveDay ?? EMPTY);

  const nowMin = day.nowMin;
  const live = scrub === null || scrub >= nowMin;
  const tMin = live ? nowMin : scrub;
  const tt = live ? day.now : fromMin(Math.floor(tMin));
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
  const onScreen = blank ? [] : (seen ?? (day.source === "sample" ? openAt(day, tt) : []));
  const dateLabel = new Date().toLocaleDateString(lang === "ko" ? "ko-KR" : undefined, { weekday: "long", day: "numeric", month: "short" });

  async function doReset() {
    setResetting(t("deleting"));
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
      setResetting(`${t("couldNotReset")} ${String(e)}`);
    }
  }

  const st = rec.status;
  const chip =
    st.state === "recording" ? (
      <button className="rec" onClick={rec.stop} title={t("stopRecording")}>
        <span className="rec-dot" />{t("recording")} · {st.frames} {t("frames")}
      </button>
    ) : st.state === "starting" ? (
      <button className="rec rec-off" disabled>{t("chooseScreen")}</button>
    ) : (
      <button className="rec rec-off" onClick={rec.start} title={t("shareHint")} data-tour="record">
        <span className="rec-dot rec-dot-off" />{t("startRecording")}
      </button>
    );

  return (
    <div className="app">
      <header className="topbar">
        <div className="row-gap" style={{ gap: 14 }}>
          <span data-tour="brand"><Wordmark /></span>
          <span className="muted small">{dateLabel}</span>
          {day.source === "sample" && <span className="chip chip-plain">{t("sampleDay")}</span>}

        </div>
        <div className="row-gap" style={{ gap: 16, position: "relative" }}>
          {st.state === "error" && <span className="small" style={{ color: "#9a2e24" }}>{st.message}</span>}
          {error && <span className="small muted">timeline: {error}</span>}
          <div className="seg" role="group" aria-label={t("language")}>
            <button className={"seg-btn" + (lang === "en" ? " on" : "")} onClick={() => setLang("en")}>EN</button>
            <button className={"seg-btn" + (lang === "ko" ? " on" : "")} onClick={() => setLang("ko")}>한국어</button>
          </div>
          {chip}
          <span className="mono muted">{day.now}</span>
          <button className="menu-btn gear" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label={t("settings")} title={t("settings")} data-tour="menu"><IconGear size={18} /></button>
          {menu && (
            <div className="menu" role="menu">
              <div className="small">{t("connectedTo")} <b className="mono">{me.host}</b></div>
              <div className="small muted">{t("model")} {me.model}</div>
              <button className="btn btn-secondary" onClick={() => { setMenu(false); onTutorial(); }}>{t("showTutorial")}</button>
              <button className="btn btn-secondary btn-danger" onClick={() => { setMenu(false); setConfirmReset(true); }}>{t("resetData")}</button>
              <button className="btn btn-secondary" onClick={onSignOut}>{t("signOut")}</button>
            </div>
          )}
        </div>
      </header>

      {confirmReset && (
        <div className="modal-backdrop" onClick={() => !resetting && setConfirmReset(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="reset-title" className="modal-title">{t("resetTitle")}</h2>
            <p className="muted">{t("resetBody")}</p>
            {resetting && <div className="small" style={{ color: resetting !== t("deleting") ? "#9a2e24" : undefined }}>{resetting}</div>}
            <div className="row-gap" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setConfirmReset(false)} disabled={resetting === t("deleting")}>{t("cancel")}</button>
              <button className="btn btn-primary btn-danger-solid" onClick={doReset} disabled={resetting === t("deleting")}>{t("deleteEverything")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="main">
        <Preview
            windows={onScreen}
            caption={!live ? `${t("frameFrom")} ${tt}` : rec.stream ? t("liveEvery") : day.source === "live" ? `${t("lastFrame")} ${day.now}` : day.source === "sample" ? t("sample") : t("notRecording")}
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
          time={tt}
          atEpoch={live ? null : epochOfMin(tMin)}
          live={live}
          onJumpNow={() => setPinned(null)}
          onGoToMin={(m) => setPinned(m)}
        />
      </div>

      <Timeline day={day} playMin={tMin} pinnedAt={pinned} hoverAt={hover} onHover={setHover} onPin={setPinned} />
      {tour && (
        <Tour
          onDone={endTour}
          demo={{ scrub: setHover, pin: setPinned, range: [toMin(day.dayStart) + 2, toMin(day.dayEnd) - 15] }}
        />
      )}
    </div>
  );
}
