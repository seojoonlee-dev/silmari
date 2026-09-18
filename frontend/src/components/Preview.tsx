import { useEffect, useRef, useState } from "react";
import type { App } from "../data/sample";
import type { Win } from "../model";
import { CATEGORY_COLOR } from "../model";

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

type Props = { windows: Win[]; caption: string; rewound: boolean; imageUrl?: string | null; stream?: MediaStream | null };

function LiveVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} className="preview-img" muted playsInline aria-label="Live screen" />;
}

export default function Preview({ windows, caption, rewound, imageUrl, stream }: Props) {
  const cols = windows.length <= 1 ? 1 : 2;
  const [openId, setOpenId] = useState<string | null>(null);
  // Live: the screen share itself. Rewound: the saved frame from that time. Otherwise the sample tiles.
  const showVideo = !rewound && !!stream;
  const showImage = !showVideo && !!imageUrl;
  return (
    <>
      <div className="row-between">
        <div className="label">Screen · this device</div>
        <span className="mono muted small">{caption}</span>
      </div>
      <div className="preview">
        {showVideo ? (
          <LiveVideo stream={stream!} />
        ) : showImage ? (
          <img className="preview-img" src={imageUrl!} alt={rewound ? "Saved frame" : "Last saved frame"} />
        ) : (
          <div className="preview-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {windows.map((w) => <Tile key={w.id} w={w} />)}
          </div>
        )}
        {rewound && <span className="chip chip-ink mono preview-tag">Rewound</span>}
        {showVideo && <span className="chip chip-ink mono preview-tag">Live</span>}
      </div>
      <div className="card">
        <div className="row-between">
          <div className="label">
            {rewound ? "On screen then" : "On screen"} · {windows.length} window{windows.length === 1 ? "" : "s"}
          </div>
          <span className="muted small">click one for a summary</span>
        </div>
        <div className="win-list">
          {windows.length === 0 && <div className="muted small">No windows identified yet.</div>}
          {windows.map((w) => (
            <div key={w.id}>
              <button className={"win-row" + (openId === w.id ? " open" : "")} onClick={() => setOpenId(openId === w.id ? null : w.id)} disabled={!w.summary}>
                <span className="dot" style={{ background: CATEGORY_COLOR[w.category] }} />
                <span className="win-app">{w.app}</span>
                <span className="muted ellipsis">{w.what}</span>
              </button>
              {openId === w.id && w.summary && <div className="win-summary">{w.summary}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
