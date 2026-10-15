/**
 * Детерминированный генератор карты. Клиент и сервер вызывают generateMap(seed)
 * и получают одинаковый мир, поэтому карта не передаётся по сети.
 * Внутри только целочисленный хэш и арифметика (никаких Math.sin/pow), чтобы
 * результат был побитово одинаковым в браузере и в Node.
 */
import { ENV, resourceOfNode, type MapNode } from "./biomes";
import { MAP_H, MAP_W, TILE } from "./constants";
import { BUILDINGS, inTownRect, isGate, STALLS, TOWERS, TOWN, TOWN_HALF, townGround, WALL } from "./town";

export { TOWN } from "./town";

/** Типы поверхности в порядке отрисовки: следующий рисуется краем поверх предыдущего. */
export enum T {
  Water,
  Lava,
  Sand,
  Bog,
  Ash,
  Dirt,
  Grass,
  Forest,
  Cobble,
  Floor,
  Snow,
  Ice,
  Obsidian,
  Dune,
  Seabed,
}
export const TERRAIN_COUNT = 15;
export const TERRAIN_KEYS = ["water", "lava", "sand", "bog", "ash", "dirt", "grass", "forest", "cobble", "floor", "snow", "ice", "obsidian", "dune", "seabed"];
const BLOCKING = new Set<T>([T.Water, T.Lava]);

export enum Zone {
  Town,
  Meadow,
  Forest,
  Swamp,
  Ashlands,
  Dungeon,
  Arena,
  Frontier,
  Desert,
  Snow,
  Volcano,
  Underwater,
}
export interface ZoneInfo {
  name: string;
  levels: [number, number];
  safe: boolean;
  mobs: string[];
  /** Подпись под названием зоны вместо уровней. */
  note?: string;
}
export const ZONES: ZoneInfo[] = [
  { name: "Город Эмберхолл", levels: [0, 0], safe: true, mobs: [] },
  { name: "Зелёные холмы", levels: [1, 8], safe: false, mobs: ["slime", "boar", "goblin"] },
  { name: "Шепчущий лес", levels: [8, 15], safe: false, mobs: ["wolf", "spider", "goblin_shaman"] },
  { name: "Гнилые топи", levels: [15, 22], safe: false, mobs: ["skeleton", "drowned", "toxic_slime"] },
  { name: "Пепельная пустошь", levels: [22, 26], safe: false, mobs: ["imp", "golem", "skeleton"] },
  { name: "Пепельные чертоги", levels: [26, 30], safe: false, mobs: ["skeleton_knight", "imp", "golem"] },
  { name: "Арена", levels: [0, 0], safe: false, mobs: [] },
  { name: "Неизведанные земли", levels: [0, 0], safe: false, mobs: [], note: "Дикие края, сюда ещё не добрались" },
  // Биомы Неизведанных земель (уровни не выше капа 30, продолжают прогрессию)
  { name: "Пустыня Миражей", levels: [18, 24], safe: false, mobs: ["jackal", "scorpion"] },
  { name: "Снежные пики", levels: [20, 26], safe: false, mobs: ["frost_wolf", "ice_golem"] },
  { name: "Пылающий вулкан", levels: [26, 30], safe: false, mobs: ["magma_slime", "lava_hound"] },
  { name: "Затонувшая бухта", levels: [22, 28], safe: false, mobs: ["jellyfish", "sea_crab"] },
];

/** Версия раскладки мира: при смене позиции из старых сохранений сбрасываются к точке появления. */
export const MAP_VERSION = 3;

export const CELL_BLOCK = 1;
export const CELL_WALL = 2;
export const CELL_RESERVED = 4; // дороги, арены, город: без декора и мобов

export interface MapObject {
  kind: string;
  /** Пиксели: нижняя середина спрайта. */
  x: number;
  y: number;
}
export interface SpawnPoint {
  x: number;
  y: number;
  mob: string;
  level: number;
}
export interface BossSpawn {
  id: string;
  x: number;
  y: number;
  arena: number; // радиус арены в пикселях
}
export interface WorldMap {
  w: number;
  h: number;
  seed: number;
  /** (w+1)*(h+1) вершин: тип поверхности в углах тайлов (dual grid). */
  vtx: Uint8Array;
  cell: Uint8Array;
  zone: Uint8Array;
  objects: MapObject[];
  spawns: SpawnPoint[];
  bosses: BossSpawn[];
  /** Узлы добычи ресурсов (id — индекс в objects) и воздушные пузыри под водой (пиксели). */
  nodes: MapNode[];
  vents: { x: number; y: number }[];
  playerSpawn: { x: number; y: number };
  merchant: { x: number; y: number };
}

