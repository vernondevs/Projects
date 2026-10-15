/** Фракции из /data/factions.json: Сольгард и Умбрат. Правила вражды: спорные зоны, арена, нейтральные города. */
import data from "../data/factions.json";
import { CLASSES, classFaction, type ClassId, type FactionId } from "./classes";
import { cityAtTile } from "./cities";
import { TILE } from "./constants";
import { isTownZone, Zone, zoneAtPx, type WorldMap } from "./map";

export type { FactionId } from "./classes";

export interface FactionDef {
  id: FactionId;
  name: string;
  full: string;
  race: string;
  symbol: string;
  desc: string;
  /** Цвет имён и чата героев фракции. */
  color: string;
  ui: { accent: string; accent2: string; glow: string };
  classes: ClassId[];
}

export const FACTIONS = Object.fromEntries(
  Object.entries(data.factions).map(([id, f]) => [id, { ...f, id: id as FactionId, classes: f.classes as ClassId[] }]),
) as Record<FactionId, FactionDef>;
export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
export const isFactionId = (v: unknown): v is FactionId => typeof v === "string" && v in FACTIONS;
export const factionOf = classFaction;
export const enemyFaction = (f: FactionId): FactionId => (f === "solgard" ? "umbrath" : "solgard");
export const factionColor = (f: FactionId | string | undefined) => FACTIONS[(f as FactionId) ?? "solgard"]?.color ?? "#a8e0ff";
/** Класс принадлежит фракции. */
export const classInFaction = (cls: ClassId, f: FactionId) => CLASSES[cls]?.faction === f;

/** Спорные зоны (PvP между фракциями в открытом мире). */
const PVP = new Set<number>(data.pvpZones.map((n) => Zone[n as keyof typeof Zone]).filter((z) => z !== undefined));
export const isPvpZone = (z: Zone) => PVP.has(z);
export const NEUTRAL_CITIES = new Set<string>(data.neutralCities);
export const OUTLAW = data.outlaw;

/** Место для вражды фракций: спорная зона, нейтральный город (бой запрещён, стража) или мирная земля. */
export type PvpPlace = "pvp" | "neutral" | "peace";
export function pvpPlace(m: WorldMap, px: number, py: number): PvpPlace {
  const z = zoneAtPx(m, px, py);
  if (isTownZone(z)) {
    const c = cityAtTile(Math.floor(px / TILE), Math.floor(py / TILE));
    return c && NEUTRAL_CITIES.has(c.id) ? "neutral" : "peace";
  }
  return isPvpZone(z) ? "pvp" : "peace";
}
/** Враждебны ли два героя мира (вне арены): разные фракции и оба в спорной зоне или оба в нейтральном городе (там удар — нарушение). */
export function factionsHostile(m: WorldMap, fa: string, ax: number, ay: number, fb: string, bx: number, by: number): boolean {
  if (!fa || !fb || fa === fb) return false;
  const a = pvpPlace(m, ax, ay);
  return a !== "peace" && a === pvpPlace(m, bx, by);
}

/** «Чужой язык»: чат противоположной фракции виден, но не читается (слоги по хэшу слова). */
export function scramble(text: string): string {
  const syl = data.chatScramble;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      let h = 0;
      for (const ch of w.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
      const n = Math.max(1, Math.min(4, Math.round(w.length / 3)));
      let out = "";
      for (let i = 0; i < n; i++) out += syl[(h >>> (i * 4)) % syl.length];
      return out;
    })
    .join(" ");
}
