/**
 * Умения классов Умбрата (данные — data/skills.json). Своя механика у каждого:
 * Рыцарь смерти живёт вытягиванием жизни и притягивает цепями, Кровотворец лечит кровью врагов и своим здоровьем,
 * Тёмный следопыт проклинает и ослабляет, Чернокнижник — урон со временем, мана из врагов и скелеты,
 * Потрошитель — кровотечения, прыжки и ярость от ран (World.hit).
 */
import { PLAYER_RADIUS } from "../../../shared/constants";
import { lineClear, walkable } from "../../../shared/map";
import { petUnitId, type PetDef } from "../../../shared/pets";
import { SUMMONS, type SkillDef } from "../../../shared/skills";
import { Anim, type FxKind } from "../../../shared/protocol";
import { dismissPet, Pet } from "./Pet";
import type { Player } from "./Player";
import { applyHeal, healPower, reachable, resolveAlly, type Ally } from "./skills";
import { World, type Actor } from "./World";

export interface CastCtx {
  w: World;
  p: Player;
  id: string;
  def: SkillDef;
  rank: number;
  v: Record<string, number>;
  liveTarget: Actor | undefined;
  targetId: string | null;
  ax: number;
  ay: number;
  aim: number;
  /** Списать ману, поставить перезарядку (всегда вызывать перед эффектом). */
  ok: () => null;
  stun: (a: Actor, ms: number) => void;
  slow: (a: Actor, pct: number, ms: number) => void;
  threat: (a: Actor, v: number) => void;
  isBoss: (a: Actor) => boolean;
}

// ---------- урон со временем: проклятия и кровотечения ----------
interface Dot { stacks: number; until: number; dmg: number }
const dots = new Map<string, Dot>();

/** Периодический урон от героя по цели: тик раз в секунду, stacks — до maxStacks, повтор обновляет срок. */
export function addDot(w: World, p: Player, target: Actor, key: "curse" | "bleed" | "agony" | "plague", dmg: number, durS: number, kind: FxKind, maxStacks = 1) {
  const k = `${p.id}|${target.id}|${key}`;
  const cur = dots.get(k);
  const live = cur && cur.until > w.time;
  const e: Dot = live ? cur : { stacks: 0, until: 0, dmg };
  e.stacks = Math.min(maxStacks, e.stacks + 1);
  e.dmg = Math.max(e.dmg, dmg);
  e.until = w.time + durS * 1000;
  dots.set(k, e);
  if (key === "bleed") target.bleedUntil = Math.max(target.bleedUntil, e.until);
  else target.curseUntil = Math.max(target.curseUntil, e.until);
  if (live) return;
  const tick = () => {
    const c = dots.get(k);
    if (c !== e || e.until <= w.time || w.isDead(target) || w.isDead(p) || !w.hostile(p, target)) { if (c === e) dots.delete(k); return; }
    w.hit(p, target, { flat: Math.max(1, Math.round(e.dmg * e.stacks)), canCrit: false, kind, noBreak: true, noProc: true });
    w.later(1000, tick);
  };
  w.later(1000, tick);
}

const weaponAvg = (p: Player) => ((p.derived.dmgMin + p.derived.dmgMax) / 2) * p.derived.skillMult;

/** Ослабление цели: её урон −pct% на ms. */
function weaken(w: World, a: Actor, pct: number, ms: number) {
  a.weakUntil = w.time + ms;
  a.weakPct = pct;
  w.emit({ t: "buff", id: a.id, k: "weak", ms });
}

/** Самый раненый союзник (или сам герой) в радиусе: для «Кровавой стрелы». */
function mostWounded(w: World, p: Player, r: number): Ally {
  let best: Ally = { id: p.id, x: p.x, y: p.y, player: p }, br = p.unit.hp / Math.max(1, p.unit.maxHp);
  for (const q of w.playersInCircle(p.x, p.y, r)) {
    if (q === p || w.hostile(p, q) || q.faction !== p.faction) continue;
    const k = q.unit.hp / Math.max(1, q.unit.maxHp);
    if (k < br) { br = k; best = { id: q.id, x: q.x, y: q.y, player: q }; }
  }
  for (const pet of w.pets.values()) {
    if (pet.dead || pet.owner.faction !== p.faction || w.dist(pet, p) > r) continue;
    const k = pet.unit.hp / Math.max(1, pet.unit.maxHp);
    if (k < br) { br = k; best = { id: pet.id, x: pet.x, y: pet.y, pet }; }
  }
  return best;
}

