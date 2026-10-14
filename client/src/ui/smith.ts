/** Кузнец Гром: окно улучшения предметов (+1…+10) и покупки материалов. */
import { BASE_ITEMS, effStats, iconFor, itemName, ITEM_STAT_NAMES, SLOT_NAMES, SLOTS, type Item, type ItemStatKey, type Slot } from "../../../shared/items";
import type { SelfState } from "../../../shared/protocol";
import { MATERIAL_IDS, MATERIALS, MAX_PLUS, SMITH, stepFor } from "../../../shared/upgrade";
import type { Net } from "../net";

const icon = (name: string) => `/assets/icons/${name}.png`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Sel = { index: number } | { slot: Slot } | null;

/** Значок «+N» на ячейке предмета. */
export const plusBadge = (it: Item) => (it.plus ? `<span class="plus">+${it.plus}</span>` : "");

function statLines(it: Item): string {
  const st = effStats(it);
  const out: string[] = [];
  if (st.dmgMin) out.push(`Урон ${st.dmgMin}–${st.dmgMax}`);
  for (const [k, v] of Object.entries(st)) if (!["dmgMin", "dmgMax"].includes(k)) out.push(`${ITEM_STAT_NAMES[k as ItemStatKey]} ${v}`);
  return out.join(" · ");
}

export class SmithUI {
  private win = document.createElement("div");
  private net!: Net;
  private sel: Sel = null;

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-smith";
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
  private selected(s: SelfState): Item | null {
    if (!this.sel) return null;
    const it = "slot" in this.sel ? s.equip[this.sel.slot] : s.inventory[this.sel.index];
    return it && BASE_ITEMS[it.base].slot !== "consumable" ? it : null;
  }
  private count(s: SelfState, base: string) {
    return s.inventory.reduce((n, it) => n + (it && it.base === base ? it.qty ?? 1 : 0), 0);
  }
  update(s: SelfState) {
    if (this.win.hidden) return;
    const it = this.selected(s);
    if (!it) this.sel = null;
    this.win.innerHTML = `<h2><span>${esc(SMITH.name)}</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="muted">${esc(SMITH.greeting)}</p>
      <div class="smith-pick"></div><div class="smith-info"></div>
      <div class="smith-mats"></div><p class="muted">Золото: <b class="gold">${s.gold}</b></p>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    const pick = this.win.querySelector<HTMLElement>(".smith-pick")!;
    const add = (item: Item | null, sel: Sel, label = "") => {
      if (!item || BASE_ITEMS[item.base].slot === "consumable") return;
      const c = document.createElement("button");
      const chosen = this.sel && JSON.stringify(this.sel) === JSON.stringify(sel);
      c.className = `cell r${item.rarity}${chosen ? " drag" : ""}`;
      c.title = `${label ? label + ": " : ""}${itemName(item)}`;
      c.innerHTML = `<img src="${icon(iconFor(item))}" alt="${esc(itemName(item))}">${plusBadge(item)}`;
      c.onclick = () => { this.sel = sel; this.update(this.net.self!); };
      c.draggable = true;
      c.ondragstart = (e) => { this.sel = sel; e.dataTransfer!.setData("text/plain", "smith"); };
      pick.append(c);
    };
    for (const slot of SLOTS) add(s.equip[slot], { slot }, SLOT_NAMES[slot]);
    s.inventory.forEach((item, index) => add(item, { index }));
    if (!pick.children.length) pick.innerHTML = `<span class="muted">Нет предметов для улучшения</span>`;

    const info = this.win.querySelector<HTMLElement>(".smith-info")!;
    if (!it) info.innerHTML = `<p class="muted">Выберите предмет из сумки или надетый.</p>`;
    else {
      const plus = it.plus || 0;
      const step = stepFor(plus);
      const next = { ...it, plus: plus + 1 };
      const have = { ore: this.count(s, "ash_ore"), dust: this.count(s, "star_dust") };
      let html = `<div class="t r${it.rarity}">${esc(itemName(it))}</div><div class="muted">Сейчас: ${statLines(it)}</div>`;
      if (!step) html += `<div class="ok">Максимальное улучшение +${MAX_PLUS}</div>`;
      else {
        const okMat = have.ore >= step.ore && have.dust >= step.dust && s.gold >= step.gold;
        html += `<div>Станет +${plus + 1}: ${statLines(next)}</div>
          <div>Шанс: <b>${step.chance}%</b>${step.chance < 100 ? ` · при неудаче уровень снизится до +${Math.max(0, plus - 1)}` : ""}</div>
          <div class="${s.gold >= step.gold ? "" : "warn"}">Золото: <span class="gold">${step.gold}</span></div>
          <div class="${have.ore >= step.ore ? "" : "warn"}">Пепельная руда: ${have.ore} / ${step.ore}</div>
          ${step.dust ? `<div class="${have.dust >= step.dust ? "" : "warn"}">Звёздная пыль: ${have.dust} / ${step.dust}</div>` : ""}
          <button class="btn smith-go"${okMat ? "" : " disabled"}>Улучшить</button>`;
      }
      info.innerHTML = html;
      const go = info.querySelector<HTMLButtonElement>(".smith-go");
      if (go) go.onclick = () => this.net.send("smith:upgrade", "slot" in this.sel! ? { slot: (this.sel as { slot: Slot }).slot } : { index: (this.sel as { index: number }).index });
    }

    const mats = this.win.querySelector<HTMLElement>(".smith-mats")!;
    for (const id of MATERIAL_IDS) {
      const m = MATERIALS[id];
      const row = document.createElement("div");
      row.className = "shoprow";
      row.innerHTML = `<img src="${icon(m.icon)}" alt=""><div>${esc(m.name)} <span class="muted">(есть: ${this.count(s, id)})</span></div>`;
      for (const q of [1, 10]) {
        const b = document.createElement("button");
        b.className = "btn small";
        b.innerHTML = `×${q} · <span class="gold">${m.price * q} з</span>`;
        b.disabled = s.gold < m.price * q;
        b.onclick = () => this.net.send("smith:buy", { id, qty: q });
        row.append(b);
      }
      mats.append(row);
    }
  }
}
