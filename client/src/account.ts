/** HTTP API аккаунта: вход, список героев, создание и удаление. Токен сессии хранится только во вкладке (sessionStorage). */
import type { AccountView } from "../../shared/accounts";
import type { ClassId } from "../../shared/classes";
import { serverUrl } from "./net";

const KEY = "emberfall-token";

export function apiBase(): string {
  return serverUrl().replace(/^ws/, "http") + "/api";
}

export const session = {
  get token(): string {
    try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; }
  },
  set token(v: string) {
    try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch {}
  },
};

async function call(path: string, body?: unknown): Promise<AccountView> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Сервер недоступен. Запущен ли npm run dev?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) session.token = "";
    const e = new Error(data?.error || `Ошибка ${res.status}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  if (data?.token) session.token = data.token;
  return data as AccountView;
}

export const api = {
  login: (login: string, password: string, create = false) => call("/login", { login, password, create }),
  chars: () => call("/chars"),
  create: (name: string, cls: ClassId, look: number) => call("/chars", { name, cls, look }),
  remove: (name: string, confirm: string) => call("/chars/delete", { name, confirm }),
  async logout() {
    const t = session.token;
    session.token = "";
    if (t) await fetch(apiBase() + "/logout", { method: "POST", headers: { Authorization: `Bearer ${t}` } }).catch(() => 0);
  },
};
