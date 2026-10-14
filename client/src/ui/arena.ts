/** Интерфейс арены: окно (рейтинг, очередь, группа, лидеры, история), подтверждение матча, табло боя, результаты. */
import {
  ACCEPT_MS, ARENA_MODES, MODE_NAMES, queueWindow, rankById, rankOf, RANKS,
  type ArenaInfo, type ArenaMode, type ArenaResultMsg, type HistoryRow, type LeaderRow, type MatchFoundMsg,
} from "../../../shared/arena";
import { CLASSES, type ClassId } from "../../../shared/classes";
import { UnitKind } from "../../../shared/protocol";
import type { Net, UnitState } from "../net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clsName = (c: string) => CLASSES[c as ClassId]?.name ?? c;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const badge = (rating: number) => {
  const r = rankOf(rating);
  return `<span class="rank" style="--rank:${r.color}">${r.name}</span>`;
};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class ArenaUI {
  net!: Net;
  private win = el("div", "panel win win-arena");
  private found = el("div", "arena-modal");
  private invite = el("div", "arena-modal");
  private results = el("div", "arena-modal");
  private board = el("div", "panel arena-board");
  private countdown = el("div", "arena-countdown passthru");
  private partyBox = el("div", "panel hud-party");
  private tab: "rating" | "top" | "history" = "rating";
  private topMode: ArenaMode = "1v1";
  private top: Partial<Record<ArenaMode, LeaderRow[]>> = {};
  private history: HistoryRow[] | null = null;
  private infoAt = 0;
  private foundMsg: MatchFoundMsg | null = null;
  private foundAt = 0;
  private acceptedSelf = false;
  private lastPhase = "";
  private resultTimer = 0;
  private bound = false;

  constructor(
    readonly root: HTMLElement,
    readonly toast: (text: string, kind?: "info" | "error" | "loot" | "level") => void,
  ) {
    for (const e of [this.win, this.found, this.invite, this.results, this.board, this.countdown]) e.hidden = true;
    this.partyBox.hidden = true;
    root.append(this.win, this.board, this.countdown, this.partyBox, this.found, this.invite, this.results);
  }

  bind(net: Net) {
    this.net = net;
    if (this.bound) return;
    this.bound = true;
    net.on("arena:info", () => {
      this.infoAt = performance.now();
      this.renderWin();
    });
    net.on("party", () => this.renderWin());
    net.on("arena:top", (m) => {
      this.top[m.mode] = m.rows;
      if (this.tab === "top") this.renderWin();
    });
    net.on("arena:history", (rows) => {
      this.history = rows;
      if (this.tab === "history") this.renderWin();
    });
    net.on("arena:found", (m) => this.showFound(m));
    net.on("arena:cancelled", (m) => {
      this.found.hidden = true;
      this.foundMsg = null;
      this.toast(m.reason, "error");
      net.send("arena:info");
    });
    net.on("party:invite", (m) => this.showInvite(m.from));
    net.on("arena:result", (r) => this.showResult(r));
    net.on("switch", (kind) => {
      this.found.hidden = true;
      this.foundMsg = null;
      if (kind === "world") {
        this.results.hidden = true;
        clearTimeout(this.resultTimer);
        net.send("arena:info");
      } else this.win.hidden = true;
    });
  }

  get isOpen() {
    return !this.win.hidden;
  }
  toggle() {
    if (this.win.hidden) this.open();
    else this.close();
  }
  open() {
    if (this.net.kind === "arena") return this.toast("Окно арены доступно в мире", "error");
    this.win.hidden = false;
    this.net.send("arena:info");
    this.renderWin();
  }
  close(): boolean {
    const was = !this.win.hidden || !this.invite.hidden;
    this.win.hidden = true;
    this.invite.hidden = true;
    return was;
  }

  // ---------- окно арены ----------
  private renderWin() {
    if (this.win.hidden) return;
    const info = this.net.arenaInfo;
    const days = info ? Math.max(0, info.season.endsAt - info.season.now) : 0;
    const left = `${Math.floor(days / 86400000)} дн. ${Math.floor((days % 86400000) / 3600000)} ч.`;
    this.win.innerHTML = `<h2><span>Арена</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="muted">${info ? `Сезон ${info.season.id} · до конца ${left}. В конце сезона — титул, рамка и медальон по рангу, рейтинг частично сбрасывается к 1000.` : "Загрузка…"}</p>
      <div class="tabs" role="tablist">
        <button class="btn small" data-tab="rating" aria-selected="${this.tab === "rating"}">Рейтинг и очередь</button>
        <button class="btn small" data-tab="top" aria-selected="${this.tab === "top"}">Лидеры</button>
        <button class="btn small" data-tab="history" aria-selected="${this.tab === "history"}">История</button>
      </div><div class="body"></div>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    this.win.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => (b.onclick = () => {
      this.tab = b.dataset.tab as typeof this.tab;
      if (this.tab === "top") this.net.send("arena:top", { mode: this.topMode });
      if (this.tab === "history") this.net.send("arena:history");
      this.renderWin();
    }));
    const body = this.win.querySelector<HTMLElement>(".body")!;
    if (!info) return;
    if (this.tab === "rating") this.renderRating(body, info);
    else if (this.tab === "top") this.renderTop(body);
    else this.renderHistory(body);
  }

  private renderRating(body: HTMLElement, info: ArenaInfo) {
    const cards = el("div", "mode-cards");
    for (const mode of ARENA_MODES) {
      const r = info.ratings[mode];
      const card = el("div", "mode-card", `
        <div class="mode-title">${MODE_NAMES[mode]}</div>
        <div class="mode-rating">${r.rating}</div>
        <div>${badge(r.rating)}${r.place ? ` <span class="muted">· ${r.place} место</span>` : ""}</div>
        <div class="muted">Побед ${r.wins} · поражений ${r.losses}${r.draws ? ` · ничьих ${r.draws}` : ""}</div>`);
      const q = info.queue;
      if (q && q.mode === mode) {
        const st = el("div", "queue-status", `<span class="dot"></span> В очереди <b data-wait>${mmss(q.waitedMs)}</b> · окно ±<span data-window>${q.window}</span>${q.withParty ? " · с группой" : ""}`);
        if (q.note) st.append(el("div", "muted", esc(q.note)));
        const cancel = el("button", "btn small", "Выйти из очереди");
        cancel.onclick = () => this.net.send("arena:cancel");
        card.append(st, cancel);
      } else {
        const inParty = (info.party?.members.length ?? 0) > 1;
        const b = el("button", "btn primary", mode === "2v2" && inParty ? "В очередь с группой" : "В очередь");
        b.disabled = !!info.queue || info.pending;
        b.onclick = () => this.net.send("arena:queue", { mode });
        card.append(b);
        if (mode === "2v2") card.append(el("p", "muted", inParty ? "Группа встанет в очередь вместе." : "Одиночек сервер соберёт в пару с близким рейтингом."));
      }
      cards.append(card);
    }
    body.append(cards);

    // группа
    const party = el("div", "arena-section", `<h3>Группа</h3>`);
    const members = info.party?.members ?? [];
    if (members.length) {
      party.append(el("div", "", members.map((m) => `<div>${esc(m.name)} <span class="muted">${clsName(m.cls)} · ур. ${m.level}${m.online ? "" : " · не в сети"}</span></div>`).join("")));
      const leave = el("button", "btn small", "Покинуть группу");
      leave.onclick = () => this.net.send("party:leave");
      party.append(leave);
    } else {
      const row = el("div", "invite-row");
      const input = el("input");
      input.placeholder = "Имя игрока";
      input.maxLength = 16;
      input.id = "party-invite-name";
      const go = el("button", "btn small", "Пригласить");
      const send = () => { if (input.value.trim()) this.net.send("party:invite", { name: input.value.trim() }); input.value = ""; };
      go.onclick = send;
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") send(); });
      row.append(input, go);
      party.append(el("p", "muted", "Для 2×2 пригласите напарника: он должен быть в мире."), row);
    }
    body.append(party);

    // титулы
    const titles = el("div", "arena-section", `<h3>Титул и рамка</h3>`);
    if (!info.titles.length) titles.append(el("p", "muted", "Титулы выдаются в конце сезона по рангу: " + RANKS.map((r) => `<span style="color:${r.color}">${r.title}</span>`).join(", ") + "."));
    else {
      const list = el("div", "title-list");
      for (const t of ["", ...info.titles]) {
        const b = el("button", "btn small", t ? esc(t) : "Без титула");
        b.setAttribute("aria-pressed", String(info.title === t));
        b.onclick = () => this.net.send("arena:title", { name: t });
        list.append(b);
      }
      titles.append(list);
    }
    body.append(titles);
  }

  private renderTop(body: HTMLElement) {
    const sw = el("div", "tabs");
    for (const mode of ARENA_MODES) {
      const b = el("button", "btn small", MODE_NAMES[mode]);
      b.setAttribute("aria-selected", String(this.topMode === mode));
      b.onclick = () => { this.topMode = mode; this.net.send("arena:top", { mode }); this.renderWin(); };
      sw.append(b);
    }
    body.append(sw);
    const rows = this.top[this.topMode];
    if (!rows) return void body.append(el("p", "muted", "Загрузка…"));
    if (!rows.length) return void body.append(el("p", "muted", "В этом сезоне ещё никто не сыграл. Станьте первым!"));
    const me = this.net.self?.name;
    body.append(el("div", "table-wrap", `<table class="arena-table"><thead><tr><th>#</th><th>Герой</th><th>Класс</th><th>Рейтинг</th><th>Ранг</th><th>П–П</th></tr></thead><tbody>${rows
      .map((r) => `<tr class="${r.name === me ? "me" : ""}"><td>${r.place}</td><td>${esc(r.name)}</td><td>${clsName(r.cls)}</td><td class="num">${r.rating}</td><td>${badge(r.rating)}</td><td class="num">${r.wins}–${r.losses}</td></tr>`)
      .join("")}</tbody></table>`));
  }

  private renderHistory(body: HTMLElement) {
    const rows = this.history;
    if (!rows) return void body.append(el("p", "muted", "Загрузка…"));
    if (!rows.length) return void body.append(el("p", "muted", "Вы ещё не сражались на арене."));
    const res = { win: "Победа", loss: "Поражение", draw: "Ничья" };
    body.append(el("div", "table-wrap", `<table class="arena-table"><thead><tr><th>Когда</th><th>Режим</th><th>Итог</th><th>Рейтинг</th><th>Соперники</th><th>Урон</th><th>Лечение</th></tr></thead><tbody>${rows
      .map((r) => `<tr><td>${new Date(r.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${MODE_NAMES[r.mode]}</td><td class="res-${r.result}">${res[r.result]}</td><td class="num">${r.rating} <span class="${r.delta >= 0 ? "up" : "down"}">${r.delta >= 0 ? "+" : ""}${r.delta}</span></td><td>${esc(r.enemies.join(", "))}${r.allies.length ? `<br><span class="muted">с ${esc(r.allies.join(", "))}</span>` : ""}</td><td class="num">${r.damage}</td><td class="num">${r.healing}</td></tr>`)
      .join("")}</tbody></table>`));
  }

  // ---------- всплывающие окна ----------
  private showFound(m: MatchFoundMsg) {
    const first = !this.foundMsg;
    this.foundMsg = m;
    if (first) {
      this.foundAt = performance.now() - (ACCEPT_MS - m.ms);
      this.acceptedSelf = false;
    }
    const me = this.net.self?.name ?? "";
    const total = m.teams.flat().length;
    this.found.hidden = false;
    this.found.innerHTML = `<div class="panel arena-dialog" role="alertdialog" aria-labelledby="found-title">
      <h2 id="found-title">${m.bot ? "Сразиться с ботом?" : "Матч найден"} · ${MODE_NAMES[m.mode]}</h2>${m.bot ? '<p class="muted">Соперник не найден. Бой с ботом не влияет на рейтинг</p>' : ""}
      <div class="versus">${m.teams.map((t) => `<div class="team">${t.map((p) => `<div class="${p.name === me ? "me" : ""}">${esc(p.name)} <span class="muted">${clsName(p.cls)} · ${p.rating}</span>${m.accepted.includes(p.name) ? ' <span class="ok">✓</span>' : ""}</div>`).join("")}</div>`).join('<div class="vs">VS</div>')}</div>
      <div class="bar accept"><i data-accept></i></div>
      <div class="row-btns">${this.acceptedSelf
        ? `<p class="muted">Ждём остальных: ${m.accepted.length}/${total}</p>`
        : `<button class="btn primary" data-a="1">Принять</button><button class="btn" data-a="0">Отклонить</button>`}</div></div>`;
    this.found.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => {
      if (b.dataset.a === "1") {
        this.acceptedSelf = true;
        this.net.send("arena:accept");
        this.showFound(this.foundMsg!);
      } else this.net.send("arena:decline");
    }));
  }

  private showInvite(from: string) {
    this.invite.hidden = false;
    this.invite.innerHTML = `<div class="panel arena-dialog small" role="alertdialog"><h2>Приглашение в группу</h2><p>${esc(from)} приглашает вас в группу.</p>
      <div class="row-btns"><button class="btn primary" data-a="1">Принять</button><button class="btn" data-a="0">Отказаться</button></div></div>`;
    this.invite.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => {
      this.net.send("party:respond", { accept: b.dataset.a === "1" });
      this.invite.hidden = true;
    }));
  }

  private showResult(r: ArenaResultMsg) {
    const me = r.players.find((p) => p.name === this.net.self?.name);
    const title = !me ? "Матч окончен" : me.draw ? "Ничья" : me.won ? "Победа!" : "Поражение";
    const reason = r.reason === "time" ? "Время вышло: решил суммарный процент здоровья" : r.reason === "leave" ? "Соперник покинул бой" : "Все противники повержены";
    const delta = me ? me.ratingAfter - me.ratingBefore : 0;
    this.results.hidden = false;
    this.results.innerHTML = `<div class="panel arena-dialog wide" role="dialog" aria-labelledby="res-title">
      <h2 id="res-title" class="${me?.won ? "res-win" : me?.draw ? "res-draw" : "res-loss"}">${title}</h2>
      <p class="muted">${MODE_NAMES[r.mode]} · ${reason} · ${mmss(r.durationMs)}</p>
      ${r.bot ? `<p class="delta muted">Бой с ботом — рейтинг не изменился</p>` : me ? `<p class="delta">Рейтинг: ${me.ratingBefore} → <b>${me.ratingAfter}</b> <span class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta}</span> ${badge(me.ratingAfter)}</p>` : ""}
      <div class="table-wrap"><table class="arena-table"><thead><tr><th>Герой</th><th>Класс</th><th>Урон</th><th>Лечение</th><th>Убийства</th><th>Рейтинг</th></tr></thead><tbody>
      ${[1, 2].map((t) => r.players.filter((p) => p.team === t).map((p) => `<tr class="team${t} ${p.name === me?.name ? "me" : ""}"><td>${esc(p.name)}${p.left ? ' <span class="down">вышел</span>' : ""}</td><td>${clsName(p.cls)}</td><td class="num">${p.damage}</td><td class="num">${p.healing}</td><td class="num">${p.kills}/${p.deaths}</td><td class="num">${p.ratingAfter} <span class="${p.ratingAfter >= p.ratingBefore ? "up" : "down"}">${p.ratingAfter >= p.ratingBefore ? "+" : ""}${p.ratingAfter - p.ratingBefore}</span></td></tr>`).join("")).join('<tr class="sep"><td colspan="6"></td></tr>')}
      </tbody></table></div>
      <div class="row-btns"><button class="btn primary" data-home>Вернуться в мир</button></div></div>`;
    const home = this.results.querySelector<HTMLButtonElement>("[data-home]")!;
    home.onclick = () => {
      home.disabled = true;
      home.textContent = "Возвращаемся…";
      this.net.send("arena:leave");
    };
    clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => { if (!this.results.hidden) home.click(); }, 20_000);
  }

  // ---------- каждый кадр ----------
  frame(units: Map<string, { u: UnitState }>) {
    const net = this.net;
    if (!net) return;
    // таймеры окна и подтверждения
    const info = net.arenaInfo;
    if (info?.queue && !this.win.hidden) {
      const waited = info.queue.waitedMs + (performance.now() - this.infoAt);
      const w = this.win.querySelector("[data-wait]"), win = this.win.querySelector("[data-window]");
      if (w) w.textContent = mmss(waited);
      if (win) win.textContent = String(queueWindow(waited));
    }
    if (this.foundMsg && !this.found.hidden) {
      const left = Math.max(0, ACCEPT_MS - (performance.now() - this.foundAt));
      const bar = this.found.querySelector<HTMLElement>("[data-accept]");
      if (bar) bar.style.width = `${(left / ACCEPT_MS) * 100}%`;
    }
    // группа (в мире): напарник и его здоровье
    const party = net.party?.members.filter((m) => m.name !== net.self?.name) ?? [];
    this.partyBox.hidden = net.kind !== "world" || !party.length;
    if (!this.partyBox.hidden) {
      this.partyBox.innerHTML = party.map((m) => {
        let hp = -1;
        for (const v of units.values()) if (v.u.kind === UnitKind.Player && v.u.name === m.name) hp = v.u.hp / Math.max(1, v.u.maxHp);
        return `<div class="pm"><span>${esc(m.name)} <span class="muted">ур. ${m.level}</span></span>${hp >= 0 ? `<div class="bar hp mini"><i style="width:${hp * 100}%"></i></div>` : `<span class="muted">${m.online ? "далеко" : "не в сети"}</span>`}</div>`;
      }).join("");
    }
    // табло матча
    const inArena = net.kind === "arena" && !!net.arena;
    this.board.hidden = !inArena;
    if (!inArena) {
      this.countdown.hidden = true;
      return;
    }
    const st = net.room.state as { phase: string; countdown: number; timeLeft: number };
    const myTeam = net.arena!.team;
    const teamUnits = (t: number) => [...units.values()].map((v) => v.u).filter((u) => u.kind === UnitKind.Player && u.team === t);
    const row = (u: UnitState) => `<div class="pl"><span>${esc(u.name)}</span><div class="bar hp mini"><i style="width:${(Math.max(0, u.hp) / Math.max(1, u.maxHp)) * 100}%"></i></div></div>`;
    const names = (t: number) => net.arena!.teams[t - 1].map((p) => {
      const u = teamUnits(t).find((x) => x.name === p.name);
      return u ? row(u) : `<div class="pl gone"><span>${esc(p.name)}</span><span class="down">нет</span></div>`;
    }).join("");
    const timer = st.phase === "fight" || st.phase === "end" ? mmss(st.timeLeft * 1000) : st.phase === "countdown" ? "старт" : "ждём игроков";
    this.board.innerHTML = `<div class="side ally">${names(myTeam)}</div><div class="mid"><div class="mode">${MODE_NAMES[net.arena!.mode]}</div><div class="time">${timer}</div></div><div class="side enemy">${names(myTeam === 1 ? 2 : 1)}</div>`;
    // отсчёт
    if (st.phase === "countdown") {
      this.countdown.hidden = false;
      this.countdown.textContent = String(st.countdown || "");
    } else if (st.phase === "fight" && this.lastPhase === "countdown") {
      this.countdown.hidden = false;
      this.countdown.textContent = "В бой!";
      setTimeout(() => (this.countdown.hidden = true), 900);
    } else if (st.phase !== "fight") this.countdown.hidden = st.phase !== "waiting";
    if (st.phase === "waiting") this.countdown.textContent = "…";
    this.lastPhase = st.phase;
  }
}

export { rankById };
