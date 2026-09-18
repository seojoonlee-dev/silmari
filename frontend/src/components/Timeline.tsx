import { APP_CATEGORY, CATEGORY_COLOR, DAY_END, DAY_START, LANE_IDS, NOW, STATS, STRETCHES, WINDOWS, laneLabel, midpoint, openDuring, toMin } from "../data/sample";

const LEGEND: [string, keyof typeof CATEGORY_COLOR][] = [["Focused work", "work"], ["Messages", "comms"], ["Meetings", "meet"], ["Drift", "leisure"]];

export default function Timeline({ sel, onSelect }: { sel: number; onSelect: (i: number) => void }) {
  const span = toMin(DAY_END) - toMin(DAY_START);
  const pct = (t: string) => ((toMin(t) - toMin(DAY_START)) / span) * 100;
  const live = sel === STRETCHES.length - 1;
  const playAt = live ? NOW : midpoint(STRETCHES[sel]);
  const hours: string[] = [];
  for (let h = toMin(DAY_START) / 60; h <= toMin(DAY_END) / 60; h++) hours.push(`${String(h).padStart(2, "0")}:00`);

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

      <div className="lanes">
        <div className="lane">
          <span />
          <div className="ticks">
            {hours.map((h) => <span key={h} className="mono" style={{ left: `${pct(h)}%` }}>{h}</span>)}
          </div>
        </div>
        {LANE_IDS.map((id) => (
          <div key={id} className="lane">
            <span className="lane-name ellipsis">{laneLabel(id)}</span>
            <div className="lane-track">
              {WINDOWS.filter((w) => w.id === id).map((w) => (
                <div key={w.start} title={w.what} className="bar" style={{ left: `${pct(w.start)}%`, width: `calc(${pct(w.end) - pct(w.start)}% - 2px)`, background: CATEGORY_COLOR[APP_CATEGORY[w.app]] }} />
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
              />
            ))}
            <div className={"playhead" + (live ? "" : " past")} style={{ left: `${pct(playAt)}%` }} />
          </div>
        </div>
      </div>

      <div className="cards">
        {STRETCHES.slice(-5).map((s, k) => {
          const i = STRETCHES.length - 5 + k;
          const apps = openDuring(s.start, s.end);
          return (
            <button key={s.start} className={"scard" + (i === sel ? " selected" : "")} onClick={() => onSelect(i)}>
              <div className="row-gap muted small"><span className="mono">{s.start}–{s.end}</span>· {apps.length} window{apps.length === 1 ? "" : "s"}</div>
              <div className="scard-summary">{s.summary}</div>
              <div className="row-gap wrap small muted">
                {apps.map((id) => { const w = WINDOWS.find((x) => x.id === id)!; return <span key={id} className="row-gap" style={{ gap: 4 }}><span className="dot dot-sm" style={{ background: CATEGORY_COLOR[APP_CATEGORY[w.app]] }} />{laneLabel(id)}</span>; })}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
