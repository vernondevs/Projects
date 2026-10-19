/**
 * Слоёвая внешность героя по снаряжению: шлем, доспех (наплечники, плащ), сапоги и оружие рисуются
 * пиксельными слоями поверх спрайта класса. Вид зависит от типа, редкости, фракции и легендарной темы
 * (data/legendaries.json -> look), эффекты усиливаются с заточкой.
 * Координаты слоёв — в системе кадра 32x32 (голова в (16,11), плечи на y=16, ступни на y=30).
 */
import Phaser from "phaser";
import { RARITY_COLORS } from "../../../shared/items";
import { LEGENDARIES, type LegendaryDef } from "../../../shared/legendary";

type Look = LegendaryDef["look"];
const colCache = new Map<string, number>();
const C = (hex: string) => {
  let v = colCache.get(hex);
  if (v === undefined) { v = Phaser.Display.Color.HexStringToColor(hex).color; colCache.set(hex, v); }
  return v;
};
const dark = (hex: string, k: number) => {
  const c = Phaser.Display.Color.HexStringToColor(hex);
  return Phaser.Display.Color.RGBToString(Math.round(c.red * k), Math.round(c.green * k), Math.round(c.blue * k), 0, "#");
};

/** Палитры фракций: Сольгард — светлый металл и золото, Умбрат — тёмный металл, кость и пурпур. */
const PAL = {
  solgard: { m: ["#4a5668", "#8a98ae", "#c8d4e4", "#ffffff"], gold: "#f0c040", gold2: "#a87818", cape: "#a02830", capeEdge: "#f0c040", eye: "#fff0b0", belt: "#a87818" },
  umbrath: { m: ["#14101c", "#2e2838", "#4e4660", "#8a7ea8"], gold: "#d8d0b8", gold2: "#a89c80", cape: "#4a1a6a", capeEdge: "#a050ff", eye: "#c070ff", belt: "#a89c80" },
};
const SKIN: Record<string, string> = { deathknight: "#84988a", darkranger: "#84988a", bloodweaver: "#9a8290", warlock: "#d8d0b8", reaver: "#8a8288" };
const ROBES = new Set(["mage", "healer", "bloodweaver", "warlock"]);

export interface Piece { r: number; plus: number; leg: string; rag: boolean; base: string }
export function parseGear(gear: string): Piece[] {
  return (gear || "|||").split("|").map((s) => { const [r, p, l, g, bs] = s.split(":"); return s ? { r: Number(r || 0), plus: Number(p || 0), leg: l || "", rag: g === "1", base: bs || "" } : { r: -1, plus: 0, leg: "", rag: false, base: "" }; });
}

export interface GearInput {
  cls: string; faction: string; gear: string; weapon: string;
  view: number; flip: boolean; col: number; ox: number; oy: number; t: number; seed: number;
}

export class GearLayers {
  private back: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;
  private g!: Phaser.GameObjects.Graphics;
  private flip = false;
  private ox = 0;
  private oy = 0;
  private ring?: Phaser.GameObjects.Graphics;
  /** Сдвиг слоя корпуса при наклоне в атаке. */
  private sx = 0;
  private sy = 0;

  constructor(scene: Phaser.Scene) {
    this.back = scene.add.graphics();
    this.front = scene.add.graphics();
  }

  hide() { this.back.clear().setVisible(false); this.front.clear().setVisible(false); this.ring?.clear(); }

