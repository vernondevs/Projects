/** Админ-команды ("admin:*"): права читаются из БД на каждое действие, остальные игроки игнорируются. */
import { LEGENDARIES, makeLegendary } from "../../../shared/legendary";
import { BASE_ITEMS, makeItem, makeUnique, UNIQUES, Rarity, type Item } from "../../../shared/items";
import { MAX_LEVEL } from "../../../shared/constants";
import { xpToNext } from "../../../shared/formulas";
import { ZONES } from "../../../shared/map";
import { MOBS } from "../../../shared/mobs";
import { cleanText, num } from "../rooms/common";
import type { On } from "../rooms/common";
import type { WorldRoom } from "../rooms/WorldRoom";
import { GameDB } from "../db";
import { createBoss } from "./bosses";
import { Mob } from "./Mob";
import type { Player } from "./Player";
import { gainXp } from "./rewards";
import { addItem } from "./inventory";
import { startEncounter, type EncKind } from "./encounters";

const PERMA = 9e12;

export function registerAdmin(room: WorldRoom, on: On) {
  const db = () => room.db();
  const w = () => room.world;
  const str = (v: unknown, max = 60) => (typeof v === "string" ? cleanText(v).slice(0, max) : "");
  const toast = (p: Player, text: string, kind = "info") => p.send("toast", { text, kind });

  /** Регистрирует админ-сообщение: не-админ молча игнорируется и пишется в журнал как попытка. */
  const adm = <T>(type: string, fn: (p: Player, m: T) => void) =>
    on<T>(type, (p, m) => {
      if (!db().isAdmin(p.name)) {
        p.admin = false;
        console.warn(`[admin] попытка без прав: ${p.name} -> ${type}`);
        try { db().adminLog(p.name, "denied:" + type, "", {}); } catch {}
        return;
      }
      p.admin = true;
      fn(p, m);
    });
  const log = (p: Player, action: string, target: string, details: unknown = {}) => db().adminLog(p.name, action, target, details);
  const online = (name: string) => w().findByName(GameDB.key(name));

  adm("admin:players", (p) => {
    p.send("admin:players", [...w().players.values()].map((x) => ({ name: x.name, cls: x.cls, level: x.level, x: Math.round(x.unit.x), y: Math.round(x.unit.y), admin: x.admin })));
  });

  adm<{ name: unknown; base: unknown; unique: unknown; rarity: unknown; ilvl: unknown; qty: unknown }>("admin:give", (p, m) => {
    const t = online(str(m.name));
    if (!t) return toast(p, "Игрок не в сети", "error");
    const id = str(m.base) || str(m.unique);
    const qty = Math.round(num(m.qty, 1, 99) ?? 1);
    const mk = (): Item | null => {
      if (LEGENDARIES[id]) return makeLegendary(id);
      if (UNIQUES[id]) return makeUnique(id);
      if (BASE_ITEMS[id]) return makeItem(id, Math.round(num(m.ilvl, 1, 60) ?? 1), Math.round(num(m.rarity, 0, 3) ?? 0) as Rarity);
      return null;
    };
    const first = mk();
    if (!first) return toast(p, `Нет предмета «${id}»`, "error");
    let given = 0;
    if (BASE_ITEMS[first.base].stack) {
      first.qty = qty;
      given = addItem(t, first) ? qty : 0;
    } else for (let i = 0; i < (LEGENDARIES[id] || UNIQUES[id] ? 1 : qty); i++) if (addItem(t, i ? mk()! : first)) given++;
    if (given) toast(t, `Администратор выдал: ${first.name}${given > 1 ? " ×" + given : ""}`, "loot");
    toast(p, given ? `Выдано ${first.name} ×${given} → ${t.name}` : "Нет места в сумке", given ? "info" : "error");
    log(p, "give", t.name, { id, rarity: first.rarity, ilvl: first.ilvl, qty, given });
  });

  adm<{ name: unknown; v: unknown }>("admin:gold", (p, m) => {
    const t = online(str(m.name));
    const v = Math.round(num(m.v, -1e7, 1e7) ?? 0);
    if (!t || !v) return toast(p, "Игрок не в сети или сумма 0", "error");
    t.save.gold = Math.max(0, t.save.gold + v);
    t.selfDirty = true;
    toast(p, `Золото ${t.name}: ${v > 0 ? "+" : ""}${v}`);
    log(p, "gold", t.name, { v });
  });

  adm<{ name: unknown; xp: unknown; level: unknown }>("admin:xp", (p, m) => {
    const t = online(str(m.name));
    if (!t) return toast(p, "Игрок не в сети", "error");
    const lv = Math.round(num(m.level, 1, MAX_LEVEL) ?? 0);
    const xp = Math.round(num(m.xp, 0, 1e7) ?? 0);
    if (lv) while (t.level < lv) gainXp(w(), t, xpToNext(t.level) - t.save.xp);
    if (xp) gainXp(w(), t, xp);
    toast(p, `${t.name}: уровень ${t.level}`);
    log(p, "xp", t.name, { level: lv, xp });
  });

  adm<{ name: unknown; x: unknown; y: unknown; zone: unknown }>("admin:tp", (p, m) => {
    let pos: { x: number; y: number } | null = null;
    const target = str(m.name);
    let what = "";
    if (target) {
      const t = online(target);
      if (t) { pos = { x: t.unit.x, y: t.unit.y }; what = t.name; }
    } else if (typeof m.zone === "number" && ZONES[m.zone] && ZONES[m.zone].name !== "Арена") {
      const z = ZONES[m.zone];
      pos = z.safe ? w().map.playerSpawn : w().map.spawns.find((s) => z.mobs.includes(s.mob)) ?? null;
      what = z.name;
    } else {
      const x = num(m.x, 0, 1e6), y = num(m.y, 0, 1e6);
      if (x !== null && y !== null) { pos = { x, y }; what = `${Math.round(x)},${Math.round(y)}`; }
    }
    if (!pos) return toast(p, "Цель телепорта не найдена", "error");
    p.unit.x = pos.x;
    p.unit.y = pos.y;
    p.moveTo = null;
    p.selfDirty = true;
    log(p, "tp", what, { x: Math.round(pos.x), y: Math.round(pos.y) });
  });

  const kick = (name: string, reason: string) => {
    const t = online(name);
    if (t) room.clients.getById(t.id)?.leave(4001, reason);
    return !!t;
  };
  adm<{ name: unknown }>("admin:kick", (p, m) => {
    const name = str(m.name);
    toast(p, kick(name, "Вы отключены администратором") ? `Отключён: ${name}` : "Игрок не в сети", "info");
    log(p, "kick", name);
  });
  adm<{ name: unknown; hours: unknown; reason: unknown }>("admin:ban", (p, m) => {
    const name = str(m.name);
    const hours = num(m.hours, 0, 24 * 365) ?? 0;
    const reason = str(m.reason, 120);
    const until = hours > 0 ? Date.now() + hours * 3600_000 : PERMA;
    if (!db().setBan(name, until, reason)) return toast(p, "Такого героя нет", "error");
    kick(name, "Аккаунт заблокирован");
    toast(p, `Заблокирован: ${name}`);
    log(p, "ban", name, { hours, reason });
  });
  adm<{ name: unknown }>("admin:unban", (p, m) => {
    const name = str(m.name);
    toast(p, db().setBan(name, 0, "") ? `Разблокирован: ${name}` : "Такого героя нет", "info");
    log(p, "unban", name);
  });

  adm<{ mob: unknown; level: unknown }>("admin:spawn", (p, m) => {
    const def = MOBS[str(m.mob)];
    if (!def) return toast(p, "Нет такого моба", "error");
    const world = w();
    const level = def.level ?? Math.round(num(m.level, 1, 60) ?? p.level);
    const mob = new Mob(world.uid(def.boss ? "b" : "m"), def, level, { x: p.unit.x + 48, y: p.unit.y });
    mob.summoned = true; // без респауна, убирается после смерти
    if (def.boss) mob.boss = createBoss(world, mob, 300);
    world.addMob(mob);
    log(p, "spawn", def.id, { level, x: Math.round(p.unit.x), y: Math.round(p.unit.y) });
  });

  adm<{ name: unknown; kind: unknown }>("admin:encounter", (p, m) => {
    const t = str(m.name) ? online(str(m.name)) : p;
    const kind = ["traveler", "ambush", "merchant"].includes(str(m.kind)) ? (str(m.kind) as EncKind) : undefined;
    if (!t) return toast(p, "Игрок не в сети", "error");
    const title = startEncounter(w(), t, kind);
    toast(p, title ? `Встреча: ${title} → ${t.name}` : "Встреча не создана (уже есть или город/подземелье)", title ? "info" : "error");
    log(p, "encounter", t.name, { kind: kind ?? "random", ok: !!title });
  });

  adm<{ text: unknown }>("admin:announce", (p, m) => {
    const text = str(m.text, 140);
    if (!text) return;
    w().system(`[Объявление] ${text}`);
    room.broadcast("admin:banner", { text });
    log(p, "announce", "", { text });
  });

  adm<{ kind: unknown; name: unknown }>("admin:logs", (p, m) => {
    const name = str(m.name, 16);
    if (m.kind === "trades") p.send("admin:logs", { kind: "trades", rows: db().tradeLogRows(name) });
    else p.send("admin:logs", { kind: "admin", rows: db().adminLogRows(name) });
  });
}
