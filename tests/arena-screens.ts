/**
 * Арена в настоящих браузерных клиентах (Chrome через puppeteer-core): очередь через окно арены,
 * подтверждение, отсчёт, бой, экран результатов и возврат в мир. Скриншоты — tools/out/arena-*.png.
 * Запуск: npm run screenshot:arena
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createServer } from "vite";
import { PORT, sleep, startServer, stopServer } from "./harness";

const OUT = path.resolve("tools/out");
fs.mkdirSync(OUT, { recursive: true });
const errors: string[] = [];

function chromePath() {
  const list = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const p = list.find((x) => x && fs.existsSync(x));
  if (!p) throw new Error("Chrome не найден: задайте CHROME_PATH");
  return p;
}

async function openClient(browser: Browser, name: string, cls: string): Promise<Page> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  await page.goto("http://localhost:5199/", { waitUntil: "networkidle0" });
  await page.type("#login-name", name);
  await page.type("#login-pass", "secret");
  await page.click(`[data-cls="${cls}"]`);
  await page.click("#login-go");
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive("game"), { timeout: 60000 });
  await sleep(800);
  return page;
}
const dbg = (p: Page, m: Record<string, unknown>) => p.evaluate((x) => (window as any).__net.send("dbg", x), m);
const kind = (p: Page) => p.evaluate(() => (window as any).__net.kind as string);
const phase = (p: Page) => p.evaluate(() => (window as any).__net.room.state.phase as string);
async function clickText(p: Page, selector: string, text: string) {
  await p.waitForFunction((s, t) => [...document.querySelectorAll<HTMLElement>(s)].some((b) => b.offsetParent && b.textContent?.includes(t)), { timeout: 10000 }, selector, text);
  await p.evaluate((s, t) => [...document.querySelectorAll<HTMLElement>(s)].find((b) => b.offsetParent && b.textContent?.includes(t))!.click(), selector, text);
}
async function waitFor(p: Page, fn: () => boolean, ms = 15000) {
  try {
    await p.waitForFunction(fn, { timeout: ms });
  } catch (e) {
    await p.screenshot({ path: path.join(OUT, "arena-fail.png") });
    const state = await p.evaluate(() => { const n = (window as any).__net; return JSON.stringify({ kind: n.kind, phase: n.room?.state?.phase, toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent) }); });
    throw new Error(`не дождались: ${fn.toString()} — ${state}`);
  }
}
async function shot(p: Page, name: string) {
  await p.screenshot({ path: path.join(OUT, `arena-${name}.png`) });
}
/** Сильный герой для быстрого боя. */
async function buff(p: Page) {
  await dbg(p, { op: "level", v: 30 });
  await dbg(p, { op: "item", unique: "ashbringer" });
  await sleep(400);
  await p.evaluate(() => {
    const n = (window as any).__net;
    const i = n.self.inventory.findIndex((x: any) => x?.unique === "ashbringer");
    if (i >= 0) n.send("equip", { index: i });
  });
  await sleep(300);
}

