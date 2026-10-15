/**
 * Браузерная проверка переподключения (задача 33): пропала сеть → окно «Переподключение…» → сеть вернулась → игра идёт;
 * вход с другой вкладки → «Вы вошли с другого устройства» → «Войти снова»; искусственная ошибка → окно «Что-то пошло не так»
 * → «Переподключиться»; «Переподключиться» из меню Esc. Скриншоты в tools/out/shot-rc-*.png.
 * Запуск: TEST_PORT=2693 npx tsx tests/reconnect-screens.ts
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { createServer } from "vite";
import { ensureChar, PORT, sleep, startServer, stopServer } from "./harness";

const OUT = path.resolve("tools/out");
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `shot-rc-${name}.png`) });

function chromePath() {
  const list = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  const p = list.find((x) => x && fs.existsSync(x));
  if (!p) throw new Error("Chrome не найден: задайте CHROME_PATH");
  return p;
}

async function enter(page: Page, login: string, hero: string) {
  await page.goto("http://localhost:5198/", { waitUntil: "networkidle0" });
  await page.waitForSelector("#login-name");
  await page.$eval("#login-name", (e) => ((e as HTMLInputElement).value = ""));
  await page.type("#login-name", login);
  await page.type("#login-pass", "secret");
  await page.click("#login-go");
  await page.waitForSelector(`.cs-slot[data-name="${hero}"]`, { timeout: 10000 });
  await page.$eval(`.cs-slot[data-name="${hero}"]`, (b) => (b as HTMLElement).click());
  await page.click('.cs-list [data-a="play"]');
  await inGame(page);
}
const inGame = async (page: Page, timeout = 25000) => {
  try { await inGame0(page, timeout); } catch (e) {
    console.log("состояние:", await page.evaluate(() => JSON.stringify({ active: (window as any).__game?.scene?.isActive("game"), online: (window as any).__net?.online, self: !!(window as any).__net?.self, ui: document.getElementById("ui")!.hidden })), "окна:", await modalText(page));
    throw e;
  }
};
const inGame0 = (page: Page, timeout: number) =>
  page.waitForFunction(() => (window as any).__game?.scene?.isActive("game") && (window as any).__net?.online && !!(window as any).__net?.self, { timeout });
const visible = (_sel: string) => (s: string) => { const e = document.querySelector<HTMLElement>(s); return !!e && !e.hidden; };
const modalText = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".sys-back")].filter((e) => !e.hidden).map((e) => e.innerText).join(" | "));

async function main() {
  process.env.VITE_SERVER_URL = `ws://localhost:${PORT}`;
  await startServer(true);
  await ensureChar("Скиталец", "secret", "Скиталец", "warrior");
  const vite = await createServer({ configFile: path.resolve("vite.config.ts"), server: { port: 5198, strictPort: true, hmr: false, watch: { ignored: ["**/*"] } }, logLevel: "error" });
  await vite.listen();
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", "--no-sandbox"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const errors: string[] = [];
  const results: string[] = [];
  const ok = (s: string) => { results.push("ok   " + s); console.log("  ok   " + s); };
  try {
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); if (process.env.RC_DEBUG) console.log("[page]", m.type(), m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await enter(page, "Скиталец", "Скиталец");
    await sleep(1500);
    await shot(page, "0-game");

    // 1. сеть пропала
    const id0 = await page.evaluate(() => (window as any).__net.id);
    await page.setOfflineMode(true);
    let appeared = await page.waitForFunction(visible(".sys-back.reconnect"), { timeout: 20000 }, ".sys-back.reconnect").then(() => true, () => false);
    if (!appeared) {
      // эмуляция офлайна не рвёт уже открытый WebSocket в этой версии Chrome — рвём сокет сами
      console.log("  (офлайн-режим не затронул WebSocket — закрываем сокет вручную)");
      await page.evaluate(() => (window as any).__net.room.connection.close());
      appeared = await page.waitForFunction(visible(".sys-back.reconnect"), { timeout: 5000 }, ".sys-back.reconnect").then(() => true, () => false);
    }
    if (!appeared) throw new Error("окно «Переподключение…» не появилось");
    await sleep(2500);
    await shot(page, "1-reconnecting");
    const rcText = await modalText(page);
    if (!rcText.includes("Переподключение")) throw new Error("текст окна: " + rcText);
    ok("пропала сеть → окно «Переподключение…» с таймером");
    await page.setOfflineMode(false);
    await page.waitForFunction((s: string) => document.querySelector<HTMLElement>(s)!.hidden, { timeout: 25000 }, ".sys-back.reconnect");
    await inGame(page);
    await sleep(1500);
    const id1 = await page.evaluate(() => (window as any).__net.id);
    await shot(page, "2-resumed");
    ok(`сеть вернулась → игра продолжается (${id0 === id1 ? "та же сессия" : "новый вход"})`);
    // управление после переподключения
    const x0 = await page.evaluate(() => (window as any).__net.room.state.players.get((window as any).__net.id).x);
    await page.keyboard.down("d");
    await sleep(600);
    await page.keyboard.up("d");
    await sleep(300);
    const x1 = await page.evaluate(() => (window as any).__net.room.state.players.get((window as any).__net.id).x);
    if (!(x1 > x0 + 10)) throw new Error(`герой не двигается после переподключения: ${x0} → ${x1}`);
    ok("движение после переподключения");

    // 2. меню Esc → «Переподключиться»
    await page.keyboard.press("Escape");
    await sleep(200);
    if (!(await page.$(".gmenu-back:not([hidden]) .gm-item"))) await page.keyboard.press("Escape");
    await page.waitForSelector(".gmenu-back:not([hidden]) .gm-item", { timeout: 3000 });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".gm-item")].find((b) => b.textContent?.includes("Переподключиться"))!.click());
    await sleep(500);
    await inGame(page);
    await sleep(1500);
    await shot(page, "3-menu-reconnect");
    const units = await page.evaluate(() => (window as any).__game.scene.getScene("game").units.size);
    ok(`меню Esc → «Переподключиться»: мир загружен заново (юнитов ${units})`);

    // 3. вход с другой вкладки
    const page2 = await browser.newPage();
    page2.on("pageerror", (e) => errors.push("[2] " + String(e)));
    page2.on("console", (m) => { if (process.env.RC_DEBUG) console.log("[page2]", m.type(), m.text()); });
    await enter(page2, "Скиталец", "Скиталец");
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".sys-back")].some((e) => !e.hidden && e.innerText.includes("другого устройства")), { timeout: 5000 });
    await shot(page, "4-kicked");
    ok("вход с другой вкладки → старая: «Вы вошли с другого устройства»");
    await page.bringToFront(); // фоновая вкладка не рисует кадры
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".sys-back button")].find((b) => b.textContent === "Войти снова")!.click());
    await inGame(page);
    await page2.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".sys-back")].some((e) => !e.hidden && e.innerText.includes("другого устройства")), { timeout: 5000 });
    await page2.close();
    await sleep(1000);
    ok("«Войти снова» возвращает в игру");

    // 4. искусственная ошибка
    // скрипт со страницы (а не из evaluate), чтобы браузер отдал текст ошибки, как у настоящего сбоя
    await page.addScriptTag({ content: "setTimeout(() => { throw new Error(\"Искусственная ошибка для проверки\"); }, 0);" });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".sys-back")].some((e) => !e.hidden && e.innerText.includes("Что-то пошло не так")), { timeout: 5000 });
    await shot(page, "5-error");
    ok("ошибка → окно «Что-то пошло не так»");
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".sys-back button")].find((b) => b.textContent === "Переподключиться")!.click());
    await inGame(page, 40000);
    await sleep(2000);
    await shot(page, "6-after-error");
    ok("«Переподключиться» после ошибки: игра пересоздана");

    // 5. ошибка внутри цикла Phaser (сцена падает) → окно и восстановление
    await page.addScriptTag({ content: 'const s = window.__game.scene.getScene("game").sys, o = s.sceneUpdate; s.sceneUpdate = function () { s.sceneUpdate = o; throw new Error("Сбой в цикле сцены"); };' });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".sys-back")].some((e) => !e.hidden && e.innerText.includes("Что-то пошло не так")), { timeout: 5000 });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".sys-back button")].find((b) => b.textContent === "Переподключиться")!.click());
    await inGame(page, 40000);
    await sleep(1500);
    await shot(page, "7-after-phaser-error");
    ok("ошибка в цикле Phaser → «Переподключиться» восстанавливает игру");

    // 6. выход на экран входа из окна ошибки
    await page.evaluate(() => (window as any).__crash());
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".sys-back")].some((e) => !e.hidden), { timeout: 3000 });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".sys-back button")].find((b) => b.textContent === "Выйти на экран входа")!.click());
    await page.waitForFunction(() => !document.getElementById("login")!.hidden, { timeout: 5000 });
    ok("«Выйти на экран входа» работает");

    const bad = errors.filter((e) => !/Искусственная ошибка|Сбой в цикле|Проверка перехвата|ERR_INTERNET_DISCONNECTED|net::|WebSocket|Failed to fetch|переподключение/i.test(e));
    if (bad.some((e) => /Texture key already in use/i.test(e))) throw new Error("Texture key already in use");
    console.log(bad.length ? "Ошибки страницы:\n" + bad.slice(0, 15).join("\n") : "Ошибок страницы нет");
    console.log(`\nБраузерные проверки пройдены: ${results.length}`);
  } finally {
    await browser.close();
    await vite.close();
    await stopServer();
  }
}

main().catch((e) => {
  console.error(e);
  stopServer().finally(() => process.exit(1));
});
