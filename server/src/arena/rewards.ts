/** Выдача сезонных наград арены: титул, рамка и уникальный медальон по рангу. */
import { MODE_NAMES, rankById, RANKS, type ArenaMode } from "../../../shared/arena";
import { makeUnique } from "../../../shared/items";
import { addItem } from "../game/inventory";
import type { Player } from "../game/Player";
import { services } from "./registry";

/** Выдаёт все ожидающие награды игроку в мире. Медальон ждёт, пока в сумке не появится место. */
export function deliverArenaRewards(p: Player) {
  const store = services.arena;
  const s = p.save;
  for (const r of store.pendingRewards(p.name.toLowerCase())) {
    const rank = rankById(r.rank) ?? RANKS[0];
    const id = `${rank.id}-${r.mode}-s${r.season}`;
    s.titles ??= [];
    if (!s.titles.some((t) => t.id === id)) {
      s.titles.push({ id, name: `${rank.title} (${MODE_NAMES[r.mode as ArenaMode]}, сезон ${r.season})`, rank: rank.id });
      // активные титул и рамка — по лучшему рангу
      const best = s.titles.reduce((a, b) => (RANKS.findIndex((x) => x.id === b.rank) > RANKS.findIndex((x) => x.id === a.rank) ? b : a));
      s.title = best.name;
      s.frame = best.rank;
    }
    if (!addItem(p, makeUnique(rank.reward))) {
      p.send("toast", { text: "Награда арены ждёт: освободите место в сумке", kind: "error" });
      continue;
    }
    store.markDelivered(r.id);
    p.send("toast", { text: `Награда за сезон ${r.season} (${MODE_NAMES[r.mode as ArenaMode]}, ${rank.name}): титул, рамка и медальон`, kind: "loot" });
  }
  p.applyCosmetics();
  p.selfDirty = true;
}
