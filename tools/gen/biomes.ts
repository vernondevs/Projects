/** Объекты и иконки ресурсов биомов: пустыня, снега, вулкан, подводная бухта. Опорная точка — нижняя середина. */
import { PC, hash01, hex, ramp, rng, shade, withA, type Ramp } from "./canvas";
import { P } from "./palette";

type Art = () => PC;
const cactusG = ramp("#16402a", "#24603a", "#3c8a44", "#6cb45a", "#a0d878");
const sandRock = ramp("#6a4a2a", "#8c6636", "#b08848", "#d0a866", "#e8c88a");
const snowRock = ramp("#4a5870", "#6c7e98", "#9aaec8", "#c4d6ea", "#f2f8ff");
const basaltR = ramp("#14121c", "#241f30", "#382f4a", "#4e4468", "#6a5e88");

/** Неровный валун заданной палитры. */
function boulder(w: number, h: number, seed: number, r: Ramp, crack = r[0]): PC {
  const c = new PC(w, h);
  const R = rng(seed);
  const pts: [number, number][] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = (w / 2 - 2) * (0.8 + R() * 0.2), ry = h * 0.42 * (0.75 + R() * 0.25);
    pts.push([w / 2 + Math.cos(a) * rx, h - 2 - ry + Math.sin(a) * ry * (Math.sin(a) > 0 ? 0.55 : 1)]);
  }
  c.poly(pts, (x, y) => {
    const u = (x - w / 2) / w, v = (y - (h - 2 - h * 0.42)) / (h * 0.42);
    const l = -u * 0.8 - v * 0.9 + hash01(x, y, seed) * 0.25;
    return r[l > 0.45 ? 4 : l > 0.1 ? 3 : l > -0.3 ? 2 : 1];
  });
  c.line(w * 0.35, h * 0.55, w * 0.5, h * 0.7, crack, 1);
  return c.outline();
}

const cactus: Art = () => {
  const c = new PC(32, 44);
  c.shadedRect(12, 8, 8, 34, cactusG, 3);
  c.shadedRect(4, 22, 9, 4, cactusG, 1); c.shadedRect(4, 12, 5, 14, cactusG, 2);
  c.shadedRect(19, 26, 9, 4, cactusG, 1); c.shadedRect(23, 16, 5, 14, cactusG, 2);
  for (const [x, y] of [[14, 14], [17, 20], [14, 28], [17, 34], [6, 16], [25, 22]]) c.set(x, y, cactusG[4]);
  c.ellipse(16, 8, 2.2, 1.6, hex("#e8527a")); c.set(16, 7, hex("#ffd0e0"));
  return c.outline();
};
const cactusSmall: Art = () => {
  const c = new PC(32, 28);
  c.shadedEllipse(11, 22, 5, 6, cactusG); c.shadedEllipse(20, 21, 4, 5, cactusG); c.shadedEllipse(16, 22, 3.5, 4, cactusG);
  for (const [x, y] of [[10, 18], [20, 18], [16, 19]]) c.set(x, y, cactusG[4]);
  c.ellipse(20, 16, 1.4, 1.2, hex("#f2c040"));
  return c.outline();
};
const palm: Art = () => {
  const c = new PC(64, 80);
  c.poly([[30, 79], [36, 79], [37, 40], [32, 22], [31, 24], [33, 40]], (x) => P.bark[x < 33 ? 3 : 2]);
  for (let y = 30; y < 78; y += 5) c.line(31, y, 36, y - 1, P.bark[1], 1);
  const L = ramp("#1c4a22", "#2c6c30", "#46923c", "#78c050");
  for (const [dx, dy, len] of [[-24, 6, 26], [-18, -6, 22], [24, 6, 26], [18, -6, 22], [0, -12, 14], [-10, 12, 20], [10, 12, 20]] as number[][]) {
    const x0 = 33, y0 = 22;
    for (let t = 0; t <= 1; t += 0.03) {
      const x = x0 + dx * t, y = y0 + dy * t - Math.sin(t * Math.PI) * 8 + t * t * 8;
      c.rect(x - 1, y - 1, 3, 2, L[1 + (t > 0.5 ? 2 : 1)]);
    }
    void len;
  }
  c.ellipse(31, 25, 2, 2, P.bark[1]); c.ellipse(35, 25, 2, 2, P.bark[1]);
  return c.outline();
};
const dryBush: Art = () => {
  const c = new PC(32, 32);
  const R = rng(7);
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (R() - 0.5) * 2.2, l = 8 + R() * 8;
    c.line(16, 30, 16 + Math.cos(a) * l, 30 + Math.sin(a) * l, P.deadwood[2 + (i % 2)], 1);
  }
  return c.outline(withA(hex("#1b1422"), 140));
};

