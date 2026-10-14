# Источники и лицензии

## Графика

Вся графика игры оригинальная и сделана для этого проекта: тайлы, персонажи, мобы, боссы, объекты, иконки, эффекты. Сторонние спрайты и тайлсеты не используются.

Изображения рисует код генератора в `tools/gen/` (`canvas.ts`, `palette.ts`, `tiles.ts`, `units.ts`, `objects.ts`). Команда `npm run assets` пересоздаёт их в `client/public/assets/`. Палитра собрана вручную в `tools/gen/palette.ts`.

## Шрифт

- **Pixelify Sans**, автор Stefie Justprince. Лицензия SIL Open Font License 1.1. Подключён через пакет [`@fontsource/pixelify-sans`](https://fontsource.org/fonts/pixelify-sans) и собирается вместе с клиентом, поэтому интернет для шрифта не нужен.

## Звук

Звуков в игре нет.

## Библиотеки

| Библиотека | Назначение | Лицензия |
|---|---|---|
| [Phaser 3](https://phaser.io) | движок клиента | MIT |
| [Colyseus](https://colyseus.io) (`@colyseus/core`, `@colyseus/schema`, `@colyseus/ws-transport`, `colyseus.js`) | сервер и синхронизация состояния | MIT |
| [Express](https://expressjs.com) | HTTP-сервер | MIT |
| [Vite](https://vite.dev) | сборка и dev-сервер клиента | MIT |
| [tsx](https://tsx.is), [TypeScript](https://www.typescriptlang.org) | запуск и проверка TypeScript | MIT, Apache-2.0 |
| [pngjs](https://github.com/pngjs/pngjs) | запись PNG в генераторе ассетов | MIT |
| [concurrently](https://github.com/open-cli-tools/concurrently) | запуск сервера и клиента одной командой | MIT |
| [puppeteer-core](https://pptr.dev) | скриншоты клиента в тестах | Apache-2.0 |
| `node:sqlite` | хранение прогресса | встроен в Node.js (MIT) |
