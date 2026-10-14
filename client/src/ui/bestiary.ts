/** Окно бестиария (клавиша B): записи о мобах открываются по числу убийств. */
import { BESTIARY, fullKills, mobHabitat } from "../../../shared/bestiary";
import { iconFor, makeItem, makeUnique } from "../../../shared/items";
import { MOBS } from "../../../shared/mobs";
import type { SelfState } from "../../../shared/protocol";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const IDS = Object.keys(MOBS).sort((a, b) => Number(!!MOBS[a].boss) - Number(!!MOBS[b].boss));

export class BestiaryUI {
  private win = document.createElement("div");
  private kills: Record<string, number> = {};
  private sel = IDS[0];

  constructor(root: HTMLElement, private icon: (name: string) => string) {
    this.win.className = "panel win win-bestiary";
    this.win.hidden = true;
    root.append(this.win);
  }

  toggle(self: SelfState | null) {
    this.win.hidden = !this.win.hidden;
    if (self) this.update(self);
    else this.render();
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    return was;
  }
  update(s: SelfState) {
    this.kills = s.mobKills ?? {};
    if (!this.win.hidden) this.render();
  }

  private render() {
    const list = IDS.map((id) => {
      const n = this.kills[id] || 0;
      return `<button class="btn small ${n ? "" : "locked"}" data-id="${id}" aria-pressed="${id === this.sel}">${n ? esc(MOBS[id].name) : "???"}</button>`;
    }).join("");
    this.win.innerHTML = `<h2><span>Бестиарий</span><button class="x" aria-label="Закрыть">×</button></h2>
      <div class="bst"><div class="bst-list">${list}</div><div class="bst-det">${this.detail()}</div></div>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => (this.win.hidden = true);
    this.win.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((b) => (b.onclick = () => { this.sel = b.dataset.id!; this.render(); }));
  }

  private detail(): string {
    const id = this.sel, def = MOBS[id], n = this.kills[id] || 0, need = fullKills(id);
    if (!n) return `<p class="muted">Запись откроется после первого убийства.</p>`;
    const hab = mobHabitat(id);
    const lv = hab.levels ? (hab.levels[0] === hab.levels[1] ? `${hab.levels[0]}` : `${hab.levels[0]}–${hab.levels[1]}`) : "—";
    const fs = def.size === 2 ? 64 : 32;
    let html = `<div class="bst-head"><div class="bst-sprite" style="width:${fs}px;height:${fs}px;background-image:url(/assets/units/${def.sprite}.png)"></div>
      <div><b>${esc(def.name)}</b>${def.boss ? ' <span class="muted">(босс)</span>' : ""}<br><span class="muted">Уровень ${lv} · убито: ${n}</span></div></div>
      <p>${esc(BESTIARY[id]?.desc ?? "")}</p>`;
    if (n < need) return html + `<p class="muted">${n}/${need} убийств до полной записи</p>`;
    const pct = (v: number) => `×${v.toFixed(2).replace(/\.?0+$/, "")}`;
    html += `<div class="bst-stats"><div>Здоровье<br><b>${pct(def.hp)}</b></div><div>Урон<br><b>${pct(def.dmg)}</b></div><div>Броня<br><b>${pct(def.armor)}</b></div></div>
      <div><span class="muted">Обитает:</span> ${esc(hab.zones.join(", ") || "—")}</div><div class="muted">Добыча:</div>`;
    const items = def.boss
      ? [...(def.uniques ?? []).map((u) => makeUnique(u)), makeItem("hp_potion", 1, 0)]
      : [makeItem("hp_potion", 1, 0), makeItem("mp_potion", 1, 0)];
    html += `<div class="bst-loot">${items.map((it) => `<img src="${this.icon(iconFor(it))}" alt="${esc(it.name)}" title="${esc(it.name)}">`).join("")}</div>`;
    if (!def.boss) html += `<div class="muted">Также иногда выпадает снаряжение.</div>`;
    return html;
  }
}
