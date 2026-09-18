// Sample day. Not shown by default any more: kept for the first-login "how to use" tutorial,
// where a filled-in screen is worth more than an empty one.

import type { Category, Day, OpenLoop, Stretch } from "../model";
import { toMin } from "../model";

export type App = "Word" | "Chrome" | "VS Code" | "Slack" | "Meet" | "YouTube";

export const APP_CATEGORY: Record<App, Category> = {
  Word: "work",
  Chrome: "work",
  "VS Code": "work",
  Slack: "comms",
  Meet: "meet",
  YouTube: "leisure",
};


export const NOW = "13:47";
export const DAY_START = "09:00";
export const DAY_END = "14:00";

// A window is identified by app AND content, so two VS Code windows with different
// projects are two windows (two lanes). `id` is that identity; `what` is the current
// content label; `summary` is what the model can say about the content on request.
export type WindowSpan = { id: string; app: App; start: string; end: string; what: string; summary?: string };

export const WINDOWS: WindowSpan[] = [
  { id: "word-report", app: "Word", start: "09:02", end: "11:20", what: "Report_final.docx" },
  { id: "word-report", app: "Word", start: "13:33", end: NOW, what: "Report_final.docx",
    summary: "Draft of the project report. Title, abstract and an intro that stops mid-sentence after the second citation (Kim et al. 2024). About 600 words so far." },
  { id: "chrome-kim", app: "Chrome", start: "10:37", end: "11:20", what: "Kim et al. 2024" },
  { id: "chrome-kim", app: "Chrome", start: "13:05", end: NOW, what: "Kim et al. 2024, results table",
    summary: "Kim et al. 2024 compare three attention-tracking methods on 42 participants. Screen-based tracking beat self-report on recall accuracy by 31%. You stopped at Table 3, the per-condition results." },
  { id: "vscode-frontend", app: "VS Code", start: "13:33", end: NOW, what: "frontend · App.tsx",
    summary: "React app, App.tsx. Recent edits add a fetch to /api/ping and store the login token in localStorage." },
  { id: "vscode-backend", app: "VS Code", start: "13:40", end: NOW, what: "backend · main.py",
    summary: "FastAPI backend, main.py. Four routes: health, login, me, ping. Opened to check the ping route's response shape." },
  { id: "slack-report", app: "Slack", start: "09:30", end: "12:00", what: "#report-team, Minji" },
  { id: "slack-report", app: "Slack", start: "13:33", end: NOW, what: "Minji, reply typed, not sent",
    summary: "Thread with Minji about the report deadline. She asked whether the intro draft was sent. A reply is typed in the composer but not sent." },
  { id: "meet-sync", app: "Meet", start: "11:20", end: "12:00", what: "Team sync, 4 people" },
  { id: "youtube", app: "YouTube", start: "09:52", end: "10:37", what: "Watching, sidebar open" },
];

// Lanes: one per window identity, in order of first appearance.
export const LANE_IDS = [...new Set(WINDOWS.map((w) => w.id))];
export const laneLabel = (id: string) => {
  const w = WINDOWS.find((x) => x.id === id)!;
  const sameApp = LANE_IDS.filter((l) => WINDOWS.find((x) => x.id === l)!.app === w.app).length > 1;
  return sameApp ? `${w.app} · ${w.what.split(" · ")[0]}` : w.app;
};

// Notifications seen on screen. ADHD brains ignore or forget these, so every one is kept
// with whether it was dismissed, and the model turns them into "what to do".
export type Notification = { time: string; app: string; text: string; dismissed: boolean };
export const NOTIFICATIONS: Notification[] = [
  { time: "10:12", app: "Calendar", text: "Dentist, 16:00 today", dismissed: true },
  { time: "13:44", app: "Slack", text: "Minji: did you send the intro draft yet?", dismissed: false },
  { time: "13:21", app: "Mail", text: "Prof. Han: office hours moved to Friday", dismissed: true },
];

// A stretch is a period where the set of open windows did not change.
type SampleStretch = Omit<Stretch, "windowIds" | "startMin" | "endMin">;

