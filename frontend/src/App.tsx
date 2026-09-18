import { useState } from "react";

const DEFAULT_BACKEND = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:8787";

type Step = { label: string; state: "idle" | "running" | "ok" | "fail"; detail?: string };

function load(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [backend, setBackend] = useState(() => load("backend", DEFAULT_BACKEND));
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(() => load("token", ""));
  const [steps, setSteps] = useState<Step[]>([
    { label: "Reach backend (/api/health)", state: "idle" },
    { label: "Log in with password (/api/login)", state: "idle" },
    { label: "Authenticated request (/api/me)", state: "idle" },
    { label: "Round-trip through Qwen (/api/ping)", state: "idle" },
  ]);

  const update = (i: number, patch: Partial<Step>) =>
    setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  async function run() {
    const base = backend.replace(/\/+$/, "");
    try {
      localStorage.setItem("backend", base);
    } catch {}
    setSteps((s) => s.map((st) => ({ ...st, state: "idle", detail: undefined })));

    // 1. health
    update(0, { state: "running" });
    let health: { host: string; time: string };
    try {
      const r = await fetch(`${base}/api/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      health = await r.json();
      update(0, { state: "ok", detail: `host=${health.host}` });
    } catch (e) {
      update(0, { state: "fail", detail: String(e) });
      return;
    }

    // 2. login (reuse a stored token if the password field is empty)
    update(1, { state: "running" });
    let tok = token;
    if (password) {
      try {
        const r = await fetch(`${base}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        tok = (await r.json()).token;
        setToken(tok);
        try {
          localStorage.setItem("token", tok);
        } catch {}
        update(1, { state: "ok", detail: "token received" });
      } catch (e) {
        update(1, { state: "fail", detail: String(e) });
        return;
      }
    } else if (tok) {
      update(1, { state: "ok", detail: "using stored token" });
    } else {
      update(1, { state: "fail", detail: "enter the password" });
      return;
    }
    const auth = { Authorization: `Bearer ${tok}` };

    // 3. me
    update(2, { state: "running" });
    try {
      const r = await fetch(`${base}/api/me`, { headers: auth });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const me = await r.json();
      update(2, { state: "ok", detail: `host=${me.host} model=${me.model}` });
    } catch (e) {
      update(2, { state: "fail", detail: String(e) });
      return;
    }

    // 4. ping
    update(3, { state: "running" });
    try {
      const r = await fetch(`${base}/api/ping`, { method: "POST", headers: auth });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = await r.json();
      update(3, { state: "ok", detail: `${p.ms} ms · "${p.reply}"` });
    } catch (e) {
      update(3, { state: "fail", detail: String(e) });
    }
  }

  return (
    <main>
      <h1>BYPP · connection check</h1>
      <label>
        Backend URL
        <input value={backend} onChange={(e) => setBackend(e.target.value)} spellCheck={false} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={token ? "(stored token will be used)" : ""}
        />
      </label>
      <button onClick={run}>Run checks</button>
      <ol>
        {steps.map((s) => (
          <li key={s.label} className={s.state}>
            <span className="badge">{s.state}</span> {s.label}
            {s.detail && <div className="detail">{s.detail}</div>}
          </li>
        ))}
      </ol>
    </main>
  );
}
