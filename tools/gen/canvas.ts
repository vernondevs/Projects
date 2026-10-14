/** Простой пиксельный холст с примитивами для генерации пиксель-арта. */
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";

export type RGBA = [number, number, number, number];
export type Ramp = RGBA[];

export function hex(c: string, a = 255): RGBA {
  const v = c.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}
export const ramp = (...cs: string[]): Ramp => cs.map((c) => hex(c));
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t].map(Math.round) as RGBA;
}
export function shade(c: RGBA, k: number): RGBA {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k), c[3]].map(Math.round) as RGBA;
}
export const withA = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

export const OUTLINE = hex("#1b1422");

/** Детерминированный генератор случайных чисел для ассетов. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function h2(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Периодический value-noise: бесшовно повторяется с периодом `period` пикселей. */
export function pnoise(x: number, y: number, cell: number, period: number, seed: number) {
  const n = period / cell;
  const fx = x / cell, fy = y / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const m = (v: number) => ((v % n) + n) % n;
  const a = h2(m(x0), m(y0), seed), b = h2(m(x0 + 1), m(y0), seed), c = h2(m(x0), m(y0 + 1), seed), d = h2(m(x0 + 1), m(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export const hash01 = h2;

export class PC {
  data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): RGBA | null {
    if (!this.inside(x, y)) return null;
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  alpha(x: number, y: number) {
    return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3] : 0;
  }
  set(x: number, y: number, c: RGBA) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y) || c[3] === 0) return;
    const i = (y * this.w + x) * 4;
    if (c[3] >= 255) {
      this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255;
      return;
    }
    const a = c[3] / 255, da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) this.data[i + k] = (c[k] * a + this.data[i + k] * da * (1 - a)) / (oa || 1);
    this.data[i + 3] = oa * 255;
  }
  clear(x: number, y: number) {
    if (!this.inside(x, y)) return;
    this.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) this.set(i, j, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA) {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  /** Эллипс с объёмной заливкой по палитре (свет сверху слева). */
  shadedEllipse(cx: number, cy: number, rx: number, ry: number, r: Ramp, light: [number, number] = [-0.55, -0.65], spec = true, maxY = Infinity) {
    const L = [light[0], light[1], 0.55];
    const ll = Math.hypot(L[0], L[1], L[2]);
    for (let y = Math.floor(cy - ry - 1); y <= Math.min(cy + ry + 1, maxY - 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const lum = (dx * L[0] + dy * L[1] + nz * L[2]) / ll; // -1..1
        let idx = Math.floor(((lum + 0.6) / 1.5) * (r.length - (spec ? 0.4 : 1)));
        idx = Math.max(0, Math.min(r.length - 1, idx));
        if (!spec && idx === r.length - 1 && r.length > 2) idx = r.length - 2;
        this.set(x, y, r[idx]);
      }
  }
  /** Прямоугольник со светом сверху и тенью снизу/справа. */
  shadedRect(x: number, y: number, w: number, h: number, r: Ramp, round = 0) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (round) {
        const cx = i < round ? round - i - 0.5 : i >= w - round ? i - (w - round) + 0.5 : 0;
        const cy = j < round ? round - j - 0.5 : j >= h - round ? j - (h - round) + 0.5 : 0;
        if (cx * cx + cy * cy > round * round) continue;
      }
      let idx: number;
      if (j === 0) idx = r.length - 1;
      else if (j >= h - 1 || i >= w - 1) idx = 0;
      else if (i === 0) idx = Math.min(r.length - 1, Math.floor(r.length * 0.75));
      else idx = Math.max(1, Math.min(r.length - 2, Math.floor((1 - j / h) * (r.length - 1) + 0.3)));
      this.set(x + i, y + j, r[idx]);
    }
  }
  poly(pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) this.set(x, y, typeof c === "function" ? c(x, y) : c);
    }
  }
  /** Линия толщиной w (штампами). */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA, w = 1) {
    const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= d; s++) {
      const t = s / d;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (w <= 1) this.set(Math.round(x), Math.round(y), c);
      else this.ellipse(x, y, w / 2, w / 2, c);
    }
  }
  /** Внешний контур: прозрачные пиксели рядом с непрозрачными. */
  outline(c: RGBA = OUTLINE, diagonal = false) {
    const src = new Uint8ClampedArray(this.data);
    const a = (x: number, y: number) => (x >= 0 && y >= 0 && x < this.w && y < this.h ? src[(y * this.w + x) * 4 + 3] : 0);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (a(x, y) > 40) continue;
      const n = a(x - 1, y) > 120 || a(x + 1, y) > 120 || a(x, y - 1) > 120 || a(x, y + 1) > 120 ||
        (diagonal && (a(x - 1, y - 1) > 120 || a(x + 1, y + 1) > 120 || a(x + 1, y - 1) > 120 || a(x - 1, y + 1) > 120));
      if (n) this.set(x, y, c);
    }
    return this;
  }
  blit(src: PC, dx: number, dy: number, flipX = false, alphaMul = 1) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.get(flipX ? src.w - 1 - x : x, y)!;
      if (c[3] === 0) continue;
      this.set(dx + x, dy + y, alphaMul < 1 ? withA(c, c[3] * alphaMul) : c);
    }
  }
  /** Поворот вокруг опорной точки (ближайший сосед), результат того же размера. */
  rotated(angle: number, px: number, py: number, ox = 0, oy = 0): PC {
    const out = new PC(this.w, this.h);
    const ca = Math.cos(-angle), sa = Math.sin(-angle);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const rx = x + 0.5 - px - ox, ry = y + 0.5 - py - oy;
      const sx = Math.floor(px + rx * ca - ry * sa), sy = Math.floor(py + rx * sa + ry * ca);
      const c = this.get(sx, sy);
      if (c && c[3]) out.set(x, y, c);
    }
    return out;
  }
  /** Затемнение всего изображения (для вариантов). */
  map(fn: (c: RGBA, x: number, y: number) => RGBA) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.get(x, y)!;
      if (c[3] === 0) continue;
      const n = fn(c, x, y);
      const i = (y * this.w + x) * 4;
      this.data[i] = n[0]; this.data[i + 1] = n[1]; this.data[i + 2] = n[2]; this.data[i + 3] = n[3];
    }
    return this;
  }
  clone(): PC {
    const p = new PC(this.w, this.h);
    p.data.set(this.data);
    return p;
  }
  save(file: string) {
    const png = new PNG({ width: this.w, height: this.h });
    Buffer.from(this.data.buffer).copy(png.data);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(png));
  }
}

/** Склейка кадров в лист: frames[row][col]. */
export function sheet(frames: PC[][], fw: number, fh: number): PC {
  const cols = Math.max(...frames.map((r) => r.length));
  const out = new PC(cols * fw, frames.length * fh);
  frames.forEach((row, j) => row.forEach((f, i) => out.blit(f, i * fw, j * fh)));
  return out;
}