export const STRETCHES: SampleStretch[] = [
  {
    start: "09:02",
    end: "09:30",
    summary: "Drafting the report intro",
    narrative:
      "You were 14 minutes into drafting the report intro. One window, nothing else open; the cleanest stretch of the day.",
    then: "At 9:30 you opened Slack next to it.",
    leftHere: [],
  },
  {
    start: "09:30",
    end: "09:52",
    summary: "Intro draft with Minji's thread beside it",
    narrative:
      "The intro draft and Minji's Slack thread were side by side. The thread was about the deadline; the draft grew two paragraphs.",
    then: "At 9:52 YouTube joined them, probably from a link in the thread.",
    leftHere: [],
  },
  {
    start: "09:52",
    end: "10:37",
    summary: "YouTube joined and the intro stopped moving",
    narrative:
      "Word, Slack and YouTube were all open together. The intro did not change for 45 minutes; the YouTube sidebar did.",
    then: "At 10:37 you closed YouTube and opened the Kim et al. paper in its place.",
    leftHere: [],
  },
  {
    start: "10:37",
    end: "11:20",
    summary: "Adding citations from Kim et al. to the intro",
    narrative:
      "Word, Slack and the Kim et al. paper were open together. You were pulling citations from the paper into the intro.",
    then: "At 11:20 the team sync started and the intro was left mid-sentence.",
    leftHere: [{ text: "Report intro ends mid-sentence after the second citation", meta: "Word · 11:20", kind: "document" }],
  },
  {
    start: "11:20",
    end: "12:00",
    summary: "Team sync, Slack alongside",
    narrative:
      "Meet and Slack were open together for the team sync. Messages kept arriving in the thread during the call.",
    then: "At 12:00 the call ended and you were away until 13:05.",
    leftHere: [],
  },
  {
    start: "13:05",
    end: "13:33",
    summary: "Reading Kim et al., results table",
    narrative: "One window: the Kim et al. paper, stopped at the results table. Your first stretch after the break.",
    then: "At 13:33 you opened VS Code, Word and Slack around it.",
    leftHere: [],
  },
  {
    start: "13:33",
    end: NOW,
    summary: "Wiring the ping button, paper and thread beside it",
    narrative:
      "Four windows: App.tsx in VS Code, the Kim et al. paper, the report draft and Minji's Slack thread. The edits are in App.tsx.",
    then: "",
    leftHere: [
      { text: "Reply to Minji: the draft is typed but not sent", meta: "Slack · 13:44", kind: "message" },
      { text: "Dentist at 16:00, you dismissed the reminder at 10:12", meta: "Calendar · 10:12", kind: "notification" },
      { text: "Office hours moved to Friday, mail dismissed unread", meta: "Mail · 13:21", kind: "notification" },
      { text: "Report intro ends mid-sentence after the second citation", meta: "Word · 11:20", kind: "document" },
    ],
  },
];

export const STATS = [
  { value: "2 h 44", label: "focused" },
  { value: "9", label: "window changes" },
  { value: "45 min", label: "longest stretch" },
  { value: "45 min", label: "drift" },
];

export const SUGGESTIONS_NOW = ["What did I leave unfinished?", "What was I doing before the meeting?", "Where did I see that chart?"];
export const SUGGESTIONS_PAST = ["Why did I open YouTube?", "What happened after this?", "How long was I here?"];

// Canned answer until /api/ask exists.
export const CANNED_ANSWER = {
  text: "Two things. The report intro stops mid-sentence after the second citation, last touched at 11:20. And a Slack reply to Minji has been sitting typed but unsent since 13:44, in the window next to your editor.",
  cites: [
    { label: "Go to 11:20", stretch: 3 },
    { label: "Go to 13:44", stretch: 6 },
  ],
};

const openDuring = (a: string, b: string) =>
  LANE_IDS.filter((id) => WINDOWS.some((w) => w.id === id && toMin(w.start) < toMin(b) && toMin(w.end) > toMin(a)));

