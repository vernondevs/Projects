/**
 * Скриншоты клиента: поднимает тестовый сервер и Vite, входит в игру через Chrome (puppeteer-core).
 * npm run screenshot [-- сценарий]   Сценарии: basic (по умолчанию), dungeon, ui, combat.
 * Путь к Chrome: переменная CHROME_PATH, иначе стандартные пути Windows/Linux/macOS.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { createServer } from "vite";
import { PORT, sleep, startServer, stopServer } from "./harness";

const scenario = process.argv[2] || "basic";
const OUT = path.resolve("tools/out");
fs.mkdirSync(OUT, { recursive: true });

function chromePath() {
  const list = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const p = list.find((x) => x && fs.existsSync(x));
  if (!p) throw new Error("Chrome не найден: задайте CHROME_PATH");
  return p;
}

async function login(page: Page, name: string, cls: string) {
  await page.waitForSelector("#login-name");
  await page.type("#login-name", name);
  await page.type("#login-pass", "secret");
  await page.$eval(`[data-cls="${cls}"]`, (b) => (b as HTMLElement).click());
  await page.click("#login-go");
  await page.waitForFunction(() => document.getElementById("login")!.hidden, { timeout: 15000 });
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive("game"), { timeout: 20000 });
  await sleep(1500);
}

async function main() {
  process.env.VITE_SERVER_URL = `ws://localhost:${PORT}`;
  await startServer(true);
  const vite = await createServer({ configFile: path.resolve("vite.config.ts"), server: { port: 5199, strictPort: true }, logLevel: "error" });
  await vite.listen();
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", "--no-sandbox"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:5199/", { waitUntil: "networkidle0" });
    await page.screenshot({ path: path.join(OUT, "shot-login.png") });
    const cls = process.env.CLS || (scenario === "mage" ? "mage" : scenario === "ranger" ? "ranger" : "warrior");
    await login(page, "Скриншот", cls);
    await page.screenshot({ path: path.join(OUT, "shot-town.png") });
    const dbg = (m: Record<string, unknown>) => page.evaluate((x) => (window as any).__net.send("dbg", x), m);
    const near = async (mob: string) => {
      const { generateMap } = await import("../shared/map");
      const { MAP_SEED } = await import("../shared/constants");
      const map = generateMap(MAP_SEED);
      const t = map.playerSpawn;
      return map.spawns.filter((s) => s.mob === mob).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
    };
    if (scenario.startsWith("tp:")) {
      // tp:<моб>[:level] — бой у точки появления моба
      const [, mob, lvl] = scenario.split(":");
      if (lvl) await dbg({ op: "level", v: Number(lvl) });
      await dbg({ op: "god" });
      await dbg({ op: "drop", v: true });
      const sp = await near(mob);
      await dbg({ op: "tp", x: sp.x + 60, y: sp.y + 20 });
      await sleep(800);
      await page.keyboard.press("Tab");
      await sleep(1800);
      await page.screenshot({ path: path.join(OUT, "shot-fight1.png") });
      await page.keyboard.press("1");
      await sleep(350);
      await page.screenshot({ path: path.join(OUT, "shot-fight2.png") });
      await sleep(2500);
      await page.screenshot({ path: path.join(OUT, "shot-fight3.png") });
    } else if (scenario.startsWith("boss:")) {
      const id = scenario.split(":")[1];
      const { BOSS_SPAWNS } = await import("../shared/map");
      const b = BOSS_SPAWNS.find((x) => x.id === id)!;
      await dbg({ op: "level", v: 30 });
      await dbg({ op: "god" });
      await dbg({ op: "tp", x: b.x - 140, y: b.y + 40 });
      await sleep(900);
      await page.keyboard.press("Tab");
      await sleep(1500);
      await page.evaluate((sprite) => { const n = (window as any).__net; n.room.state.mobs.forEach((m: any, k: string) => { if (m.sprite === sprite) n.send("dbg", { op: "mobhp", id: k, v: 0.5 }); }); }, id);
      for (let i = 1; i <= 8; i++) { await sleep(900); await page.screenshot({ path: path.join(OUT, `shot-boss${i}.png`) }); }
    } else if (scenario === "wins") {
      await dbg({ op: "level", v: 12 });
      await dbg({ op: "item", base: "sword", ilvl: 12, rarity: 2 });
      await sleep(500);
      for (const [key, name] of [["i", "inv"], ["k", "skills"], ["b", "bestiary"], ["p", "arena"]] as const) {
        await page.keyboard.press(key);
        await sleep(500);
        await page.screenshot({ path: path.join(OUT, `shot-win-${name}.png`) });
        await page.keyboard.press("Escape");
      }
      await page.click(".mbtn:last-child");
      await sleep(300);
      await page.evaluate(() => { const r = document.getElementById("set-scale") as HTMLInputElement; r.value = "120"; r.dispatchEvent(new Event("input")); });
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "shot-win-settings.png") });
    } else if (scenario === "ui") {
      await dbg({ op: "level", v: 12 });
      await dbg({ op: "item", base: "sword", ilvl: 12, rarity: 2 });
      await dbg({ op: "item", base: "helmet", ilvl: 10, rarity: 1 });
      await dbg({ op: "item", base: "ring", ilvl: 11, rarity: 1 });
      await dbg({ op: "item", unique: "rootbreaker" });
      await dbg({ op: "item", base: "boots", ilvl: 9, rarity: 0 });
      await sleep(500);
      await page.keyboard.press("c");
      await page.keyboard.press("i");
      await sleep(400);
      const cell = await page.$(".win-inv .grid .cell:nth-child(4)");
      if (cell) await cell.hover();
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "shot-ui.png") });
      await page.keyboard.press("Escape");
      await page.keyboard.press("k");
      await sleep(500);
      const node = await page.$(".win-skills .node:nth-child(3) .slot");
      if (node) await node.hover();
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "shot-skills.png") });
    } else {
      // прогулка на восток, к выходу из города
      await page.keyboard.down("d");
      await sleep(scenario === "combat" ? 6000 : 2500);
      await page.keyboard.up("d");
      await sleep(600);
      await page.screenshot({ path: path.join(OUT, "shot-walk.png") });
      if (scenario === "combat") {
        await page.keyboard.press("Tab");
        await sleep(300);
        await page.keyboard.press("1");
        await sleep(2500);
        await page.screenshot({ path: path.join(OUT, "shot-combat.png") });
      }
    }
    const fps = await page.evaluate(() => Math.round((window as any).__game.loop.actualFps));
    console.log("fps:", fps);
  } finally {
    await browser.close();
    await vite.close();
    await stopServer();
  }
  if (errors.length) {
    console.log("Ошибки в консоли браузера:\n" + errors.slice(0, 15).join("\n"));
    process.exitCode = 1;
  } else console.log("Ошибок в консоли нет. Скриншоты в tools/out/shot-*.png");
}

main().catch(async (e) => {
  console.error(e);
  await stopServer();
  process.exit(1);
});
