/** Банк Голдмунда: вкладки, ячейки, перетаскивание сумка ⇄ банк, золото и покупка места. Всё проверяет сервер. */
import { gold } from "./gold";
import { BANK_STEP, BANK_TAB_SIZE, BANK_TABS, BANKER, SHARED_SIZE, SHARED_TAB, type BankView } from "../../../shared/bank";
import { iconFor, itemName, type Item } from "../../../shared/items";
import type { SelfState } from "../../../shared/protocol";
import type { Net } from "../net";
import { plusBadge } from "./smith";

const icon = (name: string) => `/assets/icons/${name}.png`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface BankHost {
  itemTip: (it: Item, s: SelfState) => string;
  tipFor: (e: HTMLElement, html: () => string) => void;
  hideTip: () => void;
  /** Открыть сумку рядом с банком. */
  showInv: () => void;
}

/** Данные перетаскивания из банка: "bank:<вкладка>:<ячейка>". */
export const parseBankDrag = (s: string): { tab: number; slot: number } | null => {
  const m = /^bank:(\d+):(\d+)$/.exec(s);
  return m ? { tab: Number(m[1]), slot: Number(m[2]) } : null;
};

export class BankUI {
  private win = document.createElement("div");
  private net!: Net;
  private state: BankView | null = null;
  private tab = 0;

  constructor(root: HTMLElement, private host: BankHost) {
    this.win.className = "panel win win-bank";
    this.win.hidden = true;
    root.append(this.win);
  }
  bind(net: Net) {
    this.net = net;
    net.on("bank", (v) => {
      this.state = v;
      this.render();
    });
    net.on("switch", () => this.close());
  }
  get isOpen() {
    return !this.win.hidden;
  }
  get currentTab() {
    return this.tab;
  }
  open() {
    this.win.hidden = false;
    this.net.send("bank:open", {});
    this.host.showInv();
    this.render();
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    return was;
  }
  /** Клик по предмету сумки при открытом банке — положить в текущую вкладку. */
  deposit(index: number) {
    this.net.send("bank:put", { index, tab: this.tab });
  }

