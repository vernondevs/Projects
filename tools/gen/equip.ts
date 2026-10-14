/** Иконки экипировки 32×32: тип × класс (шлем/доспех/сапоги) × редкость, плюс уникальные. */
import { PC, hex, mix, withA, type RGBA, type Ramp } from "./canvas";
import { P } from "./palette";
import { LEGENDARIES } from "../../shared/legendary";
import { BASE_ITEMS, ICON_VARIANT_SLOTS, ICON_VARIANTS, UNIQUES, iconId, type Rarity } from "../../shared/items";

const GEM: Ramp[] = [P.magic.green, P.magic.blue, P.magic.purple];
const GLOW: RGBA[] = [hex("#ffffff"), hex("#7ab8ff"), hex("#c47bff")];
const TRIM: Ramp[] = [P.steel, P.gold, P.gold];

type V = "warrior" | "mage" | "ranger";

function draw(kind: string, v: V, r: number): PC {
  const c = new PC(32, 32);
  const gem = GEM[r], trim = TRIM[r], dark = hex("#141018");
  const gemDot = (x: number, y: number, s = 2) => { c.shadedEllipse(x, y, s, s, gem); c.set(x - 1, y - 1, hex("#ffffff")); };
  switch (kind) {
    case "sword": {
      c.line(8, 25, 23, 8, P.steel[1], 3); c.line(9, 23, 22, 9, P.steel[3], 1); c.set(24, 7, P.steel[4]);
      c.line(6, 20, 12, 26, trim[2], 2); c.line(5, 27, 8, 24, P.wood[2], 2);
      if (r) gemDot(9, 23, 1.6);
      if (r === 2) { c.line(11, 21, 21, 10, GEM[2][4], 1); }
      break;
    }
    case "axe": {
      c.line(8, 27, 22, 6, P.wood[2], 2);
      c.poly([[16, 8], [26, 6], [27, 17], [20, 16]], P.steel[2 + (r ? 1 : 0)]); c.line(26, 6, 27, 17, P.steel[4], 1);
      if (r) { c.line(17, 9, 20, 15, gem[3], 1); c.line(10, 24, 12, 21, trim[3], 2); }
      if (r === 2) { c.set(24, 9, hex("#ffffff")); c.set(23, 13, gem[4]); }
      break;
    }
    case "staff": {
      c.line(8, 28, 21, 9, P.wood[2], 2); c.line(9, 28, 22, 9, P.wood[1], 1);
      if (r) { c.line(12, 23, 15, 19, trim[3], 2); }
      c.shadedEllipse(23, 7, 3.5, 3.5, GEM[r === 0 ? 1 : r]);
      if (r === 2) { for (const [x, y] of [[18, 3], [28, 4], [27, 12]]) c.set(x, y, GEM[2][4]); }
      if (r === 1) c.poly([[20, 12], [23, 14], [26, 12], [23, 10]], trim[3]);
      break;
    }
    case "bow": {
      const col = r ? trim[2] : P.wood[2];
      for (let t = -1; t <= 1.001; t += 0.05) { const x = 12 + (1 - t * t) * 9, y = 16 + t * 12; c.ellipse(x, y, 1.1, 1.1, col); }
      c.line(12, 4, 12, 28, hex("#e8e4d8"), 1);
      if (r) { c.rect(19, 14, 3, 5, P.leather[2]); gemDot(20, 16, 1.5); }
      if (r === 2) { c.set(17, 6, GEM[2][4]); c.set(17, 26, GEM[2][4]); }
      break;
    }
    case "helmet": {
      if (v === "warrior") {
        c.shadedEllipse(16, 16, 10, 9, P.steel); c.rect(6, 17, 20, 9, P.steel[1]); c.rect(8, 17, 16, 2, P.steel[3]);
        c.rect(10, 19, 12, 3, dark); c.rect(15, 19, 2, 7, P.steel[2]);
        c.rect(15, 5, 2, 5, r ? gem[2] : P.cloth.red[2]); c.rect(14, 4, 4, 2, r ? gem[3] : P.cloth.red[3]);
        if (r) { c.rect(6, 25, 20, 1, trim[2]); c.rect(8, 16, 16, 1, trim[3]); }
        if (r === 2) gemDot(16, 14, 1.8);
      } else if (v === "mage") {
        c.ellipse(16, 24, 13, 4, P.cloth.purple[1]); c.ellipse(16, 23, 12, 3, P.cloth.purple[2]);
        c.poly([[16, 2], [22, 12], [25, 23], [7, 23], [11, 12]], (x) => P.cloth.purple[x < 14 ? 3 : x > 19 ? 1 : 2]);
        c.poly([[16, 2], [21, 4], [20, 8], [17, 5]], P.cloth.purple[2]);
        c.rect(9, 19, 14, 3, r ? trim[2] : P.cloth.blue[2]);
        gemDot(16, 20, r ? 2 : 1.4);
        if (r === 2) { for (const [x, y] of [[13, 10], [18, 14], [15, 6]]) c.set(x, y, GEM[2][4]); }
      } else {
        c.poly([[16, 3], [24, 10], [26, 26], [20, 22], [12, 22], [6, 26], [8, 10]], (x) => P.cloth.green[x < 12 ? 3 : x > 20 ? 1 : 2]);
        c.poly([[16, 6], [21, 12], [21, 21], [11, 21], [11, 12]], dark);
        c.rect(13, 14, 2, 2, hex("#ffe070")); c.rect(17, 14, 2, 2, hex("#ffe070"));
        c.line(16, 3, 16, 7, P.cloth.green[3], 1);
        if (r) { c.line(8, 24, 24, 24, trim[2], 1); c.rect(15, 23, 3, 3, trim[3]); }
        if (r === 2) gemDot(16, 8, 1.5);
      }
      break;
    }
    case "armor": {
      if (v === "warrior") {
        c.poly([[7, 8], [12, 6], [16, 9], [20, 6], [25, 8], [26, 16], [23, 16], [23, 27], [9, 27], [9, 16], [6, 16]], (x) => P.steel[x < 13 ? 3 : x > 20 ? 1 : 2]);
        c.line(16, 10, 16, 26, P.steel[1], 1); c.rect(9, 20, 14, 2, r ? trim[2] : P.leather[2]);
        if (r) { c.rect(7, 8, 5, 2, trim[3]); c.rect(20, 8, 5, 2, trim[3]); gemDot(16, 21, 1.8); }
        if (r === 2) { c.line(10, 12, 10, 18, trim[3], 1); c.line(22, 12, 22, 18, trim[3], 1); }
      } else if (v === "mage") {
        c.poly([[11, 5], [16, 8], [21, 5], [27, 15], [24, 17], [23, 14], [25, 28], [7, 28], [9, 14], [8, 17], [5, 15]], (x) => P.cloth.purple[x < 13 ? 3 : x > 20 ? 1 : 2]);
        c.poly([[13, 5], [16, 8], [19, 5], [16, 14]], P.cloth.blue[3]);
        c.rect(8, 19, 16, 2, r ? trim[2] : P.leather[2]); gemDot(16, 20, r ? 1.8 : 1.2);
        c.line(16, 14, 16, 28, P.cloth.purple[0], 1);
        if (r) c.rect(7, 26, 18, 2, trim[2]);
        if (r === 2) { for (const [x, y] of [[11, 24], [20, 24], [16, 24]]) c.set(x, y, GEM[2][4]); }
      } else {
        c.poly([[10, 6], [16, 9], [22, 6], [25, 10], [24, 16], [22, 16], [22, 27], [10, 27], [10, 16], [8, 16], [7, 10]], (x) => P.leather[x < 13 ? 3 : x > 20 ? 1 : 2]);
        c.line(11, 7, 21, 25, P.leather[0], 2); c.rect(10, 21, 12, 2, P.cloth.green[2]);
        c.poly([[10, 6], [16, 9], [22, 6], [16, 12]], P.cloth.green[2]);
        if (r) { c.rect(10, 26, 12, 1, trim[2]); gemDot(16, 22, 1.5); }
        if (r === 2) { c.line(8, 10, 8, 15, trim[3], 1); c.line(24, 10, 24, 15, trim[3], 1); }
      }
      break;
    }
    case "boots": {
      if (v === "warrior") {
        for (const [x, d] of [[8, 0], [17, 1]]) { c.shadedRect(x, 7 + d, 7, 14, P.steel, 1); c.shadedRect(x, 20 + d, 11, 6, P.steel, 2); c.rect(x, 8 + d, 7, 2, r ? trim[3] : P.steel[4]); if (r) c.rect(x + 3, 14 + d, 2, 2, gem[3]); }
      } else if (v === "mage") {
        for (const [x, d] of [[9, 0], [18, 1]]) {
          c.shadedRect(x, 9 + d, 6, 12, P.cloth.purple, 1);
          c.poly([[x, 20 + d], [x + 6, 20 + d], [x + 9, 24 + d], [x + 12, 22 + d], [x + 11, 26 + d], [x, 26 + d]], P.cloth.purple[2]);
          c.rect(x, 10 + d, 6, 2, r ? trim[3] : P.cloth.blue[3]);
          if (r) c.set(x + 3, 15 + d, gem[3]);
        }
      } else {
        for (const [x, d] of [[9, 0], [17, 1]]) { c.shadedRect(x, 8 + d, 6, 14, P.leather, 1); c.shadedRect(x, 20 + d, 10, 6, P.leather, 2); c.rect(x - 1, 8 + d, 8, 3, P.cloth.green[2]); c.rect(x - 1, 8 + d, 8, 1, P.cloth.green[3]); if (r) c.rect(x, 14 + d, 6, 1, trim[2]); if (r === 2) c.set(x + 3, 17 + d, gem[4]); }
      }
      break;
    }
    case "ring": {
      c.ellipse(16, 18, 8, 8, trim[2]); c.ellipse(16, 18, 8, 3, trim[3]);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (Math.hypot(x + 0.5 - 16, y + 0.5 - 18) < 5) c.clear(x, y);
      c.shadedEllipse(16, 10, r ? 4.5 : 3.5, r ? 4.5 : 3.5, gem); c.set(15, 8, hex("#ffffff"));
      if (r === 2) { c.set(10, 8, gem[4]); c.set(22, 8, gem[4]); c.set(16, 4, gem[4]); }
      break;
    }
    case "amulet": {
      for (let t = 0; t <= 1; t += 0.03) c.set(8 + t * 16, 6 + Math.sin(t * Math.PI) * 10, trim[3]);
      c.shadedEllipse(16, 21, 6, 7, r ? P.gold : P.steel); c.shadedEllipse(16, 21, 3.5, 4, gem);
      if (r) for (const [x, y] of [[16, 13], [10, 21], [22, 21], [16, 29]]) c.set(x, y, P.gold[4]);
      if (r === 2) c.set(15, 19, hex("#ffffff"));
      break;
    }
  }
  c.outline();
  if (r === 2) {
    // свечение эпика: мягкий ореол вокруг силуэта
    const g = new PC(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (c.alpha(x, y)) continue;
      let near = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (c.alpha(x + dx, y + dy) > 200) near = Math.max(near, 3 - Math.max(Math.abs(dx), Math.abs(dy)));
      if (near) g.set(x, y, withA(GLOW[2], near === 2 ? 70 : 35));
    }
    g.blit(c, 0, 0);
    return g;
  }
  return c;
}

