// Two-language UI. English is the default; the choice is per browser and also sent to the server so
// the model writes narratives, questions and answers in the same language.
import { useSyncExternalStore } from "react";

export type Lang = "en" | "ko";
const KEY = "silmari.lang";
let current: Lang = "en";
try {
  current = localStorage.getItem(KEY) === "ko" ? "ko" : "en";
} catch {}
const listeners = new Set<() => void>();
export const getLang = () => current;
export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  listeners.forEach((f) => f());
}
export function useLang(): Lang {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), getLang, getLang);
}

const STR = {
  tagline: ["The loose end of your day, within reach.", "하루의 실마리를 손끝에."],
  loginHint: ["Enter the password once. This browser stays signed in.", "비밀번호는 한 번만 입력하면 됩니다. 이 브라우저는 계속 로그인 상태로 유지됩니다."],
  password: ["Password", "비밀번호"],
  continue: ["Continue", "계속"],
  checking: ["Checking…", "확인 중…"],
  wrongPassword: ["That password is not right.", "비밀번호가 올바르지 않습니다."],
  unreachable: ["Could not reach the server.", "서버에 연결할 수 없습니다."],
  startRecording: ["Start recording", "녹화 시작"],
  shareHint: ["Share your screen to start", "화면을 공유하면 시작됩니다"],
  chooseScreen: ["Choose a screen…", "화면을 선택하세요…"],
  recording: ["Recording", "녹화 중"],
  frames: ["frames", "프레임"],
  stopRecording: ["Stop recording", "녹화 중지"],
  connectedTo: ["Connected to", "연결된 서버:"],
  model: ["Model", "모델"],
  language: ["Language", "언어"],
  showTutorial: ["Show tutorial", "사용법 다시 보기"],
  resetData: ["Reset my data", "내 데이터 초기화"],
  signOut: ["Sign out", "로그아웃"],
  resetTitle: ["Delete everything from this browser?", "이 브라우저의 모든 기록을 삭제할까요?"],
  resetBody: ["Every screenshot and everything Silmari learned about this device is removed from the server. Other browsers are not affected. This cannot be undone.", "이 기기의 모든 스크린샷과 Silmari가 기억한 내용이 서버에서 삭제됩니다. 다른 브라우저에는 영향이 없습니다. 되돌릴 수 없습니다."],
  deleting: ["Deleting…", "삭제 중…"],
  couldNotReset: ["Could not reset:", "초기화하지 못했습니다:"],
  cancel: ["Cancel", "취소"],
  deleteEverything: ["Delete everything", "모두 삭제"],
  screenThisDevice: ["Screen · this device", "화면 · 이 기기"],
  notRecording: ["Not recording", "녹화 중이 아님"],
  live: ["Live", "실시간"],
  liveEvery: ["live · every 3 s", "실시간 · 3초마다"],
  lastFrame: ["not recording · last frame", "녹화 중이 아님 · 마지막 프레임"],
  frameFrom: ["frame from", "프레임 시각"],
  sample: ["sample", "예시"],
  onScreen: ["On screen", "화면에 표시 중"],
  onScreenThen: ["On screen then", "당시 화면"],
  window: ["window", "창"],
  windows: ["windows", "창"],
  clickForSummary: ["click one for a summary", "클릭하면 요약이 보입니다"],
  startToSee: ["Start recording to see what is on screen.", "녹화를 시작하면 화면의 창이 여기 표시됩니다."],
  noWindowsYet: ["No windows identified yet.", "아직 인식된 창이 없습니다."],
  now: ["Now", "지금"],
  onThisFor: ["on this for", "이 작업을 한 지"],
  min: ["min", "분"],
  hoursMinAgo: ["{h} h {m} min ago", "{h}시간 {m}분 전"],
  jumpToNow: ["Jump to now", "지금으로"],
  nothingRecorded: ["Nothing recorded yet.", "아직 기록이 없습니다."],
  nothingRecordedHint: ["Press Start recording, pick a screen, and the first stretch appears within a few seconds. Everything stays on your own server.", "녹화 시작을 누르고 화면을 고르면 몇 초 안에 첫 구간이 나타납니다. 모든 데이터는 여러분의 서버에만 저장됩니다."],
  leftHere: ["Left here", "남겨둔 것"],
  thinking: ["Thinking…", "생각 중…"],
  couldNotAnswer: ["Could not answer.", "답변하지 못했습니다."],
  goTo: ["Go to", "이동"],
  askDay: ["Ask about your day…", "오늘 하루에 대해 물어보세요…"],
  askAbout: ["Ask about {t}…", "{t}에 대해 물어보세요…"],
  send: ["Send", "보내기"],
  today: ["Today", "오늘"],
  recorded: ["recorded", "기록됨"],
  windowChanges: ["window changes", "창 변경"],
  longestStretch: ["longest stretch", "가장 긴 구간"],
  notifications: ["notifications", "알림"],
  laneHint: ["One lane per window, drawn while it was on screen · hover to scrub, click to pin", "창마다 한 줄, 화면에 보였던 동안만 표시 · 마우스를 올리면 탐색, 클릭하면 고정"],
  noWindowsTimeline: ["No windows yet. Start recording to fill the timeline.", "아직 창이 없습니다. 녹화를 시작하면 타임라인이 채워집니다."],
  scrub: ["Scrub the day", "하루 탐색"],
  open: ["Open", "열기"],
  close: ["Close", "닫기"],
  goToMoment: ["Go to this moment", "이 순간으로 이동"],
  working: ["Working", "작업 중"],
  notAnalyzed: ["Nothing analyzed yet for this stretch.", "이 구간은 아직 분석되지 않았습니다."],
  recordingStarted: ["Recording started", "녹화 시작됨"],
  framesAnalyzing: ["Frames are being analyzed. The first stretch appears within a few seconds.", "프레임을 분석하고 있습니다. 몇 초 안에 첫 구간이 나타납니다."],
  setChanged: ["At {t} the set of windows changed.", "{t}에 창 구성이 바뀌었습니다."],
  dismissed: ["dismissed", "닫음"],
  sampleDay: ["Sample day", "예시 하루"],
} as const;
export type Key = keyof typeof STR;

export function t(key: Key, vars?: Record<string, string | number>, lang: Lang = current): string {
  let s: string = STR[key][lang === "ko" ? 1 : 0];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
export function useT() {
  const lang = useLang();
  return (key: Key, vars?: Record<string, string | number>) => t(key, vars, lang);
}
