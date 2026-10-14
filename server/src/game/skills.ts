/** Серверная логика умений. Все проверки (ранг, мана, перезарядка, дальность, стены) — здесь. */
import { PLAYER_RADIUS } from "../../../shared/constants";
import { lineClear, walkable } from "../../../shared/map";
import { Anim } from "../../../shared/protocol";
import { SKILLS } from "../../../shared/skills";
import type { Pet } from "./Pet";
import { applyPoison, facing, isBehind } from "./rogue";
import type { Player } from "./Player";
import { World, type Actor } from "./World";

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

/** Дальше всего достижимая точка по прямой (без стен и препятствий). */
function reachable(w: World, x0: number, y0: number, x1: number, y1: number, maxDist: number) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  const L = Math.min(maxDist, d);
  let best = { x: x0, y: y0 };
  for (let s = 8; s <= L; s += 8) {
    const x = x0 + (dx / d) * s, y = y0 + (dy / d) * s;
    if (!walkable(w.map, x, y, PLAYER_RADIUS) || !lineClear(w.map, x0, y0, x, y)) break;
    best = { x, y };
  }
  const ex = x0 + (dx / d) * L, ey = y0 + (dy / d) * L;
  if (walkable(w.map, ex, ey, PLAYER_RADIUS) && lineClear(w.map, x0, y0, ex, ey) && Math.hypot(ex - best.x, ey - best.y) < 9) best = { x: ex, y: ey };
  return best;
}

