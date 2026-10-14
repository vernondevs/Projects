/** Отладка: склеивает PNG из папки в сетку ×2. tsx tools/montage.ts dir out.png cell */
import { PNG } from "pngjs";
import fs from "node:fs";
const [dir, outFile, cellArg] = process.argv.slice(2);
const cell = Number(cellArg || 128), S = 2;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const cols = Math.min(8, files.length), rows = Math.ceil(files.length / cols);
const out = new PNG({ width: cols * cell * S, height: rows * cell * S });
for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 86; out.data[i + 1] = 120; out.data[i + 2] = 70; out.data[i + 3] = 255; }
files.forEach((f, n) => {
  const src = PNG.sync.read(fs.readFileSync(`${dir}/${f}`));
  const ox = (n % cols) * cell * S + (cell * S - src.width * S) / 2, oy = Math.floor(n / cols) * cell * S + (cell * S - src.height * S);
  for (let y = 0; y < src.height * S; y++) for (let x = 0; x < src.width * S; x++) {
    const i = (Math.floor(y / S) * src.width + Math.floor(x / S)) * 4, a = src.data[i + 3] / 255;
    const X = Math.floor(ox + x), Y = Math.floor(oy + y);
    if (X < 0 || Y < 0 || X >= out.width || Y >= out.height || !a) continue;
    const o = (Y * out.width + X) * 4;
    for (let k = 0; k < 3; k++) out.data[o + k] = src.data[i + k] * a + out.data[o + k] * (1 - a);
  }
});
fs.writeFileSync(outFile, PNG.sync.write(out));
console.log(files.join(" "));
