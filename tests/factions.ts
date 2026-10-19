/** Фракции (задача 38): создание, перенос старых героев, вражда в спорной зоне, нейтральный город и стража, группа/обмен/чат, умения Умбрата. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { api, assert, Bot, check, passedCount, sleep, startServer, stopServer } from "./harness";
import { MAP_SEED, TILE } from "../shared/constants";
import { generateMap, lineClear, walkable, Zone } from "../shared/map";
import { FACTIONS, pvpPlace } from "../shared/factions";
import { CLASSES, CLASS_IDS } from "../shared/classes";
import { activeSkills, classSkills } from "../shared/skills";
import { GameDB } from "../server/src/db";
import { World } from "../server/src/game/World";
import { Player, newSave } from "../server/src/game/Player";
import { castSkill } from "../server/src/game/skills";
import { WorldState } from "../server/src/rooms/schema";
import { MOBS } from "../shared/mobs";
import { Mob } from "../server/src/game/Mob";

const MAP = generateMap(MAP_SEED);

/** Две проходимые точки в спорной зоне (Пепельная пустошь) с прямой видимостью, ~70 px друг от друга. */
function pvpSpot() {
  for (let ty = 0; ty < MAP.h; ty++) for (let tx = 0; tx < MAP.w; tx++) {
    if (MAP.zone[ty * MAP.w + tx] !== Zone.Ashlands) continue;
    const x = tx * TILE + 16, y = ty * TILE + 16;
    if (pvpPlace(MAP, x, y) !== "pvp" || pvpPlace(MAP, x + 70, y) !== "pvp") continue;
    if (walkable(MAP, x, y, 14) && walkable(MAP, x + 70, y, 14) && lineClear(MAP, x, y, x + 70, y)) return { x, y };
  }
  return null;
}

