/**
 * Боссы: фазы по порогам здоровья, способности с телеграфом (игрок видит зону удара заранее), помощники.
 *  - Древний Энт: корни под игроками, удар по земле конусом; во 2-й фазе — саженцы и буря листьев вокруг.
 *  - Болотная Ведьма: ядовитые лужи; во 2-й — телепорты с новой и утопленники; в 3-й — ярость.
 *  - Повелитель Пепла: огненное дыхание и сокрушение; во 2-й — метеоритный дождь; в 3-й — кольцо пламени и бесы.
 */
import { MOBS } from "../../../shared/mobs";
import { Anim, BUFF_ENRAGE } from "../../../shared/protocol";
import { walkable } from "../../../shared/map";
import { Mob } from "./Mob";
import type { Player } from "./Player";
import type { World } from "./World";

type Ability = { every: number; at: number; phases: number[]; run: () => void };

abstract class Boss {
  casting = false;
  protected phase = 0;
  protected abilities: Ability[] = [];
  protected adds = new Set<Mob>();
  protected yells: string[] = [];

  constructor(
    protected w: World,
    protected m: Mob,
    protected arena: number,
  ) {}

  protected abstract thresholds: number[];
  protected abstract onPhase(n: number): void;

  protected ability(every: number, phases: number[], run: () => void, firstDelay = every * 0.5) {
    this.abilities.push({ every, at: firstDelay, phases, run });
  }
  protected say(text: string) {
    this.w.emit({ t: "say", id: this.m.id, text });
  }
  protected inArena(): Player[] {
    return this.w.playersInCircle(this.m.home.x, this.m.home.y, this.arena + 120);
  }
  protected randomPlayers(n: number): Player[] {
    const list = this.inArena().sort(() => Math.random() - 0.5);
    return list.slice(0, n);
  }
  protected target(): Player | undefined {
    return this.m.targetId ? this.w.players.get(this.m.targetId) : undefined;
  }
  /** Короткая остановка на время каста. */
  protected cast(ms: number) {
    this.casting = true;
    this.m.unit.anim = Anim.Cast;
    this.m.unit.aseq = (this.m.unit.aseq + 1) % 65535;
    this.w.later(ms, () => {
      this.casting = false;
      if (!this.m.dead) this.m.unit.anim = Anim.Idle;
    });
  }
  protected summon(id: string, count: number, radius = 90) {
    const def = MOBS[id];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      let x = this.m.x + Math.cos(a) * radius, y = this.m.y + Math.sin(a) * radius;
      if (!walkable(this.w.map, x, y, 10)) { x = this.m.x; y = this.m.y; }
      const add = new Mob(this.w.uid("s"), def, Math.max(1, this.m.level - 3), { x, y });
      add.summoned = true;
      add.state = "chase";
      const t = this.target();
      if (t) add.addThreat(t.id, 50);
      this.w.addMob(add);
      this.adds.add(add);
      this.w.emit({ t: "spawn", id: add.id, k: id === "sapling" ? "nature" : "smoke" });
    }
  }

  update(dt: number) {
    const m = this.m;
    if (m.state !== "chase") return;
    const hp = m.unit.hp / m.unit.maxHp;
    let ph = 0;
    this.thresholds.forEach((t, i) => { if (hp <= t) ph = i + 1; });
    if (ph > this.phase) {
      this.phase = ph;
      m.unit.phase = ph;
      if (this.yells[ph]) this.say(this.yells[ph]);
      this.onPhase(ph);
    }
    if (this.casting) return;
    for (const a of this.abilities) {
      if (!a.phases.includes(this.phase)) continue;
      a.at -= dt;
      if (a.at <= 0) {
        a.at = a.every;
        a.run();
        if (this.casting) break;
      }
    }
  }

  reset() {
    this.phase = 0;
    this.casting = false;
    this.m.unit.phase = 0;
    this.m.unit.buffs &= ~BUFF_ENRAGE;
    for (const a of this.abilities) a.at = a.every * 0.5;
    for (const add of this.adds) if (!add.dead) this.w.removeMob(add);
    this.adds.clear();
  }

  onDeath() {
    this.say(this.yells[this.yells.length - 1] ?? "...");
    for (const add of this.adds) if (!add.dead) this.w.killMob(add);
    this.adds.clear();
    this.casting = false;
  }
}

class Ent extends Boss {
  protected thresholds = [0.5];
  protected override yells = ["", "Лес поднимется против вас!", "Корни... уходят... в землю..."];
  constructor(w: World, m: Mob, arena: number) {
    super(w, m, arena);
    const dmg = () => this.m.stats.dmg;
    // корни под ногами у игроков
    this.ability(7, [0], () => this.roots(3));
    this.ability(4.5, [1], () => this.roots(4));
    // удар по земле конусом в сторону цели
    this.ability(9, [0, 1], () => {
      const t = this.target();
      if (!t) return;
      const a = Math.atan2(t.y - m.y, t.x - m.x);
      this.cast(1000);
      w.telegraph(m, "cone", m.x, m.y, 150, 950, (p) => w.hit(m, p, { flat: dmg() * 2.2, kind: "nature" }), { a, w: 1.4, k: "nature" });
    });
    // буря листьев: всё вокруг энта, нужно отбежать
    this.ability(12, [1], () => {
      this.cast(1700);
      w.telegraph(m, "circle", m.x, m.y, 175, 1600, (p) => w.hit(m, p, { flat: dmg() * 2.6, kind: "nature" }), { k: "nature" });
    }, 2);
    this.ability(15, [1], () => this.summon("sapling", 3), 1);
  }
  private roots(n: number) {
    for (const p of this.randomPlayers(n))
      this.w.telegraph(this.m, "circle", p.x, p.y, 54, 1300, (q) => {
        this.w.hit(this.m, q, { flat: this.m.stats.dmg * 1.3, kind: "nature" });
        q.rootUntil = this.w.time + 1500;
      }, { k: "nature" });
  }
  protected onPhase() {
    this.summon("sapling", 3);
  }
}

