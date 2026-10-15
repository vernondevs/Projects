/** Пиксель-арт малых городов: Оазис Миражей (песчаник, шатры, пальмы) и Снежная долина (частокол, срубы, жаровни); камень телепорта. */
import { PC, hash01, hex, ramp, withA, type Ramp } from "./canvas";
import { P } from "./palette";
import { bricks, slabs, stallArt } from "./town";

type Art = () => PC;

const SAND = ramp("#5e3e22", "#8c6638", "#b88c50", "#d8b074", "#f0d498");
const TEAL = ramp("#0e3a3c", "#1a5c5a", "#2a8a80", "#58b8a8");
const SNOWC = ramp("#8aa0c0", "#b4c8e0", "#dce8f6", "#f4f9ff");
const LOG = ramp("#2e1c10", "#4c2e18", "#6e4624", "#946034", "#b27c46");
const FIRE = P.magic.fire;

/** Зубцы песчаника. */
function merlons(c: PC, x: number, y: number, w: number, bw: number, step: number, h: number, r: Ramp) {
  for (let i = 1; i + bw <= w; i += step) {
    c.shadedRect(x + i, y, bw, h, r);
    c.rect(x + i, y, bw, 2, r[4]);
  }
}
const window_ = (c: PC, x: number, y: number, w: number, h: number, frame: Ramp) => {
  c.rect(x - 1, y - 1, w + 2, h + 2, frame[0]);
  c.rect(x, y, w, h, P.glass[1]);
  c.rect(x, y, w, Math.ceil(h / 3), P.glass[2]);
  c.rect(x + Math.floor(w / 2), y, 1, h, frame[0]);
};
/** Снежная шапка на горизонтальной кромке. */
function snowCap(c: PC, x: number, y: number, w: number, seed: number) {
  for (let i = 0; i < w; i++) {
    const h = 2 + Math.floor(hash01(i, seed, 5) * 3);
    for (let j = 0; j < h; j++) c.set(x + i, y - j, SNOWC[j === h - 1 ? 3 : 2]);
    c.set(x + i, y + 1, SNOWC[1]);
  }
}

// ---------------- Оазис ----------------
const sandWallH: Art = () => {
  const c = new PC(32, 56);
  slabs(c, 0, 8, 32, 22, SAND, 5);
  merlons(c, 0, 0, 32, 6, 11, 10, SAND);
  c.rect(0, 28, 32, 4, SAND[4]);
  bricks(c, 0, 32, 32, 24, SAND, 7);
  c.rect(0, 32, 32, 1, SAND[1]);
  c.rect(0, 54, 32, 2, SAND[0]);
  return c;
};
const sandWallV: Art = () => {
  const c = new PC(32, 56);
  slabs(c, 0, 0, 32, 32, SAND, 9);
  for (const x of [0, 25]) {
    c.rect(x, 0, 7, 32, SAND[3]);
    c.rect(x + 1, 0, 5, 32, SAND[4]);
    for (let y = 2; y < 32; y += 11) c.shadedRect(x, y, 7, 6, SAND);
  }
  bricks(c, 0, 32, 32, 24, SAND, 8);
  c.rect(0, 32, 32, 1, SAND[1]);
  c.rect(0, 54, 32, 2, SAND[0]);
  return c;
};
const sandTower: Art = () => {
  const c = new PC(64, 136);
  const top = 46;
  bricks(c, 4, top + 14, 56, 136 - top - 14, SAND, 12);
  for (let y = top + 14; y < 136; y++) { c.set(4, y, SAND[1]); c.set(59, y, SAND[0]); c.set(58, y, SAND[1]); }
  c.rect(4, 132, 56, 4, SAND[1]);
  c.shadedRect(1, top + 6, 62, 10, SAND);
  merlons(c, 1, top - 4, 62, 8, 12, 11, SAND);
  // бирюзовый шатёр-купол над башней
  c.poly([[32, 4], [50, top - 6], [14, top - 6]], (x, y) => (y % 5 === 4 ? TEAL[0] : x < 32 ? TEAL[3] : TEAL[2]));
  c.rect(31, 0, 2, 8, P.gold[3]);
  c.ellipse(32, 2, 2.5, 2.5, P.gold[3]);
  // арочное окно и полосатый навес
  c.rect(28, top + 28, 8, 16, hex("#120e14"));
  c.ellipse(32, top + 28, 4, 4, hex("#120e14"));
  c.rect(30, top + 32, 4, 4, withA(hex("#ffb84a"), 210));
  for (let i = 0; i < 6; i++) c.rect(14 + i * 6, top + 52, 6, 14, i % 2 ? hex("#e8e0d0") : TEAL[2]);
  c.rect(14, top + 50, 36, 3, SAND[0]);
  return c.outline();
};
function archGate(body: Ramp, accent: Ramp, seed: number): PC {
  const c = new PC(96, 92);
  const face = 34;
  slabs(c, 0, 10, 96, face - 10, body, seed);
  merlons(c, 0, 0, 96, 8, 12, 12, body);
  bricks(c, 0, face, 96, 58, body, seed + 1);
  const ox = 48, oy = 62, rx = 38;
  for (let y = face + 6; y < 92; y++) for (let x = 0; x < 96; x++) {
    const inside = y >= oy ? Math.abs(x + 0.5 - ox) < rx : ((x + 0.5 - ox) / rx) ** 2 + ((y + 0.5 - oy) / (oy - face - 6)) ** 2 < 1;
    if (inside) c.clear(x, y);
  }
  for (let a = 0; a <= 60; a++) {
    const t = Math.PI * (a / 60);
    const x = ox - Math.cos(t) * (rx + 1.5), y = oy - Math.sin(t) * (oy - face - 6 + 1.5);
    c.set(x, y, body[4]);
    c.set(x, y + 1, body[3]);
  }
  // знамя над проёмом
  c.rect(34, 12, 28, 18, accent[1]);
  c.rect(35, 12, 26, 16, accent[2]);
  c.poly([[34, 30], [62, 30], [48, 38]], accent[2]);
  c.ellipse(48, 21, 5, 5, P.gold[2]);
  c.ellipse(48, 21, 2.5, 2.5, accent[1]);
  c.shadedRect(0, face, 10, 58, body);
  c.shadedRect(86, face, 10, 58, body);
  return c.outline();
}
const sandGate: Art = () => archGate(SAND, TEAL, 21);

