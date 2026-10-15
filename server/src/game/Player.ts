import { CLASSES, classFaction, type ClassId, type FactionId, type StatKey } from "../../../shared/classes";
import { lookTint } from "../../../shared/accounts";
import { Nav } from "../../../shared/path";
import { INVENTORY_SIZE } from "../../../shared/constants";
import { MAP_VERSION } from "../../../shared/map";
import { homeCity } from "../../../shared/cities";
import { derive, xpToNext, type Derived } from "../../../shared/formulas";
import { FOOD } from "../../../shared/food";
import { MOUNTS } from "../../../shared/mounts";
import { petXpToNext } from "../../../shared/pets";
import { makeItem, Rarity, SLOTS, type Item, type Slot } from "../../../shared/items";
import { Anim, UnitKind, type LootBag, type SelfState } from "../../../shared/protocol";
import { hasUnknownSkills, starterSkill } from "../../../shared/skills";
import type { PlayerSave } from "../db";
import { Unit } from "../rooms/schema";

/** Новый герой в точке spawn (в игре — столица его фракции, см. server/src/index.ts). */
export function newSave(cls: ClassId, spawn: { x: number; y: number }): PlayerSave {
  const inventory: (Item | null)[] = new Array(INVENTORY_SIZE).fill(null);
  inventory[0] = { ...makeItem("hp_potion", 1, Rarity.Common), qty: 5 };
  inventory[1] = { ...makeItem("mp_potion", 1, Rarity.Common), qty: 3 };
  const equip = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, Item | null>;
  equip.weapon = makeItem(CLASSES[cls].startWeapon, 1, Rarity.Common);
  equip.weapon.name = "Потёртый " + equip.weapon.name.toLowerCase();
  return {
    cls,
    faction: classFaction(cls),
    level: 1,
    xp: 0,
    gold: 25,
    alloc: { str: 0, agi: 0, int: 0, vit: 0 },
    skills: { [starterSkill(cls)]: 1 },
    inventory,
    equip,
    x: spawn.x,
    y: spawn.y,
    mapVer: MAP_VERSION,
    hp: -1,
    mp: -1,
    kills: 0,
    bossKills: {},
    mobKills: {},
  };
}

export type Sender = (type: string, msg: unknown) => void;

