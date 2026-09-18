import { useState } from "react";
import { CANNED_ANSWER, SUGGESTIONS_NOW, SUGGESTIONS_PAST } from "../data/sample";
import type { Day, Stretch } from "../model";
import { toMin } from "../model";
import { IconBack, IconBell, IconClock, IconMail, IconNow, IconSend, IconTab } from "./icons";

type Props = { day: Day; stretch?: Stretch; time: string; live: boolean; onJumpNow: () => void; onGoTo: (i: number) => void };

export default function Panel({ day, stretch, time, live, onJumpNow, onGoTo }: Props) {
  const NOW = day.now;
  if (!stretch) {
    return (
      <aside className="panel">
        <div className="panel-head">
          <span className="mono time-big">{NOW}</span>
          <span className="now-tag">Now</span>
        </div>
        <div className="card">
          <p className="narrative">Nothing recorded yet.</p>
          <div className="muted small">Press Start recording, pick a screen, and the first stretch appears within a few seconds. Everything stays on your own server.</div>
        </div>
      </aside>
    );
  }
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const t = live ? NOW : time;
  const ago = Math.max(0, toMin(NOW) - toMin(t));

  function ask(q: string) {
    if (!q.trim()) return;
    setAsked(q.trim());
    setQuestion("");
  }

  return (
    <aside className="panel">
      {/* One fixed-height row in both states, so scrubbing never shifts the content below it. */}
      <div className="row-between panel-head-row">
        <div className="panel-head">
          <span className="mono time-big">{t}</span>
          {live ? (
            <>
              <span className="now-tag">Now</span>
              <span className="muted small">on this for {toMin(NOW) - toMin(stretch.start)} min</span>
            </>
          ) : (
            <span className="muted small">{Math.floor(ago / 60)} h {ago % 60} min ago</span>
          )}
        </div>
        <button className="btn btn-secondary" onClick={onJumpNow} style={{ visibility: live ? "hidden" : "visible" }} aria-hidden={live} tabIndex={live ? -1 : 0}>
          <IconNow size={14} />Jump to now
        </button>
      </div>

      <div className="card narrative-card">
        <p className="narrative">{stretch.narrative}</p>
        {stretch.then && <div className="muted small row-gap"><IconClock size={14} />{stretch.then}</div>}
      </div>

      {stretch.leftHere.length > 0 && (
        <div className="card">
          <div className="label">{live ? "What to do" : "Left here"}</div>
          <div className="loops">
            {stretch.leftHere.map((l) => (
              <div key={l.text} className="loop">
                {l.kind === "message" ? <IconMail color="#5C6470" /> : l.kind === "notification" ? <IconBell color="#C98A2B" /> : <IconTab color="#5C6470" />}
                <div>
                  {l.text}
                  <div className="muted small">{l.meta}</div>
                </div>
              </div>
            ))}
          </div>
          {live && (
            <div className="row-gap">
              <button className="btn btn-primary"><IconSend size={16} color="#fff" />Finish the reply</button>
              <button className="btn btn-secondary"><IconBack size={16} />Back to the report</button>
            </div>
          )}
        </div>
      )}

      <div className="ask">
        {asked && (
          <div className="chat">
            <div className="bubble-me">{asked}</div>
            <div className="bubble-ai">
              {CANNED_ANSWER.text}
              <div className="row-gap" style={{ marginTop: 8 }}>
                {CANNED_ANSWER.cites.map((c) => (
                  <button key={c.label} className="chip chip-accent mono" onClick={() => onGoTo(c.stretch)}>{c.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="row-gap wrap">
          {(live ? SUGGESTIONS_NOW : SUGGESTIONS_PAST).map((s) => (
            <button key={s} className="chip chip-plain" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
        <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your day…" aria-label="Ask about your day" />
          <button type="submit" className="send" aria-label="Send"><IconSend size={16} color="#fff" /></button>
        </form>
      </div>
    </aside>
  );
}
