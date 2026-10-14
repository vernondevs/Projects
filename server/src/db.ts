/** Хранилище аккаунтов и прогресса: встроенный в Node модуль node:sqlite. */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClassId, Stats } from "../../shared/classes";
import type { Item, Slot } from "../../shared/items";
import type { BankSave } from "../../shared/bank";

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
  /** Маунты: купленные/полученные и выбранный. */
  mounts?: string[];
  mount?: string;
  /** Питомцы: уровень и опыт каждого, выбранный. */
  pets?: Record<string, { level: number; xp: number }>;
  pet?: string;
  /** Банк: вкладки и золото. Хранится в той же строке, что и сумка, — перенос сохраняется одной записью. */
  bank?: BankSave;
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
      CREATE TABLE IF NOT EXISTS admin_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        admin   TEXT NOT NULL,
        action  TEXT NOT NULL,
        target  TEXT NOT NULL,
        details TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS market_demand (
        key        TEXT PRIMARY KEY,
        sold       REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const cols = (this.db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("admin")) this.db.exec("ALTER TABLE players ADD COLUMN admin INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes("banned_until")) this.db.exec("ALTER TABLE players ADD COLUMN banned_until INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes("ban_reason")) this.db.exec("ALTER TABLE players ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''");
  }

  isAdmin(name: string): boolean {
    const r = this.db.prepare("SELECT admin FROM players WHERE name_key = ?").get(GameDB.key(name)) as { admin: number } | undefined;
    return !!r?.admin;
  }
  /** Активный бан или null. */
  banOf(name: string, now = Date.now()): { until: number; reason: string } | null {
    const r = this.db.prepare("SELECT banned_until, ban_reason FROM players WHERE name_key = ?").get(GameDB.key(name)) as { banned_until: number; ban_reason: string } | undefined;
    return r && r.banned_until > now ? { until: r.banned_until, reason: r.ban_reason } : null;
  }
  setBan(name: string, until: number, reason: string): boolean {
    return Number(this.db.prepare("UPDATE players SET banned_until = ?, ban_reason = ? WHERE name_key = ?").run(until, reason, GameDB.key(name)).changes) > 0;
  }
  adminLog(admin: string, action: string, target: string, details: unknown = {}) {
    this.db.prepare("INSERT INTO admin_log (at, admin, action, target, details) VALUES (?, ?, ?, ?, ?)").run(Date.now(), admin, action, target, JSON.stringify(details));
  }
  adminLogRows(name = "", limit = 100) {
    const k = `%${name.trim()}%`;
    return this.db.prepare("SELECT at, admin, action, target, details FROM admin_log WHERE admin LIKE ? OR target LIKE ? ORDER BY id DESC LIMIT ?").all(k, k, limit) as { at: number; admin: string; action: string; target: string; details: string }[];
  }
  tradeLogRows(name = "", limit = 100) {
    const k = `%${name.trim()}%`;
    return this.db.prepare("SELECT at, a, b, a_items, b_items, a_gold, b_gold FROM trade_log WHERE a LIKE ? OR b LIKE ? ORDER BY id DESC LIMIT ?").all(k, k, limit) as { at: number; a: string; b: string; a_items: string; b_items: string; a_gold: number; b_gold: number }[];
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
