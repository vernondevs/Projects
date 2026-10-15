/** Банк Голдмунда: перенос предметов и золота между сумкой и банком.
 *  Каждая операция: проверки → изменение в памяти → сохранение игрока одной транзакцией SQLite (при ошибке — откат памяти). */
import { MERCHANT_RANGE } from "../../../shared/constants";
import { BANK_GOLD_MAX, BANK_STEP, BANK_TAB_SIZE, BANK_TABS, BANKER, bankPrice, newBank, SHARED_SIZE, SHARED_TAB, type BankSave, type BankView } from "../../../shared/bank";
import { BASE_ITEMS, type Item } from "../../../shared/items";
import type { GameDB } from "../db";
import { addItem } from "./inventory";
import type { Player } from "./Player";
import type { World } from "./World";

const err = (p: Player, text: string) => p.send("toast", { text, kind: "error" });
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Банк из сохранения, с починкой битых/старых данных. */
export function bankOf(p: Player): BankSave {
  let b = p.save.bank;
  if (!b || !Array.isArray(b.tabs) || !b.tabs.length) b = p.save.bank = { ...newBank(), gold: Math.max(0, Math.floor(Number(b?.gold) || 0)) };
  b.tabs = b.tabs.slice(0, BANK_TABS).map((t) => (Array.isArray(t) ? t.slice(0, BANK_TAB_SIZE) : []));
  if (!Number.isFinite(b.gold) || b.gold < 0) b.gold = 0;
  return b;
}

/** Банк героя и общий склад аккаунта на время одной операции. */
interface Box {
  b: BankSave;
  shared: (Item | null)[];
}

export class BankService {
  constructor(
    private world: () => World,
    private db: () => GameDB,
    private spawn: () => { x: number; y: number },
    private busy: (p: Player) => boolean,
    private locked: (p: Player, index: unknown) => boolean,
  ) {}

  /** Общий склад аккаунта — всегда свежий из базы (операция загружает, меняет и сохраняет его синхронно). */
  private sharedOf(p: Player): (Item | null)[] {
    const raw = p.accountId ? this.db().accountBank(p.accountId) : null;
    const cells = (raw ?? []).slice(0, SHARED_SIZE).map((x) => x ?? null);
    while (cells.length < SHARED_SIZE) cells.push(null);
    return cells;
  }

  view(p: Player): BankView {
    const b = bankOf(p);
    return { tabs: b.tabs, gold: b.gold, price: bankPrice(b), shared: this.sharedOf(p) };
  }
  send(p: Player) {
    p.send("bank", this.view(p));
  }

  private why(p: Player): string | null {
    if (p.dead) return "Мёртвым банк не нужен";
    if (p.team !== 0 || this.busy(p)) return "Банк недоступен на арене и в очереди на неё";
    if (this.world().dist(p, BANKER) > MERCHANT_RANGE) return "Банкир далеко";
    return null;
  }

  /** Выполнить изменение атомарно: fn возвращает текст ошибки (ничего не меняется) или null. */
  private run(p: Player, fn: (box: Box) => string | null): boolean {
    const e = this.why(p);
    if (e) {
      err(p, e);
      return false;
    }
    const b = bankOf(p);
    const box: Box = { b, shared: this.sharedOf(p) };
    const backup = JSON.stringify({ inv: p.save.inventory, bank: b, gold: p.save.gold });
    const restore = () => {
      const o = JSON.parse(backup);
      p.save.inventory = o.inv;
      p.save.bank = o.bank;
      p.save.gold = o.gold;
    };
    let fail: string | null;
    try {
      fail = fn(box);
    } catch (ex) {
      console.error("[bank]", ex);
      fail = "Ошибка банка";
    }
    if (fail) {
      restore();
      p.selfDirty = true;
      this.send(p);
      err(p, fail);
      return false;
    }
    const db = this.db();
    try {
      db.raw.exec("BEGIN IMMEDIATE");
      db.save(p.name, p.toSave(this.spawn()));
      if (p.accountId) db.saveAccountBank(p.accountId, box.shared);
      db.raw.exec("COMMIT");
    } catch (ex) {
      try { db.raw.exec("ROLLBACK"); } catch {}
      console.error("[bank] транзакция не прошла:", ex);
      restore();
      p.selfDirty = true;
      this.send(p);
      err(p, "Ошибка банка, ничего не изменилось");
      return false;
    }
    p.selfDirty = true;
    this.send(p);
    return true;
  }

  open(p: Player) {
    const e = this.why(p);
    if (e) return err(p, e);
    this.send(p);
  }

  /** Ячейки вкладки: личные 0..n-1 или общий склад SHARED_TAB. */
  private cells(x: Box, tab: unknown): (Item | null)[] | null {
    if (tab === SHARED_TAB) return x.shared;
    return isInt(tab) && tab >= 0 && tab < x.b.tabs.length ? x.b.tabs[tab] : null;
  }
  private slotOk(x: Box, tab: unknown, slot: unknown): boolean {
    const c = this.cells(x, tab);
    return !!c && isInt(slot) && slot >= 0 && slot < c.length;
  }
  private bagOk(p: Player, index: unknown): index is number {
    return isInt(index) && index >= 0 && index < p.save.inventory.length;
  }

