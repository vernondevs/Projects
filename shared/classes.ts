/** Классы героев из /data/classes.json: по 5 на фракцию (shared/factions.ts). */
import data from "../data/classes.json";
import type { FxKind } from "./protocol";

/** Сольгард: warrior, healer, ranger, mage, rogue (id прежние, названия новые). Умбрат: остальные. */
export type ClassId = "warrior" | "mage" | "ranger" | "healer" | "rogue" | "deathknight" | "bloodweaver" | "darkranger" | "warlock" | "reaver";
export type FactionId = "solgard" | "umbrath";
export type ClassRole = "tank" | "healer" | "archer" | "caster" | "melee";
export type StatKey = "str" | "agi" | "int" | "vit";
export type Stats = Record<StatKey, number>;

export const STAT_NAMES: Record<StatKey, string> = {
  str: "Сила",
  agi: "Ловкость",
  int: "Интеллект",
  vit: "Выносливость",
};
export const STAT_HINTS: Record<StatKey, string> = {
  str: "урон танков и Потрошителя; всем — немного урона и здоровья",
  agi: "урон лучников и Ассасина; всем — шанс крита, уклонение, скорость атаки; магам — урон",
  int: "урон магов и лекарей; всем — сила умений, запас и восстановление маны",
  vit: "здоровье, броня и восстановление здоровья",
};

export interface ClassDef {
  id: ClassId;
  name: string;
  faction: FactionId;
  role: ClassRole;
  desc: string;
  /** Особая механика класса (одна строка). */
  trait: string;
  base: Stats;
  perLevel: Partial<Stats>;
  mainStat: StatKey;
  /** Прибавка урона за очко главной характеристики. */
  mainK: number;
  attackRange: number;
  attackCd: number; // секунды
  /** Снаряд автоатаки (нет — ближний бой). */
  projectile?: string;
  /** Автоатака: ближний бой, вид урона, скорость снаряда. */
  attack: { melee: boolean; proj?: string; hit: FxKind; speed?: number };
  /** Множитель угрозы по мобам. */
  threat: number;
  /** Ярость от ран: урон × (1 + rage × доля потерянного здоровья). */
  rage?: number;
  weaponTypes: string[];
  startWeapon: string;
}

type RawClass = Omit<ClassDef, "id" | "projectile">;
const raw = data as unknown as Record<string, RawClass | string>;
export const CLASSES = Object.fromEntries(
  Object.entries(raw)
    .filter(([k, v]) => !k.startsWith("_") && typeof v === "object")
    .map(([id, c]) => {
      const d = c as RawClass;
      return [id, { ...d, id: id as ClassId, projectile: d.attack.melee ? undefined : d.attack.proj }];
    }),
) as Record<ClassId, ClassDef>;
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
export const isClassId = (v: unknown): v is ClassId => typeof v === "string" && v in CLASSES;
/** Фракция класса (старые сохранения без фракции получают её из класса — Сольгард). */
export const classFaction = (cls: ClassId): FactionId => CLASSES[cls]?.faction ?? "solgard";
