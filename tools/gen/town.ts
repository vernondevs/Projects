/** Пиксель-арт Эмберхолла: стены, башни, ворота, таверна, банк, кузница, врата арены, рыночная мелочь. Опора — нижняя середина. */
import { PC, hash01, hex, mix, ramp, shade, withA, type RGBA, type Ramp } from "./canvas";
import { P } from "./palette";

type Art = () => PC;

/** Тёплый городской камень и цвета Эмберхолла (багрянец и золото). */
const ST = ramp("#2e2a30", "#4a4446", "#6a625e", "#8a8178", "#aca294", "#cbc2b2");
const ROOF_SLATE = ramp("#1e2230", "#2c3246", "#3c4560", "#52607e", "#6c7c9c");
const ROOF_BROWN = ramp("#3a1e14", "#5a2e1e", "#7c4228", "#9c5a36", "#bc7a4c");
const MARBLE = ramp("#6a6670", "#8e8a94", "#b4b0b8", "#d4d0d6", "#eeeaf0");
const RED = P.cloth.red;
const GOLD = P.gold;

/** Кирпичная кладка: ряды по 6 px, кирпичи по 12 px со сдвигом, лёгкий шум. */
export function bricks(c: PC, x: number, y: number, w: number, h: number, r: Ramp = ST, seed = 1) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = x + i, py = y + j;
    const row = Math.floor(j / 6);
    const off = row % 2 ? 6 : 0;
    const mortarY = j % 6 === 5, mortarX = (i + off) % 12 === 11;
    const n = hash01(Math.floor((i + off) / 12), row, seed);
    let idx = n < 0.3 ? 2 : n < 0.8 ? 3 : 4;
    if (j % 6 === 0) idx = Math.min(r.length - 1, idx + 1);
    if (mortarY || mortarX) idx = 1;
    c.set(px, py, r[idx]);
  }
}
/** Камни мостовой/плиты дорожки по стене. */
export function slabs(c: PC, x: number, y: number, w: number, h: number, r: Ramp = ST, seed = 3) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const row = Math.floor(j / 8), off = row % 2 ? 5 : 0;
    const seam = j % 8 === 7 || (i + off) % 10 === 9;
    const n = hash01(Math.floor((x + i + off) / 10), Math.floor((y + j) / 8), seed);
    c.set(x + i, y + j, seam ? r[2] : r[n < 0.5 ? 3 : 4]);
  }
}
/** Зубцы: блоки шириной bw с шагом step по горизонтали. */
function merlonsH(c: PC, x: number, y: number, w: number, bw = 6, step = 11, h = 8) {
  for (let i = 1; i + bw <= w; i += step) {
    c.shadedRect(x + i, y, bw, h, ST);
    c.rect(x + i, y, bw, 2, ST[5]);
  }
}
function moss(c: PC, x: number, y: number, w: number, seed: number) {
  for (let i = 0; i < w; i++) if (hash01(i, seed, 77) < 0.35) c.set(x + i, y - (hash01(i, seed, 78) < 0.4 ? 1 : 0), P.moss[1 + (i % 2)]);
}