  /** Положить it в банк: сначала в стопки, потом в пустые ячейки (начиная с вкладки tab). false — нет места. */
  private stash(x: Box, it: Item, tab = 0): boolean {
    const max = BASE_ITEMS[it.base]?.stack;
    const b = x.b;
    // в общий склад — только туда; в личные вкладки — начиная с выбранной
    const order: (Item | null)[][] = tab === SHARED_TAB ? [x.shared] : [...b.tabs.keys()].sort((p, q) => (p === tab ? -1 : q === tab ? 1 : p - q)).map((t) => b.tabs[t]);
    let left = it.qty ?? 1;
    if (max) for (const t of order) for (const s of t) {
      if (!left) break;
      if (!s || s.base !== it.base) continue;
      const put = Math.min(max - (s.qty ?? 1), left);
      if (put <= 0) continue;
      s.qty = (s.qty ?? 1) + put;
      left -= put;
    }
    if (!left) return true;
    for (const t of order) {
      const i = t.indexOf(null);
      if (i >= 0) {
        t[i] = max ? { ...it, qty: left } : it;
        return true;
      }
    }
    return false;
  }

  /** Сложить from в to, если это одна стопка. Возвращает остаток (null — если не складываются). */
  private merge(from: Item, to: Item): Item | null | false {
    const max = BASE_ITEMS[from.base]?.stack;
    if (!max || from.base !== to.base) return false;
    const total = (from.qty ?? 1) + (to.qty ?? 1);
    to.qty = Math.min(max, total);
    return total > max ? { ...from, qty: total - max } : null;
  }

  /** Сумка → банк. С tab/slot — в конкретную ячейку (стопка или обмен местами), иначе — куда поместится. */
  put(p: Player, index: unknown, tab: unknown, slot: unknown) {
    if (!this.bagOk(p, index)) return;
    if (this.locked(p, index)) return err(p, "Предмет лежит в окне обмена");
    this.run(p, (x) => {
      const inv = p.save.inventory;
      const it = inv[index];
      if (!it) return "Ячейка пуста";
      if (this.slotOk(x, tab, slot)) {
        const t = this.cells(x, tab)!, cur = t[slot as number];
        if (!cur) {
          t[slot as number] = it;
          inv[index] = null;
        } else {
          const rest = this.merge(it, cur);
          if (rest === false) {
            t[slot as number] = it;
            inv[index] = cur;
          } else inv[index] = rest;
        }
        return null;
      }
      inv[index] = null;
      if (tab === SHARED_TAB && !p.accountId) return "Общий склад недоступен";
      return this.stash(x, it, isInt(tab) ? tab : 0) ? null : tab === SHARED_TAB ? "На общем складе нет места" : "В банке нет места — купите ячейки";
    });
  }

  /** Банк → сумка. С index — в конкретную ячейку сумки (стопка или обмен), иначе — куда поместится. */
  take(p: Player, tab: unknown, slot: unknown, index: unknown) {
    if (index !== undefined && index !== null && this.locked(p, index)) return err(p, "Предмет лежит в окне обмена");
    this.run(p, (x) => {
      if (!this.slotOk(x, tab, slot)) return "Нет такой ячейки";
      const t = this.cells(x, tab)!;
      const it = t[slot as number];
      if (!it) return "Ячейка пуста";
      const inv = p.save.inventory;
      if (this.bagOk(p, index)) {
        const cur = inv[index];
        if (!cur) {
          inv[index] = it;
          t[slot as number] = null;
        } else {
          const rest = this.merge(it, cur);
          if (rest === false) {
            inv[index] = it;
            t[slot as number] = cur;
          } else t[slot as number] = rest;
        }
        return null;
      }
      t[slot as number] = null;
      return addItem(p, it) ? null : "Сумка полна";
    });
  }

  /** Перестановка внутри банка. */
  move(p: Player, tab: unknown, slot: unknown, toTab: unknown, toSlot: unknown) {
    this.run(p, (x) => {
      if (!this.slotOk(x, tab, slot) || !this.slotOk(x, toTab, toSlot)) return "Нет такой ячейки";
      const A = this.cells(x, tab)!, B = this.cells(x, toTab)!;
      const a = slot as number, c = toSlot as number;
      if (A === B && a === c) return null;
      const it = A[a];
      if (!it) return "Ячейка пуста";
      const cur = B[c];
      const rest = cur ? this.merge(it, cur) : false;
      if (rest === false) {
        A[a] = cur;
        B[c] = it;
      } else A[a] = rest;
      return null;
    });
  }

  /** Золото: v > 0 — положить, v < 0 — снять. */
  gold(p: Player, v: unknown) {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const n = Math.trunc(v);
    if (!n) return;
    this.run(p, ({ b }) => {
      if (n > 0) {
        if (p.save.gold < n) return "Не хватает золота в сумке";
        if (b.gold + n > BANK_GOLD_MAX) return "Банк не примет столько золота";
        p.save.gold -= n;
        b.gold += n;
      } else {
        if (b.gold < -n) return "В банке нет столько золота";
        b.gold += n;
        p.save.gold -= n;
      }
      return null;
    });
  }

  /** Купить +BANK_STEP ячеек: дополняем последнюю вкладку, когда она полная — открываем новую. */
  buy(p: Player) {
    const ok = this.run(p, ({ b }) => {
      const price = bankPrice(b);
      if (price === null) return "Банк уже максимального размера";
      if (p.save.gold < price) return `Нужно ${price} золота`;
      const last = b.tabs[b.tabs.length - 1];
      if (last.length < BANK_TAB_SIZE) last.push(...new Array(Math.min(BANK_STEP, BANK_TAB_SIZE - last.length)).fill(null));
      else if (b.tabs.length < BANK_TABS) b.tabs.push(new Array(BANK_STEP).fill(null));
      else return "Банк уже максимального размера";
      p.save.gold -= price;
      return null;
    });
    if (ok) p.send("toast", { text: `Банк расширен: +${BANK_STEP} ячеек`, kind: "info" });
  }
}