/** Какие объекты непроходимы и сколько клеток занимают (от клетки привязки вправо и вверх). */
export const OBJECT_FOOTPRINT: Record<string, { w: number; h: number } | undefined> = {
  oak: { w: 1, h: 1 },
  pine: { w: 1, h: 1 },
  dead_tree: { w: 1, h: 1 },
  rock: { w: 1, h: 1 },
  big_rock: { w: 2, h: 1 },
  house: { w: 4, h: 3 },
  house_blue: { w: 4, h: 3 },
  fountain: { w: 2, h: 2 },
  stall: { w: 2, h: 1 },
  pillar: { w: 1, h: 1 },
  crate: { w: 1, h: 1 },
  lamp: { w: 1, h: 1 },
  well: { w: 1, h: 1 },
  barrel: { w: 1, h: 1 },
  stall_blue: { w: 2, h: 1 },
  stall_green: { w: 2, h: 1 },
  wall_h: { w: 1, h: 1 },
  wall_v: { w: 1, h: 1 },
  tower: { w: 2, h: 2 },
  tavern: { w: 7, h: 4 },
  bank: { w: 6, h: 4 },
  forge: { w: 5, h: 3 },
  arena_gate: { w: 4, h: 2 },
  anvil: { w: 1, h: 1 },
  cauldron: { w: 1, h: 1 },
  dummy: { w: 1, h: 1 },
  weapon_rack: { w: 1, h: 1 },
  hay: { w: 1, h: 1 },
  cactus: { w: 1, h: 1 },
  palm: { w: 1, h: 1 },
  sandstone: { w: 1, h: 1 },
  snow_pine: { w: 1, h: 1 },
  snow_rock: { w: 1, h: 1 },
  ice_spike: { w: 1, h: 1 },
  obsidian_spire: { w: 1, h: 1 },
  basalt: { w: 1, h: 1 },
  coral_a: { w: 1, h: 1 },
  coral_b: { w: 1, h: 1 },
  node_cactus: { w: 1, h: 1 },
  node_ice: { w: 1, h: 1 },
  node_obsidian: { w: 1, h: 1 },
  node_pearl: { w: 1, h: 1 },
};

/** Сдвиг данжа относительно прежней карты 180×140 (данж нарисован вручную и не масштабируется). */
const DG = { x: 82, y: 50 };
const DUNGEON = { x0: 120 + DG.x, y0: 52 + DG.y, x1: 176 + DG.x, y1: 90 + DG.y };
const DUNGEON_ROOMS = ([
  [122, 66, 133, 77], // прихожая
  [120, 70, 124, 73], // ворота
  [133, 70, 141, 73],
  [140, 56, 151, 68], // северный зал
  [140, 75, 151, 87], // южный зал
  [143, 68, 148, 76],
  [151, 70, 157, 73],
  [156, 59, 175, 84], // зал босса
] as const).map(([x0, y0, x1, y1]) => [x0 + DG.x, y0 + DG.y, x1 + DG.x, y1 + DG.y] as [number, number, number, number]);
const LAVA_POOLS: [number, number, number][] = ([
  [145.5, 61.5, 2.6],
  [146, 81.5, 2.4],
  [127.5, 74.5, 1.6],
  [160.5, 63.5, 1.8],
  [160.5, 79.5, 1.8],
] as const).map(([x, y, r]) => [x + DG.x, y + DG.y, r] as [number, number, number]);
/**
 * Освоенная часть мира (зоны 1–30). Вокруг неё — «Неизведанные земли» под будущие города и биомы:
 * запад (пустыня), север (снега), восток (вулкан), юг (побережье и подводный мир).
 */