// ---------------- стены ----------------
/** Горизонтальный пролёт: сверху дорожка с зубцами, снизу лицевая кладка (24 px). */
const wallH: Art = () => {
  const c = new PC(32, 56);
  slabs(c, 0, 8, 32, 22);
  merlonsH(c, 0, 0, 32, 6, 11, 10);
  c.rect(0, 28, 32, 4, ST[5]);
  bricks(c, 0, 32, 32, 24, ST, 5);
  c.rect(0, 32, 32, 1, ST[1]);
  c.rect(0, 54, 32, 2, ST[1]);
  moss(c, 0, 54, 32, 4);
  return c;
};
/** Вертикальный пролёт: дорожка между парапетами слева и справа; кладка видна только у нижнего конца. */
const wallV: Art = () => {
  const c = new PC(32, 56);
  slabs(c, 0, 0, 32, 32, ST, 9);
  for (const x of [0, 25]) {
    c.rect(x, 0, 7, 32, ST[3]);
    c.rect(x + 1, 0, 5, 32, ST[4]);
    for (let y = 2; y < 32; y += 11) c.shadedRect(x, y, 7, 6, ST);
  }
  bricks(c, 0, 32, 32, 24, ST, 6);
  c.rect(0, 32, 32, 1, ST[1]);
  c.rect(0, 54, 32, 2, ST[1]);
  return c;
};
/** Квадратная башня с бойницами, знаменем и красной конической крышей с флажком. */
const tower: Art = () => {
  const c = new PC(64, 136);
  const top = 50; // верх кладки
  // кладка
  bricks(c, 4, top + 14, 56, 136 - top - 14, ST, 11);
  for (let y = top + 14; y < 136; y++) { c.set(4, y, ST[1]); c.set(59, y, ST[0]); c.set(58, y, ST[1]); }
  c.rect(4, 132, 56, 4, ST[1]);
  // свес с зубцами
  c.shadedRect(1, top + 6, 62, 10, ST);
  merlonsH(c, 1, top - 4, 62, 8, 12, 11);
  // бойница и окно
  c.rect(30, top + 26, 4, 14, hex("#120e14"));
  c.rect(31, top + 27, 2, 4, withA(hex("#ffb84a"), 200));
  // знамя Эмберхолла
  c.rect(20, top + 46, 24, 30, RED[1]);
  c.rect(21, top + 46, 22, 28, RED[2]);
  c.poly([[20, top + 76], [44, top + 76], [32, top + 84]], RED[2]);
  c.rect(20, top + 44, 24, 3, GOLD[2]);
  c.ellipse(32, top + 60, 6, 6, GOLD[2]);
  c.ellipse(32, top + 59, 3.5, 4.5, GOLD[3]);
  c.poly([[32, top + 52], [35, top + 60], [32, top + 66], [29, top + 60]], P.magic.fire[3]);
  c.set(32, top + 58, P.magic.fire[4]);
  // крыша
  c.poly([[32, 6], [62, top - 2], [2, top - 2]], (x, y) => {
    const row = Math.floor((y - 6) / 5);
    const seam = (x + (row % 2 ? 3 : 0)) % 6 === 0;
    const k = x < 32 ? 3 : 2;
    return (y - 6) % 5 === 4 ? RED[0] : seam ? RED[1] : RED[k];
  });
  c.rect(2, top - 3, 60, 2, RED[0]);
  // флажок
  c.line(32, 0, 32, 8, P.darkSteel[3], 1);
  c.poly([[33, 0], [42, 2], [33, 5]], GOLD[3]);
  return c.outline();
};
/** Надвратная арка (3 тайла): зубцы и кладка над проёмом, поднятая решётка; сквозь проём виден проходящий. */
const gateArch: Art = () => {
  const c = new PC(96, 92);
  const face = 34;
  slabs(c, 0, 10, 96, face - 10, ST, 13);
  merlonsH(c, 0, 0, 96, 8, 12, 12);
  bricks(c, 0, face, 96, 58, ST, 14);
  // проём: полукруглая арка
  const ox = 48, oy = 62, rx = 38;
  for (let y = face + 6; y < 92; y++) for (let x = 0; x < 96; x++) {
    const inside = y >= oy ? Math.abs(x + 0.5 - ox) < rx : ((x + 0.5 - ox) / rx) ** 2 + ((y + 0.5 - oy) / (oy - face - 6)) ** 2 < 1;
    if (inside) c.clear(x, y);
  }
  // замковый камень и обрамление
  for (let a = 0; a <= 60; a++) {
    const t = Math.PI * (a / 60);
    const x = ox - Math.cos(t) * (rx + 1.5), y = oy - Math.sin(t) * (oy - face - 6 + 1.5);
    c.set(x, y, ST[5]);
    c.set(x, y + 1, ST[4]);
  }
  c.shadedRect(43, face + 2, 10, 9, MARBLE);
  // герб над воротами
  c.ellipse(48, 22, 7, 7, GOLD[1]);
  c.ellipse(48, 21.5, 5.5, 5.5, RED[2]);
  c.poly([[48, 16], [51, 22], [48, 27], [45, 22]], P.magic.fire[3]);
  // решётка поднята: только нижние зубья
  for (let x = ox - rx + 4; x < ox + rx - 2; x += 6) {
    const yTop = oy - Math.sqrt(Math.max(0, 1 - ((x - ox) / rx) ** 2)) * (oy - face - 6);
    c.line(x, yTop + 1, x, yTop + 8, P.darkSteel[2], 2);
    c.set(x, yTop + 9, P.darkSteel[3]);
  }
  c.line(ox - rx + 2, oy - 18, ox + rx - 2, oy - 18, withA(P.darkSteel[1], 0), 1);
  // боковые пилоны
  c.shadedRect(0, face, 10, 58, ST);
  c.shadedRect(86, face, 10, 58, ST);
  return c.outline();
};

