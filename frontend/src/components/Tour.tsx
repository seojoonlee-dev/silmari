import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n";

/** Guided tour over the real screen (fed with the sample day). Each step spotlights one element
 *  by its data-tour attribute and, where it helps, animates what the hand would do there. */
type Step = {
  target: string;
  title: [string, string];
  body: [string, string];
  /** scripted animation while the step is shown */
  demo?: "pulse" | "scrub" | "boxes" | "cards" | "ask";
  place?: "below" | "above" | "left" | "right";
};

const STEPS: Step[] = [
  { target: "brand", place: "below",
    title: ["Welcome to Silmari", "Silmari에 오신 것을 환영합니다"],
    body: ["Silmari watches your screen and remembers it for you: what was open, what you were doing, and what you left unfinished. This tour takes about a minute, using an example day.", "Silmari는 화면을 지켜보고 대신 기억해 줍니다. 무엇이 열려 있었는지, 무엇을 하고 있었는지, 무엇을 하다 말았는지. 예시 하루로 1분 정도 둘러봅니다."] },
  { target: "record", demo: "pulse", place: "below",
    title: ["Start recording", "녹화 시작"],
    body: ["Press this and pick a screen in the browser's share dialog. A frame is captured every 3 seconds and sent to your own server; nothing leaves it. On macOS the browser needs Screen Recording permission the first time.", "이 버튼을 누르고 브라우저의 공유 창에서 화면을 고르세요. 3초마다 한 프레임이 여러분의 서버로 전송되며 밖으로 나가지 않습니다. macOS에서는 처음에 브라우저에 화면 기록 권한을 줘야 합니다."] },
  { target: "preview", demo: "boxes", place: "right",
    title: ["Your screen, with the windows the model found", "모델이 찾은 창이 표시된 화면"],
    body: ["While recording this is your live screen. Every window the model recognizes gets a colored outline; hover one to read what it shows.", "녹화 중에는 실시간 화면이 보입니다. 모델이 인식한 창마다 색 테두리가 그려지고, 마우스를 올리면 그 창의 내용을 읽을 수 있습니다."] },
  { target: "onscreen", place: "right",
    title: ["What is on screen", "화면에 있는 것"],
    body: ["The same windows as a list. Click one for the model's summary of its content. Two windows of the same app are told apart by what they show.", "같은 창들을 목록으로 봅니다. 하나를 클릭하면 모델이 요약한 내용이 보입니다. 같은 앱의 창 두 개도 보여주는 내용으로 구분됩니다."] },
  { target: "narrative", place: "left",
    title: ["What you were doing", "무엇을 하고 있었는지"],
    body: ["A short narrative of the current stretch, written from the frames: files, pages, tracks, commands and people by name. Below it, things you left unfinished and notifications you dismissed.", "현재 구간에 대한 짧은 서술입니다. 파일, 페이지, 음악, 명령어, 사람 이름까지 프레임에서 읽어 씁니다. 그 아래에는 하다 만 일과 닫아버린 알림이 나옵니다."] },
  { target: "timeline", demo: "scrub", place: "above",
    title: ["Rewind the day", "하루 되감기"],
    body: ["One lane per window, drawn while it was on screen. Hover anywhere to scrub: the preview shows the saved screenshot from that moment. Click to pin it.", "창마다 한 줄이 있고, 화면에 보였던 동안만 그려집니다. 아무 곳에나 마우스를 올리면 그 순간의 스크린샷이 보이고, 클릭하면 고정됩니다."] },
  { target: "cards", demo: "cards", place: "above",
    title: ["Stretches", "구간"],
    body: ["Each card is a stretch where the same windows stayed on screen. Hover for details, click to open the full story and jump there.", "각 카드는 같은 창들이 화면에 있던 하나의 구간입니다. 마우스를 올리면 자세히 보이고, 클릭하면 전체 이야기를 열어 그 순간으로 이동할 수 있습니다."] },
  { target: "ask", demo: "ask", place: "above",
    title: ["Ask your day", "하루에 물어보기"],
    body: ["Ask anything: \"what did the terminal say?\", \"which track was playing?\". The answer reads the actual screenshots and links the moments it mentions. The chips are questions suggested from what you did.", "무엇이든 물어보세요. \"터미널에 뭐라고 나왔지?\", \"무슨 노래가 나오고 있었지?\" 답변은 실제 스크린샷을 읽고, 언급한 순간으로 이동할 수 있는 링크를 답니다. 칩은 여러분의 활동에서 제안된 질문입니다."] },
  { target: "menu", place: "below",
    title: ["Reset and this tour", "초기화와 이 안내"],
    body: ["The gear opens a menu: delete everything recorded from this browser, or replay this tour. The EN / 한국어 switch next to the record button changes the language, and the model follows. You are ready.", "톱니바퀴를 누르면 메뉴가 열립니다. 이 브라우저의 기록 전체 삭제, 이 안내 다시 보기. 녹화 버튼 옆의 EN / 한국어 스위치로 언어를 바꾸면 모델도 따라갑니다. 이제 준비되었습니다."] },
];

type Rect = { left: number; top: number; width: number; height: number };
const PAD = 8;

export type TourDemo = { scrub: (min: number | null) => void; pin: (min: number | null) => void; range: [number, number] };

