/** Состояние «в бою»: TEST_PORT=2641 npx tsx tests/combat.ts */
import { assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";
import { generateMap } from "../shared/map";
import { MAP_SEED } from "../shared/constants";

const MAP = generateMap(MAP_SEED);
const town = MAP.playerSpawn;
const slime = MAP.spawns.filter((s) => s.mob === "slime").sort((a, b) => Math.hypot(a.x - town.x, a.y - town.y) - Math.hypot(b.x - town.x, b.y - town.y))[0];

type C = Bot & { combat: boolean; casts: number[] };
async function join(name: string): Promise<C> {
  const b = (await Bot.join(name, "secret")) as C;
  b.combat = false;
  b.casts = [];
  b.room.onMessage("combat", (m) => (b.combat = m.on));
  b.room.onMessage("mountcast", (m) => { if (m.ms > 0) b.casts.push(m.ms); });
  return b;
}
/** Попытка призвать маунта: true, если пошёл каст (и сразу отменяем). */
async function tryMount(b: C): Promise<boolean> {
  b.toasts.length = 0;
  const n = b.casts.length;
  b.send("mount:toggle");
  await sleep(300);
  const ok = b.casts.length > n;
  if (ok) { b.send("mount:toggle"); await sleep(150); }
  else assert(b.toasts.some((t) => t.includes("в бою")), "нет ни каста, ни сообщения о бое: " + b.toasts.join("|"));
  return ok;
}

async function main() {
  await startServer();
  try {
    let a = await join("Комбат");
    a.send("dbg", { op: "level", v: 10 });
    await sleep(400);
    await check("убийство моба: в бою, через 5 с маунт разрешён", async () => {
      a.send("dbg", { op: "tp", x: slime.x + 30, y: slime.y });
      await sleep(400);
      let id: string | null = null, bd = 150;
      a.room.state.mobs.forEach((m: any, k: string) => { const d = Math.hypot(m.x - slime.x, m.y - slime.y); if (m.anim !== 4 && m.sprite === "slime" && d < bd) { bd = d; id = k; } });
      assert(id, "слизень не найден");
      a.send("target", { id });
      await a.until(() => a.room.state.mobs.get(id!)?.anim === 4, 20000, "моб убит");
      assert(a.combat, "флаг боя не пришёл клиенту");
      assert(!(await tryMount(a)), "маунт призван в бою");
      a.send("dbg", { op: "tp", x: town.x, y: town.y });
      await sleep(5600);
      assert(!a.combat, "флаг боя не снят через 5 с");
      assert(await tryMount(a), "маунт не призывается через 5 с после боя");
    });
    await check("урон среды (без источника) боем не считается", async () => {
      a.send("dbg", { op: "calm" });
      a.send("dbg", { op: "hurt", v: 5 });
      await sleep(400);
      assert(!a.combat, "урон среды включил бой");
      assert(await tryMount(a), "маунт недоступен после урона среды");
    });
    await check("питомец/бафф без врагов боем не считается", async () => {
      a.send("pet:toggle");
      await sleep(1500);
      assert(!a.combat, "бой без врагов");
      assert(await tryMount(a), "маунт недоступен с питомцем");
    });
    await check("после переподключения маунт разрешён", async () => {
      await a.leave();
      await sleep(300);
      a = await join("Комбат");
      await sleep(400);
      assert(!a.combat, "бой после входа");
      assert(await tryMount(a), "маунт недоступен после входа");
    });
    console.log(`Пройдено: ${passedCount()}`);
  } finally {
    await stopServer();
  }
}
main().catch((e) => { console.error(e); stopServer().finally(() => process.exit(1)); });
