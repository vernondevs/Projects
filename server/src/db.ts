/** Хранилище аккаунтов и прогресса: встроенный в Node модуль node:sqlite. */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClassId, Stats } from "../../shared/classes";
import type { Item, Slot } from "../../shared/items";

export interface PlayerSave {
  cls: ClassId;
  level: number;
  xp: number;
  gold: number;
  alloc: Stats;
  skills: Record<string, number>;
  inventory: (Item | null)[];
  equip: Record<Slot, Item | null>;
  x: number;
  y: number;
  hp: number;
  mp: number;
  kills: number;
  bossKills: Record<string, number>;
  /** Убийства по типам мобов (бестиарий); нет в старых сохранениях. */
  mobKills?: Record<string, number>;
  /** Сезонные награды арены. */
  titles?: { id: string; name: string; rank: string }[];
  title?: string;
  frame?: string;
  /** Активная еда: переживает релог (реальное время, мс). */
  food?: { id: string; until: number } | null;
  /** Настройка: не принимать запросы на обмен. */
}

export class GameDB {
  private db: DatabaseSync;

  constructor(file = process.env.DB_PATH || path.resolve("server/data/game.sqlite")) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        name_key TEXT PRIMARY KEY,
        name     TEXT NOT NULL,
        salt     TEXT NOT NULL,
        hash     TEXT NOT NULL,
        cls      TEXT NOT NULL,
        level    INTEGER NOT NULL DEFAULT 1,
        data     TEXT NOT NULL,
        created  INTEGER NOT NULL,
        updated  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trade_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        a       TEXT NOT NULL,
        b       TEXT NOT NULL,
        a_items TEXT NOT NULL,
        b_items TEXT NOT NULL,
        a_gold  INTEGER NOT NULL,
        b_gold  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS market_demand (
        key        TEXT PRIMARY KEY,
        sold       REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  marketGet(key: string): { sold: number; updated_at: number } | null {
    return (this.db.prepare("SELECT sold, updated_at FROM market_demand WHERE key = ?").get(key) as { sold: number; updated_at: number } | undefined) || null;
  }

  marketSet(key: string, sold: number, at: number) {
    this.db.prepare("INSERT INTO market_demand (key, sold, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET sold = excluded.sold, updated_at = excluded.updated_at").run(key, sold, at);
  }

  static key(name: string) {
    return name.trim().toLowerCase();
  }

  private hash(password: string, salt: string) {
    return scryptSync(password, salt, 32).toString("hex");
  }

  find(name: string): { name: string; cls: ClassId } | null {
    const row = this.db.prepare("SELECT name, cls FROM players WHERE name_key = ?").get(GameDB.key(name)) as { name: string; cls: ClassId } | undefined;
    return row || null;
  }

  /** Проверка пароля. null — аккаунта нет. */
  login(name: string, password: string): { ok: true; name: string; save: PlayerSave } | { ok: false } | null {
    const row = this.db.prepare("SELECT name, salt, hash, data FROM players WHERE name_key = ?").get(GameDB.key(name)) as
      | { name: string; salt: string; hash: string; data: string }
      | undefined;
    if (!row) return null;
    const a = Buffer.from(this.hash(password, row.salt), "hex");
    const b = Buffer.from(row.hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    return { ok: true, name: row.name, save: JSON.parse(row.data) as PlayerSave };
  }

  /** Сохранение без проверки пароля (для перехода между комнатами на сервере). */
  load(name: string): PlayerSave | null {
    const row = this.db.prepare("SELECT data FROM players WHERE name_key = ?").get(GameDB.key(name)) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as PlayerSave) : null;
  }

  get raw(): DatabaseSync {
    return this.db;
  }

  create(name: string, password: string, save: PlayerSave) {
    const salt = randomBytes(16).toString("hex");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO players (name_key, name, salt, hash, cls, level, data, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(GameDB.key(name), name, salt, this.hash(password, salt), save.cls, save.level, JSON.stringify(save), now, now);
  }

  save(name: string, save: PlayerSave) {
    this.db
      .prepare("UPDATE players SET data = ?, level = ?, updated = ? WHERE name_key = ?")
      .run(JSON.stringify(save), save.level, Date.now(), GameDB.key(name));
  }

  top(limit = 10): { name: string; cls: string; level: number }[] {
    return this.db.prepare("SELECT name, cls, level FROM players ORDER BY level DESC, updated ASC LIMIT ?").all(limit) as {
      name: string;
      cls: string;
      level: number;
    }[];
  }

  close() {
    this.db.close();
  }
}
