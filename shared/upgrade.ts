/** Улучшение предметов +1…+10: таблицы из /data/upgrade.json и кузнец Гром в городе. */
import data from "../data/upgrade.json";
import { TILE } from "./constants";
import { TOWN } from "./map";

export interface UpgradeStep {
  gold: number;
  ore: number;
  dust: number;
  chance: number;
}
export const MAX_PLUS = data.levels.length;
export const UPGRADE_LEVELS: UpgradeStep[] = data.levels;
export const PLUS_BONUS = data.bonusPerLevel;
/** Материалы: id предмета -> описание. */
export const MATERIALS: Record<string, { id: string; name: string; price: number; dropPct: number; icon: string }> = Object.fromEntries(
  Object.entries(data.materials).map(([id, m]) => [id, { id, name: m.name, price: m.price, dropPct: m.dropPct, icon: `mat_${id}` }]),
);
export const MATERIAL_IDS = Object.keys(MATERIALS);
/** Условие шага: что нужно, чтобы перейти с уровня plus на plus+1. */
export const stepFor = (plus: number): UpgradeStep | undefined => UPGRADE_LEVELS[plus];
/** Куда падает уровень при неудаче. */
export const failLevel = (plus: number) => Math.max(0, plus + 1 <= 5 ? plus : plus - 1);

export const SMITH = {
  id: "smith",
  name: data.smith.name,
  sprite: data.smith.sprite,
  tint: Number(data.smith.tint),
  color: data.smith.color,
  greeting: data.smith.greeting,
  x: (TOWN.x - 2) * TILE + 16,
  y: (TOWN.y - 5) * TILE + 16,
};