function adobe(dome: boolean): PC {
  const c = new PC(128, 128);
  const body = SAND;
  c.shadedRect(6, 50, 116, 76, body);
  bricks(c, 6, 50, 116, 76, body, dome ? 31 : 32);
  c.rect(6, 122, 116, 4, SAND[0]);
  // плоская крыша с парапетом
  c.shadedRect(0, 38, 128, 16, SAND);
  merlons(c, 0, 30, 128, 10, 14, 10, SAND);
  if (dome) {
    c.ellipse(64, 34, 22, 20, TEAL[2]);
    c.poly([[42, 34], [86, 34], [86, 40], [42, 40]], SAND[2]);
    for (let y = 14; y < 34; y++) for (let x = 42; x < 87; x++) {
      const k = ((x - 64) / 22) ** 2 + ((y - 34) / 20) ** 2;
      if (k < 1) c.set(x, y, (x - 64) / 22 + (y - 34) / 20 < -0.5 ? TEAL[3] : x > 70 ? TEAL[1] : TEAL[2]);
    }
    c.rect(63, 8, 2, 8, P.gold[3]);
  } else {
    // навес на крыше и горшки
    c.poly([[14, 30], [58, 30], [52, 18], [20, 18]], (x) => (Math.floor(x / 6) % 2 ? hex("#e8e0d0") : TEAL[2]));
    c.rect(18, 30, 2, 10, SAND[0]); c.rect(52, 30, 2, 10, SAND[0]);
    c.shadedEllipse(96, 26, 5, 5, P.roofRed);
  }
  // арочная дверь с бирюзовым навесом
  c.rect(54, 92, 20, 34, hex("#1c1210"));
  c.ellipse(64, 92, 10, 8, hex("#1c1210"));
  c.shadedRect(56, 96, 16, 30, P.wood, 2);
  c.rect(64, 98, 1, 28, P.wood[0]);
  c.poly([[46, 90], [82, 90], [78, 80], [50, 80]], (x) => (Math.floor(x / 6) % 2 ? hex("#e8e0d0") : TEAL[2]));
  // окна-арки
  for (const x of [18, 96]) {
    c.rect(x - 1, 66, 14, 18, SAND[0]);
    c.rect(x, 68, 12, 16, P.glass[1]);
    c.rect(x, 68, 12, 5, P.glass[2]);
    c.rect(x + 5, 68, 1, 16, SAND[0]);
    c.rect(x - 2, 84, 16, 3, SAND[4]);
  }
  return c.outline();
}

