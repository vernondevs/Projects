/** Обрыв связи и переподключение, двойной вход, ожидание героя в мире. Запуск: TEST_PORT=2691 npx tsx tests/reconnect.ts */
import { KICK_CODE, KICK_TEXT } from "../shared/accounts";
import { assert, Bot, check, ensureChar, passedCount, sleep, startServer, stopServer } from "./harness";

const WAIT_SEC = 5; // укороченное окно переподключения (в игре RECONNECT_SEC = 30)

type R = Bot & { trade: any; req: any; kicked: string };
function extra(b: Bot): R {
  const r = b as R;
  r.trade = null;
  r.req = null;
  r.kicked = "";
  r.room.onMessage("trade:state", (m) => (r.trade = m));
  r.room.onMessage("trade:request", (m) => (r.req = m));
  r.room.onMessage("kicked", (m) => (r.kicked = m.text));
  return r;
}
async function join(name: string) {
  return extra(await Bot.join(name, "secret"));
}
/** Обрыв сокета без согласованного выхода (как пропавшая сеть). */
async function drop(b: Bot) {
  (b.room as any).connection.close();
  await sleep(400);
}
/** Переподключение по токену комнаты. */
async function rejoin(b: R) {
  const token = b.room.reconnectionToken;
  b.self = null;
  b.welcome = null;
  b.attach(await b.client.reconnect(token));
  extra(b);
  await b.until(() => !!b.welcome && !!b.self, 4000, "welcome после переподключения");
}
const seen = (obs: Bot, name: string) => {
  let found = false;
  obs.room.state.players.forEach((u: any) => { if (u.name === name) found = true; });
  return found;
};
const inv = (b: Bot) => b.self!.inventory;
const idxOf = (b: Bot, base: string) => inv(b).findIndex((it) => it?.base === base);
const count = (b: Bot, base: string) => inv(b).reduce((s, it) => s + (it?.base === base ? it.qty ?? 1 : 0), 0);

