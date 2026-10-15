/**
 * Генератор всех игровых ассетов (оригинальный пиксель-арт, сетка 32×32).
 * Запуск: npm run assets. Результат: client/public/assets/** и manifest.json.
 */
import fs from "node:fs";
import { PNG } from "pngjs";
import path from "node:path";
import { buildEquipIcons } from "./gen/equip";
import { buildItemIcon, buildSkillIcon, FX_ART, ITEM_ICONS, OBJECT_ART, SKILL_ICONS } from "./gen/objects";
import { buildLavaGlow, buildTileset, buildWater } from "./gen/tiles";
import { buildUnitSheet, UNIT_ART } from "./gen/units";

const OUT = path.resolve("client/public/assets");
const t0 = Date.now();
const manifest = {
  units: {} as Record<string, { frame: number }>,
  objects: {} as Record<string, { w: number; h: number }>,
  icons: [] as string[],
  fx: [] as string[],
};

buildTileset().save(path.join(OUT, "tiles/terrain.png"));
buildWater(0).save(path.join(OUT, "tiles/water.png"));
buildLavaGlow().save(path.join(OUT, "tiles/lava_glow.png"));

for (const [id, art] of Object.entries(UNIT_ART)) {
  buildUnitSheet(id).save(path.join(OUT, `units/${id}.png`));
  manifest.units[id] = { frame: art.frame };
}
for (const [id, art] of Object.entries(OBJECT_ART)) {
  const pc = art();
  pc.save(path.join(OUT, `objects/${id}.png`));
  manifest.objects[id] = { w: pc.w, h: pc.h };
}
for (const [id, pc] of Object.entries(buildEquipIcons())) {
  pc.save(path.join(OUT, `icons/${id}.png`));
  manifest.icons.push(id);
}
for (const id of ITEM_ICONS.filter((i) => i.startsWith("potion") || i.startsWith("food_") || i.startsWith("mat_") || i.startsWith("res_") || i === "gold")) {
  buildItemIcon(id).save(path.join(OUT, `icons/${id}.png`));
  manifest.icons.push(id);
}
for (const id of Object.keys(SKILL_ICONS)) {
  buildSkillIcon(id).save(path.join(OUT, `icons/${id}.png`));
  manifest.icons.push(id);
}
for (const [id, art] of Object.entries(FX_ART)) {
  art().save(path.join(OUT, `fx/${id}.png`));
  manifest.fx.push(id);
}

// Ручные PNG (не из генератора) тоже попадают в манифест: можно просто положить файл в папку.
const pngSize = (f: string) => {
  const p = PNG.sync.read(fs.readFileSync(f));
  return { w: p.width, h: p.height };
};
const scan = (dir: string) => fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
for (const id of scan("units")) if (!manifest.units[id]) manifest.units[id] = { frame: pngSize(path.join(OUT, "units", id + ".png")).h / 3 };
for (const id of scan("objects")) if (!manifest.objects[id]) manifest.objects[id] = pngSize(path.join(OUT, "objects", id + ".png"));
for (const id of scan("icons")) if (!manifest.icons.includes(id)) manifest.icons.push(id);
for (const id of scan("fx")) if (!manifest.fx.includes(id)) manifest.fx.push(id);

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`[assets] готово за ${Date.now() - t0} мс -> ${path.relative(process.cwd(), OUT)}`);
