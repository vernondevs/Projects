/**
 * Пиксель-арт столиц фракций и дорог мира.
 *   Аурелион (Сольгард): светлый камень, золотые купола, знамёна с солнцем, витражи.
 *   Мортхейм (Умбрат): тёмный камень, шпили, кости и цепи, пурпурные огни душ.
 *   Дороги: указатель, мосты, руины, костёр.
 * Опорная точка — нижняя середина, размеры кратны тайлу (32 px).
 */
import { PC, hash01, hex, ramp, withA, type RGBA, type Ramp } from "./canvas";
import { P } from "./palette";
import { bricks, slabs, stallArt } from "./town";

type Art = () => PC;

const WHITE = ramp("#6e6a64", "#a8a296", "#d2ccbe", "#ece6d8", "#fffaee");
const GOLD = P.gold;
const SKY = ramp("#1c3a6a", "#2c5c9a", "#4a8ad0", "#7ec8ff");
const DARK = ramp("#100c16", "#1e1828", "#2e2640", "#40365a", "#564a74");
const PURP = P.magic.purple;
const VENOM = P.magic.green;
const BONE = P.bone;

function merlons(c: PC, x: number, y: number, w: number, bw: number, step: number, h: number, r: Ramp) {
  for (let i = 1; i + bw <= w; i += step) {
    c.shadedRect(x + i, y, bw, h, r);
    c.rect(x + i, y, bw, 2, r[4]);
  }
}
/** Шипы-зубцы для стен Мортхейма. */
function spikes(c: PC, x: number, y: number, w: number, step: number, h: number, r: Ramp) {
  for (let i = 1; i + 6 <= w; i += step) c.poly([[x + i, y + h], [x + i + 3, y], [x + i + 6, y + h]], (px) => (px < x + i + 3 ? r[3] : r[2]));
}

// ---------------- стены ----------------
function wallH(body: Ramp, dark: boolean, seed: number): PC {
  const c = new PC(32, 56);
  slabs(c, 0, 8, 32, 22, body, seed);
  if (dark) spikes(c, 0, 0, 32, 10, 10, body);
  else merlons(c, 0, 0, 32, 6, 11, 10, body);
  c.rect(0, 28, 32, 4, body[4]);
  bricks(c, 0, 32, 32, 24, body, seed + 1);
  c.rect(0, 32, 32, 1, body[1]);
  c.rect(0, 54, 32, 2, body[0]);
  if (dark) {
    // цепь вдоль кладки
    for (let x = 1; x < 32; x += 4) c.ellipse(x + 1, 40 + (x % 8 === 1 ? 0 : 1), 1.5, 1, P.darkSteel[3]);
  } else c.rect(0, 36, 32, 2, GOLD[2]);
  return c;
}
function wallV(body: Ramp, seed: number): PC {
  const c = new PC(32, 56);
  slabs(c, 0, 0, 32, 32, body, seed);
  for (const x of [0, 25]) {
    c.rect(x, 0, 7, 32, body[3]);
    c.rect(x + 1, 0, 5, 32, body[4]);
    for (let y = 2; y < 32; y += 11) c.shadedRect(x, y, 7, 6, body);
  }
  bricks(c, 0, 32, 32, 24, body, seed + 1);
  c.rect(0, 32, 32, 1, body[1]);
  c.rect(0, 54, 32, 2, body[0]);
  return c;
}

