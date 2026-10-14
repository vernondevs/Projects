/** Игровой мир: вся симуляция на сервере. Комната Colyseus только передаёт сюда сообщения. */
import { MAP_SEED, PLAYER_RADIUS, PLAYER_SPEED, RESPAWN_DELAY_MS, TICK_MS } from "../../../shared/constants";
import { armorReduction } from "../../../shared/formulas";
import { PVP_DAMAGE_MULT } from "../../../shared/arena";
import { generateMap, lineClear, moveWithCollision, zoneAtPx, Zone, type WorldMap } from "../../../shared/map";
import { ELITE } from "../../../shared/elites";
import { MOBS } from "../../../shared/mobs";
import {
  Anim, BUFF_BURN, BUFF_HASTE, BUFF_POISON, BUFF_ROOT, BUFF_SLOW, BUFF_STUN, BUFF_WARCRY, Dir,
  type ChatLine, type Fx, type FxKind,
} from "../../../shared/protocol";
import type { WorldState } from "../rooms/schema";
import { createBoss } from "./bosses";
import { grantKillRewards } from "./rewards";
import { Mob } from "./Mob";
import type { Player } from "./Player";

export type Broadcast = (type: string, msg: unknown) => void;
export type Actor = Player | Mob;

export interface HitOpts {
  kind?: FxKind;
  /** Множитель к урону оружия (для умений). */
  mult?: number;
  /** Фиксированный урон (у мобов и ловушек). */
  flat?: number;
  canCrit?: boolean;
  skill?: boolean;
  threat?: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export interface WorldOptions {
  /** Своя карта (арена); по умолчанию — карта мира. */
  map?: WorldMap;
  /** Создавать мобов и боссов. */
  mobs?: boolean;
  /** Не писать в чат о входе и выходе игроков. */
  quiet?: boolean;
}

export class World {
  readonly map: WorldMap;
  /** PvP включено: игроки разных команд (team) враждебны. Включает арена на время боя. */
  pvpActive = false;
  onDamage?: (src: Actor, dst: Actor, v: number) => void;
  onHeal?: (p: Player, v: number) => void;
  onPlayerKilled?: (p: Player, killer?: Actor) => void;
  readonly players = new Map<string, Player>();
  readonly mobs = new Map<string, Mob>();
  /** Кто и когда последним убил босса (id моба → запись); для городских слухов. */
  readonly bossKills = new Map<string, { by: string; at: number }>();
  /** Время симуляции в мс (растёт только в тиках). */
  time = 0;
  private fx: Fx[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private nextId = 1;
  /** Постоянные зоны урона (лужи яда, огонь). */
  hazards: { id: string; x: number; y: number; r: number; until: number; dps: number; kind: FxKind; owner: Mob; tickAt: number }[] = [];

  constructor(
    readonly state: WorldState,
    readonly broadcast: Broadcast,
    readonly opts: WorldOptions = {},
  ) {
    this.map = opts.map ?? generateMap(MAP_SEED);
    if (opts.mobs !== false) this.spawnAll();
  }

  // ---------- инфраструктура ----------
  emit(fx: Fx) {
    this.fx.push(fx);
  }
  later(ms: number, fn: () => void) {
    this.timers.push({ at: this.time + ms, fn });
  }
  chat(line: ChatLine) {
    this.broadcast("chat", line);
  }
  system(text: string) {
    this.chat({ from: "", text, sys: true });
  }
  uid(prefix: string) {
    return `${prefix}${(this.nextId++).toString(36)}`;
  }

  addPlayer(p: Player, note = `${p.name} входит в мир.`) {
    this.players.set(p.id, p);
    this.state.players.set(p.id, p.unit);
    if (!this.opts.quiet) this.system(note);
  }
  removePlayer(id: string, note?: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.state.players.delete(id);
    for (const m of this.mobs.values()) {
      m.threat.delete(id);
      if (m.targetId === id) m.targetId = null;
    }
    if (!this.opts.quiet) this.system(note ?? `${p.name} покидает мир.`);
  }
  findByName(nameKey: string): Player | undefined {
    for (const p of this.players.values()) if (p.name.toLowerCase() === nameKey) return p;
    return undefined;
  }
  actor(id: string | null | undefined): Actor | undefined {
    if (!id) return undefined;
    return this.mobs.get(id) ?? this.players.get(id);
  }
  isPlayer(a: Actor): a is Player {
    return "save" in a;
  }
  /** Враждебны ли двое: игрок и моб — всегда, игроки — только на арене во время боя и в разных командах. */
  hostile(a: Actor, b: Actor): boolean {
    if (a === b) return false;
    const pa = this.isPlayer(a), pb = this.isPlayer(b);
    if (pa !== pb) return true;
    if (!pa || !pb) return false;
    return this.pvpActive && a.team !== 0 && b.team !== 0 && a.team !== b.team;
  }
  /** Живые враги в круге: мобы и враждебные игроки. */
  enemiesInCircle(src: Actor, x: number, y: number, r: number): Actor[] {
    const out: Actor[] = this.mobsInCircle(x, y, r);
    if (this.pvpActive) for (const p of this.playersInCircle(x, y, r)) if (this.hostile(src, p)) out.push(p);
    return out;
  }

  // ---------- мобы ----------
  private spawnAll() {
    for (const s of this.map.spawns) {
      const def = MOBS[s.mob];
      if (!def) continue;
      const mob = new Mob(this.uid("m"), def, s.level, { x: s.x, y: s.y });
      mob.rollElite();
      this.addMob(mob);
    }
    for (const b of this.map.bosses) {
      const def = MOBS[b.id];
      const m = new Mob(this.uid("b"), def, def.level!, { x: b.x, y: b.y });
      m.boss = createBoss(this, m, b.arena);
      this.addMob(m);
    }
  }
  addMob(m: Mob) {
    this.mobs.set(m.id, m);
    this.state.mobs.set(m.id, m.unit);
    return m;
  }
  removeMob(m: Mob) {
    this.mobs.delete(m.id);
    this.state.mobs.delete(m.id);
  }

  // ---------- цикл ----------
  update(dtMs: number) {
    const dt = Math.min(dtMs, TICK_MS * 3) / 1000;
    this.time += dtMs;
    this.runTimers();
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    for (const m of this.mobs.values()) this.updateMob(m, dt);
    this.updateHazards();
    this.flush();
  }

  private runTimers() {
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.time);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) {
      try {
        t.fn();
      } catch (e) {
        console.error("[timer]", e);
      }
    }
  }

