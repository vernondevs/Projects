/** Элитные мобы: параметры и приставки из /data/elites.json. */
import data from "../data/elites.json";

export interface ElitePrefix {
  name: string;
  hp?: number;
  dmg?: number;
  armor?: number;
  speed?: number;
}
export const ELITE = data as typeof data & { prefixes: ElitePrefix[] };
