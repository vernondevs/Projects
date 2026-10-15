/** Экран выбора героя: 6 ячеек аккаунта, создание (имя, класс, внешность) и удаление с подтверждением именем. */
import { LOOKS, MAX_CHARS, type AccountView, type CharSummary } from "../../../shared/accounts";
import { CLASSES, CLASS_IDS, type ClassId } from "../../../shared/classes";
import { NAME_RE } from "../../../shared/constants";
import { SLOT_NAMES } from "../../../shared/items";
import { api } from "../account";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

// ---------- спрайт героя на холсте с оттенком ----------
const sheets = new Map<string, HTMLImageElement>();
function sheet(cls: string, onload: () => void): HTMLImageElement {
  let img = sheets.get(cls);
  if (!img) {
    img = new Image();
    img.src = `/assets/units/${cls}.png`;
    sheets.set(cls, img);
  }
  if (!img.complete) img.addEventListener("load", onload, { once: true });
  return img;
}
/** Кадр 32×32 из листа 12×3 (ряд 0 — ходьба вниз), умноженный на цвет внешности. */
export function drawHero(cv: HTMLCanvasElement, cls: string, look: number, frame = 0) {
  const img = sheet(cls, () => drawHero(cv, cls, look, frame));
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  if (!img.complete || !img.naturalWidth) return;
  const f = 32;
  g.globalCompositeOperation = "source-over";
  g.drawImage(img, (frame % 4) * f, 0, f, f, 0, 0, cv.width, cv.height);
  const tint = LOOKS[look]?.rgb ?? 0xffffff;
  if (tint !== 0xffffff) {
    g.globalCompositeOperation = "multiply";
    g.fillStyle = hex(tint);
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(img, (frame % 4) * f, 0, f, f, 0, 0, cv.width, cv.height);
    g.globalCompositeOperation = "source-over";
  }
}

function heroCanvas(size: number, cls: string, look: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  cv.className = "cs-hero";
  drawHero(cv, cls, look);
  return cv;
}

export interface CharSelectHost {
  play(name: string): Promise<void>;
  logout(): void;
}

export class CharSelect {
  private view: AccountView | null = null;
  private sel = "";
  private anim = 0;
  private timer = 0;
  /** Холст, который сейчас анимируется (выбранный герой или превью создания). */
  private live: { cv: HTMLCanvasElement; cls: string; look: number } | null = null;

  private mode: "list" | "create" = "list";