export const CORE = { x0: 52, y0: 36, x1: 268, y1: 204 };
/** Масштаб освоенной части относительно прежней карты (границы зон, уровни мобов). */
const S = 1.2;
const sx = (x: number) => CORE.x0 + x * S, sy = (y: number) => CORE.y0 + y * S;
const HUB = { x: 136, y: 121 };
const ROADS: [number, number][][] = [
  [[TOWN.x + TOWN_HALF.x, TOWN.y + 0.5], [HUB.x, HUB.y], [170, 121], [DUNGEON.x0, 121.5]],
  [[HUB.x, HUB.y], [143, 98], [167, 77], [201, 65], [222, 60]],
  [[HUB.x, HUB.y], [144, 146], [172, 168], [201, 179], [222, 181]],
  [[TOWN.x - TOWN_HALF.x, TOWN.y + 0.5], [40, 122], [3, 120]],
  [[TOWN.x + 0.5, TOWN.y - TOWN_HALF.y], [88, 70], [92, 3]],
  [[TOWN.x + 0.5, TOWN.y + TOWN_HALF.y + 1], [88, 175], [91, 237]],
  // дороги в биомы: пустыня (оазис), снега (долина), вулкан (две ветки), подводная бухта
  [[40, 122], [31, 138], [24, 151]],
  [[89, 40], [102, 26], [111, 19]],
  [[201, 65], [238, 40], [276, 50], [306, 64]],
  [[201, 179], [240, 204], [280, 196], [306, 184]],
  [[172, 168], [169, 200], [171, 224]],
];
/** Ровные площадки под будущие города (центр в тайлах, r — радиус свободной зоны). */
export const CITY_SITES = [
  { id: "oasis", name: "Оазис Миражей", biome: Zone.Desert, x: 24, y: 152, r: 10 },
  { id: "snow_valley", name: "Снежная долина", biome: Zone.Snow, x: 112, y: 18, r: 10 },
];
/** Расстояние до ближайшей площадки в долях её радиуса (меньше 1 — внутри). */
function siteDist(x: number, y: number): number {
  let best = 1e9;
  for (const s of CITY_SITES) best = Math.min(best, Math.hypot(x - s.x, y - s.y) / s.r);
  return best;
}
/** Пруд оазиса (центр в тайлах). */
const OASIS_POND = { x: CITY_SITES[0].x - 14, y: CITY_SITES[0].y };
export const BOSS_SPAWNS: BossSpawn[] = [
  { id: "ent", x: 234 * TILE, y: 60 * TILE, arena: 10 * TILE },
  { id: "witch", x: 234 * TILE, y: 181 * TILE, arena: 10 * TILE },
  { id: "ashlord", x: (168 + DG.x) * TILE, y: (71.5 + DG.y) * TILE, arena: 12 * TILE },
];
/** Расстояние в тайлах от точки (в тайлах) до прямоугольника города (0 внутри). */
export function townDist(x: number, y: number): number {
  const ex = Math.max(0, Math.abs(x - (TOWN.x + 0.5)) - TOWN_HALF.x - 0.5);
  const ey = Math.max(0, Math.abs(y - (TOWN.y + 0.5)) - TOWN_HALF.y - 0.5);
  return Math.sqrt(ex * ex + ey * ey);
}

// ---------- шум и случайность ----------
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, scale: number, s: number): number {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
export function fbm(x: number, y: number, s: number): number {
  return vnoise(x, y, 18, s) * 0.55 + vnoise(x, y, 8, s + 11) * 0.3 + vnoise(x, y, 3.5, s + 23) * 0.15;
}
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}
export function roadDist(x: number, y: number): number {
  let best = 1e9;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) {
    const d = segDist(x, y, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}
const inDungeon = (x: number, y: number) => x >= DUNGEON.x0 && x < DUNGEON.x1 && y >= DUNGEON.y0 && y < DUNGEON.y1;
function inRooms(cx: number, cy: number) {
  for (const [x0, y0, x1, y1] of DUNGEON_ROOMS) if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) return true;
  return false;
}
function bossNear(x: number, y: number, extra: number): BossSpawn | null {
  for (const b of BOSS_SPAWNS) {
    const dx = x - b.x / TILE, dy = y - b.y / TILE, r = b.arena / TILE + extra;
    if (dx * dx + dy * dy < r * r) return b;
  }
  return null;
}

/** Биом Неизведанных земель: запад — пустыня, север — снега, восток — вулкан, юг — подводная бухта между ними. */
function frontierZone(x: number, y: number, seed: number): Zone {
  const n = (fbm(x, y, seed + 29) - 0.5) * 0.4;
  const l = (CORE.x0 - x) / 52 + n, r = (x - CORE.x1) / 52 - n, t = (CORE.y0 - y) / 36, b = (y - CORE.y1) / 36;
  const m = Math.max(l, r, t, b);
  if (m === b) return Math.abs(x - 170 + n * 30) < 62 ? Zone.Underwater : x < 170 ? Zone.Desert : Zone.Volcano;
  if (m === l) return Zone.Desert;
  if (m === t) return Zone.Snow;
  return Zone.Volcano;
}

export function zoneAt(x: number, y: number, seed: number): Zone {
  if (inDungeon(x, y)) return Zone.Dungeon;
  if (inTownRect(Math.floor(x) - TOWN.x, Math.floor(y) - TOWN.y)) return Zone.Town;
  const e = (fbm(x, y, seed + 17) - 0.5) * 16;
  if (x < CORE.x0 + e || x > CORE.x1 - e || y < CORE.y0 + e || y > CORE.y1 - e) return frontierZone(x, y, seed);
  const w = (fbm(x, y, seed + 5) - 0.5) * 30 * S;
  if (x + w > sx(98) && y + w * 0.5 > sy(44) && y + w * 0.5 < sy(97)) return Zone.Ashlands;
  if (x > sx(54) + w * 0.5 && y + w < sy(44)) return Zone.Forest;
  if (x > sx(54) + w * 0.5 && y + w > sy(97)) return Zone.Swamp;
  return Zone.Meadow;
}

