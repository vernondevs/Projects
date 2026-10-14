# Архитектура

Стек: Phaser 3 (client), Colyseus 0.16 (server), SQLite через node:sqlite (server/src/db.ts).

## Где что лежит
- data/ — контент в JSON: bestiary, rumors, food, elites, upgrade, mounts, legendaries, bank, pets, scenes, townfolk.
- shared/ — общий код: constants, map (генератор мира), town (планировка Эмберхолла), formulas, classes, skills, items, mobs, protocol, path (A*),
  arena, trade, bestiary, rumors, food, elites, upgrade, mounts, legendary, bank.
- server/src/index.ts — HTTP + WebSocket. db.ts — аккаунты, сохранения, trade_log, admin_log, market_demand.
- server/src/rooms/ — WorldRoom (мир), ArenaRoom (инстанс арены), schema, common.
- server/src/game/ — World, Player, Mob, skills, bosses, rewards, inventory, rumors, smith, market,
  legendary (эффекты), admin, bank, Pet (питомцы), rogue (яд, удар в спину), townfolk (стражники и горожане).
- server/src/arena/ — store, queue, party, registry, rewards, bots. server/src/trade/TradeManager.ts — обмен.
- client/src/net.ts — подключение; game/ — сцены и отрисовка (UnitView, effects, terrain — куски 32×32 у камеры);
  ui/ — hud (меню, сумка, настройки), arena, trade, bestiary, rumor, cook, smith, bank, admin.
- tools/ — генерация пиксель-арта (gen/), db (CLI: просмотр, `admin <имя> on|off`).
- tests/ — bots, arena, trade, admin, bank, screenshot.

## Карта
- 320×240 тайлов: освоенная часть CORE (зоны 1–30, данж), по краям «Неизведанные земли» под будущие города и биомы.
- Эмберхолл — стены, башни, 4 ворот, кварталы (shared/town.ts); мобы в город не заходят, стражники бьют их у стен.
- Смена раскладки — поднять MAP_VERSION: старые позиции из сохранений сбросятся к фонтану.

## Главные правила
- Сервер авторитарен, клиент шлёт только намерения. Права админа проверяются только на сервере.
- Публичное — Schema, личное — сообщения владельцу, эффекты — пакет fx.
- Переносы предметов (обмен, банк) — в памяти + сохранение одной транзакцией SQLite с откатом.
- Новый контент — в /data, не в коде.
- PvP-урон умножается на PVP_DAMAGE_MULT (shared/arena.ts).
- NPC города стоят со смещением от TOWN; новые места проверять через walkable().
