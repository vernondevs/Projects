/** Случайные встречи в пути: режиссёр раз в 2-4 минуты подбрасывает игроку путника, засаду или торговца. Тексты и шансы — data/encounters.json. */
import data from "../../../data/encounters.json";
import { CLASSES } from "../../../shared/classes";
import { MERCHANT_RANGE, TILE } from "../../../shared/constants";
import { FOOD_IDS, FOOD } from "../../../shared/food";
import { BASE_ITEMS, EQUIP_BASES, itemValue, makeItem, Rarity, type Item } from "../../../shared/items";
import { roadDist, walkable, zoneAtPx, Zone, ZONES } from "../../../shared/map";
import { MOBS } from "../../../shared/mobs";
import type { On } from "../rooms/common";
import { addItem } from "./inventory";
import { Mob } from "./Mob";
import type { Player } from "./Player";
import { gainXp } from "./rewards";
import type { World } from "./World";

export type EncKind = "traveler" | "ambush" | "merchant";
import type { EncDialogMsg, EncNpcMsg, EncShopMsg } from "../../../shared/encounters";

interface Enc {
  kind: EncKind;
  npcId: string;
  x: number;
  y: number;
  expireAt: number;
  phase: "idle" | "guard" | "leaving";
  mobIds: string[];
  level: number;
  stock: { item: Item; price: number; sold: boolean }[];
}

const D = data.kinds;
const encs = new WeakMap<World, Map<string, Enc>>();
const nextAt = new WeakMap<World, Map<string, number>>();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const toast = (p: Player, text: string, kind = "info") => p.send("toast", { text, kind });
const get = (w: World) => encs.get(w) ?? encs.set(w, new Map()).get(w)!;

const npcDef = (k: "traveler" | "merchant") => D[k].npc as { name: string; sprite: string; tint: string; color: string; icon: string; lying?: boolean };
const classPool = (p: Player) => EQUIP_BASES.filter((b) => !BASE_ITEMS[b].classes || BASE_ITEMS[b].classes!.includes(p.cls));
const badZone = (z: Zone) => z === Zone.Town || z === Zone.Dungeon || z === Zone.Arena || z === Zone.Frontier;

/** Подходящая точка рядом с игроком: проходимая, не в городе/подземелье, по возможности у дороги. */
function findSpot(w: World, p: Player): { x: number; y: number } | null {
  let best: { x: number; y: number; road: number } | null = null;
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2, d = rnd(data.spawnDist[0], data.spawnDist[1]);
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (!walkable(w.map, x, y, 14) || badZone(zoneAtPx(w.map, x, y))) continue;
    const road = roadDist(x / TILE, y / TILE);
    if (!best || road < best.road) best = { x, y, road };
    if (road < 1.5) break;
  }
  return best;
}

function zoneLevel(w: World, p: Player, x: number, y: number): number {
  const [lo, hi] = ZONES[zoneAtPx(w.map, x, y)].levels;
  return Math.max(lo || 1, Math.min(hi || 60, p.level));
}

function spawnMob(w: World, e: Enc, id: string, level: number, at: { x: number; y: number }, leader = false): Mob {
  const m = new Mob(w.uid("m"), MOBS[id], level, { x: at.x, y: at.y });
  m.summoned = true;
  m.rollElite();
  if (leader) {
    const g = m.stats.gold;
    m.stats = { ...m.stats, gold: [g[0] * D.ambush.leaderGoldMul, g[1] * D.ambush.leaderGoldMul] };
  }
  w.addMob(m);
  w.emit({ t: "spawn", id: m.id, k: "smoke" });
  e.mobIds.push(m.id);
  return m;
}

function ring(w: World, p: Player, i: number, n: number, r: number) {
  for (let t = 0; t < 8; t++) {
    const a = ((i + Math.random() * 0.4) / n) * Math.PI * 2 + t;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (walkable(w.map, x, y, 12)) return { x, y };
  }
  return { x: p.x, y: p.y };
}

function sendNpc(p: Player, e: Enc) {
  const n = npcDef(e.kind as "traveler" | "merchant");
  const msg: EncNpcMsg = { id: e.npcId, name: n.name, sprite: n.sprite, tint: Number(n.tint), color: n.color, icon: n.icon, lying: !!n.lying, x: e.x, y: e.y };
  p.send("enc:npc", msg);
}