const snowPine: Art = () => {
  const c = new PC(48, 64);
  c.rect(22, 50, 5, 14, P.bark[2]);
  c.rect(22, 50, 1, 14, P.bark[3]);
  for (let i = 0; i < 4; i++) {
    const top = 2 + i * 11, bot = top + 20, w = 8 + i * 4;
    c.poly([[24, top], [24 + w, bot], [24 - w, bot]], (x, y) => {
      const u = (x - (24 - w)) / (2 * w);
      return P.pine[y > bot - 2 ? 0 : u < 0.35 ? 3 : u < 0.6 ? 2 : u < 0.8 ? 1 : 0];
    });
  }
  // снежные шапки: верх каждого яруса и кромка
  const src = c.clone();
  c.map((col, x, y) => {
    const up = src.alpha(x, y - 1), up2 = src.alpha(x, y - 2), up3 = src.alpha(x, y - 3);
    const edgeL = src.alpha(x - 1, y - 1) === 0 && y % 11 < 8;
    if (y > 50) return col;
    if (!up || (!up2 && y % 3 !== 0) || (!up3 && hash01(x, y, 5) > 0.4) || (edgeL && hash01(x, y, 6) > 0.5)) return P.snow[3 + (x % 2)];
    return col;
  });
  return c.outline();
};
const snowRockArt: Art = () => {
  const c = boulder(32, 28, 41, snowRock);
  const src = c.clone();
  c.map((col, x, y) => (!src.alpha(x, y - 1) || !src.alpha(x, y - 2) ? P.snow[4] : col));
  return c.outline();
};
const iceSpike: Art = () => {
  const c = new PC(32, 48);
  for (const [x, h, w] of [[11, 26, 5], [18, 38, 6], [24, 20, 4]]) {
    c.poly([[x - w, 46], [x - w + 1, 46 - h * 0.6], [x, 46 - h], [x + w - 1, 46 - h * 0.55], [x + w, 46]], (px) => P.ice[px < x - 1 ? 3 : px < x + 1 ? 4 : 2]);
    c.line(x, 46 - h + 2, x - 1, 44, P.ice[4], 1);
  }
  c.ellipse(16, 46, 12, 2, withA(P.snow[3], 255));
  return c.outline();
};
const snowBush: Art = () => {
  const c = new PC(32, 32);
  c.shadedEllipse(16, 25, 9, 5, ramp("#12281e", "#1a3a28", "#245032", "#30663c"));
  c.shadedEllipse(16, 22, 8, 3.5, P.snow);
  for (const [x, y] of [[12, 24], [20, 25]]) c.ellipse(x, y, 1.2, 1.2, hex("#d84050"));
  return c.outline();
};

const obsidianSpire: Art = () => {
  const c = new PC(32, 56);
  for (const [x, h, w] of [[12, 34, 5], [19, 52, 6], [25, 26, 4]]) {
    c.poly([[x - w, 54], [x - w + 1, 54 - h * 0.6], [x, 54 - h], [x + w - 1, 54 - h * 0.5], [x + w, 54]], (px) => P.obsidian[px < x - 1 ? 3 : px < x + 2 ? 2 : 1]);
    c.line(x - 1, 54 - h + 3, x - 2, 50, P.obsidian[4], 1);
  }
  c.line(14, 50, 22, 38, hex("#f06a1a"), 1);
  return c.outline();
};
const basalt: Art = () => boulder(32, 28, 53, basaltR, hex("#f06a1a"));
const sandstone: Art = () => boulder(32, 28, 61, sandRock);

