import type { ClassId, StatKey } from "./classes";
import { FOOD } from "./food";
import { MATERIALS, PLUS_BONUS } from "./upgrade";

export type Slot = "weapon" | "helmet" | "armor" | "boots" | "ring" | "amulet";
export const SLOTS: Slot[] = ["weapon", "helmet", "armor", "boots", "ring", "amulet"];
export const SLOT_NAMES: Record<Slot, string> = {
  weapon: "Оружие",
  helmet: "Шлем",
  armor: "Доспех",
  boots: "Сапоги",
  ring: "Кольцо",
  amulet: "Амулет",
};

export enum Rarity {
  Common = 0,
  Rare = 1,
  Epic = 2,
  Legendary = 3,
}
export const RARITY_NAMES = ["Обычное", "Редкое", "Эпическое", "Легендарное"];
export const RARITY_COLORS = ["#e8e2d0", "#5fa8ff", "#c47bff", "#ff9a2e"];

export type ItemStatKey = StatKey | "hp" | "crit" | "armor" | "dmgMin" | "dmgMax";
export type ItemStats = Partial<Record<ItemStatKey, number>>;
export const ITEM_STAT_NAMES: Record<ItemStatKey, string> = {
  str: "Сила",
  agi: "Ловкость",
  int: "Интеллект",
  vit: "Выносливость",
  hp: "Здоровье",
  crit: "к шансу крита",
  armor: "Броня",
  dmgMin: "Урон мин.",
  dmgMax: "Урон макс.",
};

export interface Item {
  uid: string;
  base: string;
  name: string;
  rarity: Rarity;
  ilvl: number;
  req: number;
  stats: ItemStats;
  qty?: number;
  unique?: string;
  /** id легендарного предмета (data/legendaries.json). */
  legendary?: string;
  /** Привязан к персонажу: нельзя передать другому игроку. */
  bound?: boolean;
  /** Уровень улучшения 0..10. */
  plus?: number;
}

export interface BaseItem {
  id: string;
  name: string;
  slot: Slot | "consumable";
  icon: string;
  weaponType?: string;
  classes?: ClassId[];
  /** Основные характеристики в зависимости от уровня предмета. */
  roll?: (ilvl: number) => ItemStats;
  price?: number;
  stack?: number;
}

const r1 = (v: number) => Math.round(v);
export const BASE_ITEMS: Record<string, BaseItem> = {
  sword: { id: "sword", name: "Меч", slot: "weapon", icon: "sword", weaponType: "sword", classes: ["warrior"], roll: (l) => ({ dmgMin: r1(4 + l * 1.8), dmgMax: r1(8 + l * 2.6) }) },
  axe: { id: "axe", name: "Топор", slot: "weapon", icon: "axe", weaponType: "axe", classes: ["warrior"], roll: (l) => ({ dmgMin: r1(3 + l * 1.5), dmgMax: r1(10 + l * 3.1) }) },
  staff: { id: "staff", name: "Посох", slot: "weapon", icon: "staff", weaponType: "staff", classes: ["mage"], roll: (l) => ({ dmgMin: r1(4 + l * 1.7), dmgMax: r1(8 + l * 2.6), int: r1(1 + l * 0.2) }) },
  bow: { id: "bow", name: "Лук", slot: "weapon", icon: "bow", weaponType: "bow", classes: ["ranger"], roll: (l) => ({ dmgMin: r1(4 + l * 1.7), dmgMax: r1(7 + l * 2.5) }) },
  helmet: { id: "helmet", name: "Шлем", slot: "helmet", icon: "helmet", roll: (l) => ({ armor: r1(2 + l * 1.6) }) },
  armor: { id: "armor", name: "Доспех", slot: "armor", icon: "armor", roll: (l) => ({ armor: r1(4 + l * 3), hp: r1(l * 2) }) },
  boots: { id: "boots", name: "Сапоги", slot: "boots", icon: "boots", roll: (l) => ({ armor: r1(1 + l * 1.2) }) },
  ring: { id: "ring", name: "Кольцо", slot: "ring", icon: "ring", roll: () => ({}) },
  amulet: { id: "amulet", name: "Амулет", slot: "amulet", icon: "amulet", roll: (l) => ({ hp: r1(6 + l * 3) }) },
  hp_potion: { id: "hp_potion", name: "Зелье здоровья", slot: "consumable", icon: "potion_red", price: 15, stack: 20 },
  mp_potion: { id: "mp_potion", name: "Зелье маны", slot: "consumable", icon: "potion_blue", price: 15, stack: 20 },
  ...Object.fromEntries(Object.values(MATERIALS).map((m) => [m.id, { id: m.id, name: m.name, slot: "consumable", icon: m.icon, price: m.price, stack: 99 } as BaseItem])),
  ...Object.fromEntries(Object.values(FOOD).map((d) => [`food_${d.id}`, { id: `food_${d.id}`, name: d.name, slot: "consumable", icon: d.icon, price: d.price, stack: 20 } as BaseItem])),
};
export const EQUIP_BASES = Object.values(BASE_ITEMS).filter((b) => b.slot !== "consumable").map((b) => b.id);

