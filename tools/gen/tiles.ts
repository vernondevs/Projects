/**
 * Тайлсет поверхностей по схеме dual grid: для каждой поверхности 15 масок углов
 * (TL=1, TR=2, BR=4, BL=8) плюс 3 дополнительных варианта сплошного тайла.
 * Раскладка: строка = индекс поверхности, столбец (mask-1) для масок 1..15, 15..17 — доп. варианты.
 * Строка 10 — стены данжа: 0–1 верх стены, 2–5 лицевая сторона.
 */
import { PC, hash01, mix, pnoise, rng, shade, withA, type RGBA, type Ramp } from "./canvas";
import { P } from "./palette";

export const TILESET_COLS = 18;
const S = 32;

type Texel = (x: number, y: number, v: number) => RGBA;

const pick = (r: Ramp, t: number) => r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))];
const interior = (x: number, y: number, m = 2) => x >= m && y >= m && x < S - m && y < S - m;

/** Пятна деталей внутри тайла: детерминированные по варианту, не касаются краёв. */
function sprinkle(v: number, seed: number, count: number) {
  const r = rng(seed * 977 + v * 131 + 7);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([3 + Math.floor(r() * (S - 6)), 3 + Math.floor(r() * (S - 6)), r()]);
  return pts;
}
function detailMap(v: number, seed: number, count: number, stamp: (m: Map<number, RGBA>, x: number, y: number, k: number) => void) {
  const m = new Map<number, RGBA>();
  for (const [x, y, k] of sprinkle(v, seed, count)) stamp(m, x, y, k);
  return m;
}
const key = (x: number, y: number) => y * 64 + x;

function noiseBase(r: Ramp, seed: number, lo = 0.2, hi = 0.75): Texel {
  return (x, y) => {
    const n = pnoise(x, y, 8, S, seed) * 0.6 + pnoise(x, y, 4, S, seed + 1) * 0.3 + hash01(x, y, seed + 2) * 0.1;
    return pick(r, lo + n * (hi - lo));
  };
}

