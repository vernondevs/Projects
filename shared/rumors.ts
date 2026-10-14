/** Городские слухи: NPC-сплетники и тексты из /data/rumors.json. */
import data from "../data/rumors.json";
import { TILE } from "./constants";
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

/** Смещения от центра города (в тайлах): у площади, вокруг фонтана. */
const AT: Record<string, [number, number]> = { marta: [4, 1], ivor: [-5, 0], lei: [3, 6] };

export const RUMOR_NPCS: RumorNpc[] = Object.entries(data.npcs).map(([id, n]) => ({
  id,
  name: n.name,
  sprite: n.sprite,
  tint: Number(n.tint),
  color: n.color,
  lines: n.lines,
  x: (TOWN.x + (AT[id]?.[0] ?? 0)) * TILE + 16,
  y: (TOWN.y + (AT[id]?.[1] ?? 0)) * TILE + 16,
}));

export interface RumorMsg {
  npc: string;
  name: string;
  text: string;
}
