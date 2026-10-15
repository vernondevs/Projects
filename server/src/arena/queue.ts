/**
 * Очередь арены и подбор соперников. Всё на сервере:
 *  - окно рейтинга ±100, растёт со временем ожидания (shared/arena.ts → queueWindow);
 *  - в 2×2 сравнивается средний рейтинг команды; одиночки собираются в пары;
 *  - найденный матч надо подтвердить за 15 с, отказ или молчание убирают из очереди;
 *  - одних и тех же соперников нельзя получить больше 3 раз подряд.
 */
import { ACCEPT_MS, MAX_REPEAT, MODE_NAMES, queueWindow, TEAM_SIZE, type ArenaMode, type MatchFoundMsg, type QueueStatus } from "../../../shared/arena";
import type { Player } from "../game/Player";
import type { FactionId } from "../../../shared/classes";
import { enemyFaction } from "../../../shared/factions";
import type { ArenaStore } from "./store";
import { makeBots, type BotSpec } from "./bots";

/** Сколько ждать живого соперника перед предложением боя с ботом; в тестах — ARENA_BOT_WAIT_MS. */
export const botWaitMs = () => Number(process.env.ARENA_BOT_WAIT_MS) || 45_000;

export interface QueueEntry {
  id: number;
  mode: ArenaMode;
  members: string[]; // ключи имён
  ratings: Record<string, number>;
  joinedAt: number;
  /** Фракция записи: напарники из одиночек — только своей фракции. */
  faction?: FactionId;
  /** Бой с ботом уже предлагали — повторно не предлагаем. */
  botOffered?: boolean;
}
export interface PendingMatch {
  id: number;
  mode: ArenaMode;
  teams: QueueEntry[][];
  accepted: Set<string>;
  expiresAt: number;
  /** Матч с ботами: боты по командам (индекс как у teams). */
  bots?: BotSpec[][];
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const entryRating = (e: QueueEntry) => avg(e.members.map((m) => e.ratings[m]));
const teamMembers = (t: QueueEntry[]) => t.flatMap((e) => e.members);
const teamRating = (t: QueueEntry[]) => avg(t.flatMap((e) => e.members.map((m) => e.ratings[m])));
const teamJoined = (t: QueueEntry[]) => Math.min(...t.map((e) => e.joinedAt));

export class ArenaQueue {
  entries: QueueEntry[] = [];
  pending = new Map<number, PendingMatch>();
  private nextId = 1;
  /** Почему игрок пока не получил матч (для подсказки в окне). */
  private notes = new Map<string, string>();

  constructor(
    private store: ArenaStore,
    private find: (key: string) => Player | undefined,
    private start: (m: PendingMatch) => void,
    private changed: (keys: string[]) => void,
  ) {}

  entryOf(key: string) {
    return this.entries.find((e) => e.members.includes(key));
  }
  pendingOf(key: string) {
    for (const p of this.pending.values()) if (p.teams.some((t) => teamMembers(t).includes(key))) return p;
    return undefined;
  }
  busy(key: string) {
    return !!this.entryOf(key) || !!this.pendingOf(key);
  }

  status(key: string, now = Date.now()): QueueStatus | null {
    const e = this.entryOf(key);
    if (!e) return null;
    return { mode: e.mode, waitedMs: now - e.joinedAt, window: queueWindow(now - e.joinedAt), withParty: e.members.length > 1, note: this.notes.get(key) };
  }

  join(players: Player[], mode: ArenaMode, now = Date.now()): string | null {
    if (players.length > TEAM_SIZE[mode]) return `В режиме ${MODE_NAMES[mode]} команда из ${TEAM_SIZE[mode]}`;
    for (const p of players) {
      const k = p.name.toLowerCase();
      if (this.busy(k)) return `${p.name} уже в очереди`;
      if (p.dead) return `${p.name} мёртв`;
    }
    const ratings: Record<string, number> = {};
    for (const p of players) ratings[p.name.toLowerCase()] = this.store.rating(p.name.toLowerCase(), mode).rating;
    if (players.some((p) => p.faction !== players[0].faction)) return "Команда арены — только из одной фракции";
    this.entries.push({ id: this.nextId++, mode, members: players.map((p) => p.name.toLowerCase()), ratings, joinedAt: now, faction: players[0].faction });
    this.changed(players.map((p) => p.name.toLowerCase()));
    return null;
  }

