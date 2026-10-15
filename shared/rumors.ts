/** Городские слухи: NPC-сплетники и тексты из /data/rumors.json. */
import data from "../data/rumors.json";
import { TILE } from "./constants";
import { CITIES, CITY_RUMOR_AT } from "./cities";
import { TOWN } from "./map";

export interface RumorNpc {
  id: string;
  name: string;
  sprite: string;
  tint: number;
  color: string;
  lines: string[];
  x: number;
  y: number;
}

/** Смещения от центра города (в тайлах): Марта — на рынке, Ивор — у северных ворот, Лей — в сквере. */
const AT: Record<string, [number, number]> = { marta: [2, -4], ivor: [6, -17], lei: [-9, 3] };

export const RUMOR_NPCS: RumorNpc[] = Object.entries(data.npcs).map(([id, n]) => {
  const city = "city" in n ? CITIES.find((c) => c.id === n.city) : undefined;
  const at = city ? { x: city.x + CITY_RUMOR_AT[0], y: city.y + CITY_RUMOR_AT[1] } : { x: TOWN.x + (AT[id]?.[0] ?? 0), y: TOWN.y + (AT[id]?.[1] ?? 0) };
  return { id, name: n.name, sprite: n.sprite, tint: Number(n.tint), color: n.color, lines: n.lines, x: at.x * TILE + 16, y: at.y * TILE + 16 };
});

export interface RumorMsg {
  npc: string;
  name: string;
  text: string;
}
