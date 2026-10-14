export const GAME_TITLE = "Пепельный Предел";

/** Размер тайла и базовая сетка пиксель-арта. */
export const TILE = 32;
export const MAP_W = 320;
export const MAP_H = 240;
export const MAP_SEED = 20261014;

/** Сервер: частота симуляции и рассылки патчей. */
export const TICK_MS = 50;
export const PATCH_MS = 50;

export const PLAYER_SPEED = 150; // px/s
export const PLAYER_RADIUS = 10;
export const MAX_LEVEL = 30;
export const STAT_POINTS_PER_LEVEL = 3;
export const SKILL_POINTS_PER_LEVEL = 1;
export const INVENTORY_SIZE = 24;
export const LOOT_BAG_TTL_MS = 90_000;
export const PICKUP_RANGE = 72;
export const MERCHANT_RANGE = 110;
export const RESPAWN_DELAY_MS = 4000;
export const SAVE_INTERVAL_MS = 30_000;
export const CHAT_MAX_LEN = 140;
export const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_]{3,16}$/;
