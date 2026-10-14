/**
 * Просмотр базы игроков (только чтение, можно запускать при работающем сервере).
 *   npm run db                 — список героев
 *   npm run db -- Имя          — подробности о герое
 *   npm run db -- Имя --json   — сырой JSON прогресса
 *   npm run db -- admin Имя on|off — выдать или снять права администратора
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CLASSES, STAT_NAMES, type ClassId, type StatKey } from "../shared/classes";
import { ITEM_STAT_NAMES, RARITY_NAMES, SLOT_NAMES, SLOTS, type Item, type ItemStatKey } from "../shared/items";
import { MOBS } from "../shared/mobs";
import { SKILLS } from "../shared/skills";
import type { PlayerSave } from "../server/src/db";

const file = process.env.DB_PATH || path.resolve("server/data/game.sqlite");
if (!fs.existsSync(file)) {
  console.log(`Базы пока нет (${file}). Она появится после первого входа в игру.`);
  process.exit(0);
}
const args = process.argv.slice(2);
if (args[0] === "admin") {
  const [, who, mode] = args;
  if (!who || (mode !== "on" && mode !== "off")) {
    console.log("Использование: npm run db -- admin <имя> on|off");
    process.exit(1);
  }
  const w = new DatabaseSync(file);
  w.exec("PRAGMA busy_timeout = 5000");
  const cols = (w.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("admin")) w.exec("ALTER TABLE players ADD COLUMN admin INTEGER NOT NULL DEFAULT 0");
  const n = Number(w.prepare("UPDATE players SET admin = ? WHERE name_key = ?").run(mode === "on" ? 1 : 0, who.trim().toLowerCase()).changes);
  console.log(n ? `Администратор ${who}: ${mode === "on" ? "выдан" : "снят"}. Действует после следующего входа.` : `Герой «${who}» не найден.`);
  w.close();
  process.exit(n ? 0 : 1);
}
const db = new DatabaseSync(file, { readOnly: true });
const json = args.includes("--json");
const name = args.find((a) => !a.startsWith("--"));
const date = (ms: number) => new Date(ms).toLocaleString("ru-RU");

type Row = { name: string; cls: ClassId; level: number; data: string; created: number; updated: number };

if (!name) {
  const rows = db.prepare("SELECT name, cls, level, data, created, updated FROM players ORDER BY level DESC, updated DESC").all() as Row[];
  if (!rows.length) console.log("В базе пока нет героев.");
  else {
    console.table(
      rows.map((r) => {
        const s = JSON.parse(r.data) as PlayerSave;
        return {
          "Имя": r.name,
          "Класс": CLASSES[r.cls]?.name ?? r.cls,
          "Ур.": r.level,
          "Золото": s.gold,
          "Убито": s.kills,
          "Боссов": Object.values(s.bossKills).reduce((a, b) => a + b, 0),
          "Вещей": s.inventory.filter(Boolean).length,
          "Сохранён": date(r.updated),
        };
      }),
    );
    console.log(`Всего героев: ${rows.length}. Подробности: npm run db -- <имя>`);
  }
} else {
  const r = db.prepare("SELECT name, cls, level, data, created, updated FROM players WHERE name_key = ?").get(name.trim().toLowerCase()) as Row | undefined;
  if (!r) {
    console.log(`Герой «${name}» не найден.`);
    process.exit(1);
  }
  const s = JSON.parse(r.data) as PlayerSave;
  if (json) {
    console.log(JSON.stringify(s, null, 2));
  } else {
    const itemLine = (it: Item) => {
      const stats = Object.entries(it.stats).map(([k, v]) => `${ITEM_STAT_NAMES[k as ItemStatKey]} ${v}`).join(", ");
      return `${it.name}${it.qty && it.qty > 1 ? ` ×${it.qty}` : ""} [${RARITY_NAMES[it.rarity]}, ур. ${it.ilvl}]${stats ? ` — ${stats}` : ""}`;
    };
    console.log(`${r.name} — ${CLASSES[r.cls]?.name ?? r.cls}, ${s.level} уровень, опыт ${s.xp}, золото ${s.gold}`);
    console.log(`Создан ${date(r.created)}, сохранён ${date(r.updated)}`);
    console.log(`Позиция ${Math.round(s.x)}, ${Math.round(s.y)} · здоровье ${s.hp < 0 ? "полное" : s.hp} · мана ${s.mp}`);
    console.log(`Убито врагов: ${s.kills}`);
    const bosses = Object.entries(s.bossKills).map(([id, n]) => `${MOBS[id]?.name ?? id} ×${n}`);
    console.log(`Боссы: ${bosses.length ? bosses.join(", ") : "нет"}`);
    console.log(`\nВложенные очки: ${(Object.keys(STAT_NAMES) as StatKey[]).map((k) => `${STAT_NAMES[k]} ${s.alloc[k]}`).join(", ")}`);
    console.log(`Умения: ${Object.entries(s.skills).map(([id, rank]) => `${SKILLS[id]?.name ?? id} ${rank}`).join(", ")}`);
    console.log("\nЭкипировка:");
    for (const slot of SLOTS) console.log(`  ${SLOT_NAMES[slot].padEnd(8)} ${s.equip[slot] ? itemLine(s.equip[slot]!) : "—"}`);
    const inv = s.inventory.map((it, i) => [it, i] as const).filter(([it]) => it);
    console.log(`\nСумка (${inv.length}/${s.inventory.length}):`);
    for (const [it, i] of inv) console.log(`  ${String(i + 1).padStart(2)}. ${itemLine(it!)}`);
  }
}
db.close();
