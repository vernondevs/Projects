/** Обмен между игроками: константы и формат состояния окна. */
import type { Item } from "./items";

export const TRADE_SLOTS = 8;
export const TRADE_RANGE_TILES = 5;
export const TRADE_REQUEST_MS = 30_000;
export const TRADE_CONFIRM_DELAY_MS = 3000;

export interface TradeSideView {
  name: string;
  items: (Item | null)[];
  /** Индексы ячеек сумки владельца (-1 — пусто). */
  index: number[];
  gold: number;
  ready: boolean;
  confirm: boolean;
  /** Слоты, изменённые этим обновлением. */
  changed: number[];
  goldChanged: boolean;
}
export interface TradeView {
  mine: TradeSideView;
  theirs: TradeSideView;
  /** Вы ничего не отдаёте, но получаете — подарок. */
  gift: boolean;
  /** Через сколько мс станет доступна кнопка «Обменять». */
  confirmIn: number;
}