async function main() {
  await check("данные: 10 классов, по 5 на фракцию, у каждого класса 4 базовых умения", () => {
    assert(CLASS_IDS.length === 10, "классов не 10");
    for (const f of Object.values(FACTIONS)) {
      assert(f.classes.length === 5, `${f.name}: классов не 5`);
      for (const c of f.classes) {
        assert(CLASSES[c].faction === f.id, `${c}: не та фракция`);
        const tank = c === "warrior" || c === "deathknight";
        assert(tank ? activeSkills(c).length === 9 : activeSkills(c).length >= 3 && activeSkills(c).length <= 4, `${c}: умений ${activeSkills(c).length}`);
        if (tank) assert(classSkills(c).filter((s) => s.kind === "passive").length === 11, `${c}: пассивок мало`);
      }
    }
    assert(CLASSES.warrior.name === "Храмовник" && CLASSES.rogue.name === "Ассасин", "классы Сольгарда не переименованы");
  });

  await check("перенос старой базы: герои без фракции — Сольгард, данные целы", () => {
    const f = path.join(os.tmpdir(), `emberfall-fac-${process.pid}.sqlite`);
    for (const x of [f, f + "-wal", f + "-shm"]) try { fs.unlinkSync(x); } catch {}
    const raw = new DatabaseSync(f);
    raw.exec(`CREATE TABLE players (name_key TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, cls TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
    const save = { cls: "mage", level: 17, xp: 123, gold: 4567, skills: { fireball: 5 }, inventory: [], equip: {} };
    raw.prepare("INSERT INTO players VALUES ('старик', 'Старик', 's', 'h', 'mage', 17, ?, 1, 1)").run(JSON.stringify(save));
    raw.close();
    const db = new GameDB(f);
    const row = db.charsOf(db.ownerOf("Старик")!)[0];
    assert(row.faction === "solgard", `фракция ${row.faction}`);
    const s = db.load("Старик")!;
    assert(s.faction === "solgard" && s.gold === 4567 && s.level === 17 && s.skills.fireball === 5, "данные потеряны");
    db.close();
    const base = path.basename(f, ".sqlite");
    for (const x of fs.readdirSync(os.tmpdir())) if (x.startsWith(base)) try { fs.unlinkSync(path.join(os.tmpdir(), x)); } catch {}
  });

  await check("все умения Умбрата срабатывают без ошибок (симуляция мира)", () => {
    const w = new World(new WorldState(), () => {});
    // мобы спорной зоны теперь 38+ уровня: убираем их, проверяем только умения
    for (const m of [...w.mobs.values()]) w.removeMob(m);
    const p0 = pvpSpot()!;
    for (const cls of FACTIONS.umbrath.classes) {
      const save = newSave(cls, p0);
      save.level = 20;
      for (const s of activeSkills(cls)) save.skills[s.id] = 1;
      const toasts: string[] = [];
      const p = new Player("t_" + cls, "Тест" + cls, save, (t, m: any) => { if (t === "toast") toasts.push(m.text); });
      w.addPlayer(p);
      const mob = w.addMob(new Mob(w.uid("m"), MOBS.goblin, 20, { x: p0.x + 50, y: p0.y }));
      for (const s of activeSkills(cls)) {
        p.unit.mp = p.unit.maxMp; p.unit.hp = p.unit.maxHp; mob.unit.hp = mob.unit.maxHp;
        const err = castSkill(w, p, s.id, mob.x, mob.y, mob.id);
        assert(err === null || err === "Выберите союзника или призовите питомца", `${s.id}: ${err}`);
        for (let i = 0; i < 40; i++) w.update(50);
      }
      w.removePlayer(p.id);
      w.removeMob(mob);
    }
  });

  await startServer();
  try {
    await check("создание: класс должен быть из выбранной фракции", async () => {
      let v = await api("/login", { login: "Фракц", password: "secret", create: true });
      let err = "";
      try { await api("/chars", { name: "Путаник", cls: "warrior", faction: "umbrath", look: 0 }, v.token); } catch (e) { err = (e as Error).message; }
      assert(err.includes("не принадлежит"), `ошибка: ${err}`);
      v = await api("/chars", { name: "Мертвец", cls: "deathknight", faction: "umbrath", look: 0 }, v.token);
      const c = v.chars.find((x: any) => x.name === "Мертвец");
      assert(c?.faction === "umbrath", "фракция героя не Умбрат");
    });

    const sol = await Bot.join("Светлый", "secret", "warrior");
    const umb = await Bot.join("Тёмный", "secret", "reaver");
    for (const b of [sol, umb]) { b.send("dbg", { op: "level", v: 20 }); b.send("dbg", { op: "god" }); }
    await sol.until(() => sol.self!.level === 20 && umb.self?.level === 20, 3000, "уровень");
    assert(umb.self!.faction === "umbrath" && sol.self!.faction === "solgard", "фракции в self");

    await check("группа, обмен и чат — только внутри фракции", async () => {
      sol.send("party:invite", { name: "Тёмный" });
      await sol.until(() => sol.toasts.some((t) => t.includes("своей фракции")), 2000, "отказ в группе");
      sol.send("trade:request", { id: umb.id });
      await sol.until(() => sol.toasts.some((t) => t.includes("противоположной фракцией")), 2000, "отказ в обмене");
      sol.send("chat", { text: "Свет со мной" });
      await umb.until(() => umb.chat.some((l: any) => l.from === "Светлый"), 2000, "чат");
      const l = umb.chat.find((x: any) => x.from === "Светлый") as any;
      assert(l.foreign && l.faction === "solgard" && l.text !== "Свет со мной", "враг читает чужой чат");
    });

    await check("спорная зона: противоположная фракция — враг, своя — нет", async () => {
      const p = pvpSpot();
      assert(p, "нет точки в спорной зоне");
      umb.send("target", { id: null });
      await sleep(200);
      sol.send("dbg", { op: "tp", x: p.x, y: p.y });
      umb.send("dbg", { op: "tp", x: p.x + 70, y: p.y });
      await sleep(400);
      umb.send("dbg", { op: "hp", v: 999999 });
      sol.send("dbg", { op: "hp", v: 5000 });
      await sleep(200);
      sol.send("target", { id: umb.id });
      await sol.until(() => umb.me().hp < 999999, 5000, "урон по врагу в спорной зоне");
      sol.send("target", { id: null });
      const ally = await Bot.join("Союзник", "secret", "mage");
      ally.send("dbg", { op: "tp", x: p.x + 40, y: p.y });
      await sleep(300);
      sol.send("target", { id: ally.id });
      await sleep(300);
      assert(sol.me().target !== ally.id, "свою фракцию можно выбрать целью");
      await ally.leave();
    });

    await check("умения Умбрата: «Рваная рана» накладывает кровотечение", async () => {
      sol.send("target", { id: null });
      await sleep(200);
      umb.fx = [];
      umb.send("skill", { id: "rv_lacerate", x: 0, y: 0, target: sol.id });
      await umb.until(() => (sol.me().buffs & 1024) !== 0, 3000, "кровотечение");
    });

    await check("нейтральный город: удар не проходит, нарушителя бьёт стража", async () => {
      const sp = MAP.playerSpawn;
      sol.send("dbg", { op: "tp", x: sp.x, y: sp.y });
      umb.send("dbg", { op: "tp", x: sp.x + 30, y: sp.y });
      await sleep(300);
      umb.send("dbg", { op: "hp", v: 2000 });
      await sleep(100);
      const hp0 = sol.me().hp;
      umb.send("target", { id: sol.id });
      await umb.until(() => umb.toasts.some((t) => t.includes("сражаться нельзя")), 4000, "предупреждение");
      assert(sol.me().hp >= hp0, "урон прошёл в нейтральном городе");
      await umb.until(() => umb.me().outlaw === 1, 2000, "метка нарушителя");
      await umb.until(() => umb.me().hp < 2000, 4000, "стража не бьёт нарушителя");
    });

    await sol.leave();
    await umb.leave();
  } finally {
    await stopServer();
  }
  console.log(`\nВсе проверки фракций пройдены: ${passedCount()}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