  private flush() {
    if (this.fx.length) {
      this.broadcast("fx", this.fx);
      this.fx = [];
    }
    for (const p of this.players.values()) {
      if (p.selfDirty) {
        p.selfDirty = false;
        p.send("self", p.selfState());
      }
      if (p.bagsDirty) {
        p.bagsDirty = false;
        p.send("loot", [...p.bags.values()]);
      }
    }
  }

  // ---------- общие расчёты ----------
  static dirTo(dx: number, dy: number): Dir {
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
  }
  dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  inTown(x: number, y: number) {
    return zoneAtPx(this.map, x, y) === Zone.Town;
  }
  radiusOf(a: Actor) {
    return this.isPlayer(a) ? PLAYER_RADIUS : a.def.radius;
  }

  /** Мобы в круге (живые). */
  mobsInCircle(x: number, y: number, r: number): Mob[] {
    const out: Mob[] = [];
    for (const m of this.mobs.values()) if (!m.dead && Math.hypot(m.x - x, m.y - y) <= r + m.def.radius) out.push(m);
    return out;
  }
  playersInCircle(x: number, y: number, r: number): Player[] {
    const out: Player[] = [];
    for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.y - y) <= r + PLAYER_RADIUS) out.push(p);
    return out;
  }

  /** Нанесение урона с бронёй, критом, вампиризмом и наградой за убийство. */
  hit(src: Actor, dst: Actor, o: HitOpts = {}): number {
    if (this.isDead(dst) || this.isDead(src)) return 0;
    let amount: number, crit = false;
    if (this.isPlayer(src)) {
      const d = src.derived;
      amount = rnd(d.dmgMin, d.dmgMax + 1) * (o.mult ?? 1);
      if (o.skill) amount *= d.skillMult;
      if (src.warcryUntil > this.time) amount *= 1 + src.warcryDmg / 100;
      if (!this.isPlayer(dst) && dst.def.boss) amount *= d.bossMult;
      if (o.canCrit !== false && Math.random() < d.crit) {
        crit = true;
        amount *= d.critMult;
      }
      if (o.flat) amount = o.flat;
    } else {
      amount = o.flat ?? src.stats.dmg * rnd(0.85, 1.15) * (o.mult ?? 1);
      if (src.unit.buffs & 0x20) amount *= 1.3; // ярость босса
    }
    const level = this.isPlayer(src) ? src.level : src.level;
    let armor = this.isPlayer(dst) ? dst.derived.armor + (dst.warcryUntil > this.time ? dst.warcryArmor : 0) : dst.stats.armor;
    if (o.kind && o.kind !== "phys") armor *= 0.5;
    amount *= 1 - armorReduction(armor, level);
    if (this.isPlayer(dst)) amount *= dst.derived.dmgTaken;
    if (this.isPlayer(src) && this.isPlayer(dst)) amount *= PVP_DAMAGE_MULT;
    const v = Math.max(1, Math.round(amount));
    this.applyDamage(dst, v, src);
    this.onDamage?.(src, dst, v);
    this.emit({ t: "dmg", id: this.idOf(dst), v, crit, k: o.kind ?? "phys" });
    if (this.isPlayer(src) && src.derived.lifesteal > 0) this.heal(src, Math.round(v * src.derived.lifesteal), false);
    if (!this.isPlayer(dst)) dst.addThreat(this.idOf(src), v * (o.threat ?? 1));
    return v;
  }

  idOf(a: Actor) {
    return a.id;
  }
  isDead(a: Actor) {
    return this.isPlayer(a) ? a.dead : a.dead;
  }

  heal(p: Player, v: number, show = true) {
    if (p.dead || v <= 0) return;
    const before = p.unit.hp;
    p.unit.hp = Math.min(p.unit.maxHp, p.unit.hp + v);
    if (p.unit.hp > before) this.onHeal?.(p, p.unit.hp - before);
    if (show && p.unit.hp > before) this.emit({ t: "dmg", id: p.id, v: p.unit.hp - before, heal: true });
  }

  applyDamage(dst: Actor, v: number, src?: Actor) {
    const u = dst.unit;
    u.hp = Math.max(0, u.hp - v);
    if (this.isPlayer(dst)) {
      dst.combatAt = this.time;
      if (src && this.isPlayer(src)) src.combatAt = this.time;
      if (u.hp <= 0) this.killPlayer(dst, src);
    } else {
      dst.lastHitAt = this.time;
      if (src && this.isPlayer(src)) {
        src.combatAt = this.time;
        dst.damageBy.set(src.id, (dst.damageBy.get(src.id) || 0) + v);
        if (dst.state === "idle") {
          dst.state = "chase";
          dst.targetId = src.id;
        }
      }
      if (u.hp <= 0) this.killMob(dst, src);
    }
  }

  killMob(m: Mob, killer?: Actor) {
    m.state = "dead";
    m.unit.anim = Anim.Dead;
    m.unit.buffs = 0;
    m.unit.target = "";
    m.deadAt = this.time;
    const respawn = m.def.respawn ? m.def.respawn * 1000 : rnd(14000, 24000);
    m.respawnAt = this.time + respawn;
    m.boss?.onDeath();
    if (m.boss) this.bossKills.set(m.def.id, { by: killer && this.isPlayer(killer) ? killer.name : "неизвестный герой", at: this.time });
    grantKillRewards(this, m, killer && this.isPlayer(killer) ? killer : undefined);
    if (m.summoned) this.later(2500, () => this.removeMob(m));
  }

  killPlayer(p: Player, killer?: Actor) {
    p.dead = true;
    p.deadAt = this.time;
    p.unit.anim = Anim.Dead;
    p.unit.buffs = 0;
    p.targetId = null;
    p.moveTo = null;
    p.unit.target = "";
    for (const m of this.mobs.values()) {
      m.threat.delete(p.id);
      if (m.targetId === p.id) m.targetId = null;
    }
    p.send("toast", { text: "Вы погибли", kind: "error" });
    this.onPlayerKilled?.(p, killer);
  }

  respawn(p: Player) {
    if (!p.dead || this.time - p.deadAt < RESPAWN_DELAY_MS) return;
    const lost = Math.floor(p.save.gold * 0.1);
    p.save.gold -= lost;
    p.dead = false;
    p.unit.x = this.map.playerSpawn.x;
    p.unit.y = this.map.playerSpawn.y;
    p.unit.hp = p.unit.maxHp;
    p.unit.mp = p.unit.maxMp;
    p.unit.anim = Anim.Idle;
    p.stunUntil = p.rootUntil = p.slowUntil = 0;
    p.selfDirty = true;
    if (lost) p.send("toast", { text: `Потеряно ${lost} золота`, kind: "error" });
  }

  // ---------- игроки ----------
  playerSpeed(p: Player): number {
    let s = PLAYER_SPEED;
    if (p.slowUntil > this.time) s *= 1 - p.slowPct / 100;
    return s;
  }

  private stepToward(p: Player, gx: number, gy: number, dt: number, stopAt: number): boolean {
    const u = p.unit;
    const gd = Math.hypot(gx - u.x, gy - u.y);
    if (gd <= stopAt) return false;
    const wp = p.nav.next(this.map, u.x, u.y, gx, gy, PLAYER_RADIUS, this.time);
    if (!wp) return false;
    const final = wp.x === gx && wp.y === gy;
    const tx = wp.x, ty = wp.y;
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(this.playerSpeed(p) * dt, final ? d - stopAt : d);
    const n = moveWithCollision(this.map, u.x, u.y, (dx / d) * sp, (dy / d) * sp, PLAYER_RADIUS);
    const moved = n.x !== u.x || n.y !== u.y;
    u.x = Math.round(n.x * 10) / 10;
    u.y = Math.round(n.y * 10) / 10;
    u.dir = World.dirTo(dx, dy);
    return moved;
  }

  updatePlayer(p: Player, dt: number) {
    const u = p.unit;
    if (p.dead) return;
    const t = this.time;
    // эффекты состояния -> флаги для клиентов
    let b = 0;
    if (p.slowUntil > t) b |= BUFF_SLOW;
    if (p.stunUntil > t) b |= BUFF_STUN;
    if (p.rootUntil > t) b |= BUFF_ROOT;
    if (p.warcryUntil > t) b |= BUFF_WARCRY;
    if (p.hasteUntil > t) b |= BUFF_HASTE;
    if (p.poisonUntil > t) b |= BUFF_POISON;
    if (p.burnUntil > t) b |= BUFF_BURN;
    u.buffs = b;

    p.checkFood();

    // регенерация: вне боя быстрее, в городе ещё быстрее
    const town = this.inTown(u.x, u.y);
    const calm = t - p.combatAt > 5000;
    const d = p.derived;
    p.regenAcc += d.hpRegen * dt * (town ? 8 : calm ? 3 : 1);
    p.manaAcc += d.mpRegen * dt * (town ? 4 : 1);
    if (p.regenAcc >= 1) { const w = Math.floor(p.regenAcc); p.regenAcc -= w; u.hp = Math.min(u.maxHp, u.hp + w); }
    if (p.manaAcc >= 1) { const w = Math.floor(p.manaAcc); p.manaAcc -= w; u.mp = Math.min(u.maxMp, u.mp + w); }

    const frozen = p.frozenUntil > t;
    const canMove = !frozen && p.stunUntil <= t && p.rootUntil <= t && p.castUntil <= t;
    const target = p.targetId ? this.actor(p.targetId) : undefined;
    if (p.targetId && (!target || this.isDead(target) || !this.hostile(p, target))) {
      p.targetId = null;
      u.target = "";
    }
    let moving = false;
    if (canMove) {
      if (p.input.mx || p.input.my) {
        const len = Math.hypot(p.input.mx, p.input.my);
        const sp = this.playerSpeed(p) * dt;
        const n = moveWithCollision(this.map, u.x, u.y, (p.input.mx / len) * sp, (p.input.my / len) * sp, PLAYER_RADIUS);
        moving = n.x !== u.x || n.y !== u.y;
        u.x = Math.round(n.x * 10) / 10;
        u.y = Math.round(n.y * 10) / 10;
        u.dir = World.dirTo(p.input.mx, p.input.my);
        p.moveTo = null;
      } else if (p.moveTo) {
        moving = this.stepToward(p, p.moveTo.x, p.moveTo.y, dt, 2);
        if (!moving) p.moveTo = null;
      } else if (target && !this.isDead(target)) {
        const range = p.attackRange() + this.radiusOf(target);
        const d2 = this.dist(u, target);
        if (d2 > range || (p.ranged() && !lineClear(this.map, u.x, u.y, target.x, target.y))) moving = this.stepToward(p, target.x, target.y, dt, Math.min(range - 4, d2));
      }
    }
    // автоатака
    if (target && !this.isDead(target) && !frozen && p.stunUntil <= t && t >= p.attackAt && !(p.input.mx || p.input.my) && !p.moveTo) {
      const d2 = this.dist(u, target);
      if (d2 <= p.attackRange() + this.radiusOf(target) && lineClear(this.map, u.x, u.y, target.x, target.y)) this.playerAttack(p, target);
    }
    if (moving) u.anim = Anim.Walk;
    else if (u.anim === Anim.Walk) u.anim = Anim.Idle;
  }

  playerAttack(p: Player, target: Actor) {
    const u = p.unit;
    const haste = p.hasteUntil > this.time ? 1 + p.hastePct / 100 : 1;
    p.attackAt = this.time + (p.derived.attackCd * 1000) / haste;
    p.combatAt = this.time;
    u.dir = World.dirTo(target.x - u.x, target.y - u.y);
    u.aseq = (u.aseq + 1) % 65535;
    const cls = p.cls;
    if (cls === "warrior") {
      this.later(140, () => { if (!this.isDead(target) && this.hostile(p, target)) this.hit(p, target, { kind: "phys" }); });
    } else {
      const kind = cls === "mage" ? "arcane" : "arrow";
      const speed = cls === "mage" ? 420 : 620;
      const ms = (this.dist(u, target) / speed) * 1000;
      this.emit({ t: "proj", k: kind, from: p.id, to: target.id, tx: target.x, ty: target.y, ms });
      this.later(ms, () => { if (!this.isDead(target) && this.hostile(p, target)) this.hit(p, target, { kind: cls === "mage" ? "arcane" : "phys" }); });
    }
  }

  // ---------- мобы ----------
  mobSpeed(m: Mob) {
    let s = m.def.speed * m.speedMul;
    if (m.slowUntil > this.time) s *= 1 - m.slowPct / 100;
    return s;
  }

  private moveMob(m: Mob, gx: number, gy: number, dt: number, speed: number, stopAt = 0): boolean {
    const u = m.unit;
    if (Math.hypot(gx - u.x, gy - u.y) <= stopAt + 0.5) return false;
    const r = Math.min(12, m.def.radius * 0.6);
    const wp = m.nav.next(this.map, u.x, u.y, gx, gy, r, this.time);
    if (!wp) return false;
    const final = wp.x === gx && wp.y === gy;
    const tx = wp.x, ty = wp.y;
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(speed * dt, final ? d - stopAt : d);
    const n = moveWithCollision(this.map, u.x, u.y, (dx / d) * sp, (dy / d) * sp, r);
    if (this.inTown(n.x, n.y)) return false;
    const moved = Math.abs(n.x - u.x) + Math.abs(n.y - u.y) > 0.01;
    u.x = Math.round(n.x * 10) / 10;
    u.y = Math.round(n.y * 10) / 10;
    u.dir = World.dirTo(dx, dy);
    return moved;
  }

  /** Самая «угрожающая» живая цель рядом, иначе ближайший игрок в радиусе агрессии. */
  private pickTarget(m: Mob): Player | null {
    let best: Player | null = null, bt = -1;
    for (const [pid, th] of m.threat) {
      const p = this.players.get(pid);
      if (!p || p.dead || this.dist(p, m.home) > m.def.aggro * 3 + 300) continue;
      if (th > bt) { bt = th; best = p; }
    }
    if (best) return best;
    let bd = m.def.aggro;
    for (const p of this.players.values()) {
      if (p.dead || this.inTown(p.x, p.y)) continue;
      const d = this.dist(p, m);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private announceElite(m: Mob) {
    const r = ELITE.announceTiles * 32;
    for (const p of this.players.values()) if (this.dist(p, m) < r) p.send("toast", { text: `Рядом появился элитный моб: ${m.unit.name}`, kind: "loot" });
  }

  updateMob(m: Mob, dt: number) {
    const u = m.unit;
    const t = this.time;
    if (m.dead) {
      if (!m.summoned && t >= m.respawnAt) {
        if (m.def.boss) m.reset();
        else {
          m.rollElite();
          if (m.elite) this.announceElite(m);
        }
        this.emit({ t: "spawn", id: m.id, k: m.def.boss ? "smoke" : "smoke" });
      }
      return;
    }
    let b = 0;
    if (m.slowUntil > t) b |= BUFF_SLOW;
    if (m.stunUntil > t) b |= BUFF_STUN;
    if (m.rootUntil > t) b |= BUFF_ROOT;
    u.buffs = (u.buffs & 0x20) | b;

    if (m.boss) m.boss.update(dt);
    if (m.stunUntil > t) {
      if (u.anim === Anim.Walk) u.anim = Anim.Idle;
      return;
    }
    const canMove = m.rootUntil <= t && !(m.boss && (m.boss as { casting?: boolean }).casting);
    let moving = false;

    if (m.state === "return") {
      moving = this.moveMob(m, m.home.x, m.home.y, dt, m.def.speed * 1.6);
      u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * 0.05 * dt * 10));
      if (!moving || this.dist(u, m.home) < 4) {
        m.reset();
      }
    } else {
      const target = this.pickTarget(m);
      if (target) {
        m.state = "chase";
        m.targetId = target.id;
        u.target = target.id;
        const leash = (m.def.boss ? 1.4 : 2.5) * m.def.aggro + 260;
        if (this.dist(u, m.home) > leash) {
          m.state = "return";
          m.targetId = null;
          u.target = "";
          m.threat.clear();
        } else {
          const d = this.dist(u, target);
          const reach = m.def.range + PLAYER_RADIUS;
          const clear = !m.def.projectile || lineClear(this.map, u.x, u.y, target.x, target.y);
          if ((d > reach || !clear) && canMove) moving = this.moveMob(m, target.x, target.y, dt, this.mobSpeed(m), m.def.projectile ? reach * 0.8 : reach - 6);
          else if (d <= reach + 4 && clear && t >= m.attackAt) this.mobAttack(m, target);
          if (!moving && d > reach && m.def.projectile && canMove) moving = this.moveMob(m, target.x, target.y, dt, this.mobSpeed(m), 20);
        }
      } else if (m.state === "chase") {
        m.state = "return";
        m.targetId = null;
        u.target = "";
      } else {
        // бродит возле точки появления
        if (t >= m.wanderAt) {
          m.wanderAt = t + rnd(2500, 6500);
          const a = Math.random() * Math.PI * 2, r = Math.random() * 56;
          m.wanderTo = Math.random() < 0.6 ? { x: m.home.x + Math.cos(a) * r, y: m.home.y + Math.sin(a) * r } : null;
        }
        if (m.wanderTo && canMove) {
          moving = this.moveMob(m, m.wanderTo.x, m.wanderTo.y, dt, this.mobSpeed(m) * 0.4);
          if (!moving) m.wanderTo = null;
        }
      }
    }
    if (moving) u.anim = Anim.Walk;
    else if (u.anim === Anim.Walk) u.anim = Anim.Idle;
  }

  mobAttack(m: Mob, target: Player, mult = 1) {
    const u = m.unit;
    m.attackAt = this.time + m.def.attackCd * 1000 * (u.buffs & 0x20 ? 0.7 : 1);
    u.dir = World.dirTo(target.x - u.x, target.y - u.y);
    u.aseq = (u.aseq + 1) % 65535;
    if (m.def.projectile) {
      const ms = (this.dist(u, target) / 300) * 1000;
      this.emit({ t: "proj", k: m.def.projectile, from: m.id, to: target.id, tx: target.x, ty: target.y, ms });
      const kind: FxKind = m.def.projectile === "poison" ? "poison" : m.def.projectile === "fire" ? "fire" : "shadow";
      this.later(ms, () => {
        if (m.dead || target.dead) return;
        this.hit(m, target, { kind, mult });
        if (kind === "poison") target.poisonUntil = this.time + 2000;
        if (kind === "fire") target.burnUntil = this.time + 1500;
      });
    } else {
      this.later(220, () => {
        if (m.dead || target.dead || this.dist(m, target) > m.def.range + PLAYER_RADIUS + 24) return;
        this.hit(m, target, { kind: "phys", mult });
      });
    }
  }

  // ---------- зоны урона ----------
  addHazard(owner: Mob, x: number, y: number, r: number, ms: number, dps: number, kind: FxKind) {
    const id = this.uid("h");
    this.hazards.push({ id, x, y, r, until: this.time + ms, dps, kind, owner, tickAt: this.time + 400 });
    this.emit({ t: "hazard", id, k: kind, x, y, r, ms });
  }
  private updateHazards() {
    if (!this.hazards.length) return;
    this.hazards = this.hazards.filter((h) => h.until > this.time && !h.owner.dead);
    for (const h of this.hazards) {
      if (this.time < h.tickAt) continue;
      h.tickAt = this.time + 500;
      for (const p of this.playersInCircle(h.x, h.y, h.r)) {
        this.hit(h.owner, p, { flat: h.dps * 0.5, kind: h.kind });
        if (h.kind === "poison") p.poisonUntil = this.time + 1200;
      }
    }
  }

  /** Отложенный удар по площади после телеграфа (боссы). */
  telegraph(owner: Mob, shape: "circle" | "cone" | "ring", x: number, y: number, r: number, ms: number, onHit: (p: Player) => void, extra: { r2?: number; a?: number; w?: number; k?: FxKind } = {}) {
    this.emit({ t: "tele", shape, k: extra.k ?? "fire", x, y, r, r2: extra.r2, a: extra.a, w: extra.w, ms });
    this.later(ms, () => {
      if (owner.dead) return;
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
        let inside = false;
        if (shape === "circle") inside = d <= r + PLAYER_RADIUS * 0.5;
        else if (shape === "ring") inside = d >= r && d <= (extra.r2 ?? r * 2);
        else {
          let da = Math.atan2(dy, dx) - (extra.a ?? 0);
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          inside = d <= r && Math.abs(da) <= (extra.w ?? 1) / 2;
        }
        if (inside) onHit(p);
      }
    });
  }
}
