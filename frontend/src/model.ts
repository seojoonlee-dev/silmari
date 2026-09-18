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

export type Win = { id: string; app: string; what: string; category: Category; start: string; end: string; summary?: string };
export type OpenLoop = { text: string; meta: string; kind: "message" | "document" | "notification" };
export type Stretch = { start: string; end: string; summary: string; narrative: string; then: string; leftHere: OpenLoop[]; windowIds: string[] };
export type Notification = { time: string; app: string; text: string; dismissed: boolean };

export type Day = {
  source: "sample" | "live";
  now: string;
  dayStart: string;
  dayEnd: string;
  windows: Win[];
  laneIds: string[];
  stretches: Stretch[];
  notifications: Notification[];
  stats: { value: string; label: string }[];
  /** image for the frame at or before a time, if the day has real frames */
  imageAt?: (t: string) => string | null;
};

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const hhmm = (epochS: number) => {
  const d = new Date(epochS * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const midpoint = (s: Stretch) => fromMin(Math.floor((toMin(s.start) + toMin(s.end)) / 2));

export const openAt = (day: Day, t: string) => day.windows.filter((w) => toMin(w.start) <= toMin(t) && toMin(t) < toMin(w.end));
export const openDuring = (day: Day, a: string, b: string) =>
  day.laneIds.filter((id) => day.windows.some((w) => w.id === id && toMin(w.start) < toMin(b) && toMin(w.end) > toMin(a)));
export const laneLabel = (day: Day, id: string) => {
  const w = day.windows.find((x) => x.id === id);
  if (!w) return id;
  const sameApp = day.laneIds.filter((l) => day.windows.find((x) => x.id === l)?.app === w.app).length > 1;
  return sameApp ? `${w.app} · ${w.what.split(" · ")[0]}` : w.app;
};
export const fmtDuration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min} min`);
