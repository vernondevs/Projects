/** PvP-арена: режимы, ранги, Elo, сезоны, карта арены и типы сообщений. */
import { TILE } from "./constants";
import type { ClassId } from "./classes";
import { CELL_BLOCK, CELL_WALL, T, TOWN, Zone, type WorldMap } from "./map";

/** Распорядитель арены в городе: у врат арены во дворе восточного квартала (shared/town.ts). */
export const ARENA_NPC = {
  x: (TOWN.x + 17) * TILE,
  y: (TOWN.y + 6) * TILE + 16,
};

export type ArenaMode = "1v1" | "2v2";
export const ARENA_MODES: ArenaMode[] = ["1v1", "2v2"];
export const MODE_NAMES: Record<ArenaMode, string> = {
  "1v1": "1×1",
  "2v2": "2×2",
};
export const TEAM_SIZE: Record<ArenaMode, number> = { "1v1": 1, "2v2": 2 };

/** Множитель урона игрока по игроку: PvP длится дольше, чем по мобам. */
export const PVP_DAMAGE_MULT = 0.3;
export const START_RATING = 1000;
export const ELO_K = 32;
/** Окно подбора по рейтингу: ±100, затем +50 каждые 10 с ожидания, не больше ±1000. */
export const QUEUE_WINDOW_BASE = 100;
export const QUEUE_WINDOW_STEP = 50;
export const QUEUE_WINDOW_EVERY_MS = 10_000;
export const QUEUE_WINDOW_MAX = 1000;
export const ACCEPT_MS = 15_000;
export const COUNTDOWN_MS = 5_000;
export const MATCH_MS = 180_000;
/** Одних и тех же соперников нельзя получить больше 3 раз подряд. */
export const MAX_REPEAT = 5;
export const SEASON_DAYS = 28;
/** Мягкий сброс в конце сезона: рейтинг сдвигается к 1000 на половину расстояния. */
export const SEASON_RESET_KEEP = 0.5;
export const HISTORY_SIZE = 20;
export const LEADERBOARD_SIZE = 100;

export function queueWindow(waitedMs: number): number {
  return Math.min(
    QUEUE_WINDOW_MAX,
    QUEUE_WINDOW_BASE +
      Math.floor(waitedMs / QUEUE_WINDOW_EVERY_MS) * QUEUE_WINDOW_STEP,
  );
}

/** Ожидаемый результат по Elo для рейтинга a против b. */
export function eloExpected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}
/** Изменение рейтинга: score 1 — победа, 0.5 — ничья, 0 — поражение. */
export function eloDelta(my: number, opp: number, score: number): number {
  return Math.round(ELO_K * (score - eloExpected(my, opp)));
}

export interface RankDef {
  id: string;
  name: string;
  min: number;
  color: string;
  title: string;
  /** Уникальный предмет — награда за сезон. */
  reward: string;
}
export const RANKS: RankDef[] = [
  {
    id: "bronze",
    name: "Бронза",
    min: 0,
    color: "#c8844e",
    title: "Бронзовый боец",
    reward: "arena_bronze",
  },
  {
    id: "silver",
    name: "Серебро",
    min: 1100,
    color: "#c9d2de",
    title: "Серебряный дуэлянт",
    reward: "arena_silver",
  },
  {
    id: "gold",
    name: "Золото",
    min: 1300,
    color: "#f0c050",
    title: "Золотой гладиатор",
    reward: "arena_gold",
  },
  {
    id: "platinum",
    name: "Платина",
    min: 1500,
    color: "#6fe0cc",
    title: "Платиновый чемпион",
    reward: "arena_platinum",
  },
  {
    id: "diamond",
    name: "Алмаз",
    min: 1700,
    color: "#8ab8ff",
    title: "Алмазная легенда",
    reward: "arena_diamond",
  },
];
export function rankOf(rating: number): RankDef {
  let r = RANKS[0];
  for (const x of RANKS) if (rating >= x.min) r = x;
  return r;
}
export const rankById = (id: string) => RANKS.find((r) => r.id === id);