const AFFIX_KEYS: ItemStatKey[] = ["str", "agi", "int", "vit", "hp", "crit"];
function affixValue(k: ItemStatKey, ilvl: number, mult: number): number {
  switch (k) {
    case "hp": return Math.round((8 + ilvl * 4) * mult);
    case "crit": return Math.max(1, Math.round((1 + ilvl * 0.12) * mult));
    default: return Math.max(1, Math.round((1 + ilvl * 0.4) * mult));
  }
}
const SUFFIX: Record<string, string> = { str: "силы", agi: "ловкости", int: "мудрости", vit: "стойкости", hp: "жизни", crit: "точности" };
const EPIC_PREFIX = ["Древний", "Пылающий", "Звёздный", "Проклятый", "Королевский", "Сумеречный", "Громовой"];
const EPIC_PREFIX_N = ["Древнее", "Пылающее", "Звёздное", "Проклятое", "Королевское", "Сумеречное", "Громовое"];
const NEUTER = new Set(["ring"]);
const PLURAL = new Set(["boots"]);
const EPIC_PREFIX_P = ["Древние", "Пылающие", "Звёздные", "Проклятые", "Королевские", "Сумеречные", "Громовые"];

let uidCounter = 0;
export function newUid(): string {
  uidCounter = (uidCounter + 1) % 1e6;
  return Date.now().toString(36) + "-" + uidCounter.toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
}

export const RARITY_MULT = [1, 1.2, 1.45, 1.7];

export function makeItem(baseId: string, ilvl: number, rarity: Rarity, rand: () => number = Math.random): Item {
  const base = BASE_ITEMS[baseId];
  if (!base) throw new Error("unknown base " + baseId);
  if (base.slot === "consumable") return { uid: newUid(), base: baseId, name: base.name, rarity: Rarity.Common, ilvl: 1, req: 1, stats: {}, qty: 1 };
  const mult = RARITY_MULT[rarity];
  const stats: ItemStats = {};
  const main = base.roll ? base.roll(ilvl) : {};
  for (const [k, v] of Object.entries(main)) stats[k as ItemStatKey] = Math.max(1, Math.round((v as number) * (k.startsWith("dmg") || k === "armor" ? mult : 1)));
  let affixes = rarity === Rarity.Common ? 0 : rarity === Rarity.Rare ? 1 : rarity === Rarity.Epic ? 3 : 4;
  if (base.slot === "ring" || base.slot === "amulet") affixes += 1;
  const pool = [...AFFIX_KEYS];
  const picked: ItemStatKey[] = [];
  for (let i = 0; i < affixes && pool.length; i++) {
    const k = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    picked.push(k);
    stats[k] = (stats[k] || 0) + affixValue(k, ilvl, mult * (0.85 + rand() * 0.3));
  }
  let name = base.name;
  if (rarity === Rarity.Rare && picked.length) name = `${base.name} ${SUFFIX[picked[0]]}`;
  if (rarity === Rarity.Epic) {
    const i = Math.floor(rand() * EPIC_PREFIX.length);
    const pre = PLURAL.has(baseId) ? EPIC_PREFIX_P[i] : NEUTER.has(baseId) ? EPIC_PREFIX_N[i] : EPIC_PREFIX[i];
    name = `${pre} ${base.name.toLowerCase()}${picked[0] ? " " + SUFFIX[picked[0]] : ""}`;
  }
  return { uid: newUid(), base: baseId, name, rarity, ilvl, req: Math.max(1, ilvl - 2), stats };
}

/** Слоты, у которых вид иконки зависит от класса (плотная броня / мантия / кожа). */
export const ICON_VARIANT_SLOTS = ["helmet", "armor", "boots"];
export const ICON_VARIANTS: ClassId[] = ["warrior", "mage", "ranger"];

