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

/** Регистрация аккаунта, создание героя на экране выбора и вход в мир. */
async function login(page: Page, name: string, cls: string) {
  await page.waitForSelector("#login-name");
  await page.type("#login-name", name);
  await page.type("#login-pass", "secret");
  await page.click("#login-new");
  await page.type("#login-pass2", "secret");
  await page.screenshot({ path: path.join(OUT, "shot-register.png") });
  await page.click("#login-new");
  await page.waitForSelector(".cs-create input[name=name]", { timeout: 10000 });
  await page.type(".cs-create input[name=name]", name);
  await page.$eval(`.cs-create [data-cls="${cls}"]`, (b) => (b as HTMLElement).click());
  await page.$eval(`.cs-create [data-look="2"]`, (b) => (b as HTMLElement).click());
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, "shot-create.png") });
  await page.click(".cs-create [type=submit]");
  await page.waitForSelector(".cs-list .cs-slot[data-name]", { timeout: 10000 });
  // ещё двое героев через API, чтобы экран выбора был заполнен
  const token = await page.evaluate(() => sessionStorage.getItem("emberfall-token"));
  for (const [n, c, l] of [["Лучница", "ranger", 4], ["Целитель", "healer", 0]] as const)
    await fetch(`http://localhost:${PORT}/api/chars`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: n, cls: c, look: l }) });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".cs-list .cs-slot[data-name]", { timeout: 10000 });
  await page.$eval(`.cs-slot[data-name="${name}"]`, (b) => (b as HTMLElement).click());
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, "shot-charselect.png") });
  await page.click('.cs-list [data-a="play"]');
  await page.waitForFunction(() => document.getElementById("charsel")!.hidden, { timeout: 15000 });
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
    ignoreDefaultArgs: ["--hide-scrollbars"],
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
    if (scenario === "town") {
      // город: ворота со стражей, таверна, кузница, общий вид с отдалением
      const { TOWN } = await import("../shared/town");
      const at = (dx: number, dy: number) => ({ op: "tp", x: (TOWN.x + dx) * 32 + 16, y: (TOWN.y + dy) * 32 + 16 });
      for (const [name, dx, dy] of [["gate", 0, -15], ["tavern", -16, 0], ["forge", 17, 0], ["bank", -14, 9], ["east", 21, 2]] as const) {
        await dbg(at(dx, dy));
        await sleep(1500);
        await page.screenshot({ path: path.join(OUT, `shot-town-${name}.png`) });
      }
      await dbg(at(0, 0));
      await page.evaluate(() => (window as any).__game.scene.getScene("game").cameras.main.setZoom(1));
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, "shot-town-wide.png") });
      // ночь: сдвигаем часы страницы в середину ночной фазы цикла, смотрим на стражу у ворот
      await page.evaluate(() => {
        const o = Date.now.bind(Date), C = 20 * 60 * 1000;
        const off = (0.82 * C - (o() % C) + C) % C;
        Date.now = () => o() + off;
        (window as any).__game.scene.getScene("game").cameras.main.setZoom(2);
      });
      await dbg(at(0, -15));
      await sleep(2500);
      await page.screenshot({ path: path.join(OUT, "shot-town-night.png") });
    } else if (scenario === "cities") {
      // малые города: ворота, площадь, жилой квартал, окна заданий и телепорта, общий вид
      const { CITIES } = await import("../shared/cities");
      await dbg({ op: "god" });
      await dbg({ op: "level", v: 20 });
      await dbg({ op: "gold", v: 500 });
      for (const c of CITIES.filter((x) => x.style)) {
        const at = (dx: number, dy: number) => ({ op: "tp", x: (c.x + dx) * 32 + 16, y: (c.y + dy) * 32 + 16 });
        for (const [name, dx, dy] of [["gate", 0, -14], ["plaza", 0, 3], ["west", -8, 3], ["north", 5, -4], ["south", 0, 12]] as const) {
          await dbg(at(dx, dy));
          await sleep(1500);
          await page.screenshot({ path: path.join(OUT, `shot-city-${c.id}-${name}.png`) });
        }
        await dbg(at(-8, 3));
        await sleep(600);
        await page.evaluate((id) => { const sc = (window as any).__game.scene.getScene("game"); sc.hud.quest.open(id); }, c.quest!.id);
        await sleep(400);
        await page.screenshot({ path: path.join(OUT, `shot-city-${c.id}-quest.png`) });
        await page.evaluate(() => { const sc = (window as any).__game.scene.getScene("game"); sc.hud.quest.close(); sc.hud.tp.open(sc.pos); });
        await sleep(400);
        await page.screenshot({ path: path.join(OUT, `shot-city-${c.id}-tp.png`) });
        await page.evaluate(() => { const sc = (window as any).__game.scene.getScene("game"); sc.hud.tp.close(); sc.cameras.main.setZoom(1); });
        await dbg(at(0, 0));
        await sleep(1800);
        await page.screenshot({ path: path.join(OUT, `shot-city-${c.id}-wide.png`) });
        await page.evaluate(() => (window as any).__game.scene.getScene("game").cameras.main.setZoom(3));
      }
    } else if (scenario.startsWith("tp:")) {
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
    } else if (scenario === "biomes") {
      // биомы: телепорт в каждый, скриншот
      const { generateMap, walkable } = await import("../shared/map");
      const { MAP_SEED } = await import("../shared/constants");
      const map = generateMap(MAP_SEED);
      const spot = (tx: number, ty: number) => {
        for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = (tx + dx) * 32 + 16, y = (ty + dy) * 32 + 16;
          if (walkable(map, x, y, 10)) return { x, y };
        }
        return { x: tx * 32, y: ty * 32 };
      };
      await dbg({ op: "god" });
      for (const [name, tx, ty] of [["forest", 130, 60], ["swamp", 150, 190], ["desert", 24, 152], ["desert2", 30, 90], ["snow", 112, 18], ["snow2", 180, 14], ["volcano", 290, 62], ["volcano2", 292, 186], ["water", 170, 222], ["water2", 130, 214]] as const) {
        const p = spot(tx, ty);
        await dbg({ op: "tp", x: p.x, y: p.y });
        await sleep(3500);
        await page.screenshot({ path: path.join(OUT, `shot-biome-${name}.png`) });
      }
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
      await page.keyboard.press("i");
      await sleep(300);
      await page.evaluate(() => (document.querySelector(".cell.comp") as HTMLElement).click());
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "shot-win-inv-pet-popup.png") });
      await page.keyboard.press("Escape");
      // drag inventory by header
      await page.keyboard.press("i");
      await sleep(400);
      const hb = await page.evaluate(() => { const r = document.querySelector(".win-inv h2")!.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 10 }; });
      await page.mouse.move(hb.x, hb.y); await page.mouse.down(); await page.mouse.move(hb.x - 300, hb.y + 120, { steps: 8 }); await page.mouse.up();
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, "shot-win-inv-dragged.png") });
      console.log("inv rect", JSON.stringify(await page.evaluate(() => { const w = document.querySelector<HTMLElement>(".win-inv")!; return [w.style.left, w.style.top, localStorage.getItem("winpos:Скриншот")]; })));
      await page.keyboard.press("Escape");
      await page.keyboard.press("b");
      await sleep(400);
      await page.evaluate(() => { const l = document.querySelector(".bst-list"); if (l) l.scrollTop = 9999; });
      await page.screenshot({ path: path.join(OUT, "shot-win-bestiary-scrolled.png") });
      await page.keyboard.press("Escape");
      // меню по Esc (цель снята, окон нет)
      await page.keyboard.press("Escape");
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "shot-win-escmenu.png") });
      await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".gm-item")].find((b) => b.textContent?.includes("Настройки"))!.click());
      await sleep(300);
      await page.evaluate(() => { const r = document.getElementById("set-scale") as HTMLInputElement; r.value = "120"; r.dispatchEvent(new Event("input")); });
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "shot-win-settings.png") });
      await page.keyboard.press("Escape");
      await dbg({ op: "gold", v: 3000 });
      await page.evaluate(() => (window as any).__game.scene.getScene("game").hud.openShop());
      await sleep(600);
      await page.screenshot({ path: path.join(OUT, "shot-win-shop.png") });
      await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".shop-tabs .btn")][1].click());
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, "shot-win-shop-sell.png") });
    } else if (scenario === "logout") {
      // выход к выбору героя без перезагрузки страницы, затем снова в мир
      await page.evaluate(() => ((window as any).__mark = 1));
      const clickText = (t: string) => page.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>(".gmenu button")].find((b) => b.textContent!.includes(t))!.click(), t);
      await page.keyboard.press("Escape");
      await sleep(300);
      await clickText("Сменить персонажа");
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, "shot-logout-confirm.png") });
      await clickText("Сменить героя");
      await page.waitForFunction(() => !document.getElementById("charsel")!.hidden, { timeout: 5000 });
      await sleep(400);
      if (!(await page.evaluate(() => (window as any).__mark === 1))) throw new Error("страница перезагрузилась");
      await page.screenshot({ path: path.join(OUT, "shot-logout.png") });
      await page.click('.cs-list [data-a="play"]');
      await page.waitForFunction(() => (window as any).__game?.scene?.isActive("game") && document.getElementById("charsel")!.hidden, { timeout: 15000 });
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, "shot-relogin.png") });
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
