/** Банк: вкладки с ячейками, покупка места; цены и банкир Голдмунд — из /data/bank.json. */
import data from "../data/bank.json";
import { TILE } from "./constants";
import type { Item } from "./items";
import { TOWN } from "./map";

export const BANK_TABS = data.tabs;
export const BANK_TAB_SIZE = data.tabSize;
export const BANK_START_SLOTS = data.startSlots;
export const BANK_STEP = data.step;
export const BANK_PRICES: number[] = data.prices;
export const BANK_GOLD_MAX = 1_000_000_000;
/** «Общий склад» аккаунта: одна вкладка для всех героев аккаунта; в сообщениях — номер вкладки SHARED_TAB. */
export const SHARED_TAB = BANK_TABS;
export const SHARED_SIZE: number = data.sharedSize;

/** Хранится в сохранении игрока: вкладки (длина вкладки = открытые ячейки) и золото. */
export interface BankSave {
  tabs: (Item | null)[][];
  gold: number;
}
/** Что видит клиент: содержимое и цена следующего расширения (null — максимум). */
export interface BankView extends BankSave {
  price: number | null;
  /** Общий склад аккаунта (SHARED_SIZE ячеек). */
  shared: (Item | null)[];
}

export const newBank = (): BankSave => ({ tabs: [new Array(BANK_START_SLOTS).fill(null)], gold: 0 });
export const bankSlots = (b: BankSave) => b.tabs.reduce((n, t) => n + t.length, 0);
/** Цена следующих +BANK_STEP ячеек или null, если банк уже максимального размера. */
export function bankPrice(b: BankSave): number | null {
  if (bankSlots(b) >= BANK_TABS * BANK_TAB_SIZE) return null;
  const bought = Math.max(0, Math.round((bankSlots(b) - BANK_START_SLOTS) / BANK_STEP));
  return BANK_PRICES[Math.min(bought, BANK_PRICES.length - 1)];
}

export const BANKER = {
  id: "banker",
  name: data.banker.name,
  sprite: data.banker.sprite,
  tint: Number(data.banker.tint),
  color: data.banker.color,
  greeting: data.banker.greeting,
  // на крыльце банка, перед дверями
  x: (TOWN.x - 17) * TILE,
  y: (TOWN.y + 7) * TILE + 16,
};
