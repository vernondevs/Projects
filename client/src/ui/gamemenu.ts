/** Игровое меню по Esc, окно помощи и большая карта мира. */
import type { LogoutMode, Net } from "../net";

export const HOTKEYS: [string, string][] = [["WASD / клик", "движение"], ["1–4", "умения"], ["Q / E", "зелья здоровья и маны"], ["Tab", "следующая цель"], ["Пробел", "подобрать предмет"], ["F", "поговорить с NPC"], ["X / Shift+X", "ездовое животное"], ["C / I / K", "герой / сумка / умения"], ["P / B / M", "арена / бестиарий / карта"], ["Enter", "чат"], ["Esc", "закрыть окно, снять цель, меню"]];

const TIPS = [
  "Клик по врагу — атака, клик по земле — движение. Зелья: Q и E.",
  "Города безопасны. За стенами уровень врагов растёт — смотрите на подпись зоны под картой.",
  "Задания берите у NPC в городах: награда золотом и опытом.",
  "Тяжёлые вещи продавайте торговцу, лучшие надевайте через сумку (I).",
];

export function fillHelp(body: Element) {
  body.innerHTML = `<h3 style="margin:0;font-size:16px;color:var(--gold)">Управление</h3><dl class="keys">${HOTKEYS.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>
    <h3 style="margin:8px 0 0;font-size:16px;color:var(--gold)">Советы</h3><ul style="margin:0;padding-left:20px;line-height:1.5">${TIPS.map((t) => `<li>${t}</li>`).join("")}</ul>`;
}

export interface MenuActions {
  toggle(id: string): void;
  openQuests(): void;
  openMap(): void;
  openHelp(): void;
  isAdmin(): boolean;
  net(): Net;
}

export class GameMenu {
  private back = document.createElement("div");
  /** Ожидание выхода (отсчёт в бою): снять подписки и таймер. */
  private waiting: (() => void) | null = null;

  constructor(root: HTMLElement, private a: MenuActions) {
    this.back.className = "gmenu-back";
    this.back.hidden = true;
    this.back.addEventListener("pointerdown", (e) => { if (e.target === this.back) this.close(); });
    root.append(this.back);
  }
  get isOpen() { return !this.back.hidden; }
  toggle() { this.isOpen ? this.close() : this.open(); }
  close(): boolean {
    const was = this.isOpen;
    if (this.waiting) {
      this.a.net().cancelLogout();
      this.stopWaiting();
    }
    this.back.hidden = true;
    this.back.replaceChildren();
    return was;
  }

  open() {
    const a = this.a;
    // [текст, клавиша, действие | null = скоро]
    const items: [string, string, (() => void) | null][] = [
      ["Продолжить", "Esc", () => {}],
      ["Персонаж", "C", () => a.toggle("char")],
      ["Инвентарь", "I", () => a.toggle("inv")],
      ["Умения", "K", () => a.toggle("skills")],
      ["Квесты", "", () => a.openQuests()],
      ["Бестиарий", "B", () => a.toggle("bestiary")],
      ["Арена", "P", () => a.toggle("arena")],
      ["Достижения", "", null],
      ["Друзья и гильдия", "", null],
      ["Карта", "M", () => a.openMap()],
      ["Настройки", "", () => a.toggle("settings")],
      ["Помощь", "", () => a.openHelp()],
      ["Переподключиться", "", () => void window.dispatchEvent(new CustomEvent("emberfall:reconnect"))],
      ["Сменить персонажа", "", a.net().kind === "arena" ? null : () => this.confirmLogout("char")],
      ["Выйти из аккаунта", "", a.net().kind === "arena" ? null : () => this.confirmLogout("account")],
    ];
    if (a.isAdmin()) items.splice(7, 0, ["Админ-панель", "F10", () => a.toggle("admin")]);
    const p = document.createElement("div");
    p.className = "panel gmenu";
    p.innerHTML = `<h2>Пепельный Предел</h2>`;
    for (const [text, key, fn] of items) {
      const b = document.createElement("button");
      b.className = "btn gm-item";
      b.innerHTML = `<span>${text}</span>${fn ? (key ? `<kbd>${key}</kbd>` : "") : `<small>${text.startsWith("Сменить") || text.startsWith("Выйти") ? "не на арене" : "скоро"}</small>`}`;
      b.disabled = !fn;
      if (fn) b.onclick = () => { this.close(); fn(); };
      p.append(b);
    }
    this.back.replaceChildren(p);
    this.back.hidden = false;
    p.querySelector<HTMLButtonElement>(".gm-item")?.focus();
  }

  private stopWaiting() {
    this.waiting?.();
    this.waiting = null;
  }

  /** Подтверждение выхода; дальше решает сервер: сразу или отсчёт 10 с в бою (прерывается уроном). */
  private confirmLogout(mode: LogoutMode) {
    const p = document.createElement("div");
    p.className = "panel gmenu";
    const title = mode === "char" ? "Сменить героя?" : "Выйти из аккаунта?";
    p.innerHTML = `<h2>${title}</h2><p class="muted" style="margin:0;text-align:center">${mode === "char" ? "Вы вернётесь к выбору героя." : "Вы вернётесь на экран входа."} Прогресс сохранится.</p>`;
    const yes = document.createElement("button"), no = document.createElement("button");
    yes.className = "btn gm-item primary"; yes.textContent = mode === "char" ? "Сменить героя" : "Выйти";
    no.className = "btn gm-item"; no.textContent = "Отмена";
    no.onclick = () => this.open();
    yes.onclick = () => {
      yes.disabled = no.disabled = true;
      const net = this.a.net();
      const offs = [
        net.on("logout:wait", (m) => this.countdown(m.ms, title)),
        net.on("logout:cancel", () => { this.stopWaiting(); this.close(); }),
        net.on("logout", () => { this.stopWaiting(); this.close(); }),
      ];
      this.waiting = () => offs.forEach((f) => f());
      // связь сломана — выход без сервера (сервер сохранит героя при обрыве)
      if (!net.online) return void window.dispatchEvent(new CustomEvent("emberfall:exit", { detail: mode }));
      net.requestLogout(mode);
    };
    p.append(yes, no);
    this.back.replaceChildren(p);
    this.back.hidden = false;
    no.focus();
  }

  private countdown(ms: number, title: string) {
    const end = performance.now() + ms;
    const p = document.createElement("div");
    p.className = "panel gmenu";
    p.innerHTML = `<h2>${title}</h2><p class="muted" style="margin:0;text-align:center">Вы в бою: выход через</p><div class="logout-wait"></div><p class="muted" style="margin:0;text-align:center">Полученный урон прервёт выход.</p>`;
    const cancel = document.createElement("button");
    cancel.className = "btn gm-item"; cancel.textContent = "Отмена";
    cancel.onclick = () => this.close();
    p.append(cancel);
    const out = p.querySelector<HTMLElement>(".logout-wait")!;
    const tick = () => (out.textContent = `${Math.max(0, Math.ceil((end - performance.now()) / 1000))} с`);
    tick();
    const t = window.setInterval(tick, 200);
    const prev = this.waiting;
    this.waiting = () => { window.clearInterval(t); prev?.(); };
    this.back.replaceChildren(p);
    this.back.hidden = false;
    cancel.focus();
  }
}
