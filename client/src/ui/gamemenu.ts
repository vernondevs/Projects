/** Игровое меню по Esc, окно помощи и большая карта мира. */
import { CITIES } from "../../../shared/cities";
import { TILE } from "../../../shared/constants";
import type { WorldMap } from "../../../shared/map";
import type { Net } from "../net";

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

/** Большая карта: базовый холст мини-карты, маркер героя и города (неоткрытые — серым «???»). */
export function drawWorldMap(cv: HTMLCanvasElement, map: WorldMap, base: HTMLCanvasElement | null, pos: { x: number; y: number }, known?: string[]) {
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0e0b10";
  g.fillRect(0, 0, cv.width, cv.height);
  const k = Math.min(cv.width / map.w, cv.height / map.h);
  const ox = (cv.width - map.w * k) / 2, oy = (cv.height - map.h * k) / 2;
  if (base) g.drawImage(base, ox, oy, map.w * k, map.h * k);
  g.font = "600 13px Rubik, sans-serif";
  g.textAlign = "center";
  if (map.w > 200) for (const c of CITIES) {
    const x = ox + c.x * k, y = oy + c.y * k;
    const open = !known || known.includes(c.id);
    const label = open ? c.name : "???";
    g.fillStyle = open ? "#f0c050" : "#8a8290";
    g.fillRect(x - 3, y - 3, 6, 6);
    g.lineWidth = 3;
    g.strokeStyle = "#120a10";
    g.strokeText(label, x, y - 8);
    g.fillText(label, x, y - 8);
  }
  const px = ox + (pos.x / TILE) * k, py = oy + (pos.y / TILE) * k;
  g.fillStyle = "#fff";
  g.strokeStyle = "#e84a4a";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, 5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
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
      // TODO(задача 30): выбор персонажа; пока совпадает с выходом из аккаунта
      ["Сменить персонажа", "", () => this.confirmLogout()],
      ["Выйти из аккаунта", "", () => this.confirmLogout()],
    ];
    if (a.isAdmin()) items.splice(7, 0, ["Админ-панель", "F10", () => a.toggle("admin")]);
    const p = document.createElement("div");
    p.className = "panel gmenu";
    p.innerHTML = `<h2>Пепельный Предел</h2>`;
    for (const [text, key, fn] of items) {
      const b = document.createElement("button");
      b.className = "btn gm-item";
      b.innerHTML = `<span>${text}</span>${fn ? (key ? `<kbd>${key}</kbd>` : "") : `<small>скоро</small>`}`;
      b.disabled = !fn;
      if (fn) b.onclick = () => { this.close(); fn(); };
      p.append(b);
    }
    this.back.replaceChildren(p);
    this.back.hidden = false;
    p.querySelector<HTMLButtonElement>(".gm-item")?.focus();
  }

  private confirmLogout() {
    const p = document.createElement("div");
    p.className = "panel gmenu";
    p.innerHTML = `<h2>Выйти из аккаунта?</h2><p class="muted" style="margin:0;text-align:center">Вы вернётесь на экран входа.</p>`;
    const yes = document.createElement("button"), no = document.createElement("button");
    yes.className = "btn gm-item primary"; yes.textContent = "Выйти";
    no.className = "btn gm-item"; no.textContent = "Отмена";
    no.onclick = () => this.open();
    yes.onclick = async () => {
      yes.disabled = no.disabled = true;
      try { await this.a.net().room.leave(true); } catch {}
      location.reload();
    };
    p.append(yes, no);
    this.back.replaceChildren(p);
    this.back.hidden = false;
    no.focus();
  }
}
