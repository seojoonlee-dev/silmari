import { useEffect, useState } from "react";
import { clearToken, getToken, me, type Me } from "./api";
import Login from "./components/Login";
import Panel from "./components/Panel";
import Preview from "./components/Preview";
import Timeline from "./components/Timeline";
import { NOW, STRETCHES, midpoint, openAt } from "./data/sample";

const LAST = STRETCHES.length - 1;
type Auth = { state: "checking" } | { state: "out" } | { state: "in"; me: Me };

export default function App() {
  const [auth, setAuth] = useState<Auth>({ state: "checking" });
  const [sel, setSel] = useState(LAST);
  const [menu, setMenu] = useState(false);

  // Auto-login: a stored token is validated against /api/me on load.
  async function check() {
    if (!getToken()) return setAuth({ state: "out" });
    try {
      setAuth({ state: "in", me: await me() });
    } catch {
      setAuth({ state: "out" });
    }
  }
  useEffect(() => {
    void check();
  }, []);

  if (auth.state === "checking") return <main className="login" />;
  if (auth.state === "out") return <Login onDone={check} />;

  const live = sel === LAST;
  const stretch = STRETCHES[sel];
  const t = live ? NOW : midpoint(stretch);

  return (
    <div className="app">
      <header className="topbar">
        <div className="row-gap" style={{ gap: 14 }}>
          <div className="wordmark">BYPP</div>
          <span className="muted small">Thursday 18 Sep</span>
        </div>
        <div className="row-gap" style={{ gap: 16, position: "relative" }}>
          <button className="rec" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
            <span className="rec-dot" />Recording · every 5 s
          </button>
          <span className="mono muted">{NOW}</span>
          {menu && (
            <div className="menu" role="menu">
              <div className="small">Connected to <b className="mono">{auth.me.host}</b></div>
              <div className="small muted">Model {auth.me.model}</div>
              <button className="btn btn-secondary" onClick={() => { clearToken(); setAuth({ state: "out" }); }}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      <div className="main">
        <section className="left">
          <Preview windows={openAt(t)} caption={live ? "captured 4 s ago" : `frame from ${t}`} rewound={!live} />
        </section>
        <Panel stretch={stretch} live={live} onJumpNow={() => setSel(LAST)} onGoTo={setSel} />
      </div>

      <Timeline sel={sel} onSelect={setSel} />
    </div>
  );
}
