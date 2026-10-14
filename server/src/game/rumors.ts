/** Слухи: выбор реплики NPC и подстановка живого состояния мира (боссы, арена, онлайн). */
import { RUMOR_NPCS, type RumorMsg } from "../../../shared/rumors";
import { services } from "../arena/registry";
import type { Player } from "./Player";
import type { World } from "./World";

const BOSSES: Record<string, { alive: string; slain: string; gone: string }> = {
  ent: { alive: "Древний Энт жив и бродит в Шепчущем лесу", slain: "Древнего Энта одолел", gone: "Древний Энт пал, но лес скоро вернёт его" },
  witch: { alive: "Болотная Ведьма жива и колдует в Гнилых топях", slain: "Болотную Ведьму одолел", gone: "Болотная Ведьма пала, но топь скоро вернёт её" },
  ashlord: { alive: "Повелитель Пепла жив и восседает в Пепельных чертогах", slain: "Повелителя Пепла одолел", gone: "Повелитель Пепла пал, но пепел скоро вернёт его" },
};

function bossState(w: World, id: string): string {
  const b = BOSSES[id];
  const m = [...w.mobs.values()].find((x) => x.def.id === id && !x.summoned);
  if (m && !m.dead) return b.alive;
  const k = w.bossKills.get(id);
  if (!k) return b.gone;
  const min = Math.max(1, Math.round((w.time - k.at) / 60000));
  return `${b.slain} ${k.by} (${min} мин. назад)`;
}

const last = new Map<string, { at: number; npc: string; i: number }>();

/** null — слишком часто (не чаще 1 раза в секунду на игрока). */
export function rumorFor(w: World, p: Player, npcId: unknown): RumorMsg | null {
  const npc = RUMOR_NPCS.find((n) => n.id === npcId);
  if (!npc) return null;
  const prev = last.get(p.id);
  const now = Date.now();
  if (prev && now - prev.at < 1000) return null;
  const top = services.arena.top("1v1", 1)[0];
  const lines = npc.lines.filter((l) => top || !l.includes("{top}"));
  let i = Math.floor(Math.random() * lines.length);
  if (prev && prev.npc === npc.id && lines.length > 1 && lines[i] === npc.lines[prev.i]) i = (i + 1) % lines.length;
  last.set(p.id, { at: now, npc: npc.id, i: npc.lines.indexOf(lines[i]) });
  const text = lines[i]
    .replace("{ent}", () => `${bossState(w, "ent")}`)
    .replace("{witch}", () => `${bossState(w, "witch")}`)
    .replace("{ashlord}", () => `${bossState(w, "ashlord")}`)
    .replace("{online}", () => String(w.players.size))
    .replace("{top}", () => (top ? `${top.name} (${top.rating})` : "никто"));
  return { npc: npc.id, name: npc.name, text };
}

export function forgetRumors(id: string) {
  last.delete(id);
}
