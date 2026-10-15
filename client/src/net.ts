/** Сетевой слой клиента: комната Colyseus (мир или арена), личное состояние и подписки. */
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import type { ArenaInfo, ArenaMode, ArenaResultMsg, HistoryRow, LeaderRow, MatchFoundMsg, PartyState, Reservation } from "../../shared/arena";
import type { RumorMsg } from "../../shared/rumors";
import type { EncDialogMsg, EncNpcMsg, EncShopMsg } from "../../shared/encounters";
import type { TradeView } from "../../shared/trade";
import type { BankView } from "../../shared/bank";
import type { ChatLine, CooldownMsg, Fx, JoinOptions, LootBag, SelfState, ToastMsg } from "../../shared/protocol";
import { ROOM_NAME } from "../../shared/protocol";
import { KICK_CODE, KICK_TEXT, LOGOUT_CODE, RECONNECT_SEC } from "../../shared/accounts";

export type LogoutMode = "char" | "account";

/** Код согласованного закрытия Colyseus (сервер закрыл комнату, например арену после боя). */
const CONSENTED = 4000;
/** Сторож связи: ping раз в PING_MS, нет pong за DEAD_MS — связь считается потерянной. */
const PING_MS = 3000;
const DEAD_MS = 10_000;
const STEP_MS = 8000;

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`таймаут: ${what}`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

type Events = {
  self: SelfState;
  fx: Fx[];
  chat: ChatLine;
  toast: ToastMsg;
  mountcast: { ms: number; name?: string };
  combat: { on: boolean };
  air: { air: number; max: number };
  node: { id: number; up: boolean };
  nodes: { depleted: number[] };
  loot: LootBag[];
  cd: CooldownMsg;
  leave: number;
  /** Сервер завершил выход (задача 29): куда вернуться. */
  logout: LogoutMode;
  "logout:wait": { ms: number };
  "logout:cancel": { reason: string };
  /** Связь потеряна, идёт переподключение: попытка, когда следующая (performance.now), когда началось. */
  reconnecting: { attempt: number; nextAt: number; since: number };
  /** Связь восстановлена (следом придёт switch — сцена перестраивается). */
  reconnected: number;
  /** Вход тем же героем с другой вкладки: эта сессия закрыта. */
  kicked: string;
  /** Переподключиться нельзя (сессия истекла, герой недоступен): назад к входу. */
  lost: string;
  switch: "world" | "arena";
  "arena:info": ArenaInfo;
  "arena:found": MatchFoundMsg;
  "arena:cancelled": { reason: string };
  "arena:result": ArenaResultMsg;
  "arena:top": { mode: ArenaMode; rows: LeaderRow[] };
  "arena:history": HistoryRow[];
  rumor: RumorMsg;
  "enc:npc": EncNpcMsg;
  "enc:say": { id: string; text: string };
  "enc:move": { id: string; x: number; y: number; ms: number };
  "enc:gone": { id: string };
  "enc:dialog": EncDialogMsg;
  "enc:shop": EncShopMsg;
  party: PartyState | null;
  "party:invite": { from: string };
  "trade:request": { from: string; ms: number } | null;
  "trade:state": TradeView | null;
  "trade:done": Record<string, never>;
  bank: BankView;
  "market:prices": Record<string, number>;
  "admin:players": { name: string; cls: string; level: number; x: number; y: number; admin: boolean }[];
  "admin:logs": { kind: "trades" | "admin"; rows: any[] };
  "admin:banner": { text: string };
};

export interface ArenaWelcome {
  arena: true;
  mode: ArenaMode;
  team: number;
  teams: { name: string; cls: string; level: number; rating: number }[][];
}

export interface UnitState {
  kind: number;
  name: string;
  sprite: string;
  x: number;
  y: number;
  dir: number;
  anim: number;
  aseq: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  level: number;
  buffs: number;
  phase: number;
  weapon: string;
  target: string;
  team: number;
  title: string;
  frame: string;
  elite: number;
  ownerId: string;
  mount: string;
  look: number;
}

