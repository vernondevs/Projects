import type { ClassId } from "./classes";
import skillData from "../data/skills.json";

export type SkillTarget = "enemy" | "point" | "self" | "ally";

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
  // ---------------- Воин (танк) ----------------
  taunt: {
    id: "taunt", cls: "warrior", name: "Провокация", kind: "active", slot: 0, maxRank: 5, reqLevel: 1, icon: "sk_taunt",
    target: "enemy", range: 260, cd: () => 8, mana: () => 8,
    v: (r) => ({ dur: 4, extra: 60 + 40 * r, radius: r >= 3 ? 90 : 0, weak: 20, weakDur: 3 }),
    desc: (r) => `Крик заставляет цель${r >= 3 ? " и врагов рядом" : ""} атаковать вас 4 с и даёт много угрозы. Против игрока: его урон −20% на 3 с.`,
    tree: [0, 1],
  },
  shieldblock: {
    id: "shieldblock", cls: "warrior", name: "Щитовой блок", kind: "active", slot: 1, maxRank: 5, reqLevel: 3, req: { id: "taunt", rank: 1 }, icon: "sk_shieldblock",
    target: "self", range: 0, cd: () => 16, mana: () => 12,
    v: (r) => ({ block: 60, dur: 4, reflect: r >= 3 ? 8 * (r - 2) : 0 }),
    desc: (r) => `На 4 с блокирует 60% получаемого урона${r >= 3 ? `, возвращает врагу ${8 * (r - 2)}% поглощённого урона` : ""}.`,
    tree: [1, 0],
  },
  toughness: {
    id: "toughness", cls: "warrior", name: "Стойкость", kind: "passive", maxRank: 5, reqLevel: 5, icon: "sk_toughness",
    v: (r) => ({ armor: 6 * r, taken: 2 * r }),
    desc: (r) => `Броня +${6 * Math.max(1, r)}%, получаемый урон −${2 * Math.max(1, r)}%.`,
    tree: [1, 2],
  },
  charge: {
    id: "charge", cls: "warrior", name: "Рывок", kind: "active", slot: 2, maxRank: 5, reqLevel: 8, req: { id: "shieldblock", rank: 1 }, icon: "sk_charge",
    target: "enemy", range: 260, cd: (r) => 12 - 0.5 * (r - 1), mana: () => 12,
    v: (r) => ({ dmg: 80 + 10 * (r - 1), stun: 1.2, threat: 120 + 30 * r }),
    desc: (r) => `Бросок к врагу (до 8 клеток): ${pct(80 + 10 * (r - 1))} урона, оглушение 1.2 с и угроза.`,
    tree: [2, 0],
  },
  bloodlust: {
    id: "bloodlust", cls: "warrior", name: "Кровожадность", kind: "passive", maxRank: 3, reqLevel: 10, req: { id: "taunt", rank: 3 }, icon: "sk_bloodlust",
    v: (r) => ({ lifesteal: 3 * r }),
    desc: (r) => `${3 * Math.max(1, r)}% нанесённого урона возвращается здоровьем.`,
    tree: [2, 2],
  },
  quake: {
    id: "quake", cls: "warrior", name: "Сотрясение земли", kind: "active", slot: 3, maxRank: 5, reqLevel: 15, req: { id: "charge", rank: 1 }, icon: "sk_quake",
    target: "self", range: 0, cd: () => 14, mana: () => 20,
    v: (r) => ({ dmg: 100 + 15 * (r - 1), radius: 130, slow: 40, dur: 3, threat: 150 + 30 * r }),
    desc: (r) => `Удар по земле: ${pct(100 + 15 * (r - 1))} урона всем вокруг, замедление 40% на 3 с, много угрозы.`,
    tree: [3, 1],
  },
  unbending: {
    id: "unbending", cls: "warrior", name: "Несгибаемый", kind: "passive", maxRank: 3, reqLevel: 18, req: { id: "quake", rank: 1 }, icon: "sk_unbending",
    v: (r) => ({ cc: 15 * r }),
    desc: (r) => `Длительность оглушений и замедлений на вас −${15 * Math.max(1, r)}%.`,
    tree: [4, 0],
  },
  laststand: {
    id: "laststand", cls: "warrior", name: "Последний рубеж", kind: "passive", maxRank: 3, reqLevel: 20, req: { id: "quake", rank: 1 }, icon: "sk_laststand",
    v: (r) => ({ reduce: 15 + 5 * r, dur: 8, icd: 30 }),
    desc: (r) => `Ниже 30% здоровья получаемый урон −${15 + 5 * Math.max(1, r)}% на 8 с (раз в 30 с).`,
    tree: [4, 2],
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

  // ---------------- Лекарь ----------------
  // Сила лечения = средний урон оружия × сила умений × «Благодать»; проценты ниже — доля от неё.
  heal: {
    id: "heal", cls: "healer", name: "Исцеление", kind: "active", slot: 0, maxRank: 5, reqLevel: 1, icon: "sk_heal",
    target: "ally", range: 320, cd: () => 3, mana: () => 10,
    v: (r) => ({ heal: 240 + 40 * (r - 1) }),
    desc: (r) => `Исцеляет союзника (без цели — вас или питомца) на ${pct(240 + 40 * (r - 1))} силы лечения. С талантом «Воскрешение» поднимает павшего.`,
    tree: [0, 1],
  },
  circle: {
    id: "circle", cls: "healer", name: "Круг света", kind: "active", slot: 1, maxRank: 5, reqLevel: 3, req: { id: "heal", rank: 1 }, icon: "sk_circle",
    target: "point", range: 300, cd: () => 10, mana: () => 22,
    v: (r) => ({ heal: 130 + 25 * (r - 1), radius: 120 }),
    desc: (r) => `Круг света в выбранной точке исцеляет всех союзников в нём на ${pct(130 + 25 * (r - 1))} силы лечения.`,
    tree: [1, 0],
  },
  grace: {
    id: "grace", cls: "healer", name: "Благодать", kind: "passive", maxRank: 5, reqLevel: 5, icon: "sk_grace",
    v: (r) => ({ power: 6 * r }),
    desc: (r) => `Сила лечения и щитов +${6 * Math.max(1, r)}%.`,
    tree: [1, 2],
  },
  renew: {
    id: "renew", cls: "healer", name: "Обновление", kind: "active", slot: 2, maxRank: 5, reqLevel: 8, req: { id: "circle", rank: 1 }, icon: "sk_renew",
    target: "ally", range: 320, cd: () => 7, mana: () => 16,
    v: (r) => ({ tick: 55 + 10 * (r - 1), ticks: 9, dur: 9 }),
    desc: (r) => `Исцеление со временем: 9 с по ${pct(55 + 10 * (r - 1))} силы лечения каждую секунду.`,
    tree: [2, 0],
  },
  smite: {
    id: "smite", cls: "healer", name: "Кара", kind: "passive", maxRank: 3, reqLevel: 10, req: { id: "heal", rank: 3 }, icon: "sk_smite",
    v: (r) => ({ pct: 20 * r }),
    desc: (r) => `Каждое ваше исцеление ещё и поражает ближайшего врага святым светом на ${20 * Math.max(1, r)}% от вылеченного.`,
    tree: [2, 2],
  },
  resurrect: {
    id: "resurrect", cls: "healer", name: "Воскрешение", kind: "passive", maxRank: 3, reqLevel: 12, req: { id: "heal", rank: 2 }, icon: "sk_resurrect",
    v: (r) => ({ hp: 20 + 10 * r, cast: 3 }),
    desc: (r) => `«Исцеление» на павшем герое (вне арены) воскрешает его за 3 с с ${20 + 10 * Math.max(1, r)}% здоровья.`,
    tree: [3, 2],
  },
  holyshield: {
    id: "holyshield", cls: "healer", name: "Святой щит", kind: "active", slot: 3, maxRank: 5, reqLevel: 15, req: { id: "renew", rank: 1 }, icon: "sk_holyshield",
    target: "ally", range: 320, cd: () => 14, mana: () => 24,
    v: (r) => ({ absorb: 320 + 60 * (r - 1), dur: 8 }),
    desc: (r) => `Щит на союзнике: поглощает ${pct(320 + 60 * (r - 1))} силы лечения урона в течение 8 с.`,
    tree: [3, 0],
  },
  insight: {
    id: "insight", cls: "healer", name: "Озарение", kind: "passive", maxRank: 3, reqLevel: 20, req: { id: "holyshield", rank: 1 }, icon: "sk_insight",
    v: (r) => ({ regen: 12 * r, mana: 3 * r }),
    desc: (r) => `Восстановление маны +${12 * Math.max(1, r)}%, запас маны +${3 * Math.max(1, r)}%.`,
    tree: [4, 1],
  },
  // ---------------- Разбойник ----------------
  backstab: {
    id: "backstab", cls: "rogue", name: "Удар в спину", kind: "active", slot: 0, maxRank: 5, reqLevel: 1, icon: "sk_backstab",
    target: "enemy", range: 62, cd: () => 5, mana: () => 10,
    v: (r) => ({ dmg: 260 + 40 * (r - 1), behind: 2 }),
    desc: (r) => `Мощный удар кинжалами: ${pct(260 + 40 * (r - 1))} урона, ×2 если вы за спиной цели или из скрытности.`,
    tree: [0, 1],
  },
  venom: {
    id: "venom", cls: "rogue", name: "Ядовитый клинок", kind: "active", slot: 1, maxRank: 5, reqLevel: 3, req: { id: "backstab", rank: 1 }, icon: "sk_venom",
    target: "enemy", range: 62, cd: () => 3, mana: () => 8,
    v: (r) => ({ tick: 30 + 6 * (r - 1), dur: 8, maxStacks: 3 }),
    desc: (r) => `Яд на 8 с: ${pct(30 + 6 * (r - 1))} урона оружия в секунду. Накладывается до 3 раз.`,
    tree: [1, 0],
  },
  deadly: {
    id: "deadly", cls: "rogue", name: "Смертельная точность", kind: "passive", maxRank: 5, reqLevel: 5, icon: "sk_deadly",
    v: (r) => ({ critDmg: 12 * r }),
    desc: (r) => `Урон критических ударов +${12 * Math.max(1, r)}%.`,
    tree: [1, 2],
  },
  shadowstep: {
    id: "shadowstep", cls: "rogue", name: "Теневой шаг", kind: "active", slot: 2, maxRank: 5, reqLevel: 8, req: { id: "venom", rank: 1 }, icon: "sk_shadowstep",
    target: "enemy", range: 256, cd: (r) => 12 - 0.8 * (r - 1), mana: () => 14,
    v: () => ({ crit: 1 }),
    desc: () => "Мгновенно переносит за спину цели (до 8 клеток). Следующий удар — гарантированный крит.",
    tree: [2, 0],
  },
  evasion: {
    id: "evasion", cls: "rogue", name: "Увёртливость", kind: "passive", maxRank: 3, reqLevel: 10, req: { id: "backstab", rank: 3 }, icon: "sk_evasion",
    v: (r) => ({ dodge: 2 * r }),
    desc: (r) => `Шанс уклонения +${2 * Math.max(1, r)}%.`,
    tree: [2, 2],
  },
  poisoner: {
    id: "poisoner", cls: "rogue", name: "Отравитель", kind: "passive", maxRank: 3, reqLevel: 12, req: { id: "venom", rank: 1 }, icon: "sk_poisoner",
    v: (r) => ({ chance: 12 * r }),
    desc: (r) => `Обычные удары с шансом ${12 * Math.max(1, r)}% накладывают яд «Ядовитого клинка» (минимум 1 ранг).`,
    tree: [3, 2],
  },
  stealth: {
    id: "stealth", cls: "rogue", name: "Скрытность", kind: "active", slot: 3, maxRank: 5, reqLevel: 15, req: { id: "shadowstep", rank: 1 }, icon: "sk_stealth",
    target: "self", range: 0, cd: () => 20, mana: () => 12,
    v: (r) => ({ dur: 6 + r, slow: 30 }),
    desc: (r) => `Невидимость до ${6 + r} с (мобы не замечают, игроки не видят и не выбирают целью). Движение −30%. Прерывается атакой, умением или уроном.`,
    tree: [3, 0],
  },
};

