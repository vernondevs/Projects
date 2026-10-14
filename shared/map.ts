/**
 * Детерминированный генератор карты. Клиент и сервер вызывают generateMap(seed)
 * и получают одинаковый мир, поэтому карта не передаётся по сети.
 * Внутри только целочисленный хэш и арифметика (никаких Math.sin/pow), чтобы
 * результат был побитово одинаковым в браузере и в Node.
 */
import { MAP_H, MAP_W, TILE } from "./constants";

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
}
export const TERRAIN_COUNT = 10;
export const TERRAIN_KEYS = ["water", "lava", "sand", "bog", "ash", "dirt", "grass", "forest", "cobble", "floor"];
const BLOCKING = new Set<T>([T.Water, T.Lava]);

export enum Zone {
  Town,
  Meadow,
  Forest,
  Swamp,
  Ashlands,
  Dungeon,
  Arena,
}
export interface ZoneInfo {
  name: string;
  levels: [number, number];
  safe: boolean;
  mobs: string[];
}
export const ZONES: ZoneInfo[] = [
  { name: "Город Эмберхолл", levels: [0, 0], safe: true, mobs: [] },
  { name: "Зелёные холмы", levels: [1, 8], safe: false, mobs: ["slime", "boar", "goblin"] },
  { name: "Шепчущий лес", levels: [8, 15], safe: false, mobs: ["wolf", "spider", "goblin_shaman"] },
  { name: "Гнилые топи", levels: [15, 22], safe: false, mobs: ["skeleton", "drowned", "toxic_slime"] },
  { name: "Пепельная пустошь", levels: [22, 26], safe: false, mobs: ["imp", "golem", "skeleton"] },
  { name: "Пепельные чертоги", levels: [26, 30], safe: false, mobs: ["skeleton_knight", "imp", "golem"] },
  { name: "Арена", levels: [0, 0], safe: false, mobs: [] },
];

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
};

