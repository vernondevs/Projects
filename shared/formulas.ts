import { CLASSES, type ClassId, type Stats, type StatKey } from "./classes";
import { BASE_ITEMS, effStats, type Item, type ItemStats, type Slot } from "./items";
import { MAX_LEVEL } from "./constants";
import type { MobDef } from "./mobs";

export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(20 + 30 * Math.pow(level, 1.65));
}

export interface Derived {
  stats: Stats;
  maxHp: number;
  maxMp: number;
  dmgMin: number;
  dmgMax: number;
  armor: number;
  crit: number; // 0..1
  critMult: number;
  /** Шанс полностью избежать удара (Ловкость), 0..DODGE_CAP. */
  dodge: number;
  attackCd: number; // секунды
  hpRegen: number; // в секунду
  mpRegen: number;
  lifesteal: number; // 0..1
  /** Сила умений: Интеллект и талант «Сосредоточенность». */
  skillMult: number;
  dmgTaken: number;
  /** Сокращение длительности контроля, 0..1. */
  ccReduce: number;
  bossMult: number;
}

export interface PlayerCore {
  cls: ClassId;
  level: number;
  alloc: Stats;
  skills: Record<string, number>;
  equip: Partial<Record<Slot, Item | null>>;
  /** Бонусы активной еды (срок действия проверен вызывающим). */
  foodBuff?: ItemStats | null;
}

export function gearStats(equip: PlayerCore["equip"]): ItemStats {
  const out: ItemStats = {};
  for (const [slot, it] of Object.entries(equip)) {
    if (!it) continue;
    const half = slot === "offhand" && BASE_ITEMS[it.base]?.slot === "weapon";
    for (const [k, v] of Object.entries(effStats(it))) out[k as keyof ItemStats] = (out[k as keyof ItemStats] || 0) + (half && (k === "dmgMin" || k === "dmgMax") ? Math.round((v as number) * 0.5) : (v as number));
  }
  return out;
}

/** Вклад характеристик (главная характеристика — ClassDef.mainK). */
export const STAT_K = {
  baseHp: 58,
  strDmg: 0.005, // Сила: +% урона за очко (не воину — у него Сила главная)
  strHp: 1.5, // Сила: здоровье за очко
  agiCrit: 0.002, // Ловкость: шанс крита за очко
  agiDodge: 0.0006, // Ловкость: уклонение за очко
  agiRanged: 0.005, // Ловкость: +% урона дальнего боя (магу)
  intSkill: 0.0015, // Интеллект: +% силы умений за очко
  vitHp: 7, // Выносливость: здоровье за очко
  vitArmor: 0.35, // Выносливость: броня за очко
};
/** Предел уклонения. */
export const DODGE_CAP = 0.3;

export function derive(p: PlayerCore): Derived {
  const c = CLASSES[p.cls];
  const g = gearStats(p.equip);
  if (p.foodBuff) for (const [k, v] of Object.entries(p.foodBuff)) g[k as keyof ItemStats] = (g[k as keyof ItemStats] || 0) + (v as number);
  const st = { ...c.base };
  for (const k of Object.keys(st) as StatKey[]) st[k] += (c.perLevel[k] || 0) * (p.level - 1) + (p.alloc[k] || 0) + (g[k] || 0);
  const sk = (id: string) => p.skills[id] || 0;
  // главная характеристика класса — основной урон; Сила — немного урона всем, Ловкость — урон дальнего боя
  let mult = 1 + st[c.mainStat] * c.mainK;
  if (c.mainStat !== "str") mult += st.str * STAT_K.strDmg;
  if (c.projectile && c.mainStat !== "agi") mult += st.agi * STAT_K.agiRanged;
  const w = p.equip.weapon;
  const wMin = w ? g.dmgMin || 2 : 2, wMax = w ? g.dmgMax || 4 : 4;
  return {
    stats: st,
    maxHp: Math.round(STAT_K.baseHp + st.vit * STAT_K.vitHp + st.str * STAT_K.strHp + p.level * 6 + (g.hp || 0)),
    maxMp: Math.round((40 + st.int * 6 + p.level * 3) * (1 + 0.04 * sk("wisdom") + 0.03 * sk("insight"))),
    dmgMin: Math.round(wMin * mult),
    dmgMax: Math.round(wMax * mult),
    armor: Math.round(((g.armor || 0) + st.vit * STAT_K.vitArmor) * (1 + 0.06 * sk("toughness"))),
    crit: Math.min(0.75, 0.05 + st.agi * STAT_K.agiCrit + (g.crit || 0) / 100 + sk("precision") * 0.03),
    critMult: 1.5 + sk("deadly") * 0.12,
    dodge: Math.min(DODGE_CAP, st.agi * STAT_K.agiDodge + sk("evasion") * 0.02),
    attackCd: c.attackCd / (1 + st.agi * 0.004 + sk("quickhands") * 0.07),
    hpRegen: 0.6 + st.vit * 0.12,
    mpRegen: (1.5 + st.int * 0.12) * (1 + sk("wisdom") * 0.12 + sk("insight") * 0.12),
    lifesteal: sk("bloodlust") * 0.03,
    skillMult: (1 + sk("focus") * 0.06) * (1 + st.int * STAT_K.intSkill),
    dmgTaken: 1 - sk("arcane_shield") * 0.05 - sk("toughness") * 0.02,
    ccReduce: sk("unbending") * 0.15,
    bossMult: 1 + sk("hunter") * 0.1,
  };
}

/** Доля урона, снимаемая бронёй. */
export function armorReduction(armor: number, attackerLevel: number): number {
  return armor / (armor + 40 + attackerLevel * 12);
}

export interface MobStats {
  maxHp: number;
  dmg: number;
  armor: number;
  xp: number;
  gold: [number, number];
}
export function mobStats(def: MobDef, level: number): MobStats {
  return {
    maxHp: Math.round((30 + level * 22 + level * level * 0.6) * def.hp),
    dmg: (4 + level * 2.6) * def.dmg,
    armor: Math.round(level * 2.5 * def.armor),
    xp: Math.round((12 + level * 9) * def.xp),
    gold: [Math.round(level * def.xp), Math.round(level * 3 * def.xp) + 2],
  };
}

/** Опыт за моба с учётом разницы уровней: серые мобы почти ничего не дают. */
export function xpForKill(base: number, mobLevel: number, playerLevel: number): number {
  const diff = mobLevel - playerLevel;
  const k = diff >= 0 ? 1 + Math.min(diff, 5) * 0.1 : Math.max(0.1, 1 + diff * 0.15);
  return Math.max(1, Math.round(base * k));
}
