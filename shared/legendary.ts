/** Легендарные предметы: определения из data/legendaries.json. */
import data from "../data/legendaries.json";
import { BASE_ITEMS, RARITY_MULT, Rarity, makeItem, type Item, type ItemStatKey, type ItemStats } from "./items";
import type { ClassId } from "./classes";

export interface LegendaryDef {
  id: string;
  name: string;
  base: string;
  variant: ClassId;
  ilvl: number;
  tint: string;
  stats: ItemStats;
  lore: string;
  effect: { type: string; [k: string]: number | string };
  desc: string;
  /** Внешность на герое: второй цвет, форма шлема/наплечников, эффект частиц. */
  look: { c2: string; helm: string; pauld: string; fx: string };
}
export const LEGENDARIES: Record<string, LegendaryDef> = Object.fromEntries(
  Object.entries(data as Record<string, Omit<LegendaryDef, "id">>).map(([id, d]) => [id, { id, ...d } as LegendaryDef]),
);

export function makeLegendary(id: string): Item {
  const u = LEGENDARIES[id];
  const base = makeItem(u.base, u.ilvl, Rarity.Legendary, () => 0.5);
  const stats: ItemStats = {};
  const main = BASE_ITEMS[u.base].roll!(u.ilvl);
  for (const [k, v] of Object.entries(main)) stats[k as ItemStatKey] = Math.round((v as number) * (k.startsWith("dmg") || k === "armor" ? RARITY_MULT[Rarity.Legendary] : 1));
  for (const [k, v] of Object.entries(u.stats)) stats[k as ItemStatKey] = (stats[k as ItemStatKey] || 0) + (v as number);
  return { ...base, name: u.name, stats, legendary: id, req: Math.min(30, u.ilvl - 3), bound: true };
}
