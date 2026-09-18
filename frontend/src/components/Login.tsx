import { useState } from "react";
import { ApiError, login } from "../api";
import Wordmark from "./Wordmark";

export default function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That password is not right." : `Could not reach the server. ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <Wordmark size={28} />
        <h1 className="login-title">The loose end of your day, within reach.</h1>
        <p className="muted">Enter the password once. This browser stays signed in.</p>
        <label className="login-field">
          Password
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>{busy ? "Checking…" : "Continue"}</button>
      </form>
    </main>
  );
}