  private R(x: number, y: number, w: number, h: number, hex: string, a = 1) {
    const xx = x + this.sx, px = this.flip ? 32 - xx - w : xx;
    this.g.fillStyle(C(hex), a).fillRect(Math.round(this.ox + px), Math.round(this.oy + y + this.sy), w, h);
  }
  private line(x0: number, y0: number, x1: number, y1: number, hex: string, w = 1, a = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) this.R(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), w, w, hex, a);
  }
  /** Мерцание: белая точка пробегает вдоль детали. */
  private glint(x: number, y: number, w: number, per: number, ph: number, t: number, seed: number) {
    const f = (t / per + ph + seed * 0.13) % 1;
    if (f < 0.14) this.R(Math.round(x + (f / 0.14) * (w - 1)), y, 1, 1, "#ffffff");
  }
  /** Язычки пламени от точки (x,y) вверх. */
  private flame(x: number, y: number, n: number, h: number, c1: string, c2: string, t: number, ph = 0) {
    for (let i = 0; i < n; i++) {
      const hh = Math.max(2, Math.round(h * (0.6 + 0.4 * Math.sin(t / 85 + i * 2.1 + ph)) * (i === Math.floor(n / 2) ? 1.3 : 1)));
      const fx = x + (i - (n - 1) / 2) * 2;
      this.R(fx, y - hh, 2, hh, c1, 0.9);
      this.R(fx, y - hh + 1, 1, Math.max(1, hh - 2), c2, 0.95);
      if (hh > 4) this.R(fx, y - hh, 1, 1, "#ffffff");
    }
  }

  draw(i: GearInput) {
    const [h, a, b, o] = parseGear(i.gear);
    const [wb, wrs, wps, wl] = (i.weapon || "").split(":");
    const wr = Number(wrs || 0);
    const pl = Math.max(Number(wps || 0), h.plus, a.plus, b.plus);
    const hasAny = h.r >= 0 || a.r >= 0 || b.r >= 0 || o.r >= 0 || wr >= 1 || true; // без брони герой всегда рисуется (голое тело)
    if (!hasAny) { this.hide(); return; }
    this.back.clear().setVisible(true);
    this.front.clear().setVisible(true);
    this.flip = i.flip; this.ox = i.ox; this.oy = i.oy;
    const pal = i.faction === "umbrath" ? PAL.umbrath : PAL.solgard;
    const legOf = (id: string): LegendaryDef | undefined => (id ? LEGENDARIES[id] : undefined);
    const dom = legOf(a.leg) ?? legOf(h.leg) ?? legOf(wl) ?? legOf(b.leg);
    const trimOf = (p: Piece) => (legOf(p.leg)?.tint ?? (dom && p.r >= 2 ? dom.tint : p.r >= 1 ? RARITY_COLORS[Math.min(2, p.r)] : ""));
    const t = i.t;
    const bob = i.col < 4 ? [0, -1, 0, -1][i.col] : 0;
    const view = i.view, side = view === 2, up = view === 1;
    const cx = side ? 16.5 : 16;
    const robe = ROBES.has(i.cls);

    const skin = SKIN[i.cls] ?? "#d9956f", skinD = dark(skin, 0.8);
    const walking = i.col < 4, atk = i.col >= 4 && i.col < 8 ? i.col - 4 : -1;
    const lean = atk === 1 || atk === 2 ? 1 : 0;
    const lx = side ? lean : 0, ly = view === 0 ? lean : up ? -lean : 0;
    const sw = walking ? [0, 1, 0, -1][i.col] : 0;
    const feet: [number, number][] = side ? [0, 1].map((k) => [Math.round(14.5 + (k ? 1 : -1) * ([0, 2.5, 0, -2.5][i.col] ?? 0)), k] as [number, number]) : [[12, 0], [16, 1]];
    const bareTorso = a.r < 0 || a.rag;
    this.sx = 0; this.sy = 0;

    // ---- плащ (сзади, у спины — поверх): колышется, на ходу сильнее ----
    if (a.r >= 2 && !a.rag) {
      const L = legOf(a.leg), c = L ? dark(L.tint, 0.55) : pal.cape, edge = L ? L.look.c2 : pal.capeEdge;
      const amp = walking ? 2 : 1, fl = Math.round(Math.sin(t / 200 + i.seed) * amp), len = L ? 13 : 10;
      const tail = (k: number) => Math.round(Math.sin(t / 170 + k * 1.3 + i.seed) * amp * 0.8);
      this.g = up ? this.front : this.back;
      if (up) {
        this.R(10, 16 + bob, 12, len, c); this.R(10, 16 + bob, 2, len, dark(c, 0.7)); this.R(20, 16 + bob, 2, len, dark(c, 0.7));
        for (let k = 0; k < 3; k++) this.R(10 + k * 4 + fl, 16 + bob + len + tail(k), 4, 1, edge);
        this.R(12, 16 + bob, 8, 1, edge);
        if (L) { this.R(15, 18 + bob, 2, 5, L.look.c2, 0.8); this.R(14, 20 + bob, 4, 1, L.look.c2, 0.8); }
      } else if (side) {
        for (let k = 0; k < len; k += 3) this.R(8 + Math.round(fl * (k / len) * 1.5) - (walking ? 1 : 0), 16 + bob + k, 5, 3, c);
        this.R(8 + fl * 2, 16 + bob + len, 5, 1, edge);
      } else {
        for (const x of [8, 22]) { for (let k = 0; k < len - 1; k += 3) this.R(x + Math.round(fl * (k / len)) * (x < 16 ? -1 : 1), 17 + bob + k, 2, 3, c); this.R(x, 17 + bob + len - 1 + tail(x), 2, 1, edge); }
      }
    }

    this.g = this.front;
    // ---- тело без брони: голое, пах скрыт пикселизацией; лохмотья — рваная ткань ----
    if (bareTorso) {
      const x0 = side ? 13 : 11, w = side ? 7 : 10, y0 = 16 + bob;
      this.sx = lx; this.sy = ly;
      if (a.rag) {
        this.R(x0, y0, w, 7, "#6a5238"); this.R(x0 + 1, y0 + 2, 2, 2, "#4a3824"); this.R(x0 + w - 3, y0 + 4, 2, 2, "#8a6a48"); this.R(x0, y0 + 5, w, 1, "#3a2a1a");
        if (!up) this.R(x0 + 1, y0, 2, 5, "#8a6a48");
        for (let k = 0; k < w; k += 2) this.R(x0 + k, y0 + 7, 2, [2, 1, 3, 1, 2][(k / 2) | 0] ?? 1, "#6a5238");
      }
      this.sx = 0; this.sy = 0;
      if (a.rag) { this.R(14, 23, 4, 4, "#5a4630"); this.R(15, 26, 2, 1, "#3a2a1a"); this.R(14, 23, 4, 1, "#3a2a1a"); }
      else {
        // цензурная пикселизация: мозаика 2x2 телесных оттенков
        // шахматка 3x3 из ярких и тёмных тонов кожи с тёмной рамкой — хорошо читается на любом классе
        const bx = side ? 14 : 13, light = dark(skin, 1.0), mid = dark(skin, 0.7), deep = dark(skin, 0.4);
        this.R(bx - 1, 21, 8, 8, deep);
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) this.R(bx + q * 2, 22 + r * 2, 2, 2, (r + q) % 2 ? mid : (r + q) % 4 === 0 ? "#f4e4cc" : light);
      }
    }
    // ---- сапоги ----
    if (b.r < 0 || b.rag) {
      for (const [fx, k] of feet) {
        const w = side ? 5 : 4;
        if (b.r < 0) continue;
        else { this.R(fx, 27, w, 3, "#5a4630"); this.R(fx, 28, w, 1, "#3a2a1a"); this.R(fx, 26, w - 1, 1, "#8a6a48"); }
      }
    } else {
      const L = legOf(b.leg), tr = trimOf(b), m = pal.m;
      const top = robe ? 28 : 26;
      for (const [fx, k] of feet) {
        const w = side ? 5 : 4;
        this.R(fx, top, w, 30 - top, k ? m[2] : m[1]);
        this.R(fx, 29, w, 1, m[0]);
        if (!robe) this.R(fx, top, w, 1, tr || m[3]);
        if (b.r >= 2 && !robe) this.R(fx + (side ? 4 : (k ? 3 : 0)), top - 1, 1, 2, tr || pal.gold);
        if (b.r >= 1 && tr) this.glint(fx, top, w, b.r >= 2 ? 1300 : 2300, k * 0.5, t, i.seed);
        if (L) {
          if (L.look.helm === "wings" || L.look.pauld === "spikes") { const wv = Math.round(Math.sin(t / 150 + k * 2) * 1); this.line(fx - 1, top, fx - 4, top - 4 + wv, L.look.c2, 1); this.line(fx - 1, top + 1, fx - 5, top - 1 + wv, L.tint, 1); }
          this.flame(fx + 2, 30, 2, 3 + Math.min(3, pl / 3), L.tint, L.look.c2, t, k);
        }
      }
    }
    // ---- доспех: нагрудник, наплечники, знамя ----
    if (a.r >= 0 && !a.rag) {
      const L = legOf(a.leg), tr = trimOf(a), m = pal.m;
      const x0 = side ? 13 : 11, w = side ? 7 : 10, y0 = 16 + bob;
      this.sx = lx; this.sy = ly;
      this.R(x0, y0, w, 8, m[1]);
      this.R(x0, y0, w, 2, m[2]);
      this.R(x0, y0 + 6, w, 2, m[0]);
      if (robe) { this.R(x0 - 1, y0 + 8, w + 2, 4, m[0]); this.R(x0 - 1, 28 + bob, w + 2, 1, tr || pal.gold2); }
      this.R(x0, y0 + 6, w, 1, pal.belt);
      if (!side) this.R(15, y0 + 6, 2, 1, pal.gold);
      if (tr) { this.R(x0, y0, w, 1, tr); if (!side) this.R(15, y0 + 1, 2, 5, tr, 0.9); if (a.r >= 1) this.glint(x0, y0 + 1, w, a.r >= 2 ? 1200 : 2400, 0.3, t, i.seed); }
      if (a.r >= 2 && !up) { this.R(15, y0 + 3, 2, 2, pal.gold); this.R(14, y0 + 4, 4, 1, pal.gold2); }
      // знамя-табард: колышется
      if (a.r >= 2 && !up && !side) {
        const n2 = L ? 7 : 4, col = L ? L.tint : pal.cape;
        for (let k = 0; k < n2; k++) this.R(14 + Math.round(Math.sin(t / 230 + k * 0.7 + i.seed) * 0.9 * (k / n2) * (walking ? 2 : 1)), y0 + 8 + k, 4, 1, k === n2 - 1 ? (L ? L.look.c2 : pal.capeEdge) : k % 3 ? col : dark(col, 0.8));
      }
      if (L) {
        const pulse = 0.65 + 0.35 * Math.sin(t / 240 + i.seed);
        if (!up) { this.R(15, y0 + 2, 2, 3, L.look.c2, pulse); this.R(14, y0 + 3, 4, 1, L.tint, pulse); }
        this.R(x0, y0 + 2, 1, 4, L.tint, 0.8); this.R(x0 + w - 1, y0 + 2, 1, 4, L.tint, 0.8);
      }
      // наплечники: покачиваются при ходьбе
      if (a.r >= 1) {
        const sh = side ? [15.5] : [8.5, 20.5];
        sh.forEach((sx, k) => {
          const s = side ? 1 : k ? 1 : -1;
          const px = Math.round(sx), y = 14 + bob + (side ? 0 : k ? sw : -sw), big = a.r >= 2 || L;
          this.R(px, y + 1, 3 + (big ? 1 : 0), 3 + (big ? 1 : 0), m[2]);
          this.R(px, y + 1, 3 + (big ? 1 : 0), 1, tr || pal.gold);
          this.R(px, y + 3 + (big ? 1 : 0), 3 + (big ? 1 : 0), 1, m[0]);
          if (a.r >= 2) this.glint(px, y + 1, 4, 1000, k * 0.5, t, i.seed);
          if (a.r >= 2 && !L) {
            if (i.faction === "umbrath") this.line(px + 1, y + 1, px + 1 + s * 2, y - 3 + (walking ? sw : 0), pal.gold, 1);
            else this.R(px + (s > 0 ? 2 : -1), y, 2, 2, pal.gold);
          }
          if (L) {
            const lk = L.look, cxs = px + 2;
            if (lk.pauld === "flame") this.flame(cxs, y + 1, 3, 5 + Math.min(4, pl / 2), L.tint, lk.c2, t, k * 1.7);
            else if (lk.pauld === "spikes") { this.line(cxs, y + 1, cxs + s * 5, y - 6, L.tint, 2); this.line(cxs + s, y, cxs + s * 5, y - 6, lk.c2, 1); }
            else if (lk.pauld === "bolts") {
              if (((Math.floor(t / 90) + k * 3) % 4) !== 0) {
                let bx = cxs, by = y;
                const sd = Math.floor(t / 90) * 7 + k * 13 + i.seed;
                for (let j = 0; j < 4; j++) { const nx = bx + ((sd * (j + 3)) % 5) - 2, ny = by - 3; this.line(bx, by, nx, ny, j % 2 ? lk.c2 : L.tint, 1); bx = nx; by = ny; }
              }
            } else {
              const fy = Math.round(Math.sin(t / 300 + k * 2) * 2);
              this.R(cxs - 1 + s * 2, y - 5 + fy, 3, 1, lk.c2); this.R(cxs + s * 2, y - 6 + fy, 1, 3, L.tint); this.R(cxs - 1 + s * 2, y - 4 + fy, 3, 1, L.tint);
            }
          }
        });
      }
    }
    // ---- шлем ----
    this.sx = lx; this.sy = ly;
    if (h.r >= 0) this.helmet(h, legOf(h.leg), trimOf(h), pal, cx, view, bob, t, pl, i.seed);
    this.sx = 0; this.sy = 0;
    // ---- вторая рука: щит или второй клинок ----
    if (o.r >= 0) {
      const lo = legOf(o.leg);
      if (o.base === "shield") this.shield(o, lo, trimOf(o), dom, pal, i, bob, lx, ly, sw);
      else this.weapon(o.base, o.r, lo, dom, pal, { ...i, weapon: "" }, bob, pl, true);
    }
    // ---- оружие ----
    if (wb && (wr >= 1 || legOf(wl))) this.weapon(wb, wr, legOf(wl), dom, pal, i, bob, pl);
    // ---- легендарная аура, частицы и кольцо ----
    if (dom) this.aura(dom, pl, i, bob, a.r >= 0 && h.r >= 0 && b.r >= 0);
    else this.ring?.clear();
  }

  private helmet(h: Piece, L: LegendaryDef | undefined, tr: string, pal: typeof PAL.solgard, cx: number, view: number, bob: number, t: number, pl: number, seed: number) {
    const m = pal.m, up = view === 1, side = view === 2, y = bob;
    const metal = L ? [dark(L.tint, 0.4), dark(L.tint, 0.7), L.tint, L.look.c2] : m;
    const x0 = side ? 9 : 10, w = side ? 12 : 12;
    // купол
    this.R(side ? 11 : 12, 4 + y, side ? 9 : 8, 1, metal[2]);
    this.R(x0 + 1, 5 + y, w - 2, 1, metal[2]);
    this.R(x0, 6 + y, w, 3, metal[1]);
    this.R(x0, 6 + y, 2, 3, metal[0]);
    this.R(x0, 9 + y, w, 1, metal[0]);
    if (up) this.R(x0, 9 + y, w, 4, metal[1]);
    if (!up) {
      // нащёчники и шлемный гребень
      if (side) this.R(19, 9 + y, 3, 4, metal[1]); else { this.R(10, 9 + y, 2, 4, metal[1]); this.R(20, 9 + y, 2, 4, metal[1]); }
      if (h.r >= 1 && !side) this.R(15, 6 + y, 2, 5, metal[3]);
      // прорезь забрала: у Умбрат и легендарных — горящие глаза
      const eye = L ? L.look.c2 : pal.eye;
      if (L || cx === 16 && pal === PAL.umbrath) { this.R(side ? 17 : 12, 10 + y, side ? 4 : 8, 2, "#0c0a10"); if (side) this.R(19, 10 + y, 2, 1, eye); else { this.R(13, 10 + y, 2, 1, eye); this.R(17, 10 + y, 2, 1, eye); } }
    }
    if (tr) { this.R(x0, 8 + y, w, 1, tr); if (h.r >= 1) this.glint(x0, 8 + y, w, h.r >= 2 ? 1100 : 2200, 0, t, seed); }
    if (h.r === 2 && !L) {
      // эпический гребень: перья Сольгарда или костяные шипы Умбрата
      if (pal === PAL.umbrath) { for (const s of [-1, 1]) { this.line(cx + s * 4, 5 + y, cx + s * 6, 0 + y, pal.gold, 1); this.R(cx + s * 6 - 1, -1 + y, 1, 1, pal.gold); if (side) break; } }
      else { const sy2 = Math.round(Math.sin(t / 260 + seed) * 1.5); this.line(cx, 4 + y, cx - (side ? 3 : 0) + sy2, -2 + y, pal.gold, 2); this.line(cx + 1, 4 + y, cx - (side ? 2 : -1) + sy2, -1 + y, pal.gold2, 1); }
    }
    if (!L) return;
    const lk = L.look, pw = 1 + pl / 6;
    if (lk.helm === "horns") {
      for (const s of side ? [-1] : [-1, 1]) {
        const pts: [number, number][] = [[cx + s * 5, 5], [cx + s * 7, 2], [cx + s * 10, -1], [cx + s * 10, -5], [cx + s * 8, -8]];
        for (let k = 0; k < pts.length - 1; k++) this.line(pts[k][0], pts[k][1] + y, pts[k + 1][0], pts[k + 1][1] + y, k > 2 ? lk.c2 : L.tint, 3 - Math.min(2, k));
      }
      if (side) this.line(cx + 2, 4 + y, cx + 5, -4 + y, L.tint, 2);
    } else if (lk.helm === "flame") {
      this.flame(cx, 5 + y, 5, 7 + pw * 2, L.tint, lk.c2, t, seed);
      this.R(cx - 5, 3 + y, 10, 2, metal[3]);
    } else if (lk.helm === "crown") {
      this.R(cx - 6, 3 + y, 12, 2, "#f0c040");
      for (let k = 0; k < 5; k++) { const sx = cx - 6 + k * 2.5; this.R(sx, -1 + y + (k % 2) * 2, 2, 4 - (k % 2) * 2, "#f0c040"); this.R(sx, -1 + y + (k % 2) * 2, 2, 1, k % 2 ? "#ffffff" : lk.c2); }
      this.R(cx - 1, 3 + y, 2, 1, lk.c2);
    } else if (lk.helm === "wings") {
      for (const s of side ? [-1] : [-1, 1]) for (let k = 0; k < 4; k++) this.line(cx + s * 5, 7 + y - k, cx + s * (9 + k * 2), 4 + y - k * 3 - Math.round(Math.sin(t / 300 + k) * 1), k % 2 ? lk.c2 : L.tint, 1);
    } else {
      const g = this.g;
      g.lineStyle(1, C(lk.c2), 0.9).strokeEllipse(this.ox + 16, this.oy - 3 + y + Math.sin(t / 400) * 1.2, 16, 5);
      g.lineStyle(1, C(L.tint), 0.7).strokeEllipse(this.ox + 16, this.oy - 3 + y + Math.sin(t / 400) * 1.2, 20, 7);
    }
  }

  /** Щит на левой руке: размер и убранство растут с редкостью, у легендарных — свечение и пламя по кромке. */
  private shield(o: Piece, L: LegendaryDef | undefined, tr: string, dom: LegendaryDef | undefined, pal: typeof PAL.solgard, i: GearInput, bob: number, lx: number, ly: number, sw: number) {
    const { view, t } = i, m = pal.m, up = view === 1, side = view === 2;
    const w = 6 + Math.min(3, o.r + (L ? 1 : 0)), h = 8 + Math.min(4, o.r * 1.5 + (L ? 2 : 0));
    const x = side ? 13 - lx : up ? 22 : 8 - w + 3, y = 17 + bob + (side ? 0 : -sw) + ly;
    const metal = L ? [dark(L.tint, 0.4), dark(L.tint, 0.7), L.tint, L.look.c2] : m;
    this.g = this.front; this.sx = 0; this.sy = 0;
    const sway = Math.round(Math.sin(t / 300 + i.seed) * (o.r >= 2 ? 1 : 0));
    const ww = side ? 3 : w, xx = x + (side ? 0 : sway * 0);
    this.R(xx, y, ww, h, metal[1]);
    this.R(xx, y, ww, 1, metal[3]); this.R(xx, y + h - 1, ww, 1, metal[0]);
    this.R(xx + 1, y + h, Math.max(1, ww - 2), 1, metal[0]);
    if (!side) {
      this.R(xx, y, 1, h, metal[2]); this.R(xx + ww - 1, y, 1, h, metal[0]);
      const ec = L ? L.look.c2 : pal === PAL.umbrath ? pal.eye : pal.gold;
      if (!up) {
        if (pal === PAL.umbrath) { this.R(xx + ww / 2 - 1, y + 2, 2, 2, pal.gold); this.R(xx + ww / 2 - 1, y + 5, 2, 1, pal.gold2); } else { this.R(xx + Math.floor(ww / 2) - 1, y + 2, 2, h - 4, ec); this.R(xx + 1, y + Math.floor(h / 2) - 1, ww - 2, 2, ec); }
        if (o.r >= 1 && tr) { this.R(xx, y, ww, 1, tr); this.R(xx, y + h - 1, ww, 1, tr); }
        if (o.r >= 1) this.glint(xx, y + 1, ww, o.r >= 2 ? 1000 : 2100, 0.2, t, i.seed);
        if (o.r >= 2 && !L) { this.R(xx - 1, y + 1, 1, 2, pal.gold); this.R(xx + ww, y + 1, 1, 2, pal.gold); }
      }
    }
    if (L) {
      const pulse = 0.6 + 0.4 * Math.sin(t / 220 + i.seed);
      this.R(xx - 1, y - 1, ww + 2, 1, L.tint, 0.5 * pulse); this.R(xx - 1, y + h, ww + 2, 1, L.look.c2, 0.4 * pulse);
      if (L.look.pauld === "flame" || L.look.fx === "ember") this.flame(xx + ww / 2, y, 3, 4, L.tint, L.look.c2, t, 2);
      else if (!up) for (const sp of [0, 1]) this.line(xx + sp * (ww - 1), y, xx + sp * (ww - 1) + (sp ? 2 : -2), y - 4, L.tint, 1);
    }
  }

  private weapon(wb: string, wr: number, L: LegendaryDef | undefined, dom: LegendaryDef | undefined, pal: typeof PAL.solgard, i: GearInput, bob: number, pl: number, off = false) {
    const { view, col, t } = i;
    const base = L ? L.tint : dom && wr >= 2 ? dom.tint : RARITY_COLORS[Math.min(2, wr)];
    const hi = L ? L.look.c2 : "#ffffff";
    const F = view === 0 ? Math.PI / 2 : view === 1 ? -Math.PI / 2 : 0;
    const D = Math.PI / 180;
    const atk = col >= 4 && col < 8 ? col - 4 : -1;
    const swing = col < 4 ? [0, 1, 0, -1][col] : 0;
    const melee = wb === "sword" || wb === "axe" || wb === "dagger" || wb === "mace";
    const fwd = atk === 1 || atk === 2 ? 2 : 0, ln = fwd ? 1 : 0;
    let hx = view === 2 ? 18 + swing + fwd + ln : view === 0 ? 22.5 : 9.5, hy = 22 + bob + (view === 0 ? fwd * 0.5 + ln : view === 1 ? -fwd * 0.5 - ln : 0);
    let ang: number;
    if (melee) ang = atk >= 0 ? F + [-135, -45, 45, -20][atk] * D : view === 2 ? -60 * D : view === 0 ? -70 * D : -110 * D;
    else if (wb === "bow") { ang = view === 2 ? 0 : view === 0 ? Math.PI / 2 : -Math.PI / 2; if (view !== 2) { hx = view === 0 ? 21 : 11; hy = 21 + bob; } }
    else { ang = atk >= 0 ? [-95 * D, -70 * D + F * 0.25, -60 * D + F * 0.3, -85 * D][atk] : -90 * D; if (atk >= 0) hy -= [2, 1, 1, 0][atk]; }
    if (off) { ang = Math.PI - ang; hx = view === 2 ? 14 - swing : view === 0 ? 9.5 : 22.5; if (view === 2) ang = -100 * D; }
    const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
    const pulse = 0.75 + 0.25 * Math.sin(t / 150 + i.seed);
    if (wr >= 1 && (wb === "mace" || wb === "sword" || wb === "dagger" || wb === "axe")) { const gf = (t / (wr >= 2 ? 900 : 1900) + i.seed * 0.1) % 1; if (gf < 0.2) this.R(Math.round(hx + dx * (3 + gf * 50)), Math.round(hy + dy * (3 + gf * 50)), 1, 1, "#ffffff"); }
    const len = (wb === "dagger" ? 6 : wb === "axe" ? 10 : wb === "sword" ? 11 : 14) + (L ? 5 + Math.min(4, pl / 2) : wr * 1.5);
    this.g = this.front;
    if (wb === "sword" || wb === "dagger") {
      this.line(hx + dx * 2, hy + dy * 2, hx + dx * len, hy + dy * len, base, L ? 3 : 2);
      this.line(hx + dx * 2, hy + dy * 2, hx + dx * (len - 1), hy + dy * (len - 1), hi, 1);
      this.line(hx - px * 3, hy - py * 3, hx + px * 3, hy + py * 3, pal.gold, 1);
      if (L) for (let s = 3; s < len; s += 3) this.R(Math.round(hx + dx * s + px * 2), Math.round(hy + dy * s + py * 2), 1, 1, hi, pulse);
    } else if (wb === "mace") {
      this.line(hx - dx * 2, hy - dy * 2, hx + dx * len, hy + dy * len, "#8a5a2a", 1);
      const ex = hx + dx * len, ey = hy + dy * len, hs = L ? 5 : 4;
      this.R(Math.round(ex - hs / 2), Math.round(ey - hs / 2), hs, hs, base); this.R(Math.round(ex - hs / 2), Math.round(ey - hs / 2), hs, 1, hi);
      for (const [sx2, sy2] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) this.R(Math.round(ex + sx2 * (hs / 2 + 1)), Math.round(ey + sy2 * (hs / 2 + 1)), 1, 1, hi);
    } else if (wb === "axe") {
      this.line(hx - dx * 2, hy - dy * 2, hx + dx * len, hy + dy * len, "#8a5a2a", 1);
      const ex = hx + dx * (len - 2), ey = hy + dy * (len - 2);
      this.line(ex - px * 1, ey - py * 1, ex + px * 5, ey + py * 5, base, L ? 4 : 3);
      this.line(ex + px * 5 + dx * 2, ey + py * 5 + dy * 2, ex + px * 5 - dx * 3, ey + py * 5 - dy * 3, hi, 1);
      if (L) this.line(ex - px, ey - py, ex - px * 4, ey - py * 4, base, 2);
    } else if (wb === "bow") {
      for (let tt = -1; tt <= 1.001; tt += 0.125) this.R(Math.round(hx + px * tt * 7 + dx * (1 - tt * tt) * 3), Math.round(hy + py * tt * 7 + dy * (1 - tt * tt) * 3), L ? 2 : 1, L ? 2 : 1, tt > 0.7 || tt < -0.7 ? hi : base, 0.95);
      if (L) this.line(hx + px * 7, hy + py * 7, hx - px * 7, hy - py * 7, hi, 1, 0.35 * pulse);
    } else {
      // посох / жезл: навершие
      const ox = hx + dx * (len + 1), oy = hy + dy * (len + 1), r = 2 + wr + (L ? 1 : 0);
      this.line(hx - dx * 2, hy - dy * 2, ox, oy, "#8a5a2a", 1);
      this.g.fillStyle(C(base), 0.28 * pulse).fillCircle(this.ox + (i.flip ? 32 - ox : ox), this.oy + oy, r + 3 + pl * 0.25);
      this.R(Math.round(ox - r / 2), Math.round(oy - r / 2), r, r, base);
      this.R(Math.round(ox - r / 2), Math.round(oy - r / 2), 1, 1, "#ffffff");
      if (L) for (let k = 0; k < 3; k++) { const a2 = t / 400 + k * 2.1; this.R(Math.round(ox + Math.cos(a2) * (r + 3)), Math.round(oy + Math.sin(a2) * (r + 2)), 1, 1, hi); }
    }
  }

  /** Частицы темы, наземные кольца и парящие элементы; сила растёт с заточкой. */
  private aura(L: LegendaryDef, pl: number, i: GearInput, bob: number, full: boolean) {
    const t = i.t, lk = L.look, n = 4 + Math.floor(pl / 2) + (full ? 3 : 0);
    this.g = this.front;
    for (let k = 0; k < n; k++) {
      const ph = (t / 1100 + k / n + (k * 0.37)) % 1, sd = k * 12.9898 + i.seed;
      const rx = ((Math.sin(sd) * 43758.5453) % 1 + 1) % 1;
      let x = 16 + (rx - 0.5) * 18, y = 28 + bob - ph * 26, c = ph < 0.5 ? L.tint : lk.c2, a = 1 - ph, w = 1;
      switch (lk.fx) {
        case "ember": x += Math.sin(ph * 9 + k) * 2; w = ph < 0.4 ? 2 : 1; break;
        case "spark": y = 8 + rx * 20; x = 16 + (rx - 0.5) * 22; a = ((Math.floor(t / 70) + k) % 5 === 0) ? 1 : 0; c = lk.c2; break;
        case "drip": y = 14 + ph * 16; c = L.tint; x = 16 + (rx - 0.5) * 14; break;
        case "snow": y = 2 + ph * 28; x += Math.sin(ph * 6 + k) * 3; c = "#ffffff"; break;
        case "leaf": { const ang = t / 700 + k * 6.28 / n; x = 16 + Math.cos(ang) * 11; y = 18 + Math.sin(ang) * 4 - 4 + Math.sin(ph * 6) * 3; a = 0.9; w = 2; break; }
        case "orbit": { const ang = t / 900 + k * 6.28 / n; x = 16 + Math.cos(ang) * 12; y = 16 + Math.sin(ang) * 5 + bob; a = Math.sin(ang) > 0 ? 1 : 0.5; w = 2; break; }
        default: x += Math.sin(ph * 7 + k) * 3; c = lk.c2; a *= 0.8; w = ph < 0.3 ? 2 : 1; break;
      }
      if (a > 0.02) this.R(Math.round(x), Math.round(y), w, w, c, Math.max(0, Math.min(1, a)));
    }
    // наземное кольцо с заточки +4 (второе +8)
    this.ring ??= this.front.scene.add.graphics();
    const ring = this.ring;
    ring.clear();
    if (pl >= 4) {
      const wx = i.ox + 16, wy = i.oy + 29 + bob * 0, p = (t / 1400) % 1;
      ring.setDepth(this.front.depth - 0.3);
      for (let k = 0; k < (pl >= 8 ? 2 : 1); k++) {
        const q = (p + k * 0.5) % 1;
        ring.lineStyle(1, C(k ? lk.c2 : L.tint), (1 - q) * 0.8).strokeEllipse(wx, wy, 12 + q * 22, 4 + q * 8);
      }
    }
  }

  setDepth(d: number) { this.back.setDepth(d - 0.1); this.front.setDepth(d + 0.5); }
  destroy() { this.back.destroy(); this.front.destroy(); this.ring?.destroy(); }
}