async function main() {
  console.log("Запуск тестового сервера…");
  await startServer(true, { RECONNECT_SEC: String(WAIT_SEC), ARENA_MATCH_MS: "60000", ARENA_BOT_WAIT_MS: "1000" });
  try {
    console.log("Переподключение");
    const a = await join("Странник");
    const b = await join("Свидетель");
    await a.until(() => a.room.state.players.size >= 2, 2000, "видят друг друга");

    await check("обрыв в бою → переподключение: то же место, те же HP, герой не пропадал", async () => {
      a.send("dbg", { op: "hp", v: 37 });
      a.send("dbg", { op: "fight" });
      await sleep(300);
      const me = a.me(), x = me.x, y = me.y, hp = me.hp, id = a.id;
      await drop(a);
      assert(seen(b, "Странник"), "герой пропал у других сразу после обрыва");
      await sleep(1000);
      assert(seen(b, "Странник"), "герой пропал у других в окне ожидания");
      await rejoin(a);
      assert(a.welcome.resumed === true && a.id === id, "не то же подключение");
      const u = a.me();
      assert(Math.abs(u.x - x) < 1 && Math.abs(u.y - y) < 1, `позиция ${u.x},${u.y} ≠ ${x},${y}`);
      assert(u.hp >= hp && u.hp < Math.min(u.maxHp, hp + 40), `HP ${u.hp} (было ${hp}, макс ${u.maxHp}) — сброшено`);
      a.send("dbg", { op: "calm" });
      a.send("dbg", { op: "hp", v: 99999 });
      // после переподключения управление работает
      const x0 = a.me().x;
      a.send("input", { mx: 1, my: 0 });
      await sleep(400);
      a.send("input", { mx: 0, my: 0 });
      await a.until(() => a.me().x > x0 + 20, 1500, "движение после переподключения");
    });

    await check("обрыв во время обмена: обмен отменён, вещи на месте", async () => {
      a.send("dbg", { op: "tp", x: b.me().x + 20, y: b.me().y });
      a.send("dbg", { op: "item", base: "sword", ilvl: 3, rarity: 1 });
      await a.until(() => idxOf(a, "sword") >= 0, 2000, "меч у A");
      const swordsA = count(a, "sword"), swordsB = count(b, "sword");
      b.req = null;
      a.send("trade:request", { id: b.id });
      await b.until(() => !!b.req, 2000, "запрос обмена");
      b.send("trade:respond", { accept: true });
      await a.until(() => !!a.trade && !!b.trade, 2000, "окно обмена");
      a.send("trade:add", { index: idxOf(a, "sword") });
      await b.until(() => b.trade?.theirs.items.some((x: any) => x), 2000, "меч в окне");
      const toasts = b.toasts.length;
      await drop(a);
      await b.until(() => b.trade === null, 2000, "обмен отменён у второго");
      assert(b.toasts.slice(toasts).some((t) => t.includes("отменён")), "нет сообщения об отмене");
      await rejoin(a);
      assert(count(a, "sword") === swordsA && count(b, "sword") === swordsB, "вещь пропала или раздвоилась");
    });

    await check("вход с другой вкладки: старая сессия закрыта с сообщением", async () => {
      const x = a.me().x;
      const a2 = extra(await Bot.enter(a.token, "Странник"));
      await a.until(() => a.closeCode === KICK_CODE, 2000, "код вытеснения");
      assert(a.kicked === KICK_TEXT, "сообщение: " + a.kicked);
      assert(Math.abs(a2.me().x - x) < 2, "новая сессия не на том же месте");
      await b.until(() => { let n = 0; b.room.state.players.forEach((u: any) => { if (u.name === "Странник") n++; }); return n === 1; }, 2000, "один герой в мире");
      // другой герой того же аккаунта тоже вытесняет
      const tok = await ensureChar("Странник", "secret", "Странник2", "mage");
      const a3 = extra(await Bot.enter(tok, "Странник2"));
      await a2.until(() => a2.closeCode === KICK_CODE, 2000, "вытеснение другим героем аккаунта");
      await a3.leave();
    });

    await check("после окна ожидания герой уходит из мира, сохранение записано", async () => {
      const c = await join("Пропавший");
      await b.until(() => seen(b, "Пропавший"), 2000, "виден");
      c.send("dbg", { op: "tp", x: b.me().x + 40, y: b.me().y + 10 });
      c.send("dbg", { op: "gold", v: 77 });
      await sleep(300);
      const x = c.me().x, y = c.me().y, gold = c.self!.gold;
      await drop(c);
      assert(seen(b, "Пропавший"), "ушёл раньше времени");
      await b.until(() => !seen(b, "Пропавший"), (WAIT_SEC + 3) * 1000, "герой исчез после окна");
      // переподключение по старому токену уже невозможно, обычный вход — с сохранённого места
      let err = "";
      try { await c.client.reconnect(c.room.reconnectionToken); } catch (e) { err = String((e as Error).message); }
      assert(err, "переподключение после окна прошло");
      const c2 = await Bot.join("Пропавший", "secret");
      assert(Math.abs(c2.me().x - x) < 2 && Math.abs(c2.me().y - y) < 2, "позиция не сохранилась");
      assert(c2.self!.gold === gold, `золото не сохранилось: ${c2.self!.gold} ≠ ${gold}`);
      await c2.leave();
    });

    await check("обрыв на арене: возвращение в матч", async () => {
      const L = await join("Гладиатор");
      L.send("arena:queue", { mode: "1v1" });
      await L.until(() => !!L.found, 6000, "предложение боя с ботом");
      L.send("arena:accept");
      await L.until(() => !!L.go, 6000, "переход на арену");
      await L.switchTo(L.go.reservation);
      extra(L);
      assert(L.welcome.arena === true, "не на арене");
      await L.until(() => L.room.state.phase === "fight", 9000, "начало боя");
      await drop(L);
      await rejoin(L);
      assert(L.welcome.arena === true && L.room.state.phase === "fight", "не вернулся в бой");
      assert(!L.result, "матч засчитан как уход");
      L.send("arena:leave");
    });

    await b.leave();
    console.log(`\nВсе проверки пройдены: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
