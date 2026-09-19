// Screen capture in the browser: getDisplayMedia -> canvas -> JPEG -> POST /api/frames.
// Every frame is sent with its image. A difference score against the previous frame goes along
// so the server can analyze big changes (workspace switches) right away.

import { getToken } from "./api";

export type CaptureStatus =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "recording"; frames: number; skipped: number; lastSentAt: number | null }
  | { state: "error"; message: string };

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.65;

export function deviceId(): string {
  const KEY = "silmari.device";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = "d-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "d-volatile";
  }
}

export class Recorder {
  private stream: MediaStream | null = null;
  private video = document.createElement("video");
  private canvas = document.createElement("canvas");
  private tiny = document.createElement("canvas");
  private timer: number | null = null;
  private lastThumb: Uint8ClampedArray | null = null;
  private frames = 0;
  private skipped = 0;
  private lastSentAt: number | null = null;
  private busy = false;
  private intervalMs: number;
  private onStatus: (s: CaptureStatus) => void;
  onStream: ((s: MediaStream | null) => void) | null = null;
  /** called after every successful upload, so the UI can refresh right away */
  onUploaded: (() => void) | null = null;

  constructor(intervalMs: number, onStatus: (s: CaptureStatus) => void) {
    this.intervalMs = intervalMs;
    this.onStatus = onStatus;
    this.tiny.width = 16;
    this.tiny.height = 16;
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get active() {
    return this.stream !== null;
  }

  get mediaStream() {
    return this.stream;
  }

  async start() {
    this.onStatus({ state: "starting" });
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
        // @ts-expect-error: newer Chrome hints, harmless elsewhere
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      });
    } catch (e) {
      this.onStatus({ state: "error", message: "Screen sharing was not allowed. " + String(e) });
      this.stream = null;
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.onStream?.(this.stream);
    this.stream.getVideoTracks()[0].addEventListener("ended", () => this.stop());
    this.frames = 0;
    this.skipped = 0;
    this.lastThumb = null;
    this.emit();
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.onStream?.(null);
    this.onStatus({ state: "idle" });
  }

  private emit() {
    this.onStatus({ state: "recording", frames: this.frames, skipped: this.skipped, lastSentAt: this.lastSentAt });
  }

  private async tick() {
    if (!this.stream || this.busy || this.video.videoWidth === 0) return;
    this.busy = true;
    try {
      const scale = Math.min(1, MAX_WIDTH / this.video.videoWidth);
      this.canvas.width = Math.round(this.video.videoWidth * scale);
      this.canvas.height = Math.round(this.video.videoHeight * scale);
      const ctx = this.canvas.getContext("2d")!;
      ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

      const tctx = this.tiny.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(this.canvas, 0, 0, 16, 16);
      const px = tctx.getImageData(0, 0, 16, 16).data;
      const thumb = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) thumb[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
      // Whole-frame difference, plus the strongest 4x4-block difference: a toast in one corner
      // barely moves the average but lights up one block, and the server analyzes it right away.
      // Also how many of the 16 blocks changed strongly: a workspace switch changes nearly all of
      // them even when the two workspaces look alike, while a busy terminal only changes its own.
      let diff = 255, local = 255, spread = 16;
      if (this.lastThumb) {
        let sum = 0;
        const blocks = new Array(16).fill(0);
        for (let i = 0; i < 256; i++) {
          const d = Math.abs(thumb[i] - this.lastThumb[i]);
          sum += d;
          blocks[Math.floor(i / 64) * 4 + Math.floor((i % 16) / 4)] += d;
        }
        diff = sum / 256;
        local = Math.max(...blocks) / 16;
        spread = blocks.filter((b) => b / 16 >= 25).length;
      }
      this.lastThumb = thumb;
      const unchanged = false;

      const form = new FormData();
      form.set("device", deviceId());
      form.set("ts", String(Date.now() / 1000));
      form.set("unchanged", String(unchanged));
      form.set("diff", diff.toFixed(1));
      form.set("local", local.toFixed(1));
      form.set("spread", String(spread));
      form.set("width", String(this.canvas.width));
      form.set("height", String(this.canvas.height));
      if (!unchanged) {
        const blob = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
        if (!blob) return;
        form.set("image", blob, "frame.jpg");
      }
      const res = await fetch("/api/frames", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: form });
      if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
      if (unchanged) this.skipped++;
      else this.frames++;
      this.lastSentAt = Date.now();
      this.emit();
      this.onUploaded?.();
    } catch (e) {
      this.onStatus({ state: "error", message: String(e) });
    } finally {
      this.busy = false;
    }
  }
}
