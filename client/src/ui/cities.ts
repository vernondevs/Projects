/** Города: диалог заданий, трекер под рамкой героя и окно камня телепорта. */
import { gold } from "./gold";
import { CITIES, cityById, stoneNear, teleportPrice } from "../../../shared/cities";
import type { SelfState } from "../../../shared/protocol";
import { QUESTS, QUEST_GIVERS, questsOf } from "../../../shared/quests";
import { RESOURCES } from "../../../shared/biomes";
import { MOBS } from "../../../shared/mobs";
import type { Net } from "../net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const targetName = (k: string, t: string) => (k === "kill" ? MOBS[t]?.name ?? t : RESOURCES[t]?.name ?? t);
const verb = (k: string) => (k === "kill" ? "Убить" : "Добыть");

export class QuestUI {
  private win = document.createElement("div");
  private track = document.createElement("div");
  private log = document.createElement("div");
  private net!: Net;
  private giver = "";

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-quest";
    this.win.hidden = true;
    this.track.className = "panel hud-quests";
    this.track.hidden = true;
    this.log.className = "panel win win-qlog";
    this.log.hidden = true;
    root.append(this.win, this.track, this.log);
  }
  /** Журнал заданий (из меню Esc): активные задания с прогрессом. */
  toggleLog() {
    this.log.hidden = !this.log.hidden;
    if (this.net.self) this.update(this.net.self);
  }
  closeLog(): boolean {
    const was = !this.log.hidden;
    this.log.hidden = true;
    return was;
  }
  private renderLog(act: [string, number][]) {
    this.log.innerHTML = `<h2><span>Задания</span><button class="x" aria-label="Закрыть">×</button></h2>`
      + (act.length ? act.map(([id, n]) => {
        const d = QUESTS[id];
        return `<div class="quest-row"><div class="qt">${esc(d.name)} <span class="muted">ур. ${d.level}+</span></div><div>${verb(d.kind)}: ${esc(targetName(d.kind, d.target))} — ${Math.min(n, d.n)}/${d.n}${n >= d.n ? ' <span class="gold">(можно сдать)</span>' : ""}</div></div>`;
      }).join("") : `<p class="muted">Активных заданий нет. Берите их у NPC в городах.</p>`);
    this.log.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.closeLog();
  }
  bind(net: Net) {
    this.net = net;
  }
  open(giver: string) {
    this.giver = giver;
    this.win.hidden = false;
    if (this.net.self) this.update(this.net.self);
  }
  close(): boolean {
    const was = !this.win.hidden || !this.log.hidden;
    this.win.hidden = true;
    this.log.hidden = true;
    return was;
  }
  update(s: SelfState) {
    const q = s.quests ?? { active: {}, done: [] };
    // трекер активных заданий
    const act = Object.entries(q.active).filter(([id]) => QUESTS[id]);
    this.track.hidden = !act.length;
    this.track.innerHTML = act.length
      ? `<div class="qh">Задания</div>` + act.map(([id, n]) => {
        const d = QUESTS[id];
        return `<div class="qrow${n >= d.n ? " ok" : ""}"><span>${esc(d.name)}</span><b>${Math.min(n, d.n)}/${d.n}</b></div>`;
      }).join("")
      : "";
    if (!this.log.hidden) this.renderLog(act);
    if (this.win.hidden) return;
    const g = QUEST_GIVERS.find((x) => x.id === this.giver);
    if (!g) return;
    this.win.innerHTML = `<h2><span>${esc(g.name)}</span><button class="x" aria-label="Закрыть">×</button></h2><p class="muted">${esc(g.greeting ?? "")}</p><div class="quest-list"></div>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    const list = this.win.querySelector<HTMLElement>(".quest-list")!;
    for (const d of questsOf(this.giver)) {
      const have = q.active[d.id];
      const done = q.done.includes(d.id);
      const row = document.createElement("div");
      row.className = "quest-row";
      const item = d.reward.item ? ` · ${d.reward.item.base === "hp_potion" ? "зелья здоровья" : "зелья маны"} ×${d.reward.item.qty}` : "";
      row.innerHTML = `<div class="qt">${esc(d.name)} <span class="muted">ур. ${d.level}+</span></div><div class="muted">${esc(done ? d.done : d.text)}</div>`
        + `<div>${verb(d.kind)}: ${esc(targetName(d.kind, d.target))} — ${have !== undefined ? Math.min(have, d.n) : 0}/${d.n}</div>`
        + `<div class="muted">Награда: ${gold(d.reward.gold)} · ${d.reward.xp} опыта${item}</div>`;
      const b = document.createElement("button");
      b.className = "btn small";
      if (done) { b.textContent = "Сдано"; b.disabled = true; }
      else if (have === undefined) { b.textContent = "Принять"; b.disabled = s.level < d.level; b.onclick = () => this.net.send("quest:accept", { id: d.id }); }
      else if (have >= d.n) { b.textContent = "Сдать"; b.onclick = () => this.net.send("quest:turn", { id: d.id }); }
      else { b.textContent = "В процессе"; b.disabled = true; }
      row.append(b);
      list.append(row);
    }
  }
}

export class TeleportUI {
  private win = document.createElement("div");
  private net!: Net;
  private opened = false;

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-tp";
    this.win.hidden = true;
    root.append(this.win);
  }
  bind(net: Net) {
    this.net = net;
  }
  open(pos: { x: number; y: number }) {
    this.pos = pos;
    this.opened = true;
    this.win.hidden = false;
    if (this.net.self) this.update(this.net.self, this.pos);
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    this.opened = false;
    return was;
  }
  /** Позицию героя задаёт HUD каждый кадр. */
  pos?: { x: number; y: number };
  update(s: SelfState, pos?: { x: number; y: number }) {
    this.pos = pos ?? this.pos;
    if (!this.opened) return;
    const here = this.pos ? stoneNear(this.pos.x, this.pos.y) : null;
    const found = new Set(["ember", ...(s.cities ?? [])]);
    this.win.innerHTML = `<h2><span>Камень телепорта</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="muted">Вы здесь: <b>${esc(here?.name ?? "—")}</b>. Каст 3 секунды: движение, урон и бой прерывают переход.</p><div class="tp-list"></div>
      <p class="muted">Золото: <b>${gold(s.gold)}</b></p>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    const list = this.win.querySelector<HTMLElement>(".tp-list")!;
    for (const c of CITIES) {
      const row = document.createElement("div");
      row.className = "shoprow";
      const ok = found.has(c.id);
      row.innerHTML = `<div>${esc(ok ? c.name : "???")}${ok ? "" : `<br><span class="muted">Не открыт — посетите город</span>`}</div>`;
      if (ok && here && here.id !== c.id) {
        const price = teleportPrice(here, cityById(c.id)!);
        const b = document.createElement("button");
        b.className = "btn small";
        b.innerHTML = `Телепорт · ${gold(price)}`;
        b.disabled = s.gold < price;
        b.onclick = () => { this.net.send("tp:go", { id: c.id }); this.close(); };
        row.append(b);
      } else if (ok && here?.id === c.id) row.append(Object.assign(document.createElement("span"), { className: "muted", textContent: "Вы здесь" }));
      list.append(row);
    }
  }
}
