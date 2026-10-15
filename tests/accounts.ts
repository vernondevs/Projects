/** Аккаунты, экран выбора героя (API) и выход из игры. Запуск: TEST_PORT=2671 npx tsx tests/accounts.ts */
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BANKER, SHARED_TAB } from "../shared/bank";
import { api, assert, Bot, check, dbFile, ensureChar, passedCount, sleep, startServer, stopServer } from "./harness";

/** База «до задачи 30»: таблица players без аккаунтов, пароль у героя. */
function oldDb() {
  for (const f of [dbFile, dbFile + "-wal", dbFile + "-shm"]) fs.rmSync(f, { force: true });
  const dir = path.dirname(dbFile), base = path.basename(dbFile, ".sqlite");
  for (const f of fs.readdirSync(dir)) if (f.startsWith(base + ".backup-")) fs.rmSync(path.join(dir, f), { force: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`CREATE TABLE players (name_key TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, cls TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
  const save = { cls: "mage", level: 7, xp: 0, gold: 123, alloc: { str: 0, agi: 0, int: 0, vit: 0 }, skills: {}, inventory: new Array(20).fill(null),
    equip: { weapon: null, helmet: null, armor: null, boots: null, ring: null, amulet: null }, x: 0, y: 0, hp: -1, mp: -1, kills: 0, bossKills: {} };
  for (const [name, pass] of [["Старожил", "oldpass"], ["Ветеран", "vetpass"]]) {
    const salt = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO players VALUES (?, ?, ?, ?, 'mage', 7, ?, ?, ?)").run(name.toLowerCase(), name, salt, scryptSync(pass, salt, 32).toString("hex"), JSON.stringify(save), Date.now(), Date.now());
  }
  db.close();
}

const msg = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
};

type L = Bot & { waits: number[]; cancels: string[]; bank: any };
async function enter(token: string, name: string): Promise<L> {
  const b = (await Bot.enter(token, name)) as L;
  b.waits = [];
  b.cancels = [];
  b.bank = null;
  b.room.onMessage("logout:wait", (m) => b.waits.push(m.ms));
  b.room.onMessage("logout:cancel", (m) => b.cancels.push(m.reason));
  b.room.onMessage("bank", (m) => (b.bank = m));
  return b;
}

async function main() {
  oldDb();
  await startServer(false);
  try {
    console.log("Аккаунты");
    await check("перенос старых героев: логин = имя, тот же пароль, копия базы", async () => {
      const v = await api("/login", { login: "старожил", password: "oldpass" });
      assert(v.chars.length === 1 && v.chars[0].name === "Старожил" && v.chars[0].cls === "mage" && v.chars[0].level === 7, JSON.stringify(v.chars));
      assert((await msg(api("/login", { login: "Ветеран", password: "nope1" }))).includes("Неверный пароль"), "пароль ветерана");
      const dir = path.dirname(dbFile), base = path.basename(dbFile, ".sqlite");
      assert(fs.readdirSync(dir).some((f) => f.startsWith(base + ".backup-")), "нет копии базы");
      const b = await enter(v.token, "Старожил");
      assert(b.self!.gold === 123 && b.self!.level === 7, "сохранение героя");
      await b.leave();
    });
    await check("повторный запуск: перенос не повторяется", async () => {
      await stopServer();
      await startServer(false);
      const db = new DatabaseSync(dbFile);
      const n = (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
      db.close();
      assert(n === 2, "аккаунтов " + n);
    });

    let tok = "";
    await check("регистрация явная, логин уникален", async () => {
      assert((await msg(api("/login", { login: "Игрок1", password: "secret" }))).includes("не найден"), "вход без аккаунта");
      tok = (await api("/login", { login: "Игрок1", password: "secret", create: true })).token;
      assert(tok.length > 20, "токен");
      assert((await msg(api("/login", { login: "игрок1", password: "x12345", create: true }))).includes("занят"), "дубль логина");
    });
    await check("создание героев: имя, класс, внешность, не больше 6", async () => {
      assert((await msg(api("/chars", { name: "ab", cls: "mage" }, tok))).includes("Имя"), "короткое имя");
      assert((await msg(api("/chars", { name: "Норм", cls: "paladin" }, tok))).includes("класс"), "плохой класс");
      assert((await msg(api("/chars", { name: "Старожил", cls: "mage" }, tok))).includes("занято"), "чужое имя");
      const cls = ["warrior", "mage", "ranger", "healer", "rogue", "warrior"];
      let v: any;
      for (let i = 0; i < 6; i++) v = await api("/chars", { name: `Герой${i + 1}`, cls: cls[i], look: i }, tok);
      assert(v.chars.length === 6 && v.chars[3].cls === "healer" && v.chars[3].look === 3, JSON.stringify(v.chars[3]));
      assert(v.chars[0].zone && Array.isArray(v.chars[0].equip), "зона и снаряжение в карточке");
      assert((await msg(api("/chars", { name: "Седьмой", cls: "mage" }, tok))).includes("Не больше 6"), "седьмой герой");
      assert((await msg(api("/chars", { name: "Герой1", cls: "mage" }, (await api("/login", { login: "старожил", password: "oldpass" })).token))).includes("занято"), "имя занято другим аккаунтом");
    });
    await check("токен: чужой герой и неверный токен отклонены", async () => {
      const other = (await api("/login", { login: "старожил", password: "oldpass" })).token;
      assert((await msg(Bot.enter(other, "Герой1"))).includes("не принадлежит"), "чужой герой");
      assert((await msg(Bot.enter("deadbeef", "Герой1"))).includes("Сессия"), "плохой токен");
      assert((await msg(api("/chars", undefined, "deadbeef"))).includes("Сессия"), "API с плохим токеном");
    });
    await check("внешность доходит до Schema, на аккаунте играет один герой", async () => {
      const a = await enter(tok, "Герой5");
      assert(a.me().look !== 0, "оттенок спрайта");
      assert((await msg(api("/chars/delete", { name: "Герой5", confirm: "Герой5" }, tok))).includes("в игре"), "удаление героя в игре");
      // второй герой аккаунта вытесняет первого (один герой на аккаунт)
      const b2 = await enter(tok, "Герой2");
      await a.until(() => a.closeCode === 4011, 2000, "первый герой вытеснен");
      await b2.leave();
    });
    await check("удаление: подтверждение именем", async () => {
      assert((await msg(api("/chars/delete", { name: "Герой6", confirm: "нет" }, tok))).includes("введите имя"), "без подтверждения");
      const v = await api("/chars/delete", { name: "Герой6", confirm: "герой6" }, tok);
      assert(v.chars.length === 5 && !v.chars.some((c: any) => c.name === "Герой6"), "не удалён");
      await api("/chars", { name: "Герой6", cls: "mage" }, tok);
    });
    await check("общий склад виден всем героям аккаунта", async () => {
      const a = await enter(tok, "Герой1");
      a.send("dbg", { op: "item", base: "ring", ilvl: 3 });
      a.send("dbg", { op: "tp", x: BANKER.x, y: BANKER.y + 30 });
      await sleep(200);
      const idx = a.self!.inventory.findIndex((it: any) => it?.base === "ring");
      assert(idx >= 0, "кольца нет");
      a.send("bank:put", { index: idx, tab: SHARED_TAB });
      await a.until(() => !!a.bank?.shared?.some((x: any) => x?.base === "ring"), 2000, "кольцо на складе");
      await a.leave();
      await sleep(200);
      const b = await enter(tok, "Герой2");
      b.send("dbg", { op: "tp", x: BANKER.x, y: BANKER.y + 30 });
      await sleep(200);
      b.send("bank:open", {});
      await b.until(() => !!b.bank, 2000, "банк");
      const slot = b.bank.shared.findIndex((x: any) => x?.base === "ring");
      assert(slot >= 0, "второй герой не видит склад");
      assert(!b.bank.tabs.flat().some((x: any) => x?.base === "ring"), "кольцо попало в личный банк");
      b.send("bank:take", { tab: SHARED_TAB, slot });
      await b.until(() => b.self!.inventory.some((it: any) => it?.base === "ring") && !b.bank.shared.some(Boolean), 2000, "забрал со склада");
      await b.leave();
    });

    console.log("Выход из игры");
    await check("вне боя — сразу, сервер закрывает соединение", async () => {
      const a = await enter(tok, "Герой3");
      a.send("logout:request", {});
      await a.until(() => a.closeCode === 4010, 2000, "код выхода");
      await sleep(200);
      const b = await enter(tok, "Герой3");
      await b.leave();
    });
    await check("в бою — отсчёт 10 с, урон его прерывает, затем выход", async () => {
      const a = await enter(tok, "Герой4");
      a.send("dbg", { op: "fight" });
      await sleep(100);
      a.send("logout:request", {});
      await a.until(() => a.waits.length === 1, 2000, "logout:wait");
      assert(a.waits[0] === 10000, "отсчёт " + a.waits[0]);
      await sleep(500);
      a.send("dbg", { op: "hurt", v: 3 });
      await a.until(() => a.cancels.length === 1, 2000, "отмена уроном");
      assert(a.cancels[0].includes("урон") && a.closeCode === 0, "отмена: " + a.cancels[0]);
      a.send("dbg", { op: "fight" });
      await sleep(100);
      const t0 = Date.now();
      a.send("logout:request", {});
      await a.until(() => a.closeCode === 4010, 12000, "выход после отсчёта");
      assert(Date.now() - t0 > 9000, "вышел раньше отсчёта");
    });
    await check("частота входа: 5 неверных паролей — пауза", async () => {
      for (let i = 0; i < 5; i++) await msg(api("/login", { login: "Ветеран", password: "wrong" + i }));
      const e = await msg(api("/login", { login: "Ветеран", password: "vetpass" }));
      assert(e.includes("Подождите"), "нет ограничения: " + e);
    });
    await check("ensureChar: аккаунт и герой создаются автоматически", async () => {
      const t = await ensureChar("НовыйБот", "secret", "НовыйБот", "rogue");
      const v = await api("/chars", undefined, t);
      assert(v.chars.length === 1 && v.chars[0].cls === "rogue", "герой бота");
    });
  } finally {
    await stopServer();
  }
  console.log(`\nВсе проверки аккаунтов пройдены: ${passedCount()}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
