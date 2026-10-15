/**
 * Города: Эмберхолл (shared/town.ts, нейтральный центр мира), малые нейтральные — Оазис Миражей (пустыня) и Снежная долина (снега),
 * и столицы фракций на краях мира — Аурелион (Сольгард, запад) и Мортхейм (Умбрат, восток).
 * Малые города и столицы строятся по одной раскладке (стены 27×21, две ворота — север и юг), стиль задаёт арт и покрытие.
 * Файл не зависит от map.ts: карта, сервер (стражи, телепорт, задания) и клиент берут разметку отсюда.
 *
 *   смещения (dx, dy) — от центра города; стены dx = ±14, dy = ±11; башни 2×2 снаружи;
 *   улицы: проспект |dx|≤1, поперечная |dy|≤1, кольцо вдоль стен dx = ±12 / dy = ±9; площадь |dx|≤6, |dy|≤4.
 */
import data from "../data/cities.json";
import { MAP_W, MID, TILE } from "./constants";
import { TOWN, TOWN_HALF } from "./town";

export type CityStyle = "desert" | "snow" | "solgard" | "umbrath";
export const CITY_WALL = { x: 14, y: 11 };
/** Полуразмеры зоны города вместе с башнями. */
export const CITY_HALF = { x: 15, y: 12 };
export type CityGround = "road" | "plain" | "path" | "pool";

export const inCityRect = (dx: number, dy: number) => Math.abs(dx) <= CITY_HALF.x && Math.abs(dy) <= CITY_HALF.y;
const inCityWalls = (dx: number, dy: number) => Math.abs(dx) < CITY_WALL.x && Math.abs(dy) < CITY_WALL.y;
/** Проём ворот (север и юг). */
export const isCityGate = (dx: number, dy: number) => Math.abs(dx) <= 1 && Math.abs(dy) === CITY_WALL.y;

/** Покрытие клетки малого города. */
export function cityGround(style: CityStyle, dx: number, dy: number): CityGround {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax <= 1 && ay >= CITY_WALL.y) return "road";
  if (!inCityWalls(dx, dy)) return "plain";
  if (style === "desert" && dx >= -3 && dx <= 2 && dy >= -2 && dy <= 1) return "pool";
  if (ax <= 1) return "road";
  if (ax === 12 || ay === 9) return "path";
  if (ay <= 1 || (ax <= 6 && ay <= 4)) return "road";
  return "plain";
}

/** Башни 2×2: якорь — левая нижняя клетка. */
export const CITY_TOWERS: [number, number][] = [
  [-15, -CITY_WALL.y], [14, -CITY_WALL.y], [-15, CITY_WALL.y + 1], [14, CITY_WALL.y + 1],
  [-3, -CITY_WALL.y], [2, -CITY_WALL.y], [-3, CITY_WALL.y + 1], [2, CITY_WALL.y + 1],
];
/** Дома 4×3 (якорь — левая нижняя клетка): по четыре в северном и южном ряду. */
export const CITY_HOUSES: [number, number][] = [[-11, -6], [-6, -6], [3, -6], [8, -6], [-11, 8], [-6, 8], [3, 8], [8, 8]];
/** Прилавки 2×1: торговец и повар. */
export const CITY_STALLS: [number, number][] = [[-6, -3], [4, -3]];
/** Остальное убранство: [вид без стиля, dx, dy]. Виды вида "~x" зависят от стиля (см. STYLE). */
const COMMON: [string, number, number][] = [
  ["well", -4, 3], ["barrel", -7, -3], ["crate", -4, -3], ["barrel", 3, -3], ["crate", 6, -3],
  ["~light", -6, 1], ["~light", 6, 1], ["~light", -2, -4], ["~light", 2, -4], ["~light", -2, 4], ["~light", 2, 4],
  ["~tree", -10, 3], ["~tree", 10, 4], ["~tree", -8, 5], ["~tree", 6, 5],
];
export const STYLE = {
  desert: {
    wall_h: "sand_wall_h", wall_v: "sand_wall_v", tower: "sand_tower", gate: "sand_gate", houses: ["sand_house", "sand_house_b"],
    stalls: ["stall_sand", "stall_green"], light: "lamp", tree: "palm",
    extra: [["tent", -11, -2], ["tent", 9, -2], ["palm", -9, 4], ["palm", 9, -4]] as [string, number, number][],
  },
  solgard: {
    wall_h: "sol_wall_h", wall_v: "sol_wall_v", tower: "sol_tower", gate: "sol_gate", houses: ["sol_house", "sol_temple"],
    stalls: ["stall_gold", "stall_blue"], light: "lamp", tree: "oak",
    extra: [["sun_banner", -11, -2], ["sun_banner", 10, -2], ["sun_statue", -9, 5], ["sun_banner", 9, -4]] as [string, number, number][],
  },
  umbrath: {
    wall_h: "umb_wall_h", wall_v: "umb_wall_v", tower: "umb_tower", gate: "umb_gate", houses: ["umb_house", "umb_crypt"],
    stalls: ["stall_purple", "stall_purple"], light: "soul_brazier", tree: "dead_tree",
    extra: [["crown_banner", -11, -2], ["crown_banner", 10, -2], ["bone_pile", -9, 5], ["dark_obelisk", 9, -4]] as [string, number, number][],
  },
  snow: {
    wall_h: "pal_h", wall_v: "pal_v", tower: "pal_tower", gate: "pal_gate", houses: ["log_house", "log_house_b"],
    stalls: ["stall_blue", "stall_blue"], light: "brazier", tree: "snow_pine",
    extra: [["hay", -10, -2], ["hay", 10, -2], ["snow_rock", -9, 4], ["snow_pine", 9, -4]] as [string, number, number][],
  },
} as const;
export function cityDecor(style: CityStyle): [string, number, number][] {
  const s = STYLE[style];
  const out: [string, number, number][] = COMMON.map(([k, x, y]) => [k === "~light" ? s.light : k === "~tree" ? s.tree : k, x, y]);
  return [...out, ...s.extra.map((e) => [...e] as [string, number, number])];
}