export function castSkill(w: World, p: Player, id: string, ax: number, ay: number, targetId: string | null): string | null {
  const def = SKILLS[id];
  if (!def || def.kind !== "active" || def.cls !== p.cls) return "Неизвестное умение";
  const rank = p.save.skills[id] || 0;
  if (!rank) return "Умение не изучено";
  if (p.dead) return "Вы мертвы";
  if (p.stunUntil > w.time) return "Вы оглушены";
  if (p.frozenUntil > w.time) return "Бой ещё не начался";
  const ready = p.cds.get(id) || 0;
  if (w.time < ready) return null; // молча: кнопку уже показывают на перезарядке
  const mana = def.mana!(rank);
  if (p.unit.mp < mana) return "Недостаточно маны";
  const v = def.v(rank);
  const u = p.unit;
  const target = targetId ? w.actor(targetId) : undefined;
  const liveTarget = target && !w.isDead(target) && w.hostile(p, target) && !w.stealthed(target) ? target : undefined;
  const wasStealthed = p.stealthUntil > w.time;
  const isBoss = (a: Actor) => !w.isPlayer(a) && !!a.def.boss;
  const threat = (a: Actor, v: number) => { if (!w.isPlayer(a)) a.addThreat(p.id, v); };
  const range = def.range ?? 0;
  /** Контроль с учётом «Несгибаемого» у игроков. */
  const ccMs = (a: Actor, ms: number) => (w.isPlayer(a) ? ms * (1 - a.derived.ccReduce) : ms);
  const stun = (a: Actor, ms: number) => { a.stunUntil = w.time + ccMs(a, ms); };
  const slow = (a: Actor, pct: number, ms: number) => { a.slowUntil = w.time + ccMs(a, ms); a.slowPct = pct; };

  // точка прицела по умолчанию — перед героем
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) { ax = u.x; ay = u.y + 1; }
  const aim = Math.atan2(ay - u.y, ax - u.x);

  const ok = () => {
    w.breakMount(p);
    if (id !== "stealth") p.stealthUntil = 0;
    u.mp -= mana;
    const cd = def.cd!(rank) * 1000;
    p.cds.set(id, w.time + cd);
    p.send("cd", { id, ms: cd });
    p.combatAt = w.time;
    u.aseq = (u.aseq + 1) % 65535;
    u.dir = World.dirTo(ax - u.x, ay - u.y);
    // автоатака не сразу после умения
    p.attackAt = Math.max(p.attackAt, w.time + 250);
    return null;
  };

  switch (id) {
    // ---------- воин ----------
    case "taunt": {
      if (!liveTarget) return "Нужна цель";
      if (w.dist(u, liveTarget) > range + w.radiusOf(liveTarget)) return "Цель слишком далеко";
      ok();
      w.emit({ t: "aoe", k: "taunt", x: u.x, y: u.y, r: v.radius || 70 });
      const hitTargets = new Set<Actor>([liveTarget]);
      if (v.radius > 0) for (const m of w.enemiesInCircle(p, liveTarget.x, liveTarget.y, v.radius)) hitTargets.add(m);
      for (const t of hitTargets) {
        if (w.isPlayer(t)) {
          t.weakUntil = w.time + v.weakDur * 1000;
          w.emit({ t: "buff", id: t.id, k: "weak", ms: v.weakDur * 1000 });
          continue;
        }
        let top = 0;
        for (const th of t.threat.values()) top = Math.max(top, th);
        t.threat.set(p.id, Math.max(t.threat.get(p.id) || 0, top) + v.extra);
        if (!isBoss(t)) { t.tauntUntil = w.time + v.dur * 1000; t.tauntBy = p.id; t.targetId = p.id; if (t.state === "idle") t.state = "chase"; }
        w.emit({ t: "buff", id: t.id, k: "taunted", ms: v.dur * 1000 });
      }
      return null;
    }
    case "shieldblock": {
      ok();
      p.blockUntil = w.time + v.dur * 1000;
      p.blockPct = v.block;
      p.blockReflect = v.reflect;
      w.emit({ t: "buff", id: p.id, k: "block", ms: v.dur * 1000 });
      return null;
    }
    case "charge": {
      if (!liveTarget) return "Нужна цель";
      const d = w.dist(u, liveTarget);
      if (d > range + w.radiusOf(liveTarget)) return "Цель слишком далеко";
      if (!lineClear(w.map, u.x, u.y, liveTarget.x, liveTarget.y)) return "Путь прегражден";
      const stop = w.radiusOf(liveTarget) + PLAYER_RADIUS + 4;
      const dest = reachable(w, u.x, u.y, liveTarget.x, liveTarget.y, Math.max(0, d - stop));
      ok();
      w.emit({ t: "blink", id: p.id, x0: u.x, y0: u.y, x1: dest.x, y1: dest.y, k: "charge" });
      u.x = dest.x;
      u.y = dest.y;
      p.moveTo = null;
      p.targetId = liveTarget.id;
      u.dir = World.dirTo(liveTarget.x - u.x, liveTarget.y - u.y);
      w.hit(p, liveTarget, { mult: v.dmg / 100, skill: true, threat: 1 });
      threat(liveTarget, v.threat);
      if (!isBoss(liveTarget)) stun(liveTarget, v.stun * 1000);
      else slow(liveTarget, 40, v.stun * 1000);
      return null;
    }
    case "quake": {
      ok();
      u.aseq = (u.aseq + 1) % 65535;
      w.emit({ t: "aoe", k: "quake", x: u.x, y: u.y, r: v.radius });
      for (const m of w.enemiesInCircle(p, u.x, u.y, v.radius)) {
        w.hit(p, m, { mult: v.dmg / 100, skill: true, threat: 1 });
        threat(m, v.threat);
        slow(m, v.slow, v.dur * 1000);
      }
      return null;
    }

    // ---------- маг ----------
    case "fireball": {
      let tx: number, ty: number, aimTarget: Actor | undefined;
      if (liveTarget && w.dist(u, liveTarget) <= range + w.radiusOf(liveTarget)) { aimTarget = liveTarget; tx = liveTarget.x; ty = liveTarget.y; }
      else {
        const d = Math.min(range, Math.hypot(ax - u.x, ay - u.y) || range);
        tx = u.x + Math.cos(aim) * d; ty = u.y + Math.sin(aim) * d;
      }
      if (!lineClear(w.map, u.x, u.y, tx, ty)) return "Нет прямой видимости";
      ok();
      const ms = (Math.hypot(tx - u.x, ty - u.y) / 420) * 1000;
      w.emit({ t: "proj", k: "fireball", from: p.id, to: aimTarget?.id, tx, ty, ms });
      w.later(ms, () => {
        const alive = aimTarget && !w.isDead(aimTarget);
        const ix = alive ? aimTarget!.x : tx, iy = alive ? aimTarget!.y : ty;
        w.emit({ t: "aoe", k: "fire", x: ix, y: iy, r: v.splash });
        const main = alive ? aimTarget : w.enemiesInCircle(p, ix, iy, 20)[0];
        if (main) w.hit(p, main, { mult: v.dmg / 100, skill: true, kind: "fire" });
        for (const m of w.enemiesInCircle(p, ix, iy, v.splash)) if (m !== main) w.hit(p, m, { mult: v.dmg / 200, skill: true, kind: "fire" });
      });
      return null;
    }
    case "frostnova": {
      ok();
      w.emit({ t: "aoe", k: "frost", x: u.x, y: u.y, r: v.radius });
      for (const m of w.enemiesInCircle(p, u.x, u.y, v.radius)) {
        w.hit(p, m, { mult: v.dmg / 100, skill: true, kind: "frost" });
        m.slowUntil = w.time + v.dur * 1000;
        m.slowPct = v.slow;
      }
      return null;
    }
    case "blink": {
      const dest = reachable(w, u.x, u.y, ax, ay, v.dist);
      if (Math.hypot(dest.x - u.x, dest.y - u.y) < 16) return "Туда не переместиться";
      ok();
      w.emit({ t: "blink", id: p.id, x0: u.x, y0: u.y, x1: dest.x, y1: dest.y });
      u.x = dest.x;
      u.y = dest.y;
      p.moveTo = null;
      p.rootUntil = 0;
      p.slowUntil = 0;
      return null;
    }
    case "meteor": {
      const d = Math.min(range, Math.hypot(ax - u.x, ay - u.y));
      const tx = u.x + Math.cos(aim) * d, ty = u.y + Math.sin(aim) * d;
      ok();
      u.anim = Anim.Cast;
      w.emit({ t: "tele", shape: "circle", k: "frost", x: tx, y: ty, r: v.radius, ms: v.delay * 1000 });
      w.later(v.delay * 1000, () => {
        w.emit({ t: "aoe", k: "fire", x: tx, y: ty, r: v.radius });
        for (const m of w.enemiesInCircle(p, tx, ty, v.radius)) w.hit(p, m, { mult: v.dmg / 100, skill: true, kind: "fire" });
      });
      return null;
    }

    // ---------- лучник ----------
    case "aimed": {
      if (!liveTarget) return "Нужна цель";
      if (w.dist(u, liveTarget) > range + w.radiusOf(liveTarget)) return "Цель слишком далеко";
      if (!lineClear(w.map, u.x, u.y, liveTarget.x, liveTarget.y)) return "Нет прямой видимости";
      ok();
      const ms = (w.dist(u, liveTarget) / 900) * 1000;
      w.emit({ t: "proj", k: "arrow", from: p.id, to: liveTarget.id, tx: liveTarget.x, ty: liveTarget.y, ms });
      w.later(ms, () => { if (!w.isDead(liveTarget) && w.hostile(p, liveTarget)) w.hit(p, liveTarget, { mult: v.dmg / 100, skill: true }); });
      return null;
    }
    case "volley": {
      ok();
      const n = v.arrows, spread = (v.arc * Math.PI) / 180;
      const used = new Set<Actor>();
      for (let i = 0; i < n; i++) {
        const a = aim - spread / 2 + (spread * i) / (n - 1);
        // первая цель вблизи луча
        let best: Actor | undefined, bd = range;
        for (const m of w.enemiesInCircle(p, u.x, u.y, range)) {
          const d = w.dist(u, m);
          const off = Math.abs(Math.sin(Math.atan2(m.y - u.y, m.x - u.x) - a)) * d;
          const ahead = Math.cos(Math.atan2(m.y - u.y, m.x - u.x) - a) > 0;
          if (ahead && off < w.radiusOf(m) + 10 && d < bd && lineClear(w.map, u.x, u.y, m.x, m.y)) { bd = d; best = m; }
        }
        const tx = best ? best.x : u.x + Math.cos(a) * range, ty = best ? best.y : u.y + Math.sin(a) * range;
        const ms = (Math.hypot(tx - u.x, ty - u.y) / 750) * 1000;
        w.emit({ t: "proj", k: "arrow", from: p.id, to: best?.id, tx, ty, ms });
        if (best) {
          const m = best;
          const repeat = used.has(m);
          used.add(m);
          w.later(ms, () => { if (!w.isDead(m) && w.hostile(p, m)) w.hit(p, m, { mult: (v.dmg / 100) * (repeat ? 0.6 : 1), skill: true }); });
        }
      }
      return null;
    }
    case "roll": {
      const dest = reachable(w, u.x, u.y, ax, ay, v.dist);
      if (Math.hypot(dest.x - u.x, dest.y - u.y) < 16) return "Некуда отскочить";
      ok();
      w.emit({ t: "blink", id: p.id, x0: u.x, y0: u.y, x1: dest.x, y1: dest.y });
      u.x = dest.x;
      u.y = dest.y;
      p.moveTo = null;
      p.rootUntil = 0;
      p.hasteUntil = w.time + v.dur * 1000;
      p.hastePct = v.haste;
      w.emit({ t: "buff", id: p.id, k: "haste", ms: v.dur * 1000 });
      return null;
    }
    case "rain": {
      const d = Math.min(range, Math.hypot(ax - u.x, ay - u.y));
      const tx = u.x + Math.cos(aim) * d, ty = u.y + Math.sin(aim) * d;
      ok();
      for (let i = 0; i < v.ticks; i++)
        w.later(250 + i * 500, () => {
          w.emit({ t: "aoe", k: "phys", x: tx, y: ty, r: v.radius });
          for (let k = 0; k < 4; k++) {
            const rx = tx + (Math.random() - 0.5) * v.radius * 1.4, ry = ty + (Math.random() - 0.5) * v.radius;
            w.emit({ t: "proj", k: "arrow", from: p.id, tx: rx, ty: ry, ms: 250 });
          }
          for (const m of w.enemiesInCircle(p, tx, ty, v.radius)) {
            w.hit(p, m, { mult: v.dmg / 100, skill: true });
            m.slowUntil = w.time + 800;
            m.slowPct = v.slow;
          }
        });
      return null;
    }

    // ---------- разбойник ----------
    case "backstab": {
      if (!liveTarget) return "Нужна цель";
      if (w.dist(u, liveTarget) > range + w.radiusOf(liveTarget)) return "Цель слишком далеко";
      if (!lineClear(w.map, u.x, u.y, liveTarget.x, liveTarget.y)) return "Нет прямой видимости";
      const crit2 = wasStealthed || isBehind(p, liveTarget);
      ok();
      u.dir = World.dirTo(liveTarget.x - u.x, liveTarget.y - u.y);
      w.emit({ t: "aoe", k: "slash", x: liveTarget.x, y: liveTarget.y, r: crit2 ? 44 : 30 });
      w.hit(p, liveTarget, { mult: (v.dmg / 100) * (crit2 ? v.behind : 1), skill: true, threat: 1 });
      return null;
    }
    case "venom": {
      if (!liveTarget) return "Нужна цель";
      if (w.dist(u, liveTarget) > range + w.radiusOf(liveTarget)) return "Цель слишком далеко";
      ok();
      u.dir = World.dirTo(liveTarget.x - u.x, liveTarget.y - u.y);
      applyPoison(w, p, liveTarget, rank);
      threat(liveTarget, 40);
      return null;
    }
    case "shadowstep": {
      if (!liveTarget) return "Нужна цель";
      if (w.dist(u, liveTarget) > range + w.radiusOf(liveTarget)) return "Цель слишком далеко";
      const [fx, fy] = facing(liveTarget);
      const off = w.radiusOf(liveTarget) + PLAYER_RADIUS + 2;
      const base = Math.atan2(-fy, -fx);
      let dest: { x: number; y: number } | null = null;
      for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
        const x = liveTarget.x + Math.cos(base + da) * off, y = liveTarget.y + Math.sin(base + da) * off;
        if (walkable(w.map, x, y, PLAYER_RADIUS) && lineClear(w.map, x, y, liveTarget.x, liveTarget.y)) { dest = { x, y }; break; }
      }
      if (!dest) return "Нет места за спиной цели";
      ok();
      w.emit({ t: "blink", id: p.id, x0: u.x, y0: u.y, x1: dest.x, y1: dest.y, k: "shadow" });
      u.x = dest.x;
      u.y = dest.y;
      p.moveTo = null;
      p.targetId = liveTarget.id;
      u.target = liveTarget.id;
      u.dir = World.dirTo(liveTarget.x - u.x, liveTarget.y - u.y);
      p.critNextUntil = w.time + 8000;
      p.attackAt = Math.min(p.attackAt, w.time + 250);
      return null;
    }
    case "stealth": {
      if (w.inTown(u.x, u.y)) return "В городе скрытность недоступна";
      ok();
      p.stealthUntil = w.time + v.dur * 1000;
      p.targetId = null;
      u.target = "";
      p.moveTo = null;
      w.emit({ t: "aoe", k: "shadow", x: u.x, y: u.y, r: 46 });
      return null;
    }

    // ---------- лекарь ----------
    case "heal": {
      const a = resolveAlly(w, p, targetId);
      if (a.player?.dead) {
        const rr = p.save.skills.resurrect || 0;
        if (!rr) return "Цель мертва (нужен талант «Воскрешение»)";
        if (p.team !== 0 || w.pvpActive) return "На арене воскрешение недоступно";
        if (w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
        const tp = a.player, rv = SKILLS.resurrect.v(rr);
        ok();
        p.castUntil = w.time + rv.cast * 1000;
        p.moveTo = null;
        u.anim = Anim.Cast;
        w.emit({ t: "buff", id: p.id, k: "heal", ms: rv.cast * 1000 });
        w.later(rv.cast * 1000, () => {
          if (u.anim === Anim.Cast && !p.dead) u.anim = Anim.Idle;
          if (!tp.dead || w.players.get(tp.id) !== tp) return;
          if (p.dead || p.stunUntil > w.time || w.dist(u, tp) > range + PLAYER_RADIUS + 40) return void p.send("toast", { text: "Воскрешение прервано", kind: "error" });
          tp.dead = false;
          tp.unit.hp = Math.max(1, Math.round(tp.unit.maxHp * rv.hp / 100));
          tp.unit.anim = Anim.Idle;
          tp.stunUntil = tp.rootUntil = tp.slowUntil = 0;
          tp.combatAt = w.time;
          tp.selfDirty = true;
          tp.send("toast", { text: `${p.name} воскрешает вас`, kind: "info" });
          w.emit({ t: "buff", id: tp.id, k: "heal", ms: 900 });
          w.emit({ t: "aoe", k: "heal", x: tp.x, y: tp.y, r: 60 });
        });
        return null;
      }
      if (a.id !== p.id && w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
      ok();
      w.emit({ t: "buff", id: a.id, k: "heal", ms: 700 });
      smite(w, p, applyHeal(w, p, a, healPower(p) * v.heal / 100));
      return null;
    }
    case "circle": {
      const d = Math.min(range, Math.hypot(ax - u.x, ay - u.y));
      const cx = u.x + Math.cos(aim) * d, cy = u.y + Math.sin(aim) * d;
      ok();
      w.emit({ t: "aoe", k: "heal", x: cx, y: cy, r: v.radius });
      const amt = healPower(p) * v.heal / 100;
      let got = 0;
      for (const q of w.playersInCircle(cx, cy, v.radius)) if (q === p || !w.hostile(p, q)) got += w.heal(q, amt, true, p);
      for (const pet of w.pets.values()) {
        if (pet.dead || w.dist(pet.unit, { x: cx, y: cy }) > v.radius + 12 || w.hostile(p, pet.owner)) continue;
        got += applyHeal(w, p, { id: pet.id, x: pet.unit.x, y: pet.unit.y, pet }, amt);
      }
      smite(w, p, got);
      return null;
    }
    case "renew": {
      const a = resolveAlly(w, p, targetId);
      if (a.player?.dead) return "Цель мертва";
      if (a.id !== p.id && w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
      ok();
      const token = (hotToken.get(a.id) || 0) + 1;
      hotToken.set(a.id, token);
      const amt = healPower(p) * v.tick / 100;
      w.emit({ t: "buff", id: a.id, k: "renew", ms: v.dur * 1000 });
      for (let i = 1; i <= v.ticks; i++)
        w.later(i * 1000, () => {
          if (hotToken.get(a.id) !== token || p.dead) return;
          const pl = w.players.get(a.id), pet = w.pets.get(a.id);
          if (pl && !pl.dead) applyHeal(w, p, { id: pl.id, x: pl.x, y: pl.y, player: pl }, amt);
          else if (pet && !pet.dead) applyHeal(w, p, { id: pet.id, x: pet.unit.x, y: pet.unit.y, pet }, amt);
        });
      return null;
    }
    case "holyshield": {
      const a = resolveAlly(w, p, targetId);
      if (!a.player) return "Щит можно наложить только на героя";
      if (a.player.dead) return "Цель мертва";
      if (a.id !== p.id && w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
      ok();
      const tp = a.player;
      tp.shieldAmt = healPower(p) * v.absorb / 100;
      tp.shieldUntil = w.time + v.dur * 1000;
      tp.shieldBy = p;
      w.emit({ t: "buff", id: tp.id, k: "shield", ms: v.dur * 1000 });
      return null;
    }
  }
  return "Умение недоступно";
}

// ---------- помощники лекаря ----------
interface Ally { id: string; x: number; y: number; player?: Player; pet?: Pet }
const hotToken = new Map<string, number>();

/** Союзная цель по id (игрок или питомец, не враг); иначе сам лекарь. */
function resolveAlly(w: World, p: Player, targetId: string | null): Ally {
  const self: Ally = { id: p.id, x: p.x, y: p.y, player: p };
  if (!targetId) return self;
  const tp = w.players.get(targetId);
  if (tp) return tp === p || !w.hostile(p, tp) ? { id: tp.id, x: tp.x, y: tp.y, player: tp } : self;
  const pet = w.pets.get(targetId);
  if (pet && !pet.dead && !w.hostile(p, pet.owner)) return { id: pet.id, x: pet.unit.x, y: pet.unit.y, pet };
  return self;
}

/** Сила лечения: средний урон оружия × сила умений × «Благодать». */
export function healPower(p: Player): number {
  const d = p.derived;
  return ((d.dmgMin + d.dmgMax) / 2) * d.skillMult * (1 + 0.06 * (p.save.skills.grace || 0));
}

function applyHeal(w: World, p: Player, a: Ally, amount: number): number {
  if (a.player) return w.heal(a.player, Math.round(amount), true, p);
  if (a.pet && !a.pet.dead) {
    const u = a.pet.unit, before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + Math.round(amount));
    if (u.hp > before) w.emit({ t: "dmg", id: a.pet.id, v: u.hp - before, heal: true });
    return u.hp - before;
  }
  return 0;
}

/** «Кара»: часть вылеченного обрушивается святым светом на ближайшего врага. */
function smite(w: World, p: Player, healed: number) {
  const r = p.save.skills.smite || 0;
  if (!r || healed <= 0) return;
  let best: Actor | undefined, bd = 260;
  for (const m of w.enemiesInCircle(p, p.x, p.y, 260)) {
    const d = w.dist(p, m);
    if (d < bd && lineClear(w.map, p.x, p.y, m.x, m.y)) { bd = d; best = m; }
  }
  if (!best) return;
  const m = best, dmg = Math.max(1, Math.round((healed * SKILLS.smite.v(r).pct) / 100));
  const ms = (bd / 450) * 1000;
  w.emit({ t: "proj", k: "holy", from: p.id, to: m.id, tx: m.x, ty: m.y, ms });
  w.later(ms, () => { if (!w.isDead(m) && w.hostile(p, m)) w.hit(p, m, { flat: dmg, canCrit: false, kind: "holy", skill: true }); });
}