// ---------------- здания ----------------
function windowLit(c: PC, x: number, y: number, w: number, h: number, frame: Ramp = P.timber, shutters?: RGBA) {
  c.rect(x - 1, y - 1, w + 2, h + 2, frame[0]);
  c.rect(x, y, w, h, P.glass[1]);
  c.rect(x, y, w, Math.ceil(h / 3), P.glass[2]);
  c.rect(x + Math.floor(w / 2), y, 1, h, frame[0]);
  c.rect(x, y + Math.floor(h / 2), w, 1, frame[0]);
  if (shutters) { c.rect(x - 5, y - 1, 4, h + 2, shutters); c.rect(x + w + 1, y - 1, 4, h + 2, shutters); }
}
function door(c: PC, x: number, y: number, w: number, h: number, double = false) {
  c.rect(x - 2, y - 3, w + 4, h + 3, ST[2]);
  c.shadedRect(x, y, w, h, P.wood, 2);
  for (let i = 3; i < w; i += 4) c.rect(x + i, y + 2, 1, h - 2, P.wood[1]);
  if (double) c.rect(x + Math.floor(w / 2), y, 1, h, P.wood[0]);
  c.rect(x, y + 6, w, 2, P.darkSteel[2]);
  c.rect(x, y + h - 9, w, 2, P.darkSteel[2]);
  c.ellipse(double ? x + w / 2 - 3 : x + w - 4, y + h / 2, 1.2, 1.2, GOLD[3]);
  if (double) c.ellipse(x + w / 2 + 3, y + h / 2, 1.2, 1.2, GOLD[3]);
}
function tiledRoof(c: PC, pts: [number, number][], r: Ramp, y0: number, rowH = 7, seamW = 8) {
  c.poly(pts, (x, y) => {
    const row = Math.floor((y - y0) / rowH);
    const shift = row % 2 ? seamW / 2 : 0;
    if ((y - y0) % rowH === rowH - 1) return r[0];
    if ((x + shift) % seamW === 0) return r[1];
    return (y - y0) % rowH < 2 ? r[3] : r[2];
  });
}

/** Таверна «Пьяный уголёк»: два этажа, фахверк, большая крыша с мансардами, вывеска с кружкой. */
const tavern: Art = () => {
  const c = new PC(224, 184);
  const base = 184;
  // крыша
  tiledRoof(c, [[0, 92], [224, 92], [204, 22], [20, 22]], ROOF_BROWN, 22);
  c.rect(20, 18, 184, 5, ROOF_BROWN[4]);
  c.rect(0, 90, 224, 4, ROOF_BROWN[0]);
  // мансарды
  for (const mx of [56, 152]) {
    c.poly([[mx - 16, 70], [mx + 16, 70], [mx, 48]], ROOF_BROWN[3]);
    c.shadedRect(mx - 12, 64, 24, 20, P.plaster);
    windowLit(c, mx - 6, 68, 12, 10);
    c.poly([[mx - 18, 66], [mx + 18, 66], [mx, 44]], (x) => (x < mx ? ROOF_BROWN[3] : ROOF_BROWN[2]));
  }
  // трубы
  c.shadedRect(176, 0, 14, 30, ST);
  c.rect(174, 0, 18, 3, ST[4]);
  c.shadedRect(30, 6, 12, 22, ST);
  // второй этаж: штукатурка и балки
  c.shadedRect(6, 94, 212, 40, P.plaster);
  for (const x of [6, 50, 94, 128, 172, 214]) c.rect(x, 94, 4, 40, P.timber[1]);
  c.rect(6, 94, 212, 3, P.timber[2]);
  c.rect(6, 131, 212, 4, P.timber[1]);
  for (const x of [22, 64, 142, 186]) windowLit(c, x, 104, 16, 16, P.timber, RED[1]);
  // первый этаж: камень
  bricks(c, 6, 135, 212, 47, ST, 21);
  c.rect(6, 180, 212, 4, ST[1]);
  for (const x of [18, 50, 150, 182]) windowLit(c, x, 146, 22, 18, P.timber);
  // дверь (клетка 3: x 96..128) и фонарь
  door(c, 101, 148, 22, 36, true);
  c.poly([[96, 146], [128, 146], [112, 138]], ROOF_BROWN[2]);
  c.rect(130, 144, 2, 8, P.darkSteel[2]);
  c.rect(128, 150, 6, 7, P.glass[1]);
  // вывеска с кружкой на кронштейне
  c.rect(78, 140, 18, 2, P.darkSteel[2]);
  c.line(80, 142, 80, 146, P.darkSteel[3], 1);
  c.line(92, 142, 92, 146, P.darkSteel[3], 1);
  c.shadedRect(74, 146, 24, 18, P.wood, 2);
  c.rect(76, 148, 20, 14, P.wood[1]);
  c.shadedRect(81, 151, 8, 9, GOLD);
  c.rect(89, 153, 3, 5, GOLD[2]);
  c.rect(81, 150, 8, 2, hex("#f8f4e8"));
  // скамьи у входа
  for (const bx of [16, 178]) { c.shadedRect(bx, 176, 28, 5, P.wood); c.rect(bx + 2, 181, 2, 3, P.wood[0]); c.rect(bx + 24, 181, 2, 3, P.wood[0]); }
  void base;
  return c.outline();
};

