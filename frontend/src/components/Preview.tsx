import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { App } from "../data/sample";
import type { Box, Win } from "../model";
import { useT } from "../i18n";

const KNOWN_APPS: App[] = ["Word", "Chrome", "VS Code", "Slack", "Meet", "YouTube"];
const asApp = (a: string): App => (KNOWN_APPS.includes(a as App) ? (a as App) : "Chrome");

const BAR: Record<App, [string, string]> = {
  Word: ["#2B579A", "#FFFFFF"],
  Chrome: ["#E9EBF0", "#5C6470"],
  "VS Code": ["#16161E", "#9AA0B4"],
  Slack: ["#4A154B", "#FFFFFF"],
  Meet: ["#202124", "#E8EAED"],
  YouTube: ["#0F0F0F", "#E8E8E8"],
};
const BG: Record<App, string> = { Word: "#fff", Chrome: "#fff", "VS Code": "#1A1B26", Slack: "#fff", Meet: "#202124", YouTube: "#0F0F0F" };

const Lines = ({ ws, color, h = 4 }: { ws: number[]; color: string; h?: number }) => (
  <>
    {ws.map((w, i) => (
      <div key={i} style={{ height: h, width: `${w}%`, borderRadius: 2, background: color }} />
    ))}
  </>
);

function Body({ app }: { app: App }) {
  switch (app) {
    case "Word":
      return (
        <div className="tile-body" style={{ padding: "10% 12%" }}>
          <div style={{ height: 6, width: "45%", background: "#1B1F26", borderRadius: 2, marginBottom: 3 }} />
          <Lines ws={[92, 96, 88, 94, 40]} color="#B8BDC7" />
        </div>
      );
    case "Chrome":
      return (
        <div className="tile-body" style={{ padding: "8% 10%" }}>
          <div style={{ height: 6, width: "55%", background: "#1B1F26", borderRadius: 2, marginBottom: 3 }} />
          <Lines ws={[95, 90, 60]} color="#B8BDC7" />
          <div className="tile-table">
            <div /><div /><div /><div />
          </div>
          <Lines ws={[88]} color="#B8BDC7" />
        </div>
      );
    case "VS Code":
      return (
        <div style={{ display: "flex", flexGrow: 1 }}>
          <div style={{ width: "12%", background: "#1F2030" }} />
          <div className="tile-body" style={{ padding: "8%" }}>
            {[[0, 40, "#7AA2F7"], [8, 60, "#9ECE6A"], [16, 30, "#E0AF68"], [16, 70, "#C0CAF5"], [8, 20, "#BB9AF7"], [8, 50, "#7AA2F7"], [16, 65, "#C0CAF5"]].map(([ml, w, c], i) => (
              <div key={i} style={{ height: 4, marginLeft: `${ml}%`, width: `${w}%`, borderRadius: 2, background: String(c), opacity: 0.85 }} />
            ))}
          </div>
        </div>
      );
    case "Slack":
      return (
        <div style={{ display: "flex", flexGrow: 1 }}>
          <div style={{ width: "22%", background: "#3F0E40" }} />
          <div className="tile-body" style={{ padding: "8%", gap: 6 }}>
            {[["#E06C75", 40, 85], ["#61AFEF", 30, 70], ["#98C379", 35, 60]].map(([c, w, w2], i) => (
              <div key={i} style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: String(c), flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flexGrow: 1 }}>
                  <Lines ws={[Number(w), Number(w2)]} color="#C9CDD6" h={3} />
                </div>
              </div>
            ))}
            <div style={{ height: 10, border: "1px solid #C9CDD6", borderRadius: 3, marginTop: "auto" }} />
          </div>
        </div>
      );
    case "Meet":
      return (
        <div style={{ flexGrow: 1, padding: "6%", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 }}>
          {["#3C4A5E", "#4E4258", "#405447", "#5A4A3C"].map((c) => (
            <div key={c} style={{ borderRadius: 4, background: c }} />
          ))}
        </div>
      );
    case "YouTube":
      return (
        <div style={{ flexGrow: 1, padding: "6%", display: "flex", gap: 5 }}>
          <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ flexGrow: 1, borderRadius: 4, background: "#1C1F2B", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 0, height: 0, borderLeft: "10px solid #fff", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />
            </div>
            <div style={{ height: 2, background: "#333" }}><div style={{ width: "62%", height: "100%", background: "#FF0000" }} /></div>
          </div>
          <div style={{ width: "28%", display: "flex", flexDirection: "column", gap: 4 }}>
            {["#3B4252", "#4C566A", "#434C5E"].map((c) => <div key={c} style={{ height: 14, borderRadius: 2, background: c }} />)}
          </div>
        </div>
      );
  }
}

function Tile({ w }: { w: Win }) {
  const app = asApp(w.app);
  const [bar, fg] = BAR[app];
  return (
    <div className="tile" style={{ background: BG[app] }}>
      <div className="tile-bar" style={{ background: bar, color: fg }}>{w.what}</div>
      <Body app={app} />
    </div>
  );
}


type Rect = { left: number; top: number; width: number; height: number };

/** Where the letterboxed media actually paints inside its box, so overlays line up. */
function contentRect(el: HTMLElement, nw: number, nh: number): Rect | null {
  if (!nw || !nh) return null;
  const W = el.clientWidth, H = el.clientHeight;
  const scale = Math.min(W / nw, H / nh);
  const width = nw * scale, height = nh * scale;
  return { left: (W - width) / 2, top: (H - height) / 2, width, height };
}

