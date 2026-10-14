# Архитектура

Стек: Phaser 3 (client), Colyseus 0.16 (server), SQLite через node:sqlite (server/src/db.ts).

## Где что лежит
- shared/ — общий код: constants, map, formulas, classes, skills, items, mobs, protocol, path (A*), arena, trade.
- server/src/index.ts — HTTP + WebSocket.
- server/src/db.ts — аккаунты, сохранения, trade_log.
- server/src/rooms/WorldRoom.ts — мир: вход, сообщения, цикл.
- server/src/rooms/ArenaRoom.ts — инстанс арены; schema.ts — синхронизируемое состояние.
- server/src/game/ — World, Player, Mob, skills, bosses, rewards, inventory.
- server/src/arena/ — store (таблицы arena_*), queue, party, registry, rewards, bots (ИИ-соперники).
- server/src/trade/TradeManager.ts — обмен между игроками.
- client/src/net.ts — подключение; game/ — сцены и отрисовка; ui/ — hud, arena, trade.
- tools/ — генерация ассетов, db-просмотр; tests/ — bots, arena, trade, скриншоты.

## Главные правила
- Сервер авторитарен, клиент шлёт только намерения.
- Публичное — Schema, личное — сообщения владельцу, эффекты — пакет fx.
- Переносы предметов (обмен) — одной транзакцией SQLite.
- Новый контент — в /data, не в коде.
- PvP-урон умножается на PVP_DAMAGE_MULT (shared/arena.ts).
