/** Сообщения между клиентом и сервером. Сервер проверяет каждое входящее сообщение. */
import type { ClassId, StatKey, Stats } from "./classes";
import type { Derived } from "./formulas";
import type { Item, Slot } from "./items";

export const ROOM_NAME = "world";

export interface JoinOptions {
  name: string;
  password: string;
  cls?: ClassId;
}

/** Состояние анимации юнита в Schema. */
export enum Anim {
  Idle = 0,
  Walk = 1,
  Attack = 2,
  Cast = 3,
  Dead = 4,
}
export enum Dir {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}
export enum UnitKind {
  Player = 0,
  Mob = 1,
  Boss = 2,
}
/** Битовые флаги эффектов на юните (видны всем). */
export const BUFF_SLOW = 1;
export const BUFF_STUN = 2;
export const BUFF_WARCRY = 4;
export const BUFF_ROOT = 8;
export const BUFF_HASTE = 16;
export const BUFF_ENRAGE = 32;
export const BUFF_POISON = 64;
export const BUFF_BURN = 128;

// ---------- клиент -> сервер ----------
export interface ClientMessages {
  input: { mx: number; my: number };
  moveTo: { x: number; y: number };
  target: { id: string | null };
  skill: { id: string; x: number; y: number; target?: string | null };
  alloc: { stat: StatKey };
  learn: { id: string };
  equip: { index: number };
  unequip: { slot: Slot };
  use: { index: number };
  sell: { index: number };
  swap: { a: number; b: number };
  buy: { base: string; qty?: number };
  "cook:buy": { id: string; qty?: number };
  "smith:upgrade": { index?: number; slot?: Slot };
  "smith:buy": { id: string; qty?: number };
  pickup: { bag: string; index?: number };
  chat: { text: string };
  respawn: Record<string, never>;
  "mount:toggle": Record<string, never>;
  "mount:select": { id: string };
  "mount:buy": { id: string };
}

// ---------- сервер -> клиент ----------
export interface SelfState {
  id: string;
  name: string;
  cls: ClassId;
  level: number;
  xp: number;
  xpNext: number;
  gold: number;
  alloc: Stats;
  statPoints: number;
  skillPoints: number;
  skills: Record<string, number>;
  inventory: (Item | null)[];
  equip: Record<Slot, Item | null>;
  derived: Derived;
  kills: number;
  bossKills: Record<string, number>;
  /** Убийства по типам мобов (бестиарий). */
  mobKills: Record<string, number>;
  /** Еда: id блюда и сколько мс осталось. */
  food?: { id: string; left: number } | null;
  /** Маунты: владение и выбранный. */
  mounts?: string[];
  mount?: string;
  /** Входящие запросы на обмен отключены. */
}

export interface LootBag {
  id: string;
  x: number;
  y: number;
  items: Item[];
  boss?: boolean;
}

export type FxKind = "phys" | "fire" | "frost" | "poison" | "arcane" | "shadow" | "nature" | "holy";

export type Fx =
  | { t: "dmg"; id: string; v: number; crit?: boolean; k?: FxKind; heal?: boolean; miss?: boolean }
  | { t: "proj"; k: string; from: string; tx: number; ty: number; ms: number; to?: string }
  | { t: "aoe"; k: string; x: number; y: number; r: number }
  | { t: "cone"; k: string; x: number; y: number; a: number; r: number; w: number }
  | { t: "tele"; shape: "circle" | "cone" | "ring"; k: string; x: number; y: number; r: number; r2?: number; a?: number; w?: number; ms: number }
  | { t: "hazard"; id: string; k: string; x: number; y: number; r: number; ms: number }
  | { t: "blink"; id: string; x0: number; y0: number; x1: number; y1: number }
  | { t: "lvl"; id: string; level: number }
  | { t: "buff"; id: string; k: string; ms: number }
  | { t: "say"; id: string; text: string }
  | { t: "spawn"; id: string; k: string };

export interface ChatLine {
  from: string;
  text: string;
  sys?: boolean;
  cls?: ClassId;
}

export interface ToastMsg {
  text: string;
  kind?: "info" | "error" | "loot" | "level";
  /** Ключ иконки предмета (iconFor) и классы, для которых он предназначен. */
  icon?: string;
  classes?: string[];
}

export interface CooldownMsg {
  id: string;
  ms: number;
}
