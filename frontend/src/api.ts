// Same-origin API client. The bearer token lives in localStorage so a returning
// visitor is logged in automatically; a 401 clears it and sends them back to login.

const KEY = "silmari.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string) {
  try {
    localStorage.setItem(KEY, t);
  } catch {}
}
export function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) clearToken();
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export type Me = { ok: true; host: string; model: string };

export async function login(password: string): Promise<void> {
  const r = await api<{ token: string }>("/api/login", { method: "POST", body: JSON.stringify({ password }) });
  setToken(r.token);
}

export const me = () => api<Me>("/api/me");

export type AskResult = { ok: true; id: number; answer: string; cites: { time: number; label: string }[] };
export type ChatTurn = { id: number; ts: number; at: number | null; q: string; a: string; cites: { time: number; label: string }[] };
export const chatHistory = (device: string) => api<{ ok: true; turns: ChatTurn[] }>(`/api/chat?device=${encodeURIComponent(device)}`);
export const ask = (device: string, question: string, at: number | null, history: { q: string; a: string }[]) =>
  api<AskResult>("/api/ask", { method: "POST", body: JSON.stringify({ device, question, at, history }) });

export const setSettings = (device: string, lang: "en" | "ko") =>
  api<{ ok: true }>("/api/settings", { method: "POST", body: JSON.stringify({ device, lang }) });

export const resetDevice = (device: string) =>
  api<{ ok: true; deleted: Record<string, number> }>(`/api/device?device=${encodeURIComponent(device)}`, { method: "DELETE" });