function terrainAt(x: number, y: number, seed: number): T {
  const n = fbm(x, y, seed);
  const z = zoneAt(x, y, seed);
  const edge = Math.min(x, y, MAP_W - x, MAP_H - y) + (n - 0.5) * 8;
  if (z !== Zone.Dungeon && edge < 2.6) return T.Water;
  if (z !== Zone.Dungeon && edge < 4.6) return z === Zone.Snow ? T.Ice : z === Zone.Volcano ? T.Obsidian : z === Zone.Underwater ? T.Seabed : T.Sand;
  if (z === Zone.Dungeon) {
    for (const [lx, ly, r] of LAVA_POOLS) {
      const ddx = x - lx, ddy = y - ly;
      if (ddx * ddx + ddy * ddy < r * r * (0.8 + n * 0.4)) return T.Lava;
    }
    return T.Floor;
  }
  const road = roadDist(x, y);
  const roadW = 1.25 + (n - 0.5) * 0.8;
  const arena = bossNear(x, y, 0);
  switch (z) {
    case Zone.Town: {
      // вершина dual grid — мостовая, если хоть одна из 4 соседних клеток мощёная
      const vx = Math.round(x) - TOWN.x, vy = Math.round(y) - TOWN.y;
      let dirt = false;
      for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const g = townGround(vx + ox, vy + oy);
        if (g === "cobble") return T.Cobble;
        if (g === "dirt") dirt = true;
      }
      return dirt ? T.Dirt : T.Grass;
    }
    case Zone.Frontier:
    case Zone.Meadow: {
      if (road < roadW) return T.Dirt;
      const p = fbm(x, y, seed + 40);
      if (road > 4 && p < 0.22) return T.Water;
      if (road > 3 && p < 0.26) return T.Sand;
      if (fbm(x, y, seed + 60) > 0.74) return T.Forest;
      return T.Grass;
    }
    case Zone.Forest: {
      if (road < roadW) return T.Dirt;
      if (arena) return T.Grass;
      const p = fbm(x, y, seed + 60);
      if (p < 0.3) return T.Grass;
      if (road > 4 && fbm(x, y, seed + 40) < 0.17) return T.Water;
      return T.Forest;
    }
    case Zone.Swamp: {
      if (road < roadW) return T.Dirt;
      const p = fbm(x, y, seed + 40);
      if (arena) return p > 0.6 ? T.Grass : T.Bog;
      if (road > 3 && p < 0.41) return T.Water;
      if (p > 0.72) return T.Grass;
      return T.Bog;
    }
    case Zone.Ashlands: {
      if (road < roadW) return T.Dirt;
      if (road > 3 && fbm(x, y, seed + 80) < 0.17) return T.Lava;
      return T.Ash;
    }
    case Zone.Desert: {
      if (road < roadW) return T.Dirt;
      if (siteDist(x, y) < 1.1) return T.Dune;
      const pd = Math.hypot(x - OASIS_POND.x, y - OASIS_POND.y);
      if (pd < 2.4 + (n - 0.5) * 2) return T.Water;
      if (pd < 4.2) return T.Sand;
      const p = fbm(x, y, seed + 41);
      if (p > 0.68) return T.Sand;
      if (p < 0.18 && road > 3) return T.Dirt;
      return T.Dune;
    }
    case Zone.Snow: {
      if (road < roadW) return T.Dirt;
      if (siteDist(x, y) < 1.1) return T.Snow;
      const p = fbm(x, y, seed + 43);
      if (road > 4 && p < 0.15) return T.Water;
      if (p < 0.25) return T.Ice;
      return T.Snow;
    }
    case Zone.Volcano: {
      if (road < roadW) return T.Dirt;
      if (road > 3 && fbm(x, y, seed + 82) < 0.2) return T.Lava;
      if (fbm(x, y, seed + 83) > 0.6) return T.Obsidian;
      return T.Ash;
    }
    case Zone.Underwater:
      return fbm(x, y, seed + 47) > 0.64 ? T.Sand : T.Seabed;
  }
  return T.Grass;
}

type Place = (kind: string, x: number, y: number, jitter?: number) => void;

