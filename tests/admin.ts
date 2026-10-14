/** Админ-команды: не-админ игнорируется, админ работает. Запуск: npx tsx tests/admin.ts */
import { DatabaseSync } from "node:sqlite";
import { assert, Bot, check, dbFile, passedCount, sleep, startServer, stopServer } from "./harness";

async function main() {
  await startServer();
  try {
    const user = await Bot.join("Простой", "secret");
    const adm = await Bot.join("Админ1", "secret");
    await check("не-админ: admin:gold игнорируется", async () => {
      const g = user.self!.gold;
      user.send("admin:gold", { name: "Простой", v: 500 });
      await sleep(500);
      assert(user.self!.gold === g, "золото изменилось");
    });
    await check("админ (флаг в БД): admin:gold работает", async () => {
      const db = new DatabaseSync(dbFile);
      db.prepare("UPDATE players SET admin = 1 WHERE name_key = 'админ1'").run();
      db.close();
      const g = user.self!.gold;
      adm.send("admin:gold", { name: "Простой", v: 500 });
      await user.until(() => user.self!.gold === g + 500, 2000, "золото +500");
      const d = new DatabaseSync(dbFile);
      const rows = d.prepare("SELECT action FROM admin_log ORDER BY id").all() as { action: string }[];
      d.close();
      assert(rows.some((r) => r.action === "denied:admin:gold") && rows.some((r) => r.action === "gold"), "журнал: " + JSON.stringify(rows));
    });
  } finally {
    await stopServer();
  }
  console.log(`Пройдено: ${passedCount()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