  constructor(private screen: HTMLElement, private host: CharSelectHost) {
    // Esc — шаг назад: диалог → закрыть, создание → список, список → вход
    screen.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || screen.hidden) return;
      e.preventDefault();
      const dlg = screen.querySelector(".gmenu-back");
      if (dlg) dlg.remove();
      else if (this.mode === "create") this.renderList();
      else this.host.logout();
    });
  }

  get isOpen() {
    return !this.screen.hidden;
  }

  show(view: AccountView, msg = "") {
    this.view = view;
    if (!view.chars.some((c) => c.name === this.sel)) {
      let last = "";
      try { last = localStorage.getItem("emberfall-char") ?? ""; } catch {}
      this.sel = view.chars.find((c) => c.name === last)?.name ?? view.chars[0]?.name ?? "";
    }
    this.screen.hidden = false;
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 160);
    if (view.chars.length) this.renderList(msg);
    else this.renderCreate(msg);
  }

  hide() {
    this.screen.hidden = true;
    this.screen.replaceChildren();
    window.clearInterval(this.timer);
    this.timer = 0;
    this.live = null;
  }

  private tick() {
    if (!this.live || !this.live.cv.isConnected) return;
    this.anim = (this.anim + 1) % 4;
    drawHero(this.live.cv, this.live.cls, this.live.look, this.anim);
  }

  private panel(cls: string, html: string): HTMLElement {
    const p = document.createElement("div");
    p.className = `panel charsel ${cls}`;
    p.innerHTML = html;
    this.screen.replaceChildren(p);
    return p;
  }

  // ---------- список героев ----------
  private renderList(msg = "") {
    this.mode = "list";
    const v = this.view!;
    const p = this.panel("cs-list", `<div class="cs-head"><h1>Выбор героя</h1><span class="muted">Аккаунт <b class="gold">${esc(v.login)}</b> · героев ${v.chars.length}/${MAX_CHARS}</span></div>
      <div class="cs-grid" role="listbox" aria-label="Герои аккаунта"></div>
      <p class="error" role="alert">${esc(msg)}</p>
      <div class="cs-bar"><button class="btn primary" data-a="play">Играть</button><button class="btn" data-a="new">Создать</button><button class="btn" data-a="del">Удалить</button><span class="cs-sp"></span><button class="btn" data-a="out" title="Esc">← Назад: выйти из аккаунта</button></div>`);
    const grid = p.querySelector<HTMLElement>(".cs-grid")!;
    for (let i = 0; i < MAX_CHARS; i++) {
      const c = v.chars[i];
      const b = document.createElement("button");
      b.type = "button";
      if (!c) {
        b.className = "cs-slot empty";
        b.innerHTML = `<span class="plus">+</span><span>Создать героя</span>`;
        b.onclick = () => this.renderCreate();
        grid.append(b);
        continue;
      }
      b.className = "cs-slot";
      b.setAttribute("role", "option");
      b.setAttribute("aria-pressed", String(c.name === this.sel));
      b.dataset.name = c.name;
      const cv = heroCanvas(96, c.cls, c.look);
      const eq = c.equip.map((e) => `<span class="cell r${e.rarity}" title="${esc(SLOT_NAMES[e.slot] + ": " + e.name)}"><img src="/assets/icons/${esc(e.icon)}.png" alt=""></span>`).join("");
      b.innerHTML = `<div class="cs-eq">${eq || `<span class="muted">без снаряжения</span>`}</div>
        <span class="nm">${esc(c.name)}</span><span class="meta">${esc(CLASSES[c.cls]?.name ?? c.cls)} · ${c.level} ур.</span>
        <span class="meta zone">${esc(c.zone)}</span>${c.banned ? `<span class="cs-banned">${esc(c.banned)}</span>` : ""}`;
      b.prepend(cv);
      if (c.name === this.sel) this.live = { cv, cls: c.cls, look: c.look };
      b.onclick = () => {
        this.sel = c.name;
        grid.querySelectorAll<HTMLElement>(".cs-slot[data-name]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this.live = { cv, cls: c.cls, look: c.look };
      };
      b.ondblclick = () => void this.play(p);
      grid.append(b);
    }
    const btn = (a: string) => p.querySelector<HTMLButtonElement>(`[data-a="${a}"]`)!;
    btn("new").disabled = v.chars.length >= MAX_CHARS;
    btn("play").disabled = btn("del").disabled = !this.sel;
    btn("play").onclick = () => void this.play(p);
    btn("new").onclick = () => this.renderCreate();
    btn("del").onclick = () => { const c = v.chars.find((x) => x.name === this.sel); if (c) this.confirmDelete(c); };
    btn("out").onclick = () => this.host.logout();
    p.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).classList.contains("cs-slot") && this.sel) void this.play(p);
    });
    (grid.querySelector<HTMLElement>('[aria-pressed="true"]') ?? btn("play")).focus();
  }

  private async play(p: HTMLElement) {
    if (!this.sel) return;
    const go = p.querySelector<HTMLButtonElement>('[data-a="play"]')!;
    const err = p.querySelector<HTMLElement>(".error")!;
    go.disabled = true;
    go.textContent = "Вход…";
    err.textContent = "";
    try {
      await this.host.play(this.sel);
      try { localStorage.setItem("emberfall-char", this.sel); } catch {}
    } catch (e) {
      err.textContent = (e as Error)?.message || String(e);
      go.disabled = false;
      go.textContent = "Играть";
    }
  }

  // ---------- удаление ----------
  private confirmDelete(c: CharSummary) {
    const back = document.createElement("div");
    back.className = "gmenu-back";
    back.innerHTML = `<form class="panel gmenu cs-del"><h2>Удалить героя?</h2>
      <p class="muted" style="text-align:center"><b class="gold">${esc(c.name)}</b>, ${esc(CLASSES[c.cls]?.name ?? c.cls)} ${c.level} ур. Удаление необратимо: пропадут вещи, золото и рейтинг арены.</p>
      <label class="muted">Введите имя героя для подтверждения <input name="confirm" autocomplete="off" maxlength="16"></label>
      <p class="error" role="alert"></p>
      <button class="btn gm-item danger" type="submit" disabled>Удалить навсегда</button><button class="btn gm-item" type="button" data-a="no">Отмена</button></form>`;
    const f = back.querySelector("form")!;
    const inp = f.querySelector("input")!, yes = f.querySelector<HTMLButtonElement>("[type=submit]")!;
    const close = () => back.remove();
    inp.oninput = () => (yes.disabled = inp.value.trim().toLowerCase() !== c.name.toLowerCase());
    f.querySelector<HTMLButtonElement>('[data-a="no"]')!.onclick = close;
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    f.onsubmit = async (e) => {
      e.preventDefault();
      yes.disabled = true;
      try {
        const v = await api.remove(c.name, inp.value);
        close();
        this.sel = "";
        this.show(v, "");
      } catch (ex) {
        f.querySelector<HTMLElement>(".error")!.textContent = (ex as Error).message;
        yes.disabled = false;
      }
    };
    this.screen.append(back);
    inp.focus();
  }

  // ---------- создание ----------
  private renderCreate(msg = "") {
    this.mode = "create";
    const v = this.view!;
    let cls: ClassId = "warrior", look = 0;
    const p = this.panel("cs-create", `<div class="cs-head"><h1>Новый герой</h1><span class="muted">Аккаунт <b class="gold">${esc(v.login)}</b> · героев ${v.chars.length}/${MAX_CHARS}</span></div>
      <form class="cs-form" autocomplete="off">
        <div class="cs-preview"><div class="cs-stage"></div><b class="nm"></b><p class="muted desc"></p></div>
        <div class="cs-fields">
          <label class="cs-label">Имя героя <input name="name" minlength="3" maxlength="16" required placeholder="3–16 букв или цифр"></label>
          <fieldset class="classes"><legend>Класс</legend></fieldset>
          <fieldset class="cs-looks"><legend>Внешность</legend><div class="looks"></div></fieldset>
          <p class="error" role="alert">${esc(msg)}</p>
          <div class="cs-bar"><button class="btn primary" type="submit">Создать героя</button><button class="btn" type="button" data-a="back" title="Esc">← Назад</button></div>
        </div>
      </form>`);
    const stage = p.querySelector<HTMLElement>(".cs-stage")!;
    const cv = heroCanvas(192, cls, look);
    stage.append(cv);
    const nameEl = p.querySelector<HTMLElement>(".cs-preview .nm")!, descEl = p.querySelector<HTMLElement>(".cs-preview .desc")!;
    const update = () => {
      this.live = { cv, cls, look };
      drawHero(cv, cls, look, this.anim);
      nameEl.textContent = `${CLASSES[cls].name} · ${LOOKS[look].name.toLowerCase()} облик`;
      descEl.textContent = CLASSES[cls].desc;
    };
    const box = p.querySelector<HTMLElement>(".classes")!;
    for (const id of CLASS_IDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.dataset.cls = id;
      b.setAttribute("aria-pressed", String(id === cls));
      b.innerHTML = `<span class="cls-sprite" style="background-image:url(/assets/units/${id}.png)"></span>${CLASSES[id].name}`;
      b.onclick = () => {
        cls = id;
        box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        update();
      };
      box.append(b);
    }
    const looks = p.querySelector<HTMLElement>(".looks")!;
    LOOKS.forEach((l, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "look";
      b.dataset.look = String(i);
      b.title = l.name;
      b.setAttribute("aria-label", l.name);
      b.setAttribute("aria-pressed", String(i === look));
      b.style.background = i ? hex(l.rgb) : "linear-gradient(135deg, #fff 0 50%, #bdb09c 50%)";
      b.onclick = () => {
        look = i;
        looks.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        update();
      };
      looks.append(b);
    });
    update();
    const f = p.querySelector("form")!;
    const inp = f.querySelector<HTMLInputElement>("input[name=name]")!;
    const err = f.querySelector<HTMLElement>(".error")!;
    const back = f.querySelector<HTMLButtonElement>('[data-a="back"]')!;
    back.onclick = () => this.renderList();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const name = inp.value.trim();
      if (!NAME_RE.test(name)) return void (err.textContent = "Имя: 3–16 букв (кириллица или латиница), цифр или _");
      const go = f.querySelector<HTMLButtonElement>("[type=submit]")!;
      go.disabled = true;
      err.textContent = "";
      try {
        const nv = await api.create(name, cls, look);
        this.sel = nv.chars.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name ?? "";
        this.show(nv);
      } catch (ex) {
        err.textContent = (ex as Error).message;
        go.disabled = false;
      }
    };
    inp.focus();
  }
}
