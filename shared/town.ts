/**
 * Эмберхолл — нейтральный город в центре мира. Вся планировка в тайлах как смещения от TOWN (центр фонтанной площади).
 * Файл не зависит от map.ts: генератор карты, сервер (стражи, горожане) и NPC берут разметку отсюда.
 *
 *   стены: линии dx = ±24, dy = ±19; башни 2×2 снаружи стены; ворота — проёмы 3 тайла по осям;
 *   улицы: кольцо вдоль стен, проспекты |dx|≤1 и |dy|≤1, поперечные dx=±11..12, dy=±8..9;
 *   кварталы по x: [-21,-13] [-10,-2] [2,10] [13,21]; по y: [-16,-10] [-7,-2] [2,7] [10,16];
 *   центр (|dx|≤10, |dy|≤7) — площадь с фонтаном и рынком.
 */
import { MID } from "./constants";

/** Центр Эмберхолла: середина мира сдвинута на MID (земли фракций — по краям). */
export const TOWN = { x: 90 + MID.x, y: 120 + MID.y };
/** Линии стен (смещения от TOWN). */
export const WALL = { x: 24, y: 19 };
/** Полуразмеры зоны города вместе с башнями: безопасная зона, мобы сюда не заходят. */
export const TOWN_HALF = { x: 25, y: 20 };
/** Стражи защищают окрестности: столько тайлов от стен. */
export const GUARD_RANGE_TILES = 6;

export type Ground = "cobble" | "grass" | "dirt";

/** Здания: якорь — левая нижняя клетка (как в place()), door — смещения дверных клеток от якоря по x (проходимы). */
export interface Building { kind: string; x: number; y: number; door?: number[] }
export const BUILDINGS: Building[] = [
  // северный ряд домов (фасады на улицу dy=-9)
  { kind: "house", x: -21, y: -11 }, { kind: "house_blue", x: -16, y: -11 },
  { kind: "house_blue", x: -10, y: -11 }, { kind: "house", x: -5, y: -11 },
  { kind: "house", x: 2, y: -11 }, { kind: "house_blue", x: 7, y: -11 },
  { kind: "house_blue", x: 13, y: -11 }, { kind: "house", x: 18, y: -11 },
  // южный ряд домов (фасады на кольцевую улицу)
  { kind: "house", x: -21, y: 15 }, { kind: "house", x: -16, y: 15 },
  { kind: "house", x: -10, y: 15 }, { kind: "house_blue", x: -5, y: 15 },
  { kind: "house_blue", x: 2, y: 15 }, { kind: "house", x: 7, y: 15 },
  { kind: "house", x: 13, y: 15 }, { kind: "house_blue", x: 18, y: 15 },
  // главные здания
  { kind: "tavern", x: -20, y: -3, door: [3] },
  { kind: "forge", x: 14, y: -3, door: [2] },
  { kind: "bank", x: -20, y: 6, door: [2, 3] },
  { kind: "arena_gate", x: 15, y: 5 },
];

/** Площадки перед зданиями (мостовая). [x0, y0, x1, y1] включительно. */
const APRONS: [number, number, number, number][] = [
  [-21, -2, -13, -2], // терраса таверны
  [13, -2, 21, -2], // двор кузницы
  [-21, 7, -13, 7], // крыльцо банка
  [13, 2, 21, 7], // двор арены
];
/** Палисадники перед домами — утоптанная земля. */
const YARDS: [number, number, number, number][] = [
  [-21, -10, -2, -10], [2, -10, 21, -10],
  [-21, 16, -2, 16], [2, 16, 21, 16],
];

export const inWalls = (dx: number, dy: number) => Math.abs(dx) < WALL.x && Math.abs(dy) < WALL.y;
export const inTownRect = (dx: number, dy: number) => Math.abs(dx) <= TOWN_HALF.x && Math.abs(dy) <= TOWN_HALF.y;
const inR = (dx: number, dy: number, r: [number, number, number, number]) => dx >= r[0] && dx <= r[2] && dy >= r[1] && dy <= r[3];

