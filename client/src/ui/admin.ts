/** Админ-панель (F10): игроки, выдача, мир, логи. Кнопка видна только админам; все права проверяет сервер. */
import { BASE_ITEMS, UNIQUES } from "../../../shared/items";
import { LEGENDARIES } from "../../../shared/legendary";
import { ZONES } from "../../../shared/map";
import { MOBS } from "../../../shared/mobs";
import type { Net } from "../net";

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const date = (ms: number) => new Date(ms).toLocaleString("ru-RU");
const opts = (ids: string[], name: (id: string) => string) => ids.map((id) => `<option value="${esc(id)}">${esc(name(id))} (${esc(id)})</option>`).join("");
const TABS: [string, string][] = [["players", "Игроки"], ["give", "Выдача"], ["world", "Мир"], ["logs", "Логи"]];

export class AdminUI {
  private win = document.createElement("div");
  private banner = document.createElement("div");
  private net!: Net;
  private tab = "players";
  private players: { name: string; cls: string; level: number; x: number; y: number }[] = [];
  private logs: { kind: string; rows: any[] } = { kind: "trades", rows: [] };
  private logKind = "trades";
  private logName = "";
  private target = "";
  private bannerTimer = 0;

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-admin";
    this.win.hidden = true;
    this.banner.className = "adm-banner";
    this.banner.hidden = true;
    root.append(this.win, this.banner);
  }

  bind(net: Net) {
    this.net = net;
    net.on("admin:players", (m) => { this.players = m; if (this.tab === "players") this.render(); });
    net.on("admin:logs", (m) => { this.logs = m; if (this.tab === "logs") this.render(); });
    net.on("admin:banner", (m) => {
      this.banner.textContent = m.text;
      this.banner.hidden = false;
      clearTimeout(this.bannerTimer);
      this.bannerTimer = window.setTimeout(() => (this.banner.hidden = true), 7000);
    });
  }

  toggle() {
    this.win.hidden = !this.win.hidden;
    if (!this.win.hidden) this.refresh();
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    return was;
  }

  private refresh() {
    if (this.tab === "players") this.net.send("admin:players");
    if (this.tab === "logs") this.net.send("admin:logs", { kind: this.logKind, name: this.logName });
    this.render();
  }

  private render() {
    const tabs = TABS.map(([id, n]) => `<button class="btn small" data-tab="${id}" aria-pressed="${id === this.tab}">${n}</button>`).join("");
    this.win.innerHTML = `<h2><span>Админ-панель</span><button class="x" aria-label="Закрыть">×</button></h2><div class="adm-tabs">${tabs}</div><div class="adm-body">${this.body()}</div>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => (this.win.hidden = true);
    this.win.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab!; this.refresh(); }));
    this.wire();
  }

  private body(): string {
    if (this.tab === "players") {
      const rows = this.players.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.cls)} ${p.level}</td><td>${p.x},${p.y}</td><td>
        <button class="btn small" data-act="tp" data-n="${esc(p.name)}">ТП</button>
        <button class="btn small" data-act="kick" data-n="${esc(p.name)}">Кик</button>
        <button class="btn small" data-act="ban" data-n="${esc(p.name)}">Бан</button>
        <button class="btn small" data-act="unban" data-n="${esc(p.name)}">Разбан</button>
        <button class="btn small" data-act="give" data-n="${esc(p.name)}">Выдать</button></td></tr>`).join("");
      return `<div class="adm-row"><button class="btn small" data-act="reload">Обновить</button><input id="adm-ban-h" type="number" min="0" placeholder="Бан, часов (0 = навсегда)" style="width:200px"><input id="adm-ban-r" class="wide" placeholder="Причина бана"></div>
        <div class="adm-row"><input id="adm-who" class="wide" placeholder="Имя героя (для разбана офлайн)"><button class="btn small" data-act="unban-name">Разбан</button></div>
        <div class="adm-scroll"><table class="adm-table"><tr><th>Имя</th><th>Класс/ур.</th><th>x,y</th><th></th></tr>${rows}</table></div>`;
    }
    if (this.tab === "give") {
      const bases = Object.keys(BASE_ITEMS), uniq = Object.keys(UNIQUES), leg = Object.keys(LEGENDARIES);
      return `<div class="adm-row"><input id="g-name" class="wide" placeholder="Имя игрока" value="${esc(this.target)}"></div>
        <div class="adm-row"><select id="g-id"><optgroup label="Базовые">${opts(bases, (i) => BASE_ITEMS[i].name)}</optgroup><optgroup label="Уникальные">${opts(uniq, (i) => UNIQUES[i].name)}</optgroup><optgroup label="Легендарные">${opts(leg, (i) => LEGENDARIES[i].name)}</optgroup></select>
        <select id="g-rar"><option value="0">Обычное</option><option value="1">Редкое</option><option value="2">Эпическое</option><option value="3">Легендарное</option></select>
        <input id="g-ilvl" type="number" min="1" max="60" value="10" title="Ур. предмета" style="width:70px"><input id="g-qty" type="number" min="1" max="99" value="1" title="Кол-во" style="width:70px"><button class="btn small" data-act="give-item">Выдать предмет</button></div>
        <div class="adm-row"><input id="g-gold" type="number" value="1000" style="width:100px"><button class="btn small" data-act="give-gold">Выдать золото</button></div>
        <div class="adm-row"><input id="g-xp" type="number" value="1000" style="width:100px"><button class="btn small" data-act="give-xp">Выдать опыт</button><input id="g-lv" type="number" min="1" max="100" value="100" style="width:70px"><button class="btn small" data-act="give-lv">Поднять до уровня</button></div>`;
    }
    if (this.tab === "world") {
      const zones = ZONES.map((z, i) => (z.name === "Арена" ? "" : `<option value="${i}">${esc(z.name)}</option>`)).join("");
      return `<div class="adm-row"><select id="w-mob">${opts(Object.keys(MOBS), (i) => MOBS[i].name)}</select><input id="w-lv" type="number" min="1" max="60" value="10" style="width:70px"><button class="btn small" data-act="spawn">Призвать рядом</button></div>
        <div class="adm-row"><input id="w-text" class="wide" maxlength="140" placeholder="Текст объявления"><button class="btn small" data-act="announce">Объявить</button></div>
        <div class="adm-row"><input id="w-tp-name" placeholder="ТП к игроку"><button class="btn small" data-act="tp-name">Телепорт</button></div>
        <div class="adm-row"><input id="w-x" type="number" placeholder="x" style="width:80px"><input id="w-y" type="number" placeholder="y" style="width:80px"><button class="btn small" data-act="tp-xy">ТП на x,y</button>
        <select id="w-zone">${zones}</select><button class="btn small" data-act="tp-zone">ТП в зону</button></div>`;
    }
    const L = this.logs;
    const rows = L.rows.map((r) => L.kind === "trades"
      ? `<tr><td>${date(r.at)}</td><td>${esc(r.a)} ⇄ ${esc(r.b)}</td><td>${esc(this.items(r.a_items))} +${r.a_gold} з</td><td>${esc(this.items(r.b_items))} +${r.b_gold} з</td></tr>`
      : `<tr><td>${date(r.at)}</td><td>${esc(r.admin)}</td><td>${esc(r.action)}</td><td>${esc(r.target)} ${esc(r.details)}</td></tr>`).join("");
    const head = L.kind === "trades" ? "<th>Время</th><th>Участники</th><th>A отдал</th><th>B отдал</th>" : "<th>Время</th><th>Админ</th><th>Действие</th><th>Цель/детали</th>";
    return `<div class="adm-row"><select id="l-kind"><option value="trades"${this.logKind === "trades" ? " selected" : ""}>Сделки</option><option value="admin"${this.logKind === "admin" ? " selected" : ""}>Журнал админов</option></select><input id="l-name" class="wide" placeholder="Фильтр по имени" value="${esc(this.logName)}"><button class="btn small" data-act="logs">Показать</button></div>
      <div class="adm-scroll"><table class="adm-table"><tr>${head}</tr>${rows}</table></div>`;
  }

  private items(json: string): string {
    try { return (JSON.parse(json) as { name?: string; qty?: number }[]).map((i) => i.name + (i.qty && i.qty > 1 ? "×" + i.qty : "")).join(", ") || "—"; } catch { return "—"; }
  }

  private wire() {
    const val = (id: string) => (this.win.querySelector<HTMLInputElement>("#" + id)?.value ?? "").trim();
    const nv = (id: string) => Number(val(id));
    const send = (t: string, m: object = {}) => this.net.send(t, m);
    this.win.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => (b.onclick = () => {
      const n = b.dataset.n ?? "";
      switch (b.dataset.act) {
        case "reload": return this.refresh();
        case "tp": return send("admin:tp", { name: n });
        case "kick": return send("admin:kick", { name: n });
        case "ban": return send("admin:ban", { name: n, hours: nv("adm-ban-h"), reason: val("adm-ban-r") });
        case "unban": return send("admin:unban", { name: n });
        case "unban-name": return send("admin:unban", { name: val("adm-who") });
        case "give": this.target = n; this.tab = "give"; return this.render();
        case "give-item": {
          const id = val("g-id");
          const key = LEGENDARIES[id] || UNIQUES[id] ? "unique" : "base";
          return send("admin:give", { name: val("g-name"), [key]: id, rarity: nv("g-rar"), ilvl: nv("g-ilvl"), qty: nv("g-qty") });
        }
        case "give-gold": return send("admin:gold", { name: val("g-name"), v: nv("g-gold") });
        case "give-xp": return send("admin:xp", { name: val("g-name"), xp: nv("g-xp") });
        case "give-lv": return send("admin:xp", { name: val("g-name"), level: nv("g-lv") });
        case "spawn": return send("admin:spawn", { mob: val("w-mob"), level: nv("w-lv") });
        case "announce": return send("admin:announce", { text: val("w-text") });
        case "tp-name": return send("admin:tp", { name: val("w-tp-name") });
        case "tp-xy": return send("admin:tp", { x: nv("w-x"), y: nv("w-y") });
        case "tp-zone": return send("admin:tp", { zone: nv("w-zone") });
        case "logs": this.logKind = val("l-kind"); this.logName = val("l-name"); return this.refresh();
      }
    }));
    // поля ввода не должны запускать игровые горячие клавиши
    this.win.querySelectorAll("input,select").forEach((i) => i.addEventListener("keydown", (e) => e.stopPropagation()));
  }
}
