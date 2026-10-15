/** Расширение сумки у Сумочника: проверки, золото и размер меняются вместе, сохранение — транзакцией. */
import { BAGMAN, BAG_STEP, bagPrice } from "../../../shared/bags";
import { MERCHANT_RANGE } from "../../../shared/constants";
import type { GameDB } from "../db";
import type { Player } from "./Player";
import type { World } from "./World";

export function expandBag(w: World, db: GameDB, spawn: { x: number; y: number }, p: Player, busy: boolean) {
  const err = (text: string) => p.send("toast", { text, kind: "error" });
  if (p.dead) return err("Мёртвым сумка не нужна");
  if (p.team !== 0 || busy) return err("Недоступно на арене и в очереди на неё");
  if (w.dist(p, BAGMAN) > MERCHANT_RANGE) return err("Сумочник далеко");
  const size = p.save.inventory.length;
  const price = bagPrice(size);
  if (price === null) return err("Сумка уже максимального размера");
  if (p.save.gold < price) return err("Не хватает золота");
  p.save.gold -= price;
  for (let i = 0; i < BAG_STEP; i++) p.save.inventory.push(null);
  try {
    db.raw.exec("BEGIN IMMEDIATE");
    db.save(p.name, p.toSave(spawn));
    db.raw.exec("COMMIT");
  } catch (ex) {
    try { db.raw.exec("ROLLBACK"); } catch {}
    console.error("[bags]", ex);
    p.save.gold += price;
    p.save.inventory.length = size;
    p.selfDirty = true;
    return err("Ошибка, ничего не изменилось");
  }
  p.selfDirty = true;
  p.send("toast", { text: `Сумка расширена: ${size + BAG_STEP} ячеек`, kind: "loot" });
}
