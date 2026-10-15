/**
 * Построение мира в Phaser: анимированная вода, слои поверхностей (dual grid), стены, объекты и огни.
 * Мир делится на куски CHUNK×CHUNK тайлов: тайлы и объекты создаются только рядом с камерой,
 * поэтому большая карта не держит сотни тысяч Phaser-тайлов и тысячи спрайтов разом.
 */
import Phaser from "phaser";
import { TILE } from "../../../shared/constants";
import { CELL_WALL, TERRAIN_COUNT, Zone, type MapObject, type WorldMap } from "../../../shared/map";

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
  /** Смещение течения воды (меняется сценой каждый кадр). */
  drift: { x: number; y: number };
  dark: Phaser.GameObjects.Rectangle;
  macro: Phaser.GameObjects.TileSprite;
  /** Подводные блики: накладываются на экран, пока герой в бухте. */
  caustics: Phaser.GameObjects.TileSprite;
  /** Узел добычи появился (true) или исчерпан (false). */
  setNode(id: number, up: boolean): void;
  /** Подгрузка и выгрузка кусков мира вокруг камеры (каждый кадр, дёшево). */
  update(cam: Phaser.Cameras.Scene2D.Camera): void;
}

interface Chunk {
  tm: Phaser.Tilemaps.Tilemap;
  objs: Phaser.GameObjects.GameObject[];
  nodes: number[];
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

/** Бесшовные блики воды (каустика) для подводной зоны. */
function causticTex(scene: Phaser.Scene) {
  const S = 128;
  if (scene.textures.exists("caustics")) return;
  const tex = scene.textures.createCanvas("caustics", S, S)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(S, S);
  const g = (x: number, y: number, c: number, s: number) => cellHash(((x % c) + c) % c + s * 131, ((y % c) + c) % c);
  const vn = (x: number, y: number, cell: number, s: number) => {
    const n = S / cell, fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g(x0, y0, n, s), b = g(x0 + 1, y0, n, s), c = g(x0, y0 + 1, n, s), d = g(x0 + 1, y0 + 1, n, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.abs(vn(x, y, 32, 1) - vn(x, y, 32, 2));
    const v = Math.max(0, 1 - d * 14);
    const i = (y * S + x) * 4;
    img.data[i] = 150; img.data[i + 1] = 235; img.data[i + 2] = 255; img.data[i + 3] = Math.round(v * v * 255);
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

export function buildWorld(scene: Phaser.Scene, m: WorldMap): WorldView {
  const W = m.w * TILE, H = m.h * TILE;
  // вода и шум размером с экран и следуют за камерой: текстура на всю карту превысила бы предел WebGL
  const water = scene.add.tileSprite(0, 0, 16, 16, "water").setOrigin(0).setDepth(DEPTH.water);
  const drift = { x: 0, y: 0 };

  // индексы тайлов всех слоёв считаются один раз (слой 0 — стены данжа, 1..Floor — поверхности)
  const V = (x: number, y: number) => m.vtx[y * (m.w + 1) + x];
  const layers: (Int16Array | null)[] = new Array(TERRAIN_COUNT).fill(null);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const c = [V(x, y), V(x + 1, y), V(x + 1, y + 1), V(x, y + 1)];
    const low = Math.min(...c);
    for (let t = 1; t < TERRAIN_COUNT; t++) {
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
      (layers[0] ??= new Int16Array(m.w * m.h).fill(-1))[y * m.w + x] = TERRAIN_COUNT * COLS + (below ? (x + y) % 2 : 2 + Math.floor(cellHash(x, y) * 4));
    }
  }

  macroNoise(scene);
  const macro = scene.add.tileSprite(0, 0, 16, 16, "macro").setOrigin(0).setDepth(DEPTH.overlay).setAlpha(0.6);
  const follow = (v: Phaser.Geom.Rectangle) => {
    const pad = 64, x = Math.floor(v.x) - pad, y = Math.floor(v.y) - pad, w = Math.ceil(v.width) + pad * 2, h = Math.ceil(v.height) + pad * 2;
    if (water.width !== w || water.height !== h) { water.setSize(w, h); macro.setSize(w, h); }
    water.setPosition(x, y).setTilePosition(x + drift.x, y + drift.y);
    // шум только в пределах карты, чтобы не ложиться на воду за краем
    const mx = Math.max(0, x), my = Math.max(0, y);
    macro.setPosition(mx, my).setTilePosition(mx, my);
    macro.setSize(Math.max(1, Math.min(x + w, W) - mx), Math.max(1, Math.min(y + h, H) - my));
  };

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
  causticTex(scene);
  const caustics = scene.add.tileSprite(0, 0, 10, 10, "caustics").setOrigin(0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(DEPTH.top - 25);
  // узлы добычи: картинка и свечение прячутся, пока ресурс исчерпан
  const nodeOf = new Map<MapObject, number>(m.nodes.map((n) => [m.objects[n.id], n.id]));
  const nodeObjs = new Map<number, Phaser.GameObjects.GameObject[]>();
  const depleted = new Set<number>();
  const NODE_GLOW: Record<string, number> = { node_cactus: 0xc8ff8a, node_ice: 0x9ae0ff, node_obsidian: 0xff7a2a, node_pearl: 0xe8d8ff };
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
    const nid = nodeOf.get(o);
    if (nid !== undefined) {
      const mine: Phaser.GameObjects.GameObject[] = [img];
      glow(mine, o.x, o.y - 14, NODE_GLOW[o.kind] ?? 0xffffff, 1.1, 0.4);
      scene.tweens.add({ targets: mine[1], alpha: { from: 0.2, to: 0.5 }, duration: 900 + (nid % 7) * 90, yoyo: true, repeat: -1 });
      objs.push(mine[1]);
      nodeObjs.set(nid, mine);
      if (depleted.has(nid)) for (const g of mine) (g as Phaser.GameObjects.Image).setVisible(false);
    }
    if (o.kind === "air_vent") {
      const e = scene.add.particles(o.x, o.y - 12, "fx_bubble", { frequency: 240, lifespan: 2200, speedY: { min: -55, max: -35 }, speedX: { min: -6, max: 6 }, scale: { start: 0.9, end: 1.5 }, alpha: { start: 0.9, end: 0 } });
      e.setDepth(DEPTH.top - 12);
      objs.push(e);
    }
    if (o.kind === "torch") glow(objs, o.x, o.y - 22, 0xff9a3a, 2.4, 0.55, true);
    if (o.kind === "brazier") glow(objs, o.x, o.y - 26, 0xff8a2a, 2.6, 0.6, true);
    if (o.kind === "teleport_stone") glow(objs, o.x, o.y - 34, 0x7ac0ff, 2.2, 0.5, true);
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
    for (let t = 0; t < TERRAIN_COUNT; t++) {
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
    return { tm, objs, nodes: buckets[cy * NX + cx].map((o) => nodeOf.get(o)).filter((v): v is number => v !== undefined) };
  };
  const dropChunk = (c: Chunk) => {
    for (const id of c.nodes) nodeObjs.delete(id);
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
    follow(v);
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

  const setNode = (id: number, up: boolean) => {
    if (up) depleted.delete(id);
    else depleted.add(id);
    for (const g of nodeObjs.get(id) ?? []) (g as Phaser.GameObjects.Image).setVisible(up);
  };
  return { water, drift, dark, macro, caustics, setNode, update };
}

/** Затемнение и цвет подложки зоны (над миром, под интерфейсом). */
export function zoneTint(z: Zone): { dark: number; color: number } {
  switch (z) {
    case Zone.Dungeon: return { dark: 0.5, color: 0x0a0614 };
    case Zone.Swamp: return { dark: 0.18, color: 0x0a1410 };
    case Zone.Ashlands: return { dark: 0.16, color: 0x0a0614 };
    case Zone.Forest: return { dark: 0.08, color: 0x0a1008 };
    case Zone.Arena: return { dark: 0.28, color: 0x0a0614 };
    case Zone.OasisCity:
    case Zone.Desert: return { dark: 0.1, color: 0xd88a30 };
    case Zone.SnowCity:
    case Zone.Snow: return { dark: 0.12, color: 0x9ac8ff };
    case Zone.Volcano: return { dark: 0.22, color: 0x2a0806 };
    case Zone.Underwater: return { dark: 0.38, color: 0x0a4c8c };
    default: return { dark: 0, color: 0x0a0614 };
  }
}
