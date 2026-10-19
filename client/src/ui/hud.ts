/** Интерфейс поверх игры (DOM): панели, окна, чат, мини-карта, подсказки. */
import { gold, goldify } from "./gold";
import { initWindowDrag, resetWindowPositions } from "./drag";
import { CLASSES, STAT_HINTS, STAT_NAMES, type StatKey } from "../../../shared/classes";
import { FACTIONS, FOE_COLOR } from "../../../shared/factions";
import * as sfx from "../game/sfx";
import { overlay, setOverlay } from "../game/overlay";
import { MAX_LEVEL, RESPAWN_DELAY_MS, TILE } from "../../../shared/constants";
import { LEGENDARIES } from "../../../shared/legendary";
import { OFFHAND_CLASSES, BASE_ITEMS, iconFor, canEquip, isBound, effStats, ITEM_STAT_NAMES, itemName, itemValue, baseSellValue, RARITY_NAMES, SLOT_NAMES, SLOTS, UNIQUES, type Item, type ItemStatKey } from "../../../shared/items";
import { isTownZone, T, Zone, ZONES, zoneAtPx, type WorldMap } from "../../../shared/map";
import { CITIES, CITY_WALL } from "../../../shared/cities";
import { TOWN, WALL } from "../../../shared/town";
import { MOBS } from "../../../shared/mobs";
import { Anim, UnitKind, type ChatLine, type SelfState, type ToastMsg } from "../../../shared/protocol";
import { activeSkills, canLearn, classSkills, SKILLS, type SkillDef } from "../../../shared/skills";
import type { Net, UnitState } from "../net";
import { rankById } from "../../../shared/arena";
import { ArenaUI } from "./arena";
import { TradeUI } from "./trade";
import { AdminUI } from "./admin";
import { BestiaryUI } from "./bestiary";
import { RumorUI } from "./rumor";
import { EncounterUI } from "./encounter";
import { CookUI, foodTip } from "./cook";
import { QuestUI, TeleportUI } from "./cities";
import { fillHelp, GameMenu, HOTKEYS } from "./gamemenu";
import { WorldMapView } from "./worldmap";
import { plusBadge, SmithUI } from "./smith";
import { BankUI, parseBankDrag } from "./bank";
import { BagsUI } from "./bags";
import { MOUNTS, MOUNT_IDS, mountSprite } from "../../../shared/mounts";
import { PETS, PET_IDS, petUnitId } from "../../../shared/pets";
import { MATERIALS } from "../../../shared/upgrade";
import { FOOD, foodOf } from "../../../shared/food";
import { DODGE_CAP, STAT_K } from "../../../shared/formulas";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icon = (name: string) => `/assets/icons/${name}.png`;
const CLASS_COLOR: Record<string, string> = {
  warrior: "#ff9a7a", mage: "#c8a0ff", ranger: "#9ae07a", healer: "#ffe9a0", rogue: "#b8a0e0",
  deathknight: "#8ad8ff", bloodweaver: "#ff6a7a", darkranger: "#9a8aff", warlock: "#9aff6a", reaver: "#e06a4a",
};
const TERRAIN_COLORS = ["#2a5a9e", "#e05412", "#d0b07e", "#3c432c", "#463e40", "#86593a", "#4f873c", "#2f5336", "#746e7a", "#3a3444", "#e8eef4", "#a8d4ec", "#2a2230", "#d8b878", "#3a6a7a"];

export interface HudCtx {
  net: Net;
  map: WorldMap;
  useSkill: (i: number) => void;
  usePotion: (base: string) => void;
  toggleMount?: () => void;
  togglePet?: () => void;
  closeTarget: () => void;
  focusGame: () => void;
}
export interface FrameInfo {
  me: UnitState | null;
  target: UnitState | null;
  pos: { x: number; y: number };
  units: Map<string, { u: UnitState; x: number; y: number; dead: boolean }>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Слот экипировки → базовый предмет для силуэта пустой ячейки. */
const ghostBase: Record<string, string> = {};

export class Hud {
  ctx!: HudCtx;
  aimAtCursor = false;
  private player = el("div", "panel hud-player");
  private targetBox = el("div", "panel hud-target");
  private petBox = el("div", "panel hud-pet");
  private zoneBanner = el("div", "hud-zone passthru");
  private mini = el("div", "panel hud-mini");
  private miniCanvas = el("canvas");
  private miniBase: HTMLCanvasElement | null = null;
  private wmView: WorldMapView | null = null;
  private bar = el("div", "panel hud-bar");
  private menuBar = el("div", "hud-menu");
  private uiScale = 100;
  private chatSize = 14;
  private chatBox = el("div", "hud-chat");
  private chatLog = el("div", "log");
  private chatInput = el("input");
  private toasts = el("div", "toasts");
  private death = el("div", "death");
  private tip = el("div", "panel tip");
  private wins: Record<string, HTMLElement> = {};
  private lastMini = 0;
  private deadSince = 0;
  private zoneTimer = 0;
  private lastSelfLevel = 0;
  private netBound = false;
  private tradeBound = false;
  readonly arena: ArenaUI;
  readonly trade: TradeUI;
  readonly bestiary: BestiaryUI;
  readonly admin: AdminUI;
  private gameMenu!: GameMenu;
  readonly rumor: RumorUI;
  readonly enc: EncounterUI;
  readonly cook: CookUI;
  readonly smith: SmithUI;
  readonly bank: BankUI;
  readonly bags: BagsUI;
  readonly quest: QuestUI;
  readonly tp: TeleportUI;
  private foodUntil = 0;
  private foodId = "";

  /** Панели под рамкой героя (группа, питомец, задания) встают столбиком и не налезают друг на друга,
   *  даже когда рамка растёт (очки, «В бою», еда) или панель появляется и пропадает. */
  private stackLeftPanels() {
    const order = [".hud-player", ".hud-party", ".hud-pet", ".hud-quests"];
    const layout = () => {
      let y = 12;
      for (const sel of order) {
        const e = this.root.querySelector<HTMLElement>(sel);
        if (!e || e.hidden || e.offsetParent === null) continue;
        if (sel !== ".hud-player" && e.style.top !== `${y}px`) e.style.top = `${y}px`;
        y = (sel === ".hud-player" ? e.offsetTop : y) + e.offsetHeight + 8;
      }
    };
    const ro = new ResizeObserver(layout);
    const watch = () => order.forEach((sel) => { const e = this.root.querySelector<HTMLElement>(sel); if (e && !(e as any).__stacked) { (e as any).__stacked = true; ro.observe(e); } });
    // новые панели добавляются прямо в корень; появление и скрытие — через атрибут hidden
    new MutationObserver(() => { watch(); layout(); }).observe(this.root, { childList: true });
    const vis = new MutationObserver(layout);
    const watchVis = () => order.forEach((sel) => { const e = this.root.querySelector<HTMLElement>(sel); if (e && !(e as any).__vis) { (e as any).__vis = true; vis.observe(e, { attributes: true, attributeFilter: ["hidden", "class"] }); } });
    new MutationObserver(watchVis).observe(this.root, { childList: true });
    watchVis();
    watch();
    layout();
  }

