/**
 * Умения лекарей: Клирик (healer, Сольгард, префикс cl_) и Кровотворец (bloodweaver, Умбрат, новые bw_*).
 * Данные — data/skills.json; старые умения (heal, circle, renew, holyshield, bw_blood_bolt, bw_blood_bond, bw_sacrifice, bw_crimson_pool)
 * остались в skills.ts / umbrath.ts. Здесь — механика новых активных умений и реакции пассивок.
 * Клирик: святые лучи, щиты, очищение, спасение и воскрешение союзников. Кровотворец: кровь врагов, узы, жертва здоровьем.
 * Хуки в World: outgoing, incoming (баффы), onHealed (из World.heal), onAbsorb (щит), beforeLethal, afterDamaged, afterDealt, onKill.
 * Всё лечение идёт через World.heal / applyHeal (штраф нарушителя) и требует линию видимости до цели.
 * Состояние героя — в WeakMap (в сохранения не попадает).
 */
import { PLAYER_RADIUS } from "../../../shared/constants";
import { OUTLAW } from "../../../shared/factions";
import { lineClear } from "../../../shared/map";
import { Anim, Dir } from "../../../shared/protocol";
import { SKILLS } from "../../../shared/skills";
import type { Player } from "./Player";
import { applyHeal, healPower, reachable, resolveAlly, type Ally } from "./skills";
import { clearDots, mostWounded, type CastCtx } from "./umbrath";
import type { Actor, HitOpts, World } from "./World";

interface St {
  /** Баффы на герое: урон +dmgPct% (Благословение, «Дар ярости»), входящий урон −blessReduce%. */
  dmgUntil: number; dmgPct: number; blessUntil: number; blessReduce: number;
  sparkReady: number; guardReady: number; dropReady: number; coagReady: number;
  pending: "guardian" | "drop" | null; pendingBy: Player | null;
  pure: Map<string, number>;
  tideUntil: number; tidePct: number;
  hymn: number;
}
const states = new WeakMap<Player, St>();
function st(p: Player): St {
  let s = states.get(p);
  if (!s) {
    s = { dmgUntil: 0, dmgPct: 0, blessUntil: 0, blessReduce: 0, sparkReady: 0, guardReady: 0, dropReady: 0, coagReady: 0, pending: null, pendingBy: null, pure: new Map(), tideUntil: 0, tidePct: 0, hymn: 0 };
    states.set(p, s);
  }
  return s;
}
const rk = (p: Player, id: string) => p.save.skills[id] || 0;
const pv = (p: Player, id: string) => SKILLS[id].v(Math.max(1, rk(p, id)));
const weaponAvg = (p: Player) => ((p.derived.dmgMin + p.derived.dmgMax) / 2) * p.derived.skillMult;
const dirTo = (dx: number, dy: number): Dir => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down);
const hpOf = (a: Ally) => (a.player ? a.player.unit : a.pet!.unit);
const frac = (a: Ally) => { const u = hpOf(a); return u.hp / Math.max(1, u.maxHp); };
const isHealer = (p: Player) => p.cls === "healer" || p.cls === "bloodweaver";

/** Расстояние от точки до отрезка. */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

/** Союзники (герои и питомцы) в круге; los — только те, до кого от лекаря есть прямая видимость. */
function alliesAround(w: World, p: Player, x: number, y: number, r: number, los = true): Ally[] {
  const out: Ally[] = [];
  for (const q of w.playersInCircle(x, y, r)) {
    if (q.dead || !(q === p || (!w.hostile(p, q) && q.faction === p.faction))) continue;
    if (los && q !== p && !lineClear(w.map, p.x, p.y, q.x, q.y)) continue;
    out.push({ id: q.id, x: q.x, y: q.y, player: q });
  }
  for (const pet of w.pets.values()) {
    if (pet.dead || pet.owner.faction !== p.faction || w.hostile(p, pet.owner) || Math.hypot(pet.x - x, pet.y - y) > r) continue;
    if (los && !lineClear(w.map, p.x, p.y, pet.x, pet.y)) continue;
    out.push({ id: pet.id, x: pet.x, y: pet.y, pet });
  }
  return out;
}
const woundedAround = (w: World, p: Player, x: number, y: number, r: number, n: number) =>
  alliesAround(w, p, x, y, r).filter((a) => frac(a) < 1).sort((a, b) => frac(a) - frac(b)).slice(0, n);