// ---------------- умения из /data/skills.json (классы Умбрата) ----------------
type Lin = [number, number];
interface RawSkill {
  cls: ClassId; name: string; slot?: number; maxRank: number; reqLevel: number; req?: { id: string; rank: number };
  target?: SkillTarget; range?: number; cd?: Lin; mana?: Lin; v: Record<string, Lin>; desc: string;
  icon: { glyph: string; bg: string; fg: string }; tree: [number, number]; kind?: "active" | "passive";
}
const lin = ([a, b]: Lin, r: number) => Math.round((a + b * (Math.max(1, r) - 1)) * 100) / 100;
/** Иконки умений из данных (для генератора ассетов): id иконки → рисунок и палитры. */
export const DATA_SKILL_ICONS: Record<string, { glyph: string; bg: string; fg: string }> = {};
for (const [id, s] of Object.entries(skillData.skills as unknown as Record<string, RawSkill>)) {
  const icon = `sk_${id}`;
  DATA_SKILL_ICONS[icon] = s.icon;
  const v = (r: number) => Object.fromEntries(Object.entries(s.v).map(([k, p]) => [k, lin(p, r)]));
  SKILLS[id] = {
    id, cls: s.cls, name: s.name, kind: s.kind ?? "active", slot: s.slot, maxRank: s.maxRank, reqLevel: s.reqLevel, req: s.req, icon,
    target: s.target, range: s.range,
    cd: s.cd ? (r) => lin(s.cd!, r) : undefined,
    mana: s.mana ? (r) => lin(s.mana!, r) : undefined,
    v,
    desc: (r) => { const vals = v(r); return s.desc.replace(/\{(\w+)\}/g, (_, k: string) => String(vals[k] ?? "?")); },
    tree: s.tree,
  };
}
/** Временные призванные союзники умений (питомец на время). */
export const SUMMONS = skillData.summons as Record<string, { name: string; sprite: string; hp: number; dmg: number; armor: number; speed: number; range: number; attackCd: number; radius: number }>;

export function classSkills(cls: ClassId): SkillDef[] {
  return Object.values(SKILLS).filter((s) => s.cls === cls);
}
export function activeSkills(cls: ClassId): SkillDef[] {
  return classSkills(cls).filter((s) => s.kind === "active").sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}
/** В сохранении есть умения, которых нет у класса (старое дерево воина). */
export function hasUnknownSkills(cls: ClassId, skills: Record<string, number>): boolean {
  return Object.keys(skills).some((k) => !SKILLS[k] || SKILLS[k].cls !== cls);
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
