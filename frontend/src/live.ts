import { useEffect, useRef, useState } from "react";
import { api, getToken } from "./api";
import { Recorder, deviceId, type CaptureStatus } from "./capture";
import type { Box, Category, Day, Notification, OpenLoop, Stretch, Win } from "./model";
import { fmtDuration, fromMin, hhmm, minuteOf, toMin } from "./model";
import { t, useLang } from "./i18n";

export type Analysis = { activity?: string; windows?: { id: string; app: string; what: string; category?: Category; summary?: string | null; bbox?: number[] | null }[] };
/** What the model saw in one frame, as list rows. */
export const seenOf = (a: Analysis | null | undefined, now: string): Win[] =>
  (a?.windows ?? []).map((w) => ({ id: w.id, app: w.app, what: w.what, category: w.category ?? "other", start: now, end: now, summary: w.summary ?? undefined }));
export const boxesOf = (a: Analysis | null | undefined): Box[] =>
  (a?.windows ?? [])
    .filter((w) => Array.isArray(w.bbox) && w.bbox.length === 4)
    .map((w) => ({ id: w.id, app: w.app, what: w.what, summary: w.summary ?? undefined, bbox: w.bbox as [number, number, number, number] }));

type ApiTimeline = {
  now: number;
  windows: { id: string; app: string; what: string; category: Category; start: number; end: number | null; lastSeen: number; summary: string | null; visible?: [number, number][] }[];
  stretches: { id: number; start: number; end: number | null; windowIds: string[]; summary: string; narrative?: string; leftHere?: { text: string; where: string }[]; questions?: string[] }[];
  notifications: { id: number; app: string; text: string; time: number; dismissed: boolean }[];
  latest: { id: number; ts: number; analysis: Analysis } | null;
  latestImage: { id: number; ts: number } | null;
  frames: { id: number; ts: number }[];
};

