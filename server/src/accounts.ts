/**
 * Аккаунты (задача 30): HTTP API входа и управления героями, сессии в памяти.
 * POST /api/login {login, password, create?} → токен; дальше Authorization: Bearer <токен>.
 * WorldRoom.onAuth принимает { token, character } и проверяет, что герой принадлежит аккаунту.
 */
import express from "express";
import { randomBytes } from "node:crypto";
import { MAX_CHARS, normLook, type AccountView, type CharSummary } from "../../shared/accounts";
import { CLASS_IDS, type ClassId } from "../../shared/classes";
import { NAME_RE } from "../../shared/constants";
import { iconFor, SLOTS } from "../../shared/items";
import { MAP_VERSION, ZONES, zoneAtPx, type WorldMap } from "../../shared/map";
import { inArena } from "./arena/registry";
import { GameDB, type CharRow, type PlayerSave } from "./db";

export interface Session {
  accountId: number;
  login: string;
  exp: number;
}

/** Сессия живёт 2 часа с последнего обращения (токен хранится только во вкладке браузера). */
const TTL = 2 * 3600_000;
const sessions = new Map<string, Session>();
/** Только что созданные герои: при первом входе — приветствие. */
export const freshChars = new Set<string>();

export function sessionOf(token: unknown): Session | null {
  if (typeof token !== "string" || !token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  s.exp = Date.now() + TTL;
  return s;
}

function newSession(accountId: number, login: string): string {
  const now = Date.now();
  if (sessions.size > 5000) for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k);
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { accountId, login, exp: now + TTL });
  return token;
}

/** Ограничение частоты: не больше max событий за окно ms на ключ. */
class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private ms: number) {}
  blocked(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms);
    this.hits.set(key, list);
    return list.length >= this.max;
  }
  hit(key: string, now = Date.now()) {
    const list = this.hits.get(key) ?? [];
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.ms)) this.hits.delete(k);
  }
}

export interface AccountDeps {
  db: () => GameDB;
  map: () => WorldMap | null;
  online: (nameKey: string) => boolean;
  newSave: (cls: ClassId) => PlayerSave;
  /** Тесты: без ограничения запросов с одного адреса. */
  test?: boolean;
}

function summary(row: CharRow, map: WorldMap | null): CharSummary {
  let save: Partial<PlayerSave> = {};
  try { save = JSON.parse(row.data); } catch {}
  const onMap = map && save.mapVer === MAP_VERSION && typeof save.x === "number" && typeof save.y === "number";
  const zone = onMap ? ZONES[zoneAtPx(map, save.x!, save.y!)]?.name ?? "" : ZONES[0].name;
  const equip: CharSummary["equip"] = [];
  for (const slot of SLOTS) {
    const it = save.equip?.[slot];
    if (!it) continue;
    try { equip.push({ slot, icon: iconFor(it), rarity: it.rarity, name: it.name }); } catch {}
  }
  const now = Date.now();
  return {
    name: row.name,
    cls: row.cls,
    level: row.level,
    zone,
    look: normLook(save.look),
    equip,
    banned: row.banned_until > now ? `Заблокирован ${row.banned_until > 4e12 ? "навсегда" : "до " + new Date(row.banned_until).toLocaleString("ru-RU")}${row.ban_reason ? ": " + row.ban_reason : ""}` : undefined,
  };
}

export function accountRouter(d: AccountDeps): express.Router {
  const r = express.Router();
  r.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });
  r.use(express.json({ limit: "4kb" }));
  const fail = (res: express.Response, code: number, error: string) => void res.status(code).json({ error });
  const view = (token: string, s: Session): AccountView => ({ token, login: s.login, chars: d.db().charsOf(s.accountId).map((c) => summary(c, d.map())) });
  const auth = (req: express.Request): { token: string; s: Session } | null => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const s = sessionOf(token);
    return s ? { token, s } : null;
  };
  // вход: 20 попыток в минуту с адреса, 5 неверных паролей за 5 минут на логин; регистрация: 5 в час с адреса
  const perIp = new Limiter(20, 60_000), badPass = new Limiter(5, 5 * 60_000), regs = new Limiter(5, 3600_000);
  const ipOf = (req: express.Request) => req.ip || req.socket.remoteAddress || "?";

  r.post("/login", (req, res) => {
    const ip = ipOf(req);
    if (!d.test) {
      if (perIp.blocked(ip)) return fail(res, 429, "Слишком много попыток входа. Подождите минуту");
      perIp.hit(ip);
    }
    const login = typeof req.body?.login === "string" ? req.body.login.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const create = req.body?.create === true;
    if (!NAME_RE.test(login)) return fail(res, 400, "Логин: 3–16 букв (можно кириллицу), цифр или _");
    if (password.length < 4 || password.length > 64) return fail(res, 400, "Пароль: от 4 до 64 символов");
    const db = d.db();
    const lk = GameDB.key(login);
    if (create) {
      if (db.accountExists(login)) return fail(res, 409, "Такой логин уже занят");
      if (!d.test) {
        if (regs.blocked(ip)) return fail(res, 429, "Слишком много новых аккаунтов с вашего адреса. Попробуйте позже");
        regs.hit(ip);
      }
      const id = db.accountCreate(login, password);
      const token = newSession(id, login);
      return void res.json(view(token, sessions.get(token)!));
    }
    if (badPass.blocked(lk)) return fail(res, 429, "Слишком много неверных паролей. Подождите 5 минут");
    const acc = db.accountLogin(login, password);
    if (!acc) return fail(res, 404, "Аккаунт не найден. Нажмите «Создать аккаунт»");
    if (!acc.ok) {
      badPass.hit(lk);
      return fail(res, 403, "Неверный пароль");
    }
    const token = newSession(acc.id, acc.login);
    res.json(view(token, sessions.get(token)!));
  });

  r.get("/chars", (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, "Сессия истекла, войдите снова");
    res.json(view(a.token, a.s));
  });

  r.post("/chars", (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, "Сессия истекла, войдите снова");
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const cls = req.body?.cls as ClassId;
    if (!NAME_RE.test(name)) return fail(res, 400, "Имя: 3–16 букв (можно кириллицу), цифр или _");
    if (!CLASS_IDS.includes(cls)) return fail(res, 400, "Выберите класс");
    const db = d.db();
    if (db.charsOf(a.s.accountId).length >= MAX_CHARS) return fail(res, 400, `Не больше ${MAX_CHARS} героев на аккаунте`);
    if (db.ownerOf(name) !== null) return fail(res, 409, "Это имя уже занято");
    const save = d.newSave(cls);
    save.look = normLook(req.body?.look);
    try {
      db.createChar(a.s.accountId, name, save);
    } catch {
      return fail(res, 409, "Это имя уже занято");
    }
    freshChars.add(GameDB.key(name));
    res.json(view(a.token, a.s));
  });

  r.post("/chars/delete", (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, "Сессия истекла, войдите снова");
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim() : "";
    const db = d.db();
    if (!name || db.ownerOf(name) !== a.s.accountId) return fail(res, 404, "Герой не найден");
    if (GameDB.key(confirm) !== GameDB.key(name)) return fail(res, 400, "Для удаления введите имя героя");
    const key = GameDB.key(name);
    if (d.online(key) || inArena.has(key)) return fail(res, 409, "Герой сейчас в игре");
    db.deleteChar(a.s.accountId, name);
    freshChars.delete(key);
    res.json(view(a.token, a.s));
  });

  r.post("/logout", (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    sessions.delete(token);
    res.json({ ok: true });
  });
  return r;
}