class Witch extends Boss {
  protected thresholds = [0.6, 0.25];
  protected override yells = ["", "Топь заберёт ваши кости!", "Довольно! Вы сгниёте здесь!", "Нет... моё болото..."];
  constructor(w: World, m: Mob, arena: number) {
    super(w, m, arena);
    const dmg = () => this.m.stats.dmg;
    const pools = (n: number) => {
      const spots = this.randomPlayers(n).map((p) => ({ x: p.x, y: p.y }));
      for (const s of spots) w.telegraph(m, "circle", s.x, s.y, 62, 900, () => {}, { k: "poison" });
      w.later(900, () => { if (!m.dead) for (const s of spots) w.addHazard(m, s.x, s.y, 62, 6500, dmg() * 0.9, "poison"); });
    };
    this.ability(6, [0, 1], () => pools(2));
    this.ability(4, [2], () => pools(5));
    this.ability(10, [1, 2], () => {
      // телепорт в случайную точку арены и ядовитая нова
      const a = Math.random() * Math.PI * 2, r = Math.random() * this.arena * 0.7;
      const x = m.home.x + Math.cos(a) * r, y = m.home.y + Math.sin(a) * r;
      if (!walkable(w.map, x, y, 14)) return;
      w.emit({ t: "blink", id: m.id, x0: m.x, y0: m.y, x1: x, y1: y });
      m.unit.x = x;
      m.unit.y = y;
      this.cast(1300);
      w.telegraph(m, "circle", x, y, 140, 1200, (p) => { w.hit(m, p, { flat: dmg() * 2.3, kind: "poison" }); p.poisonUntil = w.time + 3000; }, { k: "poison" });
    }, 1);
    this.ability(18, [1, 2], () => this.summon("drowned", 2), 3);
  }
  protected onPhase(n: number) {
    if (n === 2) {
      this.m.unit.buffs |= BUFF_ENRAGE;
      this.w.emit({ t: "buff", id: this.m.id, k: "enrage", ms: 0 });
    }
  }
}

class AshLord extends Boss {
  protected thresholds = [0.66, 0.33];
  protected override yells = ["", "Пепел к пеплу! Небо падёт на вас!", "ГОРИТЕ! ВСЕ ГОРИТЕ!", "Пламя... гаснет..."];
  constructor(w: World, m: Mob, arena: number) {
    super(w, m, arena);
    const dmg = () => this.m.stats.dmg;
    this.ability(8, [0, 1, 2], () => {
      const t = this.target();
      if (!t) return;
      const a = Math.atan2(t.y - m.y, t.x - m.x);
      this.cast(1100);
      w.telegraph(m, "cone", m.x, m.y, 210, 1000, (p) => { w.hit(m, p, { flat: dmg() * 2.6, kind: "fire" }); p.burnUntil = w.time + 2500; }, { a, w: 1.1, k: "fire" });
    });
    this.ability(10, [0, 1, 2], () => {
      this.cast(950);
      w.telegraph(m, "circle", m.x, m.y, 105, 900, (p) => w.hit(m, p, { flat: dmg() * 2, kind: "fire" }), { k: "fire" });
    }, 4);
    this.ability(12, [1, 2], () => {
      const targets = this.inArena();
      for (let i = 0; i < 7; i++) {
        const p = targets[i % Math.max(1, targets.length)];
        if (!p) break;
        const x = p.x + (Math.random() - 0.5) * 180, y = p.y + (Math.random() - 0.5) * 140;
        w.later(i * 120, () => w.telegraph(m, "circle", x, y, 60, 1400, (q) => w.hit(m, q, { flat: dmg() * 2.2, kind: "fire" }), { k: "fire" }));
      }
    }, 1);
    this.ability(14, [2], () => {
      this.cast(1900);
      w.telegraph(m, "ring", m.x, m.y, 105, 1800, (p) => { w.hit(m, p, { flat: dmg() * 3, kind: "fire" }); p.burnUntil = w.time + 3000; }, { r2: this.arena + 60, k: "fire" });
    }, 2);
    this.ability(20, [2], () => this.summon("imp", 2), 5);
  }
  protected onPhase(n: number) {
    if (n === 2) {
      this.m.unit.buffs |= BUFF_ENRAGE;
      this.w.emit({ t: "buff", id: this.m.id, k: "enrage", ms: 0 });
      this.summon("imp", 2);
    }
  }
}

export function createBoss(w: World, m: Mob, arena: number) {
  switch (m.def.id) {
    case "ent": return new Ent(w, m, arena);
    case "witch": return new Witch(w, m, arena);
    case "ashlord": return new AshLord(w, m, arena);
  }
  return null;
}
