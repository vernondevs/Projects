/**
 * Боты арены: создание героя под уровень и снаряжение игрока и простой ИИ.
 * ИИ: ближний бой — сближение (A* через Nav в World.stepToward), дальний — держит дистанцию,
 * автоатака через targetId, умения — когда готовы и хватает маны.
 */
import { CLASSES, type ClassId } from "../../../shared/classes";
import { canEquip, makeItem, SLOTS, type Item, type Slot } from "../../../shared/items";
import { walkable } from "../../../shared/map";
import { findPath } from "../../../shared/path";
import { activeSkills, classSkills } from "../../../shared/skills";
import { PLAYER_RADIUS } from "../../../shared/constants";
import type { PlayerSave } from "../db";
import { newSave, type Player } from "../game/Player";
import { castSkill } from "../game/skills";
import type { World } from "../game/World";

export interface BotSpec {
  name: string;
  nameKey: string;
  cls: ClassId;
  level: number;
  rating: number;
  save: PlayerSave;
}

const BOT_NAMES = ["Гром", "Вихрь", "Клык", "Тень", "Искра", "Буран", "Шип", "Ворон"];
const BOT_CLASSES: ClassId[] = ["warrior", "mage", "ranger"];
const MAIN_STAT: Record<ClassId, "str" | "int" | "agi"> = { warrior: "str", mage: "int", ranger: "agi" };

/** Сохранение бота: уровень и предметы как у образца, очки характеристик и умений распределены. */
export function botSave(cls: ClassId, level: number, like?: PlayerSave): PlayerSave {
  const s = newSave(cls, { x: 0, y: 0 });
  s.level = level;
  const pts = (level - 1) * 3;
  s.alloc = { str: 0, agi: 0, int: 0, vit: 0 };
  s.alloc[MAIN_STAT[cls]] = Math.ceil(pts * 0.6);
  s.alloc.vit = pts - s.alloc[MAIN_STAT[cls]];
  if (like) {
    for (const slot of SLOTS as Slot[]) {
      const it = like.equip[slot];
      if (!it) continue;
      if (slot === "weapon") {
        const w = makeItem(CLASSES[cls].startWeapon, it.ilvl, it.rarity);
        w.req = Math.min(w.req, level);
        s.equip.weapon = w;
      } else if (!canEquip(it, cls, level)) s.equip[slot] = JSON.parse(JSON.stringify(it)) as Item;
    }
  }
  // очки умений: по одному за уровень, по кругу по доступным умениям
  let free = level - 1;
  const tree = classSkills(cls);
  for (let changed = true; free > 0 && changed; ) {
    changed = false;
    for (const d of tree) {
      if (free <= 0) break;
      const r = s.skills[d.id] || 0;
      if (r >= d.maxRank || d.reqLevel > level) continue;
      if (d.req && (s.skills[d.req.id] || 0) < d.req.rank) continue;
      s.skills[d.id] = r + 1;
      free--;
      changed = true;
    }
  }
  return s;
}

/** Набор ботов с неповторяющимися именами под уровень/снаряжение образца. */
export function makeBots(count: number, level: number, rating: number, like: PlayerSave | undefined, taken: Set<string>): BotSpec[] {
  const out: BotSpec[] = [];
  const names = BOT_NAMES.filter((n) => !taken.has(n)).sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    const n = names[i] ?? `${BOT_NAMES[0]} ${i + 1}`;
    taken.add(n);
    const name = `Бот ${n}`;
    const cls = BOT_CLASSES[Math.floor(Math.random() * BOT_CLASSES.length)];
    out.push({ name, nameKey: name.toLowerCase(), cls, level, rating, save: botSave(cls, level, like) });
  }
  return out;
}

const KEEP_MIN = 140; // дальний бой: ближе — отходим

/** Один шаг решения бота (вызывается несколько раз в секунду). */
export function botThink(w: World, bot: Player, enemies: Player[]) {
  if (bot.dead || bot.frozenUntil > w.time) return;
  let target: Player | undefined, best = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - bot.x, e.y - bot.y);
    if (d < best) { best = d; target = e; }
  }
  if (!target) { bot.targetId = null; bot.moveTo = null; return; }
  bot.targetId = target.id;
  bot.unit.target = target.id;
  // дальний бой: держим дистанцию, отходя по проходимому пути
  if (bot.ranged() && best < KEEP_MIN) {
    const ang = Math.atan2(bot.y - target.y, bot.x - target.x);
    for (const da of [0, 0.7, -0.7, 1.4, -1.4]) {
      const tx = bot.x + Math.cos(ang + da) * 120, ty = bot.y + Math.sin(ang + da) * 120;
      if (walkable(w.map, tx, ty, PLAYER_RADIUS) && findPath(w.map, bot.x, bot.y, tx, ty, PLAYER_RADIUS, 800)) { bot.moveTo = { x: tx, y: ty }; break; }
    }
  } else if (bot.moveTo && best >= KEEP_MIN) bot.moveTo = null;
  // умения
  for (const s of activeSkills(bot.cls)) {
    const rank = bot.save.skills[s.id] || 0;
    if (!rank || (bot.cds.get(s.id) || 0) > w.time || bot.unit.mp < s.mana!(rank)) continue;
    const reach = s.target === "self" ? Math.max(bot.attackRange(), 90) : (s.range ?? bot.attackRange()) + 20;
    if (best > reach) continue;
    if (!castSkill(w, bot, s.id, target.x, target.y, target.id)) break; // одно умение за раз
  }
}
