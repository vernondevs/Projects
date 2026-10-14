/** Сетевой слой клиента: комната Colyseus (мир или арена), личное состояние и подписки. */
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import type { ArenaInfo, ArenaMode, ArenaResultMsg, HistoryRow, LeaderRow, MatchFoundMsg, PartyState, Reservation } from "../../shared/arena";
import type { RumorMsg } from "../../shared/rumors";
import type { TradeView } from "../../shared/trade";
import type { ChatLine, CooldownMsg, Fx, JoinOptions, LootBag, SelfState, ToastMsg } from "../../shared/protocol";
import { ROOM_NAME } from "../../shared/protocol";

type Events = {
  self: SelfState;
  fx: Fx[];
  chat: ChatLine;
  toast: ToastMsg;
  mountcast: { ms: number; name?: string };
  loot: LootBag[];
  cd: CooldownMsg;
  leave: number;
  switch: "world" | "arena";
  "arena:info": ArenaInfo;
  "arena:found": MatchFoundMsg;
  "arena:cancelled": { reason: string };
  "arena:result": ArenaResultMsg;
  "arena:top": { mode: ArenaMode; rows: LeaderRow[] };
  "arena:history": HistoryRow[];
  rumor: RumorMsg;
  party: PartyState | null;
  "party:invite": { from: string };
  "trade:request": { from: string; ms: number } | null;
  "trade:state": TradeView | null;
  "trade:done": Record<string, never>;
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
  mount: string;
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

  async connect(opts: JoinOptions): Promise<void> {
    this.client = new Client(serverUrl());
    await this.attach(await this.client.joinOrCreate(ROOM_NAME, opts));
  }

  /** Подписки на сообщения комнаты; ждём welcome, чтобы знать, мир это или арена. */
  private attach(room: Room<any>): Promise<void> {
    this.room = room;
    this.id = room.sessionId;
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
    room.onMessage("mountcast", (m: { ms: number; name?: string }) => this.emit("mountcast", m));
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
    for (const t of ["rumor", "arena:found", "arena:cancelled", "arena:result", "arena:top", "arena:history", "party:invite", "trade:request", "trade:state", "trade:done", "market:prices", "admin:players", "admin:logs", "admin:banner"] as const)
      room.onMessage(t, (m: any) => this.emit(t, m));
    room.onMessage("arena:go", (m: { reservation: Reservation }) => void this.switchTo(m.reservation));
    room.onMessage("arena:return", (m: { reservation: Reservation }) => void this.switchTo(m.reservation));
    room.onLeave((code) => {
      if (this.room === room && !this.switching) this.emit("leave", code);
    });
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
      this.emit("toast", { text: "Не удалось перейти: обновите страницу и войдите снова", kind: "error" });
      return;
    }
    this.switching = false;
    this.emit("switch", this.kind);
  }

  send(type: string, msg: unknown = {}) {
    this.room.send(type, msg);
  }

  /** Подписка на появление и удаление юнитов в Schema. */
  watchUnits(map: "players" | "mobs", add: (id: string, u: UnitState) => void, remove: (id: string) => void) {
    const $ = getStateCallbacks(this.room);
    const coll = ($(this.room.state) as any)[map];
    coll.onAdd((u: UnitState, id: string) => add(id, u));
    coll.onRemove((_u: UnitState, id: string) => remove(id));
  }
  unit(id: string): UnitState | undefined {
    return this.room.state.players.get(id) ?? this.room.state.mobs.get(id);
  }
}

export const net = new Net();
