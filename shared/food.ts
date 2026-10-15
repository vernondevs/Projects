/** Еда с баффами: блюда из /data/food.json и повар Борщан в городе. */
import data from "../data/food.json";
import { TILE } from "./constants";
import { CITIES } from "./cities";
import { TOWN } from "./map";
import type { ItemStats } from "./items";

export interface Dish {
  id: string;
  name: string;
  icon: string;
  shape: string;
  color: string;
  price: number;
  req: number;
  hpPct: number;
  mpPct: number;
  minutes: number;
  stats: ItemStats;
  /** «Жаропрочный»: защита от жара вулкана. */
  heat?: boolean;
}

export const FOOD: Record<string, Dish> = Object.fromEntries(
  Object.entries(data.dishes).map(([id, d]) => [id, { ...d, id, icon: `food_${id}`, stats: d.stats as ItemStats }]),
);
export const FOOD_IDS = Object.keys(FOOD);
/** Блюдо по id предмета (food_<id>). */
export const foodOf = (baseId: string): Dish | undefined => (baseId.startsWith("food_") ? FOOD[baseId.slice(5)] : undefined);

export const COOK = {
  id: "cook",
  name: data.cook.name,
  sprite: data.cook.sprite,
  tint: Number(data.cook.tint),
  color: data.cook.color,
  greeting: data.cook.greeting,
  // за зелёным прилавком на рынке, рядом котёл
  x: (TOWN.x - 8) * TILE,
  y: (TOWN.y - 5) * TILE + 8,
};
/** Все повара: Борщан в Эмберхолле и повара малых городов (сюда ходят покупать еду). */
export const COOKS: { id: string; name: string; sprite: string; tint: number; color: string; greeting: string; x: number; y: number }[] = [
  COOK,
  ...CITIES.filter((c) => c.cook).map((c) => ({ ...c.cook!, greeting: c.cook!.greeting ?? "" })),
];
