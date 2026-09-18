import { useState } from "react";
import type { Stretch } from "../data/sample";
import { CANNED_ANSWER, INTENT, NOW, SUGGESTIONS_NOW, SUGGESTIONS_PAST, midpoint, toMin } from "../data/sample";
import { IconBack, IconBell, IconClock, IconMail, IconNow, IconSend, IconTab, IconTarget } from "./icons";

type Props = { stretch: Stretch; live: boolean; onJumpNow: () => void; onGoTo: (i: number) => void };

export default function Panel({ stretch, live, onJumpNow, onGoTo }: Props) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const t = live ? NOW : midpoint(stretch);
  const ago = toMin(NOW) - toMin(t);

  function ask(q: string) {
    if (!q.trim()) return;
    setAsked(q.trim());
    setQuestion("");
  }

  return (
    <aside className="panel">
      {live ? (
        <div className="panel-head">
          <span className="mono time-big">{NOW}</span>
          <span className="now-tag">Now</span>
          <span className="muted small">on this for {toMin(NOW) - toMin(stretch.start)} min</span>
        </div>
      ) : (
        <div className="row-between">
          <div className="panel-head">
            <span className="mono time-big">{t}</span>
            <span className="muted small">{Math.floor(ago / 60)} h {ago % 60} min ago</span>
          </div>
          <button className="btn btn-secondary" onClick={onJumpNow}><IconNow size={14} />Jump to now</button>
        </div>
      )}

      <div className="card">
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

      <div className="intent">
        <IconTarget size={16} color="#0F766E" />
        <div><b>Intent</b> · {INTENT.text}</div>
        <span className="mono muted small">{INTENT.timeOnIt}</span>
      </div>

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