/** Щит на герое: суммируется с действующим, не выше cap от здоровья. Штраф нарушителя режет и щиты. */
function shield(w: World, by: Player, t: Player, amt: number, ms: number, cap = 0.6) {
  if (by.outlawUntil > w.time || by.intruder) amt *= OUTLAW.healMul;
  const live = t.shieldUntil > w.time;
  t.shieldAmt = Math.min(t.unit.maxHp * cap, (live ? t.shieldAmt : 0) + Math.round(amt));
  t.shieldUntil = Math.max(live ? t.shieldUntil : 0, w.time + ms);
  t.shieldBy = by;
  w.emit({ t: "buff", id: t.id, k: "shield", ms });
}

/** Бафф урона: берём сильнейший, срок продлеваем. */
function boost(w: World, t: Player, pct: number, ms: number) {
  const s = st(t);
  s.dmgPct = s.dmgUntil > w.time ? Math.max(s.dmgPct, pct) : pct;
  s.dmgUntil = Math.max(s.dmgUntil, w.time + ms);
  w.emit({ t: "buff", id: t.id, k: "bless", ms });
}

/** Снять с цели оглушение, корни, замедление, ослабление, кровотечения и проклятия. */
function cleanse(a: Ally) {
  const t = (a.player ?? a.pet) as unknown as Actor;
  t.stunUntil = t.rootUntil = t.slowUntil = t.weakUntil = 0;
  t.bleedUntil = t.curseUntil = 0;
  clearDots(a.id);
}