/** Покрытие клетки города. */
export function townGround(dx: number, dy: number): Ground {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  // проезд через ворота и подход к ним снаружи
  if ((ax <= 1 && ay >= WALL.y) || (ay <= 1 && ax >= WALL.x)) return "cobble";
  if (!inWalls(dx, dy)) return "grass";
  if (ax <= 1 || ay <= 1) return "cobble"; // проспекты
  if (ax === WALL.x - 2 || ay === WALL.y - 2) return "dirt"; // дорожка вдоль стен (по ней ходит патруль)
  if (ax > WALL.x - 2 || ay > WALL.y - 2) return "grass";
  if (ax === 11 || ax === 12 || ay === 8 || ay === 9) return "cobble"; // поперечные улицы
  if (ax <= 10 && dy >= -7 && dy <= -2) return "cobble"; // рыночная площадь
  if (ax + Math.max(0, dy - 3) <= 6 && dy <= 6) return "cobble"; // фонтанная площадь
  if (ax <= 10 && ay <= 7) return "grass"; // сквер
  for (const r of APRONS) if (inR(dx, dy, r)) return "cobble";
  for (const r of YARDS) if (inR(dx, dy, r)) return "dirt";
  return "grass";
}

/** Башни 2×2: якорь — левая нижняя клетка. */
export const TOWERS: [number, number][] = [
  // углы
  [-25, -WALL.y], [WALL.x, -WALL.y], [-25, WALL.y + 1], [WALL.x, WALL.y + 1],
  // по сторонам ворот
  [-3, -WALL.y], [2, -WALL.y], [-3, WALL.y + 1], [2, WALL.y + 1],
  [-25, -2], [-25, 3], [WALL.x, -2], [WALL.x, 3],
  // посередине пролётов
  [-13, -WALL.y], [12, -WALL.y], [-13, WALL.y + 1], [12, WALL.y + 1],
  [-25, -10], [-25, 11], [WALL.x, -10], [WALL.x, 11],
];
/** Клетка — проём ворот в стене. */
export const isGate = (dx: number, dy: number) =>
  (Math.abs(dx) <= 1 && Math.abs(dy) === WALL.y) || (Math.abs(dy) <= 1 && Math.abs(dx) === WALL.x);
/** Центры ворот (снаружи у проёма) — стражи следят за подходами. */
export const GATES: { id: string; x: number; y: number }[] = [
  { id: "n", x: 0, y: -WALL.y - 1 }, { id: "s", x: 0, y: WALL.y + 1 },
  { id: "w", x: -WALL.x - 1, y: 0 }, { id: "e", x: WALL.x + 1, y: 0 },
];

/** Рынок: прилавки 2×1 (якорь — левая клетка) на северной половине площади. */
export const STALLS: { kind: string; x: number; y: number }[] = [
  { kind: "stall_green", x: -9, y: -6 }, { kind: "stall_blue", x: -6, y: -6 },
  { kind: "stall", x: 4, y: -6 }, { kind: "stall_blue", x: 7, y: -6 },
];

/** Стражники: неподвижные у ворот и патрули по улицам (точки маршрута в тайлах, центр клетки = +0.5). */
export const GATE_GUARDS: [number, number][] = [
  [-2, -17], [2, -17], [-2, 17], [2, 17],
  [-22, -2], [-22, 2], [22, -2], [22, 2],
];
export const PATROLS: [number, number][][] = [
  [[-21.5, -16.5], [22.5, -16.5], [22.5, 17.5], [-21.5, 17.5]],
  [[22.5, 17.5], [-21.5, 17.5], [-21.5, -16.5], [22.5, -16.5]],
  [[-11.5, -8.5], [11.5, -8.5], [11.5, 8.5], [-11.5, 8.5]],
  [[0.5, -15.5], [0.5, -8.5], [-21.5, 0.5], [0.5, 8.5], [0.5, 16.5], [0.5, 8.5], [22.5, 0.5], [0.5, -8.5]],
];
/** Куда ходят горожане: двери домов, рынок, таверна, фонтан, банк, кузница. */
export const CITIZEN_SPOTS: [number, number][] = [
  [-19, -10], [-14, -10], [-8, -10], [-3, -10], [4, -10], [9, -10], [15, -10], [20, -10],
  [-19, 16], [-8, 16], [4, 16], [15, 16],
  [-16, -2], [-13, -1], [-7, -4], [5, -4], [9, -3], [-3, 3], [3, 3], [0, 5], [-12, 6], [16, -2], [-11, 0], [11, 0],
];
export const CITIZEN_COUNT = 8;