const tent: Art = () => {
  const c = new PC(96, 80);
  c.poly([[2, 76], [94, 76], [48, 8]], (x, y) => {
    const stripe = Math.floor((x + (76 - y) * 0.4) / 8) % 2;
    const lit = x < 48 ? 0 : 1;
    return stripe ? (lit ? hex("#cdbfa8") : hex("#e8e0d0")) : lit ? TEAL[1] : TEAL[2];
  });
  c.poly([[34, 76], [62, 76], [48, 38]], hex("#1c1210"));
  c.poly([[34, 76], [46, 76], [40, 56]], P.cloth.brown[1]);
  c.rect(47, 0, 2, 12, P.wood[2]);
  c.poly([[49, 0], [60, 3], [49, 6]], P.cloth.red[2]);
  c.rect(2, 74, 92, 3, SAND[1]);
  return c.outline();
};

// ---------------- Снежная долина ----------------
function logs(c: PC, x: number, y: number, w: number, h: number, seed: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const row = Math.floor(j / 7), k = j % 7;
    const n = hash01(Math.floor(i / 9) + row * 3, row, seed);
    let idx = k === 0 ? 4 : k < 3 ? 3 : k < 5 ? 2 : k === 5 ? 1 : 0;
    if (n < 0.2 && k > 0 && k < 5) idx = Math.max(1, idx - 1);
    c.set(x + i, y + j, LOG[idx]);
  }
}
function palisade(w: number, h: number, seed: number): PC {
  const c = new PC(w, h);
  for (let i = 0; i < w; i += 8) {
    const top = 8 + Math.floor(hash01(i, seed, 3) * 6);
    c.poly([[i, top + 8], [i + 4, top], [i + 8, top + 8], [i + 8, h], [i, h]], (x, y) => LOG[x - i < 3 ? 4 : x - i > 5 ? 1 : 3 - ((y >> 3) & 1) * 0 - (hash01(x, y >> 2, seed) < 0.18 ? 1 : 0)]);
    c.rect(i + 7, top + 8, 1, h - top - 8, LOG[0]);
    snowCap(c, i + 1, top + 5, 6, seed + i);
  }
  c.rect(0, 30, w, 3, LOG[0]);
  c.rect(0, 31, w, 1, LOG[2]);
  c.rect(0, h - 22, w, 3, LOG[0]);
  c.rect(0, h - 21, w, 1, LOG[2]);
  c.rect(0, h - 3, w, 3, SNOWC[1]);
  return c;
}
const palH: Art = () => palisade(32, 56, 4);
const palV: Art = () => palisade(32, 56, 9);
const palTower: Art = () => {
  const c = new PC(64, 136);
  const top = 40;
  logs(c, 6, top + 18, 52, 136 - top - 18, 7);
  for (const x of [4, 56]) { c.shadedRect(x, top + 12, 6, 124, LOG); }
  c.rect(4, 132, 56, 4, SNOWC[1]);
  // площадка и парапет из заострённых брёвен
  c.shadedRect(0, top + 6, 64, 12, LOG);
  for (let x = 2; x < 62; x += 8) {
    c.poly([[x, top + 6], [x + 3, top - 6], [x + 6, top + 6]], LOG[3]);
    snowCap(c, x, top - 4, 6, x);
  }
  // крыша: снежная, на столбах
  for (const x of [8, 54]) c.rect(x, 12, 3, top - 4, LOG[2]);
  c.poly([[32, 0], [62, 22], [2, 22]], (x, y) => (y < 8 || (y < 14 && Math.abs(x - 32) < 18 - (y - 8) * 0.5) ? SNOWC[3 - (x > 32 ? 1 : 0)] : x < 32 ? P.cloth.blue[2] : P.cloth.blue[1]));
  snowCap(c, 2, 22, 60, 99);
  // жаровня-огонь наверху и бойница
  c.ellipse(32, top + 2, 4, 3, FIRE[3]);
  c.ellipse(32, top, 2.5, 3.5, FIRE[4]);
  c.rect(28, top + 36, 8, 16, hex("#120e14"));
  c.rect(30, top + 40, 4, 5, withA(hex("#ffb84a"), 220));
  return c.outline();
};
const palGate: Art = () => {
  const c = new PC(96, 92);
  const face = 30;
  // створки-столбы
  for (const x of [0, 82]) {
    for (let i = 0; i < 14; i += 7) c.poly([[x + i, 14], [x + i + 3.5, 4], [x + i + 7, 14], [x + i + 7, 92], [x + i, 92]], (px) => LOG[px - x - i < 2 ? 4 : px - x - i > 5 ? 1 : 3]);
    snowCap(c, x, 12, 14, x);
  }
  // перемычка с черепом-оберегом и снегом
  c.shadedRect(8, face - 10, 80, 16, LOG);
  c.shadedRect(4, face + 4, 88, 8, LOG);
  snowCap(c, 8, face - 10, 80, 17);
  c.ellipse(48, face + 1, 5, 5, hex("#e8e4d8"));
  c.rect(46, face, 2, 2, hex("#1c1210")); c.rect(50, face, 2, 2, hex("#1c1210")); c.rect(47, face + 4, 4, 2, hex("#1c1210"));
  for (const x of [20, 70]) {
    c.rect(x, face + 12, 3, 8, P.cloth.blue[1]);
    c.poly([[x - 2, face + 12], [x + 5, face + 12], [x + 1, face + 24]], P.cloth.blue[2]);
  }
  return c.outline();
};
function logHouse(roof: Ramp): PC {
  const c = new PC(128, 128);
  logs(c, 6, 74, 116, 52, 21);
  for (const x of [4, 118]) c.shadedRect(x, 74, 6, 52, LOG);
  c.rect(6, 122, 116, 4, SNOWC[1]);
  // дверь и окна
  c.shadedRect(54, 94, 20, 32, P.wood, 2);
  c.rect(64, 96, 1, 30, P.wood[0]);
  c.ellipse(70, 112, 1, 1, P.gold[3]);
  for (const x of [20, 92]) {
    window_(c, x, 88, 14, 14, LOG);
    c.rect(x - 2, 103, 18, 3, SNOWC[2]);
  }
  // высокая крыша со снегом
  c.poly([[0, 82], [128, 82], [100, 12], [28, 12]], (x, y) => {
    const row = Math.floor((y - 12) / 7);
    const edge = (y - 12) % 7 === 6;
    const seam = (x + (row % 2 ? 4 : 0)) % 8 === 0;
    const snow = y < 24 + hash01(Math.floor(x / 4), row, 3) * 10 && row < 3;
    if (snow) return SNOWC[(y - 12) % 7 < 2 ? 3 : 2];
    return edge ? roof[0] : seam ? roof[1] : x < 40 ? roof[3] : x > 88 ? roof[1] : roof[2];
  });
  snowCap(c, 0, 82, 128, 51);
  // труба с дымом
  c.shadedRect(86, 0, 12, 24, P.stone);
  snowCap(c, 84, 2, 16, 33);
  return c.outline();
}
const brazier: Art = () => {
  const c = new PC(32, 48);
  for (const [x0, x1] of [[8, 13], [24, 19], [16, 16]]) c.line(x0, 46, x1, 28, P.darkSteel[2], 2);
  c.shadedEllipse(16, 27, 10, 4, P.darkSteel);
  c.ellipse(16, 25, 8, 3, hex("#2a1410"));
  c.ellipse(16, 24, 6, 2, FIRE[2]);
  c.poly([[10, 25], [13, 12], [16, 19], [19, 8], [22, 25]], (x, y) => (y > 18 ? FIRE[3] : FIRE[2]));
  c.poly([[13, 25], [16, 16], [19, 25]], FIRE[4]);
  return c.outline();
};