  /** Выход из очереди (вся запись: если в очереди группа — выходит вся группа). */
  cancel(key: string) {
    const e = this.entryOf(key);
    if (!e) return;
    this.entries = this.entries.filter((x) => x !== e);
    for (const m of e.members) this.notes.delete(m);
    this.changed(e.members);
  }

  /** Игрок покинул мир: снимаем с очереди или отклоняем найденный матч. */
  drop(key: string) {
    if (this.pendingOf(key)) this.decline(key, "вышел из игры");
    this.cancel(key);
  }

  accept(key: string) {
    const m = this.pendingOf(key);
    if (!m || m.accepted.has(key)) return;
    m.accepted.add(key);
    const all = m.teams.flatMap(teamMembers);
    this.broadcastFound(m);
    if (all.every((k) => m.accepted.has(k))) {
      this.pending.delete(m.id);
      this.start(m);
    }
  }

  decline(key: string, why = "отклонил матч") {
    const m = this.pendingOf(key);
    if (!m) return;
    this.pending.delete(m.id);
    if (m.bots) {
      for (const t of m.teams) for (const e of t) {
        this.entries.push(e);
        for (const k of e.members) this.find(k)?.send("arena:cancelled", { reason: "Бой с ботом отменён. Продолжаем искать соперников" });
      }
      this.changed(m.teams.flatMap(teamMembers));
      return;
    }
    const declinedEntries = new Set<QueueEntry>();
    for (const t of m.teams) for (const e of t) if (e.members.includes(key)) declinedEntries.add(e);
    const who = this.find(key)?.name ?? key;
    for (const t of m.teams) for (const e of t) {
      if (declinedEntries.has(e)) {
        for (const k of e.members) this.find(k)?.send("arena:cancelled", { reason: k === key ? "Вы отклонили матч и покинули очередь" : `${who} ${why}. Группа покидает очередь` });
      } else {
        // остальные возвращаются в очередь, сохраняя время ожидания
        this.entries.push(e);
        for (const k of e.members) this.find(k)?.send("arena:cancelled", { reason: `${who} ${why}. Вы снова в очереди` });
      }
    }
    this.changed(m.teams.flatMap(teamMembers));
  }

  private broadcastFound(m: PendingMatch) {
    const msg: MatchFoundMsg = {
      mode: m.mode,
      ms: Math.max(0, m.expiresAt - Date.now()),
      teams: m.teams.map((t, ti) => [
        ...teamMembers(t).map((k) => {
          const p = this.find(k);
          const e = t.find((x) => x.members.includes(k))!;
          return { name: p?.name ?? k, cls: p?.cls ?? "warrior", level: p?.level ?? 1, rating: e.ratings[k] };
        }),
        ...(m.bots?.[ti] ?? []).map((b) => ({ name: b.name, cls: b.cls, level: b.level, rating: b.rating })),
      ]),
      bot: !!m.bots,
      accepted: [...m.accepted].map((k) => this.find(k)?.name ?? k),
    };
    for (const k of m.teams.flatMap(teamMembers)) this.find(k)?.send("arena:found", msg);
  }

  /** Можно ли свести две команды: окно по рейтингу и запрет на повтор соперников. */
  private compatible(a: QueueEntry[], b: QueueEntry[], mode: ArenaMode, now: number): "ok" | "rating" | "repeat" {
    const diff = Math.abs(teamRating(a) - teamRating(b));
    const window = Math.max(queueWindow(now - teamJoined(a)), queueWindow(now - teamJoined(b)));
    if (diff > window) return "rating";
    for (const x of teamMembers(a)) for (const y of teamMembers(b)) if (this.store.repeatCount(x, y, mode) >= MAX_REPEAT) return "repeat";
    return "ok";
  }

