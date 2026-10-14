import "@fontsource/rubik/400.css";
import "@fontsource/rubik/600.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "./styles.css";
import Phaser from "phaser";
import { CLASSES, CLASS_IDS, type ClassId } from "../../shared/classes";
import { BootScene } from "./game/BootScene";
import { GameScene } from "./game/GameScene";
import { net } from "./net";
import { Hud } from "./ui/hud";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let cls: ClassId = "warrior";
try {
  const saved = localStorage.getItem("emberfall-login");
  if (saved) {
    const s = JSON.parse(saved);
    $<HTMLInputElement>("login-name").value = s.name || "";
    if (CLASS_IDS.includes(s.cls)) cls = s.cls;
  }
} catch {}

const box = $("login-classes");
for (const id of CLASS_IDS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.dataset.cls = id;
  b.setAttribute("aria-pressed", String(id === cls));
  b.innerHTML = `<span class="cls-sprite" style="background-image:url(/assets/units/${id}.png)"></span>${CLASSES[id].name}<small>${CLASSES[id].desc}</small>`;
  b.onclick = () => {
    cls = id;
    box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  };
  box.appendChild(b);
}

$<HTMLFormElement>("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("login-name").value.trim();
  const password = $<HTMLInputElement>("login-pass").value;
  const go = $<HTMLButtonElement>("login-go");
  const err = $("login-error");
  err.textContent = "";
  go.disabled = true;
  go.textContent = "Подключение…";
  try {
    await net.connect({ name, password, cls });
    try {
      localStorage.setItem("emberfall-login", JSON.stringify({ name, cls }));
    } catch {}
    $("login").hidden = true;
    start();
  } catch (ex) {
    const msg = (ex as Error)?.message || String(ex);
    err.textContent = /ECONNREFUSED|Failed to fetch|NetworkError|offline/i.test(msg) ? "Сервер недоступен. Запущен ли npm run dev?" : msg;
    go.disabled = false;
    go.textContent = "Войти в мир";
  }
});

function start() {
  const hud = new Hud($("ui"));
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#120f16",
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [BootScene, GameScene],
    input: { mouse: { preventDefaultWheel: false } },
    disableContextMenu: true,
  });
  game.registry.set("hud", hud);
  (window as any).__game = game;
  (window as any).__net = net;
  // переход мир ⇄ арена: сцена перестраивается под новую карту и комнату
  net.on("switch", () => game.scene.getScene("game")?.scene.restart());
  net.on("leave", (code) => {
    if (code !== 1000) hud.toast({ text: "Соединение с сервером потеряно. Обновите страницу.", kind: "error" });
  });
}