export const TOWN = { x: 36, y: 70 };
const DUNGEON = { x0: 120, y0: 52, x1: 176, y1: 90 };
const DUNGEON_ROOMS: [number, number, number, number][] = [
  [122, 66, 133, 77], // прихожая
  [120, 70, 124, 73], // ворота
  [133, 70, 141, 73],
  [140, 56, 151, 68], // северный зал
  [140, 75, 151, 87], // южный зал
  [143, 68, 148, 76],
  [151, 70, 157, 73],
  [156, 59, 175, 84], // зал босса
];
const LAVA_POOLS: [number, number, number][] = [
  [145.5, 61.5, 2.6],
  [146, 81.5, 2.4],
  [127.5, 74.5, 1.6],
  [160.5, 63.5, 1.8],
  [160.5, 79.5, 1.8],
];
const ROADS: [number, number][][] = [
  [[TOWN.x + 12, TOWN.y], [70, 71], [98, 71], [121, 71.5]],
  [[70, 71], [76, 52], [96, 34], [124, 24], [142, 20]],
  [[70, 71], [77, 92], [100, 110], [124, 119], [142, 121]],
  [[TOWN.x - 12, TOWN.y], [12, 72]],
];
export const BOSS_SPAWNS: BossSpawn[] = [
  { id: "ent", x: 152 * TILE, y: 20 * TILE, arena: 10 * TILE },
  { id: "witch", x: 152 * TILE, y: 121 * TILE, arena: 10 * TILE },
  { id: "ashlord", x: 168 * TILE, y: 71.5 * TILE, arena: 12 * TILE },
];

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
function roadDist(x: number, y: number): number {
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

export function zoneAt(x: number, y: number, seed: number): Zone {
  if (inDungeon(x, y)) return Zone.Dungeon;
  const dx = x - TOWN.x, dy = y - TOWN.y;
  if (dx * dx + dy * dy < 15 * 15) return Zone.Town;
  const w = (fbm(x, y, seed + 5) - 0.5) * 30;
  if (x + w > 98 && y + w * 0.5 > 44 && y + w * 0.5 < 97) return Zone.Ashlands;
  if (x > 54 + w * 0.5 && y + w < 44) return Zone.Forest;
  if (x > 54 + w * 0.5 && y + w > 97) return Zone.Swamp;
  return Zone.Meadow;
}

function terrainAt(x: number, y: number, seed: number): T {
  const n = fbm(x, y, seed);
  const z = zoneAt(x, y, seed);
  const edge = Math.min(x, y, MAP_W - x, MAP_H - y) + (n - 0.5) * 8;
  if (z !== Zone.Dungeon && edge < 2.6) return T.Water;
  if (z !== Zone.Dungeon && edge < 4.6) return T.Sand;
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
      const dx = x - TOWN.x, dy = y - TOWN.y;
      if (dx * dx + dy * dy < (6.5 + n * 1.5) ** 2) return T.Cobble;
      if ((Math.abs(dx) < 1.6 && Math.abs(dy) < 13) || (Math.abs(dy) < 1.6 && Math.abs(dx) < 13)) return T.Cobble;
      if (road < roadW) return T.Dirt;
      return T.Grass;
    }
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
  }
  return T.Grass;
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
    if (z === Zone.Town || roadDist(cx, cy) < 2.2 || bossNear(cx, cy, 1)) f |= CELL_RESERVED;
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

  // Город: дома по кварталам, фонтан, лавка, фонари.
  const T0 = TOWN;
  place("fountain", T0.x - 1, T0.y);
  place("house", T0.x - 12, T0.y - 6);
  place("house_blue", T0.x + 7, T0.y - 6);
  place("house_blue", T0.x - 12, T0.y + 7);
  place("house", T0.x + 7, T0.y + 7);
  place("stall", T0.x + 3, T0.y - 4);
  place("well", T0.x - 5, T0.y + 4);
  for (const [dx, dy] of [[-3, -3], [3, 3], [-3, 3], [3, -7], [-8, -2], [8, 2], [-2, -9], [2, 10], [10, -2], [-10, 2]])
    place("lamp", T0.x + dx, T0.y + dy);
  for (const [dx, dy] of [[-6, -4], [-7, -4], [6, 4], [12, 4], [-13, -1], [5, -8]]) place("barrel", T0.x + dx, T0.y + dy);
  const r0 = rng(seed + 7);
  for (let k = 0; k < 160; k++) {
    const rr = 12 + r0() * 3;
    // точка на окружности без тригонометрии: случайный вектор, нормированный к радиусу
    const px = r0() * 2 - 1, py = r0() * 2 - 1, l = Math.sqrt(px * px + py * py) || 1;
    const x = Math.floor(T0.x + (px / l) * rr), y = Math.floor(T0.y + (py / l) * rr);
    if (roadDist(x + 0.5, y + 0.5) < 2.5) continue;
    if (free(x, y) && !(at(x, y) & CELL_WALL) && r0() < 0.5) place(r0() < 0.7 ? "oak" : "bush", x, y);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - T0.x, dy = y - T0.y;
    if (dx * dx + dy * dy < 13 * 13 && !(cell[y * w + x] & CELL_BLOCK) && vtx[y * (w + 1) + x] === T.Grass && hash(x, y, seed + 3) < 0.1)
      objects.push({ kind: "flowers", x: x * TILE + 16, y: y * TILE + 30 });
  }

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
    if (z === Zone.Meadow) {
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
    } else if (z === Zone.Dungeon) {
      if (roll < 0.012) objects.push({ kind: "bones", x: x * TILE + 16 + jit, y: y * TILE + 28 });
      else if (roll < 0.018 && !bossNear(x, y, 2)) place("crate", x, y);
    }
  }
  // Данж: колонны, факелы на стенах.
  for (const [px, py] of [[142, 58], [149, 58], [142, 66], [149, 66], [142, 77], [149, 77], [142, 85], [149, 85], [159, 62], [172, 62], [159, 81], [172, 81]])
    place("pillar", px, py);
  for (let y = DUNGEON.y0; y < DUNGEON.y1 - 1; y++) for (let x = DUNGEON.x0; x < DUNGEON.x1; x++) {
    const wall = at(x, y) & CELL_WALL, below = at(x, y + 1) & CELL_WALL;
    if (wall && !below && hash(x, y, seed + 9) < 0.22) objects.push({ kind: "torch", x: x * TILE + 16, y: y * TILE + 26 });
  }
  objects.push({ kind: "torch", x: 120 * TILE + 16, y: 69 * TILE + 26 }, { kind: "torch", x: 120 * TILE + 16, y: 74 * TILE - 6 });

  // Точки появления мобов.
  const spawns: SpawnPoint[] = [];
  const quota: Record<number, number> = { [Zone.Meadow]: 56, [Zone.Forest]: 46, [Zone.Swamp]: 44, [Zone.Ashlands]: 22, [Zone.Dungeon]: 30 };
  const rs = rng(seed + 555);
  const taken: { x: number; y: number }[] = [];
  let guard = 0;
  while (Object.values(quota).some((q) => q > 0) && guard++ < 60000) {
    const x = 2 + Math.floor(rs() * (w - 4)), y = 2 + Math.floor(rs() * (h - 4));
    const i = y * w + x;
    const z = zone[i] as Zone;
    if (!quota[z] || cell[i] & CELL_BLOCK) continue;
    if (z !== Zone.Dungeon && cell[i] & CELL_RESERVED && roadDist(x + 0.5, y + 0.5) < 2.2 && rs() < 0.8) continue;
    if (bossNear(x, y, 4)) continue;
    const dt = Math.sqrt((x - TOWN.x) ** 2 + (y - TOWN.y) ** 2);
    if (dt < 20) continue;
    if (taken.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 16)) continue;
    const info = ZONES[z];
    const [lo, hi] = info.levels;
    let k: number;
    if (z === Zone.Meadow) k = Math.min(1, (dt - 20) / 50);
    else if (z === Zone.Dungeon) k = (x - DUNGEON.x0) / (156 - DUNGEON.x0);
    else k = Math.min(1, Math.max(0, (x - 54) / 110));
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
    playerSpawn: { x: TOWN.x * TILE + 16, y: (TOWN.y + 4) * TILE + 16 },
    merchant: { x: (TOWN.x + 4) * TILE, y: (TOWN.y - 3) * TILE + 8 },
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
