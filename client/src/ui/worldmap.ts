/** Полная карта мира: масштаб и перетаскивание, подписи с плотностью по масштабу, маркер героя, подсказки, легенда. */
import { CITIES, cityKnown } from "../../../shared/cities";
import { factionColor } from "../../../shared/factions";
import { TILE } from "../../../shared/constants";
import { PLACES, ZONES, isTownZone, type WorldMap } from "../../../shared/map";
import world from "../../../data/world.json";

const FONT = `"Pixelify Sans", "Rubik", system-ui, sans-serif`;
const KIND_NAME: Record<string, string> = { village: "Деревня", camp: "Лагерь", ruins: "Руины", meeting: "Место встречи" };
const KIND_COLOR: Record<string, string> = { village: "#e8d8a8", camp: "#e0705a", ruins: "#b8a8d8", meeting: "#8ad8c8" };
const ROADS = Object.entries(world.roads as unknown as Record<string, unknown>).filter(([k]) => k !== "_doc").map(([, v]) => v as [number, number][]);
const RIVERS = Object.entries(world.rivers as unknown as Record<string, { width: number; path: [number, number][] }>).filter(([k]) => k !== "_doc").map(([name, r]) => ({ name, ...r }));
const SIGNS = (world.signs.list as { x: number; y: number; text: string }[]);
const GRID = 24;

interface Label { x: number; y: number; text: string }
interface Hit { x: number; y: number; r: number; title: string; sub: string }

export class WorldMapView {
  readonly root = document.createElement("div");
  private cv = document.createElement("canvas");
  private tip = document.createElement("div");
  private wrap = document.createElement("div");
  private s = 1; // px на тайл
  private cx = 0; private cy = 0; // центр вида, тайлы
  private fit = 1;
  private W = 0; private H = 0;
  private zoneLabels: Label[] = [];
  private bridges: { x: number; y: number }[] = [];
  private hits: Hit[] = [];
  private mouse: { x: number; y: number } | null = null;
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private raf = 0;
  private face = Math.PI / 2;
  private prev: { x: number; y: number } | null = null;
  private inited = false;

