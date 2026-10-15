/** Публичное состояние мира, которое Colyseus синхронизирует со всеми клиентами. */
import { MapSchema, Schema, type } from "@colyseus/schema";

export class Unit extends Schema {
  @type("uint8") kind = 0;
  @type("string") name = "";
  @type("string") sprite = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("uint8") dir = 0;
  @type("uint8") anim = 0;
  /** Счётчик атак: клиент проигрывает анимацию удара при каждом изменении. */
  @type("uint16") aseq = 0;
  @type("int32") hp = 0;
  @type("int32") maxHp = 0;
  @type("int32") mp = 0;
  @type("int32") maxMp = 0;
  @type("uint8") level = 1;
  @type("uint16") buffs = 0;
  @type("uint8") phase = 0;
  /** Игрок: "база:редкость" оружия, для подсветки. */
  @type("string") weapon = "";
  @type("string") target = "";
  /** Арена: номер команды; титул и рамка за сезонные награды. */
  @type("uint8") team = 0;
  @type("string") title = "";
  @type("string") frame = "";
  /** Игрок: id маунта под седоком ("" — пешком). */
  @type("string") mount = "";
  /** Игрок: оттенок спрайта (внешность), 0 — без оттенка. */
  @type("uint32") look = 0;
  /** Элитный моб: 1. */
  @type("uint8") elite = 0;
  /** Питомец: id хозяина. */
  @type("string") ownerId = "";
}

export class WorldState extends Schema {
  @type({ map: Unit }) players = new MapSchema<Unit>();
  @type({ map: Unit }) mobs = new MapSchema<Unit>();
}

/** Состояние матча арены: фаза, обратный отсчёт и оставшееся время в секундах. */
export class ArenaState extends WorldState {
  @type("string") mode = "1v1";
  @type("string") phase = "waiting";
  @type("uint8") countdown = 0;
  @type("uint16") timeLeft = 0;
}