/** Эмберхолл: стены с башнями и воротами, дома, таверна, кузница, банк, рынок, площадь с фонтаном. */
function buildTown(seed: number, w: number, cell: Uint8Array, vtx: Uint8Array, objects: MapObject[], place: Place) {
  const X = (dx: number) => TOWN.x + dx, Y = (dy: number) => TOWN.y + dy;
  const fits = (kind: string, x: number, y: number) => {
    const f = OBJECT_FOOTPRINT[kind] ?? { w: 1, h: 1 };
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) if (cell[(y - j) * w + x + i] & CELL_BLOCK) return false;
    return true;
  };
  const put = (kind: string, dx: number, dy: number) => {
    if (fits(kind, X(dx), Y(dy))) place(kind, X(dx), Y(dy));
  };
  // башни и стены
  const towerCells = new Set<number>();
  for (const [dx, dy] of TOWERS) {
    place("tower", X(dx), Y(dy));
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) towerCells.add((dy - j) * 1000 + dx + i);
  }
  const wallOk = (dx: number, dy: number) => !isGate(dx, dy) && !towerCells.has(dy * 1000 + dx);
  for (let dx = -WALL.x; dx <= WALL.x; dx++) for (const dy of [-WALL.y, WALL.y]) if (wallOk(dx, dy)) place("wall_h", X(dx), Y(dy));
  for (let dy = -WALL.y + 1; dy < WALL.y; dy++) for (const dx of [-WALL.x, WALL.x]) if (wallOk(dx, dy)) place("wall_v", X(dx), Y(dy));
  for (const dy of [-WALL.y, WALL.y]) objects.push({ kind: "gate_arch", x: X(0) * TILE + 16, y: (Y(dy) + 1) * TILE - 2 });
  // здания (двери проходимы — в них можно «зайти»)
  for (const b of BUILDINGS) {
    place(b.kind, X(b.x), Y(b.y));
    for (const d of b.door ?? []) cell[Y(b.y) * w + X(b.x + d)] &= ~CELL_BLOCK;
  }
  place("fountain", X(-1), Y(0));
  for (const s of STALLS) place(s.kind, X(s.x), Y(s.y));
  const decor: [string, number, number][] = [
    ["cauldron", -10, -5], ["barrel", -10, -6], ["crate", -3, -6], ["barrel", 9, -6], ["crate", 10, -6],
    ["anvil", 19, -3], ["barrel", 20, -3], ["crate", 21, -3], ["hay", 21, -6], ["barrel", 13, -3],
    ["barrel", -21, -3], ["barrel", -21, -4], ["crate", -13, -3], ["barrel", -13, -4],
    ["lamp", -20, 7], ["lamp", -14, 7], ["barrel", -21, 3],
    ["dummy", 14, 6], ["dummy", 20, 6], ["weapon_rack", 13, 4], ["weapon_rack", 20, 3],
    ["lamp", -10, -7], ["lamp", 10, -7], ["lamp", -10, 7], ["lamp", 10, 7],
    ["lamp", -3, -2], ["lamp", 3, -2], ["lamp", -2, 2], ["lamp", 2, 2],
    ["oak", -10, 3], ["oak", -7, 6], ["oak", 8, 3], ["oak", 10, 5], ["pine", 7, 7], ["oak", -10, 7],
    ["lamp", -2, -10], ["lamp", 2, -10], ["lamp", -13, -10], ["lamp", 13, -10],
    ["lamp", -2, 10], ["lamp", 2, 10], ["lamp", -13, 10], ["lamp", 13, 10],
    ["well", -9, 6],
  ];
  for (const [k, dx, dy] of decor) put(k, dx, dy);
  // сады за домами и цветы во дворах
  const r = rng(seed + 7);
  for (let dy = -WALL.y + 1; dy < WALL.y; dy++) for (let dx = -WALL.x + 1; dx < WALL.x; dx++) {
    const x = X(dx), y = Y(dy);
    if (cell[y * w + x] & CELL_BLOCK || townGround(dx, dy) !== "grass") continue;
    const garden = (dy >= -16 && dy <= -14) || (dy >= 10 && dy <= 12);
    const roll = r();
    if (garden && roll < 0.14 && townGround(dx, dy + 1) === "grass") place(roll < 0.1 ? "oak" : "pine", x, y, Math.floor((r() - 0.5) * 8));
    else if (roll < (garden ? 0.24 : Math.abs(dx) <= 10 && dy >= 2 && dy <= 7 ? 0.07 : 0)) objects.push({ kind: "bush", x: x * TILE + 16, y: y * TILE + 30 });
    else if (hash(x, y, seed + 3) < 0.16) objects.push({ kind: "flowers", x: x * TILE + 16, y: y * TILE + 30 });
  }
  void vtx;
}

