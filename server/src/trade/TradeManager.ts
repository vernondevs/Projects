/** Прямой обмен между игроками. Вся логика на сервере, перенос — одной транзакцией SQLite. */
import { TILE } from "../../../shared/constants";
import { isBound, type Item } from "../../../shared/items";
import { TRADE_CONFIRM_DELAY_MS, TRADE_RANGE_TILES, TRADE_REQUEST_MS, TRADE_SLOTS, type TradeSideView, type TradeView } from "../../../shared/trade";
import type { GameDB } from "../db";
import { addItem } from "../game/inventory";
import type { Player } from "../game/Player";
import type { World } from "../game/World";

interface Offer {
  index: number;
  uid: string;
  qty: number;
}
interface Side {
  key: string;
  offers: (Offer | null)[];
  gold: number;
  ready: boolean;
  confirm: boolean;
  changed: Set<number>;
  goldChanged: boolean;
}
interface Trade {
  a: Side;
  b: Side;
  changedAt: number;
}

const key = (p: Player) => p.name.toLowerCase();
const toast = (p: Player | undefined, text: string, kind: "info" | "error" = "error") => p?.send("toast", { text, kind });

export class TradeManager {
  private requests = new Map<string, { from: string; until: number }>(); // кому -> от кого
  private trades = new Map<string, Trade>();

  constructor(
    private world: () => World,
    private db: () => GameDB,
    private busy: (p: Player) => boolean,
    private spawn: () => { x: number; y: number },
  ) {}

  private find(k: string) {
    return this.world().findByName(k);
  }
  private sideOf(t: Trade, k: string) {
    return t.a.key === k ? t.a : t.b;
  }
  private otherOf(t: Trade, k: string) {
    return t.a.key === k ? t.b : t.a;
  }

  /** Почему эти двое не могут торговать (или null). */
  private why(p: Player, q: Player): string | null {
    const w = this.world();
    if (p.dead || q.dead) return "Мёртвые не торгуют";
    if (w.dist(p, q) > TRADE_RANGE_TILES * TILE) return "Слишком далеко для обмена (до 5 шагов)";
    if (p.inCombat(w.time) || q.inCombat(w.time)) return "Нельзя торговать в бою";
    if (this.busy(p) || this.busy(q)) return "Нельзя торговать на арене или в очереди на неё";
    return null;
  }

  request(p: Player, targetId: unknown) {
    const q = typeof targetId === "string" ? this.world().players.get(targetId) : undefined;
    if (!q || q === p) return toast(p, "Игрок не найден");
    if (this.trades.has(key(p))) return toast(p, "Вы уже торгуете");
    if (this.trades.has(key(q))) return toast(p, `${q.name} уже торгует`);
    const err = this.why(p, q);
    if (err) return toast(p, err);
    const cur = this.requests.get(key(q));
    if (cur && cur.until > Date.now() && cur.from !== key(p)) return toast(p, `${q.name} уже отвечает на другой запрос`);
    this.requests.set(key(q), { from: key(p), until: Date.now() + TRADE_REQUEST_MS });
    q.send("trade:request", { from: p.name, ms: TRADE_REQUEST_MS });
    toast(p, `Запрос на обмен отправлен: ${q.name}`, "info");
  }

  respond(q: Player, accept: boolean) {
    const r = this.requests.get(key(q));
    this.requests.delete(key(q));
    if (!r || r.until < Date.now()) return toast(q, "Запрос на обмен устарел");
    const p = this.find(r.from);
    if (!p) return toast(q, "Игрок ушёл");
    if (!accept) return toast(p, `${q.name} отклоняет обмен`);
    if (this.trades.has(key(p)) || this.trades.has(key(q))) return toast(q, "Кто-то из вас уже торгует");
    const err = this.why(p, q);
    if (err) {
      toast(p, err);
      return toast(q, err);
    }
    const side = (k: string): Side => ({ key: k, offers: new Array(TRADE_SLOTS).fill(null), gold: 0, ready: false, confirm: false, changed: new Set(), goldChanged: false });
    const t: Trade = { a: side(key(p)), b: side(key(q)), changedAt: Date.now() };
    this.trades.set(t.a.key, t);
    this.trades.set(t.b.key, t);
    this.push(t);
  }

  inTrade(p: Player) {
    return this.trades.has(key(p));
  }
  /** Предмет в окне обмена: его нельзя использовать, продать, переложить или надеть. */
  locked(p: Player, index: unknown): boolean {
    const t = this.trades.get(key(p));
    return !!t && this.sideOf(t, key(p)).offers.some((o) => o && o.index === index);
  }