/** Банк: мраморный фасад с колоннами, фронтон с золотой монетой, двойные двери (клетки 2–3). */
const bank: Art = () => {
  const c = new PC(192, 168);
  // крыша (шифер) за фронтоном
  tiledRoof(c, [[4, 70], [188, 70], [176, 18], [16, 18]], ROOF_SLATE, 18, 6, 6);
  // фасад
  c.shadedRect(8, 70, 176, 94, MARBLE);
  for (let y = 78; y < 160; y += 10) c.rect(8, y, 176, 1, MARBLE[1]);
  // фронтон
  c.poly([[0, 74], [192, 74], [96, 30]], (x, y) => (y > 70 ? MARBLE[1] : x < 96 ? MARBLE[3] : MARBLE[2]));
  c.poly([[22, 68], [170, 68], [96, 38]], MARBLE[2]);
  c.ellipse(96, 56, 10, 9, GOLD[1]);
  c.ellipse(96, 55.5, 8, 7.5, GOLD[3]);
  c.ellipse(96, 55, 5, 4.5, GOLD[2]);
  c.rect(95, 51, 2, 8, GOLD[4]);
  c.rect(0, 72, 192, 5, MARBLE[4]);
  c.rect(0, 77, 192, 2, MARBLE[0]);
  // колонны
  for (const x of [14, 46, 132, 164]) {
    c.shadedRect(x, 80, 14, 76, MARBLE);
    for (let i = 3; i < 12; i += 4) c.rect(x + i, 84, 1, 70, MARBLE[1]);
    c.shadedRect(x - 3, 78, 20, 6, MARBLE);
    c.shadedRect(x - 3, 152, 20, 6, MARBLE);
  }
  // окна с решётками
  for (const x of [30, 150]) {
    c.rect(x - 1, 96, 14, 26, MARBLE[0]);
    c.rect(x, 97, 12, 24, P.glass[1]);
    for (let i = 2; i < 12; i += 3) c.rect(x + i, 97, 1, 24, P.darkSteel[2]);
  }
  // двери и золотая надпись-табличка
  c.shadedRect(66, 84, 60, 10, GOLD);
  for (let i = 0; i < 6; i++) c.rect(72 + i * 9, 87, 5, 4, GOLD[0]);
  door(c, 76, 112, 40, 44, true);
  c.poly([[72, 112], [120, 112], [96, 98]], MARBLE[3]);
  // ступени
  c.shadedRect(56, 156, 80, 5, MARBLE);
  c.shadedRect(50, 161, 92, 7, MARBLE);
  return c.outline();
};

