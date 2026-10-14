import { mobStats, type MobStats } from "../../../shared/formulas";
import { Nav } from "../../../shared/path";
import type { MobDef } from "../../../shared/mobs";
import { Anim, UnitKind } from "../../../shared/protocol";
import { Unit } from "../rooms/schema";

export type MobState = "idle" | "chase" | "return" | "dead";

export class Mob {
  readonly unit = new Unit();
  stats: MobStats;
  state: MobState = "idle";
  targetId: string | null = null;
  nav = new Nav();
  attackAt = 0;
  wanderAt = 0;
  wanderTo: { x: number; y: number } | null = null;
  stunUntil = 0;
  rootUntil = 0;
  slowUntil = 0;
  slowPct = 0;
  /** Кто сколько урона нанёс: для опыта, лута и угрозы. */
  damageBy = new Map<string, number>();
  threat = new Map<string, number>();
  deadAt = 0;
  respawnAt = 0;
  lastHitAt = 0;
  /** Помощник босса (саженцы, бесы): не возрождается. */
  summoned = false;
  /** Контроллер босса (фазы и способности). */
  boss: { update(dt: number): void; reset(): void; onDeath(): void } | null = null;

  constructor(
    readonly id: string,
    readonly def: MobDef,
    public level: number,
    readonly home: { x: number; y: number },
  ) {
    this.stats = mobStats(def, level);
    const u = this.unit;
    u.kind = def.boss ? UnitKind.Boss : UnitKind.Mob;
    u.name = def.name;
    u.sprite = def.sprite;
    u.level = level;
    this.reset();
  }

  get x() {
    return this.unit.x;
  }
  get y() {
    return this.unit.y;
  }
  get dead() {
    return this.state === "dead";
  }

  reset() {
    const u = this.unit;
    u.x = this.home.x;
    u.y = this.home.y;
    u.maxHp = this.stats.maxHp;
    u.hp = this.stats.maxHp;
    u.anim = Anim.Idle;
    u.buffs = 0;
    u.phase = 0;
    u.target = "";
    this.state = "idle";
    this.targetId = null;
    this.damageBy.clear();
    this.threat.clear();
    this.stunUntil = this.rootUntil = this.slowUntil = 0;
    this.boss?.reset();
  }

  addThreat(pid: string, v: number) {
    this.threat.set(pid, (this.threat.get(pid) || 0) + v);
  }
}
