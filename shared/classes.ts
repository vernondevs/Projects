export type ClassId = "warrior" | "mage" | "ranger";
export type StatKey = "str" | "agi" | "int" | "vit";
export type Stats = Record<StatKey, number>;

export const STAT_NAMES: Record<StatKey, string> = {
  str: "Сила",
  agi: "Ловкость",
  int: "Интеллект",
  vit: "Выносливость",
};
export const STAT_HINTS: Record<StatKey, string> = {
  str: "урон воина, немного брони",
  agi: "урон лучника, шанс крита, скорость атаки",
  int: "урон мага, запас и восстановление маны",
  vit: "здоровье и его восстановление",
};

export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  base: Stats;
  perLevel: Partial<Stats>;
  mainStat: StatKey;
  attackRange: number;
  attackCd: number; // секунды
  projectile?: string;
  weaponTypes: string[];
  startWeapon: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: "warrior",
    name: "Воин",
    desc: "Танк: держит врагов на себе, блокирует урон и контролирует толпу.",
    base: { str: 10, agi: 5, int: 3, vit: 9 },
    perLevel: { str: 1, vit: 1 },
    mainStat: "str",
    attackRange: 50,
    attackCd: 1.0,
    weaponTypes: ["sword", "axe"],
    startWeapon: "sword",
  },
  mage: {
    id: "mage",
    name: "Маг",
    desc: "Дальний бой и урон по площади. Хрупкий, но сжигает группы врагов.",
    base: { str: 3, agi: 5, int: 11, vit: 6 },
    perLevel: { int: 1, vit: 1 },
    mainStat: "int",
    attackRange: 230,
    attackCd: 1.1,
    projectile: "arcane",
    weaponTypes: ["staff"],
    startWeapon: "staff",
  },
  ranger: {
    id: "ranger",
    name: "Лучник",
    desc: "Быстрые выстрелы с дистанции, высокий шанс крита, ловкие отскоки.",
    base: { str: 4, agi: 11, int: 4, vit: 7 },
    perLevel: { agi: 1, vit: 1 },
    mainStat: "agi",
    attackRange: 260,
    attackCd: 0.85,
    projectile: "arrow",
    weaponTypes: ["bow"],
    startWeapon: "bow",
  },
};
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
