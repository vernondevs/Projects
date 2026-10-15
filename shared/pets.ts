/** Питомцы из /data/pets.json: характеристики, умения, прокачка. */
import data from "../data/pets.json";

export interface PetSkill {
  id: string;
  name: string;
  type: "bleed" | "howl" | "bolt" | "heal" | "taunt" | "shell";
  cd: number;
  mult?: number;
  pct?: number;
  ms?: number;
  range?: number;
  desc: string;
}
export interface PetDef {
  id: string;
  name: string;
  sprite: string;
  price: number;
  level: number;
  hp: number;
  dmg: number;
  armor: number;
  speed: number;
  range: number;
  attackCd: number;
  radius: number;
  projectile?: string;
  skills: PetSkill[];
  /** Временный призыв умения (скелет чернокнижника): без опыта и перезарядки после гибели. */
  temp?: boolean;
}

export const PETS: Record<string, PetDef> = Object.fromEntries(Object.entries(data.pets).map(([id, p]) => [id, { ...(p as object), id } as PetDef]));
export const PET_IDS = Object.keys(PETS);
export const PET_CAST_MS = data.castMs;
export const PET_RESUMMON_MS = data.resummonMs;
export const PET_FOLLOW_DIST = data.followDist;
export const PET_TELEPORT_DIST = data.teleportDist;
export const PET_DROP_CHANCE = data.dropChance;
export const FIRST_PET = "wolf";

export const petStats = (def: PetDef, level: number) => ({
  maxHp: Math.round(def.hp * (40 + level * 24)),
  dmg: def.dmg * (4 + level * 1.7),
  armor: Math.round(def.armor * level * 1.6),
});
export const petXpToNext = (level: number) => Math.round(30 * level ** 1.5);
export const petUnitId = (ownerId: string) => `pet_${ownerId}`;
