/** Сумочник Кожемякин: расширение сумки за золото. Всё проверяет сервер. */
import { gold } from "./gold";
import { BAGMAN, BAG_MAX, BAG_STEP, bagPrice } from "../../../shared/bags";
import type { Net } from "../net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class BagsUI {
  private win = document.createElement("div");
  private net!: Net;
  constructor(root: HTMLElement, private showInv: () => void) {
    this.win.className = "panel win win-bags";
    this.win.hidden = true;
    root.append(this.win);
  }
  bind(net: Net) {
    this.net = net;
    net.on("switch", () => this.close());
  }
  get isOpen() { return !this.win.hidden; }
  open() { this.win.hidden = false; this.showInv(); this.update(); }
  close(): boolean { const was = !this.win.hidden; this.win.hidden = true; return was; }
  update() {
    if (this.win.hidden) return;
    const s = this.net?.self;
    if (!s) return;
    const size = s.inventory.length;
    const price = bagPrice(size);
    this.win.innerHTML = `<h2><span>${esc(BAGMAN.name)}</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="muted">${esc(BAGMAN.greeting)}</p>
      <p>Сейчас в сумке: <b class="gold">${size}</b> ячеек (максимум ${BAG_MAX}).</p>
      ${price === null ? `<p class="muted">Сумка уже самая большая.</p>` : `<p>Следующее расширение: <b>+${BAG_STEP}</b> ячеек до <b>${size + BAG_STEP}</b> за ${gold(price)}.</p><div class="bank-buy"><button class="btn" ${s.gold < price ? "disabled" : ""}>Расширить за ${gold(price)}</button></div>`}`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    const b = this.win.querySelector<HTMLButtonElement>(".bank-buy .btn");
    if (b) b.onclick = () => this.net.send("bag:expand", {});
  }
}