/** Снаряд героя в цель с уроном по прилёту. */
function shoot(w: World, p: Player, t: Actor, k: string, speed: number, onHit: () => void) {
  const ms = (w.dist(p, t) / speed) * 1000;
  w.emit({ t: "proj", k, from: p.id, to: t.id, tx: t.x, ty: t.y, ms });
  w.later(ms, () => { if (!w.isDead(t) && w.hostile(p, t)) onHit(); });
}

export function castUmbrath(c: CastCtx): string | null {
  const { w, p, v, def } = c;
  const t = c.liveTarget as Actor;
  const u = p.unit;
  const range = def.range ?? 0;
  const needTarget = (los = true): string | null => {
    if (!c.liveTarget) return "Нужна цель";
    if (w.dist(u, t) > range + w.radiusOf(t)) return "Цель слишком далеко";
    if (los && !lineClear(w.map, u.x, u.y, t.x, t.y)) return "Нет прямой видимости";
    return null;
  };
  const face = (a: Actor) => { u.dir = World.dirTo(a.x - u.x, a.y - u.y); };
  const pointAt = () => {
    const d = Math.min(range, Math.hypot(c.ax - u.x, c.ay - u.y));
    return { x: u.x + Math.cos(c.aim) * d, y: u.y + Math.sin(c.aim) * d };
  };

  switch (c.id) {
    // ---------- Рыцарь смерти ----------
    case "dk_rune_strike": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      w.emit({ t: "aoe", k: "frost", x: t.x, y: t.y, r: 34 });
      const dealt = w.hit(p, t, { mult: v.dmg / 100, skill: true, kind: "frost" });
      c.threat(t, v.threat);
      if (dealt > 0) w.heal(p, Math.round((dealt * v.leech) / 100));
      return null;
    }
    case "dk_death_grip": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      w.emit({ t: "chain", pts: [u.x, u.y - 12, t.x, t.y - 12], k: "shadow" });
      if (!c.isBoss(t)) {
        const stop = w.radiusOf(t) + PLAYER_RADIUS + 6;
        const dest = reachable(w, t.x, t.y, u.x, u.y, Math.max(0, w.dist(u, t) - stop));
        w.emit({ t: "blink", id: t.id, x0: t.x, y0: t.y, x1: dest.x, y1: dest.y, k: "charge" });
        t.unit.x = dest.x;
        t.unit.y = dest.y;
        if (!w.isPlayer(t)) {
          let top = 0;
          for (const th of t.threat.values()) top = Math.max(top, th);
          t.threat.set(p.id, Math.max(t.threat.get(p.id) || 0, top) + 60);
          t.tauntUntil = w.time + v.taunt * 1000; t.tauntBy = p.id; t.targetId = p.id;
          if (t.state === "idle") t.state = "chase";
          w.emit({ t: "buff", id: t.id, k: "taunted", ms: v.taunt * 1000 });
        } else t.moveTo = null;
      }
      w.hit(p, t, { mult: v.dmg / 100, skill: true, kind: "shadow" });
      c.slow(t, v.slow, v.slowDur * 1000);
      p.targetId = t.id;
      u.target = t.id;
      return null;
    }
    case "dk_bone_armor": {
      c.ok();
      p.shieldAmt = Math.round((u.maxHp * v.absorb) / 100);
      p.shieldUntil = w.time + v.dur * 1000;
      p.shieldBy = p;
      p.boneUntil = p.shieldUntil;
      p.boneChill = v.chill;
      w.emit({ t: "buff", id: p.id, k: "block", ms: v.dur * 1000 });
      w.emit({ t: "aoe", k: "frost", x: u.x, y: u.y, r: 46 });
      return null;
    }
    case "dk_blood_drain": {
      c.ok();
      u.anim = Anim.Cast;
      w.emit({ t: "aoe", k: "shadow", x: u.x, y: u.y, r: v.radius });
      let got = 0;
      for (const m of w.enemiesInCircle(p, u.x, u.y, v.radius)) {
        got += w.hit(p, m, { mult: v.dmg / 100, skill: true, kind: "shadow" });
        c.threat(m, v.threat);
        w.emit({ t: "chain", pts: [m.x, m.y - 12, u.x, u.y - 12], k: "heal" });
      }
      if (got > 0) w.heal(p, Math.round((got * v.heal) / 100));
      w.later(400, () => { if (u.anim === Anim.Cast && !p.dead) u.anim = Anim.Idle; });
      return null;
    }

    // ---------- Кровотворец ----------
    case "bw_blood_bolt": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      shoot(w, p, t, "blood", 460, () => {
        const dealt = w.hit(p, t, { mult: v.dmg / 100, skill: true, kind: "blood" });
        if (dealt <= 0) return;
        const a = mostWounded(w, p, v.radius);
        if (a.id !== p.id) w.emit({ t: "chain", pts: [t.x, t.y - 12, a.x, a.y - 12], k: "heal" });
        applyHeal(w, p, a, (dealt * v.transfuse) / 100);
      });
      return null;
    }
    case "bw_blood_bond": {
      let a = resolveAlly(w, p, c.targetId);
      if (a.id === p.id) {
        // без союзника — узы с собственным питомцем
        const pet = w.pets.get(petUnitId(p.id));
        if (!pet || pet.dead) return "Выберите союзника или призовите питомца";
        a = { id: pet.id, x: pet.x, y: pet.y, pet };
      }
      if (a.player?.dead) return "Цель мертва";
      if (w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
      c.ok();
      const until = w.time + v.dur * 1000;
      if (a.player) { a.player.bondBy = p; a.player.bondUntil = until; a.player.bondShare = v.share; }
      w.emit({ t: "chain", pts: [u.x, u.y - 12, a.x, a.y - 12], k: "heal" });
      w.emit({ t: "buff", id: a.id, k: "renew", ms: v.dur * 1000 });
      const amt = (healPower(p) * v.regen) / 100;
      for (let i = 1; i <= v.dur; i++)
        w.later(i * 1000, () => {
          if (p.dead) return;
          const pl = w.players.get(a.id), pet = w.pets.get(a.id);
          if (pl && !pl.dead && pl.bondBy === p && pl.bondUntil >= w.time) applyHeal(w, p, { id: pl.id, x: pl.x, y: pl.y, player: pl }, amt);
          else if (pet && !pet.dead) applyHeal(w, p, { id: pet.id, x: pet.x, y: pet.y, pet }, amt);
        });
      return null;
    }
    case "bw_sacrifice": {
      const a = resolveAlly(w, p, c.targetId);
      const cost = Math.round((u.maxHp * v.cost) / 100);
      if (u.hp <= cost) return "Слишком мало здоровья для жертвы";
      if (a.player?.dead) return "Цель мертва";
      if (a.id !== p.id && w.dist(u, a) > range + PLAYER_RADIUS) return "Цель слишком далеко";
      c.ok();
      u.hp -= cost;
      w.emit({ t: "dmg", id: p.id, v: cost, k: "blood" });
      if (a.id === p.id) {
        // без цели: кровь превращается в ману
        const mp = Math.round((u.maxMp * v.mana) / 100);
        u.mp = Math.min(u.maxMp, u.mp + mp);
        w.emit({ t: "buff", id: p.id, k: "haste", ms: 600 });
        return null;
      }
      w.emit({ t: "chain", pts: [u.x, u.y - 12, a.x, a.y - 12], k: "heal" });
      w.emit({ t: "buff", id: a.id, k: "heal", ms: 700 });
      applyHeal(w, p, a, (healPower(p) * v.heal) / 100);
      return null;
    }
    case "bw_crimson_pool": {
      const pt = pointAt();
      if (!lineClear(w.map, u.x, u.y, pt.x, pt.y)) return "Нет прямой видимости";
      c.ok();
      u.anim = Anim.Cast;
      w.later(400, () => { if (u.anim === Anim.Cast && !p.dead) u.anim = Anim.Idle; });
      w.emit({ t: "tele", shape: "circle", k: "fire", x: pt.x, y: pt.y, r: v.radius, ms: v.ticks * 1000 });
      const dmgMult = v.dmg / 100, heal = (healPower(p) * v.heal) / 100;
      for (let i = 1; i <= v.ticks; i++)
        w.later(i * 1000, () => {
          if (p.dead) return;
          w.emit({ t: "aoe", k: "fire", x: pt.x, y: pt.y, r: v.radius * 0.6 });
          for (const m of w.enemiesInCircle(p, pt.x, pt.y, v.radius)) w.hit(p, m, { mult: dmgMult, skill: true, kind: "blood", noBreak: true });
          for (const q of w.playersInCircle(pt.x, pt.y, v.radius)) if (q === p || (!w.hostile(p, q) && q.faction === p.faction)) w.heal(q, Math.round(heal), true, p);
        });
      return null;
    }

    // ---------- Тёмный следопыт ----------
    case "dr_cursed_arrow": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      shoot(w, p, t, "shadow", 850, () => {
        w.hit(p, t, { mult: v.dmg / 100, skill: true, kind: "shadow" });
        addDot(w, p, t, "curse", (weaponAvg(p) * v.tick) / 100, v.dur, "shadow");
      });
      return null;
    }
    case "dr_weakening": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      shoot(w, p, t, "poison", 800, () => {
        w.hit(p, t, { mult: v.dmg / 100, skill: true, kind: "poison" });
        weaken(w, t, v.weak, v.dur * 1000);
        c.slow(t, v.slow, 3000);
      });
      return null;
    }
    case "dr_raven": {
      const e = needTarget(false); if (e) return e;
      c.ok(); face(t);
      const target = t;
      w.emit({ t: "spawn", id: p.id, k: "smoke" });
      for (let i = 0; i < v.pecks; i++)
        w.later(300 + i * v.every * 1000, () => {
          if (w.isDead(target) || p.dead || !w.hostile(p, target)) return;
          w.emit({ t: "proj", k: "shadow", from: p.id, to: target.id, tx: target.x, ty: target.y, ms: 260 });
          w.later(260, () => { if (!w.isDead(target) && w.hostile(p, target)) w.hit(p, target, { mult: v.dmg / 100, skill: true, kind: "shadow", noBreak: true }); });
        });
      return null;
    }
    case "dr_shadowmeld": {
      if (w.inTown(u.x, u.y)) return "В городе уйти в тень нельзя";
      c.ok();
      p.stealthUntil = w.time + v.dur * 1000;
      p.critNextUntil = w.time + v.dur * 1000 + 4000;
      p.slowUntil = p.rootUntil = 0;
      p.targetId = null;
      u.target = "";
      w.emit({ t: "aoe", k: "shadow", x: u.x, y: u.y, r: 50 });
      return null;
    }

    // ---------- Чернокнижник ----------
    case "wl_agony": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      shoot(w, p, t, "shadow", 480, () => {
        w.hit(p, t, { mult: v.hit / 100, skill: true, kind: "shadow" });
        addDot(w, p, t, "agony", (weaponAvg(p) * v.tick) / 100, v.dur, "shadow");
      });
      return null;
    }
    case "wl_drain_mana": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      w.emit({ t: "chain", pts: [t.x, t.y - 12, u.x, u.y - 12], k: "arcane" });
      w.hit(p, t, { mult: v.dmg / 100, skill: true, kind: "shadow" });
      const mp = Math.round((u.maxMp * v.mana) / 100);
      u.mp = Math.min(u.maxMp, u.mp + mp);
      if (w.isPlayer(t)) t.unit.mp = Math.max(0, t.unit.mp - mp);
      return null;
    }
    case "wl_skeletons": {
      const pt = pointAt();
      if (!lineClear(w.map, u.x, u.y, pt.x, pt.y)) return "Нет прямой видимости";
      c.ok();
      u.anim = Anim.Cast;
      w.later(400, () => { if (u.anim === Anim.Cast && !p.dead) u.anim = Anim.Idle; });
      w.emit({ t: "aoe", k: "shadow", x: pt.x, y: pt.y, r: v.radius });
      for (const m of w.enemiesInCircle(p, pt.x, pt.y, v.radius)) {
        w.hit(p, m, { mult: v.dmg / 100, skill: true, kind: "shadow" });
        m.rootUntil = w.time + v.root * 1000 * (w.isPlayer(m) ? 1 - m.derived.ccReduce : 1);
      }
      // скелет-прислужник вместо питомца (вне арены)
      if (w.opts.mobs !== false && p.team === 0) summonSkeleton(w, p, pt, v.dur * 1000);
      return null;
    }
    case "wl_doom": {
      const pt = pointAt();
      c.ok();
      w.emit({ t: "hazard", id: w.uid("h"), k: "poison", x: pt.x, y: pt.y, r: v.radius, ms: 1500 });
      for (const m of w.enemiesInCircle(p, pt.x, pt.y, v.radius)) {
        addDot(w, p, m, "plague", (weaponAvg(p) * v.tick) / 100, v.dur, "poison");
        weaken(w, m, v.weak, v.dur * 1000);
        c.threat(m, 30);
      }
      return null;
    }

    // ---------- Потрошитель ----------
    case "rv_lacerate": {
      const e = needTarget(); if (e) return e;
      c.ok(); face(t);
      w.emit({ t: "aoe", k: "slash", x: t.x, y: t.y, r: 34 });
      w.hit(p, t, { mult: v.dmg / 100, skill: true });
      bleed(w, p, t);
      return null;
    }
    case "rv_leap": {
      const e = needTarget(); if (e) return e;
      const d = w.dist(u, t);
      const stop = w.radiusOf(t) + PLAYER_RADIUS + 4;
      const dest = reachable(w, u.x, u.y, t.x, t.y, Math.max(0, d - stop));
      c.ok();
      w.emit({ t: "blink", id: p.id, x0: u.x, y0: u.y, x1: dest.x, y1: dest.y, k: "charge" });
      u.x = dest.x;
      u.y = dest.y;
      p.moveTo = null;
      p.targetId = t.id;
      u.target = t.id;
      face(t);
      w.emit({ t: "aoe", k: "slash", x: t.x, y: t.y, r: v.radius });
      const dealt = w.hit(p, t, { mult: v.dmg / 100, skill: true });
      for (const m of w.enemiesInCircle(p, t.x, t.y, v.radius)) if (m !== t && dealt > 0) w.hit(p, m, { flat: Math.max(1, Math.round((dealt * v.splash) / 100)), canCrit: false, skill: true, noProc: true });
      return null;
    }
    case "rv_carve": {
      c.ok();
      u.aseq = (u.aseq + 1) % 65535;
      w.emit({ t: "aoe", k: "slash", x: u.x, y: u.y, r: v.radius });
      for (const m of w.enemiesInCircle(p, u.x, u.y, v.radius)) {
        w.hit(p, m, { mult: v.dmg / 100, skill: true });
        bleed(w, p, m);
      }
      return null;
    }
    case "rv_frenzy": {
      const cost = Math.round((u.hp * v.cost) / 100);
      c.ok();
      u.hp = Math.max(1, u.hp - cost);
      if (cost > 0) w.emit({ t: "dmg", id: p.id, v: cost, k: "blood" });
      p.hasteUntil = p.frenzyUntil = w.time + v.dur * 1000;
      p.hastePct = v.haste;
      p.frenzyLeech = v.leech;
      w.emit({ t: "buff", id: p.id, k: "enrage", ms: v.dur * 1000 });
      return null;
    }
  }
  return "Умение недоступно";
}