function grass(): Texel {
  const base = noiseBase(P.grass, 11, 0.25, 0.78);
  const cache = new Map<number, Map<number, RGBA>>();
  return (x, y, v) => {
    if (!cache.has(v)) cache.set(v, detailMap(v, 11, v === 0 ? 10 : 14, (m, px, py, k) => {
      // пучок травы: светлые травинки с тёмным основанием
      m.set(key(px, py), P.grass[4]);
      m.set(key(px, py + 1), P.grass[3]);
      m.set(key(px + 1, py + 1), P.grass[1]);
      if (k > 0.5) { m.set(key(px - 1, py + 1), P.grass[4]); m.set(key(px - 1, py + 2), P.grass[1]); }
      if (v === 2 && k > 0.75) { m.set(key(px + 2, py - 1), [244, 236, 160, 255]); m.set(key(px + 3, py - 1), [236, 120, 150, 255]); }
      if (v === 3 && k < 0.2) { m.set(key(px, py), [230, 230, 240, 255]); }
    }));
    return cache.get(v)!.get(key(x, y)) ?? base(x, y, v);
  };
}
function forest(): Texel {
  const base = noiseBase(P.forest, 21, 0.3, 0.68);
  const cache = new Map<number, Map<number, RGBA>>();
  return (x, y, v) => {
    if (!cache.has(v)) cache.set(v, detailMap(v, 21, 12, (m, px, py, k) => {
      if (k < 0.45) { m.set(key(px, py), P.leafAutumn[k < 0.2 ? 2 : 1]); m.set(key(px + 1, py), P.leafAutumn[0]); }
      else if (k < 0.8) { m.set(key(px, py), P.forest[4]); m.set(key(px, py + 1), P.forest[3]); }
      else { m.set(key(px, py), P.moss[2]); m.set(key(px + 1, py), P.moss[1]); m.set(key(px, py + 1), P.moss[1]); }
    }));
    return cache.get(v)!.get(key(x, y)) ?? base(x, y, v);
  };
}
function dirt(): Texel {
  const base = noiseBase(P.dirt, 31, 0.2, 0.75);
  const cache = new Map<number, Map<number, RGBA>>();
  return (x, y, v) => {
    if (!cache.has(v)) cache.set(v, detailMap(v, 31, 9, (m, px, py, k) => {
      // камешек: светлая верхушка и тень
      m.set(key(px, py), P.dirt[4]);
      if (k > 0.4) m.set(key(px + 1, py), P.dirt[3]);
      m.set(key(px, py + 1), P.dirt[0]);
      if (k > 0.4) m.set(key(px + 1, py + 1), P.dirt[0]);
    }));
    return cache.get(v)!.get(key(x, y)) ?? base(x, y, v);
  };
}
function sand(): Texel {
  const base = noiseBase(P.sand, 41, 0.25, 0.8);
  return (x, y, v) => {
    const h = hash01(x, y, 41 + v * 3);
    if (interior(x, y) && h < 0.05) return P.sand[0];
    if (interior(x, y) && h > 0.965) return P.sand[4];
    // лёгкая рябь от ветра
    const w = pnoise(x * 2, y, 8, S, 43);
    if (w > 0.78) return P.sand[3];
    return base(x, y, v);
  };
}
function bog(): Texel {
  const base = noiseBase(P.bog, 51, 0.15, 0.8);
  const cache = new Map<number, Map<number, RGBA>>();
  return (x, y, v) => {
    if (!cache.has(v)) cache.set(v, detailMap(v, 51, 6, (m, px, py, k) => {
      if (k < 0.5) {
        // лужица
        for (let dx = -1; dx <= 2; dx++) m.set(key(px + dx, py), [44, 64, 60, 255]);
        m.set(key(px, py - 1), [44, 64, 60, 255]); m.set(key(px + 1, py - 1), [70, 96, 86, 255]);
      } else { m.set(key(px, py), P.moss[2]); m.set(key(px, py + 1), P.bog[1]); }
    }));
    return cache.get(v)!.get(key(x, y)) ?? base(x, y, v);
  };
}
function ash(): Texel {
  const base = noiseBase(P.ash, 61, 0.2, 0.8);
  return (x, y, v) => {
    const c = pnoise(x, y, 8, S, 63 + (v % 2));
    if (c > 0.47 && c < 0.5 && interior(x, y, 1)) return v >= 2 ? [180, 70, 30, 255] : P.ash[0];
    const h = hash01(x, y, 61 + v);
    if (h < 0.05) return P.ash[0];
    if (h > 0.97) return P.ash[4];
    return base(x, y, v);
  };
}
function lava(): Texel {
  return (x, y) => {
    const n = pnoise(x, y, 8, S, 71) * 0.6 + pnoise(x, y, 4, S, 72) * 0.4;
    const crust = pnoise(x, y, 4, S, 73);
    if (crust > 0.62) return crust > 0.7 ? [46, 22, 20, 255] : [80, 30, 20, 255];
    return pick(P.lava, 0.3 + n * 0.7);
  };
}
/** Брусчатка: ячейки Вороного в периодическом пространстве. */
function cobble(): Texel {
  const r = rng(81);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) pts.push([r() * S, r() * S, r()]);
  const nearest = (x: number, y: number) => {
    let d1 = 1e9, d2 = 1e9, id = 0, tone = 0;
    for (const [px, py, t] of pts)
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const dx = x + 0.5 - (px + ox * S), dy = y + 0.5 - (py + oy * S), d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; id = px * 1000 + py; tone = t; } else if (d < d2) d2 = d;
      }
    return { edge: d2 - d1, id, tone };
  };
  return (x, y, v) => {
    const a = nearest(x, y);
    if (a.edge < 1.3) return P.cobble[0];
    const up = nearest(x, (y - 1 + S) % S), dn = nearest(x, (y + 1) % S);
    let idx = 2 + (a.tone > 0.66 ? 1 : a.tone < 0.25 ? -1 : 0);
    if (up.edge < 1.3) idx = Math.min(4, idx + 1);
    else if (dn.edge < 1.3) idx = Math.max(1, idx - 1);
    let c = P.cobble[idx];
    if (v === 2 && hash01(x, y, 85) < 0.04) c = P.moss[1];
    return c;
  };
}
/** Плиты пола данжа 16×16 с фаской и трещинами. */
function floor(): Texel {
  return (x, y, v) => {
    const lx = x % 16, ly = y % 16;
    const slab = Math.floor(x / 16) + Math.floor(y / 16) * 2;
    if (lx === 0 || ly === 0) return P.floor[0];
    if (ly === 1 || lx === 1) return P.floor[3];
    if (ly === 15 || lx === 15) return P.floor[1];
    const n = pnoise(x, y, 4, S, 91 + slab);
    let c = n > 0.62 ? P.floor[3] : n < 0.3 ? P.floor[1] : P.floor[2];
    if (v >= 1) {
      const crack = pnoise(x, y, 4, S, 95 + v);
      if (crack > 0.49 && crack < 0.52 && interior(lx, ly, 2) && slab === v % 4) c = P.floor[0];
    }
    if (v === 3 && hash01(x, y, 97) < 0.03) c = [70, 60, 54, 255];
    return c;
  };
}

interface TerrainSpec {
  tex: Texel;
  rimIn?: number; // множитель яркости внутренней кромки
  rimOut?: RGBA; // цвет внешней кромки (поверх нижней поверхности)
  hi?: boolean; // светлая полоска сверху от кромки
}
export const TERRAIN_SPECS: TerrainSpec[] = [
  { tex: () => P.water[2] }, // вода рисуется отдельной анимированной текстурой
  { tex: lava(), rimIn: 0.6 },
  { tex: sand(), rimIn: 0.88, rimOut: [214, 236, 250, 150] },
  { tex: bog(), rimIn: 0.75 },
  { tex: ash(), rimIn: 0.7, rimOut: [30, 18, 16, 150] },
  { tex: dirt(), rimIn: 0.78 },
  { tex: grass(), rimIn: 0.72, hi: true },
  { tex: forest(), rimIn: 0.7, hi: true },
  { tex: cobble(), rimIn: 0.65 },
  { tex: floor(), rimIn: 0.6, rimOut: [20, 12, 14, 170] },
];