// Korean text for the same day; window names stay as they appear on screen.
const KO: Record<string, string> = {
  "Drafting the report intro": "보고서 서론 초안 작성",
  "You were 14 minutes into drafting the report intro. One window, nothing else open; the cleanest stretch of the day.": "보고서 서론 초안을 쓴 지 14분째였습니다. 창 하나만 열려 있던, 하루 중 가장 집중된 구간이었습니다.",
  "At 9:30 you opened Slack next to it.": "9:30에 옆에 Slack을 열었습니다.",
  "Intro draft with Minji's thread beside it": "서론 초안과 민지의 스레드",
  "The intro draft and Minji's Slack thread were side by side. The thread was about the deadline; the draft grew two paragraphs.": "서론 초안과 민지의 Slack 스레드가 나란히 있었습니다. 스레드는 마감에 관한 것이었고, 초안은 두 문단 늘었습니다.",
  "At 9:52 YouTube joined them, probably from a link in the thread.": "9:52에 YouTube가 추가되었습니다. 스레드의 링크였을 가능성이 큽니다.",
  "YouTube joined and the intro stopped moving": "YouTube가 열리고 서론이 멈춤",
  "Word, Slack and YouTube were all open together. The intro did not change for 45 minutes; the YouTube sidebar did.": "Word, Slack, YouTube가 함께 열려 있었습니다. 서론은 45분 동안 바뀌지 않았고, YouTube 사이드바만 바뀌었습니다.",
  "At 10:37 you closed YouTube and opened the Kim et al. paper in its place.": "10:37에 YouTube를 닫고 그 자리에 Kim et al. 논문을 열었습니다.",
  "Adding citations from Kim et al. to the intro": "Kim et al. 인용을 서론에 추가",
  "Word, Slack and the Kim et al. paper were open together. You were pulling citations from the paper into the intro.": "Word, Slack, Kim et al. 논문이 함께 열려 있었습니다. 논문의 인용을 서론으로 옮기고 있었습니다.",
  "At 11:20 the team sync started and the intro was left mid-sentence.": "11:20에 팀 회의가 시작되어 서론이 문장 중간에서 멈췄습니다.",
  "Report intro ends mid-sentence after the second citation": "보고서 서론이 두 번째 인용 뒤 문장 중간에서 끝남",
  "Team sync, Slack alongside": "팀 회의, 옆에 Slack",
  "Meet and Slack were open together for the team sync. Messages kept arriving in the thread during the call.": "팀 회의 동안 Meet와 Slack이 함께 열려 있었습니다. 통화 중에도 스레드에 메시지가 계속 왔습니다.",
  "At 12:00 the call ended and you were away until 13:05.": "12:00에 통화가 끝났고 13:05까지 자리를 비웠습니다.",
  "Reading Kim et al., results table": "Kim et al. 결과 표 읽기",
  "One window: the Kim et al. paper, stopped at the results table. Your first stretch after the break.": "창 하나, Kim et al. 논문의 결과 표에서 멈춰 있었습니다. 휴식 후 첫 구간입니다.",
  "At 13:33 you opened VS Code, Word and Slack around it.": "13:33에 그 주위로 VS Code, Word, Slack을 열었습니다.",
  "Wiring the ping button, paper and thread beside it": "ping 버튼 연결, 옆에 논문과 스레드",
  "Four windows: App.tsx in VS Code, the Kim et al. paper, the report draft and Minji's Slack thread. The edits are in App.tsx.": "창 네 개: VS Code의 App.tsx, Kim et al. 논문, 보고서 초안, 민지의 Slack 스레드. 편집은 App.tsx에서 이루어졌습니다.",
  "Reply to Minji: the draft is typed but not sent": "민지에게 답장: 입력했지만 보내지 않음",
  "Dentist at 16:00, you dismissed the reminder at 10:12": "16:00 치과 예약, 10:12에 알림을 닫음",
  "Office hours moved to Friday, mail dismissed unread": "면담 시간이 금요일로 변경, 메일을 읽지 않고 닫음",
  "Dentist, 16:00 today": "오늘 16:00 치과",
  "Minji: did you send the intro draft yet?": "민지: 서론 초안 보냈어?",
  "Prof. Han: office hours moved to Friday": "한 교수님: 면담 시간이 금요일로 변경",
  focused: "집중", "window changes": "창 변경", "longest stretch": "가장 긴 구간", drift: "딴짓",
};
const ko = (s: string, lang: "en" | "ko") => (lang === "ko" ? KO[s] ?? s : s);

export function sampleDay(lang: "en" | "ko" = "en"): Day {
  return {
    source: "sample",
    recording: true,
    now: NOW,
    nowMin: toMin(NOW),
    dayStart: DAY_START,
    dayEnd: DAY_END,
    windows: WINDOWS.map((w) => ({ ...w, category: APP_CATEGORY[w.app] })),
    laneIds: LANE_IDS,
    stretches: STRETCHES.map((s) => ({
      ...s,
      summary: ko(s.summary, lang), narrative: ko(s.narrative, lang), then: ko(s.then, lang),
      leftHere: s.leftHere.map((l) => ({ ...l, text: ko(l.text, lang) })),
      startMin: toMin(s.start), endMin: toMin(s.end), windowIds: openDuring(s.start, s.end),
    })),
    notifications: NOTIFICATIONS.map((n) => ({ ...n, text: ko(n.text, lang) })),
    stats: STATS.map((x) => ({ ...x, label: ko(x.label, lang) })),
    liveBoxes: [],
    liveWindows: null,
  };
}

export type { OpenLoop };
