/** Аккаунты и экран выбора героя: общие типы HTTP API, внешность героя, выход из игры. */
import type { ClassId } from "./classes";
import type { Rarity, Slot } from "./items";

/** Героев на аккаунт. */
export const MAX_CHARS = 6;
/** Выход в бою: отсчёт, сбрасывается полученным уроном. */
export const LOGOUT_COMBAT_MS = 10_000;
/** Код закрытия соединения после разрешённого выхода. */
export const LOGOUT_CODE = 4010;
/** Код закрытия старой сессии, когда тем же героем (или другим героем аккаунта) вошли с другой вкладки. */
export const KICK_CODE = 4011;
export const KICK_TEXT = "Вы вошли с другого устройства";
/** Сколько секунд герой ждёт в мире после обрыва связи (переподключение без потерь). */
export const RECONNECT_SEC = 30;

/** Внешность: акцентный оттенок спрайта (индекс в LOOKS). */
export const LOOKS: { name: string; rgb: number }[] = [
  { name: "Обычный", rgb: 0xffffff },
  { name: "Пепельный", rgb: 0xd0c8e0 },
  { name: "Медный", rgb: 0xffc490 },
  { name: "Изумрудный", rgb: 0xb4f0bc },
  { name: "Лазурный", rgb: 0xacccff },
  { name: "Багряный", rgb: 0xffa4a4 },
];

export function normLook(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < LOOKS.length ? n : 0;
}

/** Цвет умножения для спрайта; 0 — без оттенка. */
export function lookTint(v: unknown): number {
  const n = normLook(v);
  return n ? LOOKS[n].rgb : 0;
}

/** Карточка героя на экране выбора. */
export interface CharSummary {
  name: string;
  cls: ClassId;
  level: number;
  zone: string;
  look: number;
  equip: { slot: Slot; icon: string; rarity: Rarity; name: string }[];
  /** Текст блокировки, если герой забанен. */
  banned?: string;
}

/** Ответ API аккаунта: токен сессии и герои. */
export interface AccountView {
  token: string;
  login: string;
  chars: CharSummary[];
}
