/** Интеграционные проверки сервера ботами. Запуск: npm test */
import { assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";
import { BOSS_SPAWNS, generateMap } from "../shared/map";
import { MOBS } from "../shared/mobs";
import { BESTIARY } from "../shared/bestiary";
import { MAP_SEED } from "../shared/constants";

const MAP = generateMap(MAP_SEED);
const town = MAP.playerSpawn;
/** Ближайшая к городу точка появления моба заданного типа. */
function spawnOf(mob: string) {
  return MAP.spawns.filter((s) => s.mob === mob).sort((a, b) => Math.hypot(a.x - town.x, a.y - town.y) - Math.hypot(b.x - town.x, b.y - town.y))[0];
}
/** Живой моб рядом с точкой. */
function mobNear(b: Bot, x: number, y: number, r = 200, sprite?: string): string | null {
  let best: string | null = null, bd = r;
  b.room.state.mobs.forEach((m: any, id: string) => {
    if (m.anim === 4 || (sprite && m.sprite !== sprite)) return;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) { bd = d; best = id; }
  });
  return best;
}
async function killNear(b: Bot, mob: string, timeout = 20000) {
  // живой моб нужного типа у ближайшей к городу точки появления
  let id: string | null = null, sp = spawnOf(mob);
  for (const s of MAP.spawns.filter((x) => x.mob === mob).sort((p, q) => Math.hypot(p.x - town.x, p.y - town.y) - Math.hypot(q.x - town.x, q.y - town.y))) {
    id = mobNear(b, s.x, s.y, 120, mob);
    if (id) { sp = s; break; }
  }
  b.send("dbg", { op: "tp", x: sp.x + 30, y: sp.y });
  await sleep(300);
  assert(id, "моб " + mob + " не найден у точки появления");
  b.send("target", { id });
  const t0 = Date.now();
  try {
    await b.until(() => b.room.state.mobs.get(id)?.anim === 4, timeout, "моб убит");
  } catch (e) {
    const m = b.room.state.mobs.get(id), me = b.me();
    throw new Error(`моб не убит за ${Date.now() - t0} мс: моб ${m?.sprite} hp=${m?.hp}/${m?.maxHp} anim=${m?.anim} (${m?.x|0},${m?.y|0}); игрок hp=${me.hp} (${me.x|0},${me.y|0}) target=${me.target}`);
  }
  return id!;
}