// ---------- сообщения ----------
export interface ModeRating {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  rank: string;
  place: number | null;
}
export interface QueueStatus {
  mode: ArenaMode;
  waitedMs: number;
  window: number;
  withParty: boolean;
  note?: string;
}
export interface PartyMember {
  name: string;
  cls: ClassId;
  level: number;
  online: boolean;
}
export interface PartyState {
  members: PartyMember[];
}
export interface ArenaInfo {
  season: { id: number; endsAt: number; now: number };
  ratings: Record<ArenaMode, ModeRating>;
  queue: QueueStatus | null;
  pending: boolean;
  party: PartyState | null;
  titles: string[];
  title: string;
  frame: string;
}
export interface MatchFoundMsg {
  mode: ArenaMode;
  ms: number;
  teams: { name: string; cls: ClassId; level: number; rating: number }[][];
  accepted: string[];
  /** Предложение боя с ботом (без рейтинга). */
  bot?: boolean;
}
export interface ArenaPlayerResult {
  name: string;
  cls: ClassId;
  team: number;
  damage: number;
  healing: number;
  kills: number;
  deaths: number;
  left: boolean;
  won: boolean;
  draw: boolean;
  ratingBefore: number;
  ratingAfter: number;
}
export interface ArenaResultMsg {
  mode: ArenaMode;
  winner: number; // 0 — ничья, 1 или 2 — номер команды
  reason: "kill" | "time" | "leave";
  durationMs: number;
  players: ArenaPlayerResult[];
  /** Бой с ботами — рейтинг не менялся. */
  bot?: boolean;
}
export interface LeaderRow {
  place: number;
  name: string;
  cls: ClassId;
  rating: number;
  wins: number;
  losses: number;
}
export interface HistoryRow {
  id: number;
  mode: ArenaMode;
  at: number;
  result: "win" | "loss" | "draw";
  delta: number;
  rating: number;
  allies: string[];
  enemies: string[];
  damage: number;
  healing: number;
  durationMs: number;
}
export interface Reservation {
  sessionId: string;
  room: { name: string; roomId: string; processId: string };
}

// ---------- карта арены ----------
export const ARENA_W = 34;
export const ARENA_H = 24;

/** Каменная арена с колоннами и стенками-укрытиями, симметричная слева направо. */
export function generateArenaMap(): WorldMap {
  const w = ARENA_W,
    h = ARENA_H;
  const vtx = new Uint8Array((w + 1) * (h + 1));
  const cx = w / 2,
    cy = h / 2;
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) * 1.6);
      vtx[y * (w + 1) + x] = d < 5.2 ? T.Cobble : T.Floor;
    }
  const cell = new Uint8Array(w * h);
  const zone = new Uint8Array(w * h).fill(Zone.Arena);
  const wall = (x: number, y: number) => {
    cell[y * w + x] |= CELL_BLOCK | CELL_WALL;
    cell[y * w + (w - 1 - x)] |= CELL_BLOCK | CELL_WALL;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 3)
        cell[y * w + x] |= CELL_BLOCK | CELL_WALL;
  // укрытия (левая половина, отражаются на правую)
  const blocks: [number, number, number, number][] = [
    [9, 6, 2, 2],
    [9, 15, 2, 2], // квадратные блоки у входов
    [13, 10, 1, 3], // стенки перед центром
    [6, 10, 1, 1],
    [6, 13, 1, 1], // невысокие колонны у точки появления
  ];
  for (const [bx, by, bw, bh] of blocks)
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) wall(bx + i, by + j);
  // центральная колонна
  for (const [x, y] of [
    [16, 11],
    [17, 11],
    [16, 12],
    [17, 12],
  ])
    cell[y * w + x] |= CELL_BLOCK | CELL_WALL;
  const objects: WorldMap["objects"] = [];
  for (let x = 3; x < w - 3; x += 4)
    objects.push({ kind: "torch", x: x * TILE + 16, y: 1 * TILE + 26 });
  for (const [x, y] of [
    [2.5, 4],
    [2.5, 19],
    [w - 2.5, 4],
    [w - 2.5, 19],
  ])
    objects.push({ kind: "bones", x: x * TILE, y: y * TILE });
  return {
    w,
    h,
    seed: 0,
    vtx,
    cell,
    zone,
    objects,
    spawns: [],
    bosses: [],
    nodes: [],
    vents: [],
    playerSpawn: { x: 4.5 * TILE, y: cy * TILE },
    merchant: { x: -1000, y: -1000 },
    merchants: [],
  };
}
/** Точки появления: команда 1 слева, команда 2 справа. */
export function arenaSpawn(
  team: number,
  slot: number,
): { x: number; y: number } {
  const x = team === 1 ? 4.5 : ARENA_W - 4.5;
  const y = ARENA_H / 2 - 1.5 + slot * 3;
  return { x: x * TILE, y: y * TILE };
}