function makeStock(p: Player): Enc["stock"] {
  const stock: Enc["stock"] = [];
  const pool = classPool(p);
  const weapons = CLASSES[p.cls].weaponTypes;
  for (let i = 0; i < D.merchant.rareItems; i++) {
    const base = i === 0 ? pick(pool.filter((b) => weapons.includes(b)).concat(pool)) : pick(pool);
    const it = makeItem(base, p.level, Math.random() < 0.35 ? Rarity.Epic : Rarity.Rare);
    stock.push({ item: it, price: Math.round(itemValue(it) * 4 * D.merchant.priceMul), sold: false });
  }
  const dishes = FOOD_IDS.filter((id) => FOOD[id].req <= p.level);
  if (dishes.length) {
    const d = FOOD[pick(dishes)];
    const it = { ...makeItem(`food_${d.id}`, 1, Rarity.Common), qty: 3 };
    stock.push({ item: it, price: Math.round(d.price * 3 * D.merchant.priceMul), sold: false });
  } else {
    stock.push({ item: { ...makeItem("hp_potion", 1, Rarity.Common), qty: 5 }, price: Math.round((BASE_ITEMS.hp_potion.price ?? 15) * 5 * D.merchant.priceMul), sold: false });
  }
  return stock;
}

/** Запустить встречу игроку (режиссёр или админ). Возвращает название или null. */
export function startEncounter(w: World, p: Player, force?: EncKind): string | null {
  const all = get(w);
  if (all.has(p.id) || badZone(zoneAtPx(w.map, p.x, p.y))) return null;
  const spot = findSpot(w, p);
  if (!spot) return null;
  const kinds = Object.keys(D) as EncKind[];
  let kind = force;
  if (!kind) {
    let r = Math.random() * kinds.reduce((s, k) => s + D[k].weight, 0);
    kind = kinds.find((k) => (r -= D[k].weight) < 0) ?? kinds[0];
  }
  const level = zoneLevel(w, p, spot.x, spot.y);
  const e: Enc = { kind, npcId: w.uid("e"), x: spot.x, y: spot.y, expireAt: w.time + data.lifetimeSec * 1000, phase: "idle", mobIds: [], level, stock: [] };
  all.set(p.id, e);
  toast(p, `Вы встретили: ${D[kind].title}`, "info");
  if (kind === "ambush") {
    const n = Math.round(rnd(D.ambush.count[0], D.ambush.count[1] + 0.99));
    const leader = spawnMob(w, e, "bandit_leader", level, ring(w, p, 0, n, 130), true);
    for (let i = 1; i < n; i++) spawnMob(w, e, "bandit", level, ring(w, p, i, n, 130));
    w.emit({ t: "say", id: leader.id, text: D.ambush.shout });
  } else {
    if (kind === "merchant") e.stock = makeStock(p);
    sendNpc(p, e);
  }
  return D[kind].title;
}

const say = (p: Player, e: Enc, text: string) => p.send("enc:say", { id: e.npcId, text });

/** Путник благодарит, уходит и исчезает. */
function leave(w: World, p: Player, e: Enc) {
  say(p, e, pick(D.traveler.thanks));
  e.phase = "leaving";
  e.expireAt = w.time + 5500;
  p.send("enc:move", { id: e.npcId, x: e.x + (Math.random() < 0.5 ? -1 : 1) * 150, y: e.y - 20, ms: 5000 });
}

function end(w: World, p: Player | undefined, e: Enc) {
  p?.send("enc:gone", { id: e.npcId });
  for (const id of e.mobIds) {
    const m = w.mobs.get(id);
    if (m) w.removeMob(m);
  }
  const all = get(w);
  for (const [k, v] of all) if (v === e) all.delete(k);
}

function rewardTraveler(w: World, p: Player, e: Enc) {
  const T = D.traveler;
  const gold = Math.round(T.gold[0] + e.level * T.gold[1]);
  const xp = Math.round(T.xp[0] + e.level * T.xp[1]);
  p.save.gold += gold;
  gainXp(w, p, xp);
  let extra = "";
  if (Math.random() < T.rareChance) {
    const it = makeItem(pick(classPool(p)), e.level, Rarity.Rare);
    if (addItem(p, it)) extra = `, ${it.name}`;
  }
  p.selfDirty = true;
  toast(p, `Награда: +${gold} з, +${xp} опыта${extra}`, "loot");
}

function dialog(e: Enc): EncDialogMsg {
  const T = D.traveler, name = npcDef("traveler").name;
  if (e.phase === "idle") return { id: e.npcId, name, text: T.intro, opts: [{ id: "potion", label: T.opts.potion }, { id: "guard", label: T.opts.guard }] };
  return { id: e.npcId, name, text: T.busy, opts: [] };
}

