import type { ClassId } from "./classes";

export type SkillTarget = "enemy" | "point" | "self";

export interface SkillDef {
  id: string;
  cls: ClassId;
  name: string;
  kind: "active" | "passive";
  /** Клавиша 1–4 для активных умений. */
  slot?: number;
  maxRank: number;
  reqLevel: number;
  req?: { id: string; rank: number };
  icon: string;
  target?: SkillTarget;
  range?: number;
  cd?: (r: number) => number; // секунды
  mana?: (r: number) => number;
  /** Числовые параметры умения на ранге r (урон в процентах от урона оружия и т.п.). */
  v: (r: number) => Record<string, number>;
  desc: (r: number) => string;
  /** Позиция в дереве: строка (ярус) и столбец. */
  tree: [number, number];
}

const pct = (n: number) => `${Math.round(n)}%`;

export const SKILLS: Record<string, SkillDef> = {
  // ---------------- Воин ----------------
  cleave: {
    id: "cleave", cls: "warrior", name: "Рассекающий удар", kind: "active", slot: 0, maxRank: 5, reqLevel: 1, icon: "sk_cleave",
    target: "point", range: 85, cd: () => 4, mana: () => 8,
    v: (r) => ({ dmg: 140 + 20 * (r - 1), radius: 85, arc: 110 }),
    desc: (r) => `Широкий удар перед собой: ${pct(140 + 20 * (r - 1))} урона оружия всем врагам в дуге.`,
    tree: [0, 1],
  },
  charge: {
    id: "charge", cls: "warrior", name: "Рывок", kind: "active", slot: 1, maxRank: 5, reqLevel: 3, req: { id: "cleave", rank: 1 }, icon: "sk_charge",
    target: "enemy", range: 300, cd: (r) => 10 - 0.5 * (r - 1), mana: () => 12,
    v: (r) => ({ dmg: 120 + 15 * (r - 1), stun: 0.8 + 0.2 * (r - 1) }),
    desc: (r) => `Бросок к врагу: ${pct(120 + 15 * (r - 1))} урона и оглушение на ${(0.8 + 0.2 * (r - 1)).toFixed(1)} с.`,
    tree: [1, 0],
  },
  toughness: {
    id: "toughness", cls: "warrior", name: "Закалка", kind: "passive", maxRank: 5, reqLevel: 5, icon: "sk_toughness",
    v: (r) => ({ hp: 6 * r }),
    desc: (r) => `Максимальное здоровье +${6 * Math.max(1, r)}%.`,
    tree: [1, 2],
  },
  warcry: {
    id: "warcry", cls: "warrior", name: "Боевой клич", kind: "active", slot: 2, maxRank: 5, reqLevel: 8, req: { id: "charge", rank: 1 }, icon: "sk_warcry",
    target: "self", range: 0, cd: () => 22, mana: () => 15,
    v: (r) => ({ dmg: 15 + 5 * r, armor: 10 * r, dur: 8, radius: 220 }),
    desc: (r) => `На 8 с вы и союзники рядом наносите +${15 + 5 * r}% урона и получаете +${10 * r} брони.`,
    tree: [2, 0],
  },
  bloodlust: {
    id: "bloodlust", cls: "warrior", name: "Кровожадность", kind: "passive", maxRank: 3, reqLevel: 10, req: { id: "cleave", rank: 3 }, icon: "sk_bloodlust",
    v: (r) => ({ lifesteal: 3 * r }),
    desc: (r) => `${3 * Math.max(1, r)}% нанесённого урона возвращается здоровьем.`,
    tree: [2, 2],
  },
  whirlwind: {
    id: "whirlwind", cls: "warrior", name: "Вихрь", kind: "active", slot: 3, maxRank: 5, reqLevel: 15, req: { id: "warcry", rank: 1 }, icon: "sk_whirlwind",
    target: "self", range: 0, cd: () => 14, mana: () => 25,
    v: (r) => ({ dmg: 70 + 12 * (r - 1), pulses: 4, radius: 110 }),
    desc: (r) => `Вращение с оружием: 4 удара по ${pct(70 + 12 * (r - 1))} урона всем вокруг.`,
    tree: [3, 1],
  },
  berserk: {
    id: "berserk", cls: "warrior", name: "Берсерк", kind: "passive", maxRank: 3, reqLevel: 20, req: { id: "whirlwind", rank: 1 }, icon: "sk_berserk",
    v: (r) => ({ crit: 5 * r, critDmg: 10 * r }),
    desc: (r) => `Шанс крита +${5 * Math.max(1, r)}%, урон крита +${10 * Math.max(1, r)}%.`,
    tree: [4, 1],
  },

  // ---------------- Маг ----------------
  fireball: {
    id: "fireball", cls: "mage", name: "Огненный шар", kind: "active", slot: 0, maxRank: 5, reqLevel: 1, icon: "sk_fireball",
    target: "point", range: 340, cd: () => 2.2, mana: () => 8,
    v: (r) => ({ dmg: 160 + 25 * (r - 1), splash: 55 }),
    desc: (r) => `Огненный шар: ${pct(160 + 25 * (r - 1))} урона цели и половина урона врагам рядом.`,
    tree: [0, 1],
  },
  frostnova: {
    id: "frostnova", cls: "mage", name: "Ледяная нова", kind: "active", slot: 1, maxRank: 5, reqLevel: 3, req: { id: "fireball", rank: 1 }, icon: "sk_frostnova",
    target: "self", range: 0, cd: () => 9, mana: () => 16,
    v: (r) => ({ dmg: 90 + 15 * (r - 1), radius: 135, slow: 50, dur: 2.5 + 0.5 * (r - 1) }),
    desc: (r) => `Волна холода вокруг: ${pct(90 + 15 * (r - 1))} урона и замедление на 50% на ${(2.5 + 0.5 * (r - 1)).toFixed(1)} с.`,
    tree: [1, 0],
  },
  wisdom: {
    id: "wisdom", cls: "mage", name: "Мудрость", kind: "passive", maxRank: 5, reqLevel: 5, icon: "sk_wisdom",
    v: (r) => ({ regen: 12 * r, mana: 4 * r }),
    desc: (r) => `Восстановление маны +${12 * Math.max(1, r)}%, запас маны +${4 * Math.max(1, r)}%.`,
    tree: [1, 2],
  },
  blink: {
    id: "blink", cls: "mage", name: "Мерцание", kind: "active", slot: 2, maxRank: 5, reqLevel: 8, req: { id: "frostnova", rank: 1 }, icon: "sk_blink",
    target: "point", range: 0, cd: (r) => 9 - 0.6 * (r - 1), mana: () => 12,
    v: (r) => ({ dist: 200 + 20 * (r - 1) }),
    desc: (r) => `Мгновенный перенос к курсору на ${200 + 20 * (r - 1)} пикселей.`,
    tree: [2, 0],
  },
  focus: {
    id: "focus", cls: "mage", name: "Концентрация", kind: "passive", maxRank: 3, reqLevel: 10, req: { id: "fireball", rank: 3 }, icon: "sk_focus",
    v: (r) => ({ skill: 6 * r }),
    desc: (r) => `Урон умений +${6 * Math.max(1, r)}%.`,
    tree: [2, 2],
  },
  meteor: {
    id: "meteor", cls: "mage", name: "Метеор", kind: "active", slot: 3, maxRank: 5, reqLevel: 15, req: { id: "blink", rank: 1 }, icon: "sk_meteor",
    target: "point", range: 340, cd: () => 16, mana: () => 35,
    v: (r) => ({ dmg: 380 + 60 * (r - 1), radius: 110, delay: 1 }),
    desc: (r) => `Через секунду в точку падает метеор: ${pct(380 + 60 * (r - 1))} урона по площади.`,
    tree: [3, 1],
  },
  arcane_shield: {
    id: "arcane_shield", cls: "mage", name: "Чародейский щит", kind: "passive", maxRank: 3, reqLevel: 20, req: { id: "meteor", rank: 1 }, icon: "sk_shield",
    v: (r) => ({ reduce: 5 * r }),
    desc: (r) => `Получаемый урон −${5 * Math.max(1, r)}%.`,
    tree: [4, 1],
  },

  // ---------------- Лучник ----------------
  aimed: {
    id: "aimed", cls: "ranger", name: "Прицельный выстрел", kind: "active", slot: 0, maxRank: 5, reqLevel: 1, icon: "sk_aimed",
    target: "enemy", range: 340, cd: () => 4, mana: () => 8,
    v: (r) => ({ dmg: 220 + 35 * (r - 1) }),
    desc: (r) => `Мощный выстрел в цель: ${pct(220 + 35 * (r - 1))} урона оружия.`,
    tree: [0, 1],
  },
  volley: {
    id: "volley", cls: "ranger", name: "Залп", kind: "active", slot: 1, maxRank: 5, reqLevel: 3, req: { id: "aimed", rank: 1 }, icon: "sk_volley",
    target: "point", range: 300, cd: () => 8, mana: () => 14,
    v: (r) => ({ dmg: 75 + 12 * (r - 1), arrows: 5 + Math.floor((r - 1) / 2), arc: 50 }),
    desc: (r) => `Веер из ${5 + Math.floor((r - 1) / 2)} стрел, каждая наносит ${pct(75 + 12 * (r - 1))} урона.`,
    tree: [1, 0],
  },
  precision: {
    id: "precision", cls: "ranger", name: "Меткость", kind: "passive", maxRank: 5, reqLevel: 5, icon: "sk_precision",
    v: (r) => ({ crit: 3 * r }),
    desc: (r) => `Шанс крита +${3 * Math.max(1, r)}%.`,
    tree: [1, 2],
  },
  roll: {
    id: "roll", cls: "ranger", name: "Перекат", kind: "active", slot: 2, maxRank: 5, reqLevel: 8, req: { id: "volley", rank: 1 }, icon: "sk_roll",
    target: "point", range: 0, cd: (r) => 8 - 0.5 * (r - 1), mana: () => 10,
    v: (r) => ({ dist: 170, haste: 40 + 10 * (r - 1), dur: 3 }),
    desc: (r) => `Перекат к курсору, затем 3 с скорость атаки +${40 + 10 * (r - 1)}%.`,
    tree: [2, 0],
  },
  quickhands: {
    id: "quickhands", cls: "ranger", name: "Быстрые руки", kind: "passive", maxRank: 3, reqLevel: 10, req: { id: "aimed", rank: 3 }, icon: "sk_quickhands",
    v: (r) => ({ haste: 7 * r }),
    desc: (r) => `Скорость атаки +${7 * Math.max(1, r)}%.`,
    tree: [2, 2],
  },
  rain: {
    id: "rain", cls: "ranger", name: "Град стрел", kind: "active", slot: 3, maxRank: 5, reqLevel: 15, req: { id: "roll", rank: 1 }, icon: "sk_rain",
    target: "point", range: 320, cd: () => 15, mana: () => 30,
    v: (r) => ({ dmg: 55 + 10 * (r - 1), ticks: 6, radius: 120, slow: 30 }),
    desc: (r) => `Ливень стрел на 3 с: 6 волн по ${pct(55 + 10 * (r - 1))} урона и замедление.`,
    tree: [3, 1],
  },
  hunter: {
    id: "hunter", cls: "ranger", name: "Охотник на чудовищ", kind: "passive", maxRank: 3, reqLevel: 20, req: { id: "rain", rank: 1 }, icon: "sk_hunter",
    v: (r) => ({ boss: 10 * r }),
    desc: (r) => `Урон по боссам +${10 * Math.max(1, r)}%.`,
    tree: [4, 1],
  },
};

export function classSkills(cls: ClassId): SkillDef[] {
  return Object.values(SKILLS).filter((s) => s.cls === cls);
}
export function activeSkills(cls: ClassId): SkillDef[] {
  return classSkills(cls).filter((s) => s.kind === "active").sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}
export function starterSkill(cls: ClassId): string {
  return activeSkills(cls)[0].id;
}

/** Можно ли вложить очко в умение. Возвращает причину отказа или null. */
export function canLearn(def: SkillDef, ranks: Record<string, number>, level: number, points: number): string | null {
  const cur = ranks[def.id] || 0;
  if (points <= 0) return "Нет свободных очков умений";
  if (cur >= def.maxRank) return "Максимальный ранг";
  if (level < def.reqLevel) return `Нужен ${def.reqLevel} уровень`;
  if (def.req && (ranks[def.req.id] || 0) < def.req.rank) return `Нужно: ${SKILLS[def.req.id].name} ${def.req.rank} ранга`;
  return null;
}
