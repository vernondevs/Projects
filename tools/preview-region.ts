/**
 * Отладка: рендер участка карты тайлами (dual grid) и объектами в tools/out/region.png.
 * Аргументы: x y w h (в тайлах) или «town» — весь Эмберхолл.
 */
import { PNG } from "pngjs";
import fs from "node:fs";
import { MAP_SEED } from "../shared/constants";
import { CELL_WALL, generateMap, T, TOWN } from "../shared/map";
import { TOWN_HALF } from "../shared/town";
import { PC } from "./gen/canvas";

const args = process.argv.slice(2);
const [x0, y0, w, h] = args[0] === "town"
  ? [TOWN.x - TOWN_HALF.x - 3, TOWN.y - TOWN_HALF.y - 4, TOWN_HALF.x * 2 + 7, TOWN_HALF.y * 2 + 8]
  : args.length === 4 ? args.map(Number) : [20, 56, 30, 22];
const m = generateMap(MAP_SEED);
const read = (f: string) => {
  const png = PNG.sync.read(fs.readFileSync(f));
  const pc = new PC(png.width, png.height);
  pc.data.set(png.data);
  return pc;
};
const tiles = read("client/public/assets/tiles/terrain.png");
const water = read("client/public/assets/tiles/water.png");
const COLS = 18;
const out = new PC(w * 32, h * 32);
const V = (x: number, y: number) => m.vtx[y * (m.w + 1) + x];
const blitTile = (tx: number, ty: number, dx: number, dy: number) => {
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    const c = tiles.get(tx * 32 + i, ty * 32 + j)!;
    if (c[3]) out.set(dx + i, dy + j, c);
  }
};
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const cx = x0 + x, cy = y0 + y;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) out.set(x * 32 + i, y * 32 + j, water.get((x * 32 + i) % 64, (y * 32 + j) % 64)!);
  const c = [V(cx, cy), V(cx + 1, cy), V(cx + 1, cy + 1), V(cx, cy + 1)];
  const lowest = Math.min(...c);
  for (let t = 1; t <= T.Floor; t++) {
    if (!c.includes(t)) continue;
    const mask = t === lowest ? 15 : (c[0] >= t ? 1 : 0) | (c[1] >= t ? 2 : 0) | (c[2] >= t ? 4 : 0) | (c[3] >= t ? 8 : 0);
    let col = mask - 1;
    if (mask === 15) {
      const v = ((cx * 7 + cy * 13) ^ (cx * cy)) % 7;
      col = v < 4 ? 14 : 14 + (v - 3);
    }
    blitTile(col, t, x * 32, y * 32);
  }
  if (m.cell[cy * m.w + cx] & CELL_WALL) {
    const below = m.cell[(cy + 1) * m.w + cx] & CELL_WALL;
    blitTile(below ? (cx + cy) % 2 : 2 + ((cx * 3 + cy) % 4), 10, x * 32, y * 32);
  }
}
// объекты: по глубине (нижний край), опора — нижняя середина
const objs = m.objects.filter((o) => o.x > x0 * 32 - 128 && o.x < (x0 + w) * 32 + 128 && o.y > y0 * 32 && o.y < (y0 + h) * 32 + 200).sort((a, b) => a.y - b.y);
const cache = new Map<string, PC | null>();
for (const o of objs) {
  if (!cache.has(o.kind)) {
    const f = `client/public/assets/objects/${o.kind}.png`;
    cache.set(o.kind, fs.existsSync(f) ? read(f) : null);
  }
  const img = cache.get(o.kind);
  if (!img) continue;
  out.blit(img, Math.round(o.x - x0 * 32 - img.w / 2), Math.round(o.y - y0 * 32 - img.h));
}
// отметки (x,y в пикселях мира) из MARKS="x,y;x,y"
for (const mk of (process.env.MARKS ?? "").split(";").filter(Boolean)) {
  const [mx, my] = mk.split(",").map(Number);
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) out.set(mx - x0 * 32 + i, my - y0 * 32 + j, [255, 0, 255, 255]);
}
const png = new PNG({ width: out.w, height: out.h });
Buffer.from(out.data.buffer).copy(png.data);
fs.mkdirSync("tools/out", { recursive: true });
fs.writeFileSync("tools/out/region.png", PNG.sync.write(png));
console.log("tools/out/region.png", out.w, out.h);
