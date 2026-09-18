// The shape every screen component renders from. Built either from the sample day or from
// the backend's /api/timeline response. Times are "HH:MM" local strings.

export type Category = "work" | "comms" | "leisure" | "meet" | "other";

export const CATEGORY_COLOR: Record<Category, string> = {
  work: "#2F6F8F",
  comms: "#C98A2B",
  leisure: "#C4564E",
  meet: "#7A5AB8",
  other: "#7B8390",
};

export type Win = {
  id: string; app: string; what: string; category: Category;
  /** first sighting to close (or now) */
  start: string; end: string;
  /** spans (fractional minutes) in which the window was actually on screen; the lanes draw these */
  visible?: [number, number][];
  summary?: string;
};
/** A window's rectangle in a frame, as fractions of the image (x1, y1, x2, y2). */
export type Box = { id: string; app: string; what: string; summary?: string; bbox: [number, number, number, number] };

// One color per window identity, in order of first appearance.
export const WINDOW_PALETTE = ["#2F6F8F", "#C98A2B", "#7A5AB8", "#C4564E", "#2E8B6E", "#B5527F", "#5B6FD6", "#8A7A2E", "#3E8FA8", "#A0643C"];
export const windowColor = (day: Day, id: string) => WINDOW_PALETTE[Math.max(0, day.laneIds.indexOf(id)) % WINDOW_PALETTE.length];
export type OpenLoop = { text: string; meta: string; kind: "message" | "document" | "notification" };
export type Stretch = { start: string; end: string; summary: string; narrative: string; then: string; leftHere: OpenLoop[]; windowIds: string[] };
export type Notification = { time: string; app: string; text: string; dismissed: boolean };

export type Day = {
  source: "sample" | "live" | "empty";
  /** live days only: frames are still arriving */
  recording: boolean;
  now: string;
  /** now in fractional minutes of the day; "now" as HH:MM is only for display */
  nowMin: number;
  dayStart: string;
  dayEnd: string;
  windows: Win[];
  laneIds: string[];
  stretches: Stretch[];
  notifications: Notification[];
  stats: { value: string; label: string }[];
  /** image of the saved frame closest to a time (fractional minutes of the day), if any */
  imageAt?: (min: number) => string | null;
  /** id of that frame, for fetching its analysis */
  frameIdAt?: (min: number) => number | null;
  /** window boxes from the latest analysis, for the live preview */
  liveBoxes: Box[];
  /** windows actually visible in the latest analyzed frame (the tracker's open set can be wider) */
  liveWindows: Win[] | null;
};

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** fractional minutes of the local day */
export const minuteOf = (epochS: number) => {
  const d = new Date(epochS * 1000);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};
export const hhmm = (epochS: number) => {
  const d = new Date(epochS * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const midpoint = (s: Stretch) => fromMin(Math.floor((toMin(s.start) + toMin(s.end)) / 2));

// Windows the tracker considers open at t. A window still open ends at "now", so the end is inclusive there.
export const openAt = (day: Day, t: string) =>
  day.windows.filter((w) => toMin(w.start) <= toMin(t) && (toMin(t) < toMin(w.end) || (w.end === day.now && t === day.now)));
export const openDuring = (day: Day, a: string, b: string) =>
  day.laneIds.filter((id) => day.windows.some((w) => w.id === id && toMin(w.start) < toMin(b) && toMin(w.end) > toMin(a)));
export const laneLabel = (day: Day, id: string) => {
  const w = day.windows.find((x) => x.id === id);
  if (!w) return id;
  const sameApp = day.laneIds.filter((l) => day.windows.find((x) => x.id === l)?.app === w.app).length > 1;
  return sameApp ? `${w.app} · ${w.what.split(" · ")[0]}` : w.app;
};
export const fmtDuration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min} min`);
