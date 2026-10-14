/**
 * Жители Эмберхолла на сервере: стражники (посты у ворот и патрули по улицам) и горожане.
 * Синхронизируются юнитами в state.mobs (kind Guard/Citizen), позиция пишется в схему не чаще SYNC_MS —
 * клиент плавно доводит. Стражники неуязвимы, с игроками не воюют и добивают мобов у стен.
 */
import data from "../../../data/townfolk.json";
import { TILE } from "../../../shared/constants";
import { moveWithCollision, townDist } from "../../../shared/map";
import { Nav } from "../../../shared/path";
import { Anim, Dir, UnitKind } from "../../../shared/protocol";
import { CITIZEN_COUNT, CITIZEN_SPOTS, GATE_GUARDS, GUARD_RANGE_TILES, PATROLS, TOWN, WALL } from "../../../shared/town";
import { Unit } from "../rooms/schema";
import type { Mob } from "./Mob";
import type { World } from "./World";

const dirTo = (dx: number, dy: number): Dir => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down);

const SYNC_MS = 200;
const R = 8;
const G = data.guard, C = data.citizen;
/** Клетка-смещение от TOWN → центр клетки в пикселях. */
const cellPx = (dx: number, dy: number) => ({ x: (TOWN.x + dx) * TILE + 16, y: (TOWN.y + dy) * TILE + 16 });
/** Точка маршрута (уже с .5 у центра клетки) → пиксели. */
const ptPx = (dx: number, dy: number) => ({ x: (TOWN.x + dx) * TILE, y: (TOWN.y + dy) * TILE });
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Folk {
  id: string;
  unit: Unit;
  guard: boolean;
  x: number;
  y: number;
  dir: Dir;
  anim: Anim;
  nav: Nav;
  /** Пост (у ворот) или null у патрульных и горожан. */
  post: { x: number; y: number; dir: Dir } | null;
  route: { x: number; y: number }[];
  idx: number;
  waitUntil: number;
  foe: Mob | null;
  attackAt: number;
  sayAt: number;
  syncAt: number;
}

export class Townfolk {
  readonly folk: Folk[] = [];
  private scanAt = 0;
  private n = 0;

  constructor(private w: World) {
    for (const [dx, dy] of GATE_GUARDS) {
      const p = cellPx(dx, dy);
      // смотрят наружу: на западе — влево, на востоке — вправо, у северных и южных ворот — к зрителю
      const dir = Math.abs(dx) >= WALL.x - 2 ? (dx < 0 ? Dir.Left : Dir.Right) : Dir.Down;
      this.add(true, p.x, p.y, { ...p, dir }, []);
    }
    for (const r of PATROLS) {
      const route = r.map(([dx, dy]) => ptPx(dx, dy));
      this.add(true, route[0].x, route[0].y, null, route);
    }
    const spots = CITIZEN_SPOTS.map(([dx, dy]) => cellPx(dx, dy));
    for (let i = 0; i < CITIZEN_COUNT; i++) {
      const s = spots[(i * 7) % spots.length];
      const f = this.add(false, s.x, s.y, null, spots, C.people[i % C.people.length]);
      f.idx = (i * 7) % spots.length;
      f.waitUntil = rnd(500, 6000);
    }
  }

  private add(guard: boolean, x: number, y: number, post: Folk["post"], route: Folk["route"], who?: { name: string; sprite: string }): Folk {
    const u = new Unit();
    u.kind = guard ? UnitKind.Guard : UnitKind.Citizen;
    u.name = guard ? G.name : who!.name;
    u.sprite = guard ? G.sprite : who!.sprite;
    u.level = guard ? G.level : 1;
    u.hp = u.maxHp = 1;
    u.x = x;
    u.y = y;
    u.dir = post?.dir ?? Dir.Down;
    const f: Folk = { id: `${guard ? "g" : "c"}${++this.n}`, unit: u, guard, x, y, dir: u.dir, anim: Anim.Idle, nav: new Nav(), post, route, idx: 0, waitUntil: 0, foe: null, attackAt: 0, sayAt: 0, syncAt: 0 };
    this.folk.push(f);
    this.w.state.mobs.set(f.id, u);
    return f;
  }

  /** Моб угрожает городу: живой, не босс и в пределах GUARD_RANGE_TILES от стен. */
  private threat(m: Mob) {
    return !m.dead && !m.def.boss && townDist(m.x / TILE, m.y / TILE) <= GUARD_RANGE_TILES;
  }

