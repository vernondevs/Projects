/** Проверки PvP-арены ботами: 1×1, 2×2, подтверждение, Elo, история, повторы, таймер, сезоны. Запуск: npm run test:arena */
import { generateMap } from "../shared/map";
import { MAP_SEED } from "../shared/constants";
import { MAX_REPEAT } from "../shared/arena";
import { assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";

const MAP = generateMap(MAP_SEED);
const MATCH_MS = 9000; // укороченный бой для проверки таймера

/** Очередь → матч найден → все принимают → переход на арену. */
async function enterMatch(mode: "1v1" | "2v2", queuers: Bot[], all: Bot[]) {
  for (const b of all) { b.found = null; b.go = null; b.result = null; b.ret = null; }
  for (const b of queuers) b.send("arena:queue", { mode });
  for (const b of all) await b.until(() => !!b.found, 6000, `матч найден (${b.self?.name})`);
  for (const b of all) b.send("arena:accept");
  for (const b of all) await b.until(() => !!b.go, 6000, `переход на арену (${b.self?.name})`);
  await Promise.all(all.map((b) => b.switchTo(b.go.reservation)));
  for (const b of all) assert(b.welcome.arena === true, "не в комнате арены");
}
/** id юнита соперника в комнате арены по имени. */
function unitByName(b: Bot, name: string): string {
  let id = "";
  b.room.state.players.forEach((u: any, k: string) => { if (u.name === name) id = k; });
  assert(id, "нет юнита " + name);
  return id;
}
async function waitFight(b: Bot) {
  await b.until(() => b.room.state.phase === "fight", 9000, "начало боя");
}
async function goHome(bots: Bot[]) {
  for (const b of bots) b.send("arena:leave");
  for (const b of bots) await b.until(() => !!b.ret, 4000, "резервация возврата");
  await Promise.all(bots.map((b) => b.switchTo(b.ret.reservation)));
  for (const b of bots) assert(!b.welcome.arena, "не вернулись в мир");
}
/** Быстрый бой 1×1: сильный убивает слабого. */
async function quickDuel(strong: Bot, weak: Bot) {
  await enterMatch("1v1", [strong, weak], [strong, weak]);
  await waitFight(strong);
  strong.send("target", { id: unitByName(strong, weak.self!.name) });
  await strong.until(() => !!strong.result, 8000, "итог боя");
  await weak.until(() => !!weak.result, 2000, "итог у второго");
  await goHome([strong, weak]);
}

async function main() {
  console.log("Запуск тестового сервера…");
  await startServer(true, { ARENA_MATCH_MS: String(MATCH_MS) });
  try {
    console.log("Арена 1×1");
    const A = await Bot.join("Гладиатор", "pass", "warrior");
    const B = await Bot.join("Ученик", "pass", "mage");
    A.send("dbg", { op: "level", v: 30 });
    A.send("dbg", { op: "item", unique: "ashbringer" });
    await A.until(() => A.self!.level === 30 && A.self!.inventory.some((i) => i?.unique === "ashbringer"), 3000, "прокачка");
    A.send("equip", { index: A.self!.inventory.findIndex((i) => i?.unique === "ashbringer") });
    await A.until(() => A.self!.equip.weapon?.unique === "ashbringer", 2000, "оружие");
    const home = { x: MAP.playerSpawn.x + 64, y: MAP.playerSpawn.y + 32 };
    A.send("dbg", { op: "tp", ...home });
    await sleep(200);

    await check("окно арены: стартовый рейтинг 1000, ранг Бронза", async () => {
      A.send("arena:info");
      await A.until(() => !!A.info, 2000, "arena:info");
      assert(A.info.ratings["1v1"].rating === 1000 && A.info.ratings["2v2"].rating === 1000, "рейтинг не 1000");
      assert(A.info.ratings["1v1"].rank === "bronze", "ранг не бронза");
    });
    await check("подбор, подтверждение и переход на арену", async () => {
      await enterMatch("1v1", [A, B], [A, B]);
      assert(A.found.teams.length === 2 && A.found.teams.flat().length === 2, "состав матча");
      assert(A.room.state.phase === "waiting" || A.room.state.phase === "countdown", "нет отсчёта");
    });
    await check("пока герой на арене, войти им в мир нельзя", async () => {
      let err = "";
      try { await Bot.join("Ученик", "pass"); } catch (e) { err = String((e as Error).message); }
      assert(err.includes("на арене"), "вход не запрещён: " + err);
    });
    await check("отсчёт 5 с: двигаться и бить нельзя, затем бой", async () => {
      await A.until(() => A.room.state.phase === "countdown", 4000, "отсчёт");
      assert(A.room.state.countdown >= 3, "отсчёт " + A.room.state.countdown);
      const x0 = A.me().x;
      A.send("input", { mx: 1, my: 0 });
      await sleep(400);
      A.send("input", { mx: 0, my: 0 });
      assert(Math.abs(A.me().x - x0) < 1, "двигается во время отсчёта");
      await waitFight(A);
      assert(A.me().hp === A.me().maxHp && B.me().hp === B.me().maxHp, "здоровье не восстановлено");
    });
    await check("победа убийством, Elo ±16, экран результатов", async () => {
      A.send("target", { id: unitByName(A, "Ученик") });
      await A.until(() => !!A.result, 8000, "итог");
      const r = A.result;
      assert(r.reason === "kill" && r.winner === 1, "победитель " + JSON.stringify(r));
      const ra = r.players.find((p: any) => p.name === "Гладиатор"), rb = r.players.find((p: any) => p.name === "Ученик");
      assert(ra.won && !rb.won, "результаты");
      assert(ra.ratingAfter === 1016 && rb.ratingAfter === 984, `рейтинг ${ra.ratingAfter}/${rb.ratingAfter}`);
      assert(ra.damage > 0 && ra.kills === 1 && rb.deaths === 1, "статистика урона");
    });
    await check("возврат в мир на прежнее место", async () => {
      await goHome([A, B]);
      assert(Math.hypot(A.me().x - home.x, A.me().y - home.y) < 2, `позиция ${A.me().x},${A.me().y}`);
      A.send("arena:info");
      await A.until(() => A.info?.ratings["1v1"].rating === 1016, 2000, "рейтинг в окне");
    });
    await check("история матчей и таблица лидеров", async () => {
      A.send("arena:history");
      await A.until(() => !!A.history, 2000, "история");
      assert(A.history.length === 1 && A.history[0].result === "win" && A.history[0].delta === 16 && A.history[0].enemies[0] === "Ученик", "история");
      A.send("arena:top", { mode: "1v1" });
      await A.until(() => !!A.top, 2000, "топ");
      assert(A.top.rows[0].name === "Гладиатор" && A.top.rows[1].name === "Ученик", "порядок лидеров");
    });
    await check("отказ от матча: отказавшийся выходит, второй снова в очереди", async () => {
      A.found = B.found = null;
      A.send("arena:queue", { mode: "1v1" });
      B.send("arena:queue", { mode: "1v1" });
      await A.until(() => !!A.found && !!B.found, 6000, "матч");
      A.info = null;
      B.send("arena:decline");
      await A.until(() => A.cancelled.some((c) => c.includes("снова в очереди")), 3000, "уведомление");
      await A.until(() => !!A.info?.queue, 2000, "A в очереди");
      B.send("arena:info");
      await B.until(() => B.info && !B.info.queue && !B.info.pending, 2000, "B вне очереди");
      A.send("arena:cancel");
    });
    await check("одних соперников нельзя получить больше MAX_REPEAT раз подряд", async () => {
      // рейтинг сбрасывается, чтобы серия побед не вывела пару за окно подбора
      for (let i = 1; i < MAX_REPEAT; i++) {
        for (const p of [A, B]) p.send("dbg", { op: "rating", mode: "1v1", v: 1000 });
        await sleep(200);
        await quickDuel(A, B);
      } // всего MAX_REPEAT матчей подряд
      for (const p of [A, B]) p.send("dbg", { op: "rating", mode: "1v1", v: 1000 });
      await sleep(200);
      A.found = B.found = null;
      A.send("arena:queue", { mode: "1v1" });
      B.send("arena:queue", { mode: "1v1" });
      await sleep(3500);
      assert(!A.found && !B.found, `подобрали в ${MAX_REPEAT + 1}-й раз подряд`);
      A.send("arena:info");
      await A.until(() => !!A.info?.queue?.note, 2000, "подсказка о повторе");
      const C = await Bot.join("Новичок", "pass", "ranger");
      C.send("arena:queue", { mode: "1v1" });
      await A.until(() => !!A.found, 6000, "матч с новым соперником");
      const names = A.found.teams.flat().map((p: any) => p.name);
      assert(names.includes("Новичок"), "соперник не новый: " + names);
      for (const b of [A, B, C]) b.send(A.found && names.includes(b.self!.name) ? "arena:decline" : "arena:cancel");
      await sleep(300);
      for (const b of [A, B, C]) b.send("arena:cancel");
      await C.leave();
    });

    console.log("Арена 2×2");
    const P1 = await Bot.join("Щит", "pass", "warrior");
    const P2 = await Bot.join("Посох", "pass", "mage");
    const S1 = await Bot.join("Одиночка", "pass", "ranger");
    const S2 = await Bot.join("Бродяга", "pass", "warrior");
    for (const b of [P1, P2]) b.send("dbg", { op: "level", v: 30 });
    P1.send("dbg", { op: "item", unique: "ashbringer" });
    await P1.until(() => P1.self!.inventory.some((i) => i?.unique === "ashbringer"), 3000, "оружие");
    P1.send("equip", { index: P1.self!.inventory.findIndex((i) => i?.unique === "ashbringer") });
    await sleep(200);
    await check("группа: приглашение и принятие", async () => {
      P1.send("party:invite", { name: "Посох" });
      await P2.until(() => !!P2.partyInvite, 2000, "приглашение");
      P2.send("party:respond", { accept: true });
      await P1.until(() => P1.party?.members?.length === 2, 2000, "группа у P1");
      await P2.until(() => P2.party?.members?.length === 2, 2000, "группа у P2");
    });
    await check("2×2: группа против двух одиночек, средний рейтинг команд", async () => {
      await enterMatch("2v2", [P1, S1, S2], [P1, P2, S1, S2]);
      const teams = P1.found.teams.map((t: any[]) => t.map((p) => p.name).sort().join("+"));
      assert(teams.includes("Посох+Щит") && teams.includes("Бродяга+Одиночка"), "состав команд: " + teams);
      assert(P1.welcome.team === P2.welcome.team && S1.welcome.team === S2.welcome.team && P1.welcome.team !== S1.welcome.team, "команды на арене");
    });
    await check("2×2: выход из боя — поражение, победа после убийства второго", async () => {
      await waitFight(P1);
      await S2.room.leave(true); // отключение во время матча
      await sleep(300);
      P1.send("target", { id: unitByName(P1, "Одиночка") });
      await P1.until(() => !!P1.result, 8000, "итог 2×2");
      const r = P1.result;
      const get = (n: string) => r.players.find((p: any) => p.name === n);
      assert(r.winner === P1.welcome.team, "победила не группа");
      assert(get("Бродяга").left && !get("Бродяга").won && get("Бродяга").ratingAfter < 1000, "выход не засчитан поражением");
      assert(get("Щит").won && get("Посох").won && get("Щит").ratingAfter === 1016, "рейтинг победителей " + get("Щит").ratingAfter);
      assert(get("Щит").damage > 0, "урон не посчитан");
      await goHome([P1, P2, S1]);
      assert(P1.party?.members?.length === 2, "группа распалась после арены");
    });
    await check("лимит времени: побеждает команда с бо́льшим % здоровья", async () => {
      const D1 = await Bot.join("Дуэлянт", "pass", "warrior");
      const D2 = await Bot.join("Соперник", "pass", "mage");
      await enterMatch("1v1", [D1, D2], [D1, D2]);
      await waitFight(D1);
      D1.send("target", { id: unitByName(D1, "Соперник") });
      await D1.until(() => D1.room.state.players.get(unitByName(D1, "Соперник")).hp < D1.room.state.players.get(unitByName(D1, "Соперник")).maxHp, 6000, "попадание");
      await D1.until(() => !!D1.result, MATCH_MS + 4000, "конец по времени");
      const me = D1.result.players.find((p: any) => p.name === "Дуэлянт");
      assert(D1.result.reason === "time" && me.won, "по времени: " + JSON.stringify(D1.result));
      await goHome([D1, D2]);
    });
    await check("конец сезона: награда по рангу и частичный сброс рейтинга", async () => {
      A.send("dbg", { op: "rating", mode: "1v1", v: 1750 });
      await A.until(() => A.info?.ratings["1v1"].rating === 1750, 2000, "рейтинг 1750");
      A.toasts.length = 0;
      A.send("dbg", { op: "season:end" });
      await A.until(() => A.self!.inventory.some((i) => i?.unique === "arena_diamond"), 3000, "медальон");
      await A.until(() => A.info?.season.id === 2 && A.info.ratings["1v1"].rating === 1375, 3000, "сброс рейтинга");
      assert(A.info.title.startsWith("Алмазная легенда") && A.info.frame === "diamond", "титул и рамка: " + A.info.title);
      await B.until(() => (B.room.state.players.get(unitByName(B, "Гладиатор"))?.title ?? "").startsWith("Алмазная легенда"), 2000, "титул виден другим");
    });
    console.log("Арена: бой с ботом");
    await stopServer();
    await startServer(true, { ARENA_MATCH_MS: String(MATCH_MS), ARENA_BOT_WAIT_MS: "1500" });
    await check("1×1 без соперника: предложение боя с ботом, без изменения рейтинга", async () => {
      const L = await Bot.join("Одинокий", "pass", "warrior");
      L.found = L.go = L.result = null;
      L.send("arena:queue", { mode: "1v1" });
      await L.until(() => !!L.found, 6000, "предложение бота");
      assert(L.found.bot === true, "нет флага бота");
      const botName = L.found.teams[1][0].name;
      assert(botName.startsWith("Бот "), "имя бота " + botName);
      L.send("arena:accept");
      await L.until(() => !!L.go, 6000, "переход на арену");
      await L.switchTo(L.go.reservation);
      await waitFight(L);
      L.send("target", { id: unitByName(L, botName) });
      await L.until(() => !!L.result, MATCH_MS + 6000, "итог боя с ботом");
      const r = L.result;
      assert(r.bot === true, "итог без флага бота");
      const me = r.players.find((x: any) => x.name === "Одинокий"), bot = r.players.find((x: any) => x.name === botName);
      assert(me && bot && me.ratingAfter === me.ratingBefore && me.ratingBefore === 1000, "рейтинг изменился: " + JSON.stringify(r));
      assert(bot.damage > 0, "бот не атаковал");
      await goHome([L]);
      L.info = null;
      L.send("arena:info");
      await L.until(() => L.info?.ratings["1v1"].rating === 1000, 2000, "рейтинг 1000");
      L.history = null;
      L.send("arena:history");
      await L.until(() => !!L.history, 2000, "история");
      assert(L.history.length === 0, "бой с ботом записан в историю");
    });
    console.log(`\nВсе проверки арены пройдены: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
