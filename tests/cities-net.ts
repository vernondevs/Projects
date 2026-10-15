/** Сетевые проверки городов: открытие телепорта, каст и отмена, бой, цена, возрождение, задания. */
import { CITIES, teleportPrice } from "../shared/cities";
import { Bot, assert, check, passedCount, sleep, startServer, stopServer } from "./harness";

const [ember, oasis, snow] = CITIES;
const at = (b: Bot, c: { x: number; y: number }) => Math.hypot(b.me().x - c.x, b.me().y - c.y);

async function main() {
  await startServer(true);
  try {
    const b = await Bot.join("Путник", "secret", "warrior");
    b.send("dbg", { op: "god" });
    await check("новый герой знает Эмберхолл; оазис не открыт", async () => {
      await b.until(() => (b.self!.cities ?? []).includes("ember"), 2000, "ember открыт");
      assert(!(b.self!.cities ?? []).includes("oasis"), "оазис открыт раньше времени");
    });
    await check("вход в зону города открывает телепорт", async () => {
      b.send("dbg", { op: "tp", x: oasis.spawn.x, y: oasis.spawn.y });
      await b.until(() => (b.self!.cities ?? []).includes("oasis"), 2000, "оазис открыт");
      assert(b.toasts.some((t) => t.includes("Открыт телепорт: Оазис Миражей")), "нет сообщения");
    });
    await check("телепорт без камня и в неоткрытый город отклоняется", async () => {
      b.send("dbg", { op: "gold", v: 1000 });
      b.send("tp:go", { id: "ember" });
      await sleep(3600);
      assert(at(b, ember.spawn) > 500, "телепортировало без камня");
      b.send("dbg", { op: "tp", x: oasis.arrive.x, y: oasis.arrive.y });
      await sleep(200);
      b.send("tp:go", { id: "snow_valley" });
      await sleep(3600);
      assert(at(b, oasis.arrive) < 40, "ушёл в неоткрытый город");
    });
    await check("движение отменяет каст", async () => {
      b.send("tp:go", { id: "ember" });
      await sleep(500);
      b.send("input", { mx: 1, my: 0 });
      await sleep(300);
      b.send("input", { mx: 0, my: 0 });
      await sleep(3500);
      assert(at(b, ember.arrive) > 500, "телепорт сработал вопреки движению");
    });
    await check("в бою телепорт запрещён", async () => {
      b.send("dbg", { op: "tp", x: oasis.arrive.x, y: oasis.arrive.y });
      await sleep(200);
      b.send("dbg", { op: "fight" });
      await sleep(200);
      b.toasts.length = 0;
      b.send("tp:go", { id: "ember" });
      await sleep(3500);
      assert(b.toasts.some((t) => t.includes("в бою")), "нет отказа");
      assert(at(b, ember.arrive) > 500, "телепорт сработал в бою");
    });
    await check("телепорт за золото через 3 секунды", async () => {
      b.send("dbg", { op: "calm" });
      await sleep(200);
      const gold = b.self!.gold;
      b.send("tp:go", { id: "ember" });
      await sleep(1500);
      assert(at(b, ember.arrive) > 500, "телепорт мгновенный");
      await b.until(() => at(b, ember.arrive) < 40, 3500, "прибытие в Эмберхолл");
      await b.until(() => b.self!.gold === gold - teleportPrice(oasis, ember), 1500, "списание золота");
    });
    await check("недостаточно золота — отказ", async () => {
      b.send("dbg", { op: "gold", v: -b.self!.gold });
      await sleep(200);
      b.send("tp:go", { id: "oasis" });
      await sleep(3500);
      assert(at(b, ember.arrive) < 40, "ушёл без золота");
    });
    await check("возрождение в ближайшем открытом городе", async () => {
      b.send("dbg", { op: "tp", x: snow.spawn.x, y: snow.spawn.y });
      await b.until(() => (b.self!.cities ?? []).includes("snow_valley"), 2000, "долина открыта");
      b.send("dbg", { op: "tp", x: snow.spawn.x + 400, y: snow.spawn.y + 600 });
      await sleep(200);
      b.send("dbg", { op: "hurt", v: 9999999 });
      await b.until(() => b.me().anim === 4, 2000, "смерть");
      await sleep(4200);
      b.send("respawn");
      await b.until(() => b.me().anim !== 4, 2000, "возрождение");
      assert(at(b, snow.spawn) < 40, "возродился не в долине");
    });
    await check("задания: принять, выполнить, сдать", async () => {
      const g = oasis.quest!;
      b.send("dbg", { op: "level", v: 20 });
      b.send("dbg", { op: "tp", x: g.x, y: g.y + 30 });
      await sleep(200);
      b.send("quest:accept", { id: "oasis_jackals" });
      await b.until(() => b.self!.quests?.active.oasis_jackals === 0, 1500, "принято");
      b.send("quest:turn", { id: "oasis_jackals" });
      await sleep(300);
      assert(b.self!.quests!.active.oasis_jackals === 0, "сдано без выполнения");
      b.send("dbg", { op: "qp", kind: "kill", target: "jackal", n: 8 });
      await b.until(() => b.self!.quests?.active.oasis_jackals === 8, 1500, "прогресс");
      const gold = b.self!.gold;
      b.send("quest:turn", { id: "oasis_jackals" });
      await b.until(() => (b.self!.quests?.done ?? []).includes("oasis_jackals"), 1500, "сдано");
      assert(b.self!.gold === gold + 220, "награда золотом");
      b.send("quest:accept", { id: "oasis_jackals" });
      await sleep(300);
      assert(b.self!.quests!.active.oasis_jackals === undefined, "повторное принятие");
    });
    await check("заказчик далеко — задание не принять", async () => {
      b.send("dbg", { op: "tp", x: ember.spawn.x, y: ember.spawn.y });
      await sleep(200);
      b.send("quest:accept", { id: "oasis_cactus" });
      await sleep(300);
      assert(b.self!.quests!.active.oasis_cactus === undefined, "принято издалека");
    });
    await check("торговля у торговца оазиса", async () => {
      b.send("dbg", { op: "gold", v: 100 });
      const m = oasis.merchant!;
      b.send("dbg", { op: "tp", x: m.x, y: m.y + 40 });
      await sleep(200);
      const before = b.self!.gold;
      b.send("buy", { base: "hp_potion", qty: 1 });
      await b.until(() => b.self!.gold < before, 1500, "покупка");
    });
    await b.leave();
  } finally {
    await stopServer();
  }
  console.log(`\nГорода (сеть): проверок ${passedCount()}`);
}
main().catch(async (e) => {
  console.error(e);
  await stopServer();
  process.exit(1);
});