/** Покрытие тайла маской углов с шумной границей. */
function coverage(mask: number, x: number, y: number, seed: number) {
  const u = Math.max(0, Math.min(1, (x + 0.5) / S)), v = Math.max(0, Math.min(1, (y + 0.5) / S));
  const tl = mask & 1 ? 1 : 0, tr = mask & 2 ? 1 : 0, br = mask & 4 ? 1 : 0, bl = mask & 8 ? 1 : 0;
  const f = tl * (1 - u) * (1 - v) + tr * u * (1 - v) + br * u * v + bl * (1 - u) * v;
  const n = (pnoise(x, y, 8, S, seed) - 0.5) * 0.55 + (pnoise(x, y, 4, S, seed + 1) - 0.5) * 0.25;
  return f + n;
}

export function terrainTile(t: number, mask: number, variant: number): PC {
  const spec = TERRAIN_SPECS[t];
  const out = new PC(S, S);
  const seed = 500 + t * 17;
  const inside = (x: number, y: number) => (mask === 15 ? true : coverage(mask, x, y, seed) > 0.5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (inside(x, y)) {
      let c = spec.tex(x, y, variant);
      if (mask !== 15) {
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        const edgeBelow = !inside(x, y + 1) || !inside(x, y + 2);
        if (edge && spec.rimIn) c = shade(c, spec.rimIn);
        else if (edgeBelow && spec.rimIn) c = shade(c, (1 + spec.rimIn) / 2);
        else if (spec.hi && !inside(x, y - 2)) c = mix(c, [255, 255, 220, 255], 0.12);
      }
      out.set(x, y, c);
    } else if (spec.rimOut && mask !== 0) {
      const near = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
      if (near) out.set(x, y, spec.rimOut);
    }
  }
  return out;
}

/** Стены данжа. */
function wallTop(v: number): PC {
  const out = new PC(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = pnoise(x, y, 8, S, 300 + v);
    out.set(x, y, P.wallTop[n > 0.6 ? 3 : n > 0.4 ? 2 : 1]);
  }
  return out;
}
function wallFace(v: number): PC {
  const out = new PC(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // верхний срез стены
    if (y < 6) { out.set(x, y, y === 5 ? P.wallFace[4] : P.wallTop[2 + (hash01(x, y, 7) > 0.7 ? 1 : 0)]); continue; }
    const row = Math.floor((y - 6) / 7);
    const off = row % 2 ? 8 : 0;
    const bx = (x + off) % 16, by = (y - 6) % 7;
    let c: RGBA;
    if (by === 6 || bx === 0) c = P.wallFace[0];
    else if (by === 0) c = P.wallFace[3];
    else if (bx === 15) c = P.wallFace[1];
    else c = P.wallFace[hash01(Math.floor((x + off) / 16), row, 31 + v) > 0.5 ? 2 : 1];
    if (y >= S - 3) c = shade(c, 0.7);
    if (v === 1 && hash01(x, y, 40) < 0.08 && y > 20) c = P.moss[1 + (y % 2)];
    if (v === 2 && Math.abs(x - 12 - (y - 14) * 0.5) < 0.6 && y > 10 && y < 26) c = P.wallFace[0];
    out.set(x, y, c);
  }
  return out;
}

export function buildTileset(): PC {
  const out = new PC(TILESET_COLS * S, 11 * S);
  for (let t = 1; t < TERRAIN_SPECS.length; t++) {
    for (let mask = 1; mask <= 15; mask++) out.blit(terrainTile(t, mask, 0), (mask - 1) * S, t * S);
    for (let v = 1; v <= 3; v++) out.blit(terrainTile(t, 15, v), (14 + v) * S, t * S);
  }
  out.blit(wallTop(0), 0, 10 * S);
  out.blit(wallTop(1), S, 10 * S);
  for (let v = 0; v < 4; v++) out.blit(wallFace(v), (2 + v) * S, 10 * S);
  return out;
}

/** Бесшовная вода 64×64 для фонового слоя: волны и блики. */
export function buildWater(frame: number): PC {
  const W = 64;
  const out = new PC(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const n = pnoise(x, y, 16, W, 900) * 0.6 + pnoise(x, y, 8, W, 901) * 0.4;
    let c = pick(P.water, 0.15 + n * 0.6);
    const wv = pnoise(x + frame * 4, y * 2, 16, W, 905);
    if (wv > 0.62 && wv < 0.66) c = P.water[3];
    if (wv > 0.66 && wv < 0.675) c = P.water[4];
    out.set(x, y, c);
  }
  return out;
}
export function buildLavaGlow(): PC {
  const out = new PC(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const n = pnoise(x, y, 16, 64, 950);
    out.set(x, y, withA(P.lava[4], n > 0.6 ? 90 : 0));
  }
  return out;
}
