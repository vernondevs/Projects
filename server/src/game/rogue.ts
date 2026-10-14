/** Механики разбойника: яд (стаки с периодическим уроном), «за спиной». */
import { SKILLS } from "../../../shared/skills";
import { Dir } from "../../../shared/protocol";
import type { Player } from "./Player";
import type { Actor, World } from "./World";

const FACE: Record<number, [number, number]> = { [Dir.Down]: [0, 1], [Dir.Up]: [0, -1], [Dir.Left]: [-1, 0], [Dir.Right]: [1, 0] };

/** Единичный вектор взгляда цели. */
export function facing(a: Actor): [number, number] {
  return FACE[a.unit.dir] ?? [0, 1];
}

/** Атакующий находится в задней полусфере цели. */
export function isBehind(p: Player, t: Actor): boolean {
  const [fx, fy] = facing(t);
  const dx = p.x - t.x, dy = p.y - t.y, d = Math.hypot(dx, dy) || 1;
  return (fx * dx + fy * dy) / d < -0.2;
}

/** Накладывает/усиливает яд на цель: до 3 стаков, 8 с, тик раз в секунду. */
export function applyPoison(w: World, p: Player, target: Actor, rank: number) {
  const v = SKILLS.venom.v(Math.max(1, rank));
  const d = p.derived;
  const dmg = ((d.dmgMin + d.dmgMax) / 2) * d.skillMult * (v.tick / 100);
  const cur = p.poisons.get(target.id);
  const live = cur && cur.until > w.time;
  const e = live ? cur : { stacks: 0, until: 0, dmg };
  e.stacks = Math.min(v.maxStacks, e.stacks + 1);
  e.dmg = Math.max(e.dmg, dmg);
  e.until = w.time + v.dur * 1000;
  p.poisons.set(target.id, e);
  w.emit({ t: "aoe", k: "poison", x: target.x, y: target.y, r: 28 });
  if (live) return;
  const tick = () => {
    const c = p.poisons.get(target.id);
    if (c !== e || e.until <= w.time || w.isDead(target) || w.isDead(p) || !w.hostile(p, target)) { if (c === e) p.poisons.delete(target.id); return; }
    w.hit(p, target, { flat: Math.max(1, Math.round(e.dmg * e.stacks)), canCrit: false, kind: "poison", noBreak: true, noProc: true });
    w.later(1000, tick);
  };
  w.later(1000, tick);
}

/** «Отравитель»: шанс яда при обычной атаке. */
export function rogueProc(w: World, p: Player, target: Actor) {
  const r = p.save.skills.poisoner || 0;
  if (r && Math.random() * 100 < SKILLS.poisoner.v(r).chance) applyPoison(w, p, target, p.save.skills.venom || 1);
}