/** Класс-принадлежность предмета: по classes, затем по главной характеристике, иначе по uid. */
export function iconVariant(it: Pick<Item, "base" | "stats" | "uid">): ClassId {
  const b = BASE_ITEMS[it.base];
  if (b?.classes?.length) return b.classes[0];
  const s = it.stats;
  const v: [ClassId, number][] = [["warrior", s.str || 0], ["mage", s.int || 0], ["ranger", s.agi || 0]];
  v.sort((a, c) => c[1] - a[1]);
  if (v[0][1] > 0 && v[0][1] > v[1][1]) return v[0][0];
  let h = 0;
  for (let i = 0; i < it.uid.length; i++) h = (h * 31 + it.uid.charCodeAt(i)) >>> 0;
  return ICON_VARIANTS[h % 3];
}

/** Имя иконки: base.icon + вариант класса (для шлема/доспеха/сапог) + редкость. */
export function iconId(icon: string, variant: ClassId, rarity: Rarity): string {
  if (icon.startsWith("potion") || icon.startsWith("food_") || icon.startsWith("mat_") || icon === "gold") return icon;
  return ICON_VARIANT_SLOTS.includes(icon) ? `${icon}_${variant}_${rarity}` : `${icon}_${rarity}`;
}

/** Единственная точка выбора иконки предмета для всего UI. */
export function iconFor(it: Pick<Item, "base" | "stats" | "uid" | "rarity" | "unique"> & { legendary?: string }): string {
  if (it.unique) return "uq_" + it.unique;
  if (it.legendary) return "lg_" + it.legendary;
  return iconId(BASE_ITEMS[it.base].icon, iconVariant(it), it.rarity);
}

/** Уникальные предметы боссов: фиксированное имя и набор характеристик. */
export interface UniqueDef {
  id: string;
  name: string;
  base: string;
  ilvl: number;
  stats: ItemStats;
  lore: string;
}
export const UNIQUES: Record<string, UniqueDef> = {
  heartwood_staff: { id: "heartwood_staff", name: "Посох Сердцевины", base: "staff", ilvl: 15, stats: { int: 12, vit: 6, hp: 60 }, lore: "Ещё тёплый от соков Древнего Энта." },
  rootbreaker: { id: "rootbreaker", name: "Корнелом", base: "axe", ilvl: 15, stats: { str: 12, vit: 8, crit: 3 }, lore: "Топор, которым срубили первое дерево леса." },
  whisperwind: { id: "whisperwind", name: "Шёпот Ветра", base: "bow", ilvl: 15, stats: { agi: 12, crit: 5 }, lore: "Тетива из волокон живой лозы." },
  bark_helm: { id: "bark_helm", name: "Корона из коры", base: "helmet", ilvl: 15, stats: { vit: 10, hp: 80 }, lore: "Растёт вместе с владельцем." },
  hexed_ring: { id: "hexed_ring", name: "Кольцо Ведьмы", base: "ring", ilvl: 23, stats: { int: 14, agi: 8, crit: 4 }, lore: "Внутри шепчет чей-то голос." },
  bog_mantle: { id: "bog_mantle", name: "Плащ Топей", base: "armor", ilvl: 23, stats: { vit: 14, hp: 140, agi: 6 }, lore: "Пахнет тиной, но держит удар." },
  witch_eye: { id: "witch_eye", name: "Глаз Ведьмы", base: "amulet", ilvl: 23, stats: { int: 10, str: 10, crit: 5 }, lore: "Он всё ещё моргает." },
  swamp_treads: { id: "swamp_treads", name: "Болотоходы", base: "boots", ilvl: 23, stats: { agi: 12, vit: 10 }, lore: "Ни разу не промокли." },
  ashbringer: { id: "ashbringer", name: "Пеплоносец", base: "sword", ilvl: 31, stats: { str: 22, vit: 12, crit: 6 }, lore: "Клинок Повелителя Пепла. Тлеет вечно." },
  cinder_staff: { id: "cinder_staff", name: "Жезл Последнего Угля", base: "staff", ilvl: 31, stats: { int: 24, vit: 10, crit: 5 }, lore: "Внутри навечно заперт огонь." },
  phoenix_bow: { id: "phoenix_bow", name: "Лук Феникса", base: "bow", ilvl: 31, stats: { agi: 24, crit: 8 }, lore: "Стрелы вспыхивают в полёте." },
  ashen_crown: { id: "ashen_crown", name: "Пепельный венец", base: "helmet", ilvl: 31, stats: { str: 10, agi: 10, int: 10, vit: 10, hp: 120 }, lore: "Корона того, кто правил огнём." },
  // сезонные награды арены (по рангу в конце сезона)
  arena_bronze: { id: "arena_bronze", name: "Бронзовый медальон арены", base: "amulet", ilvl: 10, stats: { str: 2, agi: 2, int: 2, vit: 2, crit: 1 }, lore: "Награда за сезон арены. Ранг: Бронза." },
  arena_silver: { id: "arena_silver", name: "Серебряный медальон арены", base: "amulet", ilvl: 15, stats: { str: 4, agi: 4, int: 4, vit: 4, crit: 2 }, lore: "Награда за сезон арены. Ранг: Серебро." },
  arena_gold: { id: "arena_gold", name: "Золотой медальон арены", base: "amulet", ilvl: 20, stats: { str: 6, agi: 6, int: 6, vit: 6, crit: 3 }, lore: "Награда за сезон арены. Ранг: Золото." },
  arena_platinum: { id: "arena_platinum", name: "Платиновый медальон арены", base: "amulet", ilvl: 25, stats: { str: 8, agi: 8, int: 8, vit: 8, crit: 4 }, lore: "Награда за сезон арены. Ранг: Платина." },
  arena_diamond: { id: "arena_diamond", name: "Алмазный медальон арены", base: "amulet", ilvl: 30, stats: { str: 10, agi: 10, int: 10, vit: 10, crit: 5 }, lore: "Награда за сезон арены. Ранг: Алмаз." },
};

