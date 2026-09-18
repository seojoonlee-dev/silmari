// Sample day used until the backend produces real segments.

export type Category = "work" | "comms" | "leisure" | "meet";
export type App = "Word" | "Chrome" | "VS Code" | "Slack" | "Meet" | "YouTube";

export const CATEGORY_COLOR: Record<Category, string> = {
  work: "#2F6F8F",
  comms: "#C98A2B",
  leisure: "#C4564E",
  meet: "#7A5AB8",
};

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

export type OpenLoop = { text: string; meta: string; kind: "message" | "document" | "notification" };

// A stretch is a period where the set of open windows did not change.
export type Stretch = {
  start: string;
  end: string;
  summary: string;
  narrative: string;
  then: string;
  leftHere: OpenLoop[];
};

export const STRETCHES: Stretch[] = [
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

export const INTENT = { text: "Finish the report intro before 15:00", setAt: "09:00", timeOnIt: "1 h 22 min today" };

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

// ---- time helpers ----
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const midpoint = (s: Stretch) => fromMin(Math.floor((toMin(s.start) + toMin(s.end)) / 2));
export const openAt = (t: string) => WINDOWS.filter((w) => toMin(w.start) <= toMin(t) && toMin(t) < toMin(w.end));
export const openDuring = (a: string, b: string) =>
  LANE_IDS.filter((id) => WINDOWS.some((w) => w.id === id && toMin(w.start) < toMin(b) && toMin(w.end) > toMin(a)));
