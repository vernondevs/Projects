/** Проверки банка. Запуск: npx tsx tests/bank.ts */
import { BANKER, SHARED_TAB } from "../shared/bank";
import { assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";

type B = Bot & { bank: any; trade: any; req: any };
async function join(name: string): Promise<B> {
  const b = (await Bot.join(name, "secret")) as B;
  b.bank = null;
  b.trade = null;
  b.req = null;
  b.room.onMessage("bank", (m) => (b.bank = m));
  b.room.onMessage("trade:state", (m) => (b.trade = m));
  b.room.onMessage("trade:request", (m) => (b.req = m));
  return b;
}
const inv = (b: Bot) => b.self!.inventory;
const idxOf = (b: Bot, base: string) => inv(b).findIndex((it) => it?.base === base);
const bankItems = (b: B) => (b.bank?.tabs ?? []).flat().filter(Boolean) as any[];
const inBank = (b: B, base: string) => bankItems(b).some((it) => it.base === base);
async function toBanker(b: B) {
  b.send("dbg", { op: "tp", x: BANKER.x, y: BANKER.y + 30 });
  await sleep(150);
  b.bank = null;
  b.send("bank:open", {});
  await b.until(() => !!b.bank, 2000, "окно банка");
}
async function toast(b: Bot, part: string) {
  await b.until(() => b.toasts.some((t) => t.includes(part)), 2000, `сообщение «${part}»`);
}

async function main() {
  console.log("Запуск тестового сервера…");
  await startServer();
  try {
    console.log("Банк");
    const a = await join("Вкладчик1");

    await check("далеко от банкира — отказ", async () => {
      a.toasts.length = 0;
      a.send("dbg", { op: "tp", x: BANKER.x + 600, y: BANKER.y });
      await sleep(150);
      a.send("bank:open", {});
      await toast(a, "Банкир далеко");
    });

    await check("положить и забрать предмет", async () => {
      await toBanker(a);
      assert(a.bank.tabs.length === 1 && a.bank.tabs[0].length === 12, "старт: 1 вкладка × 12");
      a.send("dbg", { op: "item", base: "sword", ilvl: 3, rarity: 1 });
      await a.until(() => idxOf(a, "sword") >= 0, 2000, "меч");
      a.send("bank:put", { index: idxOf(a, "sword"), tab: 0, slot: 5 });
      await a.until(() => a.bank.tabs[0][5]?.base === "sword" && idxOf(a, "sword") < 0, 2000, "меч в банке");
      a.send("bank:move", { tab: 0, slot: 5, toTab: 0, toSlot: 0 });
      await a.until(() => a.bank.tabs[0][0]?.base === "sword" && !a.bank.tabs[0][5], 2000, "перестановка");
      a.send("bank:take", { tab: 0, slot: 0 });
      await a.until(() => idxOf(a, "sword") >= 0 && !inBank(a, "sword"), 2000, "меч в сумке");
    });

    await check("квестовый предмет нельзя в банк и склад", async () => {
      await toBanker(a);
      a.send("dbg", { op: "item", base: "cactus_juice" });
      await a.until(() => idxOf(a, "cactus_juice") >= 0, 2000, "сок кактуса");
      a.toasts.length = 0;
      a.send("bank:put", { index: idxOf(a, "cactus_juice"), tab: 0, slot: 3 });
      await toast(a, "Квестовый предмет");
      a.send("bank:put", { index: idxOf(a, "cactus_juice"), tab: SHARED_TAB, slot: 0 });
      await sleep(200);
      assert(idxOf(a, "cactus_juice") >= 0 && !inBank(a, "cactus_juice"), "предмет остался в сумке");
    });

    await check("зелья складываются в стопку", async () => {
      const qty = inv(a)[idxOf(a, "hp_potion")]!.qty;
      a.send("bank:put", { index: idxOf(a, "hp_potion") });
      await a.until(() => inBank(a, "hp_potion") && idxOf(a, "hp_potion") < 0, 2000, "зелья в банке");
      assert(bankItems(a).find((it) => it.base === "hp_potion").qty === qty, "количество изменилось");
      const t = a.bank.tabs[0].findIndex((it: any) => it?.base === "hp_potion");
      a.send("bank:take", { tab: 0, slot: t });
      await a.until(() => idxOf(a, "hp_potion") >= 0 && !inBank(a, "hp_potion"), 2000, "зелья обратно");
    });

    await check("золото: положить и снять", async () => {
      a.send("dbg", { op: "gold", v: 1000 });
      await a.until(() => a.self!.gold >= 1000, 2000, "золото");
      const g = a.self!.gold;
      a.send("bank:gold", { v: 700 });
      await a.until(() => a.bank.gold === 700 && a.self!.gold === g - 700, 2000, "золото в банке");
      a.toasts.length = 0;
      a.send("bank:gold", { v: -5000 });
      await toast(a, "нет столько");
      a.send("bank:gold", { v: -200 });
      await a.until(() => a.bank.gold === 500 && a.self!.gold === g - 500, 2000, "снято");
    });

    await check("покупка ячеек и новой вкладки", async () => {
      a.send("dbg", { op: "gold", v: 3500 - a.self!.gold });
      await a.until(() => a.self!.gold === 3500, 2000, "3500 золота");
      assert(a.bank.price === 500, "первая цена 500");
      a.send("bank:buy", {});
      await a.until(() => a.bank.tabs[0].length === 18 && a.self!.gold === 3000 && a.bank.price === 1000, 2000, "+6 ячеек");
      a.send("bank:buy", {});
      await a.until(() => a.bank.tabs[0].length === 24 && a.self!.gold === 2000, 2000, "вкладка 1 полная");
      a.send("bank:buy", {});
      await a.until(() => a.bank.tabs.length === 2 && a.bank.tabs[1].length === 6 && a.self!.gold === 0, 2000, "вкладка 2");
      a.toasts.length = 0;
      a.send("bank:buy", {});
      await toast(a, "Нужно");
      assert(a.bank.tabs[1].length === 6, "купили без золота");
    });

    await check("полный банк — ошибка, предмет остаётся в сумке", async () => {
      // 24 + 6 = 30 ячеек: заполняем кольцами из сумки
      while (bankItems(a).length < 30) {
        a.send("dbg", { op: "fill" });
        await a.until(() => inv(a).every(Boolean), 2000, "сумка полна");
        const before = bankItems(a).length;
        const need = Math.min(30 - before, inv(a).filter((it) => it?.base === "ring").length);
        for (let i = 0, n = 0; i < inv(a).length && n < need; i++) if (inv(a)[i]?.base === "ring") { a.send("bank:put", { index: i }); n++; }
        await a.until(() => bankItems(a).length === before + need, 3000, "кольца в банке");
      }
      a.send("dbg", { op: "fill" });
      await sleep(200);
      const rings = inv(a).filter((it) => it?.base === "ring").length;
      a.toasts.length = 0;
      a.send("bank:put", { index: idxOf(a, "ring") });
      await toast(a, "нет места");
      await sleep(100);
      assert(inv(a).filter((it) => it?.base === "ring").length === rings && bankItems(a).length === 30, "предмет пропал или задвоился");
    });

    await check("предмет в окне обмена нельзя положить", async () => {
      const c = await join("Вкладчик2");
      c.send("dbg", { op: "tp", x: BANKER.x + 20, y: BANKER.y + 30 });
      await sleep(200);
      a.send("trade:request", { id: c.id });
      await c.until(() => !!c.req, 2000, "запрос");
      c.send("trade:respond", { accept: true });
      await a.until(() => !!a.trade, 2000, "окно обмена");
      const i = idxOf(a, "ring");
      a.send("trade:add", { index: i });
      await a.until(() => a.trade.mine.items.some(Boolean), 2000, "кольцо в обмене");
      a.toasts.length = 0;
      a.send("bank:take", { tab: 0, slot: 0, index: i });
      a.send("bank:put", { index: i, tab: 0, slot: 0 });
      await toast(a, "окне обмена");
      await sleep(150);
      assert(inv(a)[i]?.base === "ring" && a.trade.mine.items.some(Boolean), "предмет ушёл из окна обмена");
      a.send("trade:cancel");
      await a.until(() => !a.trade, 2000, "отмена");
      await c.leave();
    });

    await check("отключение сразу после операции: без потерь и дублей", async () => {
      const d = await join("Вкладчик3");
      await toBanker(d);
      d.send("dbg", { op: "item", base: "bow", ilvl: 4 });
      await d.until(() => idxOf(d, "bow") >= 0, 2000, "лук");
      d.send("bank:put", { index: idxOf(d, "bow") });
      d.send("bank:gold", { v: 10 });
      await d.leave(); // не ждём ответа
      await sleep(300);
      const d2 = await join("Вкладчик3");
      await toBanker(d2);
      const total = (idxOf(d2, "bow") >= 0 ? 1 : 0) + bankItems(d2).filter((it) => it.base === "bow").length;
      assert(total === 1, `луков после релога: ${total}`);
      assert(d2.bank.gold + d2.self!.gold === 25, "золото потерялось или задвоилось");
      // и после полного перезапуска сервера всё на месте
      const where = idxOf(d2, "bow") >= 0 ? "bag" : "bank";
      await d2.leave();
      await stopServer();
      await startServer(false);
      const d3 = await join("Вкладчик3");
      await toBanker(d3);
      assert(where === "bag" ? idxOf(d3, "bow") >= 0 : inBank(d3, "bow"), "лук не сохранился в БД");
      assert(!(idxOf(d3, "bow") >= 0 && inBank(d3, "bow")), "лук задвоился");
      await d3.leave();
    });

    console.log(`\nВсе проверки банка пройдены: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
