import { useRef, useState } from "react";
import type { Day } from "../model";
import { CATEGORY_COLOR, fmtDuration, fromMin, laneLabel, midpoint, toMin } from "../model";

// Tick marks measured from the start of the range, at the coarsest step that gives about 6 to 8 labels.
function ticksFor(start: string, end: string): string[] {
  const a = toMin(start), b = toMin(end);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((s) => (b - a) / s <= 8) ?? 240;
  const out: string[] = [];
  for (let m = a; m <= b; m += step) out.push(fromMin(m));
  return out;
}

const LEGEND: [string, keyof typeof CATEGORY_COLOR][] = [["Focused work", "work"], ["Messages", "comms"], ["Meetings", "meet"], ["Drift", "leisure"]];

export default function Timeline({ day, sel, onSelect }: { day: Day; sel: number; onSelect: (i: number) => void }) {
  const { dayStart: DAY_START, dayEnd: DAY_END, now: NOW, stretches: STRETCHES, windows: WINDOWS, laneIds: LANE_IDS, stats: STATS } = day;
  const span = Math.max(1, toMin(DAY_END) - toMin(DAY_START));
  const pct = (t: string) => ((toMin(t) - toMin(DAY_START)) / span) * 100;
  const live = sel === STRETCHES.length - 1;
  const playAt = live ? NOW : midpoint(STRETCHES[sel]);
  const hours = ticksFor(DAY_START, DAY_END);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);

  function onMove(i: number, e: React.MouseEvent) {
    const box = lanesRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ i, x: e.clientX - box.left });
  }

  const hovered = hover ? STRETCHES[hover.i] : null;
  const hoverCard = hovered && hover && (() => {
    const wins = hovered.windowIds.map((id) => WINDOWS.find((w) => w.id === id)).filter((w): w is NonNullable<typeof w> => !!w);
    const notes = day.notifications.filter((n) => toMin(n.time) >= toMin(hovered.start) && toMin(n.time) < toMin(hovered.end));
    const img = day.imageAt ? day.imageAt(midpoint(hovered)) : null;
    const width = lanesRef.current?.clientWidth ?? 800;
    const left = Math.min(Math.max(hover.x, 170), width - 170);
    return (
      <div className="hovercard" style={{ left }} role="tooltip">
        <div className="row-between">
          <span className="mono small">{hovered.start}–{hovered.end}</span>
          <span className="muted small">{fmtDuration(Math.max(1, toMin(hovered.end) - toMin(hovered.start)))} · {wins.length} window{wins.length === 1 ? "" : "s"}</span>
        </div>
        {img && <img className="hovercard-img" src={img} alt="" />}
        <div className="hovercard-text">{hovered.narrative || hovered.summary}</div>
        {wins.length > 0 && (
          <div className="hovercard-list">
            {wins.map((w) => (
              <div key={w.id} className="win-row hovercard-row">
                <span className="dot" style={{ background: CATEGORY_COLOR[w.category] }} />
                <span className="win-app">{w.app}</span>
                <span className="muted ellipsis">{w.what}</span>
              </div>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          <div className="hovercard-list">
            {notes.map((n, k) => (
              <div key={k} className="small"><b>{n.app}</b> {n.time} · {n.text}{n.dismissed ? " (dismissed)" : ""}</div>
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
          <div className="label">Today</div>
          <div className="stats">
            {STATS.map((s) => <span key={s.label}><b className="mono">{s.value}</b> {s.label}</span>)}
          </div>
        </div>
        <div className="legend">
          {LEGEND.map(([n, c]) => <span key={c}><span className="dot" style={{ background: CATEGORY_COLOR[c] }} />{n}</span>)}
          <span className="sep">|</span>
          <span>One lane per window · click a stretch to rewind</span>
        </div>
      </div>

      <div className="lanes" ref={lanesRef} onMouseLeave={() => setHover(null)}>
        {hoverCard}
        <div className="lane">
          <span />
          <div className="ticks">
            {hours.map((h) => <span key={h} className="mono" style={{ left: `${pct(h)}%` }}>{h}</span>)}
          </div>
        </div>
        {LANE_IDS.map((id) => (
          <div key={id} className="lane">
            <span className="lane-name ellipsis">{laneLabel(day, id)}</span>
            <div className="lane-track">
              {WINDOWS.filter((w) => w.id === id).map((w) => (
                <div key={w.start} title={w.what} className="bar" style={{ left: `${pct(w.start)}%`, width: `calc(${pct(w.end) - pct(w.start)}% - 2px)`, background: CATEGORY_COLOR[w.category] }} />
              ))}
            </div>
          </div>
        ))}
        <div className="lane stretch-layer">
          <span />
          <div className="lane-track" style={{ background: "transparent" }}>
            {STRETCHES.map((s, i) => (
              <button
                key={s.start}
                className={"stretch" + (i === sel ? " selected" : "")}
                aria-label={`${s.start} to ${s.end}: ${s.summary}`}
                style={{ left: `${pct(s.start)}%`, width: `${pct(s.end) - pct(s.start)}%` }}
                onClick={() => onSelect(i)}
                onMouseEnter={(e) => onMove(i, e)}
                onMouseMove={(e) => onMove(i, e)}
                onFocus={() => setHover({ i, x: (lanesRef.current?.clientWidth ?? 800) / 2 })}
                onBlur={() => setHover(null)}
              />
            ))}
            <div className={"playhead" + (live ? "" : " past")} style={{ left: `${pct(playAt)}%` }} />
          </div>
        </div>
      </div>

      <div className="cards">
        {STRETCHES.slice(-5).map((s, k) => {
          const i = STRETCHES.length - 5 + k;
          const apps = s.windowIds;
          return (
            <button key={s.start} className={"scard" + (i === sel ? " selected" : "")} onClick={() => onSelect(i)}>
              <div className="row-gap muted small"><span className="mono">{s.start}–{s.end}</span>· {apps.length} window{apps.length === 1 ? "" : "s"}</div>
              <div className="scard-summary">{s.summary}</div>
              <div className="row-gap wrap small muted">
                {apps.map((id) => { const w = WINDOWS.find((x) => x.id === id); return <span key={id} className="row-gap" style={{ gap: 4 }}><span className="dot dot-sm" style={{ background: CATEGORY_COLOR[w?.category ?? "other"] }} />{laneLabel(day, id)}</span>; })}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
