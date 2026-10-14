/** Построение мира в Phaser: анимированная вода, слои поверхностей (dual grid), стены, объекты и огни. */
import Phaser from "phaser";
import { TILE } from "../../../shared/constants";
import { CELL_WALL, T, Zone, type WorldMap } from "../../../shared/map";

const COLS = 18;
export const DEPTH = { water: -1000, terrain: -900, walls: -800, overlay: -700, ground: -600, top: 1e6 };

function cellHash(x: number, y: number) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface WorldView {
  water: Phaser.GameObjects.TileSprite;
  lights: Phaser.GameObjects.Image[];
  torches: Phaser.GameObjects.Image[];
  dark: Phaser.GameObjects.Rectangle;
  macro: Phaser.GameObjects.TileSprite;
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

  const tm = scene.make.tilemap({ width: m.w, height: m.h, tileWidth: TILE, tileHeight: TILE });
  const ts = tm.addTilesetImage("terrain", "terrain", TILE, TILE, 0, 0, 0)!;
  const V = (x: number, y: number) => m.vtx[y * (m.w + 1) + x];
  const layers: (number[][] | null)[] = [];
  for (let t = 1; t <= T.Floor; t++) layers[t] = Array.from({ length: m.h }, () => new Array(m.w).fill(-1));
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
      layers[t]![y][x] = t * COLS + col;
    }
  }
  for (let t = 1; t <= T.Floor; t++) {
    const data = layers[t]!;
    if (!data.some((r) => r.some((v) => v >= 0))) continue;
    const layer = tm.createBlankLayer(`t${t}`, ts)!;
    layer.putTilesAt(data, 0, 0);
    layer.setDepth(DEPTH.terrain + t);
  }
  // стены данжа
  const walls = Array.from({ length: m.h }, () => new Array(m.w).fill(-1));
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!(m.cell[y * m.w + x] & CELL_WALL)) continue;
    const below = y + 1 < m.h && m.cell[(y + 1) * m.w + x] & CELL_WALL;
    walls[y][x] = 10 * COLS + (below ? (x + y) % 2 : 2 + Math.floor(cellHash(x, y) * 4));
  }
  tm.createBlankLayer("walls", ts)!.putTilesAt(walls, 0, 0).setDepth(DEPTH.walls);

  macroNoise(scene);
  const macro = scene.add.tileSprite(W / 2, H / 2, W, H, "macro").setDepth(DEPTH.overlay).setAlpha(0.6);

  // объекты
  const lights: Phaser.GameObjects.Image[] = [];
  const torches: Phaser.GameObjects.Image[] = [];
  const glow = (x: number, y: number, color: number, scale: number, alpha: number) => {
    const g = scene.add.image(x, y, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(scale).setAlpha(alpha).setDepth(DEPTH.top - 10);
    lights.push(g);
    return g;
  };
  for (const o of m.objects) {
    const img = scene.add.image(o.x, o.y, `o_${o.kind}`).setOrigin(0.5, 1);
    if (o.kind === "lilypad") img.setDepth(DEPTH.ground);
    else if (o.kind === "flowers" || o.kind === "tallgrass" || o.kind === "bones" || o.kind === "ember_vent") img.setDepth(o.y - 20);
    else img.setDepth(o.y);
    if (o.kind === "oak" || o.kind === "pine") {
      // лёгкое покачивание крон
      const sway = (cellHash(o.x, o.y) - 0.5) * 0.04;
      scene.tweens.add({ targets: img, angle: { from: -1 + sway, to: 1 + sway }, duration: 2400 + cellHash(o.y, o.x) * 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      if (o.kind === "oak") img.setFlipX(cellHash(o.x, o.y) > 0.5);
    }
    if (o.kind === "torch") torches.push(glow(o.x, o.y - 22, 0xff9a3a, 2.4, 0.55));
    if (o.kind === "lamp") torches.push(glow(o.x, o.y - 46, 0xffd27a, 2.2, 0.45));
    if (o.kind === "ember_vent") torches.push(glow(o.x, o.y - 6, 0xff5a1a, 1.4, 0.5));
    if (o.kind === "mushrooms_glow") glow(o.x, o.y - 8, 0x5aa8ff, 1.1, 0.35);
    if (o.kind === "crystal") glow(o.x, o.y - 12, 0x9a8aff, 1.3, 0.4);
    if (o.kind === "house" || o.kind === "house_blue") for (const dx of [-36, 38]) glow(o.x + dx, o.y - 30, 0xffd27a, 1.2, 0.35);
  }
  for (const t of torches) scene.tweens.add({ targets: t, alpha: { from: t.alpha * 0.7, to: t.alpha * 1.1 }, scale: { from: t.scale * 0.92, to: t.scale * 1.05 }, duration: 160 + Math.random() * 220, yoyo: true, repeat: -1 });

  // затемнение в данже (над миром, под огнями и интерфейсом)
  const dark = scene.add.rectangle(0, 0, 10, 10, 0x0a0614, 1).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.top - 20).setAlpha(0);

  return { water, lights, torches, dark, macro };
}

export function zoneTint(z: Zone): { dark: number } {
  return { dark: z === Zone.Dungeon ? 0.5 : z === Zone.Swamp ? 0.18 : z === Zone.Ashlands ? 0.16 : z === Zone.Forest ? 0.08 : z === Zone.Arena ? 0.28 : 0 };
}