  private render() {
    if (this.win.hidden) return;
    const v = this.state;
    const s = this.net.self;
    const prev = this.win.querySelector<HTMLInputElement>(".bank-gold input");
    const keep = { value: prev?.value ?? "", focus: !!prev && document.activeElement === prev };
    this.win.innerHTML = `<h2><span>${esc(BANKER.name)}</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="muted">${esc(BANKER.greeting)}</p>
      <div class="bank-tabs"></div><div class="grid bank-grid"></div>
      <p class="muted">Клик — забрать в сумку. Перетащите предмет из сумки сюда или клик по нему в сумке — положить.</p>
      <div class="bank-gold"><span>В банке: <b>${gold(v?.gold ?? 0)}</b> · в сумке: <b>${gold(s?.gold ?? 0)}</b></span>
        <input type="number" min="1" step="1" placeholder="Сумма"><button class="btn small" data-g="1">Положить</button><button class="btn small" data-g="-1">Снять</button></div>
      <div class="bank-buy"></div>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    if (!v) return;
    if (this.tab >= v.tabs.length && this.tab !== SHARED_TAB) this.tab = 0;
    const shared = this.tab === SHARED_TAB;

    const tabs = this.win.querySelector<HTMLElement>(".bank-tabs")!;
    for (let t = 0; t < BANK_TABS; t++) {
      const open = t < v.tabs.length;
      const b = document.createElement("button");
      b.className = `btn small${t === this.tab ? " active" : ""}`;
      b.textContent = open ? `Вкладка ${t + 1} (${v.tabs[t].length})` : `🔒 ${t + 1}`;
      b.disabled = !open;
      if (open) {
        b.onclick = () => { this.tab = t; this.render(); };
        b.ondragover = (e) => e.preventDefault();
        b.ondrop = (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer!.getData("text/plain"));
          if (Number.isInteger(from)) this.net.send("bank:put", { index: from, tab: t });
        };
      }
      tabs.append(b);
    }
    {
      // общий склад аккаунта: виден всем героям аккаунта
      const b = document.createElement("button");
      b.className = `btn small${shared ? " active" : ""}`;
      b.textContent = "Общий склад";
      b.title = "Общий для всех героев вашего аккаунта";
      b.onclick = () => { this.tab = SHARED_TAB; this.render(); };
      b.ondragover = (e) => e.preventDefault();
      b.ondrop = (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer!.getData("text/plain"));
        if (Number.isInteger(from)) this.net.send("bank:put", { index: from, tab: SHARED_TAB });
      };
      tabs.append(b);
    }

    const grid = this.win.querySelector<HTMLElement>(".bank-grid")!;
    const cells = shared ? v.shared ?? [] : v.tabs[this.tab];
    for (let i = 0; i < (shared ? SHARED_SIZE : BANK_TAB_SIZE); i++) {
      const c = document.createElement("button");
      if (i >= cells.length) {
        c.className = "cell locked";
        c.disabled = true;
        c.title = "Ячейка не куплена";
        grid.append(c);
        continue;
      }
      const it = cells[i];
      c.className = `cell ${it ? "r" + it.rarity : ""}`;
      if (it) {
        c.innerHTML = `<img src="${icon(iconFor(it))}" alt="${esc(itemName(it))}">${plusBadge(it)}${it.qty && it.qty > 1 ? `<span class="qty">${it.qty}</span>` : ""}`;
        c.draggable = true;
        c.ondragstart = (e) => e.dataTransfer!.setData("text/plain", `bank:${this.tab}:${i}`);
        c.onclick = () => { this.host.hideTip(); this.net.send("bank:take", { tab: this.tab, slot: i }); };
        if (s) this.host.tipFor(c, () => this.host.itemTip(it, this.net.self!));
      }
      c.ondragover = (e) => { e.preventDefault(); c.classList.add("drag"); };
      c.ondragleave = () => c.classList.remove("drag");
      c.ondrop = (e) => {
        e.preventDefault();
        c.classList.remove("drag");
        const data = e.dataTransfer!.getData("text/plain");
        const bank = parseBankDrag(data);
        if (bank) this.net.send("bank:move", { tab: bank.tab, slot: bank.slot, toTab: this.tab, toSlot: i });
        else if (data !== "" && Number.isInteger(Number(data))) this.net.send("bank:put", { index: Number(data), tab: this.tab, slot: i });
      };
      grid.append(c);
    }

    const inp = this.win.querySelector<HTMLInputElement>(".bank-gold input")!;
    inp.value = keep.value;
    if (keep.focus) inp.focus();
    inp.addEventListener("keydown", (e) => e.stopPropagation());
    for (const b of this.win.querySelectorAll<HTMLButtonElement>(".bank-gold button")) {
      b.onclick = () => {
        const n = Math.floor(Number(inp.value) || 0);
        if (n > 0) this.net.send("bank:gold", { v: n * Number(b.dataset.g) });
      };
    }

    const buy = this.win.querySelector<HTMLElement>(".bank-buy")!;
    if (v.price === null) buy.innerHTML = `<span class="ok">Банк максимального размера</span>`;
    else {
      const last = v.tabs[v.tabs.length - 1];
      const what = last.length < BANK_TAB_SIZE ? `+${BANK_STEP} ячеек во вкладке ${v.tabs.length}` : `новая вкладка ${v.tabs.length + 1}`;
      const b = document.createElement("button");
      b.className = "btn";
      b.innerHTML = `Купить: ${what} · ${gold(v.price)}`;
      b.disabled = (s?.gold ?? 0) < v.price;
      b.onclick = () => this.net.send("bank:buy", {});
      buy.append(b);
    }
  }

  /** Обновить при изменении личного состояния (золото в сумке). */
  update() {
    this.render();
  }
}