export function makeUnique(id: string): Item {
  const u = UNIQUES[id];
  const base = makeItem(u.base, u.ilvl, Rarity.Epic, () => 0.5);
  const stats: ItemStats = {};
  const main = BASE_ITEMS[u.base].roll!(u.ilvl);
  for (const [k, v] of Object.entries(main)) stats[k as ItemStatKey] = Math.round((v as number) * (k.startsWith("dmg") || k === "armor" ? RARITY_MULT[Rarity.Epic] : 1));
  for (const [k, v] of Object.entries(u.stats)) stats[k as ItemStatKey] = (stats[k as ItemStatKey] || 0) + (v as number);
  return { ...base, name: u.name, stats, unique: id, req: Math.min(30, u.ilvl - 3), bound: true };
}

/** Уникальные предметы боссов и награды арены привязаны к персонажу. */
export function isBound(it: Item): boolean {
  return !!it.bound || !!it.unique || !!it.legendary;
}

export function itemValue(it: Item): number {
  const b = BASE_ITEMS[it.base];
  if (b.slot === "consumable") return Math.floor((b.price || 10) / 3);
  return Math.round((4 + it.ilvl * 2.5) * (1 + it.rarity * 1.5) * (it.unique ? 3 : 1));
}

export function canEquip(it: Item, cls: ClassId, level: number): string | null {
  const b = BASE_ITEMS[it.base];
  if (!b || b.slot === "consumable") return "Это нельзя надеть";
  if (b.classes && !b.classes.includes(cls)) return "Не подходит вашему классу";
  if (it.req > level) return `Нужен ${it.req} уровень`;
  return null;
}

/** Выбор редкости: для обычных мобов редкое — 20%, эпическое — 3%. */
export function rollRarity(rand: () => number, bonus = 0): Rarity {
  const r = rand();
  if (r < 0.03 + bonus * 0.5) return Rarity.Epic;
  if (r < 0.23 + bonus) return Rarity.Rare;
  return Rarity.Common;
}

/** Название с уровнем улучшения: «Лук Феникса +7». */
export const itemName = (it: Pick<Item, "name" | "plus">): string => (it.plus ? `${it.name} +${it.plus}` : it.name);

/** Характеристики с учётом улучшения: +6% базы за уровень для урона, брони и главной характеристики. */
export function effStats(it: Pick<Item, "stats" | "plus">): ItemStats {
  const plus = it.plus || 0;
  if (!plus) return it.stats;
  const out: ItemStats = { ...it.stats };
  let main: ItemStatKey | null = null;
  for (const k of ["str", "agi", "int", "vit"] as ItemStatKey[]) if (out[k] && (!main || out[k]! > out[main]!)) main = k;
  for (const k of Object.keys(out) as ItemStatKey[]) {
    if (k === "dmgMin" || k === "dmgMax" || k === "armor" || k === main) out[k] = out[k]! + Math.ceil(out[k]! * PLUS_BONUS * plus);
  }
  return out;
}

/** Нормальная цена продажи с учётом улучшения (+12% за уровень), без поправки на спрос. */
export function baseSellValue(it: Item): number {
  return itemValue(it) * (1 + 0.12 * (it.plus || 0));
}
