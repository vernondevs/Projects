/**
 * Построение мира в Phaser: анимированная вода, слои поверхностей (dual grid), стены, объекты и огни.
 * Мир делится на куски CHUNK×CHUNK тайлов: тайлы и объекты создаются только рядом с камерой,
 * поэтому большая карта не держит сотни тысяч Phaser-тайлов и тысячи спрайтов разом.
 */
import Phaser from "phaser";
import { TILE } from "../../../shared/constants";
import { CELL_WALL, T, Zone, type MapObject, type WorldMap } from "../../../shared/map";

const COLS = 18;
export const DEPTH = { water: -1000, terrain: -900, walls: -800, overlay: -700, ground: -600, top: 1e6 };
/** Размер куска мира в тайлах. */
const CHUNK = 32;

function cellHash(x: number, y: number) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface WorldView {
  water: Phaser.GameObjects.TileSprite;
  dark: Phaser.GameObjects.Rectangle;
  macro: Phaser.GameObjects.TileSprite;
  /** Подгрузка и выгрузка кусков мира вокруг камеры (каждый кадр, дёшево). */
  update(cam: Phaser.Cameras.Scene2D.Camera): void;
}

interface Chunk {
  tm: Phaser.Tilemaps.Tilemap;
  objs: Phaser.GameObjects.GameObject[];
}

