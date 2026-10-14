import { CLASSES, type ClassId, type StatKey } from "../../../shared/classes";
import { Nav } from "../../../shared/path";
import { INVENTORY_SIZE } from "../../../shared/constants";
import { derive, xpToNext, type Derived } from "../../../shared/formulas";
import { FOOD } from "../../../shared/food";
import { makeItem, Rarity, SLOTS, type Item, type Slot } from "../../../shared/items";
import { Anim, UnitKind, type LootBag, type SelfState } from "../../../shared/protocol";
import { starterSkill } from "../../../shared/skills";
import type { PlayerSave } from "../db";
import { Unit } from "../rooms/schema";

export function newSave(cls: ClassId, spawn: { x: number; y: number }): PlayerSave {
  const inventory: (Item | null)[] = new Array(INVENTORY_SIZE).fill(null);
  inventory[0] = { ...makeItem("hp_potion", 1, Rarity.Common), qty: 5 };
  inventory[1] = { ...makeItem("mp_potion", 1, Rarity.Common), qty: 3 };
  const equip = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, Item | null>;
  equip.weapon = makeItem(CLASSES[cls].startWeapon, 1, Rarity.Common);
  equip.weapon.name = "Потёртый " + equip.weapon.name.toLowerCase();
  return {
    cls,
    level: 1,
    xp: 0,
    gold: 25,
    alloc: { str: 0, agi: 0, int: 0, vit: 0 },
    skills: { [starterSkill(cls)]: 1 },
    inventory,
    equip,
    x: spawn.x,
    y: spawn.y,
    hp: -1,
    mp: -1,
    kills: 0,
    bossKills: {},
    mobKills: {},
  };
}

export type Sender = (type: string, msg: unknown) => void;

export class Player {
  readonly unit = new Unit();
  derived!: Derived;

  input = { mx: 0, my: 0 };
  moveTo: { x: number; y: number } | null = null;
  targetId: string | null = null;
  nav = new Nav();

  attackAt = 0;
  cds = new Map<string, number>();
  stunUntil = 0;
  rootUntil = 0;
  slowUntil = 0;
  slowPct = 0;
  warcryUntil = 0;
  warcryDmg = 0;
  warcryArmor = 0;
  hasteUntil = 0;
  hastePct = 0;
  /** Последний момент боя: вне боя регенерация быстрее. */
  combatAt = -1e9;
  deadAt = 0;
  dead = false;
  castUntil = 0;
  potionAt = 0;
  poisonUntil = 0;
  burnUntil = 0;
  regenAcc = 0;
  manaAcc = 0;
  bags = new Map<string, LootBag>();
  bagsDirty = false;
  /** Только для тестов: гарантированный лут. */
  forceDrop = false;
  selfDirty = true;
  lastChat = 0;
  /** Арена: номер команды (0 — вне арены), заморозка до начала боя, флаги переходов. */
  team = 0;
  frozenUntil = 0;
  goingToArena = false;
  goingHome = false;
  lastSave = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    public save: PlayerSave,
    readonly send: Sender,
  ) {
    const u = this.unit;
    u.kind = UnitKind.Player;
    u.name = name;
    u.sprite = save.cls;
    u.x = save.x;
    u.y = save.y;
    u.level = save.level;
    u.anim = Anim.Idle;
    this.applyCosmetics();
    this.recalc();
    u.hp = save.hp > 0 ? Math.min(save.hp, u.maxHp) : u.maxHp;
    u.mp = save.mp >= 0 ? Math.min(save.mp, u.maxMp) : u.maxMp;
  }

  get cls() {
    return this.save.cls;
  }
  get level() {
    return this.save.level;
  }
  get x() {
    return this.unit.x;
  }
  get y() {
    return this.unit.y;
  }

  /** Титул и рамка арены видны над героем. */
  applyCosmetics() {
    this.unit.title = this.save.title ?? "";
    this.unit.frame = this.save.frame ?? "";
  }

  attackRange(): number {
    return CLASSES[this.save.cls].attackRange;
  }
  ranged(): boolean {
    return this.save.cls !== "warrior";
  }

  recalc() {
    this.derived = derive({ cls: this.save.cls, level: this.save.level, alloc: this.save.alloc, skills: this.save.skills, equip: this.save.equip, foodBuff: this.activeFood()?.stats });
    const u = this.unit;
    u.maxHp = this.derived.maxHp;
    u.maxMp = this.derived.maxMp;
    u.hp = Math.min(u.hp, u.maxHp);
    u.mp = Math.min(u.mp, u.maxMp);
    u.level = this.save.level;
    const w = this.save.equip.weapon;
    u.weapon = w ? `${w.base}:${w.rarity}` : "";
    this.selfDirty = true;
  }

  /** Действующая еда (null — нет или истекла). */
  activeFood() {
    const f = this.save.food;
    return f && f.until > Date.now() ? FOOD[f.id] ?? null : null;
  }
  /** Снять истёкшую еду и пересчитать характеристики. */
  checkFood() {
    if (this.save.food && !this.activeFood()) {
      this.save.food = null;
      this.recalc();
      this.send("toast", { text: "Действие еды закончилось", kind: "info" });
    }
  }

  statPoints(): number {
    const spent = (Object.values(this.save.alloc) as number[]).reduce((a, b) => a + b, 0);
    return (this.save.level - 1) * 3 - spent;
  }
  skillPoints(): number {
    const spent = Object.values(this.save.skills).reduce((a, b) => a + b, 0);
    return this.save.level - spent; // одно очко за уровень, стартовое умение уже вложено
  }

  allocate(stat: StatKey): boolean {
    if (this.statPoints() <= 0) return false;
    this.save.alloc[stat]++;
    const oldMax = this.unit.maxHp;
    this.recalc();
    if (stat === "vit") this.unit.hp += this.unit.maxHp - oldMax;
    return true;
  }

  selfState(): SelfState {
    return {
      id: this.id,
      name: this.name,
      cls: this.save.cls,
      level: this.save.level,
      xp: this.save.xp,
      xpNext: xpToNext(this.save.level),
      gold: this.save.gold,
      alloc: this.save.alloc,
      statPoints: this.statPoints(),
      skillPoints: this.skillPoints(),
      skills: this.save.skills,
      inventory: this.save.inventory,
      equip: this.save.equip,
      derived: this.derived,
      kills: this.save.kills,
      bossKills: this.save.bossKills,
      mobKills: (this.save.mobKills ??= {}),
      food: this.activeFood() ? { id: this.save.food!.id, left: this.save.food!.until - Date.now() } : null,
    };
  }

  toSave(spawn: { x: number; y: number }): PlayerSave {
    const s = this.save;
    s.x = this.dead ? spawn.x : this.unit.x;
    s.y = this.dead ? spawn.y : this.unit.y;
    s.hp = this.dead ? -1 : this.unit.hp;
    s.mp = this.unit.mp;
    return s;
  }
}
