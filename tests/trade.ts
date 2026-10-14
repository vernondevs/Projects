/** Проверки обмена между игроками. Запуск: npx tsx tests/trade.ts */
import { assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";

type T = Bot & { trade: any; req: any; done: number };
async function join(name: string): Promise<T> {
  const b = (await Bot.join(name, "secret")) as T;
  b.trade = null;
  b.req = null;
  b.done = 0;
  b.room.onMessage("trade:state", (m) => (b.trade = m));
  b.room.onMessage("trade:request", (m) => (b.req = m));
  b.room.onMessage("trade:done", () => b.done++);
  return b;
}
async function open(a: T, b: T) {
  b.req = null;
  a.send("trade:request", { id: b.id });
  await b.until(() => !!b.req, 2000, "запрос обмена");
  b.send("trade:respond", { accept: true });
  await a.until(() => !!a.trade && !!b.trade, 2000, "окно обмена");
}
const inv = (b: Bot) => b.self!.inventory;
const idxOf = (b: Bot, base: string) => inv(b).findIndex((it) => it?.base === base);
const count = (b: Bot, base: string) => inv(b).reduce((s, it) => s + (it?.base === base ? it.qty ?? 1 : 0), 0);
async function finish(a: T, b: T) {
  a.send("trade:ready");
  b.send("trade:ready");
  await a.until(() => a.trade?.mine.ready && a.trade?.theirs.ready, 2000, "оба готовы");
  await sleep(3100);
  const da = a.done;
  a.send("trade:confirm");
  b.send("trade:confirm");
  await a.until(() => a.done > da, 2000, "обмен завершён");
  await sleep(200);
}

async function main() {
  console.log("Запуск тестового сервера…");
  await startServer();
  try {
    console.log("Обмен между игроками");
    const a = await join("Торговец1");
    const b = await join("Торговец2");
    await a.until(() => a.room.state.players.size >= 2, 2000, "видят друг друга");

    await check("обычный обмен: меч + золото на зелья", async () => {
      a.send("dbg", { op: "item", base: "sword", ilvl: 3, rarity: 1 });
      a.send("dbg", { op: "gold", v: 100 });
      await a.until(() => idxOf(a, "sword") >= 0, 2000, "меч у A");
      const goldA = a.self!.gold, goldB = b.self!.gold;
      await open(a, b);
      a.send("trade:add", { index: idxOf(a, "sword") });
      a.send("trade:gold", { v: 40 });
      b.send("trade:add", { index: idxOf(b, "hp_potion") });
      await a.until(() => a.trade.mine.items.some(Boolean) && a.trade.theirs.items.some(Boolean) && a.trade.mine.gold === 40, 2000, "окно заполнено");
      a.send("use", { index: idxOf(a, "sword") });
      await a.until(() => a.toasts.some((t) => t.includes("окне обмена")), 2000, "предмет в окне заблокирован");
      await finish(a, b);
      assert(idxOf(a, "sword") < 0 && idxOf(b, "sword") >= 0, "меч не перешёл");
      assert(count(a, "hp_potion") === 10 && count(b, "hp_potion") === 0, "зелья не перешли");
      assert(a.self!.gold === goldA - 40 && b.self!.gold === goldB + 40, "золото не перешло");
      assert(!a.trade && !b.trade, "окно не закрылось");
    });

    await check("подарок в одну сторону", async () => {
      await open(a, b);
      a.send("trade:gold", { v: 10 });
      await b.until(() => b.trade?.theirs.gold === 10, 2000, "золото в окне");
      assert(b.trade.gift === true && a.trade.gift === false, "нет пометки «Подарок»");
      const g = b.self!.gold;
      await finish(a, b);
      assert(b.self!.gold === g + 10, "подарок не дошёл");
    });

    await check("изменение после «Готов» сбрасывает подтверждения", async () => {
      await open(a, b);
      a.send("trade:gold", { v: 5 });
      await sleep(150);
      a.send("trade:ready");
      b.send("trade:ready");
      await a.until(() => a.trade.mine.ready && a.trade.theirs.ready, 2000, "оба готовы");
      b.send("trade:add", { index: idxOf(b, "mp_potion") });
      await a.until(() => a.trade.theirs.items.some(Boolean), 2000, "добавлен предмет");
      assert(!a.trade.mine.ready && !a.trade.theirs.ready, "подтверждения не сброшены");
      assert(a.trade.theirs.changed.length === 1 && a.trade.confirmIn > 2000, "нет подсветки/задержки");
      a.send("trade:ready");
      b.send("trade:ready");
      await sleep(200);
      a.send("trade:confirm");
      await a.until(() => a.toasts.some((t) => t.includes("Подождите")), 2000, "ранний «Обменять» отклонён");
      a.send("trade:cancel");
      await a.until(() => !a.trade && !b.trade, 2000, "отмена");
    });

    await check("привязанный предмет нельзя передать", async () => {
      a.send("dbg", { op: "item", unique: "ashbringer" });
      await a.until(() => inv(a).some((it) => it?.unique === "ashbringer"), 2000, "уникальный предмет");
      await open(a, b);
      a.toasts.length = 0;
      a.send("trade:add", { index: inv(a).findIndex((it) => it?.unique === "ashbringer") });
      await a.until(() => a.toasts.some((t) => t.includes("привязан")), 2000, "ошибка привязки");
      assert(!a.trade.mine.items.some(Boolean), "привязанный предмет попал в окно");
      a.send("trade:cancel");
      await a.until(() => !a.trade, 2000, "отмена");
    });

    await check("нехватка места — понятная ошибка, ничего не теряется", async () => {
      b.send("dbg", { op: "fill" });
      await b.until(() => inv(b).every(Boolean), 2000, "сумка B полна");
      a.send("dbg", { op: "item", base: "axe", ilvl: 2 });
      await a.until(() => idxOf(a, "axe") >= 0, 2000, "топор");
      await open(a, b);
      a.send("trade:add", { index: idxOf(a, "axe") });
      await sleep(150);
      a.toasts.length = 0;
      await (async () => {
        a.send("trade:ready");
        b.send("trade:ready");
        await sleep(3200);
        a.send("trade:confirm");
        b.send("trade:confirm");
      })();
      await a.until(() => a.toasts.some((t) => t.includes("Недостаточно места") && t.includes("Торговец2")), 2000, "ошибка места");
      assert(idxOf(a, "axe") >= 0 && idxOf(b, "axe") < 0, "топор потерялся или задвоился");
      a.send("trade:cancel");
      await a.until(() => !a.trade, 2000, "отмена");
    });

    await check("отключение посреди обмена: без потерь и дублей", async () => {
      const c = await join("Торговец3");
      c.send("dbg", { op: "item", base: "bow", ilvl: 4 });
      await c.until(() => idxOf(c, "bow") >= 0, 2000, "лук");
      await open(c, a);
      c.send("trade:add", { index: idxOf(c, "bow") });
      await a.until(() => a.trade?.theirs.items.some(Boolean), 2000, "лук в окне");
      a.send("trade:ready");
      c.send("trade:ready");
      await sleep(3100);
      a.send("trade:confirm");
      await c.leave();
      await a.until(() => !a.trade, 3000, "окно закрылось у A");
      assert(a.toasts.some((t) => t.includes("отключился")), "нет причины отмены");
      assert(idxOf(a, "bow") < 0, "лук задвоился у A");
      const c2 = await join("Торговец3");
      assert(idxOf(c2, "bow") >= 0, "лук потерян");
      await c2.leave();
    });

    await check("далеко — обмен отменяется", async () => {
      await open(a, b);
      a.send("dbg", { op: "tp", x: a.me().x + 400, y: a.me().y });
      await a.until(() => !a.trade && !b.trade, 3000, "отмена по расстоянию");
    });

    await check("отключение входящих запросов", async () => {
      b.send("trade:setting", { allow: false });
      await sleep(150);
      a.send("dbg", { op: "tp", x: b.me().x + 10, y: b.me().y });
      await sleep(150);
      a.toasts.length = 0;
      a.send("trade:request", { id: b.id });
      await a.until(() => a.toasts.some((t) => t.includes("не принимает")), 2000, "отказ по настройке");
      b.send("trade:setting", { allow: true });
    });
    console.log(`\nВсе проверки обмена пройдены: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
