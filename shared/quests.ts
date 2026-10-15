/** Простые задания городов из /data/quests.json: убить N мобов или добыть N ресурсов. Прогресс — с момента принятия. */
import data from "../data/quests.json";
import { CITIES, type CityNpc } from "./cities";

export interface QuestDef {
  id: string;
  giver: string;
  name: string;
  kind: "kill" | "gather";
  target: string;
  n: number;
  level: number;
  text: string;
  done: string;
  reward: { gold: number; xp: number; item?: { base: string; qty: number } };
}
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(
  Object.entries(data.quests).map(([id, q]) => [id, { ...q, id, kind: q.kind as QuestDef["kind"] } as QuestDef]),
);
export const QUEST_MAX_ACTIVE = data.max_active;
/** Выдающие NPC (по одному на малый город). */
export const QUEST_GIVERS: CityNpc[] = CITIES.filter((c) => c.quest).map((c) => c.quest!);
export const questsOf = (giver: string) => Object.values(QUESTS).filter((q) => q.giver === giver);

/** Хранится в сохранении: активные (прогресс) и сданные. */
export interface QuestSave {
  active: Record<string, number>;
  done: string[];
}