  constructor(private map: WorldMap, private base: () => HTMLCanvasElement | null, private getPos: () => { x: number; y: number }, private getKnown: () => { known?: string[]; faction?: string }, private win: HTMLElement) {
    this.root.className = "wm";
    const bar = document.createElement("div");
    bar.className = "wm-bar";
    const btn = (t: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "btn wm-btn";
      b.textContent = t;
      b.title = title;
      b.onclick = fn;
      bar.append(b);
    };
    btn("+", "Приблизить", () => this.zoomAt(1.5, this.W / 2, this.H / 2));
    btn("−", "Отдалить", () => this.zoomAt(1 / 1.5, this.W / 2, this.H / 2));
    btn("Сброс", "Показать весь мир", () => this.reset());
    btn("Центрировать на мне", "Перейти к герою", () => this.centerMe());
    const leg = document.createElement("div");
    leg.className = "wm-legend";
    leg.innerHTML = `<i style="background:#fff;border-color:#e84a4a"></i>Вы <i style="background:#f0c050"></i>Город <i style="background:${KIND_COLOR.village}"></i>Деревня <i style="background:${KIND_COLOR.camp}"></i>Лагерь <i style="background:${KIND_COLOR.ruins}"></i>Руины <i class="road"></i>Дорога <i class="river"></i>Река <i style="background:${factionColor("solgard")}"></i>Сольгард <i style="background:${factionColor("umbrath")}"></i>Умбрат`;
    bar.append(leg);
    this.wrap.className = "wm-view";
    this.tip.className = "wm-tip";
    this.tip.hidden = true;
    this.wrap.append(this.cv, this.tip);
    this.root.append(bar, this.wrap);
    this.buildZoneLabels();
    for (const o of map.objects) if (o.kind === "bridge_h" || o.kind === "bridge_v") this.bridges.push({ x: o.x / TILE, y: o.y / TILE });

    new ResizeObserver(() => this.resize()).observe(this.wrap);
    const cv = this.cv;
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false };
    });
    cv.addEventListener("pointermove", (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      const d = this.drag;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        this.cx = d.cx - dx / this.s;
        this.cy = d.cy - dy / this.s;
        this.clamp();
      }
    });
    cv.addEventListener("pointerup", () => (this.drag = null));
    cv.addEventListener("pointerleave", () => { this.mouse = null; });
    cv.addEventListener("dblclick", (e) => {
      const r = cv.getBoundingClientRect();
      this.zoomAt(2, e.clientX - r.left, e.clientY - r.top);
    });
  }

  /** Зоны: блоки GRID×GRID по большинству, связные куски получают подпись. */
  private buildZoneLabels() {
    const m = this.map;
    if (m.w <= 200) return;
    const gw = Math.ceil(m.w / GRID), gh = Math.ceil(m.h / GRID);
    const zone = new Int16Array(gw * gh).fill(-1);
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      const cnt = new Map<number, number>();
      for (let y = by * GRID; y < Math.min(m.h, (by + 1) * GRID); y += 3) for (let x = bx * GRID; x < Math.min(m.w, (bx + 1) * GRID); x += 3) {
        const z = m.zone[y * m.w + x];
        cnt.set(z, (cnt.get(z) ?? 0) + 1);
      }
      let best = -1, bn = 0;
      for (const [z, n] of cnt) if (n > bn) { best = z; bn = n; }
      zone[by * gw + bx] = best;
    }
    const seen = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      if (seen[i] || zone[i] < 0) continue;
      const z = zone[i], st = [i], comp: number[] = [];
      seen[i] = 1;
      while (st.length) {
        const c = st.pop()!;
        comp.push(c);
        const x = c % gw, y = (c / gw) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx;
          if (!seen[j] && zone[j] === z) { seen[j] = 1; st.push(j); }
        }
      }
      if (comp.length < 4 || isTownZone(z) || z === 6) continue;
      let mx = 0, my = 0;
      for (const c of comp) { mx += c % gw; my += (c / gw) | 0; }
      mx /= comp.length; my /= comp.length;
      let bc = comp[0], bd = 1e9;
      for (const c of comp) { const d = Math.hypot((c % gw) - mx, ((c / gw) | 0) - my); if (d < bd) { bd = d; bc = c; } }
      const zi = ZONES[z];
      this.zoneLabels.push({ x: ((bc % gw) + 0.5) * GRID, y: (((bc / gw) | 0) + 0.5) * GRID, text: zi.name });
    }
  }

  open() {
    this.resize();
    if (!this.inited) { this.reset(); this.inited = true; }
    this.prev = null;
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (this.win.hidden) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (w < 10 || h < 10) return;
    const dpr = window.devicePixelRatio || 1;
    this.W = w; this.H = h;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.fit = Math.min(w / this.map.w, h / this.map.h);
    if (this.s < this.fit) this.s = this.fit;
    this.clamp();
  }
  private reset() {
    this.s = this.fit;
    this.cx = this.map.w / 2; this.cy = this.map.h / 2;
    this.clamp();
  }
  private centerMe() {
    const p = this.getPos();
    this.s = Math.max(this.s, this.fit * 2.5, 3);
    this.cx = p.x / TILE; this.cy = p.y / TILE;
    this.clamp();
  }
  private zoomAt(f: number, px: number, py: number) {
    const wx = this.cx + (px - this.W / 2) / this.s, wy = this.cy + (py - this.H / 2) / this.s;
    this.s = Math.max(this.fit, Math.min(14, this.s * f));
    this.cx = wx - (px - this.W / 2) / this.s;
    this.cy = wy - (py - this.H / 2) / this.s;
    this.clamp();
  }
  private clamp() {
    const hw = this.W / 2 / this.s, hh = this.H / 2 / this.s;
    this.cx = hw * 2 >= this.map.w ? this.map.w / 2 : Math.max(hw, Math.min(this.map.w - hw, this.cx));
    this.cy = hh * 2 >= this.map.h ? this.map.h / 2 : Math.max(hh, Math.min(this.map.h - hh, this.cy));
  }

  private draw() {
    if (!this.W) return;
    const m = this.map, s = this.s, dpr = window.devicePixelRatio || 1;
    const g = this.cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0e0b10";
    g.fillRect(0, 0, this.W, this.H);
    const X = (tx: number) => this.W / 2 + (tx - this.cx) * s, Y = (ty: number) => this.H / 2 + (ty - this.cy) * s;
    g.imageSmoothingEnabled = false;
    const base = this.base();
    if (base) g.drawImage(base, X(0), Y(0), m.w * s, m.h * s);
    const big = m.w > 200;
    // реки и дороги
    if (big) {
      g.lineCap = "round"; g.lineJoin = "round";
      for (const r of RIVERS) {
        g.strokeStyle = "rgba(70,140,220,0.8)";
        g.lineWidth = Math.max(2, r.width * 2 * s);
        g.beginPath();
        r.path.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
        g.stroke();
      }
      g.strokeStyle = "rgba(240,215,150,0.85)";
      g.lineWidth = Math.max(1.2, s * 0.9);
      for (const road of ROADS) {
        g.beginPath();
        road.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
        g.stroke();
      }
      for (const b of this.bridges) {
        g.fillStyle = "#7a4a22";
        g.fillRect(X(b.x) - 3, Y(b.y) - 3, 6, 6);
        g.strokeStyle = "#e8c890";
        g.lineWidth = 1;
        g.strokeRect(X(b.x) - 3, Y(b.y) - 3, 6, 6);
      }
    }
    // виньетка границы мира
    g.strokeStyle = "#5a4a38";
    g.lineWidth = 2;
    g.strokeRect(X(0), Y(0), m.w * s, m.h * s);

    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const hits: Hit[] = [];
    const label = (text: string, x: number, y: number, size: number, fill: string, weight = 600): boolean => {
      g.font = `${weight} ${size}px ${FONT}`;
      const w = g.measureText(text).width;
      const r = { x0: x - w / 2 - 2, y0: y - size, x1: x + w / 2 + 2, y1: y + 2 };
      if (r.x1 < 0 || r.x0 > this.W || r.y1 < 0 || r.y0 > this.H) return false;
      if (placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) return false;
      placed.push(r);
      g.lineWidth = 4;
      g.strokeStyle = "rgba(14,10,16,0.92)";
      g.lineJoin = "round";
      g.strokeText(text, x, y);
      g.fillStyle = fill;
      g.fillText(text, x, y);
      return true;
    };
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const { known, faction } = this.getKnown();
    // города (приоритет 1)
    if (big) for (const c of CITIES) {
      const x = X(c.x), y = Y(c.y);
      const open = !known || cityKnown(c, known, faction);
      const col = c.capital ? factionColor(c.capital) : open ? "#f0c050" : "#8a8290";
      const r = (c.capital ? 7 : 5.5) + Math.min(4, s * 0.4);
      g.fillStyle = "#120a10";
      g.fillRect(x - r - 1.5, y - r - 1.5, r * 2 + 3, r * 2 + 3);
      g.fillStyle = col;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      if (c.capital) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(x - r, y - r, r * 2, r * 2); }
      label(open || c.capital ? c.name : "???", x, y - r - 5, c.capital ? 17 : 15, c.capital ? col : open ? "#ffe08a" : "#a8a0b0");
      hits.push({ x, y, r: r + 4, title: open || c.capital ? c.name : "Неизвестный город", sub: open || c.capital ? (c.capital ? "Столица фракции" : "Город") + " · безопасно" : "Ещё не открыт" });
    }
    // названия рек
    if (big && s >= 1) for (const r of RIVERS) {
      const mid = r.path[Math.floor(r.path.length / 2)];
      label(`р. ${r.name}`, X(mid[0]), Y(mid[1]), 12, "#9ac4f0", 500);
    }
    // поселения по приоритету и масштабу
    if (big) {
      const minS: Record<string, number> = { village: 0.9, meeting: 1.8, camp: 2.6, ruins: 2.2 };
      const order = ["village", "meeting", "ruins", "camp"];
      for (const kind of order) for (const p of PLACES) {
        if (p.kind !== kind) continue;
        const x = X(p.x), y = Y(p.y);
        if (x < -20 || y < -20 || x > this.W + 20 || y > this.H + 20) continue;
        const zi = ZONES[m.zone[Math.min(m.h - 1, p.y) * m.w + Math.min(m.w - 1, p.x)]];
        const sub = `${KIND_NAME[p.kind]}${zi ? ` · ${zi.safe ? "безопасно" : zi.note ? "дикие края" : `ур. ${zi.levels[0]}–${zi.levels[1]}`}` : ""}`;
        const sz = p.kind === "village" ? 4 : 3;
        g.fillStyle = "#120a10";
        g.fillRect(x - sz - 1, y - sz - 1, sz * 2 + 2, sz * 2 + 2);
        g.fillStyle = KIND_COLOR[p.kind];
        if (p.kind === "village") g.fillRect(x - sz, y - sz, sz * 2, sz * 2);
        else { g.beginPath(); g.moveTo(x, y - sz - 1); g.lineTo(x + sz + 1, y + sz); g.lineTo(x - sz - 1, y + sz); g.closePath(); g.fill(); }
        if (s >= minS[p.kind]) label(p.name, x, y - sz - 5, p.kind === "village" ? 13 : 11, KIND_COLOR[p.kind], 500);
        hits.push({ x, y, r: sz + 5, title: p.name, sub });
      }
      // указатели
      if (s >= 4) for (const sg of SIGNS) {
        const x = X(sg.x), y = Y(sg.y);
        g.fillStyle = "#c89a52";
        g.fillRect(x - 2, y - 4, 4, 8);
        hits.push({ x, y, r: 8, title: "Указатель", sub: sg.text });
      }
      // зоны
      const za = s < 3 ? 0.75 : s < 6 ? 0.5 : 0.28;
      g.globalAlpha = za;
      for (const z of this.zoneLabels) label(z.text.toUpperCase(), X(z.x), Y(z.y), s < 3 ? 15 : 18, "#ffffff", 600);
      g.globalAlpha = 1;
    }
    this.hits = hits;
    this.drawHero(g, X, Y);
    this.drawTip();
  }

  private drawHero(g: CanvasRenderingContext2D, X: (t: number) => number, Y: (t: number) => number) {
    const p = this.getPos(), tx = p.x / TILE, ty = p.y / TILE;
    if (this.prev) {
      const dx = tx - this.prev.x, dy = ty - this.prev.y;
      if (dx * dx + dy * dy > 0.0004) this.face = Math.atan2(dy, dx);
    }
    this.prev = { x: tx, y: ty };
    const x = X(tx), y = Y(ty);
    const t = performance.now() / 1000;
    const ph = (t % 1.4) / 1.4;
    g.strokeStyle = `rgba(255,90,70,${0.9 * (1 - ph)})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, 8 + ph * 26, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(255,90,70,0.25)";
    g.beginPath();
    g.arc(x, y, 14, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(x, y);
    g.rotate(this.face);
    g.fillStyle = "#fff";
    g.strokeStyle = "#d81818";
    g.lineWidth = 2.5;
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(14, 0); g.lineTo(-8, -9); g.lineTo(-3, 0); g.lineTo(-8, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // подпись «Вы» и выход за экран — стрелка к герою
    if (x < 0 || y < 0 || x > this.W || y > this.H) {
      const ax = Math.max(18, Math.min(this.W - 18, x)), ay = Math.max(18, Math.min(this.H - 18, y));
      g.save();
      g.translate(ax, ay);
      g.rotate(Math.atan2(y - ay, x - ax));
      g.fillStyle = "#ff5a46";
      g.strokeStyle = "#fff";
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, -9); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
      g.restore();
    } else {
      g.font = `600 13px ${FONT}`;
      g.textAlign = "center";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(14,10,16,0.92)";
      g.strokeText("Вы", x, y + 32);
      g.fillStyle = "#fff";
      g.fillText("Вы", x, y + 32);
    }
  }

  private drawTip() {
    const mp = this.mouse;
    let h: Hit | null = null;
    if (mp && !this.drag?.moved) {
      let bd = 1e9;
      for (const c of this.hits) {
        const d = Math.hypot(c.x - mp.x, c.y - mp.y);
        if (d <= c.r + 4 && d < bd) { bd = d; h = c; }
      }
    }
    if (!h || !mp) { this.tip.hidden = true; return; }
    if (this.tip.dataset.k !== h.title + h.sub) {
      this.tip.dataset.k = h.title + h.sub;
      this.tip.replaceChildren();
      const b = document.createElement("b");
      b.textContent = h.title;
      const sp = document.createElement("span");
      sp.textContent = h.sub;
      this.tip.append(b, sp);
    }
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    this.tip.style.left = `${Math.max(4, Math.min(this.W - tw - 4, mp.x + 14))}px`;
    this.tip.style.top = `${Math.max(4, Math.min(this.H - th - 4, mp.y + 14))}px`;
  }
}
