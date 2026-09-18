import { useState } from "react";
import { ApiError, login } from "../api";
import { useT } from "../i18n";
import Wordmark from "./Wordmark";

export default function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("wrongPassword") : `${t("unreachable")} ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <Wordmark size={28} />
        <h1 className="login-title">{t("tagline")}</h1>
        <p className="muted">{t("loginHint")}</p>
        <label className="login-field">
          {t("password")}
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>{busy ? t("checking") : t("continue")}</button>
      </form>
    </main>
  );
}