/** Знамя: полотнище на древке с эмблемой. */
function bannerCloth(c: PC, x: number, y: number, w: number, h: number, cloth: Ramp, emblem: (cx: number, cy: number) => void) {
  c.rect(x, y, w, h, cloth[1]);
  c.rect(x + 1, y, w - 2, h - 2, cloth[2]);
  c.poly([[x, y + h], [x + w, y + h], [x + w / 2, y + h + 8]], cloth[2]);
  c.rect(x, y - 2, w, 3, GOLD[2]);
  emblem(x + w / 2, y + h / 2);
}
/** Восходящее солнце над щитом. */
function sunEmblem(c: PC, cx: number, cy: number) {
  c.poly([[cx - 6, cy - 1], [cx + 6, cy - 1], [cx + 6, cy + 4], [cx, cy + 9], [cx - 6, cy + 4]], SKY[2]);
  c.ellipse(cx, cy - 2, 4.5, 4.5, GOLD[3]);
  for (let a = 0; a < 7; a++) {
    const t = Math.PI * (1 + a / 6);
    c.line(cx + Math.cos(t) * 5, cy - 2 + Math.sin(t) * 5, cx + Math.cos(t) * 8, cy - 2 + Math.sin(t) * 8, GOLD[3], 1);
  }
}
/** Чёрная корона с черепом. */
function crownEmblem(c: PC, cx: number, cy: number) {
  c.poly([[cx - 7, cy - 2], [cx - 7, cy - 9], [cx - 3, cy - 5], [cx, cy - 10], [cx + 3, cy - 5], [cx + 7, cy - 9], [cx + 7, cy - 2]], DARK[0]);
  c.rect(cx - 7, cy - 3, 14, 2, VENOM[2]);
  c.ellipse(cx, cy + 3, 4.5, 4.5, BONE[3]);
  c.rect(cx - 3, cy + 2, 2, 2, DARK[0]);
  c.rect(cx + 1, cy + 2, 2, 2, DARK[0]);
  c.rect(cx - 2, cy + 6, 4, 2, BONE[1]);
}

