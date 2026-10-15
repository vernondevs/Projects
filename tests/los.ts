/** Линия видимости: стены подземелья блокируют удары, снаряды и площадной урон. Запуск: TEST_PORT=2741 npx tsx tests/los.ts */
import { assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";
import { BOSS_SPAWNS, generateMap, lineClear, walkable } from "../shared/map";
import { MAP_SEED } from "../shared/constants";

const MAP = generateMap(MAP_SEED);
const boss = BOSS_SPAWNS.find((x) => x.id === "ashlord")!;

/** Точка в проходимой клетке рядом с боссом, отделённая от него стеной (и ближайшая такая). */
function behindWall() {
  let best: { x: number; y: number } | null = null, bd = 1e9;
  for (let dy = -300; dy <= 300; dy += 8) for (let dx = -300; dx <= 300; dx += 8) {
    const x = boss.x + dx, y = boss.y + dy;
    if (!walkable(MAP, x, y, 14) || lineClear(MAP, boss.x, boss.y, x, y)) continue;
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}
/** Точка с открытой видимостью на боссе на расстоянии ~120. */
function inSight() {
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    const x = boss.x + Math.cos(a) * 120, y = boss.y + Math.sin(a) * 120;
    if (walkable(MAP, x, y, 14) && lineClear(MAP, boss.x, boss.y, x, y)) return { x, y };
  }
  return null;
}

async function main() {
  await startServer();
  try {
    await check("lineClear: стена блокирует, открытое место нет", () => {
      const w = behindWall(), s = inSight();
      assert(w, "нет точки за стеной у босса");
      assert(s, "нет открытой точки у босса");
      assert(!lineClear(MAP, boss.x, boss.y, w.x, w.y), "стена не блокирует");
      assert(lineClear(MAP, boss.x, boss.y, s.x, s.y), "открытое место блокируется");
    });
    await check("игрок за стеной не бьёт босса, босс не бьёт игрока", async () => {
      const w = behindWall()!;
      const g = await Bot.join("Лос1", "pass", "ranger");
      g.send("dbg", { op: "level", v: 30 });
      await g.until(() => g.self!.level === 30, 3000, "уровень");
      g.send("dbg", { op: "god" });
      g.send("dbg", { op: "tp", x: w.x, y: w.y });
      await sleep(300);
      let bossId = "";
      g.room.state.mobs.forEach((m: any, k: string) => { if (m.sprite === "ashlord") bossId = k; });
      assert(bossId, "босс не найден");
      const hp0 = g.room.state.mobs.get(bossId).hp, php0 = g.me().hp;
      g.send("target", { id: bossId });
      for (let i = 0; i < 6; i++) {
        await sleep(100);
        const m = g.room.state.mobs.get(bossId), me = g.me();
        if (lineClear(MAP, m.x, m.y, me.x, me.y)) break; // обошли стену — дальше проверка не нужна
        assert(m.hp >= hp0 && me.hp >= php0, "урон прошёл сквозь стену");
      }
      await g.leave();
    });
    await check("с открытой видимостью бой идёт", async () => {
      const s = inSight()!;
      const g = await Bot.join("Лос2", "pass", "ranger");
      g.send("dbg", { op: "level", v: 30 });
      await g.until(() => g.self!.level === 30, 3000, "уровень");
      g.send("dbg", { op: "god" });
      g.send("dbg", { op: "tp", x: s.x, y: s.y });
      await sleep(300);
      let bossId = "";
      g.room.state.mobs.forEach((m: any, k: string) => { if (m.sprite === "ashlord") bossId = k; });
      const hp0 = g.room.state.mobs.get(bossId).hp;
      g.send("target", { id: bossId });
      await g.until(() => g.room.state.mobs.get(bossId).hp < hp0, 8000, "урон по боссу");
      await g.leave();
    });
    console.log(`\nВсе проверки пройдены: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}
main().catch((e) => { console.error(e); stopServer().then(() => process.exit(1)); });
