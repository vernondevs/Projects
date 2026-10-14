export type ClassId = "warrior" | "mage" | "ranger" | "healer" | "rogue";
export type StatKey = "str" | "agi" | "int" | "vit";
export type Stats = Record<StatKey, number>;

export const STAT_NAMES: Record<StatKey, string> = {
  str: "Сила",
  agi: "Ловкость",
  int: "Интеллект",
  vit: "Выносливость",
};
export const STAT_HINTS: Record<StatKey, string> = {
  str: "урон воина; всем — немного урона и здоровья",
  agi: "урон лучника; всем — шанс крита, уклонение, скорость атаки; магу — урон",
  int: "урон мага; всем — сила умений, запас и восстановление маны",
  vit: "здоровье, броня и восстановление здоровья",
};

export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  base: Stats;
  perLevel: Partial<Stats>;
  mainStat: StatKey;
  /** Прибавка урона за очко главной характеристики. */
  mainK: number;
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
    mainK: 0.025,
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
    mainK: 0.022,
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
    mainK: 0.0235,
    attackRange: 260,
    attackCd: 0.85,
    projectile: "arrow",
    weaponTypes: ["bow"],
    startWeapon: "bow",
  },
  healer: {
    id: "healer",
    name: "Лекарь",
    desc: "Исцеляет и защищает союзников, воскрешает павших. В одиночку разит врагов святым светом.",
    base: { str: 3, agi: 4, int: 11, vit: 7 },
    perLevel: { int: 1, vit: 1 },
    mainStat: "int",
    mainK: 0.021,
    attackRange: 220,
    attackCd: 1.2,
    projectile: "holy",
    weaponTypes: ["scepter", "staff"],
    startWeapon: "scepter",
  },
  rogue: {
    id: "rogue",
    name: "Разбойник",
    desc: "Ближний бой, огромный урон из тени: удар в спину, яд, телепорт за спину цели и скрытность.",
    base: { str: 4, agi: 11, int: 3, vit: 7 },
    perLevel: { agi: 1, vit: 1 },
    mainStat: "agi",
    mainK: 0.026,
    attackRange: 50,
    attackCd: 0.72,
    weaponTypes: ["dagger"],
    startWeapon: "dagger",
  },
};
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
