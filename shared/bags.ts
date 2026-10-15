/** Расширение сумки: цены из /data/bags.json, Сумочник Кожемякин на рынке Эмберхолла. */
import data from "../data/bags.json";
import { TILE } from "./constants";
import { TOWN } from "./map";

export const BAG_STEP = data.step;
export const BAG_MAX = data.max;
const PRICES = data.prices as Record<string, number>;
/** Цена расширения до размера size+STEP или null, если сумка максимальна. */
export const bagPrice = (size: number): number | null => (size >= BAG_MAX ? null : PRICES[String(size + BAG_STEP)] ?? null);

export const BAGMAN = {
  id: "bagman",
  name: data.npc.name,
  sprite: data.npc.sprite,
  tint: Number(data.npc.tint),
  color: data.npc.color,
  greeting: data.npc.greeting,
  // у рынка, рядом с торговкой
  x: (TOWN.x + 9) * TILE + 16,
  y: (TOWN.y - 4) * TILE + 16,
};