// ---------------- Аурелион ----------------
const solTower: Art = () => {
  const c = new PC(64, 136);
  const top = 46;
  bricks(c, 4, top + 14, 56, 136 - top - 14, WHITE, 41);
  for (let y = top + 14; y < 136; y++) { c.set(4, y, WHITE[1]); c.set(59, y, WHITE[0]); c.set(58, y, WHITE[1]); }
  c.rect(4, 132, 56, 4, WHITE[1]);
  c.shadedRect(1, top + 6, 62, 10, WHITE);
  merlons(c, 1, top - 4, 62, 8, 12, 11, WHITE);
  c.rect(1, top + 14, 62, 2, GOLD[2]);
  // золотой купол со шпилем
  for (let y = 6; y < top - 4; y++) for (let x = 8; x < 57; x++) {
    const k = ((x - 32) / 24) ** 2 + ((y - (top - 4)) / (top - 10)) ** 2;
    if (k < 1) c.set(x, y, (x - 32) / 24 + (y - top) / (top - 10) < -0.6 ? GOLD[4] : x < 30 ? GOLD[3] : x > 44 ? GOLD[1] : GOLD[2]);
  }
  c.rect(31, 0, 2, 10, GOLD[3]);
  c.ellipse(32, 2, 2.5, 2.5, GOLD[4]);
  // витраж
  c.rect(26, top + 24, 12, 18, WHITE[0]);
  c.ellipse(32, top + 24, 6, 5, WHITE[0]);
  c.rect(27, top + 25, 10, 16, SKY[2]);
  c.ellipse(32, top + 25, 5, 4, GOLD[3]);
  c.rect(31, top + 25, 2, 16, WHITE[1]);
  bannerCloth(c, 22, top + 50, 20, 26, P.cloth.white, (x, y) => sunEmblem(c, x, y));
  return c.outline();
};
function archGate(body: Ramp, dark: boolean, seed: number): PC {
  const c = new PC(96, 92);
  const face = 34;
  slabs(c, 0, 10, 96, face - 10, body, seed);
  if (dark) spikes(c, 0, 0, 96, 9, 12, body);
  else merlons(c, 0, 0, 96, 8, 12, 12, body);
  bricks(c, 0, face, 96, 58, body, seed + 1);
  const ox = 48, oy = 62, rx = 38;
  for (let y = face + 6; y < 92; y++) for (let x = 0; x < 96; x++) {
    const inside = y >= oy ? Math.abs(x + 0.5 - ox) < rx : ((x + 0.5 - ox) / rx) ** 2 + ((y + 0.5 - oy) / (oy - face - 6)) ** 2 < 1;
    if (inside) c.clear(x, y);
  }
  for (let a = 0; a <= 60; a++) {
    const t = Math.PI * (a / 60);
    const x = ox - Math.cos(t) * (rx + 1.5), y = oy - Math.sin(t) * (oy - face - 6 + 1.5);
    c.set(x, y, dark ? PURP[2] : GOLD[3]);
    c.set(x, y + 1, body[3]);
  }
  bannerCloth(c, 36, 10, 24, 18, dark ? P.cloth.purple : P.cloth.white, (x, y) => (dark ? crownEmblem(c, x, y) : sunEmblem(c, x, y)));
  c.shadedRect(0, face, 10, 58, body);
  c.shadedRect(86, face, 10, 58, body);
  if (dark) for (const x of [5, 91]) { c.ellipse(x, face + 8, 3, 3, BONE[3]); c.rect(x - 1, face + 8, 1, 1, DARK[0]); c.rect(x + 1, face + 8, 1, 1, DARK[0]); }
  return c.outline();
}
/** Дом из светлого камня с синей крышей; храм — с золотым куполом и витражом. */
function solHouse(temple: boolean): PC {
  const c = new PC(128, 128);
  c.shadedRect(6, 66, 116, 60, WHITE);
  bricks(c, 6, 66, 116, 60, WHITE, temple ? 51 : 52);
  c.rect(6, 122, 116, 4, WHITE[0]);
  c.rect(6, 66, 116, 3, GOLD[2]);
  if (temple) {
    c.shadedRect(0, 54, 128, 14, WHITE);
    for (let y = 4; y < 56; y++) for (let x = 30; x < 99; x++) {
      const k = ((x - 64) / 34) ** 2 + ((y - 56) / 50) ** 2;
      if (k < 1) c.set(x, y, (x - 64) / 34 + (y - 56) / 50 < -0.7 ? GOLD[4] : x < 56 ? GOLD[3] : x > 80 ? GOLD[1] : GOLD[2]);
    }
    c.rect(63, 0, 2, 8, GOLD[4]);
    // большой витраж-роза
    c.ellipse(64, 86, 12, 12, WHITE[0]);
    c.ellipse(64, 86, 10, 10, SKY[2]);
    for (let a = 0; a < 8; a++) c.line(64, 86, 64 + Math.cos((a * Math.PI) / 4) * 10, 86 + Math.sin((a * Math.PI) / 4) * 10, GOLD[2], 1);
    c.ellipse(64, 86, 3, 3, GOLD[4]);
    c.rect(56, 102, 16, 24, hex("#2a1a10"));
    c.ellipse(64, 102, 8, 6, hex("#2a1a10"));
    c.rect(58, 104, 12, 22, P.wood[2]);
    c.rect(64, 104, 1, 22, P.wood[0]);
    for (const x of [14, 100]) { c.rect(x, 74, 3, 48, WHITE[4]); c.rect(x + 11, 74, 3, 48, WHITE[4]); }
  } else {
    c.poly([[0, 70], [128, 70], [110, 16], [18, 16]], (x, y) => {
      const row = Math.floor((y - 16) / 7), edge = (y - 16) % 7 === 6, seam = (x + (row % 2 ? 4 : 0)) % 8 === 0;
      return edge ? SKY[0] : seam ? SKY[1] : x < 32 ? SKY[3] : x > 96 ? SKY[1] : SKY[2];
    });
    c.rect(18, 14, 92, 3, GOLD[3]);
    c.shadedRect(56, 94, 18, 32, P.wood, 2);
    c.ellipse(70, 110, 1, 1, GOLD[3]);
    for (const x of [18, 94]) {
      c.rect(x - 1, 80, 16, 18, WHITE[0]);
      c.rect(x, 81, 14, 16, SKY[2]);
      c.rect(x, 81, 14, 5, GOLD[3]);
      c.rect(x + 6, 81, 1, 16, WHITE[1]);
    }
    bannerCloth(c, 40, 72, 10, 16, P.cloth.white, (x, y) => c.ellipse(x, y - 1, 3, 3, GOLD[3]));
  }
  return c.outline();
}
const sunBanner: Art = () => {
  const c = new PC(32, 96);
  c.rect(15, 6, 3, 88, P.wood[2]);
  c.rect(15, 6, 1, 88, P.wood[3]);
  c.ellipse(16, 5, 3, 3, GOLD[3]);
  c.rect(6, 10, 21, 2, GOLD[2]);
  bannerCloth(c, 7, 12, 18, 40, P.cloth.white, (x, y) => sunEmblem(c, x, y));
  c.shadedEllipse(16, 92, 8, 3, WHITE);
  return c.outline();
};
const sunStatue: Art = () => {
  const c = new PC(32, 96);
  c.shadedRect(4, 72, 24, 22, WHITE);
  c.rect(4, 72, 24, 2, GOLD[2]);
  // фигура короля с поднятым мечом
  c.shadedRect(11, 40, 10, 32, WHITE);
  c.shadedEllipse(16, 34, 5, 6, WHITE);
  c.poly([[11, 28], [13, 24], [16, 27], [19, 24], [21, 28]], GOLD[3]);
  c.line(21, 44, 27, 10, WHITE[4], 2);
  c.rect(19, 44, 6, 2, GOLD[2]);
  c.poly([[9, 48], [13, 44], [13, 70], [8, 70]], WHITE[2]);
  for (let a = 0; a < 6; a++) c.set(27 + Math.round(Math.cos(a) * 3), 8 + Math.round(Math.sin(a) * 3), GOLD[4]);
  return c.outline();
};

