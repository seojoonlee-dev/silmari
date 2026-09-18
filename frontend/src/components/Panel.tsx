import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { ask as askApi, chatHistory } from "../api";
import { deviceId } from "../capture";
import type { Day, Stretch } from "../model";
import { minuteOf, toMin } from "../model";
import { useT } from "../i18n";
import { IconBell, IconClock, IconMail, IconNow, IconSend, IconTab } from "./icons";

type Turn = { q: string; a: string; cites: { time: number; label: string }[]; pending?: boolean; error?: string };

type Props = {
  day: Day;
  stretch?: Stretch;
  time: string;
  /** epoch seconds of the shown moment, or null when live */
  atEpoch: number | null;
  live: boolean;
  onJumpNow: () => void;
  /** pin the playhead at fractional minutes of the day */
  onGoToMin: (min: number) => void;
};

export default function Panel({ day, stretch, time, atEpoch, live, onJumpNow, onGoToMin }: Props) {
  const NOW = day.now;
  const t = useT();
  if (!stretch) {
    return (
      <aside className="panel">
        <div className="panel-head">
          <span className="mono time-big">{NOW}</span>
          <span className="now-tag">{t("now")}</span>
        </div>
        <div className="card">
          <p className="narrative">{t("nothingRecorded")}</p>
          <div className="muted small">{t("nothingRecordedHint")}</div>
        </div>
      </aside>
    );
  }
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<Turn[]>([]);
  // The conversation lives on the server, so a reload (or another browser on this device id) gets it back.
  useEffect(() => {
    let stop = false;
    chatHistory(deviceId())
      .then((r) => !stop && setThread(r.turns.map((t) => ({ q: t.q, a: t.a, cites: t.cites }))))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);
  const tt = live ? NOW : time;
  const ago = Math.max(0, toMin(NOW) - toMin(tt));

  async function ask(q: string) {
    const text = q.trim();
    if (!text || thread.some((x) => x.pending)) return;
    setQuestion("");
    const history = thread.filter((x) => !x.error).map((x) => ({ q: x.q, a: x.a }));
    setThread((th) => [...th, { q: text, a: "", cites: [], pending: true }]);
    try {
      const r = await askApi(deviceId(), text, atEpoch, history);
      setThread((th) => th.map((x) => (x.pending ? { q: text, a: r.answer, cites: r.cites } : x)));
    } catch (e) {
      setThread((th) => th.map((x) => (x.pending ? { q: text, a: "", cites: [], error: String(e) } : x)));
    }
  }
  const suggestions = stretch?.questions?.length ? stretch.questions : [];

  return (
    <aside className="panel">
      {/* One fixed-height row in both states, so scrubbing never shifts the content below it. */}
      <div className="row-between panel-head-row">
        <div className="panel-head">
          <span className="mono time-big">{tt}</span>
          {live ? (
            <>
              <span className="now-tag">{t("now")}</span>
              <span className="muted small">{t("onThisFor")} {Math.max(0, Math.round(day.nowMin - stretch.startMin))} {t("min")}</span>
            </>
          ) : (
            <span className="muted small">{t("hoursMinAgo", { h: Math.floor(ago / 60), m: ago % 60 })}</span>
          )}
        </div>
        <button className="btn btn-secondary" onClick={onJumpNow} style={{ visibility: live ? "hidden" : "visible" }} aria-hidden={live} tabIndex={live ? -1 : 0}>
          <IconNow size={14} />{t("jumpToNow")}
        </button>
      </div>

      <div className="card narrative-card" data-tour="narrative">
        <div className="narrative md"><Markdown>{stretch.narrative}</Markdown></div>
        {stretch.then && <div className="muted small row-gap"><IconClock size={14} />{stretch.then}</div>}
      </div>

      {stretch.leftHere.length > 0 && (
        <div className="card">
          <div className="label">{t("leftHere")}</div>
          <div className="loops">
            {stretch.leftHere.map((l) => (
              <div key={l.text} className="loop">
                {l.kind === "message" ? <IconMail color="#5C6470" /> : l.kind === "notification" ? <IconBell color="#C98A2B" /> : <IconTab color="#5C6470" />}
                <div>
                  <div className="md"><Markdown>{l.text}</Markdown></div>
                  <div className="muted small">{l.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ask" data-tour="ask">
        {thread.length > 0 && (
          <div className="chat">
            {thread.map((turn, k) => (
              <div key={k} className="chat-turn">
                <div className="bubble-me md"><Markdown>{turn.q}</Markdown></div>
                <div className="bubble-ai">
                  {turn.pending ? (
                    <span className="muted">{t("thinking")}</span>
                  ) : turn.error ? (
                    <span style={{ color: "#9a2e24" }}>{t("couldNotAnswer")} {turn.error}</span>
                  ) : (
                    <div className="md"><Markdown>{turn.a}</Markdown></div>
                  )}
                  {turn.cites.length > 0 && (
                    <div className="row-gap wrap" style={{ marginTop: 8 }}>
                      {turn.cites.map((c) => (
                        <button key={c.label} className="chip chip-accent mono" onClick={() => onGoToMin(minuteOf(c.time))}>{t("goTo")} {c.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="row-gap wrap">
            {suggestions.map((s) => (
              <button key={s} className="chip chip-plain" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
        )}
        <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={live ? t("askDay") : t("askAbout", { t: tt })} aria-label={t("askDay")} />
          <button type="submit" className="send" aria-label={t("send")}><IconSend size={16} color="#fff" /></button>
        </form>
      </div>
    </aside>
  );
}
