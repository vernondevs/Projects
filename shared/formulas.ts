import { CLASSES, type ClassId, type Stats, type StatKey } from "./classes";
import type { Item, ItemStats, Slot } from "./items";
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
  attackCd: number; // секунды
  hpRegen: number; // в секунду
  mpRegen: number;
  lifesteal: number; // 0..1
  skillMult: number;
  dmgTaken: number;
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
  for (const it of Object.values(equip)) {
    if (!it) continue;
    for (const [k, v] of Object.entries(it.stats)) out[k as keyof ItemStats] = (out[k as keyof ItemStats] || 0) + (v as number);
  }
  return out;
}

export function derive(p: PlayerCore): Derived {
  const c = CLASSES[p.cls];
  const g = gearStats(p.equip);
  if (p.foodBuff) for (const [k, v] of Object.entries(p.foodBuff)) g[k as keyof ItemStats] = (g[k as keyof ItemStats] || 0) + (v as number);
  const st = { ...c.base };
  for (const k of Object.keys(st) as StatKey[]) st[k] += (c.perLevel[k] || 0) * (p.level - 1) + (p.alloc[k] || 0) + (g[k] || 0);
  const sk = (id: string) => p.skills[id] || 0;
  const main = st[c.mainStat];
  const mult = 1 + main * 0.025;
  const w = p.equip.weapon;
  const wMin = w ? g.dmgMin || 2 : 2, wMax = w ? g.dmgMax || 4 : 4;
  return {
    stats: st,
    maxHp: Math.round((60 + st.vit * 8 + p.level * 6 + (g.hp || 0)) * (1 + 0.06 * sk("toughness"))),
    maxMp: Math.round((40 + st.int * 6 + p.level * 3) * (1 + 0.04 * sk("wisdom"))),
    dmgMin: Math.round(wMin * mult),
    dmgMax: Math.round(wMax * mult),
    armor: Math.round((g.armor || 0) + st.str * 0.5),
    crit: Math.min(0.75, 0.05 + st.agi * 0.002 + (g.crit || 0) / 100 + sk("precision") * 0.03 + sk("berserk") * 0.05),
    critMult: 1.5 + sk("berserk") * 0.1,
    attackCd: c.attackCd / (1 + st.agi * 0.004 + sk("quickhands") * 0.07),
    hpRegen: 0.6 + st.vit * 0.12,
    mpRegen: (1.5 + st.int * 0.12) * (1 + sk("wisdom") * 0.12),
    lifesteal: sk("bloodlust") * 0.03,
    skillMult: 1 + sk("focus") * 0.06,
    dmgTaken: 1 - sk("arcane_shield") * 0.05,
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