  private changed(t: Trade, s: Side, slot: number | "gold") {
    for (const x of [t.a, t.b]) {
      x.ready = false;
      x.confirm = false;
    }
    if (slot === "gold") s.goldChanged = true;
    else s.changed.add(slot);
    t.changedAt = Date.now();
    this.push(t);
  }

  add(p: Player, index: unknown, slotRaw: unknown) {
    const t = this.trades.get(key(p));
    if (!t || !Number.isInteger(index)) return;
    const it = p.save.inventory[index as number];
    if (!it) return;
    if (isBound(it)) return toast(p, "Предмет привязан к персонажу — его нельзя передать");
    const s = this.sideOf(t, key(p));
    if (s.offers.some((o) => o && o.index === index)) return;
    let slot = Number.isInteger(slotRaw) && (slotRaw as number) >= 0 && (slotRaw as number) < TRADE_SLOTS && !s.offers[slotRaw as number] ? (slotRaw as number) : s.offers.indexOf(null);
    if (slot < 0) return toast(p, `В окне обмена не больше ${TRADE_SLOTS} предметов`);
    s.offers[slot] = { index: index as number, uid: it.uid, qty: it.qty ?? 1 };
    this.changed(t, s, slot);
  }

  remove(p: Player, slot: unknown) {
    const t = this.trades.get(key(p));
    if (!t || !Number.isInteger(slot)) return;
    const s = this.sideOf(t, key(p));
    if (!s.offers[slot as number]) return;
    s.offers[slot as number] = null;
    this.changed(t, s, slot as number);
  }

  gold(p: Player, v: unknown) {
    const t = this.trades.get(key(p));
    if (!t || typeof v !== "number" || !Number.isFinite(v)) return;
    const s = this.sideOf(t, key(p));
    const g = Math.max(0, Math.min(p.save.gold, Math.floor(v)));
    if (g === s.gold) return this.push(t);
    s.gold = g;
    this.changed(t, s, "gold");
  }

  ready(p: Player) {
    const t = this.trades.get(key(p));
    if (!t) return;
    const s = this.sideOf(t, key(p));
    s.ready = true;
    this.push(t);
  }

  confirm(p: Player) {
    const t = this.trades.get(key(p));
    if (!t) return;
    if (!t.a.ready || !t.b.ready) return toast(p, "Сначала оба должны нажать «Готов»");
    if (Date.now() - t.changedAt < TRADE_CONFIRM_DELAY_MS) return toast(p, "Подождите пару секунд после изменения");
    this.sideOf(t, key(p)).confirm = true;
    if (t.a.confirm && t.b.confirm) this.execute(t);
    else this.push(t);
  }

  cancel(k: string, reason: string) {
    const t = this.trades.get(k);
    if (!t) return;
    this.trades.delete(t.a.key);
    this.trades.delete(t.b.key);
    for (const x of [t.a, t.b]) {
      const pl = this.find(x.key);
      pl?.send("trade:state", null);
      toast(pl, reason);
    }
  }

  /** Игрок вышел из мира: отменяем обмен и его запросы. */
  leave(p: Player) {
    this.requests.delete(key(p));
    this.cancel(key(p), `Обмен отменён: ${p.name} отключился`);
  }

  /** Раз в секунду: просроченные запросы, расстояние, бой. */
  tick() {
    const now = Date.now();
    for (const [k, r] of this.requests) if (r.until < now) {
      this.requests.delete(k);
      this.find(k)?.send("trade:request", null);
      toast(this.find(r.from), "Запрос на обмен истёк", "info");
    }
    for (const t of new Set(this.trades.values())) {
      const p = this.find(t.a.key), q = this.find(t.b.key);
      if (!p || !q) {
        this.cancel(t.a.key, "Обмен отменён: игрок отключился");
        continue;
      }
      const err = this.why(p, q);
      if (err) this.cancel(t.a.key, "Обмен отменён: " + err.toLowerCase());
    }
  }

