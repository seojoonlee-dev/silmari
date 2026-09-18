import { useEffect, useRef, useState } from "react";
import { api, getToken } from "./api";
import { Recorder, deviceId, type CaptureStatus } from "./capture";
import type { Box, Category, Day, Notification, OpenLoop, Stretch, Win } from "./model";
import { fmtDuration, fromMin, hhmm, minuteOf, toMin } from "./model";

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
  stretches: { id: number; start: number; end: number | null; windowIds: string[]; summary: string; narrative?: string; leftHere?: { text: string; where: string }[] }[];
  notifications: { id: number; app: string; text: string; time: number; dismissed: boolean }[];
  latest: { id: number; ts: number; analysis: Analysis } | null;
  latestImage: { id: number; ts: number } | null;
  frames: { id: number; ts: number }[];
};

export function fromApi(t: ApiTimeline): Day | null {
  if (t.frames.length === 0 && t.windows.length === 0) return null;
  // If no frame has arrived for a while, recording has stopped: freeze "now" at the last frame so
  // open windows and the current stretch stop growing.
  const lastTs = Math.max(0, ...t.frames.map((f) => f.ts), t.latest?.ts ?? 0);
  const recording = lastTs > 0 && t.now - lastTs < 15;
  const nowTs = recording || lastTs === 0 ? t.now : lastTs;
  const now = hhmm(nowTs);
  // The timeline starts when recording started and runs to now, with a little room on the right.
  const first = Math.min(nowTs, ...t.windows.map((w) => w.start), ...t.frames.map((f) => f.ts));
  const dayStart = hhmm(first);
  const span = Math.max(1, toMin(now) - toMin(dayStart));
  const dayEnd = fromMin(Math.min(toMin(now) + Math.max(1, Math.round(span * 0.05)), 24 * 60 - 1));

  const windows: Win[] = t.windows.map((w) => ({
    id: w.id, app: w.app, what: w.what, category: w.category,
    start: hhmm(w.start), end: w.end ? hhmm(w.end) : now, summary: w.summary ?? undefined,
    visible: (w.visible ?? []).map(([a, b]) => [minuteOf(a), Math.max(minuteOf(b), minuteOf(a) + 0.05)] as [number, number]),
  }));
  const laneIds = [...new Set(windows.map((w) => w.id))];

  const stretches: Stretch[] = t.stretches.map((s, i) => {
    const next = t.stretches[i + 1];
    const leftHere: OpenLoop[] = (s.leftHere ?? []).map((l) => ({ text: l.text, meta: l.where, kind: "document" }));
    if (!s.end) {
      for (const n of t.notifications) {
        leftHere.push({
          text: n.dismissed ? `${n.text} (dismissed)` : n.text,
          meta: `${n.app} · ${hhmm(n.time)}`,
          kind: "notification",
        });
      }
    }
    return {
      start: hhmm(s.start),
      end: s.end ? hhmm(s.end) : now,
      summary: s.summary || "Working",
      narrative: s.narrative || s.summary || "Nothing analyzed yet for this stretch.",
      then: next ? `At ${hhmm(next.start)} the set of windows changed.` : "",
      leftHere,
      windowIds: s.windowIds,
    };
  });
  if (stretches.length === 0) {
    stretches.push({ start: dayStart, end: now, summary: "Recording started", narrative: "Frames are being analyzed. The first stretch appears within a few seconds.", then: "", leftHere: [], windowIds: [] });
  }

  const notifications: Notification[] = t.notifications.map((n) => ({ time: hhmm(n.time), app: n.app, text: n.text, dismissed: n.dismissed }));
  const recorded = t.frames.length ? Math.max(1, Math.round((nowTs - t.frames[0].ts) / 60)) : 0;
  const longest = Math.max(0, ...stretches.map((s) => toMin(s.end) - toMin(s.start)));
  const stats = [
    { value: fmtDuration(recorded), label: "recorded" },
    { value: String(Math.max(0, t.stretches.length - 1)), label: "window changes" },
    { value: fmtDuration(longest), label: "longest stretch" },
    { value: String(t.notifications.length), label: "notifications" },
  ];
  const token = getToken() ?? "";
  // Closest saved frame to a moment, like scrubbing a video.
  const frameAt = (min: number) => {
    let best: { id: number; ts: number } | null = null;
    let bestD = Infinity;
    for (const f of t.frames) {
      const d = Math.abs(minuteOf(f.ts) - min);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best ?? t.latestImage;
  };
  const imageAt = (min: number) => {
    const f = frameAt(min);
    return f ? `/api/frames/${f.id}/image?token=${encodeURIComponent(token)}&v=${f.id}` : null;
  };
  const frameIdAt = (min: number) => frameAt(min)?.id ?? null;
  return { source: "live", recording, now, nowMin: minuteOf(nowTs), dayStart, dayEnd, windows, laneIds, stretches, notifications, stats, imageAt, frameIdAt, liveBoxes: boxesOf(t.latest?.analysis), liveWindows: t.latest ? seenOf(t.latest.analysis, now) : null };
}

export function useTimeline(pollMs: number): { day: Day | null; error: string | null; refresh: () => void } {
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
  }, [pollMs, tick]);
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
    api<{ analysis: Analysis | null }>(`/api/frames/${frameId}/analysis`)
      .then((r) => !stop && setState({ boxes: boxesOf(r.analysis), windows: r.analysis ? seenOf(r.analysis, "") : null }))
      .catch(() => !stop && setState({ boxes: [], windows: null }));
    return () => {
      stop = true;
    };
  }, [frameId]);
  return state;
}
