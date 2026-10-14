/** Бестиарий: пороги открытия записей и тексты из /data/bestiary.json. */
import data from "../data/bestiary.json";
import { ZONES } from "./map";
import { MOBS } from "./mobs";

/** Убийств для открытия полной записи обычного моба. */
export const BESTIARY_FULL_KILLS = 10;
/** Убийств для открытия полной записи босса. */
export const BESTIARY_FULL_KILLS_BOSS = 1;

export const fullKills = (mobId: string) => (MOBS[mobId]?.boss ? BESTIARY_FULL_KILLS_BOSS : BESTIARY_FULL_KILLS);

export interface BestiaryText {
  desc: string;
  habitat?: string[];
}
export const BESTIARY: Record<string, BestiaryText> = data as Record<string, BestiaryText>;

/** Зоны обитания и диапазон уровней моба. */
export function mobHabitat(mobId: string): { zones: string[]; levels: [number, number] | null } {
  const def = MOBS[mobId];
  const zs = ZONES.filter((z) => z.mobs.includes(mobId));
  const zones = BESTIARY[mobId]?.habitat ?? zs.map((z) => z.name);
  if (def?.level) return { zones, levels: [def.level, def.level] };
  if (!zs.length) return { zones, levels: null };
  return { zones, levels: [Math.min(...zs.map((z) => z.levels[0])), Math.max(...zs.map((z) => z.levels[1]))] };
}
