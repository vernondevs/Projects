/** Города на сервере: открытие телепортов, телепорт-кастинг (3 с) и задания. Всё проверяется здесь, клиент шлёт намерения. */
import { cityAtTile, cityById, stoneNear, teleportPrice, TELEPORT_CAST_MS } from "../../../shared/cities";
import { TILE } from "../../../shared/constants";
import { makeItem, Rarity } from "../../../shared/items";
import { QUESTS, QUEST_GIVERS, QUEST_MAX_ACTIVE } from "../../../shared/quests";
import { MERCHANT_RANGE } from "../../../shared/constants";
import type { On } from "../rooms/common";
import { addItem } from "./inventory";
import type { Player } from "./Player";
import { gainXp } from "./rewards";
import type { World } from "./World";

const err = (p: Player, text: string) => p.send("toast", { text, kind: "error" });

/** Каждый тик: открытие города при входе в его зону и ход каста телепорта. */
export function tickCities(w: World) {
  if (w.opts.mobs === false) return;
  for (const p of w.players.values()) {
    if (p.dead || p.team !== 0) continue;
    const c = cityAtTile(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (c) {
      const found = (p.save.cities ??= []);
      if (c.id !== "ember" && !found.includes(c.id)) {
        found.push(c.id);
        p.selfDirty = true;
        p.send("toast", { text: `Открыт телепорт: ${c.name}`, kind: "level" });
      } else if (c.id === "ember" && !found.includes("ember")) {
        found.push("ember");
        p.selfDirty = true;
      }
    }
    const t = p.tele;
    if (!t) continue;
    if (Math.hypot(p.x - t.x, p.y - t.y) > 0.5 || p.input.mx || p.input.my || p.moveTo || p.stunUntil > w.time) {
      w.breakMount(p);
    } else if (w.time >= t.until) {
      p.tele = null;
      p.send("mountcast", { ms: 0 });
      const to = cityById(t.to);
      if (!to || p.save.gold < t.price) continue;
      p.save.gold -= t.price;
      p.unit.x = to.arrive.x;
      p.unit.y = to.arrive.y;
      p.moveTo = null;
      p.nav.reset();
      p.selfDirty = true;
      p.send("toast", { text: `Телепорт: ${to.name} (−${t.price} з)`, kind: "info" });
    }
  }
}

/** Начать телепорт к открытому городу: рядом с камнем, не в бою, хватает золота. */
export function startTeleport(w: World, p: Player, id: unknown) {
  if (typeof id !== "string" || p.dead || p.team !== 0 || w.opts.mobs === false) return;
  const from = stoneNear(p.x, p.y);
  if (!from) return err(p, "Подойдите к камню телепорта");
  const to = cityById(id);
  const found = p.save.cities ?? [];
  if (!to || to.id === from.id || (to.id !== "ember" && !found.includes(to.id))) return err(p, "Этот телепорт не открыт");
  if (p.tele) return;
  if (p.inCombat(w.time)) return err(p, "Нельзя телепортироваться в бою");
  if (p.stunUntil > w.time || p.mountCast) return;
  const price = teleportPrice(from, to);
  if (p.save.gold < price) return err(p, "Не хватает золота");
  w.breakMount(p);
  p.input = { mx: 0, my: 0 };
  p.moveTo = null;
  p.tele = { until: w.time + TELEPORT_CAST_MS, x: p.x, y: p.y, to: to.id, price };
  p.send("mountcast", { ms: TELEPORT_CAST_MS, name: `Телепорт: ${to.name}` });
}

// ---------- задания ----------
const qs = (p: Player) => (p.save.quests ??= { active: {}, done: [] });

/** Прогресс «убить» / «добыть»: кто выполняет — те, у кого задание активно. */
export function questProgress(p: Player, kind: "kill" | "gather", target: string, n = 1) {
  const q = p.save.quests;
  if (!q) return;
  let changed = false;
  for (const [id, have] of Object.entries(q.active)) {
    const def = QUESTS[id];
    if (!def || def.kind !== kind || def.target !== target || have >= def.n) continue;
    q.active[id] = Math.min(def.n, have + n);
    changed = true;
    if (q.active[id] >= def.n) p.send("toast", { text: `Задание выполнено: ${def.name}. Вернитесь к заказчику`, kind: "level" });
  }
  if (changed) p.selfDirty = true;
}

function nearGiver(w: World, p: Player, giver: string) {
  const g = QUEST_GIVERS.find((x) => x.id === giver);
  return !!g && w.dist(p, g) <= MERCHANT_RANGE;
}

function accept(w: World, p: Player, id: unknown) {
  const def = typeof id === "string" ? QUESTS[id] : undefined;
  if (!def || p.dead) return;
  if (!nearGiver(w, p, def.giver)) return err(p, "Заказчик далеко");
  const q = qs(p);
  if (q.done.includes(def.id) || def.id in q.active) return;
  if (p.level < def.level) return err(p, `Нужен ${def.level} уровень`);
  if (Object.keys(q.active).length >= QUEST_MAX_ACTIVE) return err(p, "Слишком много активных заданий");
  q.active[def.id] = 0;
  p.selfDirty = true;
  p.send("toast", { text: `Задание принято: ${def.name}`, kind: "info" });
}

function turnIn(w: World, p: Player, id: unknown) {
  const def = typeof id === "string" ? QUESTS[id] : undefined;
  if (!def || p.dead) return;
  if (!nearGiver(w, p, def.giver)) return err(p, "Заказчик далеко");
  const q = qs(p);
  if ((q.active[def.id] ?? -1) < def.n) return;
  const backup = JSON.stringify(p.save.inventory);
  if (def.reward.item && !addItem(p, { ...makeItem(def.reward.item.base, 1, Rarity.Common), qty: def.reward.item.qty })) {
    p.save.inventory = JSON.parse(backup);
    return err(p, "Сумка полна");
  }
  delete q.active[def.id];
  q.done.push(def.id);
  p.save.gold += def.reward.gold;
  gainXp(w, p, def.reward.xp);
  p.selfDirty = true;
  p.send("toast", { text: `Задание сдано: ${def.name} (+${def.reward.gold} з, +${def.reward.xp} опыта)`, kind: "loot" });
}

export function registerCities(on: On, w: () => World) {
  on<{ id: unknown }>("tp:go", (p, m) => startTeleport(w(), p, m.id));
  on<{ id: unknown }>("quest:accept", (p, m) => accept(w(), p, m.id));
  on<{ id: unknown }>("quest:turn", (p, m) => turnIn(w(), p, m.id));
}