/** Стражники: неподвижные у ворот и патрули (точки маршрута в тайлах, центр клетки = +0.5). */
export const CITY_GATE_GUARDS: [number, number][] = [[-2, -9], [2, -9], [-2, 9], [2, 9]];
export const CITY_PATROLS: [number, number][][] = [
  [[-11.5, -8.5], [12.5, -8.5], [12.5, 9.5], [-11.5, 9.5]],
  [[2.5, -9.5], [2.5, 9.5], [-6.5, 0.5], [6.5, 0.5]],
];
export const CITY_CITIZEN_SPOTS: [number, number][] = [[-8, -4], [8, -4], [-7, 4], [7, 4], [0, 4], [0, -4], [-12, 5], [12, -5]];
export const CITY_CITIZEN_COUNT = 4;
/** Куда выходят ворота (снаружи): для патрулей за стенами не нужны, но пригодятся тестам. */
export const CITY_GATES = [{ id: "n", x: 0, y: -CITY_WALL.y - 1 }, { id: "s", x: 0, y: CITY_WALL.y + 1 }];

const STONE_AT: [number, number] = [3, 2];
const MERCHANT_AT: [number, number] = [-5, -2];
const COOK_AT: [number, number] = [5, -2];
const QUEST_AT: [number, number] = [-9, 2];
export const CITY_RUMOR_AT: [number, number] = [8, 2];

export interface CityNpc {
  id: string;
  name: string;
  sprite: string;
  tint: number;
  color: string;
  greeting?: string;
  /** Пиксели. */
  x: number;
  y: number;
}
export interface City {
  id: string;
  name: string;
  /** Стиль малого города; у Эмберхолла нет. */
  style?: CityStyle;
  /** Столица фракции: здесь появляются и возрождаются её герои; врагам вход под ударами стражи. */
  capital?: string;
  /** Центр в тайлах и полуразмеры зоны. */
  x: number;
  y: number;
  half: { x: number; y: number };
  /** Камень телепорта: клетка (тайлы), точка у его основания и где появляется прибывший (пиксели). */
  stoneTile: { x: number; y: number };
  stone: { x: number; y: number };
  arrive: { x: number; y: number };
  /** Где возрождаются мёртвые игроки (пиксели). */
  spawn: { x: number; y: number };
  merchant?: CityNpc;
  cook?: CityNpc;
  quest?: CityNpc;
  guard?: { name: string; sprite: string; lines: string[] };
  people?: { name: string; sprite: string }[];
}

type RawNpc = { id: string; name: string; sprite: string; tint: string; color: string; greeting?: string };
const tileCenter = (tx: number, ty: number) => ({ x: tx * TILE + 16, y: ty * TILE + 16 });
/** Стоящий за прилавком: x — центр прилавка, y — на клетку ниже с поправкой (как торговка Марфа). */
const npcStall = (c: { x: number; y: number }, at: [number, number], n: RawNpc): CityNpc => ({ ...n, tint: Number(n.tint), x: (c.x + at[0]) * TILE, y: (c.y + at[1]) * TILE + 8 });
const npcTile = (c: { x: number; y: number }, at: [number, number], n: RawNpc): CityNpc => ({ ...n, tint: Number(n.tint), ...tileCenter(c.x + at[0], c.y + at[1]) });