/** Окраска уникальных предметов: [цвет, сила]; для медалей арены — металл. */
const UNIQUE_TINT: Record<string, [string, number, V]> = {
  heartwood_staff: ["#4fa840", 0.4, "mage"], rootbreaker: ["#8a5a2a", 0.4, "warrior"], whisperwind: ["#50d0a0", 0.4, "ranger"],
  bark_helm: ["#7a5a30", 0.5, "warrior"], hexed_ring: ["#c040a0", 0.4, "mage"], bog_mantle: ["#5a8a40", 0.5, "ranger"],
  witch_eye: ["#d03070", 0.4, "mage"], swamp_treads: ["#4a7a50", 0.5, "ranger"], ashbringer: ["#ff6a20", 0.5, "warrior"],
  cinder_staff: ["#ff5010", 0.5, "mage"], phoenix_bow: ["#ff8a20", 0.5, "ranger"], ashen_crown: ["#ff7030", 0.45, "warrior"],
  arena_bronze: ["#b0703a", 0.6, "warrior"], arena_silver: ["#d0d8e8", 0.6, "warrior"], arena_gold: ["#ffc830", 0.6, "warrior"],
  arena_platinum: ["#a0f0e8", 0.6, "warrior"], arena_diamond: ["#70d8ff", 0.7, "warrior"],
};