// =====================================================================
//                         АКТИВНЫЕ УМЕНИЯ
// =====================================================================
/** undefined — умение не из этого модуля (старое или другого класса). */
export function castHealer(c: CastCtx): string | null | undefined {
  const { w, p, v, def } = c;
  const u = p.unit;
  const range = def.range ?? 0;
  const t = c.liveTarget as Actor;
  const face = (a: { x: number; y: number }) => { u.dir = dirTo(a.x - u.x, a.y - u.y); };
  const pointAt = () => {
    const d = Math.min(range, Math.hypot(c.ax - u.x, c.ay - u.y));
    return { x: u.x + Math.cos(c.aim) * d, y: u.y + Math.sin(c.aim) * d };
  };
  const seeAlly = (a: Ally): string | null => {
    if (a.player?.dead) return "Цель мертва";
    if (a.id !== p.id) {
      if (w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
      if (!lineClear(w.map, u.x, u.y, a.x, a.y)) return "Нет прямой видимости";
    }
    return null;
  };
  const needTarget = (): string | null => {
    if (!c.liveTarget) return "Нужна цель";
    if (w.dist(u, t) > range + w.radiusOf(t)) return "Цель слишком далеко";
    if (!lineClear(w.map, u.x, u.y, t.x, t.y)) return "Нет прямой видимости";
    return null;
  };
  const castAnim = () => { u.anim = Anim.Cast; w.later(400, () => { if (u.anim === Anim.Cast && !p.dead) u.anim = Anim.Idle; }); };

  switch (c.id) {
    // ---------- Клирик ----------
    case "cl_radiance": {
      const e = reachable(w, u.x, u.y, u.x + Math.cos(c.aim) * range, u.y + Math.sin(c.aim) * range, range);
      c.ok(); castAnim();
      u.dir = dirTo(e.x - u.x, e.y - u.y);
      const mx = (u.x + e.x) / 2, my = (u.y + e.y) / 2, half = Math.hypot(e.x - u.x, e.y - u.y) / 2 + 70;
      const inBeam = (x: number, y: number, rad: number) => segDist(x, y, u.x, u.y, e.x, e.y) <= 24 + rad;
      w.emit({ t: "chain", pts: [u.x, u.y - 12, e.x, e.y - 12], k: "holy" });
      w.emit({ t: "aoe", k: "ray", x: e.x, y: e.y, r: 46 });
      for (const m of w.enemiesInCircle(p, mx, my, half)) if (inBeam(m.x, m.y, w.radiusOf(m))) w.hit(p, m, { mult: v.dmg / 100, skill: true, kind: "holy" });
      const amt = (healPower(p) * v.heal) / 100;
      for (const a of alliesAround(w, p, mx, my, half, false)) {
        if (a.id === p.id || !inBeam(a.x, a.y, PLAYER_RADIUS)) continue;
        w.emit({ t: "buff", id: a.id, k: "heal", ms: 600 });
        applyHeal(w, p, a, amt);
      }
      return null;
    }
    case "cl_cleanse": {
      const a = resolveAlly(w, p, c.targetId);
      const err = seeAlly(a); if (err) return err;
      c.ok();
      cleanse(a);
      w.emit({ t: "aoe", k: "cleanse", x: a.x, y: a.y, r: 50 });
      w.emit({ t: "buff", id: a.id, k: "heal", ms: 700 });
      applyHeal(w, p, a, (healPower(p) * v.heal) / 100);
      return null;
    }
    case "cl_blessing": {
      const a = resolveAlly(w, p, c.targetId);
      if (!a.player) return "Благословить можно только героя";
      const err = seeAlly(a); if (err) return err;
      c.ok();
      const s = st(a.player), ms = v.dur * 1000;
      s.blessUntil = w.time + ms;
      s.blessReduce = v.reduce;
      boost(w, a.player, v.dmg, ms);
      w.emit({ t: "chain", pts: [u.x, u.y - 12, a.x, a.y - 12], k: "holy" });
      w.emit({ t: "aoe", k: "ward", x: a.x, y: a.y, r: 46 });
      return null;
    }
    case "cl_aegis": {
      const pt = pointAt();
      if (!lineClear(w.map, u.x, u.y, pt.x, pt.y)) return "Нет прямой видимости";
      c.ok(); castAnim();
      w.emit({ t: "aoe", k: "ward", x: pt.x, y: pt.y, r: v.radius });
      const amt = (healPower(p) * v.absorb) / 100;
      for (const a of alliesAround(w, p, pt.x, pt.y, v.radius)) if (a.player) shield(w, p, a.player, amt, v.dur * 1000);
      return null;
    }
    case "cl_hymn": {
      c.ok(); castAnim();
      const s = st(p), token = ++s.hymn, ticks = Math.round(v.ticks), ox = u.x, oy = u.y;
      p.castUntil = w.time + ticks * 1000;
      p.moveTo = null;
      u.anim = Anim.Cast;
      w.emit({ t: "buff", id: p.id, k: "bless", ms: ticks * 1000 });
      const amt = (healPower(p) * v.heal) / 100;
      for (let i = 1; i <= ticks; i++)
        w.later(i * 1000, () => {
          if (s.hymn !== token) return;
          if (p.dead || p.stunUntil > w.time || Math.hypot(p.x - ox, p.y - oy) > 40) {
            s.hymn++; p.castUntil = 0;
            if (u.anim === Anim.Cast && !p.dead) u.anim = Anim.Idle;
            if (!p.dead) p.send("toast", { text: "Гимн прерван", kind: "error" });
            return;
          }
          w.emit({ t: "aoe", k: "hymn", x: p.x, y: p.y, r: v.radius });
          for (const a of alliesAround(w, p, p.x, p.y, v.radius)) applyHeal(w, p, a, amt);
          if (i === ticks) { p.castUntil = 0; if (u.anim === Anim.Cast) u.anim = Anim.Idle; }
        });
      return null;
    }

    // ---------- Кровотворец ----------
    case "bw_leech": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      const target = t, until = w.time + v.dur * 1000;
      const key = `${p.id}|${target.id}`, token = (leeches.get(key) || 0) + 1;
      leeches.set(key, token);
      target.curseUntil = Math.max(target.curseUntil, until);
      const dmg = Math.max(1, Math.round((weaponAvg(p) * v.tick) / 100));
      for (let i = 1; i <= v.dur; i++)
        w.later(i * 1000, () => {
          if (leeches.get(key) !== token || p.dead || w.isDead(target) || !w.hostile(p, target)) return;
          const dealt = w.hit(p, target, { flat: dmg, canCrit: false, kind: "blood", noBreak: true, noProc: true });
          if (dealt <= 0) return;
          const a = mostWounded(w, p, 320);
          w.emit({ t: "chain", pts: [target.x, target.y - 12, a.x, a.y - 12], k: "blood" });
          applyHeal(w, p, a, (dealt * v.heal) / 100);
        });
      return null;
    }
    case "bw_blood_burst": {
      const pt = pointAt();
      if (!lineClear(w.map, u.x, u.y, pt.x, pt.y)) return "Нет прямой видимости";
      c.ok(); castAnim();
      w.emit({ t: "tele", shape: "circle", k: "fire", x: pt.x, y: pt.y, r: v.radius, ms: 600 });
      w.later(600, () => {
        if (p.dead) return;
        w.emit({ t: "aoe", k: "burst", x: pt.x, y: pt.y, r: v.radius });
        let got = 0;
        for (const m of w.enemiesInCircle(p, pt.x, pt.y, v.radius)) {
          const marked = m.bleedUntil > w.time || m.curseUntil > w.time;
          got += w.hit(p, m, { mult: (v.dmg / 100) * (marked ? 1.5 : 1), skill: true, kind: "blood" });
        }
        if (got <= 0) return;
        const list = woundedAround(w, p, p.x, p.y, 320, 3);
        for (const a of list) {
          w.emit({ t: "chain", pts: [pt.x, pt.y - 8, a.x, a.y - 12], k: "heal" });
          applyHeal(w, p, a, (got * v.heal) / 100 / list.length);
        }
      });
      return null;
    }
    case "bw_transfusion": {
      const a = resolveAlly(w, p, c.targetId);
      if (a.id === p.id) return "Выберите союзника или призовите питомца";
      const err = seeAlly(a); if (err) return err;
      c.ok();
      const au = hpOf(a), fa = frac(a), fp = u.hp / Math.max(1, u.maxHp), avg = (fa + fp) / 2;
      w.emit({ t: "chain", pts: [u.x, u.y - 12, a.x, a.y - 12], k: "blood" });
      w.emit({ t: "chain", pts: [a.x, a.y - 12, u.x, u.y - 12], k: "heal" });
      if (fp > fa) {
        const give = Math.round(u.maxHp * (fp - Math.max(0.15, avg)));
        if (give > 0) { u.hp -= give; w.emit({ t: "dmg", id: p.id, v: give, k: "blood" }); applyHeal(w, p, a, give); }
      } else if (fa > fp) {
        const take = Math.round(au.maxHp * (fa - Math.max(0.15, avg)));
        if (take > 0) { au.hp -= take; w.emit({ t: "dmg", id: a.id, v: take, k: "blood" }); w.heal(p, take, true, p); }
      }
      applyHeal(w, p, a, (healPower(p) * v.heal) / 100);
      w.emit({ t: "buff", id: a.id, k: "heal", ms: 700 });
      return null;
    }
    case "bw_blood_circle": {
      c.ok(); castAnim();
      const dur = v.dur + bondDur(p), until = w.time + dur * 1000;
      w.emit({ t: "aoe", k: "pact", x: u.x, y: u.y, r: v.radius });
      const amt = (healPower(p) * v.regen) / 100;
      const folks = alliesAround(w, p, u.x, u.y, v.radius);
      for (const a of folks) {
        if (a.player && a.player !== p) { a.player.bondBy = p; a.player.bondUntil = until; a.player.bondShare = v.share; }
        w.emit({ t: "chain", pts: [u.x, u.y - 12, a.x, a.y - 12], k: "blood" });
        w.emit({ t: "buff", id: a.id, k: "renew", ms: dur * 1000 });
      }
      for (let i = 1; i <= dur; i++)
        w.later(i * 1000, () => {
          if (p.dead) return;
          for (const a of folks) {
            const pl = a.player ? w.players.get(a.id) : undefined, pet = a.pet ? w.pets.get(a.id) : undefined;
            if (pl && !pl.dead) applyHeal(w, p, { id: pl.id, x: pl.x, y: pl.y, player: pl }, amt);
            else if (pet && !pet.dead) applyHeal(w, p, { id: pet.id, x: pet.x, y: pet.y, pet }, amt);
          }
        });
      return null;
    }
    case "bw_tide": {
      c.ok(); castAnim();
      const s = st(p);
      s.tideUntil = w.time + v.dur * 1000;
      s.tidePct = v.heal;
      w.emit({ t: "buff", id: p.id, k: "tide", ms: v.dur * 1000 });
      w.emit({ t: "aoe", k: "tide", x: u.x, y: u.y, r: v.radius * 0.5 });
      return null;
    }
  }
  return undefined;
}
const leeches = new Map<string, number>();