type CityId = Exclude<keyof typeof data, "_doc">;
function small(id: CityId, style: CityStyle, x: number, y: number): City {
  const d = data[id] as (typeof data)[CityId] & { capital?: string };
  const c = { x, y };
  const st = { x: x + STONE_AT[0], y: y + STONE_AT[1] };
  return {
    id, name: d.name, style, x, y, half: CITY_HALF,
    stoneTile: st,
    stone: { x: st.x * TILE + 16, y: (st.y + 1) * TILE - 2 },
    arrive: tileCenter(st.x, st.y + 1),
    // столица: в центре площади (просторно — сюда приходят новички); малый город — у колодца
    spawn: d.capital ? tileCenter(x, y) : tileCenter(x, y + 4),
    merchant: npcStall(c, MERCHANT_AT, d.merchant),
    cook: npcStall(c, COOK_AT, d.cook),
    quest: npcTile(c, QUEST_AT, d.quest),
    guard: d.guard,
    people: d.people,
    capital: d.capital,
  };
}

const EMBER_STONE = { x: TOWN.x + 5, y: TOWN.y + 3 };
export const CITIES: City[] = [
  {
    id: "ember", name: "Эмберхолл", x: TOWN.x, y: TOWN.y, half: TOWN_HALF,
    stoneTile: EMBER_STONE,
    stone: { x: EMBER_STONE.x * TILE + 16, y: (EMBER_STONE.y + 1) * TILE - 2 },
    arrive: tileCenter(EMBER_STONE.x, EMBER_STONE.y + 1),
    spawn: tileCenter(TOWN.x, TOWN.y + 3),
  },
  small("oasis", "desert", 30 + MID.x, 152 + MID.y),
  small("snow_valley", "snow", 112 + MID.x, 18 + MID.y),
  // столицы на противоположных краях мира
  small("aurelion", "solgard", 56, 180),
  small("morthaim", "umbrath", MAP_W - 57, 180),
];
export const cityById = (id: string) => CITIES.find((c) => c.id === id);
/** Столица фракции (место появления и возрождения её героев); без фракции — Эмберхолл. */
export const homeCity = (faction: string | undefined): City => CITIES.find((c) => c.capital && c.capital === faction) ?? CITIES[0];
/** Чужая столица: телепорт не открывается, возрождения там нет. */
export const isEnemyCapital = (c: City, faction: string | undefined) => !!c.capital && c.capital !== faction;
/** Открыт ли город для героя: своя столица — всегда, остальные — после первого визита пешком. */
export function cityKnown(c: City, found: readonly string[] | undefined, faction: string | undefined): boolean {
  if (isEnemyCapital(c, faction)) return false;
  if (!faction) return c.id === "ember" || !!found?.includes(c.id);
  return homeCity(faction).id === c.id || !!found?.includes(c.id);
}
/** Город, в чьей зоне лежит клетка (тайлы), или null. */
export function cityAtTile(x: number, y: number): City | null {
  for (const c of CITIES) if (Math.abs(x - c.x) <= c.half.x && Math.abs(y - c.y) <= c.half.y) return c;
  return null;
}
/** Ближайший к точке (пиксели) город из открытых герою: своя столица открыта всегда (без фракции — Эмберхолл). */
export function nearestCity(found: readonly string[] | undefined, px: number, py: number, faction?: string): City {
  let best = homeCity(faction), bd = Infinity;
  for (const c of CITIES) {
    if (!cityKnown(c, found, faction)) continue;
    const d = Math.hypot(c.spawn.x - px, c.spawn.y - py);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ---------- телепорт ----------
export const TELEPORT_CAST_MS = 3000;
/** Телепорт нельзя, пока не прошло столько мс после последнего боя. */
export const TELEPORT_COMBAT_MS = 8000;
export const TELEPORT_RANGE = 110;
/** Цена по расстоянию между городами: 50–200 золота. */
export function teleportPrice(a: City, b: City): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return Math.max(50, Math.min(200, Math.round((d * 1.4) / 10) * 10));
}
/** Камень, рядом с которым стоит точка (пиксели), или null. */
export function stoneNear(px: number, py: number): City | null {
  for (const c of CITIES) if (Math.hypot(c.stone.x - px, c.stone.y - 14 - py) <= TELEPORT_RANGE) return c;
  return null;
}