  constructor(readonly root: HTMLElement) {
    root.append(this.player, this.petBox, this.targetBox, this.zoneBanner, this.mini, this.bar, this.chatBox, this.toasts, this.death, this.tip);
    initWindowDrag(root, () => this.ctx?.net.self?.name ?? "");
    this.stackLeftPanels();
    this.targetBox.hidden = true;
    this.petBox.hidden = true;
    this.death.hidden = true;
    this.tip.hidden = true;
    this.chatInput.placeholder = "Enter — написать в чат";
    this.chatInput.maxLength = 140;
    this.chatInput.id = "chat-input";
    this.chatBox.append(this.chatLog, this.chatInput);
    this.miniCanvas.width = 240;
    this.miniCanvas.height = 180;
    this.mini.innerHTML = `<div class="zn" id="mini-zone"></div>`;
    this.mini.prepend(this.miniCanvas);
    this.mini.append(this.menuBar);
    const miniBtn = el("button", "mini-toggle", "▣");
    miniBtn.title = "Свернуть или развернуть мини-карту";
    miniBtn.setAttribute("aria-label", "Свернуть или развернуть мини-карту");
    miniBtn.onclick = () => this.toggleMinimap();
    this.mini.append(miniBtn);
    this.buildMenu();
    this.makeWindows();
    this.arena = new ArenaUI(root, (text, kind) => this.toast({ text, kind }));
    this.bestiary = new BestiaryUI(root, icon);
    this.admin = new AdminUI(root);
    this.rumor = new RumorUI(root);
    this.enc = new EncounterUI(root);
    this.cook = new CookUI(root);
    this.smith = new SmithUI(root);
    this.quest = new QuestUI(root);
    this.tp = new TeleportUI(root);
    this.gameMenu = new GameMenu(root, {
      toggle: (id) => this.toggle(id),
      openQuests: () => this.quest.toggleLog(),
      openMap: () => this.openWorldMap(),
      openHelp: () => { this.wins.help.hidden = false; },
      isAdmin: () => !!this.ctx.net.self?.isAdmin,
      net: () => this.ctx.net,
    });
    this.bank = new BankUI(root, { itemTip: (it, s) => this.itemTip(it, s), tipFor: (e, h) => this.tipFor(e, h), hideTip: () => (this.tip.hidden = true), showInv: () => { if (this.wins.inv.hidden && this.ctx?.net.self) { this.wins.inv.hidden = false; this.renderSelf(this.ctx.net.self); } } });
    this.bags = new BagsUI(root, () => this.showInvWin());
    window.setInterval(() => this.updateFoodLabel(), 15000);
    this.trade = new TradeUI(root, { itemTip: (it, s) => this.itemTip(it, s), tipFor: (e, h) => this.tipFor(e, h), hideTip: () => (this.tip.hidden = true) });
    this.trade.onChange = () => {
      if (this.trade.isOpen) this.wins.inv.hidden = false;
      if (this.ctx?.net.self) this.renderSelf(this.ctx.net.self);
    };
    this.applySettings();
    let hidden = false;
    try { hidden = localStorage.getItem("minimapHidden") === "1"; } catch {}
    this.mini.classList.toggle("collapsed", hidden);
    this.chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = this.chatInput.value.trim();
        if (text) this.ctx.net.send("chat", { text });
        this.chatInput.value = "";
        this.chatInput.blur();
      } else if (e.key === "Escape") this.chatInput.blur();
    });
    document.addEventListener("mousemove", (e) => this.moveTip(e));
  }

  /** Выход из мира (смена героя): закрыть окна и очистить чат прошлого героя. */
  reset() {
    this.gameMenu.close();
    this.bank.close();
    for (const w of Object.values(this.wins)) w.hidden = true;
    this.chatLog.replaceChildren();
    this.death.hidden = true;
    this.tip.hidden = true;
    this.targetBox.hidden = true;
  }

  /** Вызывается при каждом запуске сцены (мир или арена); подписки на сеть — один раз. */
  bind(ctx: HudCtx) {
    this.ctx = ctx;
    const n = ctx.net;
    if (!this.netBound) {
      this.netBound = true;
      n.on("self", (s) => {
        // цвета интерфейса по фракции героя (styles.css: body[data-faction])
        if (document.body.dataset.faction !== s.faction) document.body.dataset.faction = s.faction;
        this.renderSelf(s);
      });
      n.on("chat", (l) => this.chatLine(l));
      n.on("toast", (t) => this.toast(t));
      n.on("combat", (m) => this.setCombat(m.on));
      n.on("mountcast", (m) => this.mountCast(m.ms, m.name));
      n.on("air", (m) => this.airBar(m.air, m.max));
      n.on("arena:info", () => this.applyFrame());
      n.on("market:prices", (m: Record<string, number>) => {
        this.prices = m;
        if (this.ctx.net.self && !this.wins.shop.hidden) this.renderSelf(this.ctx.net.self);
      });
      this.rumor.bind(n);
      this.enc.bind(n);
      this.admin.bind(n);
      this.cook.bind(n);
      this.smith.bind(n);
      this.bank.bind(n);
      this.bags.bind(n);
      this.quest.bind(n);
      this.tp.bind(n);
      this.chatLine({ from: "", text: "Добро пожаловать! Клик по земле — идти, по врагу — атаковать. Умения: 1–4. Арена — клавиша P.", sys: true });
    }
    this.arena.bind(n);
    if (!this.tradeBound) { this.tradeBound = true; this.trade.bind(n); }
    for (const w of Object.values(this.wins)) w.hidden = true;
    this.deadSince = 0;
    this.death.hidden = true;
    if (n.self) this.renderSelf(n.self);
    this.buildMiniBase();
  }

  /** Рамка за сезонную награду вокруг панели героя. */
  private applyFrame() {
    const r = rankById(this.ctx?.net.arenaInfo?.frame ?? "");
    this.player.style.borderColor = r ? r.color : "";
    this.player.style.boxShadow = r ? `0 0 0 1px #000, 0 0 14px ${r.color}66` : "";
  }

  isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  }
  focusChat() {
    this.chatInput.focus();
  }

  // ---------- сообщения ----------
  toast(t: ToastMsg) {
    const d = el("div", `toast ${t.kind ?? "info"}`);
    d.innerHTML = this.lootHtml(t);
    this.toasts.append(d);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild!.remove();
    setTimeout(() => d.remove(), 3300);
    if (t.kind === "loot") this.chatLine({ from: "", text: t.text, sys: true, loot: true, html: t.icon ? this.lootHtml(t) : undefined } as ChatLine & { loot: boolean; html?: string });
  }
  /** Текст тоста с иконкой предмета и цветными точками классов. */
  private lootHtml(t: ToastMsg): string {
    if (!t.icon) return goldify(esc(t.text));
    const dots = (t.classes ?? []).map((c) => `<i style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:3px;background:${CLASS_COLOR[c] ?? "#aaa"}" title="${esc(c)}"></i>`).join("");
    return `<img src="${icon(t.icon)}" width="16" height="16" style="vertical-align:middle;margin-right:4px;image-rendering:pixelated">${goldify(esc(t.text))}${dots}`;
  }
  chatLine(l: ChatLine & { loot?: boolean; html?: string }) {
    const d = el("div", l.sys ? (l.loot ? "loot" : "sys") : "");
    if (l.html) d.innerHTML = l.html;
    else if (l.sys) d.innerHTML = goldify(esc(l.text));
    else if (l.foreign) {
      // противоположная фракция: имя и «чужой язык» красным
      const c = FOE_COLOR;
      d.className = "foreign";
      d.title = `${FACTIONS[l.faction ?? "solgard"]?.name ?? ""}: чужой язык`;
      d.innerHTML = `<b style="color:${c}">${esc(l.from)}:</b> <i style="color:${c}">${esc(l.text)}</i>`;
    } else d.innerHTML = `<b style="color:${CLASS_COLOR[l.cls ?? ""] ?? "#ffb070"}">${esc(l.from)}:</b> ${esc(l.text)}`;
    const atBottom = this.chatLog.scrollTop + this.chatLog.clientHeight >= this.chatLog.scrollHeight - 4;
    this.chatLog.append(d);
    while (this.chatLog.children.length > 80) this.chatLog.firstElementChild!.remove();
    if (atBottom) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }
  showZone(name: string, sub: string, color = "") {
    this.zoneBanner.style.color = color;
    this.zoneBanner.innerHTML = `${esc(name)}<small>${esc(sub)}</small>`;
    this.zoneBanner.classList.add("show");
    clearTimeout(this.zoneTimer);
    this.zoneTimer = window.setTimeout(() => this.zoneBanner.classList.remove("show"), 2600);
  }

  // ---------- окна ----------
  private makeWindows() {
    const mk = (id: string, cls: string, title: string) => {
      const w = el("div", `panel win ${cls}`);
      w.hidden = true;
      w.innerHTML = `<h2><span>${title}</span><button class="x" aria-label="Закрыть">×</button></h2><div class="body"></div>`;
      w.querySelector<HTMLButtonElement>(".x")!.onclick = () => (w.hidden = true);
      this.root.append(w);
      this.wins[id] = w;
    };
    mk("char", "win-char", "Герой");
    mk("inv", "win-inv", "Снаряжение и сумка");
    mk("skills", "win-skills", "Дерево умений");
    mk("shop", "win-shop", "Торговка Марфа");
    mk("settings", "win-settings", "Настройки");
    this.buildSettings(this.wins.settings.querySelector(".body")!);
    mk("help", "win-help", "Помощь");
    fillHelp(this.wins.help.querySelector(".body")!);
    mk("worldmap", "win-worldmap", "Карта мира");
  }
  openWorldMap() {
    const w = this.wins.worldmap;
    w.hidden = false;
    if (!this.wmView) {
      this.wmView = new WorldMapView(this.ctx.map, () => this.miniBase, () => this.lastPos, () => ({ known: this.ctx.net.self?.cities, faction: this.ctx.net.self?.faction }), w);
      w.querySelector(".body")!.append(this.wmView.root);
    }
    this.wmView.open();
  }
  toggleWorldMap() {
    if (this.wins.worldmap.hidden) this.openWorldMap();
    else this.wins.worldmap.hidden = true;
  }
  /** Esc: закрыть верхнее окно; иначе снять цель; иначе открыть/закрыть меню. */
  escape(hasTarget: boolean, clearTarget: () => void) {
    if (this.gameMenu.close()) return;
    if (this.closeTop()) return;
    if (hasTarget) return clearTarget();
    this.gameMenu.open();
  }
  /** Закрывает одно верхнее по z-index окно (при равенстве — позднее в DOM). */
  private closeTop(): boolean {
    let top: HTMLElement | null = null, tz = -1;
    for (const w of this.root.querySelectorAll<HTMLElement>(".win")) {
      if (w.hidden) continue;
      const z = parseInt(getComputedStyle(w).zIndex, 10) || 0;
      if (z >= tz) { top = w; tz = z; }
    }
    if (!top) return this.closeAll();
    const byCls: Record<string, () => boolean> = {
      "win-bestiary": () => this.bestiary.close(), "win-admin": () => this.admin.close(), "win-rumor": () => this.rumor.close(), "win-enc": () => this.enc.close(),
      "win-cook": () => this.cook.close(), "win-quest": () => this.quest.close(), "win-qlog": () => this.quest.closeLog(), "win-tp": () => this.tp.close(),
      "win-smith": () => this.smith.close(), "win-bank": () => this.bank.close(), "win-bags": () => this.bags.close(), "win-arena": () => this.arena.close(), "win-trade": () => this.trade.close(),
    };
    const cls = [...top.classList].find((c) => byCls[c]);
    if (cls) byCls[cls]();
    else top.hidden = true;
    this.tip.hidden = true;
    return true;
  }
  /** Меню под мини-картой: текстовые пункты с горячей клавишей справа. */
  private buildMenu() {
    const items: [string, string, string, string][] = [["inv", "Сумка", "I", "Сумка"], ["skills", "Умения", "K", "Умения"], ["map", "Карта", "M", "Карта мира"], ["menu", "Меню", "Esc", "Игровое меню"]];
    for (const [k, text, key, label] of items) {
      const b = el("button", "btn mbtn", `<span class="ml">${text}</span><kbd>${key}</kbd>`);
      b.title = key ? `${label} (${key})` : label;
      b.setAttribute("aria-label", label);
      b.onclick = () => (k === "map" ? this.toggleWorldMap() : k === "menu" ? this.gameMenu.toggle() : this.toggle(k));
      this.menuBar.append(b);
    }
  }
  private buildSettings(body: Element) {
    try {
      this.uiScale = Math.min(150, Math.max(80, Number(localStorage.getItem("uiScale")) || 100));
      this.chatSize = Math.min(22, Math.max(14, Number(localStorage.getItem("chatSize")) || 14));
    } catch {}
    const keys = HOTKEYS;
    body.innerHTML = `<div class="set-row"><label for="set-scale">Масштаб интерфейса</label><input id="set-scale" type="range" min="80" max="150" step="5"><output id="set-scale-v"></output></div>
      <div class="set-row"><label for="set-chat">Размер шрифта чата</label><input id="set-chat" type="range" min="14" max="22" step="1"><output id="set-chat-v"></output></div>
      <div class="set-row"><label for="set-vol">Громкость звуков</label><input id="set-vol" type="range" min="0" max="100" step="5"><output id="set-vol-v"></output></div>
      <div class="set-row"><label for="set-music">Громкость музыки</label><input id="set-music" type="range" min="0" max="100" step="5"><output id="set-music-v"></output></div>
      <div class="set-row"><label for="set-mute">Без звука</label><input id="set-mute" type="checkbox"></div>
      <div class="set-row"><label for="set-selfNames">Мой ник над персонажем</label><input id="set-selfNames" type="checkbox"></div>
      <div class="set-row"><label for="set-selfBars">Моя полоска здоровья</label><input id="set-selfBars" type="checkbox"></div>
      <div class="set-row"><label for="set-names">Ники всех остальных</label><input id="set-names" type="checkbox"></div>
      <div class="set-row"><label for="set-bars">Полоски здоровья всех остальных</label><input id="set-bars" type="checkbox"></div>
      <div class="set-row"><button class="btn" id="set-resetwin">Сбросить расположение окон</button></div>
      <h3 style="margin:8px 0 0;font-size:16px;color:var(--gold)">Горячие клавиши</h3>
      <dl class="keys">${keys.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`;
    body.querySelector<HTMLButtonElement>("#set-resetwin")!.onclick = () => resetWindowPositions();
    const sc = body.querySelector<HTMLInputElement>("#set-scale")!, ch = body.querySelector<HTMLInputElement>("#set-chat")!;
    sc.value = String(this.uiScale);
    ch.value = String(this.chatSize);
    sc.oninput = () => { this.uiScale = Number(sc.value); this.applySettings(); try { localStorage.setItem("uiScale", sc.value); } catch {} };
    ch.oninput = () => { this.chatSize = Number(ch.value); this.applySettings(); try { localStorage.setItem("chatSize", ch.value); } catch {} };
    const vol = body.querySelector<HTMLInputElement>("#set-vol")!, mute = body.querySelector<HTMLInputElement>("#set-mute")!, volV = body.querySelector<HTMLOutputElement>("#set-vol-v")!;
    vol.value = String(Math.round(sfx.getVolume() * 100));
    volV.textContent = vol.value + "%";
    mute.checked = sfx.isMuted();
    const mus = body.querySelector<HTMLInputElement>("#set-music")!, musV = body.querySelector<HTMLOutputElement>("#set-music-v")!;
    mus.value = String(Math.round(sfx.getMusicVolume() * 100));
    musV.textContent = mus.value + "%";
    mus.oninput = () => { sfx.setMusicVolume(Number(mus.value) / 100); musV.textContent = mus.value + "%"; };
    vol.oninput = () => { sfx.setVolume(Number(vol.value) / 100); volV.textContent = vol.value + "%"; sfx.play("hit"); };
    mute.onchange = () => sfx.setMuted(mute.checked);
    for (const key of ["selfNames", "selfBars", "names", "bars"] as const) {
      const c = body.querySelector<HTMLInputElement>("#set-" + key)!;
      c.checked = overlay[key];
      c.onchange = () => setOverlay(key, c.checked);
    }
    this.settingsBody = body;
  }
  private settingsBody: Element | null = null;
  private applySettings() {
    (this.root.style as CSSStyleDeclaration & { zoom: string }).zoom = String(this.uiScale / 100);
    this.root.style.setProperty("--fs-chat", this.chatSize + "px");
    const b = this.settingsBody;
    if (b) { b.querySelector("#set-scale-v")!.textContent = this.uiScale + "%"; b.querySelector("#set-chat-v")!.textContent = this.chatSize + "px"; }
  }
  /** Свернуть или развернуть мини-карту (клавиша M), выбор запоминается. */
  toggleMinimap() {
    const hidden = this.mini.classList.toggle("collapsed");
    try { localStorage.setItem("minimapHidden", hidden ? "1" : "0"); } catch {}
  }

  toggle(id: string) {
    if (id === "arena") return this.arena.toggle();
    if (id === "bestiary") return this.bestiary.toggle(this.ctx.net.self);
    if (id === "admin") return this.ctx.net.self?.isAdmin ? this.admin.toggle() : undefined;
    if (this.ctx.net.kind === "arena" && id === "shop") return;
    const w = this.wins[id];
    w.hidden = !w.hidden;
    if (!w.hidden && this.ctx.net.self) this.renderSelf(this.ctx.net.self);
    if (id === "shop" && w.hidden) this.renderSelf(this.ctx.net.self!);
  }
  closeAll(): boolean {
    let any = this.bestiary.close() || this.admin.close() || this.rumor.close() || this.enc.close() || this.cook.close() || this.quest.close() || this.tp.close() || this.smith.close() || this.bank.close() || this.bags.close() || this.arena.close() || this.trade.close();
    for (const w of Object.values(this.wins)) if (!w.hidden) { w.hidden = true; any = true; }
    this.tip.hidden = true;
    return any;
  }
  private prices: Record<string, number> = {};
  /** Актуальная цена продажи: [цена, нормальная, ▼ если спрос низкий]. */
  private sellInfo(it: Item): { price: number; low: boolean } {
    const normal = Math.round(baseSellValue(it));
    const price = this.prices[it.uid] ?? normal;
    return { price, low: price < normal };
  }
  private priceHtml(it: Item): string {
    const { price, low } = this.sellInfo(it);
    return `${gold(price)}${low ? ` <span class="warn">▼ спрос низкий</span>` : ""}`;
  }
  openShop() {
    this.ctx.net.send("market:get", {});
    this.wins.shop.hidden = false;
    if (this.ctx.net.self) this.renderSelf(this.ctx.net.self);
  }
  private body(id: string) {
    return this.wins[id].querySelector<HTMLElement>(".body")!;
  }

  // ---------- подсказки ----------
  tipFor(elm: HTMLElement, html: () => string) {
    elm.addEventListener("mouseenter", (e) => {
      this.tip.innerHTML = html();
      this.tip.hidden = false;
      this.moveTip(e);
    });
    elm.addEventListener("mouseleave", () => (this.tip.hidden = true));
  }
  private moveTip(e: MouseEvent) {
    if (this.tip.hidden) return;
    const z = this.uiScale / 100;
    const r = this.tip.getBoundingClientRect();
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    this.tip.style.left = x / z + "px";
    this.tip.style.top = y / z + "px";
  }
  itemTip(it: Item, s: SelfState, equipped = false): string {
    const b = BASE_ITEMS[it.base];
    const lines: string[] = [`<div class="t r${it.rarity}">${esc(itemName(it))}</div>`];
    if (b.slot === "consumable") {
      const dish = foodOf(it.base);
      if (dish) return foodTip(dish) + `<div class="d">Клик — съесть · ${it.qty ?? 1} шт.</div>`;
      if (MATERIALS[it.base]) return lines.join("") + `<div class="d">Материал для улучшения у кузнеца Грома · ${it.qty ?? 1} шт.</div><div class="d">Цена: ${this.priceHtml(it)}</div>`;
      lines.push(`<div class="d">Расходуемое · ${it.qty ?? 1} шт.</div>`, `<div>${it.base === "hp_potion" ? "Восстанавливает 45% здоровья" : "Восстанавливает 50% маны"}</div>`, `<div class="d">Клавиша ${it.base === "hp_potion" ? "Q" : "E"} или клик</div>`);
    } else {
      lines.push(`<div class="d">${RARITY_NAMES[it.rarity]} · ${SLOT_NAMES[b.slot]} · ур. предмета ${it.ilvl}</div>`);
      const st = effStats(it);
      if (it.plus) lines.push(`<div class="st">Улучшение +${it.plus}</div>`);
      if (st.dmgMin) lines.push(`<div>Урон: ${st.dmgMin}–${st.dmgMax}</div>`);
      if (st.armor) lines.push(`<div>Броня: ${st.armor}</div>`);
      for (const [k, v] of Object.entries(st)) if (!["dmgMin", "dmgMax", "armor"].includes(k)) lines.push(`<div class="st">+${v}${k === "crit" ? "%" : ""} ${ITEM_STAT_NAMES[k as ItemStatKey]}</div>`);
      if (b.classes) lines.push(`<div class="${b.classes.includes(s.cls) ? "d" : "warn"}">Класс: ${b.classes.map((c) => CLASSES[c].name).join(", ")}</div>`);
      lines.push(`<div class="${it.req > s.level ? "warn" : "d"}">Требуется уровень ${it.req}</div>`);
      if (isBound(it)) lines.push(`<div class="warn">Привязан к персонажу</div>`);
      if (it.legendary && LEGENDARIES[it.legendary]) lines.push(`<div class="legend">★ ${esc(LEGENDARIES[it.legendary].desc)}</div>`, `<div class="lore">${esc(LEGENDARIES[it.legendary].lore)}</div>`);
      if (it.unique) lines.push(`<div class="lore">${esc(UNIQUES[it.unique].lore)}</div>`);
      if (!equipped) {
        const cur = s.equip[b.slot];
        if (cur && cur.uid !== it.uid) {
          const diff = (k: ItemStatKey) => (st[k] || 0) - (effStats(cur)[k] || 0);
          const parts = (["dmgMax", "armor", "str", "agi", "int", "vit", "hp", "crit"] as ItemStatKey[]).map((k) => [k, diff(k)] as const).filter(([, v]) => v !== 0);
          if (parts.length) lines.push(`<div class="d">Сравнение с надетым: ${parts.map(([k, v]) => `<span style="color:${v > 0 ? "var(--ok)" : "var(--bad)"}">${v > 0 ? "+" : ""}${v} ${k === "dmgMax" ? "урон" : ITEM_STAT_NAMES[k].toLowerCase()}</span>`).join(", ")}</div>`);
        }
      }
    }
    lines.push(`<div class="d">${!this.wins.shop.hidden && !equipped ? "Клик — продать за " : "Цена у торговца: "}${this.priceHtml(it)}</div>`);
    if (equipped) lines.push(`<div class="d">Клик — снять</div>`);
    else if (b.slot !== "consumable" && this.wins.shop.hidden) lines.push(`<div class="d">Клик — надеть · перетаскивание — переложить</div>`);
    return lines.join("");
  }
  skillTip(def: SkillDef, s: SelfState): string {
    const r = s.skills[def.id] || 0;
    const lines = [`<div class="t">${def.name}</div>`, `<div class="d">${def.kind === "active" ? `Активное · клавиша ${(def.slot ?? 0) + 1}` : "Пассивное"} · ранг ${r}/${def.maxRank}</div>`];
    lines.push(`<div>${def.desc(Math.max(1, r))}</div>`);
    if (def.kind === "active") lines.push(`<div class="d">Мана: ${def.mana!(Math.max(1, r))} · Перезарядка: ${def.cd!(Math.max(1, r)).toFixed(1)} с${def.range ? ` · Дальность: ${Math.round(def.range / TILE)} кл.` : ""}</div>`);
    if (r > 0 && r < def.maxRank) lines.push(`<div class="st">След. ранг: ${def.desc(r + 1)}</div>`);
    const why = canLearn(def, s.skills, s.level, s.skillPoints);
    if (why && r < def.maxRank) lines.push(`<div class="warn">${why}</div>`);
    else if (!why) lines.push(`<div class="st">Клик — вложить очко</div>`);
    return lines.join("");
  }

  // ---------- личное состояние ----------
  private showInvWin() {
    if (this.wins.inv.hidden && this.ctx?.net.self) { this.wins.inv.hidden = false; this.renderSelf(this.ctx.net.self); }
  }
  renderSelf(s: SelfState) {
    this.bestiary.update(s);
    if (!s.isAdmin) this.admin.close();
    if (!s) return;
    this.foodId = s.food?.id ?? "";
    this.foodUntil = s.food ? Date.now() + s.food.left : 0;
    this.cook.update(s);
    this.quest.update(s);
    this.tp.update(s, this.lastPos);
    this.smith.update(s);
    this.bank.update();
    this.bags.update();
    if (this.lastSelfLevel && s.level > this.lastSelfLevel) this.toast({ text: `Новый уровень: ${s.level}! Очки характеристик и умений ждут (C, K)`, kind: "level" });
    this.lastSelfLevel = s.level;
    const net = this.ctx.net;
    // панель героя
    const pts = [s.statPoints ? `<span class="pill" data-open="char">+${s.statPoints} хар.</span>` : "", s.skillPoints ? `<span class="pill" data-open="skills">+${s.skillPoints} ум.</span>` : ""].join("");
    this.player.innerHTML = `
      <div class="row1"><span class="nm">${esc(s.name)}</span><span class="lv">${CLASSES[s.cls].name} · ур. ${s.level}</span><span class="fac-badge" title="${esc(FACTIONS[s.faction]?.full ?? "")}">${esc(FACTIONS[s.faction]?.name ?? "")}</span></div>
      <div class="combat-badge" ${this.inCombat ? "" : "hidden"}>╳ В бою</div>
      <div class="bar hp"><i id="hp-fill"></i><span id="hp-text"></span></div>
      <div class="bar mp"><i id="mp-fill"></i><span id="mp-text"></span></div>
      <div class="bar xp" title="Опыт"><i style="width:${s.xpNext ? (s.xp / s.xpNext) * 100 : 100}%"></i></div>
      <div class="pts"><span class="muted">Опыт ${s.xpNext ? `${s.xp} / ${s.xpNext}` : "максимум"}</span>${gold(s.gold)}${pts}</div><div class="food-buff" hidden></div>`;
    this.updateFoodLabel();
    this.player.querySelectorAll<HTMLElement>("[data-open]").forEach((p) => (p.onclick = () => this.toggle(p.dataset.open!)));

    // панель умений
    this.bar.innerHTML = "";
    activeSkills(s.cls).forEach((def, i) => {
      const r = s.skills[def.id] || 0;
      const b = el("button", `slot ${r ? "" : "locked"}`, `<img src="${icon(def.icon)}" alt=""><kbd>${i + 1}</kbd><i class="cd" data-cd="${def.id}" style="transform:scaleY(0)"></i><span class="cdt" data-cdt="${def.id}"></span>`);
      b.dataset.skill = def.id;
      b.onclick = () => this.ctx.useSkill(i);
      this.tipFor(b, () => this.skillTip(def, net.self!));
      this.bar.append(b);
    });
    this.bar.append(el("span", "sep"));
    for (const [base, key] of [["hp_potion", "Q"], ["mp_potion", "E"]]) {
      const qty = s.inventory.reduce((a, it) => a + (it && it.base === base ? it.qty ?? 1 : 0), 0);
      const b = el("button", `slot ${qty ? "" : "empty"}`, `<img src="${icon(BASE_ITEMS[base].icon)}" alt=""><kbd>${key}</kbd><span class="qty">${qty}</span>`);
      b.onclick = () => this.ctx.usePotion(base);
      this.tipFor(b, () => `<div class="t">${BASE_ITEMS[base].name}</div><div class="d">${qty} шт. · клавиша ${key}</div>`);
      this.bar.append(b);
    }

    {
      const mid = s.mount ?? "";
      const md = MOUNTS[mid];
      const mounted = !!(this.ctx.net.unit(s.id)?.mount);
      const b = el("button", `slot ${md ? "" : "empty"}`, `<span style="font-size:26px;line-height:50px;display:block;text-align:center">${mounted ? "⤓" : "♞"}</span><kbd>X</kbd>`);
      b.onclick = () => this.ctx.toggleMount?.();
      this.tipFor(b, () => md ? `<div class="t">${md.name}</div><div class="d">Скорость ×${md.speed} · призыв 2 с, стоя на месте. X — сесть/слезть, Shift+X — сменить. Не в бою, не на арене.</div>` : `<div class="t">Маунт</div><div class="d">Бурый конь — с 10 уровня</div>`);
      this.bar.append(b);
    }
    {
      const pd = PETS[s.pet ?? ""];
      const rec = s.pets?.[s.pet ?? ""];
      const out = !!this.ctx.net.unit(petUnitId(s.id));
      const b = el("button", `slot ${pd ? "" : "empty"}`, `<span style="font-size:26px;line-height:50px;display:block;text-align:center">${out ? "✕" : "🐾"}</span><kbd>G</kbd>`);
      b.onclick = () => this.ctx.togglePet?.();
      this.tipFor(b, () => pd && rec
        ? `<div class="t">${pd.name} · ур. ${rec.level}</div><div class="d">${pd.skills.map((k) => `${k.name}: ${k.desc}`).join("<br>")}<br>G — призвать (2 с) / отпустить, Shift+G — сменить. Погиб — призыв через 60 с. Не на арене.</div>`
        : `<div class="t">Питомец</div><div class="d">Волчонок — с 5 уровня. Другие — у торговки или редкая добыча.</div>`);
      this.bar.append(b);
    }
    if (!this.wins.char.hidden) this.renderChar(s);
    if (!this.wins.inv.hidden) this.renderInv(s);
    if (!this.wins.skills.hidden) this.renderSkills(s);
    if (!this.wins.shop.hidden) this.renderShop(s);
  }

  /** Иконка активной еды у рамки героя: оставшиеся минуты и подсказка с бонусами. */
  private updateFoodLabel() {
    const box = this.player.querySelector<HTMLElement>(".food-buff");
    if (!box) return;
    const d = FOOD[this.foodId];
    const left = this.foodUntil - Date.now();
    if (!d || left <= 0) { box.hidden = true; return; }
    const min = Math.max(1, Math.ceil(left / 60000));
    box.hidden = false;
    box.innerHTML = `<img src="${icon(d.icon)}" alt=""><span>${min} мин.</span>`;
    box.onmouseenter = (e) => { this.tip.innerHTML = foodTip(d, Math.max(1, Math.ceil((this.foodUntil - Date.now()) / 60000))); this.tip.hidden = false; this.moveTip(e); };
    box.onmousemove = (e) => this.moveTip(e);
    box.onmouseleave = () => (this.tip.hidden = true);
  }

  private renderChar(s: SelfState) {
    const b = this.body("char");
    const d = s.derived;
    b.innerHTML = `<p class="muted">Свободно очков: <b class="gold">${s.statPoints}</b> (3 за уровень)</p><div class="stats"></div>
      <div class="derived">
        <span>Урон</span><span>${d.dmgMin}–${d.dmgMax}</span>
        <span>Здоровье</span><span>${d.maxHp}</span>
        <span>Мана</span><span>${d.maxMp}</span>
        <span>Броня</span><span>${d.armor}</span>
        <span>Шанс крита</span><span>${(d.crit * 100).toFixed(1)}%</span>
        <span>Урон крита</span><span>${Math.round(d.critMult * 100)}%</span>
        <span>Уклонение</span><span>${(d.dodge * 100).toFixed(1)}%</span>
        <span>Сила умений</span><span>${Math.round(d.skillMult * 100)}%</span>
        <span>Атак в секунду</span><span>${(1 / d.attackCd).toFixed(2)}</span>
        <span>Реген здоровья</span><span>${d.hpRegen.toFixed(1)}/с</span>
        <span>Реген маны</span><span>${d.mpRegen.toFixed(1)}/с</span>
        ${d.lifesteal ? `<span>Вампиризм</span><span>${Math.round(d.lifesteal * 100)}%</span>` : ""}
        <span>Убито врагов</span><span>${s.kills}</span>
        <span>Повержено боссов</span><span>${Object.values(s.bossKills).reduce((a, c) => a + c, 0)}</span>
      </div>`;
    const grid = b.querySelector(".stats")!;
    for (const k of ["str", "agi", "int", "vit"] as StatKey[]) {
      const main = CLASSES[s.cls].mainStat === k;
      const name = el("span", "k", `${STAT_NAMES[k]}${main ? ' <span class="gold">★</span>' : ""}`);
      this.tipFor(name, () => `<div class="t">${STAT_NAMES[k]}</div><div>${STAT_HINTS[k]}</div>${statTip(k, s)}<div class="d">Вложено: ${s.alloc[k]}</div>`);
      const plus = el("button", "btn plus", "+");
      plus.disabled = s.statPoints <= 0;
      plus.setAttribute("aria-label", `Добавить: ${STAT_NAMES[k]}`);
      plus.onclick = () => this.ctx.net.send("alloc", { stat: k });
      grid.append(name, el("span", "v", String(d.stats[k])), plus);
    }
  }

  private cell(it: Item | null, s: SelfState, cls = "", label = ""): HTMLButtonElement {
    const c = el("button", `cell ${cls}`);
    if (it) {
      c.classList.add(`r${it.rarity}`);
      if (BASE_ITEMS[it.base].slot !== "consumable" && canEquip(it, s.cls, s.level)) c.classList.add("cant");
      c.innerHTML = `<img src="${icon(iconFor(it))}" alt="${esc(itemName(it))}">${plusBadge(it)}${it.qty && it.qty > 1 ? `<span class="qty">${it.qty}</span>` : ""}`;
    } else if (label) {
      // пустой слот экипировки: бледный силуэт вещи, название — в подсказке
      const base = ghostBase[label];
      c.title = label;
      c.innerHTML = base ? `<img class="ghost" src="${icon(iconFor({ base, stats: {}, uid: "slot", rarity: 0 }))}" alt="${label}">` : `<span class="lbl">${label}</span>`;
    }
    return c;
  }
  private petPop: "pet" | "mount" | null = null;
  /** Слоты «Питомец» и «Маунт» под снаряжением; клик открывает список своих. */
  private renderCompanions(row: HTMLElement, s: SelfState) {
    const send = (t: "pet:toggle" | "mount:toggle" | "pet:select" | "mount:select", id?: string) => this.ctx.net.send(t as never, (id ? { id } : {}) as never);
    for (const kind of ["pet", "mount"] as const) {
      const id = kind === "pet" ? s.pet : s.mount;
      const owned = kind === "pet" ? !!id && !!s.pets?.[id] : !!id && !!s.mounts?.includes(id);
      const label = kind === "pet" ? "Питомец" : "Маунт";
      const c = el("button", `cell comp${this.petPop === kind ? " open" : ""}`);
      const img = owned ? (kind === "pet" ? PETS[id!]?.sprite : mountSprite(id!)) : "";
      if (owned && img) {
        const lv = kind === "pet" ? `<span class="qty">${s.pets![id!].level}</span>` : "";
        c.innerHTML = `<img src="${icon(img)}" alt="${label}">${lv}`;
        this.tipFor(c, () => kind === "pet" ? this.petTip(id!, s) : this.mountTip(id!));
      } else {
        c.title = label;
        c.innerHTML = `<img class="ghost" src="${icon(kind === "pet" ? "pet_wolf" : "mount_horse")}" alt="${label}">`;
      }
      c.onclick = () => { this.tip.hidden = true; this.petPop = this.petPop === kind ? null : kind; this.renderSelf(this.ctx.net.self!); };
      row.append(c);
    }
    row.append(el("span", "muted comp-hint", "Питомец (G) и маунт (X)"));
    const kind = this.petPop;
    if (!kind) return;
    const pop = el("div", "panel comp-pop");
    const ids = kind === "pet" ? Object.keys(s.pets ?? {}) : (s.mounts ?? []);
    const cur = kind === "pet" ? s.pet : s.mount;
    if (!ids.length) {
      pop.innerHTML = kind === "pet"
        ? "<p class=\"muted\">Питомцев пока нет. Волчонка можно получить с 5 уровня, остальных продаёт торговка Марфа.</p>"
        : "<p class=\"muted\">Маунтов пока нет. Их продаёт торговка Марфа в Эмберхолле.</p>";
    }
    for (const id of ids) {
      const d = kind === "pet" ? PETS[id] : MOUNTS[id];
      if (!d) continue;
      const r = el("button", `comp-row${id === cur ? " cur" : ""}`);
      const sub = kind === "pet" ? `ур. ${s.pets![id].level}` : `скорость ×${MOUNTS[id].speed}`;
      r.innerHTML = `<img src="${icon(kind === "pet" ? PETS[id].sprite : mountSprite(id))}" alt=""><span class="nm">${esc(d.name)}</span><span class="muted">${sub}${id === cur ? " · выбран" : ""}</span>`;
      r.onclick = () => send(kind === "pet" ? "pet:select" : "mount:select", id);
      this.tipFor(r, () => kind === "pet" ? this.petTip(id, s) : this.mountTip(id));
      pop.append(r);
    }
    if (ids.length) {
      const b = el("button", "btn small", kind === "pet" ? "Призвать / отозвать" : "Сесть / слезть");
      b.onclick = () => send(kind === "pet" ? "pet:toggle" : "mount:toggle");
      pop.append(b);
    }
    row.after(pop);
  }
  private petTip(id: string, s: SelfState): string {
    const d = PETS[id];
    if (!d) return "";
    return `<div class="t">${esc(d.name)} · ур. ${s.pets?.[id]?.level ?? 1}</div>${d.skills.map((k) => `<div><b>${esc(k.name)}</b> — ${esc(k.desc)}</div>`).join("")}<div class="d">Призвать: G, выбрать следующего: Shift+G</div>`;
  }
  private mountTip(id: string): string {
    const m = MOUNTS[id];
    return m ? `<div class="t">${esc(m.name)}</div><div>Скорость ×${m.speed}</div><div class="d">Сесть: X, выбрать следующий: Shift+X</div>` : "";
  }
  private renderInv(s: SelfState) {
    const b = this.body("inv");
    const shop = !this.wins.shop.hidden;
    b.innerHTML = `<div class="equip"></div><div class="equip extra"></div><p class="muted">${this.bank.isOpen ? "Банк открыт: клик по предмету — положить в банк." : shop ? "Торговец рядом: клик по предмету в сумке — продать." : "Клик — надеть или выпить. Перетащите, чтобы переложить."}</p><div class="grid"></div><p class="muted">Золото: <b>${gold(s.gold)}</b></p>`;
    const eq = b.querySelector(".equip")!;
    for (const slot of SLOTS) {
      if (slot === "offhand" && !OFFHAND_CLASSES.includes(s.cls)) continue;
      const it = s.equip[slot];
      ghostBase[SLOT_NAMES[slot]] = slot === "weapon" ? CLASSES[s.cls].startWeapon : slot === "offhand" ? "shield" : slot;
      const c = this.cell(it, s, "", SLOT_NAMES[slot]);
      if (it) {
        c.onclick = () => this.ctx.net.send("unequip", { slot });
        this.tipFor(c, () => this.itemTip(it, this.ctx.net.self!, true));
      }
      eq.append(c);
    }
    this.renderCompanions(b.querySelector<HTMLElement>(".equip.extra")!, s);
    const grid = b.querySelector(".grid")!;
    const locked = this.trade.lockedIndices();
    s.inventory.forEach((it, i) => {
      const c = this.cell(it, s, locked.has(i) ? "locked" : "");
      c.draggable = !!it;
      c.ondragstart = (e) => e.dataTransfer!.setData("text/plain", String(i));
      c.ondragover = (e) => { e.preventDefault(); c.classList.add("drag"); };
      c.ondragleave = () => c.classList.remove("drag");
      c.ondrop = (e) => {
        e.preventDefault();
        c.classList.remove("drag");
        const data = e.dataTransfer!.getData("text/plain");
        const fromBank = parseBankDrag(data);
        if (fromBank) return this.ctx.net.send("bank:take", { ...fromBank, index: i });
        const from = data === "" ? NaN : Number(data);
        if (Number.isInteger(from) && from !== i) this.ctx.net.send("swap", { a: from, b: i });
      };
      if (it) {
        c.onclick = () => {
          this.tip.hidden = true;
          if (this.trade.isOpen) { if (!locked.has(i)) this.trade.offer(i); }
          else if (this.bank.isOpen) this.bank.deposit(i);
          else if (!this.wins.shop.hidden) this.ctx.net.send("sell", { index: i });
          else if (BASE_ITEMS[it.base].slot === "consumable") this.ctx.net.send("use", { index: i });
          else this.ctx.net.send("equip", { index: i });
        };
        this.tipFor(c, () => this.itemTip(it, this.ctx.net.self!));
      }
      grid.append(c);
    });
  }

  private renderSkills(s: SelfState) {
    const b = this.body("skills");
    b.innerHTML = `<p class="muted">Свободно очков умений: <b class="gold">${s.skillPoints}</b> (1 за уровень, после 30-го — 1 за 2 уровня). Активные — квадратные, пассивные — круглые.</p><div class="tree"></div>`;
    const tree = b.querySelector<HTMLElement>(".tree")!;
    const defs = classSkills(s.cls);
    const rows = Math.max(...defs.map((d) => d.tree[0])) + 1;
    tree.style.gridTemplateRows = `repeat(${rows}, auto)`;
    const nodes = new Map<string, HTMLElement>();
    for (const def of defs) {
      const r = s.skills[def.id] || 0;
      const can = !canLearn(def, s.skills, s.level, s.skillPoints);
      const n = el("div", `node ${def.kind === "passive" ? "passive" : ""} ${can ? "can" : ""}`);
      n.style.gridRow = String(def.tree[0] + 1);
      n.style.gridColumn = String(def.tree[1] + 1);
      const btn = el("button", `slot ${r ? "" : "locked"}`, `<img src="${icon(def.icon)}" alt="">`);
      btn.onclick = () => this.ctx.net.send("learn", { id: def.id });
      this.tipFor(btn, () => this.skillTip(def, this.ctx.net.self!));
      n.append(btn, el("span", "nm", def.name), el("span", "rk", `${r}/${def.maxRank} · ур.${def.reqLevel}`));
      tree.append(n);
      nodes.set(def.id, n);
    }
    requestAnimationFrame(() => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const tr = tree.getBoundingClientRect();
      for (const def of defs) {
        if (!def.req) continue;
        const a = nodes.get(def.req.id)?.querySelector(".slot")?.getBoundingClientRect();
        const c = nodes.get(def.id)?.querySelector(".slot")?.getBoundingClientRect();
        if (!a || !c) continue;
        const ok = (s.skills[def.req.id] || 0) >= def.req.rank;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(a.left + a.width / 2 - tr.left));
        line.setAttribute("y1", String(a.top + a.height / 2 - tr.top));
        line.setAttribute("x2", String(c.left + c.width / 2 - tr.left));
        line.setAttribute("y2", String(c.top + c.height / 2 - tr.top));
        // золотая — оба умения изучены; пунктир — следующее уже доступно; тёмная — закрыто
        const learned = (s.skills[def.id] || 0) > 0;
        line.setAttribute("stroke", learned && ok ? "#f0c050" : ok ? "#8a7350" : "#4d3f4a");
        line.setAttribute("stroke-width", "3");
        if (ok && !learned) line.setAttribute("stroke-dasharray", "6 5");
        svg.append(line);
      }
      tree.prepend(svg);
    });
  }

  /** Полоса призыва маунта над панелью умений. */
  /** Шкала воздуха под водой (air < 0 — скрыть). */
  private airBar(air: number, max: number) {
    let box = document.getElementById("air-bar");
    if (air < 0) return void box?.remove();
    if (!box) {
      box = el("div", "", `<div style="font-size:13px;color:#cfeaff;text-shadow:0 1px 0 #000;text-align:center">Воздух</div><div style="height:8px;background:#06121c;border:1px solid #4a7a9a;margin-top:2px"><i style="display:block;height:100%;width:100%;background:#4ab8ff;transition:width .4s linear"></i></div>`);
      box.id = "air-bar";
      box.style.cssText = "position:fixed;left:50%;bottom:150px;width:200px;transform:translateX(-50%);z-index:20;pointer-events:none";
      document.body.append(box);
    }
    const bar = box.querySelector("i") as HTMLElement;
    const k = Math.max(0, Math.min(1, air / max));
    bar.style.width = `${k * 100}%`;
    bar.style.background = k < 0.25 ? "#ff5a4a" : "#4ab8ff";
  }

  private inCombat = false;
  private setCombat(on: boolean) {
    this.inCombat = on;
    const b = this.player.querySelector<HTMLElement>(".combat-badge");
    if (b) b.hidden = !on;
  }

  private mountCast(ms: number, name?: string) {
    let box = document.getElementById("mount-cast");
    if (!ms) return void box?.remove();
    box?.remove();
    box = el("div", "", `<div style="font-size: 14px;color:#fff;text-shadow:0 1px 0 #000;text-align:center">${esc(name ?? "Маунт")}</div><div style="height:6px;background:#0a0608;border:1px solid #6a5a46;margin-top:2px"><i style="display:block;height:100%;width:0;background:#f0c050;transition:width ${ms}ms linear"></i></div>`);
    box.id = "mount-cast";
    box.style.cssText = "position:fixed;left:50%;bottom:110px;width:180px;transform:translateX(-50%);z-index:20;pointer-events:none";
    document.body.append(box);
    const bar = box.querySelector("i") as HTMLElement;
    requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = "100%")));
  }

  private shopTab: "buy" | "sell" = "buy";
  private renderShop(s: SelfState) {
    const b = this.body("shop");
    b.innerHTML = "";
    b.classList.add("shop");
    const tabs = el("div", "shop-tabs");
    for (const [k, t] of [["buy", "Купить"], ["sell", "Продать"]] as const) {
      const tb = el("button", `btn${this.shopTab === k ? " on" : ""}`, t);
      tb.onclick = () => { this.shopTab = k; this.renderShop(s); };
      tabs.append(tb);
    }
    const list = el("div", "shop-list");
    const foot = el("div", "shop-foot", `<span class="muted">«Зелья свежие, цены честные.»</span><span>Золото: <b>${gold(s.gold)}</b></span>`);
    b.append(tabs, list, foot);
    // карточка товара: иконка в ячейке, название, описание, кнопки с ценой
    let grid: HTMLElement = list;
    const row = (pic: string, name: string, desc: string, btns: [string, number, boolean, () => void][]) => {
      const r = el("div", "shop-card", `<div class="sc-top"><span class="sc-icon">${pic}</span><div class="si-text"><b>${name}</b><span class="muted">${desc}</span></div></div>`);
      const bx = el("div", "si-btns");
      for (const [label, price, locked, buy] of btns) {
        const btn = el("button", "btn small", label ? `<span class="q">${label.trim()}</span>${gold(price)}` : gold(price));
        btn.disabled = locked || s.gold < price;
        btn.onclick = buy;
        bx.append(btn);
      }
      r.append(bx);
      grid.append(r);
    };
    const head = (t: string) => { list.append(el("div", "shop-head", t)); grid = list.appendChild(el("div", "shop-grid")); };
    const sprite = (key: string) => `<img src="${icon(key)}" alt="">`;
    if (this.shopTab === "buy") {
      head("Зелья");
      for (const base of ["hp_potion", "mp_potion"]) {
        const def = BASE_ITEMS[base], p = def.price ?? 0;
        row(`<img src="${icon(def.icon)}" alt="">`, def.name, base === "hp_potion" ? "+45% здоровья" : "+50% маны",
          [1, 5, 20].map((q) => [`×${q}`, p * q, false, () => this.ctx.net.send("buy", { base, qty: q })] as [string, number, boolean, () => void]));
      }
      const mounts = MOUNT_IDS.filter((id) => MOUNTS[id].price > 0 && !s.mounts?.includes(id));
      if (mounts.length) head("Ездовые животные");
      for (const id of mounts) {
        const m = MOUNTS[id];
        row(sprite(mountSprite(id)), m.name, `Скорость ×${m.speed}, с ${m.level} ур.`, [["Купить ", m.price, s.level < m.level, () => this.ctx.net.send("mount:buy", { id })]]);
      }
      const pets = PET_IDS.filter((id) => PETS[id].price > 0 && !s.pets?.[id]);
      if (pets.length) head("Питомцы");
      for (const id of pets) {
        const d = PETS[id];
        row(sprite(d.sprite), d.name, `С ${d.level} ур.: ${d.skills.map((k) => k.name).join(", ")}`, [["Купить ", d.price, s.level < d.level, () => this.ctx.net.send("pet:buy", { id })]]);
      }
    } else {
      list.append(el("p", "muted", "Клик по вещи — продать. Цена падает, если такие вещи часто продают."));
      const grid = el("div", "sell-grid");
      let any = false;
      s.inventory.forEach((it, i) => {
        if (!it) return;
        any = true;
        const c = el("button", `sell-cell r${it.rarity}`, `<img src="${icon(iconFor(it))}" alt="">${it.qty && it.qty > 1 ? `<span class="qty">${it.qty}</span>` : ""}<span class="sp">${this.sellInfo(it).price}</span>`);
        c.onclick = () => this.ctx.net.send("sell", { index: i });
        this.tipFor(c, () => this.itemTip(it, s));
        grid.append(c);
      });
      list.append(any ? grid : el("p", "muted", "Сумка пуста."));
      const junk = s.inventory.map((it, i) => [it, i] as const).filter(([it]) => it && it.rarity === 0 && BASE_ITEMS[it.base].slot !== "consumable");
      const junkSum = junk.reduce((a, [it]) => a + this.sellInfo(it!).price * (it!.qty ?? 1), 0);
      const sellAll = el("button", "btn", `Продать все обычные вещи (${junk.length}) · ${gold(junkSum, "~")}`);
      sellAll.disabled = !junk.length;
      sellAll.onclick = () => junk.slice().reverse().forEach(([, i]) => this.ctx.net.send("sell", { index: i }));
      list.append(sellAll);
    }
  }

  // ---------- мини-карта ----------
  private buildMiniBase() {
    const m = this.ctx.map;
    const c = document.createElement("canvas");
    c.width = m.w;
    c.height = m.h;
    const g = c.getContext("2d")!;
    const img = g.createImageData(m.w, m.h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      let col = TERRAIN_COLORS[m.vtx[y * (m.w + 1) + x]] ?? "#4f873c";
      const blocked = m.cell[y * m.w + x] & 1 && m.vtx[y * (m.w + 1) + x] !== T.Water && m.vtx[y * (m.w + 1) + x] !== T.Lava;
      if (m.cell[y * m.w + x] & 2) col = "#1c1822";
      else if (blocked && isTownZone(m.zone[y * m.w + x])) {
        const c = CITIES.find((k) => k.style && Math.abs(x - k.x) <= k.half.x && Math.abs(y - k.y) <= k.half.y);
        if (c) {
          const ax = Math.abs(x - c.x), ay = Math.abs(y - c.y);
          const pal: Record<string, [string, string]> = { desert: ["#d8b878", "#c8884a"], snow: ["#9a6a3a", "#6a4a32"], solgard: ["#f0ead8", "#d8a830"], umbrath: ["#3a2c48", "#7a3ab0"] };
          const [wallC, roofC] = pal[c.style!] ?? pal.snow;
          col = ax >= CITY_WALL.x || ay >= CITY_WALL.y ? wallC : roofC;
        } else {
        // город: стены и башни — светлый камень, дома — черепица
        const dx = Math.abs(x - TOWN.x), dy = Math.abs(y - TOWN.y);
        col = dx >= WALL.x || dy >= WALL.y ? "#c8c0b0" : "#a04a30";
        }
      } else if (blocked) col = "#22402a";
      const i = (y * m.w + x) * 4;
      img.data[i] = parseInt(col.slice(1, 3), 16);
      img.data[i + 1] = parseInt(col.slice(3, 5), 16);
      img.data[i + 2] = parseInt(col.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.miniBase = c;
  }
  private drawMini(info: FrameInfo) {
    const g = this.miniCanvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const m = this.ctx.map;
    // большой мир: окно 160×120 тайлов вокруг героя (1,5 px на тайл); маленькая карта арены — целиком на весь холст
    const CW = this.miniCanvas.width, CH = this.miniCanvas.height;
    const big = m.w > 200;
    const vw = big ? 160 : m.w, vh = big ? 120 : m.h;
    const k = Math.min(CW / vw, CH / vh);
    const vx = big ? Math.max(0, Math.min(m.w - vw, info.pos.x / TILE - vw / 2)) : 0;
    const vy = big ? Math.max(0, Math.min(m.h - vh, info.pos.y / TILE - vh / 2)) : 0;
    const ox = (CW - vw * k) / 2 - vx * k, oy = (CH - vh * k) / 2 - vy * k;
    const X = (px: number) => ox + (px / TILE) * k, Y = (py: number) => oy + (py / TILE) * k;
    g.fillStyle = "#0e0b10";
    g.fillRect(0, 0, CW, CH);
    if (this.miniBase) g.drawImage(this.miniBase, ox, oy, m.w * k, m.h * k);
    const dot = Math.max(1.5, k * 0.9);
    for (const b of m.bosses) {
      g.fillStyle = "#ff7a2a";
      g.fillRect(X(b.x) - 2, Y(b.y) - 2, 4, 4);
    }
    for (const [, v] of info.units) {
      if (v.dead) continue;
      const near = Math.hypot(v.x - info.pos.x, v.y - info.pos.y) < 900;
      if ((v.u.kind === UnitKind.Mob && !near) || v.u.kind === UnitKind.Citizen) continue;
      const enemy = v.u.kind === UnitKind.Player && (this.ctx.net.kind === "arena" ? v.u.team !== this.ctx.net.arena?.team : !!v.u.faction && v.u.faction !== this.ctx.net.self?.faction);
      g.fillStyle = v.u.kind === UnitKind.Guard ? "#7a9cc8" : v.u.kind === UnitKind.Player ? (enemy ? "#ff6a5a" : "#6ac8ff") : v.u.kind === UnitKind.Boss ? "#ff3a1a" : "#e84a4a";
      const s = v.u.kind === UnitKind.Boss ? 3 : dot;
      g.fillRect(Math.floor(X(v.x)), Math.floor(Y(v.y)), s, s);
    }
    g.fillStyle = "#ffffff";
    g.fillRect(X(info.pos.x) - 1.5, Y(info.pos.y) - 1.5, 3, 3);
    if (this.ctx.net.kind === "world") {
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.strokeRect(X(info.pos.x) - 20, Y(info.pos.y) - 12, 40, 24);
    }
    const zi = zoneAtPx(m, info.pos.x, info.pos.y);
    const z = ZONES[zi];
    const sub = this.ctx.net.kind === "arena" ? "PvP" : z.safe ? "безопасно" : z.note ? "дикие края" : `ур. ${z.levels[0]}–${z.levels[1]}`;
    document.getElementById("mini-zone")!.innerHTML = `${esc(z.name)} <small>${sub}</small>`;
  }

  // ---------- каждый кадр ----------
  private lastPos = { x: 0, y: 0 };
  frame(info: FrameInfo) {
    const me = info.me;
    this.lastPos = info.pos;
    if (me) {
      const hp = document.getElementById("hp-fill"), mp = document.getElementById("mp-fill");
      if (hp) { hp.style.width = `${(me.hp / Math.max(1, me.maxHp)) * 100}%`; document.getElementById("hp-text")!.textContent = `${Math.max(0, me.hp)} / ${me.maxHp}`; }
      if (mp) { mp.style.width = `${(me.mp / Math.max(1, me.maxMp)) * 100}%`; document.getElementById("mp-text")!.textContent = `${me.mp} / ${me.maxMp}`; }
      // смерть
      if (me.anim === Anim.Dead) {
        if (!this.deadSince) {
          this.deadSince = performance.now();
          this.death.hidden = false;
          this.death.innerHTML = `<div class="panel"><h2>Вы пали в бою</h2><p class="muted">Вы потеряете 10% золота и очнётесь в ближайшем открытом городе (или в столице своей фракции).</p><button class="btn primary" id="respawn">Возродиться</button></div>`;
          document.getElementById("respawn")!.onclick = () => this.ctx.net.send("respawn", {});
        }
        const left = Math.ceil((RESPAWN_DELAY_MS - (performance.now() - this.deadSince)) / 1000);
        const btn = document.getElementById("respawn") as HTMLButtonElement | null;
        if (btn) { btn.disabled = left > 0; btn.textContent = left > 0 ? `Возродиться (${left})` : "Возродиться"; }
      } else if (this.deadSince) {
        this.deadSince = 0;
        this.death.hidden = true;
      }
    }
    // цель
    const t = info.target;
    if (t && t.anim !== Anim.Dead) {
      this.targetBox.hidden = false;
      const boss = t.kind === UnitKind.Boss;
      this.targetBox.classList.toggle("boss", boss);
      const def = Object.values(MOBS).find((m) => m.name === t.name);
      const phase = boss ? `<div class="phase">Фаза ${t.phase + 1} · ур. ${t.level}${def?.uniques ? " · уникальная добыча" : ""}</div>` : "";
      const sig = `${t.name}|${t.level}|${t.hp}|${t.maxHp}|${t.phase}`;
      if (this.targetBox.dataset.sig !== sig) {
        this.targetBox.dataset.sig = sig;
        this.targetBox.innerHTML = `<div class="nm">${esc(t.name)} ${t.kind === UnitKind.Player ? "" : `<span class="muted">ур. ${t.level}</span>`}</div><div class="bar hp"><i style="width:${(t.hp / Math.max(1, t.maxHp)) * 100}%"></i><span>${t.hp} / ${t.maxHp}</span></div>${phase}`;
      }
    } else this.targetBox.hidden = true;

    // рамка питомца под рамкой героя
    const sid = this.ctx.net.self?.id;
    const pu = sid ? this.ctx.net.unit(petUnitId(sid)) : undefined;
    if (pu) {
      this.petBox.hidden = false;
      const sig = `${pu.name}|${pu.level}|${pu.hp}|${pu.maxHp}`;
      if (this.petBox.dataset.sig !== sig) {
        this.petBox.dataset.sig = sig;
        this.petBox.innerHTML = `<div class="row1"><span class="nm">${esc(pu.name)}</span><span class="lv">ур. ${pu.level}</span></div><div class="bar hp"><i style="width:${(pu.hp / Math.max(1, pu.maxHp)) * 100}%"></i><span>${pu.hp} / ${pu.maxHp}</span></div>`;
      }
    } else this.petBox.hidden = true;

    // перезарядки и мана
    const self = this.ctx.net.self;
    if (self) {
      const now = performance.now();
      for (const def of activeSkills(self.cls)) {
        const end = this.ctx.net.cooldowns.get(def.id) ?? 0;
        const cdEl = this.bar.querySelector<HTMLElement>(`[data-cd="${def.id}"]`);
        const txt = this.bar.querySelector<HTMLElement>(`[data-cdt="${def.id}"]`);
        if (!cdEl || !txt) continue;
        const left = Math.max(0, end - now);
        const total = def.cd!(Math.max(1, self.skills[def.id] || 1)) * 1000;
        cdEl.style.transform = `scaleY(${Math.min(1, left / total)})`;
        txt.textContent = left > 0 ? (left / 1000).toFixed(left < 1000 ? 1 : 0) : "";
        const slot = cdEl.parentElement!;
        slot.classList.toggle("nomana", !!me && me.mp < def.mana!(Math.max(1, self.skills[def.id] || 1)) && !!self.skills[def.id]);
      }
    }
    this.arena.frame(info.units);
    const now = performance.now();
    if (now - this.lastMini > 200) {
      this.lastMini = now;
      this.drawMini(info);
    }
  }
}

export { MAX_LEVEL, SKILLS };

const pct = (v: number) => `${+(v * 100).toFixed(2)}%`;
/** Что даёт одно очко характеристики этому классу (в подсказке окна персонажа). */
function statTip(k: StatKey, s: SelfState): string {
  const c = CLASSES[s.cls], d = s.derived, main = c.mainStat === k;
  const L: string[] = [];
  if (k === "str") {
    L.push(main ? `+${pct(c.mainK)} урона (ближний бой)` : `+${pct(STAT_K.strDmg)} урона`);
    L.push(`+${STAT_K.strHp} здоровья`);
  } else if (k === "agi") {
    if (main) L.push(`+${pct(c.mainK)} урона`);
    else if (c.projectile) L.push(`+${pct(STAT_K.agiRanged)} урона (дальний бой)`);
    L.push(`+${pct(STAT_K.agiCrit)} шанса крита`, `+${pct(STAT_K.agiDodge)} уклонения (до ${pct(DODGE_CAP)})`, "+0.4% скорости атаки");
  } else if (k === "int") {
    if (main) L.push(`+${pct(c.mainK)} урона`);
    L.push(`+${pct(STAT_K.intSkill)} силы умений`, "+6 маны", "+0.12 маны/с");
  } else {
    L.push(`+${STAT_K.vitHp} здоровья`, `+${STAT_K.vitArmor} брони`, "+0.12 здоровья/с");
  }
  const now = k === "str" ? `Здоровье ${d.maxHp}, урон ${d.dmgMin}–${d.dmgMax}`
    : k === "agi" ? `Крит ${(d.crit * 100).toFixed(1)}%, уклонение ${(d.dodge * 100).toFixed(1)}%`
    : k === "int" ? `Мана ${d.maxMp}, сила умений ${Math.round(d.skillMult * 100)}%`
    : `Здоровье ${d.maxHp}, броня ${d.armor}`;
  return `<div class="d">За 1 очко: ${L.join(", ")}.</div><div class="d">Сейчас: ${now}</div>`;
}
