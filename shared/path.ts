/** Поиск пути A* по клеткам карты (8 направлений, без срезания углов) и сглаживание по прямой видимости. */
import { TILE } from "./constants";
import { CELL_BLOCK, walkable, type WorldMap } from "./map";

/** Проходима ли прямая для круга радиуса r (проверка шагами по 8 px). */
export function segmentWalkable(m: WorldMap, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!walkable(m, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return false;
  }
  return true;
}

class Heap {
  a: number[] = [];
  f: Float64Array;
  constructor(size: number) {
    this.f = new Float64Array(size);
  }
  push(i: number) {
    const a = this.a;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let s = k;
        if (l < a.length && this.f[a[l]] < this.f[a[s]]) s = l;
        if (r < a.length && this.f[a[r]] < this.f[a[s]]) s = r;
        if (s === k) break;
        [a[s], a[k]] = [a[k], a[s]];
        k = s;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/**
 * Путь от (sx,sy) к (tx,ty) в пикселях. Возвращает точки (без стартовой) или null.
 * Если цель в непроходимой клетке — идём к ближайшей достигнутой клетке.
 */
export function findPath(m: WorldMap, sx: number, sy: number, tx: number, ty: number, r: number, maxNodes = 6000): { x: number; y: number }[] | null {
  const W = m.w, H = m.h;
  const s = Math.floor(sy / TILE) * W + Math.floor(sx / TILE);
  const tcx = Math.floor(tx / TILE), tcy = Math.floor(ty / TILE);
  const goal = tcy * W + tcx;
  const open = (i: number) => !(m.cell[i] & CELL_BLOCK);
  const g = new Map<number, number>();
  const from = new Map<number, number>();
  const heap = new Heap(W * H);
  const h = (i: number) => {
    const dx = Math.abs((i % W) - tcx), dy = Math.abs(Math.floor(i / W) - tcy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  g.set(s, 0);
  heap.f[s] = h(s);
  heap.push(s);
  let best = s, bestH = h(s), expanded = 0;
  const closed = new Set<number>();
  while (heap.size) {
    const cur = heap.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (cur === goal) { best = cur; break; }
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    if (++expanded > maxNodes) break;
    const cx = cur % W, cy = Math.floor(cur / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!open(n) && n !== goal) continue;
      if (!open(n)) continue;
      if (dx && dy && (!open(cy * W + nx) || !open(ny * W + cx))) continue;
      const ng = g.get(cur)! + (dx && dy ? 1.414 : 1);
      if (ng < (g.get(n) ?? Infinity)) {
        g.set(n, ng);
        from.set(n, cur);
        heap.f[n] = ng + h(n);
        heap.push(n);
      }
    }
  }
  if (best === s) return null;
  const cells: number[] = [];
  for (let c = best; c !== s; c = from.get(c)!) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: (c % W) * TILE + TILE / 2, y: Math.floor(c / W) * TILE + TILE / 2 }));
  if (best === goal && walkable(m, tx, ty, r)) pts[pts.length - 1] = { x: tx, y: ty };
  // сглаживание: выкидываем точки, до которых видно по прямой
  const out: { x: number; y: number }[] = [];
  let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !segmentWalkable(m, ax, ay, pts[j].x, pts[j].y, r)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}

/** Навигация юнита: прямо, если видно, иначе по пути A* (пересчёт при смещении цели или раз в 0,8 с). */
export class Nav {
  path: { x: number; y: number }[] = [];
  goal: { x: number; y: number } | null = null;
  at = -1e9;

  reset() {
    this.path = [];
    this.goal = null;
  }

  next(m: WorldMap, x: number, y: number, gx: number, gy: number, r: number, now: number): { x: number; y: number } | null {
    if (segmentWalkable(m, x, y, gx, gy, r)) {
      this.path = [];
      return { x: gx, y: gy };
    }
    const moved = !this.goal || Math.hypot(this.goal.x - gx, this.goal.y - gy) > 40;
    if (moved || !this.path.length || now - this.at > 800) {
      this.goal = { x: gx, y: gy };
      this.at = now;
      this.path = findPath(m, x, y, gx, gy, r) ?? [];
    }
    while (this.path.length && Math.hypot(this.path[0].x - x, this.path[0].y - y) < 6) this.path.shift();
    // срезаем путь, если следующая точка уже видна
    while (this.path.length > 1 && segmentWalkable(m, x, y, this.path[1].x, this.path[1].y, r)) this.path.shift();
    return this.path[0] ?? null;
  }
}