  tick(now = Date.now()) {
    // просроченные подтверждения
    for (const m of [...this.pending.values()]) {
      if (now < m.expiresAt) continue;
      const silent = m.teams.flatMap(teamMembers).find((k) => !m.accepted.has(k));
      if (silent) this.decline(silent, "не подтвердил матч");
    }
    for (const mode of ["1v1", "2v2"] as ArenaMode[]) this.matchMode(mode, now);
    this.offerBots(now);
  }

  /** Долго нет соперника — предлагаем бой с ботами (без рейтинга). */
  private offerBots(now: number) {
    const wait = botWaitMs();
    for (const e of [...this.entries]) {
      if (e.botOffered || now - e.joinedAt < wait) continue;
      const lead = this.find(e.members[0]);
      if (!lead) continue;
      e.botOffered = true;
      const size = TEAM_SIZE[e.mode];
      const rating = Math.round(entryRating(e));
      const taken = new Set<string>();
      const mates = makeBots(size - e.members.length, lead.level, rating, lead.save, taken, lead.faction);
      const foes = makeBots(size, lead.level, rating, lead.save, taken, enemyFaction(lead.faction));
      const m: PendingMatch = { id: this.nextId++, mode: e.mode, teams: [[e], []], accepted: new Set(), expiresAt: now + ACCEPT_MS, bots: [mates, foes] };
      this.entries = this.entries.filter((x) => x !== e);
      this.pending.set(m.id, m);
      this.broadcastFound(m);
      this.changed(e.members);
    }
  }

  private matchMode(mode: ArenaMode, now: number) {
    const size = TEAM_SIZE[mode];
    const pool = this.entries.filter((e) => e.mode === mode).sort((a, b) => a.joinedAt - b.joinedAt);
    // собираем команды: готовые группы + пары из одиночек с близким рейтингом
    const teams: QueueEntry[][] = [];
    const used = new Set<QueueEntry>();
    for (const e of pool) if (e.members.length === size) { teams.push([e]); used.add(e); }
    const solos = pool.filter((e) => !used.has(e));
    for (const e of solos) {
      if (used.has(e)) continue;
      let best: QueueEntry | null = null, bd = Infinity;
      for (const o of solos) {
        if (o === e || used.has(o) || (o.faction ?? "solgard") !== (e.faction ?? "solgard")) continue;
        const d = Math.abs(entryRating(o) - entryRating(e));
        if (d <= Math.max(queueWindow(now - e.joinedAt), queueWindow(now - o.joinedAt)) && d < bd) { bd = d; best = o; }
      }
      if (best) { teams.push([e, best]); used.add(e); used.add(best); }
    }
    teams.sort((a, b) => teamJoined(a) - teamJoined(b));
    const taken = new Set<QueueEntry[]>();
    for (const a of teams) {
      if (taken.has(a)) continue;
      let best: QueueEntry[] | null = null, bd = Infinity, why: "rating" | "repeat" | null = null;
      for (const b of teams) {
        if (b === a || taken.has(b)) continue;
        const c = this.compatible(a, b, mode, now);
        if (c !== "ok") { if (!why || c === "repeat") why = c; continue; }
        const d = Math.abs(teamRating(a) - teamRating(b));
        if (d < bd) { bd = d; best = b; }
      }
      for (const k of teamMembers(a)) {
        if (why === "repeat" && !best) this.notes.set(k, `Свободные соперники недавно играли с вами ${MAX_REPEAT} раз подряд — ждём других`);
        else this.notes.delete(k);
      }
      if (!best) continue;
      taken.add(a);
      taken.add(best);
      const m: PendingMatch = { id: this.nextId++, mode, teams: [a, best], accepted: new Set(), expiresAt: now + ACCEPT_MS };
      const entries = new Set([...a, ...best]);
      this.entries = this.entries.filter((e) => !entries.has(e));
      this.pending.set(m.id, m);
      this.broadcastFound(m);
      this.changed([...teamMembers(a), ...teamMembers(best)]);
    }
  }
}
