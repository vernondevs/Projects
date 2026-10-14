/** Отладка: увеличивает PNG без сглаживания и кладёт на серый фон. tsx tools/zoom.ts in.png out.png [scale] */
import { PNG } from "pngjs";
import fs from "node:fs";
const [inp, out, sc] = process.argv.slice(2);
const s = Number(sc || 3);
const src = PNG.sync.read(fs.readFileSync(inp));
const dst = new PNG({ width: src.width * s, height: src.height * s });
for (let y = 0; y < dst.height; y++) for (let x = 0; x < dst.width; x++) {
  const i = ((Math.floor(y / s) * src.width + Math.floor(x / s)) * 4), o = (y * dst.width + x) * 4;
  const a = src.data[i + 3] / 255;
  const bg = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) ? 96 : 84;
  for (let k = 0; k < 3; k++) dst.data[o + k] = src.data[i + k] * a + bg * (1 - a);
  dst.data[o + 3] = 255;
}
fs.writeFileSync(out, PNG.sync.write(dst));