export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  if (import.meta.env.DEV) return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
  return location.origin.replace(/^http/, "ws");
}

export class Net {
  room!: Room<any>;
  client!: Client;
  id = "";
  seed = 0;
  /** Где сейчас игрок: в мире или на арене. */
  kind: "world" | "arena" = "world";
  arena: ArenaWelcome | null = null;
  self: SelfState | null = null;
  bags: LootBag[] = [];
  arenaInfo: ArenaInfo | null = null;
  party: PartyState | null = null;
  cooldowns = new Map<string, number>(); // id -> performance.now() окончания
  /** Идёт переход между комнатами: обрыв старой комнаты — не ошибка. */
  switching = false;
  /** Запрошенный выход: куда вернуться после закрытия соединения сервером. */
  logoutMode: LogoutMode | null = null;
  private handlers: Partial<Record<keyof Events, ((v: any) => void)[]>> = {};

  on<K extends keyof Events>(ev: K, fn: (v: Events[K]) => void): () => void {
    const list: ((v: any) => void)[] = this.handlers[ev] ?? (this.handlers[ev] = []);
    list.push(fn as (v: any) => void);
    return () => {
      const i = list.indexOf(fn as (v: any) => void);
      if (i >= 0) list.splice(i, 1);
    };
  }
  private emit<K extends keyof Events>(ev: K, v: Events[K]) {
    for (const fn of [...(this.handlers[ev] ?? [])]) fn(v);
  }

  /** Параметры входа (токен и герой) — для переподключения. */
  private joinOpts: JoinOptions | null = null;
  /** Идёт восстановление связи (автоматическое или по кнопке). */
  recovering = false;
  private recoverGen = 0;
  private wake: (() => void) | null = null;
  private pingAt = 0;
  private pingTimer = 0;
  private kickText = "";
  /** Соединение закрыто намеренно (выход, вытеснение): сторож и переподключение молчат. */
  private closed = false;

  /** Связь в порядке: есть комната и не идёт переподключение. */
  get online() {
    return !!this.room && !this.closed && !this.recovering;
  }

  private resetPersonal() {
    this.self = null;
    this.bags = [];
    this.arenaInfo = null;
    this.party = null;
    this.cooldowns.clear();
    this.logoutMode = null;
  }

  async connect(opts: JoinOptions): Promise<void> {
    this.stopRecover();
    this.resetPersonal();
    this.joinOpts = opts;
    this.client = new Client(serverUrl());
    await this.attach(await this.client.joinOrCreate(ROOM_NAME, opts));
    this.startWatchdog();
  }

  /** Сторож: ping раз в 3 с; нет ответа 10 с после ping — связь потеряна (сеть пропала без закрытия сокета). */
  private startWatchdog() {
    if (this.pingTimer) return;
    this.pingTimer = window.setInterval(() => {
      if (!this.room || this.closed || this.recovering || this.switching) return;
      const now = performance.now();
      if (this.pingAt && now - this.pingAt > DEAD_MS) return this.dropped(this.room, 0);
      if (!this.pingAt) {
        this.pingAt = now;
        this.send("ping", {});
      }
    }, PING_MS);
  }

  /** Неожиданное закрытие комнаты: выход, вытеснение или обрыв — тогда переподключение. */
  private dropped(room: Room<any>, code: number) {
    if (this.room !== room || this.closed || this.switching || this.recovering) return;
    if (code === LOGOUT_CODE) {
      this.closed = true;
      const mode = this.logoutMode ?? "char";
      this.logoutMode = null;
      this.emit("logout", mode);
    } else if (code === KICK_CODE) {
      this.close();
      console.info("[net] вытеснение другой вкладкой");
      this.emit("kicked", this.kickText || KICK_TEXT);
    } else void this.recover(code !== CONSENTED, false);
  }