const near = (w: World, p: Player, e: Enc) => w.dist(p, e) <= MERCHANT_RANGE + 30;

function shopMsg(w: World, e: Enc): EncShopMsg {
  return {
    id: e.npcId,
    name: npcDef("merchant").name,
    text: D.merchant.intro,
    until: Math.max(0, Math.round((e.expireAt - w.time) / 1000)),
    stock: e.stock.map((s, idx) => ({ idx, item: s.item, price: s.price, sold: s.sold })).filter((s) => !s.sold).map(({ idx, item, price }) => ({ idx, item, price })),
  };
}

export function registerEncounters(on: On, world: () => World) {
  on<{ id: unknown }>("enc:talk", (p, m) => {
    const w = world(), e = get(w).get(p.id);
    if (!e || m.id !== e.npcId || p.dead || e.kind === "ambush") return;
    if (!near(w, p, e)) return toast(p, "Подойдите ближе", "error");
    if (e.kind === "merchant") p.send("enc:shop", shopMsg(w, e));
    else p.send("enc:dialog", dialog(e));
  });
  on<{ id: unknown; opt: unknown }>("enc:act", (p, m) => {
    const w = world(), e = get(w).get(p.id);
    if (!e || m.id !== e.npcId || e.kind !== "traveler" || e.phase !== "idle" || p.dead) return;
    if (!near(w, p, e)) return toast(p, "Подойдите ближе", "error");
    if (m.opt === "potion") {
      const inv = p.save.inventory;
      const i = inv.findIndex((it) => it && it.base === "hp_potion");
      if (i < 0) return toast(p, D.traveler.noPotion, "error");
      const it = inv[i]!;
      it.qty = (it.qty ?? 1) - 1;
      if (it.qty <= 0) inv[i] = null;
      p.selfDirty = true;
      rewardTraveler(w, p, e);
      leave(w, p, e);
    } else if (m.opt === "guard") {
      e.phase = "guard";
      say(p, e, D.traveler.guardStart);
      for (let i = 0; i < D.traveler.mobs; i++) spawnMob(w, e, "bandit", e.level, ring(w, p, i, D.traveler.mobs, 140));
    } else return;
    p.send("enc:dialog", dialog(e));
  });
  on<{ id: unknown; idx: unknown }>("enc:buy", (p, m) => {
    const w = world(), e = get(w).get(p.id);
    if (!e || m.id !== e.npcId || e.kind !== "merchant" || p.dead) return;
    if (!near(w, p, e)) return toast(p, "Торговец далеко", "error");
    const s = Number.isInteger(m.idx) ? e.stock[m.idx as number] : undefined;
    if (!s || s.sold) return;
    if (p.save.gold < s.price) return toast(p, "Не хватает золота", "error");
    if (!addItem(p, { ...s.item })) return toast(p, "Сумка полна", "error");
    p.save.gold -= s.price;
    s.sold = true;
    p.selfDirty = true;
    toast(p, `Куплено: ${s.item.name}`, "loot");
    p.send("enc:shop", shopMsg(w, e));
  });
}

/** Тик режиссёра: вызывается из World.update. */
export function tickEncounters(w: World) {
  const all = get(w);
  const nx = nextAt.get(w) ?? nextAt.set(w, new Map()).get(w)!;
  for (const [pid, e] of [...all]) {
    const p = w.players.get(pid);
    if (!p) { end(w, undefined, e); continue; }
    if (w.time >= e.expireAt) { end(w, p, e); continue; }
    if (e.kind === "ambush" || e.phase === "guard") {
      const alive = e.mobIds.some((id) => { const m = w.mobs.get(id); return m && !m.dead; });
      if (alive) continue;
      if (e.kind === "traveler") { rewardTraveler(w, p, e); leave(w, p, e); }
      else end(w, p, e);
    }
  }
  for (const p of w.players.values()) {
    const t = nx.get(p.id);
    if (t === undefined) { nx.set(p.id, w.time + rnd(data.intervalSec[0], data.intervalSec[1]) * 1000); continue; }
    if (w.time < t || all.has(p.id) || p.dead || p.team !== 0 || badZone(zoneAtPx(w.map, p.x, p.y))) continue;
    nx.set(p.id, w.time + rnd(data.intervalSec[0], data.intervalSec[1]) * 1000);
    startEncounter(w, p);
  }
}