export function generateMap(seed: number): WorldMap {
  const w = MAP_W, h = MAP_H;
  const vtx = new Uint8Array((w + 1) * (h + 1));
  const cell = new Uint8Array(w * h);
  const zone = new Uint8Array(w * h);
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) vtx[y * (w + 1) + x] = terrainAt(x, y, seed);

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const cx = x + 0.5, cy = y + 0.5;
    const z = zoneAt(cx, cy, seed);
    zone[i] = z;
    let f = 0;
    if (BLOCKING.has(terrainAt(cx, cy, seed))) f |= CELL_BLOCK;
    if (z === Zone.Dungeon && !inRooms(x, y)) f |= CELL_BLOCK | CELL_WALL;
    if (z === Zone.Town || roadDist(cx, cy) < 2.2 || siteDist(cx, cy) < 1.15 || bossNear(cx, cy, 1) || townDist(cx, cy) < 3) f |= CELL_RESERVED;
    cell[i] = f;
  }

  const objects: MapObject[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? CELL_BLOCK : cell[y * w + x]);
  const free = (x: number, y: number, fw = 1, fh = 1) => {
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (at(x + i, y - j) & CELL_BLOCK) return false;
    return true;
  };
  const place = (kind: string, x: number, y: number, jitter = 0) => {
    const fp = OBJECT_FOOTPRINT[kind];
    if (fp) for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) cell[(y - j) * w + x + i] |= CELL_BLOCK;
    const fw = fp ? fp.w : 1;
    objects.push({ kind, x: (x + fw / 2) * TILE + jitter, y: (y + 1) * TILE - 2 });
  };

  buildTown(seed, w, cell, vtx, objects, place);
  const nodes: MapNode[] = [];
  const vents: { x: number; y: number }[] = [];
  const placeNode = (kind: string, x: number, y: number) => {
    const res = resourceOfNode(kind);
    if (!res) return;
    nodes.push({ id: objects.length, kind, res: res.id, x: (x + 0.5) * TILE, y: (y + 1) * TILE - 2 });
    place(kind, x, y);
  };
  const deco = (kind: string, x: number, y: number, jit: number, dy = 30) => objects.push({ kind, x: x * TILE + 16 + jit, y: y * TILE + dy });

  // Природа по зонам.
  const r = rng(seed + 99);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const f = cell[i];
    const roll = r(), jit = Math.floor((r() - 0.5) * 10);
    if (f & (CELL_BLOCK | CELL_RESERVED)) {
      if (f & CELL_WALL || !(f & CELL_BLOCK) || zone[i] === Zone.Town) continue;
      // вода: кувшинки и камыш у берега
      const t = vtx[y * (w + 1) + x];
      if (t === T.Water && zone[i] === Zone.Swamp && roll < 0.05) objects.push({ kind: "lilypad", x: x * TILE + 16 + jit, y: y * TILE + 24 });
      continue;
    }
    const t = vtx[y * (w + 1) + x];
    const z = zone[i];
    const nearWater = (at(x + 1, y) | at(x - 1, y) | at(x, y + 1) | at(x, y - 1)) & CELL_BLOCK;
    if (z === Zone.Meadow || z === Zone.Frontier) {
      if (t === T.Forest && roll < 0.16) place(roll < 0.08 ? "pine" : "oak", x, y, jit);
      else if (roll < 0.022) place("oak", x, y, jit);
      else if (roll < 0.04) objects.push({ kind: "bush", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.05) place("rock", x, y);
      else if (roll < 0.11 && t === T.Grass) objects.push({ kind: "flowers", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.18 && t === T.Grass) objects.push({ kind: "tallgrass", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (nearWater && roll < 0.3) objects.push({ kind: "reeds", x: x * TILE + 16 + jit, y: y * TILE + 30 });
    } else if (z === Zone.Forest) {
      if (t === T.Forest && roll < 0.2) place(roll < 0.13 ? "pine" : "oak", x, y, jit);
      else if (roll < 0.035) place("oak", x, y, jit);
      else if (roll < 0.07) objects.push({ kind: "mushrooms", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.13) objects.push({ kind: "fern", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.15) objects.push({ kind: "bush", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.16) place("rock", x, y);
    } else if (z === Zone.Swamp) {
      if (roll < 0.05) place("dead_tree", x, y, jit);
      else if (nearWater && roll < 0.3) objects.push({ kind: "reeds", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.09) objects.push({ kind: "mushrooms_glow", x: x * TILE + 16 + jit, y: y * TILE + 30 });
      else if (roll < 0.1) objects.push({ kind: "bones", x: x * TILE + 16 + jit, y: y * TILE + 28 });
      else if (roll < 0.14 && t === T.Grass) objects.push({ kind: "tallgrass", x: x * TILE + 16 + jit, y: y * TILE + 30 });
    } else if (z === Zone.Ashlands) {
      if (roll < 0.025) place("dead_tree", x, y, jit);
      else if (roll < 0.05) place("rock", x, y);
      else if (roll < 0.058 && free(x, y) && free(x + 1, y)) place("big_rock", x, y);
      else if (roll < 0.075) objects.push({ kind: "bones", x: x * TILE + 16 + jit, y: y * TILE + 28 });
      else if (roll < 0.1) objects.push({ kind: "ember_vent", x: x * TILE + 16 + jit, y: y * TILE + 28 });
      else if (roll < 0.12) objects.push({ kind: "crystal", x: x * TILE + 16 + jit, y: y * TILE + 30 });
    } else if (z === Zone.Desert) {
      const pd = Math.hypot(x - OASIS_POND.x, y - OASIS_POND.y);
      if (pd < 9 && pd > 3.5 && roll < 0.2) place("palm", x, y, jit);
      else if (roll < 0.03) place("cactus", x, y, jit);
      else if (roll < 0.06) deco("cactus_small", x, y, jit);
      else if (roll < 0.075) place("sandstone", x, y);
      else if (roll < 0.1) deco("dry_bush", x, y, jit);
      else if (roll < 0.11) deco("bones", x, y, jit, 28);
      else if (roll < 0.1125) placeNode("node_cactus", x, y);
    } else if (z === Zone.Snow) {
      if (roll < 0.07 && t === T.Snow) place("snow_pine", x, y, jit);
      else if (roll < 0.09) place("snow_rock", x, y);
      else if (roll < 0.105) place("ice_spike", x, y);
      else if (roll < 0.14) deco("snow_bush", x, y, jit);
      else if (roll < 0.147) deco("bones", x, y, jit, 28);
      else if (roll < 0.1495) placeNode("node_ice", x, y);
    } else if (z === Zone.Volcano) {
      if (roll < 0.03) place("obsidian_spire", x, y, jit);
      else if (roll < 0.055) place("basalt", x, y);
      else if (roll < 0.075) deco("ember_vent", x, y, jit, 28);
      else if (roll < 0.088) place("dead_tree", x, y, jit);
      else if (roll < 0.1) deco("crystal", x, y, jit);
      else if (roll < 0.108) deco("bones", x, y, jit, 28);
      else if (roll < 0.1105) placeNode("node_obsidian", x, y);
    } else if (z === Zone.Underwater) {
      if (x % 24 === 10 && y % 16 === 8) {
        deco("air_vent", x, y, 0, 28);
        vents.push({ x: x * TILE + 16, y: y * TILE + 16 });
      } else if (roll < 0.05) place("coral_a", x, y, jit);
      else if (roll < 0.09) place("coral_b", x, y, jit);
      else if (roll < 0.16) deco("kelp", x, y, jit);
      else if (roll < 0.2) deco("shell", x, y, jit, 28);
      else if (roll < 0.2035) placeNode("node_pearl", x, y);
    } else if (z === Zone.Dungeon) {
      if (roll < 0.012) objects.push({ kind: "bones", x: x * TILE + 16 + jit, y: y * TILE + 28 });
      else if (roll < 0.018 && !bossNear(x, y, 2)) place("crate", x, y);
    }
  }
  // Данж: колонны, факелы на стенах.
  for (const [px, py] of [[142, 58], [149, 58], [142, 66], [149, 66], [142, 77], [149, 77], [142, 85], [149, 85], [159, 62], [172, 62], [159, 81], [172, 81]])
    place("pillar", px + DG.x, py + DG.y);
  for (let y = DUNGEON.y0; y < DUNGEON.y1 - 1; y++) for (let x = DUNGEON.x0; x < DUNGEON.x1; x++) {
    const wall = at(x, y) & CELL_WALL, below = at(x, y + 1) & CELL_WALL;
    if (wall && !below && hash(x, y, seed + 9) < 0.22) objects.push({ kind: "torch", x: x * TILE + 16, y: y * TILE + 26 });
  }
  objects.push({ kind: "torch", x: DUNGEON.x0 * TILE + 16, y: (69 + DG.y) * TILE + 26 }, { kind: "torch", x: DUNGEON.x0 * TILE + 16, y: (74 + DG.y) * TILE - 6 });

  // Точки появления мобов.
  const spawns: SpawnPoint[] = [];
  const quota: Record<number, number> = { [Zone.Meadow]: 76, [Zone.Forest]: 64, [Zone.Swamp]: 62, [Zone.Ashlands]: 30, [Zone.Dungeon]: 30, [Zone.Desert]: 40, [Zone.Snow]: 40, [Zone.Volcano]: 34, [Zone.Underwater]: 34 };
  const rs = rng(seed + 555);
  const taken: { x: number; y: number }[] = [];
  let guard = 0;
  while (Object.values(quota).some((q) => q > 0) && guard++ < 300000) {
    const x = 2 + Math.floor(rs() * (w - 4)), y = 2 + Math.floor(rs() * (h - 4));
    const i = y * w + x;
    const z = zone[i] as Zone;
    if (!quota[z] || cell[i] & CELL_BLOCK) continue;
    if (z !== Zone.Dungeon && cell[i] & CELL_RESERVED && roadDist(x + 0.5, y + 0.5) < 2.2 && rs() < 0.8) continue;
    if (bossNear(x, y, 4)) continue;
    // вокруг стен — полоса без мобов (стражи и так их не пустят)
    const dt = townDist(x + 0.5, y + 0.5);
    if (dt < 11 || siteDist(x + 0.5, y + 0.5) < 1.6) continue;
    if (taken.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 16)) continue;
    const info = ZONES[z];
    const [lo, hi] = info.levels;
    let k: number;
    if (z === Zone.Meadow) k = Math.min(1, (dt - 11) / 58);
    else if (z === Zone.Dungeon) k = (x - DUNGEON.x0) / (156 - 120);
    else if (z === Zone.Desert) k = (CORE.x0 - x) / CORE.x0;
    else if (z === Zone.Snow) k = (CORE.y0 - y) / CORE.y0;
    else if (z === Zone.Volcano) k = (x - CORE.x1) / (MAP_W - CORE.x1);
    else if (z === Zone.Underwater) k = (y - CORE.y1) / (MAP_H - CORE.y1);
    else k = Math.min(1, Math.max(0, (x - sx(54)) / (110 * S)));
    k = Math.min(1, Math.max(0, k));
    const level = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * k + (rs() - 0.5) * 2)));
    const mobs = info.mobs;
    // первый моб в списке зоны слабее и чаще ближе к началу
    const idx = Math.min(mobs.length - 1, Math.floor(k * mobs.length * 0.7 + rs() * mobs.length * 0.6));
    spawns.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, mob: mobs[idx], level });
    taken.push({ x, y });
    quota[z]--;
  }

  return {
    w,
    h,
    seed,
    vtx,
    cell,
    zone,
    objects,
    spawns,
    bosses: BOSS_SPAWNS,
    nodes,
    vents,
    playerSpawn: { x: TOWN.x * TILE + 16, y: (TOWN.y + 3) * TILE + 16 },
    // торговка Марфа — за прилавком на рынке (прилавок STALLS[2])
    merchant: { x: (TOWN.x + 5) * TILE, y: (TOWN.y - 5) * TILE + 8 },
  };
}