  /**
   * Восстановление связи без перезагрузки страницы. resume — сначала вернуться в ту же сессию
   * (сервер держит героя RECONNECT_SEC), иначе обычный вход тем же героем. leave — сначала
   * согласованно выйти (кнопка «Переподключиться»: полная загрузка состояния заново).
   * Повторы: 1, 2, 4, 8… до 15 с.
   */
  async recover(resume: boolean, leave: boolean) {
    const gen = ++this.recoverGen;
    this.recovering = true;
    const old = this.room as Room<any> | undefined;
    let token = resume ? old?.reconnectionToken ?? "" : "";
    try { old?.removeAllListeners(); } catch {}
    if (leave && old) await timeout(old.leave(true), 3000, "выход").catch(() => 0);
    else try { old?.connection?.close(); } catch {}
    const since = performance.now();
    this.emit("reconnecting", { attempt: 0, nextAt: since, since });
    for (let attempt = 1; gen === this.recoverGen; attempt++) {
      try {
        let room: Room<any> | null = null;
        if (token && performance.now() - since < RECONNECT_SEC * 1000) {
          try {
            room = await timeout(this.client.reconnect(token), STEP_MS, "переподключение");
          } catch (e) {
            if (typeof (e as { code?: unknown })?.code !== "number") throw e; // сервер недоступен — повтор
            token = ""; // сессия на сервере уже закрыта — обычный вход
          }
        }
        if (!room) {
          if (!this.joinOpts) throw Object.assign(new Error("Нет данных входа"), { code: 401 });
          room = await timeout(this.client.joinOrCreate(ROOM_NAME, this.joinOpts), STEP_MS, "вход");
        }
        if (gen !== this.recoverGen) {
          void room.leave(true).catch(() => 0);
          return;
        }
        this.bags = [];
        this.cooldowns.clear();
        await timeout(this.attach(room), STEP_MS, "welcome");
        this.recovering = false;
        this.emit("reconnected", attempt);
        this.emit("switch", this.kind);
        return;
      } catch (e) {
        if (gen !== this.recoverGen) return;
        const code = (e as { code?: unknown })?.code;
        if (code === 401 || code === 403 || code === 404) {
          this.recovering = false;
          this.emit("lost", (e as Error).message || "Сессия истекла, войдите снова");
          return;
        }
        console.warn("[net] переподключение:", (e as Error)?.message ?? e);
        const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempt - 1, 4));
        this.emit("reconnecting", { attempt, nextAt: performance.now() + delay, since });
        await new Promise<void>((r) => {
          const t = setTimeout(r, delay);
          this.wake = () => { clearTimeout(t); r(); };
        });
        this.wake = null;
      }
    }
  }
  /** «Повторить сейчас» в окне переподключения. */
  retryNow() {
    this.wake?.();
  }
  private stopRecover() {
    this.recoverGen++;
    this.recovering = false;
    this.wake?.();
  }

  /** Тихо закрыть соединение (выход к экрану входа работает, даже если связь сломана). */
  close() {
    this.stopRecover();
    this.closed = true;
    const room = this.room as Room<any> | undefined;
    if (!room) return;
    try { room.removeAllListeners(); } catch {}
    try { void timeout(room.leave(true), 3000, "выход").catch(() => { try { room.connection?.close(); } catch {} }); } catch {}
  }

  /** Подписки на сообщения комнаты; ждём welcome, чтобы знать, мир это или арена. */
  private attach(room: Room<any>): Promise<void> {
    this.room = room;
    this.id = room.sessionId;
    this.closed = false;
    this.pingAt = 0;
    room.onMessage("pong", () => (this.pingAt = 0));
    room.onMessage("kicked", (m: { text?: string }) => (this.kickText = m?.text ?? ""));
    const welcome = new Promise<void>((resolve) => {
      room.onMessage("welcome", (w: { seed?: number; arena?: boolean } & Partial<ArenaWelcome>) => {
        if (w.arena) {
          this.kind = "arena";
          this.arena = w as ArenaWelcome;
        } else {
          this.kind = "world";
          this.arena = null;
          this.seed = w.seed ?? this.seed;
        }
        resolve();
      });
    });
    room.onMessage("self", (s: SelfState) => {
      this.self = s;
      this.emit("self", s);
    });
    room.onMessage("fx", (list: Fx[]) => this.emit("fx", list));
    room.onMessage("chat", (l: ChatLine) => this.emit("chat", l));
    room.onMessage("toast", (t: ToastMsg) => this.emit("toast", t));
    room.onMessage("combat", (m: { on: boolean }) => this.emit("combat", m));
    room.onMessage("mountcast", (m: { ms: number; name?: string }) => this.emit("mountcast", m));
    for (const t of ["air", "node", "nodes"] as const) room.onMessage(t, (m: any) => this.emit(t, m));
    room.onMessage("loot", (b: LootBag[]) => {
      this.bags = b;
      this.emit("loot", b);
    });
    room.onMessage("cd", (c: CooldownMsg) => {
      this.cooldowns.set(c.id, performance.now() + c.ms);
      this.emit("cd", c);
    });
    room.onMessage("arena:info", (m: ArenaInfo) => {
      this.arenaInfo = m;
      this.emit("arena:info", m);
    });
    room.onMessage("party", (m: PartyState | null) => {
      this.party = m;
      this.emit("party", m);
    });
    for (const t of ["rumor", "enc:npc", "enc:say", "enc:move", "enc:gone", "enc:dialog", "enc:shop", "arena:found", "arena:cancelled", "arena:result", "arena:top", "arena:history", "party:invite", "trade:request", "trade:state", "trade:done", "bank", "market:prices", "admin:players", "admin:logs", "admin:banner"] as const)
      room.onMessage(t, (m: any) => this.emit(t, m));
    room.onMessage("arena:go", (m: { reservation: Reservation }) => void this.switchTo(m.reservation));
    room.onMessage("arena:return", (m: { reservation: Reservation }) => void this.switchTo(m.reservation));
    room.onMessage("logout:wait", (m: { ms: number }) => this.emit("logout:wait", m));
    room.onMessage("logout:cancel", (m: { reason: string }) => {
      this.logoutMode = null;
      this.emit("logout:cancel", m);
    });
    room.onMessage("logout:ok", () => {});
    room.onLeave((code) => this.dropped(room, code));
    room.onError((code, message) => console.warn("[net] ошибка комнаты:", code, message));
    return welcome;
  }

  /** Переход в другую комнату по резервации места, выданной сервером. */
  async switchTo(res: Reservation) {
    this.switching = true;
    try {
      const old = this.room;
      this.bags = [];
      this.cooldowns.clear();
      await old.leave(true).catch(() => 0);
      await this.attach(await this.client.consumeSeatReservation({ ...res, room: { ...res.room, clients: 0, maxClients: 0 } } as any));
    } catch (e) {
      this.switching = false;
      console.error(e);
      // переход не удался — обычный вход тем же героем (мир примет, когда арена отпустит героя)
      void this.recover(false, false);
      return;
    }
    this.switching = false;
    this.emit("switch", this.kind);
  }

  send(type: string, msg: unknown = {}) {
    try {
      this.room?.send(type, msg);
    } catch {}
  }

  /** Выход из мира: сервер ответит logout:wait (в бою, отсчёт) или закроет соединение. */
  requestLogout(mode: LogoutMode) {
    this.logoutMode = mode;
    this.send("logout:request", {});
  }
  cancelLogout() {
    if (!this.logoutMode) return;
    this.logoutMode = null;
    this.send("logout:cancel", {});
  }

  /** Подписка на появление и удаление юнитов в Schema. */
  watchUnits(map: "players" | "mobs", add: (id: string, u: UnitState) => void, remove: (id: string) => void) {
    const $ = getStateCallbacks(this.room);
    const coll = ($(this.room.state) as any)[map];
    coll.onAdd((u: UnitState, id: string) => add(id, u));
    coll.onRemove((_u: UnitState, id: string) => remove(id));
  }
  unit(id: string): UnitState | undefined {
    const st = this.room?.state; // во время переподключения состояние новой комнаты может быть ещё пустым
    return st?.players?.get(id) ?? st?.mobs?.get(id);
  }
}

export const net = new Net();