// ---------------- Мортхейм ----------------
const umbTower: Art = () => {
  const c = new PC(64, 136);
  const top = 56;
  bricks(c, 6, top + 10, 52, 136 - top - 10, DARK, 61);
  for (let y = top + 10; y < 136; y++) { c.set(6, y, DARK[3]); c.set(57, y, DARK[0]); }
  c.rect(6, 132, 52, 4, DARK[0]);
  c.shadedRect(2, top + 2, 60, 10, DARK);
  spikes(c, 2, top - 8, 60, 8, 10, DARK);
  // высокий шпиль
  c.poly([[32, 0], [46, top - 6], [18, top - 6]], (x, y) => ((y >> 2) % 3 === 0 ? DARK[1] : x < 32 ? DARK[3] : DARK[2]));
  c.poly([[32, 0], [36, 14], [28, 14]], PURP[2]);
  for (const x of [14, 50]) c.poly([[x, top - 22], [x + 4, top - 6], [x - 4, top - 6]], DARK[2]);
  // горящее окно души и череп
  c.rect(28, top + 14, 8, 12, hex("#0a0410"));
  c.rect(29, top + 17, 6, 6, withA(PURP[3], 230));
  c.ellipse(32, top + 34, 6, 6, BONE[3]);
  c.rect(29, top + 33, 2, 2, DARK[0]);
  c.rect(33, top + 33, 2, 2, DARK[0]);
  bannerCloth(c, 22, top + 46, 20, 24, P.cloth.purple, (x, y) => crownEmblem(c, x, y));
  return c.outline();
};
/** Дом из тёмного камня с острой крышей; крипта — с костями и зелёным огнём над входом. */
function umbHouse(crypt: boolean): PC {
  const c = new PC(128, 128);
  c.shadedRect(6, 70, 116, 56, DARK);
  bricks(c, 6, 70, 116, 56, DARK, crypt ? 71 : 72);
  c.rect(6, 122, 116, 4, DARK[0]);
  if (crypt) {
    c.shadedRect(0, 58, 128, 14, DARK);
    c.poly([[20, 60], [64, 6], [108, 60]], (x, y) => ((y >> 3) % 2 ? DARK[1] : x < 64 ? DARK[3] : DARK[2]));
    c.ellipse(64, 40, 7, 7, BONE[3]);
    c.rect(60, 39, 3, 3, DARK[0]);
    c.rect(65, 39, 3, 3, DARK[0]);
    for (const x of [10, 30, 98, 118]) for (let k = 0; k < 4; k++) c.ellipse(x, 76 + k * 12, 3, 2.5, BONE[2 + (k % 2)]);
    c.rect(52, 96, 24, 30, hex("#06030a"));
    c.ellipse(64, 96, 12, 8, hex("#06030a"));
    c.ellipse(64, 90, 4, 5, VENOM[2]);
    c.ellipse(64, 89, 2, 3, VENOM[3]);
  } else {
    c.poly([[0, 74], [128, 74], [96, 10], [32, 10]], (x, y) => {
      const row = Math.floor((y - 10) / 6), edge = (y - 10) % 6 === 5, seam = (x + (row % 2 ? 3 : 0)) % 7 === 0;
      return edge ? P.cloth.purple[0] : seam ? P.cloth.purple[1] : x < 40 ? P.cloth.purple[3] : x > 88 ? P.cloth.purple[1] : P.cloth.purple[2];
    });
    for (const x of [24, 104]) c.poly([[x, 0], [x + 5, 30], [x - 5, 30]], DARK[2]);
    c.shadedRect(56, 96, 18, 30, P.cloth.black, 2);
    for (const x of [18, 94]) {
      c.rect(x - 1, 84, 16, 16, DARK[0]);
      c.rect(x + 1, 86, 12, 12, withA(PURP[2], 230));
      c.rect(x + 6, 86, 1, 12, DARK[0]);
    }
    // цепь над дверью
    for (let x = 50; x < 80; x += 4) c.ellipse(x, 92 + Math.round(Math.sin((x - 50) / 9) * 2), 1.6, 1.1, P.darkSteel[3]);
  }
  return c.outline();
}
const soulBrazier: Art = () => {
  const c = new PC(32, 48);
  for (const [x0, x1] of [[8, 13], [24, 19], [16, 16]]) c.line(x0, 46, x1, 28, DARK[3], 2);
  c.shadedEllipse(16, 27, 10, 4, DARK);
  c.ellipse(16, 25, 8, 3, hex("#0a0410"));
  c.poly([[10, 25], [13, 12], [16, 19], [19, 6], [22, 25]], (x, y) => (y > 18 ? PURP[2] : PURP[3]));
  c.poly([[13, 25], [16, 15], [19, 25]], PURP[4]);
  c.ellipse(16, 46, 3, 2, BONE[2]);
  return c.outline();
};
const crownBanner: Art = () => {
  const c = new PC(32, 96);
  c.rect(15, 6, 3, 88, DARK[2]);
  c.poly([[13, 6], [16, 0], [19, 6]], BONE[3]);
  c.rect(6, 10, 21, 2, P.darkSteel[3]);
  bannerCloth(c, 7, 12, 18, 40, P.cloth.purple, (x, y) => crownEmblem(c, x, y));
  c.shadedEllipse(16, 92, 8, 3, DARK);
  for (let k = 0; k < 3; k++) c.ellipse(10 + k * 6, 90, 2.5, 2, BONE[2 + (k % 2)]);
  return c.outline();
};
const bonePile: Art = () => {
  const c = new PC(32, 32);
  c.shadedEllipse(16, 26, 13, 5, DARK);
  for (const [x, y, a] of [[8, 22, 0.4], [22, 23, -0.5], [15, 18, 0.1], [11, 26, -0.2], [21, 27, 0.6]]) c.line(x - Math.cos(a) * 6, y - Math.sin(a) * 6, x + Math.cos(a) * 6, y + Math.sin(a) * 6, BONE[2], 2);
  c.ellipse(16, 14, 5, 5, BONE[3]);
  c.rect(13, 13, 2, 2, DARK[0]);
  c.rect(17, 13, 2, 2, DARK[0]);
  c.rect(14, 17, 4, 2, BONE[1]);
  return c.outline();
};
const darkObelisk: Art = () => {
  const c = new PC(32, 96);
  c.shadedRect(4, 84, 24, 10, DARK);
  c.poly([[9, 84], [23, 84], [20, 14], [16, 4], [12, 14]], (x) => (x < 14 ? DARK[3] : x < 18 ? DARK[2] : DARK[1]));
  for (const y of [24, 36, 48, 60, 72]) c.rect(15, y, 2, 4, withA(PURP[3], 240));
  c.ellipse(16, 16, 2.5, 2.5, VENOM[3]);
  return c.outline();
};