/** Кузница: каменный низ, тёмные балки, открытый горн со светом, большая труба. */
const forge: Art = () => {
  const c = new PC(160, 140);
  // крыша
  tiledRoof(c, [[0, 66], [160, 66], [146, 14], [14, 14]], ROOF_SLATE, 14, 6, 6);
  c.rect(0, 64, 160, 4, ROOF_SLATE[0]);
  // труба с жаром
  c.shadedRect(118, 0, 22, 40, ST);
  c.rect(116, 0, 26, 4, ST[4]);
  c.rect(122, 1, 14, 2, P.magic.fire[3]);
  // стены
  c.shadedRect(6, 68, 148, 30, P.cloth.brown);
  for (const x of [6, 54, 102, 150]) c.rect(x, 68, 4, 30, P.timber[0]);
  bricks(c, 6, 98, 148, 40, ST, 31);
  c.rect(6, 136, 148, 4, ST[1]);
  // открытый горн слева
  c.rect(14, 102, 36, 32, hex("#1a1012"));
  c.shadedRect(16, 118, 32, 16, ST);
  c.ellipse(32, 117, 12, 5, P.magic.fire[1]);
  c.ellipse(32, 116, 9, 3.5, P.magic.fire[3]);
  c.ellipse(32, 115, 5, 2, P.magic.fire[4]);
  for (const [x, y] of [[26, 108], [34, 106], [38, 110]]) c.set(x, y, P.magic.fire[4]);
  c.rect(12, 100, 40, 3, P.timber[1]);
  // дверь (клетка 2: x 64..96)
  door(c, 70, 104, 20, 34);
  // окно и вывеска-наковальня
  windowLit(c, 114, 74, 14, 12, P.timber);
  windowLit(c, 112, 108, 16, 14, P.timber);
  c.shadedRect(58, 74, 44, 18, P.wood, 2);
  c.rect(66, 80, 26, 4, P.darkSteel[3]);
  c.rect(70, 84, 18, 3, P.darkSteel[2]);
  c.rect(76, 87, 6, 3, P.darkSteel[2]);
  c.rect(92, 80, 4, 3, P.darkSteel[3]);
  // инструменты на стене
  c.line(136, 102, 136, 124, P.wood[2], 2);
  c.rect(132, 100, 9, 4, P.darkSteel[3]);
  c.line(144, 104, 144, 126, P.wood[2], 1);
  c.rect(142, 102, 5, 3, P.steel[3]);
  return c.outline();
};

/** Врата арены: каменная арка с опущенной решёткой, алые знамёна со скрещёнными мечами, факелы. */
const arenaGate: Art = () => {
  const c = new PC(128, 132);
  bricks(c, 6, 30, 116, 100, ST, 41);
  c.rect(6, 128, 116, 4, ST[1]);
  c.shadedRect(0, 22, 128, 12, ST);
  merlonsH(c, 0, 10, 128, 9, 14, 13);
  // арка с решёткой
  const ox = 64, oy = 84, rx = 26;
  for (let y = 50; y < 128; y++) for (let x = 0; x < 128; x++) {
    const inside = y >= oy ? Math.abs(x + 0.5 - ox) < rx : ((x + 0.5 - ox) / rx) ** 2 + ((y + 0.5 - oy) / 34) ** 2 < 1;
    if (!inside) continue;
    const bar = (x - ox + 64) % 6 === 0 || (y - 50) % 8 === 0;
    c.set(x, y, bar ? P.darkSteel[3] : mix(hex("#1a0a0a"), hex("#6a1a10"), Math.max(0, (y - 70) / 60)));
  }
  for (let a = 0; a <= 60; a++) {
    const t = Math.PI * (a / 60);
    c.set(ox - Math.cos(t) * (rx + 1), oy - Math.sin(t) * 35, ST[5]);
  }
  // знамёна
  for (const bx of [14, 92]) {
    c.rect(bx, 40, 22, 54, RED[1]);
    c.rect(bx + 1, 40, 20, 52, RED[2]);
    c.poly([[bx, 94], [bx + 22, 94], [bx + 11, 104]], RED[2]);
    c.rect(bx - 2, 38, 26, 3, GOLD[2]);
    c.line(bx + 4, 52, bx + 18, 76, P.steel[3], 2);
    c.line(bx + 18, 52, bx + 4, 76, P.steel[3], 2);
    c.rect(bx + 2, 72, 6, 2, GOLD[2]);
    c.rect(bx + 14, 72, 6, 2, GOLD[2]);
  }
  // табличка с черепом-эмблемой
  c.shadedRect(48, 36, 32, 12, GOLD);
  c.ellipse(64, 42, 4, 3.5, hex("#f1ecdf"));
  c.set(62, 42, hex("#2a1a10")); c.set(66, 42, hex("#2a1a10"));
  return c.outline();
};