/** Сколько после боевого действия игрок считается «в бою». */
export const COMBAT_MS = 5000;

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
  /** Щитовой блок: до какого момента, доля поглощения и отражение. */
  blockUntil = 0;
  blockPct = 0;
  blockReflect = 0;
  /** Святой щит: остаток поглощения, срок и кто наложил (лечение засчитывается ему). */
  shieldAmt = 0;
  shieldUntil = 0;
  shieldBy: Player | null = null;
  /** Ослабление (−weakPct% к наносимому урону, по умолчанию 20). */
  weakUntil = 0;
  weakPct = 20;
  /** Умбрат: проклятие и кровотечение на герое (для значков), кровавые узы, костяная броня, безумие. */
  curseUntil = 0;
  bleedUntil = 0;
  bondBy: Player | null = null;
  bondUntil = 0;
  bondShare = 0;
  boneUntil = 0;
  boneChill = 0;
  frenzyUntil = 0;
  frenzyLeech = 0;
  /** Нарушитель мира в нейтральном городе: стража бьёт его до этого момента. */
  outlawUntil = 0;
  /** Сейчас во вражеской столице (стража бьёт). */
  intruder = false;
  guardHitAt = 0;
  /** Последний рубеж: действует до / откат до. */
  lastStandUntil = 0;
  lastStandReady = 0;
  hastePct = 0;
  /** Последний момент боя: вне боя регенерация быстрее. */
  combatAt = -1e9;
  /** Последнее отправленное клиенту состояние «в бою». */
  combatSent = false;
  /** Единственный источник истины «в бою»: урон от/по враждебному актёру за последние 5 с (часы World.time). */
  inCombat(now: number): boolean {
    const d = now - this.combatAt;
    return d >= 0 && d < COMBAT_MS;
  }
  deadAt = 0;
  dead = false;
  castUntil = 0;
  potionAt = 0;
  poisonUntil = 0;
  /** Разбойник: скрытность до, гарантированный крит до, яды на целях. */
  stealthUntil = 0;
  critNextUntil = 0;
  poisons = new Map<string, { stacks: number; until: number; dmg: number }>();
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
  /** Связь оборвана: герой ждёт переподключения (RECONNECT_SEC). */
  offline = false;
  /** Выход окончательный (выход из игры, вытеснение): без ожидания переподключения. */
  noReconnect = false;
  /** Флаг администратора из БД (загружается при входе; сервер перепроверяет по БД на каждое действие). */
  admin = false;
  lastSave = 0;
  /** Призыв маунта: момент готовности и точка начала (движение отменяет). */
  mountCast: { until: number; x: number; y: number } | null = null;
  /** Каст телепорта (3 с): куда, откуда, цена. */
  tele: { until: number; x: number; y: number; to: string; price: number } | null = null;
  /** Призыв питомца (2 с на месте) и момент, когда можно призвать снова после гибели. */
  petCast: { until: number; x: number; y: number } | null = null;
  petCdUntil = 0;
  /** Последний полученный урон (World.time): прерывает выход из игры в бою. */
  hurtAt = -1e9;
  /** Выход из игры в бою: отсчёт (World.time). */
  logout: { start: number; end: number } | null = null;
  /** Аккаунт героя (общий склад). */
  accountId = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    public save: PlayerSave,
    readonly send: Sender,
  ) {
    if (save.cls === "warrior" && hasUnknownSkills(save.cls, save.skills)) {
      save.skills = { [starterSkill(save.cls)]: 1 };
      send("toast", { text: "Умения воина изменены — очки возвращены", kind: "info" });
    }
    save.faction ??= classFaction(save.cls);
    const u = this.unit;
    u.kind = UnitKind.Player;
    u.name = name;
    u.sprite = save.cls;
    u.faction = save.faction;
    u.x = save.x;
    u.y = save.y;
    u.level = save.level;
    u.anim = Anim.Idle;
    this.applyCosmetics();
    this.grantMounts();
    this.recalc();
    u.hp = save.hp > 0 ? Math.min(save.hp, u.maxHp) : u.maxHp;
    u.mp = save.mp >= 0 ? Math.min(save.mp, u.maxMp) : u.maxMp;
  }

  get cls() {
    return this.save.cls;
  }
  get faction(): FactionId {
    return this.save.faction ?? classFaction(this.save.cls);
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
    this.unit.look = lookTint(this.save.look);
  }

  /** Выдаёт бесплатные маунты по уровню. */
  grantMounts() {
    const own = (this.save.mounts ??= []);
    for (const m of Object.values(MOUNTS)) {
      if (own.includes(m.id)) continue;
      if ((m.price === 0 && this.save.level >= m.level) || (m.grantLevel > 0 && this.save.level >= m.grantLevel)) own.push(m.id);
    }
    if (!this.save.mount || !own.includes(this.save.mount)) this.save.mount = own[0] ?? "";
  }

  attackRange(): number {
    return CLASSES[this.save.cls].attackRange;
  }
  ranged(): boolean {
    return !CLASSES[this.save.cls].attack.melee;
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
    this.grantMounts();
    return {
      isAdmin: this.admin,
      mounts: this.save.mounts,
      mount: this.save.mount ?? "",
      pets: Object.fromEntries(Object.entries(this.save.pets ?? {}).map(([id, r]) => [id, { level: r.level, xp: r.xp, next: petXpToNext(r.level) }])),
      pet: this.save.pet ?? "",
      id: this.id,
      name: this.name,
      cls: this.save.cls,
      faction: this.faction,
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
      cities: this.save.cities ?? [],
      quests: this.save.quests ?? { active: {}, done: [] },
      food: this.activeFood() ? { id: this.save.food!.id, left: this.save.food!.until - Date.now() } : null,
    };
  }

  /** Погибший сохраняется в столице своей фракции (spawn — запасная точка без столицы). */
  toSave(spawn: { x: number; y: number }): PlayerSave {
    const s = this.save;
    const home = homeCity(this.faction);
    if (home.capital) spawn = home.spawn;
    s.x = this.dead ? spawn.x : this.unit.x;
    s.y = this.dead ? spawn.y : this.unit.y;
    s.mapVer = MAP_VERSION;
    s.hp = this.dead ? -1 : this.unit.hp;
    s.mp = this.unit.mp;
    return s;
  }
}
