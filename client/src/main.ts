import "@fontsource/rubik/400.css";
import "@fontsource/rubik/600.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "./styles.css";
import Phaser from "phaser";
import { api, session } from "./account";
import { BootScene } from "./game/BootScene";
import { GameScene } from "./game/GameScene";
import { net } from "./net";
import { CharSelect } from "./ui/charselect";
import { Hud } from "./ui/hud";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const netMsg = (ex: unknown) => {
  const msg = (ex as Error)?.message || String(ex);
  return /ECONNREFUSED|Failed to fetch|NetworkError|offline/i.test(msg) ? "Сервер недоступен. Запущен ли npm run dev?" : msg;
};

let game: Phaser.Game | null = null;
let hud: Hud | null = null;

const charsel = new CharSelect($("charsel"), {
  async play(name) {
    await net.connect({ token: session.token, character: name });
    charsel.hide();
    enterWorld();
  },
  logout: () => void logoutAccount(),
});

// ---------- вход в аккаунт ----------
try {
  const saved = localStorage.getItem("emberfall-login");
  if (saved) $<HTMLInputElement>("login-name").value = JSON.parse(saved).name || "";
} catch {}

/** Режим регистрации: та же форма, повтор пароля и «Назад». */
let reg = false;
function setReg(on: boolean) {
  reg = on;
  document.querySelectorAll<HTMLElement>(".reg-only").forEach((x) => (x.hidden = !on));
  const go = $<HTMLButtonElement>("login-go"), make = $<HTMLButtonElement>("login-new");
  go.hidden = on;
  make.classList.toggle("primary", on);
  make.textContent = on ? "Зарегистрироваться" : "Создать аккаунт";
  $<HTMLInputElement>("login-pass2").required = on;
  $<HTMLInputElement>("login-pass").autocomplete = on ? "new-password" : "current-password";
  $("login-error").textContent = "";
}
$("login-back").addEventListener("click", () => setReg(false));
$("login").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reg) {
    e.preventDefault();
    setReg(false);
  }
});

function showLogin(msg = "") {
  charsel.hide();
  setReg(false);
  $("login").hidden = false;
  $("login-error").textContent = msg;
  const go = $<HTMLButtonElement>("login-go"), make = $<HTMLButtonElement>("login-new");
  go.disabled = make.disabled = false;
  go.textContent = "Войти";
  $<HTMLInputElement>("login-pass").value = "";
  ($<HTMLInputElement>("login-name").value ? $("login-pass") : $("login-name")).focus();
}

async function doLogin(create: boolean) {
  const form = $<HTMLFormElement>("login-form");
  if (!form.reportValidity()) return;
  const login = $<HTMLInputElement>("login-name").value.trim();
  const password = $<HTMLInputElement>("login-pass").value;
  const go = $<HTMLButtonElement>("login-go"), make = $<HTMLButtonElement>("login-new");
  const err = $("login-error");
  err.textContent = "";
  if (create && password !== $<HTMLInputElement>("login-pass2").value) return void (err.textContent = "Пароли не совпадают");
  go.disabled = make.disabled = true;
  if (!create) go.textContent = "Вход…";
  try {
    const view = await api.login(login, password, create);
    try { localStorage.setItem("emberfall-login", JSON.stringify({ name: login })); } catch {}
    $("login").hidden = true;
    charsel.show(view);
  } catch (ex) {
    err.textContent = netMsg(ex);
    go.disabled = make.disabled = false;
    if (create) make.textContent = "Зарегистрироваться";
    go.textContent = "Войти";
  }
}
$<HTMLFormElement>("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void doLogin(reg);
});
$("login-new").addEventListener("click", () => {
  if (!reg) {
    setReg(true);
    $("login-name").focus();
  } else void doLogin(true);
});

async function logoutAccount(msg = "") {
  await api.logout();
  showLogin(msg);
}

/** К выбору героя (после выхода из мира или при перезагрузке вкладки с живой сессией). */
async function toCharSelect(msg = "") {
  try {
    const view = await api.chars();
    $("login").hidden = true;
    charsel.show(view, msg);
  } catch (ex) {
    showLogin((ex as Error & { status?: number }).status === 401 ? "" : netMsg(ex));
  }
}

// ---------- мир ----------
function enterWorld() {
  $("ui").hidden = false;
  if (game) {
    game.scene.start("game");
    return;
  }
  hud = new Hud($("ui"));
  game = new Phaser.Game({
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
  net.on("switch", () => game!.scene.getScene("game")?.scene.restart());
  net.on("leave", (code) => {
    if (code !== 1000) hud!.toast({ text: "Соединение с сервером потеряно. Обновите страницу.", kind: "error" });
  });
  // выход из мира без перезагрузки страницы
  net.on("logout", (mode) => {
    game!.scene.stop("game");
    hud!.reset();
    $("ui").hidden = true;
    if (mode === "account") void logoutAccount();
    else void toCharSelect();
  });
}

$("ui").hidden = true;
(window as any).__net = net;
if (session.token) void toCharSelect();
else showLogin();