// =====================================================================
//                    МОДИФИКАТОРЫ СТАРЫХ УМЕНИЙ (вызываются из umbrath.ts / skills.ts)
// =====================================================================
/** «Багровый поток»: чем меньше у Кровотворца здоровья, тем сильнее его лечение. */
export function powerMult(p: Player): number {
  const r = rk(p, "bw_flow");
  if (!r) return 1;
  const missing = Math.max(0, 1 - p.unit.hp / Math.max(1, p.unit.maxHp));
  return 1 + (pv(p, "bw_flow").pct * missing) / 100;
}
/** «Закалённая кровь»: «Жертва крови» стоит меньше здоровья. */
export function sacrificeCost(p: Player, cost: number): number {
  return rk(p, "bw_temper") ? Math.max(1, Math.round(cost * (1 - pv(p, "bw_temper").cost / 100))) : cost;
}
/** Заплаченная кровь становится щитом. */
export function onSacrifice(w: World, p: Player, paid: number) {
  if (!rk(p, "bw_temper") || paid <= 0) return;
  shield(w, p, p, (paid * pv(p, "bw_temper").shield) / 100, 6000, 0.3);
}
/** «Глубокие узы»: доля урона по узам, которую принимает Кровотворец (множитель). */
export function bondTaken(bw: Player): number {
  return rk(bw, "bw_deep_bonds") ? 1 - pv(bw, "bw_deep_bonds").taken / 100 : 1;
}
/** «Глубокие узы»: узы держатся дольше. */
export function bondDur(p: Player): number {
  return rk(p, "bw_deep_bonds") ? pv(p, "bw_deep_bonds").dur : 0;
}
/** «Мастер купели»: дольше и вдвое сильнее лечит раненых. */
export function poolBonus(p: Player): { ticks: number; low: number } {
  return rk(p, "bw_pool") ? { ticks: pv(p, "bw_pool").ticks, low: 2 } : { ticks: 0, low: 1 };
}