// ---------------- дороги и поселения ----------------
const signpost: Art = () => {
  const c = new PC(32, 64);
  c.shadedRect(14, 10, 4, 52, P.wood);
  c.poly([[2, 14], [26, 14], [31, 19], [26, 24], [2, 24]], P.wood[3]);
  c.rect(2, 23, 24, 1, P.wood[1]);
  c.poly([[30, 30], [6, 30], [1, 35], [6, 40], [30, 40]], P.wood[2]);
  c.rect(6, 39, 24, 1, P.wood[0]);
  for (const [x, y] of [[8, 18], [14, 18], [20, 18], [10, 34], [16, 34], [22, 34]]) c.rect(x, y, 3, 1, P.wood[0]);
  c.ellipse(16, 62, 6, 2, P.stone[1]);
  return c.outline();
};
function bridge(horizontal: boolean): PC {
  const W = horizontal ? 192 : 96, H = horizontal ? 96 : 192;
  const c = new PC(W, H);
  const along = horizontal ? W : H, across = horizontal ? H : W;
  for (let a = 0; a < along; a++) for (let b = 8; b < across - 8; b++) {
    const plank = Math.floor(a / 8), seam = a % 8 === 7;
    const n = hash01(plank, Math.floor(b / 24), 9);
    const col: RGBA = seam ? P.wood[0] : n < 0.3 ? P.wood[1] : n < 0.8 ? P.wood[2] : P.wood[3];
    if (horizontal) c.set(a, b, col);
    else c.set(b, a, col);
  }
  // перила и столбики
  for (const b of [6, across - 10]) for (let a = 0; a < along; a++) {
    if (horizontal) { c.rect(a, b, 1, 4, P.wood[3]); c.set(a, b + 4, P.wood[0]); }
    else { c.rect(b, a, 4, 1, P.wood[3]); c.set(b + 4, a, P.wood[0]); }
  }
  for (let a = 4; a < along; a += 32) for (const b of [4, across - 12]) {
    if (horizontal) c.shadedRect(a, b, 6, 8, P.wood);
    else c.shadedRect(b, a, 8, 6, P.wood);
  }
  return c.outline();
}
const ruinPillar: Art = () => {
  const c = new PC(32, 64);
  const h = 30 + Math.floor(hash01(3, 4, 5) * 10);
  c.shadedRect(9, 64 - h - 4, 14, h, WHITE);
  for (let y = 64 - h; y < 60; y += 9) c.rect(9, y, 14, 1, WHITE[0]);
  c.poly([[9, 64 - h - 4], [14, 64 - h - 9], [18, 64 - h - 3], [23, 64 - h - 6], [23, 64 - h - 2], [9, 64 - h]], WHITE[3]);
  c.shadedRect(6, 58, 20, 6, WHITE);
  for (let i = 0; i < 6; i++) c.set(10 + i * 2, 64 - h + 6 + i * 4, P.moss[1 + (i % 2)]);
  return c.outline();
};
const ruinWall: Art = () => {
  const c = new PC(64, 48);
  bricks(c, 0, 18, 64, 30, WHITE, 81);
  for (let x = 0; x < 64; x++) {
    const top = 18 + Math.floor(hash01(Math.floor(x / 6), 2, 83) * 14);
    for (let y = 18; y < top; y++) c.clear(x, y);
  }
  for (let i = 0; i < 9; i++) c.set(4 + i * 7, 44, P.moss[2]);
  c.rect(0, 46, 64, 2, WHITE[0]);
  return c.outline();
};
const campfire: Art = () => {
  const c = new PC(32, 32);
  for (let a = 0; a < 8; a++) c.shadedEllipse(16 + Math.round(Math.cos(a * 0.785) * 11), 26 + Math.round(Math.sin(a * 0.785) * 4), 3, 2.5, P.stone);
  c.line(8, 27, 24, 23, P.wood[1], 3);
  c.line(8, 23, 24, 27, P.wood[2], 3);
  c.poly([[10, 25], [13, 12], [16, 18], [19, 6], [22, 25]], (x, y) => (y > 17 ? P.magic.fire[2] : P.magic.fire[3]));
  c.poly([[13, 25], [16, 15], [19, 25]], P.magic.fire[4]);
  return c.outline();
};

export const FACTION_ART: Record<string, Art> = {
  sol_wall_h: () => wallH(WHITE, false, 41), sol_wall_v: () => wallV(WHITE, 43), sol_tower: solTower, sol_gate: () => archGate(WHITE, false, 45),
  sol_house: () => solHouse(false), sol_temple: () => solHouse(true), stall_gold: () => stallArt(hex("#e8b84a")),
  sun_banner: sunBanner, sun_statue: sunStatue,
  umb_wall_h: () => wallH(DARK, true, 61), umb_wall_v: () => wallV(DARK, 63), umb_tower: umbTower, umb_gate: () => archGate(DARK, true, 65),
  umb_house: () => umbHouse(false), umb_crypt: () => umbHouse(true), stall_purple: () => stallArt(hex("#7a3ab0")),
  soul_brazier: soulBrazier, crown_banner: crownBanner, bone_pile: bonePile, dark_obelisk: darkObelisk,
  signpost, bridge_h: () => bridge(true), bridge_v: () => bridge(false), ruin_pillar: ruinPillar, ruin_wall: ruinWall, campfire,
};