/** Крупный бесшовный шум для разбивки повторяемости тайлов (рисуется поверх земли). */
function macroNoise(scene: Phaser.Scene) {
  const S = 256;
  if (scene.textures.exists("macro")) return; // уже создана при прошлом запуске сцены
  const tex = scene.textures.createCanvas("macro", S, S)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(S, S);
  const g = (x: number, y: number, c: number) => cellHash(((x % c) + c) % c, ((y % c) + c) % c);
  const vn = (x: number, y: number, cell: number) => {
    const n = S / cell, fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g(x0, y0, n), b = g(x0 + 1, y0, n), c = g(x0, y0 + 1, n), d = g(x0 + 1, y0 + 1, n);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = vn(x, y, 64) * 0.65 + vn(x, y, 32) * 0.35;
    const i = (y * S + x) * 4;
    const dark = n < 0.5;
    img.data[i] = dark ? 0 : 255; img.data[i + 1] = dark ? 0 : 250; img.data[i + 2] = dark ? 10 : 200;
    img.data[i + 3] = Math.round(Math.abs(n - 0.5) * 2 * 60);
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

export function buildWorld(scene: Phaser.Scene, m: WorldMap): WorldView {
  const W = m.w * TILE, H = m.h * TILE;
  const water = scene.add.tileSprite(W / 2, H / 2, W + 256, H + 256, "water").setDepth(DEPTH.water);

  // индексы тайлов всех слоёв считаются один раз (слой 0 — стены данжа, 1..Floor — поверхности)
  const V = (x: number, y: number) => m.vtx[y * (m.w + 1) + x];
  const layers: (Int16Array | null)[] = new Array(T.Floor + 1).fill(null);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const c = [V(x, y), V(x + 1, y), V(x + 1, y + 1), V(x, y + 1)];
    const low = Math.min(...c);
    for (let t = 1; t <= T.Floor; t++) {
      if (!c.includes(t)) continue;
      let col: number;
      if (t === low) {
        const h = cellHash(x + t * 7, y);
        col = h < 0.55 ? 14 : 15 + Math.floor(((h - 0.55) / 0.45) * 3);
      } else col = ((c[0] >= t ? 1 : 0) | (c[1] >= t ? 2 : 0) | (c[2] >= t ? 4 : 0) | (c[3] >= t ? 8 : 0)) - 1;
      (layers[t] ??= new Int16Array(m.w * m.h).fill(-1))[y * m.w + x] = t * COLS + col;
    }
    if (m.cell[y * m.w + x] & CELL_WALL) {
      const below = y + 1 < m.h && m.cell[(y + 1) * m.w + x] & CELL_WALL;
      (layers[0] ??= new Int16Array(m.w * m.h).fill(-1))[y * m.w + x] = 10 * COLS + (below ? (x + y) % 2 : 2 + Math.floor(cellHash(x, y) * 4));
    }
  }

  macroNoise(scene);
  const macro = scene.add.tileSprite(W / 2, H / 2, W, H, "macro").setDepth(DEPTH.overlay).setAlpha(0.6);

  // объекты раскладываются по кускам по опорной точке
  const NX = Math.ceil(m.w / CHUNK), NY = Math.ceil(m.h / CHUNK);
  const buckets: MapObject[][] = Array.from({ length: NX * NY }, () => []);
  for (const o of m.objects) {
    const cx = Math.max(0, Math.min(NX - 1, Math.floor(o.x / TILE / CHUNK)));
    const cy = Math.max(0, Math.min(NY - 1, Math.floor((o.y - 1) / TILE / CHUNK)));
    buckets[cy * NX + cx].push(o);
  }

  const glow = (objs: Phaser.GameObjects.GameObject[], x: number, y: number, color: number, scale: number, alpha: number, flicker = false) => {
    const g = scene.add.image(x, y, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(scale).setAlpha(alpha).setDepth(DEPTH.top - 10);
    objs.push(g);
    if (flicker) scene.tweens.add({ targets: g, alpha: { from: alpha * 0.7, to: alpha * 1.1 }, scale: { from: scale * 0.92, to: scale * 1.05 }, duration: 160 + Math.random() * 220, yoyo: true, repeat: -1 });
  };
  const makeObject = (o: MapObject, objs: Phaser.GameObjects.GameObject[]) => {
    const img = scene.add.image(o.x, o.y, `o_${o.kind}`).setOrigin(0.5, 1);
    objs.push(img);
    if (o.kind === "lilypad") img.setDepth(DEPTH.ground);
    else if (o.kind === "flowers" || o.kind === "tallgrass" || o.kind === "bones" || o.kind === "ember_vent") img.setDepth(o.y - 20);
    else img.setDepth(o.y);
    if (o.kind === "oak" || o.kind === "pine") {
      // лёгкое покачивание крон
      const sway = (cellHash(o.x, o.y) - 0.5) * 0.04;
      scene.tweens.add({ targets: img, angle: { from: -1 + sway, to: 1 + sway }, duration: 2400 + cellHash(o.y, o.x) * 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      if (o.kind === "oak") img.setFlipX(cellHash(o.x, o.y) > 0.5);
    }
    if (o.kind === "torch") glow(objs, o.x, o.y - 22, 0xff9a3a, 2.4, 0.55, true);
    if (o.kind === "lamp") glow(objs, o.x, o.y - 46, 0xffd27a, 2.2, 0.45, true);
    if (o.kind === "ember_vent") glow(objs, o.x, o.y - 6, 0xff5a1a, 1.4, 0.5, true);
    if (o.kind === "mushrooms_glow") glow(objs, o.x, o.y - 8, 0x5aa8ff, 1.1, 0.35);
    if (o.kind === "crystal") glow(objs, o.x, o.y - 12, 0x9a8aff, 1.3, 0.4);
    if (o.kind === "house" || o.kind === "house_blue") for (const dx of [-36, 38]) glow(objs, o.x + dx, o.y - 30, 0xffd27a, 1.2, 0.35);
    if (o.kind === "tavern") for (const [dx, dy] of [[-71, -26], [-39, -26], [61, -26], [93, -26], [-80, -64], [-38, -64], [40, -64], [84, -64]]) glow(objs, o.x + dx, o.y + dy, 0xffc870, 1.2, 0.38);
    if (o.kind === "forge") {
      glow(objs, o.x - 48, o.y - 24, 0xff7a2a, 2.2, 0.6, true);
      glow(objs, o.x + 49, o.y - 138, 0xff8a3a, 0.9, 0.5, true);
    }
    if (o.kind === "cauldron") glow(objs, o.x, o.y - 4, 0xff8a3a, 0.9, 0.45, true);
    if (o.kind === "arena_gate") glow(objs, o.x, o.y - 30, 0xff4a2a, 1.6, 0.35, true);
  };

  const chunks = new Map<number, Chunk>();
  const createChunk = (cx: number, cy: number): Chunk => {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const cw = Math.min(CHUNK, m.w - x0), ch = Math.min(CHUNK, m.h - y0);
    const tm = scene.make.tilemap({ width: cw, height: ch, tileWidth: TILE, tileHeight: TILE });
    const ts = tm.addTilesetImage("terrain", "terrain", TILE, TILE, 0, 0, 0)!;
    for (let t = 0; t <= T.Floor; t++) {
      const src = layers[t];
      if (!src) continue;
      let any = false;
      const data: number[][] = [];
      for (let j = 0; j < ch; j++) {
        const row = new Array<number>(cw);
        for (let i = 0; i < cw; i++) {
          const v = src[(y0 + j) * m.w + x0 + i];
          row[i] = v;
          if (v >= 0) any = true;
        }
        data.push(row);
      }
      if (!any) continue;
      const layer = tm.createBlankLayer(`t${t}`, ts, x0 * TILE, y0 * TILE, cw, ch)!;
      layer.putTilesAt(data, 0, 0);
      layer.setDepth(t === 0 ? DEPTH.walls : DEPTH.terrain + t);
    }
    const objs: Phaser.GameObjects.GameObject[] = [];
    for (const o of buckets[cy * NX + cx]) makeObject(o, objs);
    return { tm, objs };
  };
  const dropChunk = (c: Chunk) => {
    scene.tweens.killTweensOf(c.objs);
    for (const o of c.objs) o.destroy();
    c.tm.destroy();
  };
  scene.events.once("shutdown", () => {
    for (const c of chunks.values()) dropChunk(c);
    chunks.clear();
  });

  let last = "";
  const update = (cam: Phaser.Cameras.Scene2D.Camera) => {
    const v = cam.worldView;
    const span = CHUNK * TILE;
    // запас в полкуска (снизу больше: высокие здания торчат вверх от опорной точки)
    const ax = Math.max(0, Math.floor((v.x - span / 2) / span)), bx = Math.min(NX - 1, Math.floor((v.right + span / 2) / span));
    const ay = Math.max(0, Math.floor((v.y - span / 2) / span)), by = Math.min(NY - 1, Math.floor((v.bottom + span / 2 + 200) / span));
    const key = `${ax},${bx},${ay},${by}`;
    if (key === last) return;
    last = key;
    for (const [id, c] of chunks) {
      const cx = id % NX, cy = Math.floor(id / NX);
      // выгрузка с гистерезисом в один кусок, чтобы не мигало на границе
      if (cx < ax - 1 || cx > bx + 1 || cy < ay - 1 || cy > by + 1) {
        dropChunk(c);
        chunks.delete(id);
      }
    }
    for (let cy = ay; cy <= by; cy++) for (let cx = ax; cx <= bx; cx++) {
      const id = cy * NX + cx;
      if (!chunks.has(id)) chunks.set(id, createChunk(cx, cy));
    }
  };

  // затемнение в данже (над миром, под огнями и интерфейсом)
  const dark = scene.add.rectangle(0, 0, 10, 10, 0x0a0614, 1).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.top - 20).setAlpha(0);

  return { water, dark, macro, update };
}

export function zoneTint(z: Zone): { dark: number } {
  return { dark: z === Zone.Dungeon ? 0.5 : z === Zone.Swamp ? 0.18 : z === Zone.Ashlands ? 0.16 : z === Zone.Forest ? 0.08 : z === Zone.Arena ? 0.28 : 0 };
}
