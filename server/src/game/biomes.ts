/** Биомы на сервере: жар вулкана, лава, воздух под водой и добыча ресурсов (узлы на карте). */
import { questProgress } from "./cities";
import { ENV, RESOURCES } from "../../../shared/biomes";
import { breathable, nearLava, zoneAtPx, Zone } from "../../../shared/map";
import { makeItem, Rarity } from "../../../shared/items";
import { FOOD } from "../../../shared/food";
import { addItem } from "./inventory";
import type { Player } from "./Player";
import type { World } from "./World";
import type { On } from "../rooms/common";

const AIR_MAX = ENV.airSeconds * 1000;
interface PState {
  air: number;
  acc: number;
  airSentAt: number;
  airShown: boolean;
  warnAt: number;
  cast: { node: number; until: number; x: number; y: number } | null;
}
interface WState {
  players: WeakMap<Player, PState>;
  /** id узла -> момент возрождения. */
  depleted: Map<number, number>;
  nodes: Map<number, { x: number; y: number; res: string; kind: string }>;
}
const worlds = new WeakMap<World, WState>();
function ws(w: World): WState {
  let s = worlds.get(w);
  if (!s) {
    s = { players: new WeakMap(), depleted: new Map(), nodes: new Map(w.map.nodes.map((n) => [n.id, { x: n.x, y: n.y - 14, res: n.res, kind: n.kind }])) };
    worlds.set(w, s);
  }
  return s;
}
function ps(s: WState, p: Player): PState {
  let st = s.players.get(p);
  if (!st) s.players.set(p, (st = { air: AIR_MAX, acc: 0, airSentAt: 0, airShown: false, warnAt: 0, cast: null }));
  return st;
}

/** Жаропрочная еда действует? */
export const heatResist = (p: Player) => !!p.activeFood() && !!FOOD[p.save.food!.id]?.heat;

function hurt(w: World, p: Player, pct: number, k: "fire" | "frost") {
  const v = Math.max(1, Math.round(p.unit.maxHp * pct / 100));
  w.emit({ t: "dmg", id: p.id, v, k });
  if (k === "fire") p.burnUntil = w.time + 1500;
  w.applyDamage(p, v);
}

/** Каждый тик: окружающая среда и добыча. */
export function tickBiomes(w: World, dt: number) {
  if (w.opts.mobs === false) return;
  const s = ws(w);
  for (const [id, at] of s.depleted) {
    if (w.time < at) continue;
    s.depleted.delete(id);
    w.broadcast("node", { id, up: true });
  }
  for (const p of w.players.values()) {
    const st = ps(s, p);
    if (p.dead || p.team !== 0) {
      st.air = AIR_MAX;
      st.cast = null;
      continue;
    }
    const u = p.unit;
    const z = zoneAtPx(w.map, u.x, u.y);
    // добыча
    if (st.cast) {
      const c = st.cast;
      if (Math.hypot(u.x - c.x, u.y - c.y) > 8 || p.stunUntil > w.time || p.input.mx || p.input.my) cancelGather(p, st);
      else if (w.time >= c.until) finishGather(w, s, p, st);
    }
    // воздух
    const swim = z === Zone.Underwater && !breathable(w.map, u.x, u.y);
    if (swim) st.air = Math.max(0, st.air - dt * 1000);
    else st.air = Math.min(AIR_MAX, st.air + dt * 1000 * (z === Zone.Underwater ? 6 : 10));
    const show = z === Zone.Underwater || st.air < AIR_MAX;
    if (show && w.time - st.airSentAt >= 400) {
      st.airSentAt = w.time;
      st.airShown = true;
      p.send("air", { air: Math.round(st.air), max: AIR_MAX });
    } else if (!show && st.airShown) {
      st.airShown = false;
      p.send("air", { air: -1, max: AIR_MAX });
    }
    // раз в секунду: удушье, лава, жар
    st.acc += dt * 1000;
    if (st.acc < 1000) continue;
    st.acc -= 1000;
    if (swim && st.air <= 0) {
      hurt(w, p, ENV.drownPctPerSec, "frost");
      if (w.time - st.warnAt > 8000) { st.warnAt = w.time; p.send("toast", { text: "Вы тонете! Плывите к воздушным пузырям или к берегу", kind: "error" }); }
    }
    if (z === Zone.Volcano || z === Zone.Ashlands) {
      const resist = heatResist(p);
      if (nearLava(w.map, u.x, u.y)) hurt(w, p, ENV.lavaBurnPctPerSec * (resist ? 0.5 : 1), "fire");
      else if (z === Zone.Volcano && !resist) {
        hurt(w, p, ENV.heatDotPctPerSec, "fire");
        if (w.time - st.warnAt > 30000) { st.warnAt = w.time; p.send("toast", { text: "Жар вулкана обжигает. Поможет «Жаропрочное рагу» у повара", kind: "info" }); }
      }
    }
  }
}

function cancelGather(p: Player, st: PState) {
  st.cast = null;
  p.send("mountcast", { ms: 0 });
}

function finishGather(w: World, s: WState, p: Player, st: PState) {
  const c = st.cast!;
  st.cast = null;
  p.send("mountcast", { ms: 0 });
  const n = s.nodes.get(c.node);
  if (!n || s.depleted.has(c.node)) return;
  const res = RESOURCES[n.res];
  const qty = 1 + (Math.random() < 0.35 ? 1 : 0);
  const backup = JSON.stringify(p.save.inventory);
  if (!addItem(p, { ...makeItem(res.id, 1, Rarity.Common), qty })) {
    p.save.inventory = JSON.parse(backup);
    return void p.send("toast", { text: "Сумка полна", kind: "error" });
  }
  p.selfDirty = true;
  questProgress(p, "gather", res.id, qty);
  s.depleted.set(c.node, w.time + ENV.nodeRespawnSec * 1000);
  w.broadcast("node", { id: c.node, up: false });
  p.send("toast", { text: `Добыто: ${res.name}${qty > 1 ? ` ×${qty}` : ""}`, kind: "loot" });
}

/** Начать добычу: 2 секунды на месте рядом с узлом. */
export function startGather(w: World, p: Player, id: unknown) {
  if (typeof id !== "number" || !Number.isInteger(id) || p.dead || p.team !== 0 || w.opts.mobs === false) return;
  const s = ws(w), st = ps(s, p);
  const n = s.nodes.get(id);
  if (!n) return;
  if (s.depleted.has(id)) return void p.send("toast", { text: "Здесь уже пусто — ресурс скоро появится вновь", kind: "info" });
  if (w.dist(p, n) > ENV.gatherRange) return void p.send("toast", { text: "Слишком далеко", kind: "error" });
  if (p.stunUntil > w.time || p.mountCast) return;
  if (st.cast) return;
  w.breakMount(p);
  p.input = { mx: 0, my: 0 };
  p.moveTo = null;
  st.cast = { node: id, until: w.time + ENV.gatherMs, x: p.x, y: p.y };
  p.send("mountcast", { ms: ENV.gatherMs, name: `Добыча: ${RESOURCES[n.res].name}` });
}

/** Новому игроку — какие узлы сейчас пусты. */
export function sendNodes(w: World, p: Player) {
  p.send("nodes", { depleted: [...ws(w).depleted.keys()] });
}

export function registerBiomes(on: On, w: () => World) {
  on<{ id: unknown }>("gather", (p, m) => startGather(w(), p, m.id));
}