const coralA: Art = () => {
  const c = new PC(32, 40);
  const R = rng(3);
  const col = P.coral.pink;
  c.line(16, 38, 16, 18, col[2], 4);
  for (const [x, y, ex, ey] of [[16, 28, 7, 12], [16, 24, 25, 8], [16, 33, 6, 26], [16, 30, 26, 22]] as number[][]) {
    c.line(x, y, ex, ey, col[2], 3);
    c.ellipse(ex, ey, 2.5, 2.5, col[3]);
  }
  c.ellipse(16, 16, 3.5, 3.5, col[3]);
  for (let i = 0; i < 8; i++) c.set(8 + R() * 16, 14 + R() * 24, col[1]);
  return c.outline();
};
const coralB: Art = () => {
  const c = new PC(32, 32);
  c.shadedEllipse(16, 22, 11, 8, P.coral.orange);
  for (const [x, y] of [[9, 20], [14, 16], [20, 17], [24, 21], [16, 22], [11, 25], [20, 25]]) { c.ellipse(x, y, 2.2, 1.8, P.coral.orange[0]); c.set(x, y - 1, P.coral.orange[3]); }
  c.shadedEllipse(8, 27, 4, 3, P.coral.purple);
  c.shadedEllipse(25, 27, 4.5, 3.5, P.coral.purple);
  return c.outline();
};
const kelp: Art = () => {
  const c = new PC(32, 56);
  const L = ramp("#143a24", "#1e5a30", "#2e8040", "#58b058");
  for (const [x0, h, ph] of [[10, 44, 0], [16, 54, 2], [22, 38, 4]]) {
    for (let y = 0; y < h; y++) {
      const x = x0 + Math.sin(y * 0.22 + ph) * 3;
      c.rect(x, 55 - y, 2, 1, L[1 + (y % 6 < 3 ? 1 : 2)]);
      if (y % 9 === 4) c.rect(x + 2, 55 - y, 2, 1, L[3]);
    }
  }
  return c.outline(withA(hex("#102030"), 160));
};
const shell: Art = () => {
  const c = new PC(32, 32);
  c.shadedEllipse(16, 24, 5, 4, ramp("#7a5a6a", "#b08a98", "#e0b8c0", "#fff0f0"));
  for (let i = -2; i <= 2; i++) c.line(16, 27, 16 + i * 2, 21, hex("#b08a98"), 1);
  return c.outline();
};
const airVent: Art = () => {
  const c = new PC(32, 32);
  c.shadedEllipse(16, 26, 9, 4, P.seabed.map((x) => shade(x, 0.8)));
  c.ellipse(16, 26, 5, 2, hex("#0a2a3a"));
  for (const [x, y, r] of [[16, 20, 3], [13, 13, 2.2], [19, 8, 1.8], [15, 3, 1.4]]) {
    c.ellipse(x, y, r, r, withA(hex("#bfeaff"), 170));
    c.set(x - 1, y - 1, hex("#ffffff"));
  }
  return c.outline(withA(hex("#102030"), 160));
};

