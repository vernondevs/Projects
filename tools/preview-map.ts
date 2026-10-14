/** Отладочное превью карты: tools/out/map-preview.png (4 px на тайл). */
import { PNG } from "pngjs";
import fs from "node:fs";
import { generateMap, CELL_BLOCK, CELL_WALL } from "../shared/map";
import { MAP_SEED } from "../shared/constants";

const m = generateMap(MAP_SEED);
const S = 4;
const png = new PNG({ width: m.w * S, height: m.h * S });
const COLORS = ["#3b6fb6", "#e0562b", "#d9c48a", "#4b5a3a", "#5c5150", "#9b7a52", "#6aa84f", "#3d6e3a", "#a29a8c", "#57525c"];
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
for (let y = 0; y < m.h * S; y++) for (let x = 0; x < m.w * S; x++) {
  const cx = Math.floor(x / S), cy = Math.floor(y / S);
  let c = hex(COLORS[m.vtx[cy * (m.w + 1) + cx]]);
  const f = m.cell[cy * m.w + cx];
  if (f & CELL_WALL) c = [40, 34, 44];
  else if (f & CELL_BLOCK) c = c.map((v) => v * 0.6);
  const i = (y * png.width + x) * 4;
  png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
}
const dot = (px: number, py: number, c: number[], r = 1) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor((px / 32) * S) + dx, y = Math.floor((py / 32) * S) + dy;
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
    const i = (y * png.width + x) * 4;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2];
  }
};
for (const s of m.spawns) dot(s.x, s.y, [255, 40, 200], 1);
for (const b of m.bosses) dot(b.x, b.y, [255, 255, 0], 3);
dot(m.playerSpawn.x, m.playerSpawn.y, [255, 255, 255], 2);
fs.mkdirSync("tools/out", { recursive: true });
fs.writeFileSync("tools/out/map-preview.png", PNG.sync.write(png));
const counts: Record<string, number> = {};
for (const o of m.objects) counts[o.kind] = (counts[o.kind] || 0) + 1;
console.log("objects", m.objects.length, counts);
console.log("spawns", m.spawns.length, m.spawns.reduce((a, s) => ((a[s.mob] = (a[s.mob] || 0) + 1), a), {} as Record<string, number>));
