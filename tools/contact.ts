/** Отладка: контактный лист — первые кадры (ходьба вниз/вбок, атака, смерть) всех юнитов, ×3. */
import { PNG } from "pngjs";
import fs from "node:fs";
const dir = "client/public/assets/units";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
const S = 3, cell = 64;
const cols = [0, 1, 5, 6, 10];
const rows = [0, 2];
const out = new PNG({ width: cols.length * rows.length * cell * S, height: files.length * cell * S });
out.data.fill(0);
files.forEach((f, fi) => {
  const src = PNG.sync.read(fs.readFileSync(`${dir}/${f}`));
  const fw = src.height / 3;
  let slot = 0;
  for (const r of rows) for (const c of cols) {
    for (let y = 0; y < cell * S; y++) for (let x = 0; x < cell * S; x++) {
      const sx = c * fw + Math.floor(x / S) - (cell - fw) / 2, sy = r * fw + Math.floor(y / S) - (cell - fw);
      const o = ((fi * cell * S + y) * out.width + slot * cell * S + x) * 4;
      const bg = (fi + slot) % 2 ? [92, 110, 78] : [84, 100, 72];
      let col = bg;
      if (sx >= c * fw && sx < (c + 1) * fw && sy >= r * fw && sy < (r + 1) * fw) {
        const i = (sy * src.width + sx) * 4, a = src.data[i + 3] / 255;
        col = [0, 1, 2].map((k) => src.data[i + k] * a + bg[k] * (1 - a));
      }
      out.data[o] = col[0]; out.data[o + 1] = col[1]; out.data[o + 2] = col[2]; out.data[o + 3] = 255;
    }
    slot++;
  }
});
fs.writeFileSync("tools/out/contact.png", PNG.sync.write(out));
console.log(files.join(" "));
