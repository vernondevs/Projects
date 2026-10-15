/** Запуск тестового сервера и ботов на colyseus.js. */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, type Room } from "colyseus.js";
import type { SelfState } from "../shared/protocol";

export const PORT = Number(process.env.TEST_PORT) || 2601;
let server: ChildProcess | null = null;
export const dbFile = path.join(os.tmpdir(), `emberfall-test-${process.pid}.sqlite`);

export async function startServer(fresh = true, env: Record<string, string> = {}) {
  if (fresh) for (const f of [dbFile, dbFile + "-wal", dbFile + "-shm"]) fs.rmSync(f, { force: true });
  server = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbFile, TEST_MODE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout!.on("data", (d) => (log += d));
  server.stderr!.on("data", (d) => {
    log += d;
    process.stderr.write("[server] " + d);
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("сервер не запустился:\n" + log);
}

export async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((res) => {
    s.once("exit", () => res());
    s.kill("SIGINT");
    setTimeout(() => {
      s.kill("SIGKILL");
      res();
    }, 3000);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HTTP API аккаунтов. Ошибка — исключение с текстом сервера и полем status. */
export async function api(path: string, body?: unknown, token = ""): Promise<any> {
  const res = await fetch(`http://localhost:${PORT}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

/** Вход в аккаунт login (создаётся, если его нет) и герой name на нём (создаётся, если его нет). Возвращает токен. */
export async function ensureChar(login: string, password: string, name = login, cls = "warrior", look = 0): Promise<string> {
  let v: any;
  try {
    v = await api("/login", { login, password });
  } catch (e) {
    if ((e as any).status !== 404) throw e;
    v = await api("/login", { login, password, create: true });
  }
  if (!v.chars.some((c: any) => c.name.toLowerCase() === name.toLowerCase())) v = await api("/chars", { name, cls, look }, v.token);
  return v.token;
}

export class Bot {
  room!: Room<any>;
  client!: Client;
  self: SelfState | null = null;
  chat: { from: string; text: string; sys?: boolean }[] = [];
  fx: any[] = [];
  toasts: string[] = [];
  bags: any[] = [];
  // арена
  welcome: any = null;
  info: any = null;
  found: any = null;
  cancelled: string[] = [];
  go: any = null;
  result: any = null;
  ret: any = null;
  party: any = null;
  partyInvite: any = null;
  top: any = null;
  history: any = null;
  token = "";
  closeCode = 0;

  /** Аккаунт с логином = имя героя создаётся автоматически (как у перенесённых старых героев). */
  static async join(name: string, password = "secret", cls = "warrior") {
    return Bot.enter(await ensureChar(name, password, name, cls), name);
  }
  /** Вход героем character по готовому токену. */
  static async enter(token: string, character: string) {
    const b = new Bot();
    b.token = token;
    b.client = new Client(`ws://localhost:${PORT}`);
    b.attach(await b.client.joinOrCreate("world", { token, character }));
    await b.until(() => !!b.self && b.room.state.players?.size > 0, 3000, "self");
    return b;
  }

  attach(room: Room<any>) {
    this.room = room;
    const on = (t: string, fn: (m: any) => void) => room.onMessage(t, fn);
    on("self", (s: SelfState) => (this.self = s));
    on("chat", (l) => this.chat.push(l));
    on("fx", (list: any[]) => this.fx.push(...list));
    on("toast", (t) => this.toasts.push(t.text));
    on("loot", (bags) => (this.bags = bags));
    on("welcome", (w) => (this.welcome = w));
    on("arena:info", (m) => (this.info = m));
    on("arena:found", (m) => (this.found = m));
    on("arena:cancelled", (m) => this.cancelled.push(m.reason));
    on("arena:go", (m) => (this.go = m));
    on("arena:result", (m) => (this.result = m));
    on("arena:return", (m) => (this.ret = m));
    on("party", (m) => (this.party = m));
    on("party:invite", (m) => (this.partyInvite = m));
    on("arena:top", (m) => (this.top = m));
    on("arena:history", (m) => (this.history = m));
    room.onMessage("*", () => {});
    room.onLeave((code) => (this.closeCode = code));
  }

  /** Переход в другую комнату по резервации места (арена и обратно). */
  async switchTo(reservation: any) {
    this.welcome = null;
    this.self = null;
    await this.room.leave(true);
    this.attach(await this.client.consumeSeatReservation(reservation));
    await this.until(() => !!this.welcome && !!this.self, 4000, "welcome после перехода");
  }

  get id() {
    return this.room.sessionId;
  }
  me() {
    return this.room.state.players.get(this.id);
  }
  send(type: string, msg: unknown = {}) {
    this.room.send(type, msg);
  }
  async until(cond: () => boolean, ms = 3000, what = "условие") {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`таймаут: ${what}`);
      await sleep(30);
    }
  }
  async leave() {
    await this.room.leave(true);
  }
}

let passed = 0;
export async function check(name: string, fn: () => Promise<void> | void) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name} (${Date.now() - t0} мс)`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    throw e;
  }
}
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
export const passedCount = () => passed;