async function main() {
  process.env.VITE_SERVER_URL = `ws://localhost:${PORT}`;
  await startServer(true);
  const vite = await createServer({ configFile: path.resolve("vite.config.ts"), server: { port: 5199, strictPort: true }, logLevel: "error" });
  await vite.listen();
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    // ---------- 1×1 ----------
    console.log("1×1: два браузерных клиента");
    const a = await openClient(browser, "Тигран", "warrior");
    const b = await openClient(browser, "Мирон", "mage");
    await buff(a);
    // A идёт к распорядителю арены в городе (клавиша F рядом с NPC открывает окно)
    await dbg(a, { op: "tp", x: 30 * 32 + 16, y: 69 * 32 });
    await sleep(500);
    await a.keyboard.press("f");
    try {
      await waitFor(a, () => !document.querySelector(".win-arena")?.hasAttribute("hidden"), 5000);
    } catch (e) {
      await shot(a, "debug");
      console.log("debug:", await a.evaluate(() => { const g = (window as any).__game.scene.getScene("game"); return JSON.stringify({ pos: g.pos, npcs: g.npcs.map((n: any) => [n.kind, n.sprite.x, n.sprite.y]), active: document.activeElement?.tagName }); }));
      throw e;
    }
    await sleep(500);
    await shot(a, "1-window");
    await clickText(a, ".win-arena .mode-card .btn", "В очередь");
    await b.keyboard.press("p");
    await waitFor(b, () => !document.querySelector(".win-arena")?.hasAttribute("hidden"));
    await sleep(300);
    await clickText(b, ".win-arena .mode-card .btn", "В очередь");
    await waitFor(a, () => !!document.querySelector(".arena-dialog [data-a='1']"));
    await sleep(300);
    await shot(a, "2-found");
    for (const p of [a, b]) await clickText(p, ".arena-dialog .btn", "Принять");
    for (const p of [a, b]) await waitFor(p, () => (window as any).__net.kind === "arena");
    await waitFor(a, () => (window as any).__net.room.state.phase === "countdown");
    await sleep(1200);
    await shot(a, "3-countdown");
    await waitFor(a, () => (window as any).__net.room.state.phase === "fight", 10000);
    await a.keyboard.press("Tab");
    await sleep(2200);
    await shot(a, "4-fight");
    await waitFor(a, () => !!document.querySelector(".arena-modal:not([hidden]) #res-title"), 15000);
    await sleep(400);
    await shot(a, "5-result");
    await shot(b, "5-result-loser");
    for (const p of [a, b]) await clickText(p, ".arena-dialog .btn", "Вернуться в мир");
    for (const p of [a, b]) await waitFor(p, () => (window as any).__net.kind === "world");
    await sleep(1200);
    await a.keyboard.press("p");
    await sleep(600);
    await clickText(a, ".win-arena .tabs .btn", "История");
    await sleep(500);
    await shot(a, "6-history");
    console.log("  1×1:", await kind(a), "после матча;", "фаза боя достигнута");

    // ---------- 2×2 ----------
    console.log("2×2: четыре браузерных клиента, группа через приглашение");
    const c = await openClient(browser, "Лада", "ranger");
    const d = await openClient(browser, "Остап", "warrior");
    await buff(c);
    // группа: Тигран приглашает Ладу через окно арены
    await a.evaluate(() => (document.getElementById("party-invite-name") as HTMLInputElement | null) && 0);
    await clickText(a, ".win-arena .tabs .btn", "Рейтинг");
    await sleep(300);
    await a.type("#party-invite-name", "Лада");
    await clickText(a, ".win-arena .btn", "Пригласить");
    await waitFor(c, () => [...document.querySelectorAll(".arena-dialog")].some((x) => x.textContent?.includes("приглашает")));
    await shot(c, "7-invite");
    await clickText(c, ".arena-dialog .btn", "Принять");
    await waitFor(a, () => (window as any).__net.party?.members?.length === 2);
    await sleep(500);
    await shot(a, "8-party");
    await clickText(a, ".win-arena .mode-card .btn", "В очередь с группой");
    for (const p of [b, d]) {
      await p.keyboard.press("p");
      await sleep(400);
      const cards = await p.$$(".win-arena .mode-card");
      const btn = await cards[1].$(".btn");
      await btn!.click();
    }
    for (const p of [a, b, c, d]) await waitFor(p, () => !!document.querySelector(".arena-dialog [data-a='1']"), 20000);
    await shot(d, "9-found-2v2");
    for (const p of [a, b, c, d]) await clickText(p, ".arena-dialog .btn", "Принять");
    for (const p of [a, b, c, d]) await waitFor(p, () => (window as any).__net.kind === "arena", 15000);
    await waitFor(a, () => (window as any).__net.room.state.phase === "fight", 15000);
    await a.keyboard.press("Tab");
    await c.keyboard.press("Tab");
    await sleep(2500);
    await shot(a, "10-fight-2v2");
    // после каждого убийства игрок выбирает следующую цель клавишей Tab
    for (let i = 0; i < 20 && !(await a.$(".arena-modal:not([hidden]) #res-title")); i++) {
      for (const p of [a, c]) await p.keyboard.press("Tab");
      await sleep(1500);
    }
    await waitFor(a, () => !!document.querySelector(".arena-modal:not([hidden]) #res-title"), 10000);
    await sleep(400);
    await shot(a, "11-result-2v2");
    console.log("  2×2: фаза", await phase(a));
  } finally {
    await browser.close();
    await vite.close();
    await stopServer();
  }
  if (errors.length) {
    console.log("Ошибки в консоли браузера:\n" + errors.slice(0, 20).join("\n"));
    process.exitCode = 1;
  } else console.log("Ошибок в консоли нет. Скриншоты: tools/out/arena-*.png");
}

main().catch(async (e) => {
  console.error(e);
  if (errors.length) console.log("Ошибки в консоли браузера:\n" + errors.slice(0, 20).join("\n"));
  await stopServer();
  process.exit(1);
});