  update(dt: number) {
    const t = this.w.time;
    if (t >= this.scanAt) {
      this.scanAt = t + 400;
      this.assignFoes();
    }
    for (const f of this.folk) {
      if (f.guard) this.updateGuard(f, dt);
      else this.updateCitizen(f, dt);
      // редкая синхронизация позиции; анимация и взгляд — вместе с ней
      if (t >= f.syncAt) {
        f.syncAt = t + SYNC_MS;
        const u = f.unit;
        if (u.x !== f.x) u.x = f.x;
        if (u.y !== f.y) u.y = f.y;
        if (u.dir !== f.dir) u.dir = f.dir;
        if (u.anim !== f.anim) u.anim = f.anim;
      }
    }
  }

  private assignFoes() {
    const guards = this.folk.filter((f) => f.guard);
    for (const g of guards) if (g.foe && (!this.threat(g.foe) || g.foe.state === "return")) g.foe = null;
    for (const m of this.w.mobs.values()) {
      if (!this.threat(m) || guards.some((g) => g.foe === m)) continue;
      let best: Folk | null = null, bd = Infinity;
      for (const g of guards) {
        if (g.foe) continue;
        const d = Math.hypot(g.x - m.x, g.y - m.y);
        if (d < bd) { bd = d; best = g; }
      }
      if (!best) break;
      best.foe = m;
      best.nav.reset();
      if (this.w.time >= best.sayAt) {
        best.sayAt = this.w.time + 20000;
        this.w.emit({ t: "say", id: best.id, text: G.lines[Math.floor(Math.random() * G.lines.length)] });
      }
    }
  }

  private step(f: Folk, gx: number, gy: number, speed: number, dt: number, stopAt: number): boolean {
    const d0 = Math.hypot(gx - f.x, gy - f.y);
    if (d0 <= stopAt) return false;
    const wp = f.nav.next(this.w.map, f.x, f.y, gx, gy, R, this.w.time);
    if (!wp) return false;
    const final = wp.x === gx && wp.y === gy;
    const dx = wp.x - f.x, dy = wp.y - f.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(speed * dt, final ? d - stopAt : d);
    if (sp <= 0) return false;
    const n = moveWithCollision(this.w.map, f.x, f.y, (dx / d) * sp, (dy / d) * sp, R);
    const moved = Math.abs(n.x - f.x) + Math.abs(n.y - f.y) > 0.01;
    f.x = Math.round(n.x * 10) / 10;
    f.y = Math.round(n.y * 10) / 10;
    f.dir = dirTo(dx, dy);
    return moved;
  }

  private updateGuard(f: Folk, dt: number) {
    const t = this.w.time;
    let moving = false;
    const m = f.foe;
    if (m && !m.dead) {
      const reach = G.attackRange + m.def.radius;
      const d = Math.hypot(m.x - f.x, m.y - f.y);
      if (d > reach) moving = this.step(f, m.x, m.y, G.chaseSpeed, dt, reach - 8);
      else if (t >= f.attackAt) {
        f.attackAt = t + G.attackMs;
        f.dir = dirTo(m.x - f.x, m.y - f.y);
        f.unit.dir = f.dir;
        f.unit.aseq = (f.unit.aseq + 1) % 65535;
        this.w.later(160, () => {
          if (m.dead) return;
          const v = Math.max(G.minHit, Math.round(m.unit.maxHp * G.hitPct));
          this.w.emit({ t: "dmg", id: m.id, v, k: "phys" });
          this.w.applyDamage(m, v);
        });
      }
    } else {
      f.foe = null;
      if (f.post) {
        moving = this.step(f, f.post.x, f.post.y, G.patrolSpeed * 1.6, dt, 1);
        if (!moving && Math.hypot(f.post.x - f.x, f.post.y - f.y) < 4) f.dir = f.post.dir;
      } else if (t >= f.waitUntil) {
        const p = f.route[f.idx];
        moving = this.step(f, p.x, p.y, G.patrolSpeed, dt, 2);
        if (!moving) {
          f.idx = (f.idx + 1) % f.route.length;
          f.waitUntil = t + rnd(800, 2500);
        }
      }
    }
    f.anim = moving ? Anim.Walk : Anim.Idle;
  }

  private updateCitizen(f: Folk, dt: number) {
    const t = this.w.time;
    let moving = false;
    if (t >= f.waitUntil) {
      const p = f.route[f.idx];
      moving = this.step(f, p.x, p.y, C.speed, dt, 2);
      if (!moving) {
        let next = Math.floor(Math.random() * f.route.length);
        if (next === f.idx) next = (next + 1) % f.route.length;
        f.idx = next;
        f.nav.reset();
        f.waitUntil = t + rnd(C.waitMs[0], C.waitMs[1]);
        f.dir = Dir.Down;
      }
    }
    f.anim = moving ? Anim.Walk : Anim.Idle;
  }
}

