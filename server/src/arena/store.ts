/** Данные арены в общей базе SQLite: сезоны, рейтинги, матчи, история, награды. */
import type { DatabaseSync } from "node:sqlite";
import type { ClassId } from "../../../shared/classes";
import {
  HISTORY_SIZE, LEADERBOARD_SIZE, MAX_REPEAT, rankOf, SEASON_DAYS, SEASON_RESET_KEEP, START_RATING,
  type ArenaMode, type HistoryRow, type LeaderRow,
} from "../../../shared/arena";

export interface Season {
  id: number;
  started: number;
  ends: number;
}
export interface RatingRow {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}
export interface MatchRecord {
  mode: ArenaMode;
  season: number;
  started: number;
  durationMs: number;
  winner: number;
  reason: string;
  players: {
    nameKey: string;
    name: string;
    cls: ClassId;
    team: number;
    result: "win" | "loss" | "draw";
    ratingBefore: number;
    ratingAfter: number;
    damage: number;
    healing: number;
    kills: number;
    deaths: number;
    left: boolean;
  }[];
}
export interface PendingReward {
  id: number;
  season: number;
  mode: ArenaMode;
  rank: string;
  rating: number;
}

const DAY = 24 * 3600 * 1000;

export class ArenaStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS arena_seasons (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        started INTEGER NOT NULL,
        ends    INTEGER NOT NULL,
        closed  INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS arena_ratings (
        season   INTEGER NOT NULL,
        mode     TEXT NOT NULL,
        name_key TEXT NOT NULL,
        name     TEXT NOT NULL,
        cls      TEXT NOT NULL,
        rating   INTEGER NOT NULL,
        wins     INTEGER NOT NULL DEFAULT 0,
        losses   INTEGER NOT NULL DEFAULT 0,
        draws    INTEGER NOT NULL DEFAULT 0,
        updated  INTEGER NOT NULL,
        PRIMARY KEY (season, mode, name_key)
      );
      CREATE INDEX IF NOT EXISTS arena_ratings_top ON arena_ratings (season, mode, rating DESC);
      CREATE TABLE IF NOT EXISTS arena_matches (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        season   INTEGER NOT NULL,
        mode     TEXT NOT NULL,
        started  INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        winner   INTEGER NOT NULL,
        reason   TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arena_match_players (
        match_id      INTEGER NOT NULL,
        name_key      TEXT NOT NULL,
        name          TEXT NOT NULL,
        cls           TEXT NOT NULL,
        team          INTEGER NOT NULL,
        result        TEXT NOT NULL,
        rating_before INTEGER NOT NULL,
        rating_after  INTEGER NOT NULL,
        damage        INTEGER NOT NULL,
        healing       INTEGER NOT NULL,
        kills         INTEGER NOT NULL,
        deaths        INTEGER NOT NULL,
        left_early    INTEGER NOT NULL,
        PRIMARY KEY (match_id, name_key)
      );
      CREATE INDEX IF NOT EXISTS arena_mp_player ON arena_match_players (name_key, match_id DESC);
      CREATE TABLE IF NOT EXISTS arena_rewards (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name_key  TEXT NOT NULL,
        season    INTEGER NOT NULL,
        mode      TEXT NOT NULL,
        rank      TEXT NOT NULL,
        rating    INTEGER NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        created   INTEGER NOT NULL
      );
    `);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---------- сезоны ----------
  season(): Season {
    const s = this.db.prepare("SELECT id, started, ends FROM arena_seasons WHERE closed = 0 ORDER BY id DESC LIMIT 1").get() as Season | undefined;
    if (s) return s;
    const now = Date.now();
    const r = this.db.prepare("INSERT INTO arena_seasons (started, ends) VALUES (?, ?)").run(now, now + SEASON_DAYS * DAY);
    return { id: Number(r.lastInsertRowid), started: now, ends: now + SEASON_DAYS * DAY };
  }

  /**
   * Закрывает сезон, если он закончился (или принудительно): выдаёт награды по рангу
   * всем, кто сыграл хотя бы один матч, и переносит рейтинги в новый сезон с мягким сбросом к 1000.
   * Возвращает номер закрытого сезона или null.
   */
  closeSeasonIfDue(now = Date.now(), force = false): number | null {
    const s = this.season();
    if (!force && now < s.ends) return null;
    return this.tx(() => {
      const rows = this.db.prepare("SELECT mode, name_key, name, cls, rating, wins, losses, draws FROM arena_ratings WHERE season = ?").all(s.id) as {
        mode: ArenaMode; name_key: string; name: string; cls: string; rating: number; wins: number; losses: number; draws: number;
      }[];
      this.db.prepare("UPDATE arena_seasons SET closed = 1, ends = ? WHERE id = ?").run(Math.min(now, s.ends), s.id);
      const next = this.db.prepare("INSERT INTO arena_seasons (started, ends) VALUES (?, ?)").run(now, now + SEASON_DAYS * DAY);
      const nextId = Number(next.lastInsertRowid);
      const reward = this.db.prepare("INSERT INTO arena_rewards (name_key, season, mode, rank, rating, created) VALUES (?, ?, ?, ?, ?, ?)");
      const carry = this.db.prepare("INSERT INTO arena_ratings (season, mode, name_key, name, cls, rating, updated) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const r of rows) {
        if (r.wins + r.losses + r.draws > 0) reward.run(r.name_key, s.id, r.mode, rankOf(r.rating).id, r.rating, now);
        const reset = Math.round(START_RATING + (r.rating - START_RATING) * SEASON_RESET_KEEP);
        carry.run(nextId, r.mode, r.name_key, r.name, r.cls, reset, now);
      }
      return s.id;
    });
  }

  // ---------- рейтинги ----------
  rating(nameKey: string, mode: ArenaMode, season = this.season().id): RatingRow {
    const r = this.db.prepare("SELECT rating, wins, losses, draws FROM arena_ratings WHERE season = ? AND mode = ? AND name_key = ?").get(season, mode, nameKey) as RatingRow | undefined;
    return r ?? { rating: START_RATING, wins: 0, losses: 0, draws: 0 };
  }
  place(nameKey: string, mode: ArenaMode, season = this.season().id): number | null {
    const me = this.db.prepare("SELECT rating, wins, losses, draws FROM arena_ratings WHERE season = ? AND mode = ? AND name_key = ?").get(season, mode, nameKey) as RatingRow | undefined;
    if (!me || me.wins + me.losses + me.draws === 0) return null;
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM arena_ratings WHERE season = ? AND mode = ? AND (wins + losses + draws) > 0 AND rating > ?").get(season, mode, me.rating) as { n: number };
    return r.n + 1;
  }
  top(mode: ArenaMode, limit = LEADERBOARD_SIZE): LeaderRow[] {
    const rows = this.db
      .prepare("SELECT name, cls, rating, wins, losses FROM arena_ratings WHERE season = ? AND mode = ? AND (wins + losses + draws) > 0 ORDER BY rating DESC, wins DESC, updated ASC LIMIT ?")
      .all(this.season().id, mode, limit) as Omit<LeaderRow, "place">[];
    return rows.map((r, i) => ({ ...r, place: i + 1 }));
  }

  // ---------- матчи ----------
  recordMatch(m: MatchRecord): number {
    return this.tx(() => {
      const r = this.db.prepare("INSERT INTO arena_matches (season, mode, started, duration, winner, reason) VALUES (?, ?, ?, ?, ?, ?)").run(m.season, m.mode, m.started, Math.round(m.durationMs), m.winner, m.reason);
      const id = Number(r.lastInsertRowid);
      const ins = this.db.prepare(
        "INSERT INTO arena_match_players (match_id, name_key, name, cls, team, result, rating_before, rating_after, damage, healing, kills, deaths, left_early) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const up = this.db.prepare(`
        INSERT INTO arena_ratings (season, mode, name_key, name, cls, rating, wins, losses, draws, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (season, mode, name_key) DO UPDATE SET
          rating = excluded.rating, name = excluded.name, cls = excluded.cls,
          wins = wins + excluded.wins, losses = losses + excluded.losses, draws = draws + excluded.draws, updated = excluded.updated`);
      const now = Date.now();
      for (const p of m.players) {
        ins.run(id, p.nameKey, p.name, p.cls, p.team, p.result, p.ratingBefore, p.ratingAfter, Math.round(p.damage), Math.round(p.healing), p.kills, p.deaths, p.left ? 1 : 0);
        up.run(m.season, m.mode, p.nameKey, p.name, p.cls, p.ratingAfter, p.result === "win" ? 1 : 0, p.result === "loss" ? 1 : 0, p.result === "draw" ? 1 : 0, now);
      }
      return id;
    });
  }

  /** Сколько последних матчей подряд (в этом режиме) игрок x провёл против игрока y. */
  repeatCount(x: string, y: string, mode: ArenaMode): number {
    const last = this.db
      .prepare("SELECT mp.match_id AS id, mp.team AS team FROM arena_match_players mp JOIN arena_matches m ON m.id = mp.match_id WHERE mp.name_key = ? AND m.mode = ? ORDER BY mp.match_id DESC LIMIT ?")
      .all(x, mode, MAX_REPEAT) as { id: number; team: number }[];
    const vs = this.db.prepare("SELECT 1 AS ok FROM arena_match_players WHERE match_id = ? AND name_key = ? AND team != ?");
    let n = 0;
    for (const m of last) {
      if (!vs.get(m.id, y, m.team)) break;
      n++;
    }
    return n;
  }

  history(nameKey: string, limit = HISTORY_SIZE): HistoryRow[] {
    const rows = this.db
      .prepare(`SELECT m.id, m.mode, m.started, m.duration, mp.team, mp.result, mp.rating_before, mp.rating_after, mp.damage, mp.healing
                FROM arena_match_players mp JOIN arena_matches m ON m.id = mp.match_id
                WHERE mp.name_key = ? ORDER BY m.id DESC LIMIT ?`)
      .all(nameKey, limit) as { id: number; mode: ArenaMode; started: number; duration: number; team: number; result: HistoryRow["result"]; rating_before: number; rating_after: number; damage: number; healing: number }[];
    const others = this.db.prepare("SELECT name, team FROM arena_match_players WHERE match_id = ? AND name_key != ?");
    return rows.map((r) => {
      const ps = others.all(r.id, nameKey) as { name: string; team: number }[];
      return {
        id: r.id,
        mode: r.mode,
        at: r.started,
        result: r.result,
        delta: r.rating_after - r.rating_before,
        rating: r.rating_after,
        allies: ps.filter((p) => p.team === r.team).map((p) => p.name),
        enemies: ps.filter((p) => p.team !== r.team).map((p) => p.name),
        damage: r.damage,
        healing: r.healing,
        durationMs: r.duration,
      };
    });
  }

  /** Только для тестов: выставить рейтинг напрямую. */
  setRating(nameKey: string, name: string, cls: string, mode: ArenaMode, rating: number) {
    this.db
      .prepare(`INSERT INTO arena_ratings (season, mode, name_key, name, cls, rating, wins, updated) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT (season, mode, name_key) DO UPDATE SET rating = excluded.rating, wins = MAX(wins, 1)`)
      .run(this.season().id, mode, nameKey, name, cls, Math.round(rating), Date.now());
  }

  // ---------- награды ----------
  pendingRewards(nameKey: string): PendingReward[] {
    return this.db.prepare("SELECT id, season, mode, rank, rating FROM arena_rewards WHERE name_key = ? AND delivered = 0 ORDER BY id").all(nameKey) as unknown as PendingReward[];
  }
  markDelivered(id: number) {
    this.db.prepare("UPDATE arena_rewards SET delivered = 1 WHERE id = ?").run(id);
  }
}