// =====================================================================
//                              ХУКИ
// =====================================================================
/** Исходящий урон героя: Благословение и «Дар ярости». */
export function outgoing(w: World, src: Player, _dst: Actor, o: HitOpts): number {
  if (o.flat !== undefined) return 1;
  const s = states.get(src);
  return s && s.dmgUntil > w.time ? 1 + s.dmgPct / 100 : 1;
}

/** Входящий урон героя: Благословение. */
export function incoming(w: World, _src: Actor, dst: Player, amount: number, _o: HitOpts): number {
  const s = states.get(dst);
  return s && s.blessUntil > w.time ? amount * (1 - s.blessReduce / 100) : amount;
}

let busy = false;
/** Лечение цели по сумме req (got реально вылечено) от лекаря by. Вызывается из World.heal. */
export function onHealed(w: World, target: Player, req: number, got: number, by: Player) {
  if (busy || !isHealer(by) || by.dead) return;
  busy = true;
  try {
    const over = req - got;
    // Клирик: избыток лечения → щит
    if (over > 0 && rk(by, "cl_absolution")) {
      const m = pv(by, "cl_absolution");
      shield(w, by, target, (over * m.pct) / 100, 8000, m.cap / 100);
    }
    // Клирик: лечение очищает ослабляющие эффекты
    if (rk(by, "cl_pure_light")) {
      const s = st(by), last = s.pure.get(target.id) || 0;
      if (w.time - last >= 2000 && (target.slowUntil > w.time || target.rootUntil > w.time || target.weakUntil > w.time || target.stunUntil > w.time)) {
        s.pure.set(target.id, w.time);
        target.slowUntil = target.rootUntil = target.weakUntil = 0;
        if (target.stunUntil > w.time) target.stunUntil = w.time + ((target.stunUntil - w.time) * (100 - pv(by, "cl_pure_light").stun)) / 100;
        w.emit({ t: "aoe", k: "cleanse", x: target.x, y: target.y, r: 36 });
      }
    }
    // Клирик: эхо лечит ещё одного раненого
    if (rk(by, "cl_echo") && Math.random() * 100 < pv(by, "cl_echo").chance) {
      const o = woundedAround(w, by, by.x, by.y, 320, 3).find((a) => a.id !== target.id);
      if (o) {
        w.emit({ t: "chain", pts: [target.x, target.y - 12, o.x, o.y - 12], k: "heal" });
        applyHeal(w, by, o, (req * pv(by, "cl_echo").pct) / 100);
      }
    }
    // Кровотворец: исцелённый союзник наносит больше урона
    if (got > 0 && rk(by, "bw_gift") && target !== by) {
      const m = pv(by, "bw_gift");
      boost(w, target, m.dmg, m.dur * 1000);
    }
  } finally {
    busy = false;
  }
}

