/** Маунты из /data/mounts.json: скорость, требования, цены и цвета спрайта. */
import data from "../data/mounts.json";

export interface MountDef {
  id: string;
  name: string;
  speed: number;
  level: number;
  price: number;
  grantLevel: number;
  colors: string[];
  mane: string[];
}

export const MOUNTS: Record<string, MountDef> = Object.fromEntries(Object.entries(data.mounts).map(([id, m]) => [id, { ...m, id }]));
export const MOUNT_IDS = Object.keys(MOUNTS);
export const MOUNT_CAST_MS = data.castMs;
export const MOUNT_COMBAT_LOCK_MS = data.combatLockMs;
export const mountSprite = (id: string) => `mount_${id}`;