export default function Tour({ onDone, demo }: { onDone: () => void; demo: TourDemo }) {
  const lang = useLang();
  const li = lang === "ko" ? 1 : 0;
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; down: boolean } | null>(null);
  const step = STEPS[i];
  const cardRef = useRef<HTMLDivElement>(null);

  // measure the target; re-measure on resize and as the layout settles
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect({ left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD });
    };
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  // scripted demos
  useEffect(() => {
    setCursor(null);
    demo.scrub(null);
    if (!rect) return;
    let raf = 0, t0 = performance.now(), stop = false;
    const [a, b] = demo.range;
    if (step.demo === "scrub") {
      const y = rect.top + rect.height * 0.42;
      const loop = (now: number) => {
        if (stop) return;
        const p = ((now - t0) / 4500) % 1; // 4.5 s sweep, then pin, repeat
        const f = p < 0.7 ? p / 0.7 : 0.7 + 0.3 * (1 - Math.exp(-(p - 0.7) * 20));
        const x = rect.left + 100 + (rect.width - 130) * Math.min(1, f);
        setCursor({ x, y, down: p >= 0.7 && p < 0.78 });
        const m = a + (b - a) * (0.05 + 0.9 * Math.min(1, f));
        if (p < 0.7) demo.scrub(m);
        else if (p < 0.72) { demo.scrub(null); demo.pin(m); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else if (step.demo === "boxes") {
      const loop = (now: number) => {
        if (stop) return;
        const p = ((now - t0) / 3000) % 1;
        const cx = rect.left + rect.width * (0.28 + 0.44 * (0.5 - 0.5 * Math.cos(p * 2 * Math.PI)));
        const cy = rect.top + rect.height * (0.3 + 0.35 * (0.5 - 0.5 * Math.cos(p * 4 * Math.PI)));
        setCursor({ x: cx, y: cy, down: false });
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else if (step.demo === "cards") {
      const loop = (now: number) => {
        if (stop) return;
        const p = ((now - t0) / 3500) % 1;
        setCursor({ x: rect.left + rect.width * (0.2 + 0.6 * p), y: rect.top + rect.height * 0.5, down: p > 0.9 });
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      demo.scrub(null);
      demo.pin(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rect?.left, rect?.top, rect?.width, rect?.height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : onDone());
  const back = () => setI(Math.max(0, i - 1));

  // tooltip placement
  const W = window.innerWidth, H = window.innerHeight, CW = 360;
  let style: React.CSSProperties = { left: 24, top: 24 };
  if (rect) {
    const place = step.place ?? "below";
    if (place === "below") style = { left: Math.min(Math.max(16, rect.left), W - CW - 16), top: rect.top + rect.height + 14 };
    if (place === "above") style = { left: Math.min(Math.max(16, rect.left + rect.width / 2 - CW / 2), W - CW - 16), bottom: H - rect.top + 14 };
    if (place === "right") style = { left: Math.min(rect.left + rect.width + 14, W - CW - 16), top: Math.max(16, rect.top) };
    if (place === "left") style = { left: Math.max(16, rect.left - CW - 14), top: Math.max(16, rect.top) };
  }

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={step.title[li]}>
      {rect && <div className="tour-spot" style={rect} />}
      {rect && step.demo === "pulse" && <div className="tour-pulse" style={rect} />}
      {rect && step.demo === "boxes" && (
        <>
          <div className="tour-demo-box" style={{ left: rect.left + rect.width * 0.03, top: rect.top + rect.height * 0.06, width: rect.width * 0.46, height: rect.height * 0.44, borderColor: "#2F6F8F" }}><span style={{ background: "#2F6F8F" }}>Editor</span></div>
          <div className="tour-demo-box" style={{ left: rect.left + rect.width * 0.51, top: rect.top + rect.height * 0.06, width: rect.width * 0.46, height: rect.height * 0.44, borderColor: "#C98A2B" }}><span style={{ background: "#C98A2B" }}>Browser</span></div>
          {cursor && <div className="box-tip" style={{ position: "fixed", left: cursor.x + 14, top: cursor.y + 18, zIndex: 10002 }}><b>{cursor.x < rect.left + rect.width / 2 ? "Editor" : "Browser"}</b> <span className="muted">{cursor.x < rect.left + rect.width / 2 ? "frontend/src/App.tsx" : "Kim et al. 2024, results table"}</span><div className="box-tip-text">{cursor.x < rect.left + rect.width / 2 ? (li ? "App.tsx를 편집 중, useRecorder 호출 부근." : "Editing App.tsx around the useRecorder call.") : (li ? "Kim et al. 2024 논문의 결과 표를 읽는 중." : "Reading the results table of Kim et al. 2024.")}</div></div>}
        </>
      )}
      {cursor && (
        <svg className={"tour-cursor" + (cursor.down ? " down" : "")} style={{ left: cursor.x, top: cursor.y }} width="26" height="30" viewBox="0 0 24 28" aria-hidden="true">
          <path d="M3 2l8 20 3-8 8-3z" fill="#fff" stroke="#1B1F26" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
      <div className="tour-card" style={style} ref={cardRef}>
        <div className="tour-step">{i + 1} / {STEPS.length}</div>
        <div className="tour-title">{step.title[li]}</div>
        <div className="tour-body">{step.body[li]}</div>
        <div className="row-between" style={{ marginTop: 6 }}>
          <button className="btn btn-secondary" onClick={onDone}>{li ? "건너뛰기" : "Skip"}</button>
          <div className="row-gap">
            {i > 0 && <button className="btn btn-secondary" onClick={back}>{li ? "이전" : "Back"}</button>}
            <button className="btn btn-primary" onClick={next}>{i < STEPS.length - 1 ? (li ? "다음" : "Next") : (li ? "시작하기" : "Done")}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
