/** Окна случайных встреч: диалог путника и лавка бродячего торговца. */
import { gold as goldHtml } from "./gold";
import type { EncDialogMsg, EncShopMsg } from "../../../shared/encounters";
import { iconFor, itemName, RARITY_COLORS } from "../../../shared/items";
import type { Net } from "../net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class EncounterUI {
  private win = document.createElement("div");
  private net!: Net;
  private id = "";

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-enc";
    this.win.hidden = true;
    root.append(this.win);
  }

  bind(net: Net) {
    this.net = net;
    net.on("enc:dialog", (m) => this.dialog(m));
    net.on("enc:shop", (m) => this.shop(m));
    net.on("enc:gone", (m) => {
      if (m.id === this.id) this.close();
    });
  }

  /** Подойти и заговорить: сервер ответит окном диалога или лавки. */
  open(id: string) {
    this.id = id;
    this.net.send("enc:talk", { id });
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    return was;
  }

  private head(name: string) {
    this.win.hidden = false;
    this.id = this.id || "";
    return `<h2><span>${esc(name)}</span><button class="x" aria-label="Закрыть">×</button></h2>`;
  }
  private wire() {
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
  }

  private dialog(m: EncDialogMsg) {
    this.id = m.id;
    this.win.innerHTML = `${this.head(m.name)}<p class="rumor-text">${esc(m.text)}</p><div class="enc-opts"></div>`;
    const box = this.win.querySelector(".enc-opts")!;
    for (const o of m.opts) {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = o.label;
      b.onclick = () => this.net.send("enc:act", { id: m.id, opt: o.id });
      box.append(b);
    }
    const bye = document.createElement("button");
    bye.className = "btn small";
    bye.textContent = "Пока";
    bye.onclick = () => this.close();
    box.append(bye);
    this.wire();
  }

  private shop(m: EncShopMsg) {
    this.id = m.id;
    const gold = this.net.self?.gold ?? 0;
    this.win.innerHTML = `${this.head(m.name)}<p class="muted">${esc(m.text)} Лавка закроется через ~${Math.ceil(m.until / 60)} мин.</p><div class="enc-list"></div>`;
    const list = this.win.querySelector(".enc-list")!;
    for (const s of m.stock) {
      const row = document.createElement("div");
      row.className = "shoprow";
      const it = s.item;
      row.innerHTML = `<img src="/assets/icons/${iconFor(it)}.png" alt=""><div><span style="color:${RARITY_COLORS[it.rarity]}">${esc(itemName(it))}${it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}</span><br><span class="muted">ур. ${it.req}</span></div>`;
      const btn = document.createElement("button");
      btn.className = "btn small";
      btn.innerHTML = `${goldHtml(s.price)}`;
      btn.disabled = gold < s.price;
      btn.onclick = () => this.net.send("enc:buy", { id: m.id, idx: s.idx });
      row.append(btn);
      list.append(row);
    }
    if (!m.stock.length) list.innerHTML = `<p class="muted">Всё раскуплено.</p>`;
    this.wire();
  }
}