// ---------------- рынок и мелочь ----------------
export function stallArt(awning: RGBA): PC {
  const c = new PC(64, 72);
  for (const x of [6, 56]) c.shadedRect(x, 20, 3, 46, P.wood);
  c.shadedRect(2, 50, 60, 18, P.wood);
  c.rect(2, 50, 60, 3, P.wood[3]);
  const goods: [number, RGBA][] = [[10, P.magic.fire[2]], [20, P.magic.blue[2]], [30, P.magic.green[2]], [40, P.magic.fire[3]], [50, P.magic.purple[2]]];
  for (const [x, col] of goods) {
    c.shadedEllipse(x + 2, 46, 3, 3.5, [shade(col, 0.6), col, mix(col, hex("#ffffff"), 0.4), hex("#ffffff")]);
    c.rect(x + 1, 41, 2, 2, P.wood[2]);
  }
  c.poly([[0, 22], [64, 22], [58, 6], [6, 6]], (x) => (Math.floor(x / 8) % 2 ? hex("#e8e0d0") : awning));
  for (let x = 0; x < 64; x += 8) c.ellipse(x + 4, 23, 4, 2.5, Math.floor(x / 8) % 2 ? hex("#e8e0d0") : awning);
  return c.outline();
}
const anvil: Art = () => {
  const c = new PC(32, 32);
  c.shadedRect(9, 20, 14, 11, P.wood);
  c.shadedRect(5, 12, 22, 5, P.darkSteel);
  c.poly([[27, 12], [31, 13], [27, 16]], P.darkSteel[3]);
  c.shadedRect(11, 16, 10, 5, P.darkSteel);
  c.rect(6, 12, 20, 1, P.darkSteel[4]);
  c.line(18, 10, 24, 6, P.wood[2], 1);
  c.rect(22, 4, 5, 3, P.steel[2]);
  return c.outline();
};
const cauldron: Art = () => {
  const c = new PC(32, 36);
  c.line(6, 34, 12, 26, P.wood[1], 2);
  c.line(26, 34, 20, 26, P.wood[1], 2);
  c.ellipse(16, 32, 7, 2.5, P.magic.fire[2]);
  c.ellipse(16, 31, 4, 1.5, P.magic.fire[4]);
  c.shadedEllipse(16, 22, 11, 9, P.darkSteel, [-0.5, -0.6], true, 30);
  c.ellipse(16, 15, 10, 3, P.darkSteel[1]);
  c.ellipse(16, 15, 8, 2.2, hex("#c88a3a"));
  c.ellipse(13, 14.5, 2.5, 1, hex("#e8b060"));
  for (const [x, y] of [[12, 9], [18, 6], [15, 3]]) c.ellipse(x, y, 1.5, 1.5, withA(hex("#e8e4e0"), 140));
  return c.outline();
};
const dummy: Art = () => {
  const c = new PC(32, 48);
  c.rect(15, 18, 3, 30, P.wood[2]);
  c.rect(6, 22, 21, 3, P.wood[2]);
  c.shadedEllipse(16, 28, 7, 9, ramp("#7a6230", "#a88a44", "#cdb064", "#e8d090"));
  c.shadedEllipse(16, 13, 5, 5.5, ramp("#7a6230", "#a88a44", "#cdb064", "#e8d090"));
  c.rect(10, 27, 13, 2, RED[2]);
  c.line(13, 33, 19, 39, P.leather[1], 1);
  return c.outline();
};
const weaponRack: Art = () => {
  const c = new PC(32, 48);
  c.shadedRect(4, 40, 24, 5, P.wood);
  c.rect(5, 18, 3, 26, P.wood[2]);
  c.rect(24, 18, 3, 26, P.wood[2]);
  c.rect(4, 22, 24, 2, P.wood[3]);
  for (const [x, top, kind] of [[10, 6, 0], [16, 4, 1], [21, 10, 0]] as const) {
    c.line(x, top, x, 42, kind ? P.wood[3] : P.steel[3], kind ? 1 : 2);
    if (kind) c.poly([[x - 2, top + 4], [x, top - 2], [x + 2, top + 4]], P.steel[4]);
    else c.rect(x - 2, top + 22, 5, 2, GOLD[2]);
  }
  return c.outline();
};
const hay: Art = () => {
  const c = new PC(32, 32);
  const H = ramp("#7a5a20", "#a8822e", "#d0aa44", "#ecd070");
  c.shadedRect(4, 12, 24, 18, H, 3);
  for (let x = 6; x < 28; x += 3) c.line(x, 13, x + 1, 28, H[1], 1);
  c.rect(4, 17, 24, 2, P.wood[1]);
  c.rect(4, 24, 24, 2, P.wood[1]);
  return c.outline();
};

export const TOWN_ART: Record<string, Art> = {
  wall_h: wallH, wall_v: wallV, tower, gate_arch: gateArch,
  tavern, bank, forge, arena_gate: arenaGate,
  stall_blue: () => stallArt(P.cloth.blue[2]), stall_green: () => stallArt(P.cloth.green[2]),
  anvil, cauldron, dummy, weapon_rack: weaponRack, hay,
};