function LiveVideo({ stream, onRect }: { stream: MediaStream; onRect: (r: Rect | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => {});
    const update = () => onRect(contentRect(v, v.videoWidth, v.videoHeight));
    update();
    v.addEventListener("loadedmetadata", update);
    v.addEventListener("resize", update);
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(v);
    return () => {
      v.srcObject = null;
      v.removeEventListener("loadedmetadata", update);
      v.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [stream, onRect]);
  return <video ref={ref} className="preview-img" muted playsInline aria-label="Live screen" />;
}

function SavedFrame({ url, alt, onRect }: { url: string; alt: string; onRect: (r: Rect | null) => void }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const update = () => ref.current && onRect(contentRect(ref.current, ref.current.naturalWidth, ref.current.naturalHeight));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [onRect]);
  return <img ref={ref} className="preview-img" src={url} alt={alt} onLoad={() => ref.current && onRect(contentRect(ref.current, ref.current.naturalWidth, ref.current.naturalHeight))} />;
}

type Props = {
  windows: Win[];
  caption: string;
  rewound: boolean;
  imageUrl?: string | null;
  stream?: MediaStream | null;
  boxes?: Box[];
  colorOf: (id: string) => string;
  /** live view while not recording: black preview, nothing listed */
  blank?: boolean;
};

export default function Preview({ windows, caption, rewound, imageUrl, stream, boxes = [], colorOf, blank = false }: Props) {
  const cols = windows.length <= 1 ? 1 : 2;
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const t = useT();
  // The summary follows the cursor, drawn above every box; flipped near the right/bottom edges.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const hoveredBox = hoverId ? boxes.find((b) => b.id === hoverId) : null;
  // Live: the screen share itself. Rewound: the saved frame from that time. Otherwise the sample tiles.
  const showVideo = !blank && !rewound && !!stream;
  const showImage = !blank && !showVideo && !!imageUrl;
  // Overlapping boxes: draw the largest first so the smallest window under the pointer takes the
  // hover. A small window over a big one is almost always the one in front.
  const area = (b: Box) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
  const ordered = [...boxes].sort((a, b) => area(b) - area(a));
  return (
    <section className="left">
      <div className="row-between">
        <div className="label">{t("screenThisDevice")}</div>
        <span className="mono muted small">{caption}</span>
      </div>
      <div
        className="preview"
        ref={previewRef}
        data-tour="preview"
        onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setCursor(null)}
      >
        {blank ? (
          <div className="preview-blank">{t("notRecording")}</div>
        ) : showVideo ? (
          <LiveVideo stream={stream!} onRect={setRect} />
        ) : showImage ? (
          <SavedFrame url={imageUrl!} alt={rewound ? "Saved frame" : "Last saved frame"} onRect={setRect} />
        ) : (
          <div className="preview-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {windows.map((w) => <Tile key={w.id} w={w} />)}
          </div>
        )}
        {(showVideo || showImage) && rect && ordered.map((b, k) => {
          const [x1, y1, x2, y2] = b.bbox;
          const on = hoverId === b.id;
          return (
            <div
              key={b.id}
              className={"box" + (on ? " on" : "")}
              style={{
                left: rect.left + x1 * rect.width, top: rect.top + y1 * rect.height,
                width: (x2 - x1) * rect.width, height: (y2 - y1) * rect.height,
                borderColor: colorOf(b.id), background: on ? colorOf(b.id) + "22" : "transparent",
                zIndex: 3 + k,
              }}
              onMouseEnter={() => setHoverId(b.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <span className="box-label" style={{ background: colorOf(b.id) }}>{b.app}</span>
            </div>
          );
        })}
        {showVideo && <span className="chip chip-ink mono preview-tag">{t("live")}</span>}
        {hoveredBox && cursor && createPortal(
          // Fixed to the viewport and portaled to the body: above everything, never clipped by the
          // preview. Always to the right of the cursor; flips upward only near the bottom of the window.
          <div
            className="box-tip"
            style={{
              position: "fixed", left: cursor.x + 14, top: cursor.y + (cursor.y > window.innerHeight - 160 ? -14 : 18),
              transform: cursor.y > window.innerHeight - 160 ? "translateY(-100%)" : undefined,
            }}
          >
            <b>{hoveredBox.app}</b> <span className="muted">{hoveredBox.what}</span>
            {hoveredBox.summary && <div className="box-tip-text">{hoveredBox.summary}</div>}
          </div>,
          document.body,
        )}
      </div>
      <div className="card" data-tour="onscreen">
        <div className="row-between">
          <div className="label">
            {rewound ? t("onScreenThen") : t("onScreen")} · {windows.length} {windows.length === 1 ? t("window") : t("windows")}
          </div>
          <span className="muted small">{t("clickForSummary")}</span>
        </div>
        <div className="win-list">
          {windows.length === 0 && <div className="muted small">{blank ? t("startToSee") : t("noWindowsYet")}</div>}
          {windows.map((w) => (
            <div key={w.id}>
              <button
                className={"win-row" + (openId === w.id ? " open" : "") + (hoverId === w.id ? " hot" : "")}
                onClick={() => setOpenId(openId === w.id ? null : w.id)}
                onMouseEnter={() => setHoverId(w.id)}
                onMouseLeave={() => setHoverId(null)}
                disabled={!w.summary}
              >
                <span className="dot" style={{ background: colorOf(w.id) }} />
                <span className="win-app">{w.app}</span>
                <span className="muted ellipsis">{w.what}</span>
              </button>
              {openId === w.id && w.summary && <div className="win-summary">{w.summary}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