// ---------------- камень телепорта ----------------
const teleportStone: Art = () => {
  const c = new PC(48, 80);
  const ST = P.stone;
  c.shadedEllipse(24, 74, 20, 6, P.stone);
  c.ellipse(24, 73, 15, 4, hex("#2a1a4a"));
  c.ellipse(24, 73, 11, 2.5, P.magic.purple[2]);
  // стела
  c.poly([[14, 72], [34, 72], [36, 30], [30, 12], [24, 6], [18, 12], [12, 30]], (x, y) => ST[x < 20 ? 3 : x < 27 ? 2 : 1] ?? ST[2]);
  for (let y = 10; y < 70; y += 3) if (hash01(y, 7, 2) < 0.5) c.rect(14 + Math.floor(hash01(y, 3, 5) * 18), y, 2, 1, ST[4]);
  // руны
  const rune = P.magic.blue;
  for (const [x, y] of [[24, 22], [24, 28], [21, 34], [27, 34], [24, 42], [20, 48], [28, 48], [24, 56]]) c.rect(x - 1, y, 3, 2, rune[3]);
  c.rect(23, 20, 2, 40, withA(rune[2], 150));
  c.ellipse(24, 26, 3, 3, rune[4]);
  return c.outline();
};

export const CITY_ART: Record<string, Art> = {
  sand_wall_h: sandWallH, sand_wall_v: sandWallV, sand_tower: sandTower, sand_gate: sandGate,
  sand_house: () => adobe(false), sand_house_b: () => adobe(true),
  tent, stall_sand: () => stallArt(hex("#d9822c")),
  pal_h: palH, pal_v: palV, pal_tower: palTower, pal_gate: palGate,
  log_house: () => logHouse(P.roofRed), log_house_b: () => logHouse(P.roofBlue),
  brazier, teleport_stone: teleportStone,
};