async function main() {
  console.log("Запуск тестового сервера…");
  await startServer();
  try {
    console.log("Этап 2: вход, движение, чат, сохранение");
    let a!: Bot, b!: Bot;
    await check("регистрация двух игроков", async () => {
      a = await Bot.join("Алиса", "pass1", "warrior");
      b = await Bot.join("Борис", "pass2", "mage");
      assert(a.self!.cls === "warrior" && b.self!.cls === "mage", "классы не совпали");
    });
    await check("игроки видят друг друга", async () => {
      await a.until(() => a.room.state.players.size === 2, 2000, "второй игрок у Алисы");
      await b.until(() => b.room.state.players.get(a.id)?.name === "Алиса", 2000, "Алиса у Бориса");
    });
    await check("движение синхронизируется", async () => {
      const x0 = a.me().x;
      a.send("input", { mx: 1, my: 0 });
      await sleep(600);
      a.send("input", { mx: 0, my: 0 });
      await sleep(150);
      const seen = b.room.state.players.get(a.id).x;
      assert(seen > x0 + 40, `Алиса сдвинулась на ${seen - x0}`);
      assert(seen < x0 + 150 * 0.8 + 30, "скорость выше допустимой");
    });
    await check("сервер ограничивает скорость (input > 1)", async () => {
      const x0 = a.me().x;
      a.send("input", { mx: 50, my: 0 });
      await sleep(500);
      a.send("input", { mx: 0, my: 0 });
      await sleep(120);
      assert(a.me().x - x0 < 150 * 0.7, "читерская скорость прошла");
    });
    await check("движение по клику", async () => {
      const t = { x: a.me().x - 60, y: a.me().y };
      a.send("moveTo", t);
      await a.until(() => Math.abs(a.me().x - t.x) < 6, 2000, "дошла до точки");
    });
    await check("общий чат", async () => {
      a.send("chat", { text: "Привет, мир!" });
      await b.until(() => b.chat.some((l) => l.from === "Алиса" && l.text === "Привет, мир!"), 2000, "сообщение");
    });
    await check("повторный вход тем же персонажем вытесняет старую сессию", async () => {
      const old = a;
      a = await Bot.join("алиса", "pass1");
      await old.until(() => old.closeCode === 4011, 2000, "старая сессия закрыта");
      let n = 0;
      b.room.state.players.forEach((u: any) => { if (u.name === "Алиса") n++; });
      assert(n === 1, "героев Алиса в мире: " + n);
    });
    await check("сохранение позиции и неверный пароль", async () => {
      const x = a.me().x;
      await a.leave();
      await sleep(200);
      let err = "";
      try {
        await Bot.join("Алиса", "wrong");
      } catch (e) {
        err = String((e as Error).message);
      }
      assert(err.includes("Неверный пароль"), "пароль не проверяется: " + err);
      a = await Bot.join("Алиса", "pass1");
      assert(Math.abs(a.me().x - x) < 2, "позиция не сохранилась");
    });

    console.log("Этап 3: бой");
    await check("автоатака убивает слизня, опыт начислен", async () => {
      b.fx.length = 0;
      await killNear(a, "slime");
      await a.until(() => (a.self?.xp ?? 0) > 0 && a.self!.kills === 1, 2000, "опыт за убийство");
      await a.until(() => a.self!.mobKills?.slime === 1, 2000, "бестиарий: счётчик убийств слизня");
      assert(BESTIARY.slime?.desc, "бестиарий: нет записи слизня");
      assert(a.fx.some((f) => f.t === "dmg"), "нет событий урона");
    });
    await check("умение тратит ману и уходит на перезарядку", async () => {
      const sp = spawnOf("goblin");
      a.send("dbg", { op: "tp", x: sp.x + 30, y: sp.y });
      await sleep(250);
      const mp0 = a.me().mp;
      let cd = 0;
      const gob = mobNear(a, sp.x, sp.y, 300);
      a.room.onMessage("cd", (c: any) => { if (c.id === "taunt") cd = c.ms; });
      a.send("skill", { id: "taunt", x: sp.x, y: sp.y, target: gob });
      await a.until(() => cd > 0, 2000, "перезарядка");
      await a.until(() => a.me().mp <= mp0 - 8, 1000, "мана потрачена");
      const mp1 = a.me().mp;
      a.send("skill", { id: "taunt", x: sp.x, y: sp.y, target: gob });
      await sleep(300);
      assert(a.me().mp >= mp1, "повтор во время перезарядки снова списал ману");
    });
    await check("неизученное умение отклоняется", async () => {
      a.toasts.length = 0;
      a.send("skill", { id: "quake", x: 0, y: 0 });
      await a.until(() => a.toasts.includes("Умение не изучено"), 2000, "отказ");
    });
    await check("маг: огненный шар летит снарядом", async () => {
      const sp = spawnOf("slime");
      b.send("dbg", { op: "tp", x: sp.x + 120, y: sp.y });
      await sleep(300);
      const id = mobNear(b, sp.x, sp.y, 300);
      assert(id, "нет цели для мага");
      b.fx.length = 0;
      b.send("skill", { id: "fireball", x: sp.x, y: sp.y, target: id });
      await b.until(() => b.fx.some((f) => f.t === "proj" && f.k === "fireball"), 2000, "снаряд");
    });
    await check("смерть и возрождение в городе", async () => {
      a.send("dbg", { op: "hurt", v: 99999 });
      await a.until(() => a.me().anim === 4, 2000, "смерть");
      a.send("respawn");
      await sleep(300);
      assert(a.me().anim === 4, "возрождение раньше задержки");
      await sleep(4000);
      a.send("respawn");
      await a.until(() => a.me().anim !== 4, 2000, "возрождение");
      assert(Math.hypot(a.me().x - town.x, a.me().y - town.y) < 5, "не в городе");
      assert(a.me().hp === a.me().maxHp, "здоровье не восстановлено");
    });

    console.log("Этап 4: прокачка");
    let c!: Bot;
    await check("опыт поднимает уровень, даёт очки", async () => {
      c = await Bot.join("Вера", "pass3", "ranger");
      c.send("dbg", { op: "xp", v: 400 });
      await c.until(() => c.self!.level >= 3, 2000, "уровень 3");
      assert(c.self!.statPoints === (c.self!.level - 1) * 3, "очки характеристик: " + c.self!.statPoints);
      assert(c.self!.skillPoints === c.self!.level - 1, "очки умений: " + c.self!.skillPoints);
      assert(c.me().hp === c.me().maxHp, "здоровье не восполнено на уровне");
    });
    await check("распределение характеристик меняет урон", async () => {
      const agi = c.self!.derived.stats.agi, dmg = c.self!.derived.dmgMax;
      c.send("alloc", { stat: "agi" });
      c.send("alloc", { stat: "agi" });
      await c.until(() => c.self!.derived.stats.agi === agi + 2, 2000, "ловкость");
      assert(c.self!.derived.dmgMax >= dmg, "урон не вырос");
      c.send("alloc", { stat: "luck" });
      await sleep(150);
      assert(c.self!.derived.stats.agi === agi + 2, "принят неизвестный стат");
    });
    await check("дерево умений: требования уровня и предка", async () => {
      c.toasts.length = 0;
      c.send("learn", { id: "rain" });
      await c.until(() => c.toasts.some((t) => t.includes("15 уровень")), 2000, "отказ по уровню");
      c.send("learn", { id: "volley" });
      await c.until(() => c.self!.skills.volley === 1, 2000, "залп изучен");
      c.send("learn", { id: "taunt" });
      await sleep(200);
      assert(!c.self!.skills.taunt, "изучено умение чужого класса");
    });
    await check("пассивка влияет на характеристики", async () => {
      c.send("dbg", { op: "level", v: 5 });
      await c.until(() => c.self!.level === 5, 2000, "уровень 5");
      const crit = c.self!.derived.crit;
      c.send("learn", { id: "precision" });
      await c.until(() => (c.self!.skills.precision || 0) === 1, 2000, "меткость");
      assert(Math.abs(c.self!.derived.crit - crit - 0.03) < 1e-6, "крит не вырос на 3%");
    });
    await check("предел уровня 30", async () => {
      c.send("dbg", { op: "level", v: 30 });
      await c.until(() => c.self!.level === 30, 3000, "уровень 30");
      c.send("dbg", { op: "xp", v: 1e7 });
      await sleep(200);
      assert(c.self!.level === 30 && c.self!.xpNext === 0, "уровень выше 30");
      assert(c.self!.statPoints === 87 - 2, "очки на 30 уровне: " + c.self!.statPoints);
    });

    console.log("Этап 5: лут и снаряжение");
    await check("с моба падает личный мешок, подбор проверяет дистанцию", async () => {
      a.send("dbg", { op: "drop", v: true });
      a.bags = [];
      await killNear(a, "slime");
      await a.until(() => a.bags.length > 0, 2000, "мешок");
      const bag = a.bags[a.bags.length - 1];
      assert(bag.items.length >= 1, "пустой мешок");
      assert(!c.bags.length, "чужой мешок виден другому игроку");
      a.send("dbg", { op: "tp", x: bag.x + 300, y: bag.y });
      await sleep(200);
      a.toasts.length = 0;
      a.send("pickup", { bag: bag.id });
      await a.until(() => a.toasts.includes("Подойдите ближе"), 2000, "отказ издалека");
      a.send("dbg", { op: "tp", x: bag.x + 10, y: bag.y });
      await sleep(200);
      const before = a.self!.inventory.filter(Boolean).length;
      a.send("pickup", { bag: bag.id });
      await a.until(() => !a.bags.some((x: any) => x.id === bag.id), 2000, "мешок подобран");
      assert(a.self!.inventory.filter(Boolean).length > before || bag.items.every((i: any) => i.qty), "предмет не попал в сумку");
      a.send("dbg", { op: "drop", v: false });
    });
    await check("экипировка: надеть, снять, ограничения класса и уровня", async () => {
      a.send("dbg", { op: "item", base: "sword", ilvl: 3, rarity: 2 });
      await a.until(() => a.self!.inventory.some((i) => i?.base === "sword" && i.rarity === 2), 2000, "меч в сумке");
      const idx = a.self!.inventory.findIndex((i) => i?.base === "sword" && i.rarity === 2);
      const dmg0 = a.self!.derived.dmgMax;
      a.send("equip", { index: idx });
      await a.until(() => a.self!.equip.weapon?.rarity === 2, 2000, "меч надет");
      assert(a.self!.derived.dmgMax > dmg0, "урон не изменился");
      assert(a.self!.inventory[idx]?.base === "sword", "старое оружие не вернулось в сумку");
      a.send("unequip", { slot: "weapon" });
      await a.until(() => a.self!.equip.weapon === null, 2000, "снят");
      a.toasts.length = 0;
      a.send("dbg", { op: "item", base: "staff", ilvl: 1, rarity: 0 });
      await a.until(() => a.self!.inventory.some((i) => i?.base === "staff"), 2000, "посох");
      a.send("equip", { index: a.self!.inventory.findIndex((i) => i?.base === "staff") });
      await a.until(() => a.toasts.includes("Не подходит вашему классу"), 2000, "отказ по классу");
      a.send("dbg", { op: "item", base: "helmet", ilvl: 25, rarity: 1 });
      await a.until(() => a.self!.inventory.some((i) => i?.base === "helmet" && i.ilvl === 25), 2000, "шлем");
      a.send("equip", { index: a.self!.inventory.findIndex((i) => i?.base === "helmet" && i.ilvl === 25) });
      await a.until(() => a.toasts.some((t) => t.startsWith("Нужен 23")), 2000, "отказ по уровню");
      a.send("equip", { index: a.self!.inventory.findIndex((i) => i?.base === "sword" && i.rarity === 2) });
      await a.until(() => a.self!.equip.weapon?.rarity === 2, 2000, "меч снова надет");
    });
    await check("зелье лечит и тратится", async () => {
      a.send("dbg", { op: "hp", v: 20 });
      await a.until(() => a.me().hp <= 30, 2000, "ранен");
      const q0 = a.self!.inventory.find((i) => i?.base === "hp_potion")!.qty!;
      a.send("use", { index: a.self!.inventory.findIndex((i) => i?.base === "hp_potion") });
      await a.until(() => a.me().hp > 40, 2000, "вылечен");
      await a.until(() => a.self!.inventory.find((i) => i?.base === "hp_potion")?.qty === q0 - 1, 2000, "зелье потрачено");
    });
    await check("торговец: покупка и продажа только рядом", async () => {
      a.toasts.length = 0;
      a.send("buy", { base: "hp_potion", qty: 1 });
      await a.until(() => a.toasts.includes("Торговец далеко"), 2000, "отказ вдали");
      a.send("dbg", { op: "tp", x: MAP.merchant.x, y: MAP.merchant.y + 30 });
      a.send("dbg", { op: "gold", v: 100 });
      await sleep(200);
      const g0 = a.self!.gold;
      a.send("buy", { base: "hp_potion", qty: 2 });
      await a.until(() => a.self!.gold === g0 - 30, 2000, "оплата");
      a.send("buy", { base: "sword", qty: 1 });
      await sleep(150);
      assert(a.self!.gold === g0 - 30, "купили то, что не продаётся");
      const si = a.self!.inventory.findIndex((i) => i?.base === "staff");
      a.send("sell", { index: si });
      await a.until(() => a.self!.gold > g0 - 30 && !a.self!.inventory[si], 2000, "продажа");
    });
    await check("перестановка в сумке и стопки зелий", async () => {
      const inv = a.self!.inventory;
      const hp = inv.findIndex((i) => i?.base === "hp_potion");
      const empty = inv.findIndex((i) => !i);
      a.send("swap", { a: hp, b: empty });
      await a.until(() => a.self!.inventory[empty]?.base === "hp_potion", 2000, "перенос");
    });
    await check("инвентарь и экипировка сохраняются в SQLite", async () => {
      const weapon = a.self!.equip.weapon!.uid;
      const count = a.self!.inventory.filter(Boolean).length;
      await a.leave();
      await sleep(250);
      a = await Bot.join("Алиса", "pass1");
      assert(a.self!.equip.weapon?.uid === weapon, "оружие не сохранилось");
      assert(a.self!.inventory.filter(Boolean).length === count, "сумка не сохранилась");
    });

    console.log("Этап 6: боссы");
    const bossTest = async (id: string, cls: string, phases: number[], expect: (fx: any[]) => string | null) => {
      const g = await Bot.join("Б" + id.slice(0, 6) + cls.slice(0, 3), "pass", cls);
      g.send("dbg", { op: "level", v: 30 });
      await g.until(() => g.self!.level === 30, 3000, "уровень");
      g.send("dbg", { op: "god" });
      const sp = BOSS_SPAWNS.find((x) => x.id === id)!;
      g.send("dbg", { op: "tp", x: sp.x - 120, y: sp.y + 30 });
      await sleep(400);
      let bossId = "";
      g.room.state.mobs.forEach((m: any, k: string) => { if (m.sprite === id) bossId = k; });
      assert(bossId, "босс не найден");
      g.send("target", { id: bossId });
      await g.until(() => g.fx.some((f) => f.t === "tele"), 15000, "телеграф атаки");
      for (const [i, hp] of phases.entries()) {
        g.send("dbg", { op: "mobhp", id: bossId, v: hp });
        await g.until(() => g.room.state.mobs.get(bossId)?.phase === i + 1, 4000, "фаза " + (i + 2));
        await g.until(() => g.fx.some((f) => f.t === "say" && f.id === bossId), 2000, "реплика");
      }
      await sleep(id === "ashlord" ? 9000 : 7000);
      const why = expect(g.fx);
      assert(!why, why!);
      g.send("dbg", { op: "mobhp", id: bossId, v: 0.0001 });
      await g.until(() => g.room.state.mobs.get(bossId)?.anim === 4, 8000, "босс повержен");
      await g.until(() => g.bags.some((b) => b.boss), 2000, "мешок босса");
      const bag = g.bags.find((b) => b.boss)!;
      const uniq = bag.items.find((it: any) => it.unique);
      assert(uniq && MOBS[id].uniques!.includes(uniq.unique), "нет уникального предмета босса");
      await g.until(() => (g.self!.bossKills[id] || 0) === 1, 2000, "счётчик боссов");
      await g.leave();
      return uniq.name;
    };
    await check("Древний Энт: корни, вторая фаза, саженцы, уникальный лут", async () => {
      const name = await bossTest("ent", "warrior", [0.45], (fx) =>
        fx.some((f) => f.t === "spawn" && f.k === "nature") ? null : "саженцы не призваны");
      console.log("       добыча:", name);
    });
    await check("Болотная Ведьма: лужи яда, телепорт, ярость в 3-й фазе", async () => {
      const name = await bossTest("witch", "mage", [0.55, 0.2], (fx) =>
        !fx.some((f) => f.t === "hazard") ? "нет ядовитых луж" : !fx.some((f) => f.t === "buff" && f.k === "enrage") ? "нет ярости" : null);
      console.log("       добыча:", name);
    });
    await check("Повелитель Пепла: дыхание, метеоры, кольцо пламени", async () => {
      const name = await bossTest("ashlord", "ranger", [0.6, 0.3], (fx) =>
        !fx.some((f) => f.t === "tele" && f.shape === "cone") ? "нет огненного дыхания" : !fx.some((f) => f.t === "tele" && f.shape === "ring") ? "нет кольца пламени" : null);
      console.log("       добыча:", name);
    });
    console.log(`\nВсе проверки пройдены: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}

/** Следующие этапы подключаются сюда. */
let stage6: ((a: Bot, b: Bot, c: Bot) => Promise<void>) | undefined;
export function registerStages(fn: typeof stage6) {
  stage6 = fn;
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