// ---- узлы добычи ----
const nodeCactus: Art = () => {
  const c = new PC(32, 40);
  c.shadedRect(10, 14, 12, 24, cactusG, 4);
  c.shadedEllipse(16, 14, 6, 4, cactusG);
  for (const x of [13, 16, 19]) c.line(x, 16, x, 34, cactusG[1], 1);
  c.ellipse(16, 10, 3, 2.5, hex("#f2c040")); c.ellipse(16, 10, 1.5, 1, hex("#fff0a0"));
  for (const [x, y] of [[8, 26], [24, 22]]) c.ellipse(x, y, 1.5, 1.5, hex("#c8f0d0"));
  c.ellipse(16, 38, 11, 2, withA(hex("#d8b878"), 200));
  return c.outline();
};
const nodeIce: Art = () => {
  const c = new PC(32, 40);
  for (const [x, h, w] of [[11, 22, 4], [17, 34, 5], [23, 18, 4]]) {
    c.poly([[x - w, 38], [x - w + 1, 38 - h * 0.6], [x, 38 - h], [x + w - 1, 38 - h * 0.55], [x + w, 38]], (px) => P.ice[px < x - 1 ? 2 : px < x + 1 ? 4 : 3]);
    c.line(x, 38 - h + 2, x - 1, 36, P.ice[4], 1);
  }
  c.set(18, 8, hex("#ffffff")); c.set(10, 22, hex("#ffffff"));
  return c.outline();
};
const nodeObsidian: Art = () => {
  const c = boulder(32, 32, 77, ramp("#0e0c16", "#1a1626", "#2a2440", "#40385c", "#8a7ac0"), hex("#f06a1a"));
  c.line(10, 20, 14, 16, hex("#f06a1a"), 1); c.line(20, 22, 24, 18, hex("#ffb03a"), 1);
  return c;
};
const nodePearl: Art = () => {
  const c = new PC(32, 32);
  const sh = ramp("#5a3a4a", "#8a6070", "#c08a98", "#ecc0c8");
  c.shadedEllipse(16, 24, 11, 6, sh);
  for (let i = -3; i <= 3; i++) c.line(16, 28, 16 + i * 3, 19, sh[0], 1);
  c.shadedEllipse(16, 20, 11, 4, sh);
  c.ellipse(16, 19, 3.2, 3.2, hex("#f4f0ff")); c.ellipse(15, 18, 1.2, 1.2, hex("#ffffff")); c.set(17, 20, hex("#b8c0e8"));
  return c.outline();
};

export const BIOME_ART: Record<string, Art> = {
  cactus, cactus_small: cactusSmall, palm, dry_bush: dryBush, sandstone,
  snow_pine: snowPine, snow_rock: snowRockArt, ice_spike: iceSpike, snow_bush: snowBush,
  obsidian_spire: obsidianSpire, basalt,
  coral_a: coralA, coral_b: coralB, kelp, shell, air_vent: airVent,
  node_cactus: nodeCactus, node_ice: nodeIce, node_obsidian: nodeObsidian, node_pearl: nodePearl,
};

/** Иконки ресурсов 32×32. */
export function resourceIcon(kind: string): PC {
  const c = new PC(32, 32);
  switch (kind) {
    case "res_cactus_juice": {
      c.rect(13, 5, 6, 4, P.wood[2]);
      c.shadedEllipse(16, 19, 8, 9, ramp("#1e5a30", "#3c9a4a", "#74d070", "#b8f0a0"));
      c.rect(14, 8, 4, 3, withA(hex("#c8d8e8"), 220));
      c.ellipse(13, 17, 2, 2.5, withA(hex("#ffffff"), 150));
      break;
    }
    case "res_ice_crystal":
      c.poly([[16, 3], [24, 12], [21, 28], [11, 28], [8, 12]], (x) => P.ice[x < 14 ? 3 : x < 18 ? 4 : 2]);
      c.line(16, 5, 13, 26, P.ice[4], 1);
      c.line(11, 14, 21, 14, P.ice[1], 1);
      break;
    case "res_obsidian":
      c.poly([[6, 22], [10, 10], [19, 6], [26, 14], [25, 25], [12, 27]], (x) => P.obsidian[x < 13 ? 3 : x > 20 ? 1 : 2]);
      c.line(11, 11, 17, 9, P.obsidian[4], 1);
      c.line(14, 24, 22, 18, hex("#f06a1a"), 1);
      break;
    case "res_pearl":
      c.ellipse(16, 17, 9, 9, withA(hex("#b8c8f0"), 90));
      c.shadedEllipse(16, 17, 7, 7, ramp("#a8a0c8", "#d0cce8", "#f0ecff", "#ffffff"));
      c.ellipse(13, 14, 2, 2, withA(hex("#ffffff"), 230));
      c.set(19, 20, hex("#c8b0e8"));
      break;
  }
  return c.outline();
}
