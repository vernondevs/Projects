/** Окно обмена между игроками: запрос, два столбца по 8 слотов, золото, «Готов» → «Обменять». */
import { BASE_ITEMS, type Item } from "../../../shared/items";
import type { SelfState } from "../../../shared/protocol";
import { TRADE_SLOTS, type TradeSideView, type TradeView } from "../../../shared/trade";
import type { Net } from "../net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icon = (name: string) => `/assets/icons/${name}.png`;

export interface TradeHost {
  itemTip(it: Item, s: SelfState): string;
  tipFor(elm: HTMLElement, html: () => string): void;
  hideTip(): void;
}

export class TradeUI {
  private net!: Net;
  private win = document.createElement("div");
  private ask = document.createElement("div");
  private menu = document.createElement("div");
  private state: TradeView | null = null;
  private askTimer = 0;
  private confirmTimer = 0;
  /** Подсветка изменённых слотов: ключ "m3"/"t3"/"mg"/"tg" -> до какого времени. */
  private flash = new Map<string, number>();
  private confirmAt = 0;

  constructor(root: HTMLElement, private host: TradeHost) {
    this.win.className = "panel win win-trade";
    this.win.hidden = true;
    this.ask.className = "arena-modal";
    this.ask.hidden = true;
    this.menu.className = "panel ctx-menu";
    this.menu.hidden = true;
    root.append(this.win, this.ask, this.menu);
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.menu.hidden = true;
    });
  }

  bind(net: Net) {
    this.net = net;
    net.on("trade:request", (m) => this.showAsk(m));
    net.on("trade:state", (v) => this.apply(v));
    net.on("switch", () => this.apply(null));
  }

  get isOpen() {
    return !!this.state;
  }
  /** Индексы сумки, выложенные в окно обмена. */
  lockedIndices(): Set<number> {
    return new Set((this.state?.mine.index ?? []).filter((i) => i >= 0));
  }
  /** Клик по предмету сумки при открытом окне — выложить его. */
  offer(index: number, slot?: number) {
    this.net.send("trade:add", { index, slot });
  }
  close(): boolean {
    if (!this.state) return false;
    this.net.send("trade:cancel");
    return true;
  }

  /** Контекстное меню по правому клику на игроке. */
  showMenu(id: string, name: string, x: number, y: number) {
    this.menu.innerHTML = `<div class="d">${esc(name)}</div><button class="btn small">Предложить обмен</button>`;
    this.menu.style.left = Math.min(x, innerWidth - 180) + "px";
    this.menu.style.top = Math.min(y, innerHeight - 80) + "px";
    this.menu.hidden = false;
    this.menu.querySelector("button")!.onclick = () => {
      this.menu.hidden = true;
      this.net.send("trade:request", { id });
    };
  }

  private showAsk(m: { from: string; ms: number } | null) {
    clearTimeout(this.askTimer);
    if (!m) return void (this.ask.hidden = true);
    this.ask.hidden = false;
    const until = performance.now() + m.ms;
    this.ask.innerHTML = `<div class="panel arena-dialog small" role="alertdialog"><h2>Обмен</h2><p>${esc(m.from)} предлагает обмен.</p><p class="muted" data-left></p>
      <div class="row-btns"><button class="btn primary" data-a="1">Принять</button><button class="btn" data-a="0">Отклонить</button></div></div>`;
    const left = this.ask.querySelector<HTMLElement>("[data-left]")!;
    const tick = () => {
      const s = Math.ceil((until - performance.now()) / 1000);
      if (s <= 0) return void (this.ask.hidden = true);
      left.textContent = `Осталось ${s} с`;
      this.askTimer = window.setTimeout(tick, 250);
    };
    tick();
    this.ask.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => {
      clearTimeout(this.askTimer);
      this.net.send("trade:respond", { accept: b.dataset.a === "1" });
      this.ask.hidden = true;
    }));
  }

  private apply(v: TradeView | null) {
    this.state = v;
    clearTimeout(this.confirmTimer);
    if (!v) {
      this.win.hidden = true;
      this.host.hideTip();
      if (this.net.self) this.onChange?.();
      return;
    }
    const now = performance.now();
    for (const i of v.mine.changed) this.flash.set("m" + i, now + 1500);
    for (const i of v.theirs.changed) this.flash.set("t" + i, now + 1500);
    if (v.mine.goldChanged) this.flash.set("mg", now + 1500);
    if (v.theirs.goldChanged) this.flash.set("tg", now + 1500);
    this.confirmAt = now + v.confirmIn;
    this.win.hidden = false;
    this.render();
    this.onChange?.();
    if (v.confirmIn > 0) this.confirmTimer = window.setTimeout(() => this.render(), v.confirmIn + 30);
  }
  /** Сумка перерисовывается, чтобы показать заблокированные предметы. */
  onChange?: () => void;

  private column(side: TradeSideView, mine: boolean): HTMLElement {
    const col = document.createElement("div");
    col.className = "trade-col";
    const k = mine ? "m" : "t";
    const status = side.confirm ? `<span class="ok">Обменять ✓</span>` : side.ready ? `<span class="ok">Готов ✓</span>` : `<span class="muted">не готов</span>`;
    col.innerHTML = `<h3>${mine ? "Вы отдаёте" : "Вы получаете"} ${status}</h3><div class="grid trade-grid"></div>
      <label class="trade-gold ${this.lit(k + "g") ? "changed" : ""}">Золото: ${mine ? `<input type="number" min="0" step="1" value="${side.gold}">` : `<b class="gold">${side.gold}</b>`}</label>`;
    const grid = col.querySelector(".grid")!;
    for (let i = 0; i < TRADE_SLOTS; i++) {
      const it = side.items[i];
      const c = document.createElement("button");
      c.className = `cell ${it ? "r" + it.rarity : ""} ${this.lit(k + i) ? "changed" : ""}`;
      if (it) c.innerHTML = `<img src="${icon(BASE_ITEMS[it.base].icon)}" alt="${esc(it.name)}">${it.qty && it.qty > 1 ? `<span class="qty">${it.qty}</span>` : ""}`;
      if (it) this.host.tipFor(c, () => this.host.itemTip(it, this.net.self!) + (mine ? `<div class="d">Клик — убрать из обмена</div>` : ""));
      if (mine) {
        if (it) c.onclick = () => { this.host.hideTip(); this.net.send("trade:remove", { slot: i }); };
        c.ondragover = (e) => { e.preventDefault(); c.classList.add("drag"); };
        c.ondragleave = () => c.classList.remove("drag");
        c.ondrop = (e) => {
          e.preventDefault();
          c.classList.remove("drag");
          const from = Number(e.dataTransfer!.getData("text/plain"));
          if (Number.isInteger(from)) this.offer(from, i);
        };
      }
      grid.append(c);
    }
    if (mine) {
      const inp = col.querySelector<HTMLInputElement>("input")!;
      inp.addEventListener("keydown", (e) => e.stopPropagation());
      inp.onchange = () => this.net.send("trade:gold", { v: Math.max(0, Math.floor(Number(inp.value) || 0)) });
    }
    return col;
  }
  private lit(k: string) {
    return (this.flash.get(k) ?? 0) > performance.now();
  }

  private render() {
    const v = this.state;
    if (!v) return;
    const me = v.mine, they = v.theirs;
    const bothReady = me.ready && they.ready;
    const wait = Math.max(0, this.confirmAt - performance.now());
    const focused = document.activeElement instanceof HTMLInputElement && this.win.contains(document.activeElement) ? document.activeElement.value : null;
    this.win.innerHTML = `<h2><span>Обмен с ${esc(they.name)}</span><button class="x" aria-label="Закрыть">×</button></h2>
      ${v.gift ? `<div class="trade-gift">Подарок — вы ничего не отдаёте</div>` : ""}
      <div class="trade-cols"></div>
      <p class="muted">Перетащите предметы из сумки (или кликните по ним). Любое изменение сбрасывает подтверждения.</p>
      <div class="row-btns"><button class="btn" data-r ${me.ready ? "disabled" : ""}>Готов</button>
      <button class="btn" data-c ${!bothReady || me.confirm || wait > 0 ? "disabled" : ""}>Обменять${bothReady && wait > 0 ? ` (${Math.ceil(wait / 1000)})` : ""}</button>
      <button class="btn" data-x>Отмена</button></div>`;
    const cols = this.win.querySelector(".trade-cols")!;
    cols.append(this.column(me, true), this.column(they, false));
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    this.win.querySelector<HTMLButtonElement>("[data-x]")!.onclick = () => this.close();
    this.win.querySelector<HTMLButtonElement>("[data-r]")!.onclick = () => this.net.send("trade:ready");
    this.win.querySelector<HTMLButtonElement>("[data-c]")!.onclick = () => this.net.send("trade:confirm");
    if (focused !== null) {
      const inp = this.win.querySelector<HTMLInputElement>("input")!;
      inp.value = focused;
      inp.focus();
    }
    if (bothReady && wait > 0) this.confirmTimer = window.setTimeout(() => this.render(), Math.min(1000, wait) + 20);
    const nextFlash = Math.min(...[...this.flash.values()].filter((t) => t > performance.now()));
    if (Number.isFinite(nextFlash)) window.setTimeout(() => this.state === v && this.render(), nextFlash - performance.now() + 20);
  }
}