// ---------- запросы к карте ----------
export function cellAt(m: WorldMap, px: number, py: number): number {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return CELL_BLOCK;
  return m.cell[y * m.w + x];
}
export function zoneAtPx(m: WorldMap, px: number, py: number): Zone {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return Zone.Meadow;
  return m.zone[y * m.w + x] as Zone;
}
/** Множитель скорости от поверхности: в снегах вне дорог медленнее. */
export function terrainSpeedMul(m: WorldMap, px: number, py: number): number {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 1;
  const i = y * m.w + x;
  return m.zone[i] === Zone.Snow && !(m.cell[i] & CELL_RESERVED) ? ENV.snowSpeed : 1;
}
/** Рядом ли лава (клетка и соседи): обжигает. */
export function nearLava(m: WorldMap, px: number, py: number): boolean {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) return false;
  for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) if (m.vtx[(y + j) * (m.w + 1) + x + i] === T.Lava) return true;
  return false;
}
/** Можно ли дышать: вне бухты всегда; под водой — у воздушных пузырей и у мелководья (края бухты). */
export function breathable(m: WorldMap, px: number, py: number): boolean {
  if (zoneAtPx(m, px, py) !== Zone.Underwater) return true;
  for (const v of m.vents) if ((v.x - px) ** 2 + (v.y - py) ** 2 < (3.5 * TILE) ** 2) return true;
  for (const [dx, dy] of [[7, 0], [-7, 0], [0, -7], [0, 7]]) {
    const sx = Math.floor(px / TILE) + dx, sy = Math.floor(py / TILE) + dy;
    if (sx >= 0 && sy >= 0 && sx < m.w && sy < m.h && m.zone[sy * m.w + sx] !== Zone.Underwater) return true;
  }
  return false;
}
export function walkable(m: WorldMap, px: number, py: number, r: number): boolean {
  return !(
    cellAt(m, px - r, py - r * 0.5) & CELL_BLOCK ||
    cellAt(m, px + r, py - r * 0.5) & CELL_BLOCK ||
    cellAt(m, px - r, py + r * 0.5) & CELL_BLOCK ||
    cellAt(m, px + r, py + r * 0.5) & CELL_BLOCK
  );
}
/** Двигает точку с учётом стен, скользя вдоль препятствий. */
export function moveWithCollision(m: WorldMap, x: number, y: number, dx: number, dy: number, r: number) {
  let nx = x + dx, ny = y;
  if (!walkable(m, nx, ny, r)) nx = x;
  ny = y + dy;
  if (!walkable(m, nx, ny, r)) ny = y;
  return { x: nx, y: ny };
}
/** Есть ли прямая видимость (для снарядов и рывков): проверка шагами по полтайла, стены блокируют, вода нет. */
export function lineClear(m: WorldMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
  const steps = Math.ceil(d / (TILE / 2));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (cellAt(m, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) & CELL_WALL) return false;
  }
  return true;
}