export function buildUniqueIcon(id: string): PC {
  const u = UNIQUES[id];
  const [col, k, v] = UNIQUE_TINT[id];
  const tint = hex(col);
  const c = draw(BASE_ITEMS[u.base].icon, v, 2);
  c.map((p) => (p[3] < 255 || p[0] + p[1] + p[2] < 110 ? p : mix(p, tint, k)));
  // искры уникального предмета
  for (const [x, y] of [[3, 4], [28, 3], [27, 27], [4, 26]]) { c.set(x, y, hex("#ffffff")); c.set(x + 1, y, withA(tint, 200)); c.set(x, y + 1, withA(tint, 200)); }
  return c;
}

/** Легендарная иконка: эпическая база, оранжевая окраска, золотая кайма и яркий ореол. */
export function buildLegendaryIcon(id: string): PC {
  const u = LEGENDARIES[id];
  const tint = hex(u.tint), orange = hex("#ff9a2e");
  const c = draw(BASE_ITEMS[u.base].icon, u.variant as V, 2);
  c.map((p) => (p[3] < 255 || p[0] + p[1] + p[2] < 110 ? p : mix(p, tint, 0.35)));
  const g = new PC(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (c.alpha(x, y)) continue;
    let near = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (c.alpha(x + dx, y + dy) > 200) near = Math.max(near, 4 - Math.max(Math.abs(dx), Math.abs(dy)));
    if (near) g.set(x, y, withA(orange, near === 3 ? 150 : near === 2 ? 90 : 45));
  }
  g.blit(c, 0, 0);
  for (const [x, y] of [[3, 4], [28, 3], [27, 27], [4, 26], [16, 2]]) { g.set(x, y, hex("#ffffff")); g.set(x + 1, y, withA(orange, 220)); g.set(x, y + 1, withA(orange, 220)); g.set(x - 1, y, withA(orange, 140)); }
  return g;
}

/** Все id иконок экипировки: имя -> холст. */
export function buildEquipIcons(): Record<string, PC> {
  const out: Record<string, PC> = {};
  for (const b of Object.values(BASE_ITEMS)) {
    if (b.slot === "consumable") continue;
    const variants = ICON_VARIANT_SLOTS.includes(b.icon) ? ICON_VARIANTS : [ICON_VARIANTS[0]];
    for (const v of variants) for (const r of [0, 1, 2] as Rarity[]) out[iconId(b.icon, v, r)] = draw(b.icon, v as V, r);
  }
  for (const id of Object.keys(UNIQUES)) out["uq_" + id] = buildUniqueIcon(id);
  for (const id of Object.keys(LEGENDARIES)) out["lg_" + id] = buildLegendaryIcon(id);
  return out;
}
