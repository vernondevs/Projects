/** Кузнец Гром: покупка материалов и улучшение предметов +1…+10. Всё проверяется на сервере. */
import { MERCHANT_RANGE } from "../../../shared/constants";
import { BASE_ITEMS, itemName, makeItem, Rarity, SLOTS, type Item, type Slot } from "../../../shared/items";
import { failLevel, MATERIALS, MAX_PLUS, SMITH, stepFor } from "../../../shared/upgrade";
import { addItem } from "./inventory";
import type { Player } from "./Player";
import type { World } from "./World";

const err = (p: Player, text: string) => p.send("toast", { text, kind: "error" });
const count = (p: Player, base: string) => p.save.inventory.reduce((n, it) => n + (it && it.base === base ? it.qty ?? 1 : 0), 0);
function take(p: Player, base: string, n: number) {
  const inv = p.save.inventory;
  for (let i = 0; i < inv.length && n > 0; i++) {
    const it = inv[i];
    if (!it || it.base !== base) continue;
    const t = Math.min(n, it.qty ?? 1);
    n -= t;
    it.qty = (it.qty ?? 1) - t;
    if (it.qty <= 0) inv[i] = null;
  }
}

export function buyMaterial(w: World, p: Player, id: unknown, qtyRaw: unknown) {
  const m = typeof id === "string" ? MATERIALS[id] : undefined;
  if (!m) return;
  if (w.dist(p, SMITH) > MERCHANT_RANGE) return err(p, "Кузнец далеко");
  const qty = Number.isInteger(qtyRaw) ? Math.max(1, Math.min(99, qtyRaw as number)) : 1;
  const price = m.price * qty;
  if (p.save.gold < price) return err(p, "Не хватает золота");
  const backup = JSON.stringify(p.save.inventory);
  if (!addItem(p, { ...makeItem(m.id, 1, Rarity.Common), qty })) {
    p.save.inventory = JSON.parse(backup);
    return err(p, "Сумка полна");
  }
  p.save.gold -= price;
  p.selfDirty = true;
}

/** Улучшить предмет из сумки (index) или надетый (slot). locked — проверка окна обмена. */
export function upgradeItem(w: World, p: Player, index: unknown, slot: unknown, locked: (i: unknown) => boolean) {
  if (p.dead) return;
  if (p.team !== 0) return err(p, "На арене улучшать нельзя");
  if (w.dist(p, SMITH) > MERCHANT_RANGE) return err(p, "Кузнец далеко");
  let it: Item | null | undefined;
  if (slot !== undefined && slot !== null) {
    if (typeof slot !== "string" || !SLOTS.includes(slot as Slot)) return;
    it = p.save.equip[slot as Slot];
  } else {
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= p.save.inventory.length) return;
    if (locked(index)) return err(p, "Предмет лежит в окне обмена");
    it = p.save.inventory[index as number];
  }
  if (!it || BASE_ITEMS[it.base]?.slot === "consumable") return err(p, "Это нельзя улучшить");
  const plus = it.plus || 0;
  const step = stepFor(plus);
  if (!step) return err(p, "Предмет уже улучшен до максимума");
  if (p.save.gold < step.gold) return err(p, "Не хватает золота");
  if (count(p, "ash_ore") < step.ore || count(p, "star_dust") < step.dust) return err(p, "Не хватает материалов");
  p.save.gold -= step.gold;
  take(p, "ash_ore", step.ore);
  take(p, "star_dust", step.dust);
  const ok = Math.random() * 100 < step.chance;
  it.plus = ok ? plus + 1 : failLevel(plus);
  if (!it.plus) delete it.plus;
  if (slot !== undefined && slot !== null) {
    const ratio = p.unit.hp / Math.max(1, p.unit.maxHp);
    p.recalc();
    p.unit.hp = Math.max(1, Math.round(p.unit.maxHp * ratio));
  }
  p.selfDirty = true;
  p.send("toast", { text: ok ? `Успех! ${itemName(it)}` : `Неудача, уровень снижен до +${it.plus || 0}`, kind: ok ? "loot" : "error" });
}
