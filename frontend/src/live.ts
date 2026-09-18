import { useEffect, useRef, useState } from "react";
import { api, getToken } from "./api";
import { Recorder, deviceId, type CaptureStatus } from "./capture";
import type { Category, Day, Notification, OpenLoop, Stretch, Win } from "./model";
import { fmtDuration, fromMin, hhmm, toMin } from "./model";

type ApiTimeline = {
  now: number;
  windows: { id: string; app: string; what: string; category: Category; start: number; end: number | null; lastSeen: number; summary: string | null }[];
  stretches: { id: number; start: number; end: number | null; windowIds: string[]; summary: string }[];
  notifications: { id: number; app: string; text: string; time: number; dismissed: boolean }[];
  latest: { id: number; ts: number; analysis: { activity?: string; windows?: { id: string }[] } } | null;
  latestImage: { id: number; ts: number } | null;
  frames: { id: number; ts: number }[];
};

export function fromApi(t: ApiTimeline): Day | null {
  if (t.frames.length === 0 && t.windows.length === 0) return null;
  const now = hhmm(t.now);
  const first = Math.min(t.now, ...t.windows.map((w) => w.start), ...t.frames.map((f) => f.ts));
  const dayStart = fromMin(Math.floor(toMin(hhmm(first)) / 60) * 60);
  const endMin = Math.max(toMin(dayStart) + 60, Math.ceil((toMin(now) + 1) / 60) * 60);
  const dayEnd = fromMin(Math.min(endMin, 24 * 60 - 1));

  const windows: Win[] = t.windows.map((w) => ({
    id: w.id, app: w.app, what: w.what, category: w.category,
    start: hhmm(w.start), end: w.end ? hhmm(w.end) : now, summary: w.summary ?? undefined,
  }));
  const laneIds = [...new Set(windows.map((w) => w.id))];

  const stretches: Stretch[] = t.stretches.map((s, i) => {
    const next = t.stretches[i + 1];
    const leftHere: OpenLoop[] = [];
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
      narrative: s.summary || "Nothing analyzed yet for this stretch.",
      then: next ? `At ${hhmm(next.start)} the set of windows changed.` : "",
      leftHere,
      windowIds: s.windowIds,
    };
  });
  if (stretches.length === 0) {
    stretches.push({ start: dayStart, end: now, summary: "Recording started", narrative: "Frames are being analyzed. The first stretch appears within a few seconds.", then: "", leftHere: [], windowIds: [] });
  }

  const notifications: Notification[] = t.notifications.map((n) => ({ time: hhmm(n.time), app: n.app, text: n.text, dismissed: n.dismissed }));
  const recorded = t.frames.length ? Math.max(1, Math.round((t.now - t.frames[0].ts) / 60)) : 0;
  const longest = Math.max(0, ...stretches.map((s) => toMin(s.end) - toMin(s.start)));
  const stats = [
    { value: fmtDuration(recorded), label: "recorded" },
    { value: String(Math.max(0, t.stretches.length - 1)), label: "window changes" },
    { value: fmtDuration(longest), label: "longest stretch" },
    { value: String(t.notifications.length), label: "notifications" },
  ];
  const token = getToken() ?? "";
  const imageAt = (time: string) => {
    const target = toMin(time);
    let best: { id: number; ts: number } | null = null;
    for (const f of t.frames) if (toMin(hhmm(f.ts)) <= target) best = f;
    if (!best && time === now) best = t.latestImage;
    return best ? `/api/frames/${best.id}/image?token=${encodeURIComponent(token)}&v=${best.id}` : null;
  };
  return { source: "live", now, dayStart, dayEnd, windows, laneIds, stretches, notifications, stats, intent: { text: "Set an intent for today", timeOnIt: "" }, imageAt };
}

export function useTimeline(pollMs: number): { day: Day | null; error: string | null } {
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [pollMs]);
  return { day, error };
}

export function useRecorder(intervalMs: number) {
  const [status, setStatus] = useState<CaptureStatus>({ state: "idle" });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const rec = useRef<Recorder | null>(null);
  if (!rec.current) {
    rec.current = new Recorder(intervalMs, setStatus);
    rec.current.onStream = setStream;
  }
  useEffect(() => () => rec.current?.stop(), []);
  return { status, stream, start: () => rec.current!.start(), stop: () => rec.current!.stop() };
}