/** Кровотечение «Рваной раны» (ранг из сохранения, минимум 1). */
function bleed(w: World, p: Player, t: Actor) {
  const r = Math.max(1, p.save.skills.rv_lacerate || 0);
  const lv = { tick: 20 + 4 * (r - 1), dur: 6, stacks: 3 };
  addDot(w, p, t, "bleed", (weaponAvg(p) * lv.tick) / 100, lv.dur, "blood", lv.stacks);
}

/** Скелет-прислужник: временный питомец (данные — data/skills.json → summons). */
function summonSkeleton(w: World, p: Player, at: { x: number; y: number }, ms: number) {
  const s = SUMMONS.wl_skeleton;
  if (!s) return;
  dismissPet(w, p);
  const def: PetDef = { ...s, id: "wl_skeleton", price: 0, level: 0, skills: [], temp: true };
  const pet = new Pet(def, p, p.level);
  if (walkable(w.map, at.x, at.y, 8)) { pet.unit.x = at.x; pet.unit.y = at.y; }
  w.pets.set(pet.id, pet);
  w.state.mobs.set(pet.id, pet.unit);
  w.emit({ t: "spawn", id: pet.id, k: "smoke" });
  w.later(ms, () => { if (w.pets.get(pet.id) === pet) dismissPet(w, p); });
}
