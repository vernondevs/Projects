/** Хранилище аккаунтов и прогресса: встроенный в Node модуль node:sqlite. */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { classFaction, type ClassId, type FactionId, type Stats } from "../../shared/classes";
import type { Item, Slot } from "../../shared/items";
import type { BankSave } from "../../shared/bank";
import type { QuestSave } from "../../shared/quests";

export interface PlayerSave {
  cls: ClassId;
  /** Фракция (задача 38); в старых сохранениях нет — берётся из класса (Сольгард). */
  faction?: FactionId;
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
  /** Версия карты, на которой сохранена позиция (старые сохранения переносятся к фонтану). */
  mapVer?: number;
  /** Банк: вкладки и золото. Хранится в той же строке, что и сумка, — перенос сохраняется одной записью. */
  bank?: BankSave;
  /** Открытые телепорты (id городов); Эмберхолл открыт всегда. */
  cities?: string[];
  /** Задания городов. */
  quests?: QuestSave;
  /** Внешность: индекс оттенка (shared/accounts LOOKS), выбирается при создании героя. */
  look?: number;
}

export interface CharRow {
  name: string;
  cls: ClassId;
  faction: FactionId;
  level: number;
  data: string;
  banned_until: number;
  ban_reason: string;
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
    // задача 30: аккаунты (до 6 героев), у героя — account_id
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        login_key TEXT NOT NULL UNIQUE,
        login     TEXT NOT NULL,
        salt      TEXT NOT NULL,
        hash      TEXT NOT NULL,
        created   INTEGER NOT NULL
      );
    `);
    const acols = (this.db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map((c) => c.name);
    if (!acols.includes("bank")) this.db.exec("ALTER TABLE accounts ADD COLUMN bank TEXT NOT NULL DEFAULT ''");
    if (!cols.includes("account_id")) this.db.exec("ALTER TABLE players ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0");
    this.db.exec("CREATE INDEX IF NOT EXISTS players_account ON players(account_id)");
    // задача 38: фракции; все прежние герои — Сольгард (классы те же, меняются только названия)
    if (!cols.includes("faction")) this.db.exec("ALTER TABLE players ADD COLUMN faction TEXT NOT NULL DEFAULT 'solgard'");
    this.migrateAccounts(file);
  }

  /** Каждый герой без аккаунта становится аккаунтом: логин = имя героя, тот же пароль. Перед переносом — копия базы. */
  private migrateAccounts(file: string) {
    const rows = this.db.prepare("SELECT name_key, name, salt, hash, created FROM players WHERE account_id = 0 AND hash != ''").all() as { name_key: string; name: string; salt: string; hash: string; created: number }[];
    if (!rows.length) return;
    if (file !== ":memory:") {
      const d = new Date(), z = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
      const bak = path.join(path.dirname(file), `${path.basename(file, ".sqlite")}.backup-${stamp}.sqlite`);
      this.db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
      console.log(`[db] копия базы перед переносом в аккаунты: ${bak}`);
    }
    const ins = this.db.prepare("INSERT INTO accounts (login_key, login, salt, hash, created) VALUES (?, ?, ?, ?, ?)");
    const upd = this.db.prepare("UPDATE players SET account_id = ? WHERE name_key = ?");
    const taken = this.db.prepare("SELECT 1 AS x FROM accounts WHERE login_key = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        let key = r.name_key, login = r.name;
        for (let i = 2; taken.get(key); i++) (key = `${r.name_key}${i}`), (login = `${r.name}${i}`);
        const id = Number(ins.run(key, login, r.salt, r.hash, r.created).lastInsertRowid);
        upd.run(id, r.name_key);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    console.log(`[db] героев перенесено в аккаунты: ${rows.length}`);
  }

  // ---------- аккаунты ----------
  /** Проверка пароля аккаунта. null — аккаунта нет. */
  accountLogin(login: string, password: string): { ok: true; id: number; login: string } | { ok: false } | null {
    const row = this.db.prepare("SELECT id, login, salt, hash FROM accounts WHERE login_key = ?").get(GameDB.key(login)) as { id: number; login: string; salt: string; hash: string } | undefined;
    if (!row) return null;
    const a = Buffer.from(this.hash(password, row.salt), "hex");
    const b = Buffer.from(row.hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    return { ok: true, id: row.id, login: row.login };
  }
  accountExists(login: string): boolean {
    return !!this.db.prepare("SELECT 1 AS x FROM accounts WHERE login_key = ?").get(GameDB.key(login));
  }
  accountCreate(login: string, password: string): number {
    const salt = randomBytes(16).toString("hex");
    return Number(this.db.prepare("INSERT INTO accounts (login_key, login, salt, hash, created) VALUES (?, ?, ?, ?, ?)").run(GameDB.key(login), login.trim(), salt, this.hash(password, salt), Date.now()).lastInsertRowid);
  }
  /** Герои аккаунта в порядке создания. */
  charsOf(accountId: number): CharRow[] {
    return this.db.prepare("SELECT name, cls, faction, level, data, banned_until, ban_reason FROM players WHERE account_id = ? ORDER BY created, rowid").all(accountId) as unknown as CharRow[];
  }
  /** Владелец героя (id аккаунта) или null, если героя нет. */
  ownerOf(name: string): number | null {
    const r = this.db.prepare("SELECT account_id FROM players WHERE name_key = ?").get(GameDB.key(name)) as { account_id: number } | undefined;
    return r ? r.account_id : null;
  }
  createChar(accountId: number, name: string, save: PlayerSave) {
    const now = Date.now();
    this.db
      .prepare("INSERT INTO players (name_key, name, salt, hash, cls, faction, level, data, created, updated, account_id) VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)")
      .run(GameDB.key(name), name.trim(), save.cls, save.faction ?? classFaction(save.cls), save.level, JSON.stringify(save), now, now, accountId);
  }
  /** Удаление героя вместе с его записями арены. */
  deleteChar(accountId: number, name: string): boolean {
    const key = GameDB.key(name);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const n = Number(this.db.prepare("DELETE FROM players WHERE name_key = ? AND account_id = ?").run(key, accountId).changes);
      if (n) for (const t of ["arena_ratings", "arena_rewards"]) {
        try { this.db.prepare(`DELETE FROM ${t} WHERE name_key = ?`).run(key); } catch {}
      }
      this.db.exec("COMMIT");
      return n > 0;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  /** Общий склад аккаунта (ячейки) или null, если его ещё нет. */
  accountBank(accountId: number): (Item | null)[] | null {
    const r = this.db.prepare("SELECT bank FROM accounts WHERE id = ?").get(accountId) as { bank: string } | undefined;
    if (!r?.bank) return null;
    try {
      const v = JSON.parse(r.bank);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  /** Запись общего склада (вызывать в одной транзакции с сохранением героя). */
  saveAccountBank(accountId: number, cells: (Item | null)[]) {
    this.db.prepare("UPDATE accounts SET bank = ? WHERE id = ?").run(JSON.stringify(cells), accountId);
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

  /** Сохранение без проверки пароля (для перехода между комнатами на сервере). */
  load(name: string): PlayerSave | null {
    const row = this.db.prepare("SELECT data FROM players WHERE name_key = ?").get(GameDB.key(name)) as { data: string } | undefined;
    if (!row) return null;
    const save = JSON.parse(row.data) as PlayerSave;
    save.faction ??= classFaction(save.cls);
    return save;
  }

  get raw(): DatabaseSync {
    return this.db;
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
