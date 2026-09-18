import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import type { Day } from "../model";
import { fmtDuration, fromMin, laneLabel, toMin, windowColor } from "../model";
import { useT } from "../i18n";

// Tick marks measured from the start of the range, at the coarsest step that gives about 6 to 8 labels.
function ticksFor(start: string, end: string): string[] {
  const a = toMin(start), b = toMin(end);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((s) => (b - a) / s <= 8) ?? 240;
  const out: string[] = [];
  for (let m = a; m <= b; m += step) out.push(fromMin(m));
  return out;
}


type Props = {
  day: Day;
  /** playhead position in fractional minutes of the day */
  playMin: number;
  /** the fixed playhead position, or null when nothing is pinned */
  pinnedAt: number | null;
  /** the transient hover position, or null when the pointer is off the track */
  hoverAt: number | null;
  /** transient position while the pointer moves over the track; null when it leaves */
  onHover: (min: number | null) => void;
  /** fix the playhead; null means back to live */
  onPin: (min: number | null) => void;
};

export default function Timeline({ day, playMin, pinnedAt, hoverAt, onHover, onPin }: Props) {
  const { dayStart: DAY_START, dayEnd: DAY_END, stretches: STRETCHES, windows: WINDOWS, laneIds: LANE_IDS, stats: STATS } = day;
  const span = Math.max(1, toMin(DAY_END) - toMin(DAY_START));
  const pct = (t: string) => ((toMin(t) - toMin(DAY_START)) / span) * 100;
  const pctMin = (m: number) => ((m - toMin(DAY_START)) / span) * 100;
  const sel = Math.max(0, STRETCHES.findLastIndex((s) => s.startMin <= playMin));
  const trackRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  // keep the selected card in view as the playhead moves
  useEffect(() => {
    const el = cardsRef.current?.querySelector<HTMLElement>(".scard.selected");
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [sel]);

  // Hovering the lanes previews that moment; clicking pins the playhead there. Past the end = live.
  function minAtPointer(e: React.PointerEvent | React.MouseEvent): number | null {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    return toMin(DAY_START) + f * span;
  }
  const clampLive = (m: number | null) => (m === null || m >= day.nowMin ? null : m);
  const hours = ticksFor(DAY_START, DAY_END);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const [detail, setDetail] = useState<number | null>(null); // stretch card opened in a dialog
  const t = useT();
  const nWin = (n: number) => `${n} ${n === 1 ? t("window") : t("windows")}`;
  useEffect(() => {
    if (detail === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  function onMove(i: number, e: React.MouseEvent) {
    const box = lanesRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ i, x: e.clientX - box.left });
  }

  const hovered = hover ? STRETCHES[hover.i] : null;
  const hoverCard = hovered && hover && (() => {
    const wins = hovered.windowIds.map((id) => WINDOWS.find((w) => w.id === id)).filter((w): w is NonNullable<typeof w> => !!w);
    const notes = day.notifications.filter((n) => toMin(n.time) >= toMin(hovered.start) && toMin(n.time) < toMin(hovered.end));
    const img = day.imageAt ? day.imageAt((hovered.startMin + hovered.endMin) / 2) : null;
    const width = lanesRef.current?.clientWidth ?? 800;
    const left = Math.min(Math.max(hover.x, 170), width - 170);
    return (
      <div className="hovercard" style={{ left }} role="tooltip">
        <div className="row-between">
          <span className="mono small">{hovered.start}–{hovered.end}</span>
          <span className="muted small">{fmtDuration(Math.max(1, Math.round(hovered.endMin - hovered.startMin)))} · {nWin(wins.length)}</span>
        </div>
        {img && <img className="hovercard-img" src={img} alt="" />}
        <div className="hovercard-text">{hovered.narrative || hovered.summary}</div>
        {wins.length > 0 && (
          <div className="hovercard-list">
            {wins.map((w) => (
              <div key={w.id} className="win-row hovercard-row">
                <span className="dot" style={{ background: windowColor(day, w.id) }} />
                <span className="win-app">{w.app}</span>
                <span className="muted ellipsis">{w.what}</span>
              </div>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          <div className="hovercard-list">
            {notes.map((n, k) => (
              <div key={k} className="small"><b>{n.app}</b> {n.time} · {n.text}{n.dismissed ? ` (${t("dismissed")})` : ""}</div>
            ))}
          </div>
        )}
      </div>
    );
  })();

  return (
    <section className="timeline">
      <div className="row-between">
        <div className="row-gap" style={{ gap: 18 }}>
          <div className="label">{t("today")}</div>
          <div className="stats">
            {STATS.map((s) => <span key={s.label}><b className="mono">{s.value}</b> {s.label}</span>)}
          </div>
        </div>
        <div className="legend"><span>{t("laneHint")}</span></div>
      </div>

      <div className="lanes" ref={lanesRef} onMouseLeave={() => setHover(null)} data-tour="timeline">
        {hoverCard}
        <div className="lanes-scroll">
        <div className="lanes-content">
        <div className="lane">
          <span />
          <div className="ticks">
            {hours.map((h) => <span key={h} className="mono" style={{ left: `${pct(h)}%` }}>{h}</span>)}
          </div>
        </div>
        {LANE_IDS.length === 0 && (
          <div className="lane"><span /><div className="lane-track lane-empty">{t("noWindowsTimeline")}</div></div>
        )}
        {LANE_IDS.map((id) => (
          <div key={id} className="lane">
            <span className="lane-name ellipsis">{laneLabel(day, id)}</span>
            <div className="lane-track">
              {WINDOWS.filter((w) => w.id === id).map((w) =>
                w.visible
                  ? w.visible.map(([a, b], k) => (
                      <div key={`${w.start}-${k}`} title={w.what} className="bar" style={{ left: `${pctMin(a)}%`, width: `max(2px, ${pctMin(b) - pctMin(a)}%)`, background: windowColor(day, w.id) }} />
                    ))
                  : <div key={w.start} title={w.what} className="bar" style={{ left: `${pct(w.start)}%`, width: `calc(${pct(w.end) - pct(w.start)}% - 2px)`, background: windowColor(day, w.id) }} />,
              )}
            </div>
          </div>
        ))}
        <div className="lane stretch-layer">
          <span />
          <div className="lane-track" style={{ background: "transparent" }}>
            {STRETCHES.map((s, i) => (
              <div
                key={s.start}
                className={"stretch" + (i === sel ? " selected" : "")}
                style={{ left: `${pctMin(s.startMin)}%`, width: `${pctMin(s.endMin) - pctMin(s.startMin)}%` }}
                onMouseEnter={(e) => onMove(i, e)}
                onMouseMove={(e) => onMove(i, e)}
              />
            ))}
            <div
              ref={trackRef}
              className="scrub-surface"
              role="slider"
              aria-label={t("scrub")}
              aria-valuemin={toMin(DAY_START)}
              aria-valuemax={Math.round(day.nowMin)}
              aria-valuenow={Math.round(playMin)}
              tabIndex={0}
              onPointerMove={(e) => onHover(clampLive(minAtPointer(e)))}
              onPointerLeave={() => onHover(null)}
              onClick={(e) => onPin(clampLive(minAtPointer(e)))}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") onPin(clampLive(playMin - 0.25));
                if (e.key === "ArrowRight") onPin(clampLive(playMin + 0.25));
                if (e.key === "End") onPin(null);
              }}
            />
            {/* live marker when nothing is pinned */}
            {pinnedAt === null && <div className="playhead live" style={{ left: `${pctMin(day.nowMin)}%` }} />}
            {/* the fixed pin: ink line, ringed knob that fills in when set (keyed so it replays per pin) */}
            {pinnedAt !== null && (
              <div key={pinnedAt} className="playhead pinned" style={{ left: `${pctMin(pinnedAt)}%` }}>
                <span className="playhead-knob" />
              </div>
            )}
            {/* the unfixed pin: a dashed preview that follows the pointer */}
            {hoverAt !== null && (
              <div className="playhead hovering" style={{ left: `${pctMin(hoverAt)}%` }}>
                <span className="playhead-knob" />
              </div>
            )}
          </div>
        </div>
        </div>
        </div>
      </div>

      <div className="cards" ref={cardsRef} data-tour="cards">
        {STRETCHES.map((s, i) => {
          const apps = s.windowIds;
          return (
            <button key={s.start} className={"scard" + (i === sel ? " selected" : "")} onClick={() => setDetail(i)} title={t("open")}>
              <div className="row-gap muted small"><span className="mono">{s.start}–{s.end}</span>· {nWin(apps.length)}</div>
              <div className="scard-summary">{s.summary}</div>
            </button>
          );
        })}
      </div>
      {detail !== null && STRETCHES[detail] && createPortal(
        (() => {
          const st = STRETCHES[detail];
          const wins = st.windowIds.map((id) => WINDOWS.find((w) => w.id === id)).filter((w): w is NonNullable<typeof w> => !!w);
          return (
            <div className="modal-backdrop" onClick={() => setDetail(null)}>
              <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="stretch-title" onClick={(e) => e.stopPropagation()}>
                <div className="row-between">
                  <div className="panel-head">
                    <span id="stretch-title" className="mono time-big">{st.start}–{st.end}</span>
                    <span className="muted small">{fmtDuration(Math.max(1, Math.round(st.endMin - st.startMin)))} · {nWin(wins.length)}</span>
                  </div>
                  <button className="btn btn-secondary" onClick={() => setDetail(null)} aria-label={t("close")}>✕</button>
                </div>
                <div className="narrative md"><Markdown>{st.narrative || st.summary}</Markdown></div>
                {wins.length > 0 && (
                  <div className="win-list">
                    {wins.map((w) => (
                      <div key={w.id} className="win-row hovercard-row">
                        <span className="dot" style={{ background: windowColor(day, w.id) }} />
                        <span className="win-app">{w.app}</span>
                        <span className="muted ellipsis">{w.what}</span>
                      </div>
                    ))}
                  </div>
                )}
                {st.leftHere.length > 0 && (
                  <div>
                    <div className="label" style={{ marginBottom: 6 }}>{t("leftHere")}</div>
                    {st.leftHere.map((l) => (
                      <div key={l.text} className="small" style={{ marginBottom: 4 }}>{l.text} <span className="muted">· {l.meta}</span></div>
                    ))}
                  </div>
                )}
                <div className="row-gap" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-primary" onClick={() => { onPin((st.startMin + st.endMin) / 2); setDetail(null); }}>{t("goToMoment")}</button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </section>
  );
}
