/** Динамические цены продажи торговцу: глобальный спрос по (базовый предмет + редкость). */
import type { GameDB } from "../db";
import { baseSellValue, type Item } from "../../../shared/items";
import type { Player } from "./Player";

const HALF_LIFE_MS = 3600_000;
const STEP = 0.08;
const MIN_MULT = 0.4;

let store: GameDB | null = null;
const mem = new Map<string, { sold: number; updated_at: number }>();

export function setMarketDb(db: GameDB) {
  store = db;
}

export const demandKey = (it: Item) => `${it.base}:${it.rarity}`;

function soldNow(key: string, now = Date.now()): number {
  const row = store ? store.marketGet(key) : mem.get(key);
  if (!row) return 0;
  return row.sold * Math.pow(0.5, (now - row.updated_at) / HALF_LIFE_MS);
}

export function demandMult(it: Item): number {
  return Math.max(MIN_MULT, 1 / (1 + STEP * soldNow(demandKey(it))));
}

/** Состояния (прочности) у предметов нет — множитель 1. Улучшение +N даёт надбавку. */
export function sellPrice(it: Item): number {
  const base = baseSellValue(it);
  return Math.max(1, Math.round(base * demandMult(it)));
}

export function recordSale(it: Item, qty = 1) {
  const key = demandKey(it);
  const now = Date.now();
  const sold = soldNow(key, now) + qty;
  if (store) store.marketSet(key, sold, now);
  else mem.set(key, { sold, updated_at: now });
}

/** {uid: цена} для всего, что игрок может продать. */
export function pricesFor(p: Player): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of p.save.inventory) if (it) out[it.uid] = sellPrice(it);
  return out;
}

export function sendPrices(p: Player) {
  p.send("market:prices", pricesFor(p));
}