  private view(t: Trade, k: string): TradeView {
    const me = this.sideOf(t, k), them = this.otherOf(t, k);
    const pv = (s: Side): TradeSideView => {
      const pl = this.find(s.key);
      return {
        name: pl?.name ?? s.key,
        items: s.offers.map((o) => (o && pl ? (pl.save.inventory[o.index] as Item | null) : null)),
        index: s.offers.map((o) => (o ? o.index : -1)),
        gold: s.gold,
        ready: s.ready,
        confirm: s.confirm,
        changed: [...s.changed],
        goldChanged: s.goldChanged,
      };
    };
    const mine = pv(me), theirs = pv(them);
    const giveNothing = !me.gold && me.offers.every((o) => !o);
    const getSomething = !!them.gold || them.offers.some((o) => o);
    return { mine, theirs, gift: giveNothing && getSomething, confirmIn: Math.max(0, TRADE_CONFIRM_DELAY_MS - (Date.now() - t.changedAt)) };
  }

  private push(t: Trade) {
    for (const x of [t.a, t.b]) this.find(x.key)?.send("trade:state", this.view(t, x.key));
    t.a.changed.clear();
    t.b.changed.clear();
    t.a.goldChanged = t.b.goldChanged = false;
  }

  /** Атомарный перенос: проверки, обмен в памяти, сохранение обоих и журнал в одной транзакции. */
  private execute(t: Trade) {
    const p = this.find(t.a.key), q = this.find(t.b.key);
    if (!p || !q) return this.cancel(t.a.key, "Обмен отменён: игрок отключился");
    const err = this.why(p, q);
    if (err) return this.cancel(t.a.key, "Обмен отменён: " + err.toLowerCase());
    const fail = (text: string) => {
      t.a.ready = t.b.ready = t.a.confirm = t.b.confirm = false;
      toast(p, text);
      toast(q, text);
      this.push(t);
    };
    // предметы на месте и не изменились
    const take = (pl: Player, s: Side): Item[] | null => {
      const out: Item[] = [];
      for (const o of s.offers) {
        if (!o) continue;
        const it = pl.save.inventory[o.index];
        if (!it || it.uid !== o.uid || (it.qty ?? 1) !== o.qty || isBound(it)) return null;
        out.push(it);
      }
      return out;
    };
    const ia = take(p, t.a), ib = take(q, t.b);
    if (!ia || !ib) return fail("Предметы в обмене изменились — проверьте и подтвердите заново");
    if (p.save.gold < t.a.gold || q.save.gold < t.b.gold) return fail("Не хватает золота для обмена");

    const backup = { pi: JSON.stringify(p.save.inventory), qi: JSON.stringify(q.save.inventory), pg: p.save.gold, qg: q.save.gold };
    const restore = () => {
      p.save.inventory = JSON.parse(backup.pi);
      q.save.inventory = JSON.parse(backup.qi);
      p.save.gold = backup.pg;
      q.save.gold = backup.qg;
      p.selfDirty = q.selfDirty = true;
    };
    for (const o of t.a.offers) if (o) p.save.inventory[o.index] = null;
    for (const o of t.b.offers) if (o) q.save.inventory[o.index] = null;
    const fitsP = ib.every((it) => addItem(p, JSON.parse(JSON.stringify(it))));
    const fitsQ = ia.every((it) => addItem(q, JSON.parse(JSON.stringify(it))));
    if (!fitsP || !fitsQ) {
      restore();
      const who = [!fitsP && p.name, !fitsQ && q.name].filter(Boolean).join(" и ");
      return fail(`Недостаточно места в сумке: ${who}. Освободите ячейки`);
    }
    p.save.gold += t.b.gold - t.a.gold;
    q.save.gold += t.a.gold - t.b.gold;

    const db = this.db();
    try {
      db.raw.exec("BEGIN IMMEDIATE");
      db.save(p.name, p.toSave(this.spawn()));
      db.save(q.name, q.toSave(this.spawn()));
      db.raw
        .prepare("INSERT INTO trade_log (at, a, b, a_items, b_items, a_gold, b_gold) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(Date.now(), p.name, q.name, JSON.stringify(ia), JSON.stringify(ib), t.a.gold, t.b.gold);
      db.raw.exec("COMMIT");
    } catch (e) {
      try { db.raw.exec("ROLLBACK"); } catch {}
      console.error("[trade] транзакция не прошла:", e);
      restore();
      return fail("Ошибка обмена, ничего не передано");
    }
    p.selfDirty = q.selfDirty = true;
    this.trades.delete(t.a.key);
    this.trades.delete(t.b.key);
    for (const pl of [p, q]) {
      pl.send("trade:state", null);
      pl.send("trade:done", {});
      toast(pl, "Обмен завершён", "info");
    }
  }
}