let wrathDepth = 0;
/** Щит героя dst от лекаря owner поглотил ab урона от src: «Карающий щит». */
export function onAbsorb(w: World, owner: Player | null, dst: Player, ab: number, src: Actor) {
  if (!owner || owner.dead || src === dst || wrathDepth > 0 || !rk(owner, "cl_ward_wrath") || w.isDead(src) || !w.hostile(owner, src)) return;
  wrathDepth++;
  try {
    w.emit({ t: "chain", pts: [dst.x, dst.y - 12, src.x, src.y - 12], k: "holy" });
    w.hit(owner, src, { flat: Math.max(1, Math.round((ab * pv(owner, "cl_ward_wrath").pct) / 100)), canCrit: false, kind: "holy", noProc: true, noReflect: true, noBreak: true });
  } finally {
    wrathDepth--;
  }
}

/** Смертельный удар по dst: «Последняя капля» Кровотворца или «Спасение» Клирика рядом оставляют 1 здоровья. */
export function beforeLethal(w: World, dst: Player, v: number): number {
  if (v < dst.unit.hp) return v;
  const s = st(dst);
  if (s.pending) return Math.max(0, dst.unit.hp - 1);
  if (rk(dst, "bw_last_drop") && w.time >= s.dropReady) {
    s.dropReady = w.time + pv(dst, "bw_last_drop").icd * 1000;
    s.pending = "drop";
    s.pendingBy = dst;
    return Math.max(0, dst.unit.hp - 1);
  }
  for (const h of w.playersInCircle(dst.x, dst.y, 400)) {
    if (h.dead || h.cls !== "healer" || !rk(h, "cl_guardian") || w.hostile(h, dst) || h.faction !== dst.faction) continue;
    const hs = st(h);
    if (w.time < hs.guardReady || (h !== dst && !lineClear(w.map, h.x, h.y, dst.x, dst.y))) continue;
    hs.guardReady = w.time + pv(h, "cl_guardian").icd * 1000;
    s.pending = "guardian";
    s.pendingBy = h;
    return Math.max(0, dst.unit.hp - 1);
  }
  return v;
}

