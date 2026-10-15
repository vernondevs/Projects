/** Общие обработчики сообщений для комнат мира и арены: движение, цель, умения, чат. */
import type { Client, Room } from "@colyseus/core";
import { CHAT_MAX_LEN, TILE } from "../../../shared/constants";
import type { Player } from "../game/Player";
import { castSkill } from "../game/skills";
import type { World } from "../game/World";

export const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : null;

/** Убирает управляющие и невидимые символы (U+0000–U+001F, U+007F, U+200B–U+200F, U+2028–U+202E, U+2060–U+206F). */
export function cleanText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f)) continue;
    out += ch;
  }
  return out.trim();
}

export type On = <T>(type: string, fn: (p: Player, msg: T) => void) => void;

/** Подписка на сообщение с поиском игрока по сессии и защитой от исключений. */
export function makeOn(room: Room<any>, world: () => World): On {
  return <T>(type: string, fn: (p: Player, msg: T) => void) => {
    room.onMessage(type, (client: Client, msg: T) => {
      const p = world().players.get(client.sessionId);
      if (!p || msg === null || typeof msg !== "object") return;
      try {
        fn(p, msg);
      } catch (e) {
        console.error(`[${type}]`, e);
      }
    });
  };
}

export function registerCombat(on: On, world: () => World) {
  const w = world;
  on<{ mx: unknown; my: unknown }>("input", (p, m) => {
    const mx = num(m.mx, -1, 1), my = num(m.my, -1, 1);
    if (mx === null || my === null) return;
    p.input.mx = mx;
    p.input.my = my;
  });
  on<{ x: unknown; y: unknown }>("moveTo", (p, m) => {
    const x = num(m.x, 0, w().map.w * TILE), y = num(m.y, 0, w().map.h * TILE);
    if (x === null || y === null) return;
    p.moveTo = { x, y };
    p.targetId = null;
  });
  on<{ id: unknown }>("target", (p, m) => {
    const id = typeof m.id === "string" ? m.id : null;
    const a = w().actor(id);
    p.targetId = a && !w().isDead(a) && w().hostile(p, a) && !w().stealthed(a) ? a.id : null;
    p.unit.target = p.targetId ?? "";
    if (p.targetId) p.moveTo = null;
  });
  on<{ id: unknown; x: unknown; y: unknown; target: unknown }>("skill", (p, m) => {
    if (typeof m.id !== "string") return;
    const x = num(m.x, 0, w().map.w * TILE) ?? p.x, y = num(m.y, 0, w().map.h * TILE) ?? p.y;
    const err = castSkill(w(), p, m.id, x, y, typeof m.target === "string" ? m.target : null);
    if (err) p.send("toast", { text: err, kind: "error" });
  });
  on("mount:toggle", (p) => w().toggleMount(p));
  on<{ text: unknown }>("chat", (p, m) => {
    if (typeof m.text !== "string") return;
    const text = cleanText(m.text).slice(0, CHAT_MAX_LEN);
    if (!text) return;
    if (w().time - p.lastChat < 600) return p.send("toast", { text: "Не так быстро", kind: "error" });
    p.lastChat = w().time;
    w().playerChat(p, text);
  });
}
