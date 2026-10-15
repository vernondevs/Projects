/** Проверка городов без сервера: все точки проходимы и связаны между собой и с внешним миром (заливка по клеткам). */
import { CITIES, CITY_CITIZEN_SPOTS, CITY_GATE_GUARDS, CITY_PATROLS, CITY_GATES, cityAtTile, teleportPrice, nearestCity } from "../shared/cities";
import { MAP_SEED, TILE } from "../shared/constants";
import { generateMap, isTownZone, walkable, zoneAtPx, Zone } from "../shared/map";
import { CITIZEN_SPOTS, GATE_GUARDS, PATROLS, TOWN } from "../shared/town";
import { QUEST_GIVERS, QUESTS } from "../shared/quests";

const m = generateMap(MAP_SEED);
let bad = 0;
const fail = (s: string) => { bad++; console.log("FAIL", s); };
const R = 10;
const ok = (px: number, py: number) => walkable(m, px, py, R);
// заливка от точки по центрам клеток (8 соседей, без срезания углов)
function flood(sx: number, sy: number) {
  const seen = new Set<number>();
  const q: [number, number][] = [[Math.floor(sx / TILE), Math.floor(sy / TILE)]];
  const key = (x: number, y: number) => y * 4096 + x;
  seen.add(key(q[0][0], q[0][1]));
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx > m.w - 2 || ny > m.h - 2 || seen.has(key(nx, ny))) continue;
      if (!ok(nx * TILE + 16, ny * TILE + 16)) continue;
      if (dx && dy && (!ok((x + dx) * TILE + 16, y * TILE + 16) || !ok(x * TILE + 16, (y + dy) * TILE + 16))) continue;
      seen.add(key(nx, ny));
      q.push([nx, ny]);
    }
  }
  return seen;
}
const reach = flood(m.playerSpawn.x, m.playerSpawn.y);
const can = (px: number, py: number) => reach.has(Math.floor(py / TILE) * 4096 + Math.floor(px / TILE));
const tile = (cx: number, cy: number, dx: number, dy: number) => ({ x: (cx + dx) * TILE + 16, y: (cy + dy) * TILE + 16 });
const pt = (cx: number, cy: number, dx: number, dy: number) => ({ x: (cx + dx) * TILE, y: (cy + dy) * TILE });

function check(name: string, p: { x: number; y: number }) {
  if (!ok(p.x, p.y)) fail(`${name}: непроходимо (${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)})`);
  else if (!can(p.x, p.y)) fail(`${name}: недостижимо из Эмберхолла (${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)})`);
}
for (const c of CITIES) {
  console.log(`${c.name}: центр ${c.x},${c.y}`);
  check(`${c.id} spawn`, c.spawn);
  check(`${c.id} arrive`, c.arrive);
  if (!isTownZone(zoneAtPx(m, c.spawn.x, c.spawn.y))) fail(`${c.id}: spawn не в зоне города`);
  if (cityAtTile(Math.floor(c.spawn.x / TILE), Math.floor(c.spawn.y / TILE))?.id !== c.id) fail(`${c.id}: cityAtTile`);
  for (const n of [c.merchant, c.cook, c.quest]) if (n) check(`${c.id} ${n.id}`, n);
  if (!c.style) {
    for (const [dx, dy] of GATE_GUARDS) check("ember пост", tile(TOWN.x, TOWN.y, dx, dy));
    continue;
  }
  for (const g of CITY_GATES) check(`${c.id} ворота ${g.id}`, tile(c.x, c.y, g.x, g.y));
  for (const [dx, dy] of CITY_GATE_GUARDS) check(`${c.id} пост ${dx},${dy}`, tile(c.x, c.y, dx, dy));
  for (const r of CITY_PATROLS) for (const [dx, dy] of r) check(`${c.id} патруль ${dx},${dy}`, pt(c.x, c.y, dx, dy));
  for (const [dx, dy] of CITY_CITIZEN_SPOTS) check(`${c.id} горожане ${dx},${dy}`, tile(c.x, c.y, dx, dy));
  // стоять у торговца/повара/заказчика/камня: рядом с точкой NPC есть проходимая клетка
  for (const n of [c.merchant!, c.cook!, c.quest!]) {
    let any = false;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (ok(n.x + i * TILE, n.y + j * TILE) && can(n.x + i * TILE, n.y + j * TILE) && Math.hypot(i, j) <= 2) any = true;
    if (!any) fail(`${c.id} ${n.id}: не подойти`);
  }
}
void CITIZEN_SPOTS; void PATROLS;
for (const g of QUEST_GIVERS) if (!Object.values(QUESTS).some((q) => q.giver === g.id)) fail(`нет заданий у ${g.id}`);
const [e, o, s] = CITIES;
console.log("цены:", teleportPrice(e, o), teleportPrice(e, s), teleportPrice(o, s));
if (nearestCity(["snow_valley"], s.spawn.x, s.spawn.y).id !== "snow_valley") fail("ближайший открытый город");
if (nearestCity([], s.spawn.x, s.spawn.y).id !== "ember") fail("по умолчанию Эмберхолл");
// столицы: своя открыта всегда, чужая — никогда
const sol = CITIES.find((c) => c.capital === "solgard")!, umb = CITIES.find((c) => c.capital === "umbrath")!;
if (!sol || !umb || sol.x > umb.x) fail("столицы на западе и востоке");
if (nearestCity([], s.spawn.x, s.spawn.y, "umbrath").id !== umb.id) fail("Умбрат: по умолчанию Мортхейм");
if (nearestCity([umb.id], umb.spawn.x, umb.spawn.y, "solgard").id === umb.id) fail("возрождение во вражеской столице");
if (zoneAtPx(m, sol.spawn.x, sol.spawn.y) !== Zone.SolgardCity || zoneAtPx(m, umb.spawn.x, umb.spawn.y) !== Zone.UmbrathCity) fail("зоны столиц");
// путь от столицы до столицы — несколько минут пешком (150 px/с)
const minutes = Math.hypot(umb.x - sol.x, umb.y - sol.y) * TILE / 150 / 60;
console.log(`от столицы до столицы по прямой: ${minutes.toFixed(1)} мин`);
if (minutes < 3) fail("столицы слишком близко");
// мосты и указатели
const bridges = m.objects.filter((o) => o.kind.startsWith("bridge")), signs = m.objects.filter((o) => o.kind === "signpost" && o.label);
if (bridges.length < 4) fail("мостов меньше 4: " + bridges.length);
for (const b of bridges) check("мост", { x: b.x, y: b.y - 40 });
if (signs.length < 6) fail("указателей меньше 6: " + signs.length);
// слабые мобы у столиц: стартовые зоны 1–10
for (const c of [sol, umb]) {
  const near = m.spawns.filter((sp) => Math.hypot(sp.x - c.spawn.x, sp.y - c.spawn.y) < 60 * TILE);
  if (!near.length || Math.max(...near.map((sp) => sp.level)) > 10) fail(`${c.id}: у столицы нет слабых мобов`);
}
console.log(bad ? `ПРОБЛЕМ: ${bad}` : "города: ок");
process.exit(bad ? 1 : 0);
