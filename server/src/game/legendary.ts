/** Эффекты легендарных предметов (data/legendaries.json). Вызываются из World.hit / killMob. */
import { LEGENDARIES } from "../../../shared/legendary";
import type { Actor, HitOpts, World } from "./World";
import type { Mob } from "./Mob";
import type { Player } from "./Player";

type Eff = { type: string; [k: string]: number | string };

/** Эффекты надетых легендарок игрока. */
function effects(p: Player): Eff[] {
  const out: Eff[] = [];
  for (const it of Object.values(p.save.equip)) if (it?.legendary && LEGENDARIES[it.legendary]) out.push(LEGENDARIES[it.legendary].effect);
  return out;
}
const n = (e: Eff, k: string) => Number(e[k]);
const NOPROC: HitOpts = { noProc: true, canCrit: false };

/** Игрок src нанёс v урона цели dst. В PvP все дополнительные удары идут через World.hit и получают PVP_DAMAGE_MULT. */
export function onHit(w: World, src: Actor, dst: Actor, v: number, crit: boolean, o: HitOpts) {
  if (o.noProc || !w.isPlayer(src)) return;
  for (const e of effects(src)) {
    switch (e.type) {
      case "chain":
        if (Math.random() < n(e, "chance")) {
          const hit = new Set<Actor>([dst]);
          const pts = [dst.x, dst.y - 14];
          let cur: Actor = dst;
          for (let i = 0; i < n(e, "jumps"); i++) {
            let best: Actor | null = null, bd = 220;
            for (const c of w.enemiesInCircle(src, cur.x, cur.y, 220)) {
              if (hit.has(c) || !w.hostile(src, c)) continue;
              const d = w.dist(cur, c);
              if (d < bd) { bd = d; best = c; }
            }
            if (!best) break;
            hit.add(best); pts.push(best.x, best.y - 14); cur = best;
          }
          w.emit({ t: "chain", pts, k: "arcane" });
          for (const c of hit) if (c !== dst) w.hit(src, c, { ...NOPROC, kind: "arcane", flat: Math.max(1, Math.round(v * n(e, "mult"))), threat: 0.5 });
        }
        break;
      case "lifeburst":
        if (Math.random() < n(e, "chance")) w.heal(src, Math.round(src.unit.maxHp * n(e, "pct")));
        break;
      case "novacrit":
        if (crit) {
          w.emit({ t: "aoe", k: "fire", x: dst.x, y: dst.y, r: n(e, "r") });
          for (const c of w.enemiesInCircle(src, dst.x, dst.y, n(e, "r"))) if (c !== dst) w.hit(src, c, { ...NOPROC, kind: "fire", flat: Math.max(1, Math.round(v * n(e, "mult"))), threat: 0.5 });
        }
        break;
      case "frost":
        if (!w.isPlayer(dst) && Math.random() < n(e, "chance")) {
          dst.slowUntil = w.time + n(e, "ms");
          dst.slowPct = n(e, "slow");
          w.emit({ t: "aoe", k: "frost", x: dst.x, y: dst.y, r: 30 });
        }
        break;
      case "extra":
        if (Math.random() < n(e, "chance")) {
          const ms = 200;
          w.emit({ t: "proj", k: "arrow", from: src.id, to: dst.id, tx: dst.x, ty: dst.y, ms });
          const flat = Math.max(1, Math.round(v * n(e, "mult")));
          w.later(ms, () => { if (!w.isDead(dst) && w.hostile(src, dst)) w.hit(src, dst, { ...NOPROC, flat, threat: 0.5 }); });
        }
        break;
    }
  }
}

/** Входящий урон игроку: мана-щит поглощает долю урона за счёт маны. Возвращает остаток урона. */
export function absorb(w: World, dst: Actor, amount: number): number {
  if (!w.isPlayer(dst)) return amount;
  for (const e of effects(dst)) {
    if (e.type !== "manashield" || dst.unit.mp <= 0) continue;
    const take = Math.min(dst.unit.mp, amount * n(e, "pct"));
    dst.unit.mp -= take;
    amount -= take;
    dst.selfDirty = true;
  }
  return amount;
}

/** Игрок dst получил v урона от src. */
export function onDamaged(w: World, src: Actor, dst: Actor, v: number, o: HitOpts) {
  if (o.noProc || !w.isPlayer(dst) || w.isDead(dst) || w.isDead(src)) return;
  for (const e of effects(dst)) {
    if (e.type === "thorns" && w.hostile(dst, src)) w.hit(dst, src, { ...NOPROC, kind: "phys", flat: Math.max(1, Math.round(v * n(e, "pct"))), threat: 0.5 });
  }
}

/** Игрок убил моба. */
export function onKill(w: World, killer: Player, _m: Mob) {
  for (const e of effects(killer)) {
    if (e.type === "killhaste") {
      killer.hasteUntil = w.time + n(e, "ms");
      killer.hastePct = Math.max(killer.hastePct, n(e, "haste"));
      w.emit({ t: "buff", id: killer.id, k: "haste", ms: n(e, "ms") });
    }
  }
}