export function fromApi(tl: ApiTimeline): Day | null {
  if (tl.frames.length === 0 && tl.windows.length === 0) return null;
  // If no frame has arrived for a while, recording has stopped: freeze "now" at the last frame so
  // open windows and the current stretch stop growing.
  const lastTs = Math.max(0, ...tl.frames.map((f) => f.ts), tl.latest?.ts ?? 0);
  const recording = lastTs > 0 && tl.now - lastTs < 15;
  const nowTs = recording || lastTs === 0 ? tl.now : lastTs;
  const now = hhmm(nowTs);
  // The timeline starts when recording started and runs to now, with a little room on the right.
  // The timeline starts at the first analyzed window, not the first uploaded frame, so the seconds
  // before the model's first result do not show as an empty strip.
  const analyzedStarts = [...tl.windows.map((w) => w.start), ...tl.stretches.map((s) => s.start)];
  const first = analyzedStarts.length ? Math.min(nowTs, ...analyzedStarts) : Math.min(nowTs, ...tl.frames.map((f) => f.ts));
  const dayStart = hhmm(first);
  const span = Math.max(1, toMin(now) - toMin(dayStart));
  const dayEnd = fromMin(Math.min(toMin(now) + Math.max(1, Math.round(span * 0.05)), 24 * 60 - 1));

  const windows: Win[] = tl.windows.map((w) => ({
    id: w.id, app: w.app, what: w.what, category: w.category,
    start: hhmm(w.start), end: w.end ? hhmm(w.end) : now, summary: w.summary ?? undefined,
    visible: (w.visible ?? []).map(([a, b]) => [minuteOf(a), Math.max(minuteOf(b), minuteOf(a) + 0.05)] as [number, number]),
  }));
  const laneIds = [...new Set(windows.map((w) => w.id))];

  const stretches: Stretch[] = tl.stretches.map((s, i) => {
    const next = tl.stretches[i + 1];
    const leftHere: OpenLoop[] = (s.leftHere ?? []).map((l) => ({ text: l.text, meta: l.where, kind: "document" }));
    // notifications belong to the stretch they appeared in, so they stay visible when scrubbing back
    const endTs = s.end ?? Number.POSITIVE_INFINITY;
    for (const n of tl.notifications) {
      if (n.time >= s.start && n.time < endTs) {
        leftHere.push({
          text: n.dismissed ? `${n.text} (${t("dismissed")})` : n.text,
          meta: `${n.app} · ${hhmm(n.time)}`,
          kind: "notification",
        });
      }
    }
    return {
      start: hhmm(s.start),
      end: s.end ? hhmm(s.end) : now,
      startMin: minuteOf(s.start),
      endMin: s.end ? minuteOf(s.end) : minuteOf(nowTs),
      summary: s.summary || t("working"),
      narrative: s.narrative || s.summary || t("notAnalyzed"),
      then: next ? t("setChanged", { t: hhmm(next.start) }) : "",
      leftHere,
      windowIds: s.windowIds,
      questions: s.questions ?? [],
    };
  });
  if (stretches.length === 0) {
    stretches.push({ start: dayStart, end: now, startMin: toMin(dayStart), endMin: minuteOf(nowTs), summary: t("recordingStarted"), narrative: t("framesAnalyzing"), then: "", leftHere: [], windowIds: [] });
  }

  const notifications: Notification[] = tl.notifications.map((n) => ({ time: hhmm(n.time), app: n.app, text: n.text, dismissed: n.dismissed }));
  const recorded = tl.frames.length ? Math.max(1, Math.round((nowTs - tl.frames[0].ts) / 60)) : 0;
  const longest = Math.max(0, ...stretches.map((s) => toMin(s.end) - toMin(s.start)));
  const stats = [
    { value: fmtDuration(recorded), label: t("recorded") },
    { value: String(Math.max(0, tl.stretches.length - 1)), label: t("windowChanges") },
    { value: fmtDuration(longest), label: t("longestStretch") },
    { value: String(tl.notifications.length), label: t("notifications") },
  ];
  const token = getToken() ?? "";
  // Closest saved frame to a moment, like scrubbing a video.
  const frameAt = (min: number) => {
    let best: { id: number; ts: number } | null = null;
    let bestD = Infinity;
    for (const f of tl.frames) {
      const d = Math.abs(minuteOf(f.ts) - min);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best ?? tl.latestImage;
  };
  const imageAt = (min: number) => {
    const f = frameAt(min);
    return f ? `/api/frames/${f.id}/image?token=${encodeURIComponent(token)}&device=${encodeURIComponent(deviceId())}&v=${f.id}` : null;
  };
  const frameIdAt = (min: number) => frameAt(min)?.id ?? null;
  return { source: "live", recording, now, nowMin: minuteOf(nowTs), dayStart, dayEnd, windows, laneIds, stretches, notifications, stats, imageAt, frameIdAt, liveBoxes: boxesOf(tl.latest?.analysis), liveWindows: tl.latest ? seenOf(tl.latest.analysis, now) : null };
}

export function useTimeline(pollMs: number): { day: Day | null; error: string | null; refresh: () => void } {
  const lang = useLang();
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const t = await api<ApiTimeline>(`/api/timeline?device=${encodeURIComponent(deviceId())}`);
        if (!stop) {
          setDay(fromApi(t));
          setError(null);
        }
      } catch (e) {
        if (!stop) setError(String(e));
      }
    }
    void load();
    const id = window.setInterval(() => void load(), pollMs);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [pollMs, tick, lang]);
  return { day, error, refresh: () => setTick((n) => n + 1) };
}

export function useRecorder(intervalMs: number, onUploaded?: () => void) {
  const [status, setStatus] = useState<CaptureStatus>({ state: "idle" });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const rec = useRef<Recorder | null>(null);
  if (!rec.current) {
    rec.current = new Recorder(intervalMs, setStatus);
    rec.current.onStream = setStream;
  }
  rec.current.onUploaded = onUploaded ?? null;
  useEffect(() => () => rec.current?.stop(), []);
  return { status, stream, start: () => rec.current!.start(), stop: () => rec.current!.stop() };
}

export function useFrameAnalysis(frameId: number | null): { boxes: Box[]; windows: Win[] | null } {
  const [state, setState] = useState<{ boxes: Box[]; windows: Win[] | null }>({ boxes: [], windows: null });
  useEffect(() => {
    if (frameId === null) return setState({ boxes: [], windows: null });
    let stop = false;
    api<{ analysis: Analysis | null }>(`/api/frames/${frameId}/analysis?device=${encodeURIComponent(deviceId())}`)
      .then((r) => !stop && setState({ boxes: boxesOf(r.analysis), windows: r.analysis ? seenOf(r.analysis, "") : null }))
      .catch(() => !stop && setState({ boxes: [], windows: null }));
    return () => {
      stop = true;
    };
  }, [frameId]);
  return state;
}