/** Герой dst получил урон v (после applyDamage). */
export function afterDamaged(w: World, _src: Actor, dst: Player, _v: number, _o: HitOpts) {
  const s = st(dst);
  if (dst.dead) {
    // «Последний дар»: умирая, Клирик исцеляет и прикрывает союзников
    if (rk(dst, "cl_last_gift")) {
      const m = pv(dst, "cl_last_gift");
      w.emit({ t: "aoe", k: "hymn", x: dst.x, y: dst.y, r: m.radius });
      for (const a of alliesAround(w, dst, dst.x, dst.y, m.radius, false)) {
        if (!a.player || a.player === dst) continue;
        w.heal(a.player, Math.round((a.player.unit.maxHp * m.heal) / 100), true, dst);
        shield(w, dst, a.player, a.player.unit.maxHp * 0.1, 8000);
      }
    }
    return;
  }
  if (s.pending) {
    const kind = s.pending, by = s.pendingBy ?? dst;
    s.pending = null; s.pendingBy = null;
    if (kind === "guardian") {
      const m = pv(by, "cl_guardian");
      w.heal(dst, Math.round((dst.unit.maxHp * m.hp) / 100), true, by);
      shield(w, by, dst, dst.unit.maxHp * 0.15, 5000);
      w.emit({ t: "buff", id: dst.id, k: "invuln", ms: 1200 });
      if (by !== dst) w.emit({ t: "chain", pts: [by.x, by.y - 12, dst.x, dst.y - 12], k: "holy" });
      w.emit({ t: "aoe", k: "ward", x: dst.x, y: dst.y, r: 70 });
    } else {
      const m = pv(dst, "bw_last_drop");
      w.emit({ t: "aoe", k: "pact", x: dst.x, y: dst.y, r: 260 });
      shield(w, dst, dst, dst.unit.maxHp * 0.15, 5000);
      for (const a of alliesAround(w, dst, dst.x, dst.y, 260)) {
        if (a.id === dst.id) continue;
        w.emit({ t: "chain", pts: [dst.x, dst.y - 12, a.x, a.y - 12], k: "blood" });
        applyHeal(w, dst, a, (hpOf(a).maxHp * m.heal) / 100);
      }
    }
    return;
  }
  const lowFrac = dst.unit.hp / Math.max(1, dst.unit.maxHp);
  // «Искра света»: союзник падает ниже 30% — Клирик рядом мгновенно лечит
  if (lowFrac < 0.3) {
    for (const h of w.playersInCircle(dst.x, dst.y, 400)) {
      if (h.dead || h.cls !== "healer" || !rk(h, "cl_spark") || w.hostile(h, dst) || h.faction !== dst.faction) continue;
      const hs = st(h);
      if (w.time < hs.sparkReady || (h !== dst && !lineClear(w.map, h.x, h.y, dst.x, dst.y))) continue;
      const m = pv(h, "cl_spark");
      hs.sparkReady = w.time + m.icd * 1000;
      w.emit({ t: "proj", k: "holy", from: h.id, to: dst.id, tx: dst.x, ty: dst.y, ms: 150 });
      w.emit({ t: "buff", id: dst.id, k: "heal", ms: 700 });
      applyHeal(w, h, { id: dst.id, x: dst.x, y: dst.y, player: dst }, (healPower(h) * m.heal) / 100);
      break;
    }
  }
  // «Свёртывание»: Кровотворец ниже 35% здоровья сворачивает кровь в щит
  if (lowFrac < 0.35 && rk(dst, "bw_coagulation") && w.time >= s.coagReady) {
    const m = pv(dst, "bw_coagulation");
    s.coagReady = w.time + m.icd * 1000;
    shield(w, dst, dst, (dst.unit.maxHp * m.shield) / 100, 6000);
    w.emit({ t: "aoe", k: "pact", x: dst.x, y: dst.y, r: 50 });
  }
  // «Кровавый отклик»: подопечный под узами лечится от полученного урона
  const bw = dst.bondBy;
  if (bw && dst.bondUntil > w.time && bw !== dst && !bw.dead && rk(bw, "bw_resonance") && _v > 0 && lineClear(w.map, bw.x, bw.y, dst.x, dst.y)) {
    w.emit({ t: "buff", id: dst.id, k: "heal", ms: 500 });
    w.heal(dst, Math.round((_v * pv(bw, "bw_resonance").pct) / 100), true, bw);
  }
}

/** Герой src нанёс урон v. */
export function afterDealt(w: World, src: Player, dst: Actor, v: number, o: HitOpts) {
  if (src.cls !== "bloodweaver" || v <= 0) return;
  const s = states.get(src);
  // «Алый прилив»: нанесённый урон лечит самого раненого союзника
  if (s && s.tideUntil > w.time && !o.noProc) {
    const a = mostWounded(w, src, 320);
    if (a.id !== src.id) w.emit({ t: "chain", pts: [dst.x, dst.y - 12, a.x, a.y - 12], k: "blood" });
    applyHeal(w, src, a, (v * s.tidePct) / 100);
  }
  if (o.noProc) return;
  // «Багровая жажда»: удар по истекающему кровью/проклятому лечит союзника
  if (rk(src, "bw_thirst") && (dst.bleedUntil > w.time || dst.curseUntil > w.time)) {
    const a = mostWounded(w, src, 320);
    applyHeal(w, src, a, (v * pv(src, "bw_thirst").pct) / 100);
  }
  // «Алая мана»: урон кровью возвращает ману
  if (o.kind === "blood" && rk(src, "bw_blood_mana")) src.unit.mp = Math.min(src.unit.maxMp, src.unit.mp + (v * pv(src, "bw_blood_mana").pct) / 100);
}

/** Убийство моба героем: «Падальщик». */
export function onKill(w: World, killer: Player, _m: Actor) {
  if (killer.dead || !rk(killer, "bw_scavenger")) return;
  const m = pv(killer, "bw_scavenger");
  const a = mostWounded(w, killer, 320);
  applyHeal(w, killer, a, (hpOf(a).maxHp * m.hp) / 100);
  killer.unit.mp = Math.min(killer.unit.maxMp, killer.unit.mp + (killer.unit.maxMp * m.mana) / 100);
  w.emit({ t: "aoe", k: "pact", x: killer.x, y: killer.y, r: 36 });
}
