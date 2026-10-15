# Архитектура

Стек: Phaser 3 (client), Colyseus 0.16 (server), SQLite через node:sqlite (server/src/db.ts).

## Где что лежит
- data/ — контент в JSON: bestiary, rumors, food, elites, upgrade, mounts, legendaries, bank, pets, scenes, townfolk, cities, quests.
- shared/ — общий код: constants, map (генератор мира), town (планировка Эмберхолла), formulas, classes, skills, items, mobs, protocol, path (A*),
  arena, trade, bestiary, rumors, food, elites, upgrade, mounts, legendary, bank, cities (города, телепорт), quests.
- server/src/index.ts — HTTP + WebSocket. db.ts — accounts (до 6 героев, общий склад), players (account_id), trade_log, admin_log, market_demand.
- server/src/accounts.ts — HTTP API /api (login, chars, delete, logout), сессии-токены в памяти, лимиты; WorldRoom.onAuth({token, character}). shared/accounts.ts — типы, внешность (LOOKS). POST /api/client-error — лог ошибок клиента.
- server/src/rooms/ — WorldRoom (мир), ArenaRoom (инстанс арены), schema, common.
- server/src/game/ — World, Player, Mob, skills, bosses, rewards, inventory, rumors, smith, market,
  legendary (эффекты), admin, bank, Pet (питомцы), rogue (яд, удар в спину), townfolk (стражники и горожане), cities (телепорт, задания).
- server/src/arena/ — store, queue, party, registry, rewards, bots. server/src/trade/TradeManager.ts — обмен.
- client/src/main.ts — вход/регистрация, account.ts — HTTP API, ui/charselect.ts — выбор и создание героя; выход (logout:request) — без перезагрузки.
- client/src/net.ts — подключение, сторож ping/pong и переподключение (recover); main.ts — окна «Переподключение…», «Что-то пошло не так», вытеснение; game/ — сцены и отрисовка (UnitView, effects, terrain — куски 32×32 у камеры);
  ui/ — hud (меню, сумка, настройки), arena, trade, bestiary, rumor, cook, smith, bank, admin.
- tools/ — генерация пиксель-арта (gen/), db (CLI: просмотр, `admin <имя> on|off`).
- tests/ — bots, arena, trade, admin, bank, reconnect (обрыв, двойной вход), screenshot, reconnect-screens (браузер).

## Карта
- Биомы в Неизведанных землях (shared/map.ts frontierZone): запад — Пустыня Миражей, север — Снежные пики, восток — Пылающий вулкан, юг — Затонувшая бухта (под водой: шкала воздуха). CITY_SITES — площадки под города (оазис, снежная долина).
- Среда: server/src/game/biomes.ts (жар, лава, воздух, добыча узлов), параметры и ресурсы — data/biomes.json, shared/biomes.ts. Музыка по зонам — client/src/game/sfx.ts (setAmbience), частицы погоды — GameScene.setupAmbient, арт — tools/gen/biomes.ts.
- 320×240 тайлов: освоенная часть CORE (зоны 1–30, данж), по краям «Неизведанные земли» под будущие города и биомы.
- Малые города (shared/cities.ts, зоны OasisCity/SnowCity, isTownZone): Оазис Миражей (30,152) и Снежная долина (112,18), одна раскладка 27×21 с двумя воротами, стиль (desert/snow) задаёт арт (tools/gen/cities.ts) и покрытие. Жители — data/cities.json, стража в townfolk.ts (SITES), камень телепорта есть и в Эмберхолле.
- Телепорт и задания: server/src/game/cities.ts (открытие города при входе в зону -> save.cities, каст 3 с, отмена движением/уроном/боем; задания из data/quests.json -> save.quests). Возрождение — в ближайшем открытом городе (nearestCity).
- Эмберхолл — стены, башни, 4 ворот, кварталы (shared/town.ts); мобы в город не заходят, стражники бьют их у стен.
- Смена раскладки — поднять MAP_VERSION: старые позиции из сохранений сбросятся к фонтану.

## Главные правила
- Сервер авторитарен, клиент шлёт только намерения. Права админа проверяются только на сервере.
- Публичное — Schema, личное — сообщения владельцу, эффекты — пакет fx.
- Переносы предметов (обмен, банк) — в памяти + сохранение одной транзакцией SQLite с откатом.
- Новый контент — в /data, не в коде.
- PvP-урон умножается на PVP_DAMAGE_MULT (shared/arena.ts).
- NPC города стоят со смещением от TOWN; новые места проверять через walkable().
- Обрыв связи: WorldRoom/ArenaRoom.onLeave без согласия → allowReconnection(RECONNECT_SEC=30), герой стоит в мире, обмен отменён; иначе сохранение и удаление. Вход тем же аккаунтом с другой вкладки вытесняет старую сессию (KICK_CODE).
