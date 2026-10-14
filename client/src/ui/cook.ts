/** Повар Борщан: небольшое окно с блюдами; описание бонусов еды для подсказок. */
import { COOK, FOOD_IDS, FOOD, type Dish } from "../../../shared/food";
import { ITEM_STAT_NAMES, type ItemStatKey } from "../../../shared/items";
import type { SelfState } from "../../../shared/protocol";
import type { Net } from "../net";

const icon = (name: string) => `/assets/icons/${name}.png`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function foodBonuses(d: Dish): string {
  return (Object.entries(d.stats) as [ItemStatKey, number][]).map(([k, v]) => `+${v} ${ITEM_STAT_NAMES[k]}`).join(", ");
}
/** Подсказка блюда; left — оставшиеся минуты (для активного бафа). */
export function foodTip(d: Dish, leftMin?: number): string {
  return [
    `<div class="t">${esc(d.name)}</div>`,
    leftMin == null ? `<div class="d">Еда · ур. ${d.req}+ · бафф ${d.minutes} мин.</div>` : `<div class="d">Бафф еды · осталось ${leftMin} мин.</div>`,
    d.hpPct || d.mpPct ? `<div>Сразу: ${[d.hpPct ? `${d.hpPct}% здоровья` : "", d.mpPct ? `${d.mpPct}% маны` : ""].filter(Boolean).join(", ")}</div>` : "",
    `<div class="st">${foodBonuses(d)}</div>`,
    `<div class="d">Одновременно действует одна еда. На арене есть нельзя.</div>`,
  ].join("");
}

export class CookUI {
  private win = document.createElement("div");
  private net!: Net;

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-cook";
    this.win.hidden = true;
    root.append(this.win);
  }
  bind(net: Net) {
    this.net = net;
  }
  open() {
    this.win.hidden = false;
    if (this.net.self) this.update(this.net.self);
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    return was;
  }
  update(s: SelfState) {
    if (this.win.hidden) return;
    this.win.innerHTML = `<h2><span>${esc(COOK.name)}</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="muted">${esc(COOK.greeting)}</p><div class="cook-list"></div><p class="muted">Золото: <b class="gold">${s.gold}</b></p>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    const list = this.win.querySelector<HTMLElement>(".cook-list")!;
    for (const id of FOOD_IDS) {
      const d = FOOD[id];
      const row = document.createElement("div");
      row.className = "shoprow";
      row.innerHTML = `<img src="${icon(d.icon)}" alt=""><div>${esc(d.name)} <span class="muted">ур. ${d.req}</span><br><span class="muted">${foodBonuses(d)} · ${d.minutes} мин.</span></div>`;
      for (const q of [1, 5]) {
        const b = document.createElement("button");
        b.className = "btn small";
        b.innerHTML = `×${q} · <span class="gold">${d.price * q} з</span>`;
        b.disabled = s.gold < d.price * q;
        b.onclick = () => this.net.send("cook:buy", { id, qty: q });
        row.append(b);
      }
      list.append(row);
    }
  }
}
