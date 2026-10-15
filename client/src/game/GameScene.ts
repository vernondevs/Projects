import Phaser from "phaser";
import { MERCHANT_RANGE, PICKUP_RANGE, PLAYER_RADIUS, PLAYER_SPEED, TILE } from "../../../shared/constants";
import { generateMap, moveWithCollision, terrainSpeedMul, zoneAtPx, ZONES, type WorldMap, Zone } from "../../../shared/map";
import { ENV } from "../../../shared/biomes";
import * as sfx from "./sfx";
import { Anim, BUFF_STEALTH, BUFF_ROOT, BUFF_SLOW, BUFF_STUN, UnitKind, type LootBag } from "../../../shared/protocol";
import { activeSkills, SKILLS } from "../../../shared/skills";
import { RUMOR_NPCS } from "../../../shared/rumors";
import { COOK } from "../../../shared/food";
import { CITIES } from "../../../shared/cities";
import { SMITH } from "../../../shared/upgrade";
import { BANKER } from "../../../shared/bank";
import { BAGMAN } from "../../../shared/bags";
import { ARENA_NPC, generateArenaMap, MODE_NAMES } from "../../../shared/arena";
import { MOUNTS } from "../../../shared/mounts";
import { net, type UnitState } from "../net";
import { PETS } from "../../../shared/pets";
import type { Hud } from "../ui/hud";
import { Effects } from "./effects";
import { Scenes } from "./scenes";
import { buildWorld, DEPTH, zoneTint, type WorldView } from "./terrain";
import { FONT, UnitView } from "./UnitView";

type NpcKind = "shop" | "arena" | "rumor" | "cook" | "smith" | "bank" | "bags" | "enc" | "quest" | "stone";
type Npc = { sprite: Phaser.GameObjects.Sprite; kind: NpcKind; id?: string; name?: string; objs?: Phaser.GameObjects.GameObject[] };

const AMBIENCE: Partial<Record<Zone, string>> = {
  [Zone.Town]: "town", [Zone.OasisCity]: "desert", [Zone.SnowCity]: "snow", [Zone.Meadow]: "meadow", [Zone.Forest]: "forest", [Zone.Swamp]: "swamp", [Zone.Ashlands]: "ash", [Zone.Dungeon]: "dungeon", [Zone.Arena]: "ash",
  [Zone.Desert]: "desert", [Zone.Snow]: "snow", [Zone.Volcano]: "volcano", [Zone.Underwater]: "water", [Zone.Frontier]: "meadow",
};
const ZONE_COLOR: Partial<Record<Zone, string>> = { [Zone.OasisCity]: "#f0c070", [Zone.SnowCity]: "#bfe4ff", [Zone.Desert]: "#f0c070", [Zone.Snow]: "#bfe4ff", [Zone.Volcano]: "#ff8a4a", [Zone.Underwater]: "#7ad0ff", [Zone.Swamp]: "#a8d890", [Zone.Forest]: "#a8e080" };

export class GameScene extends Phaser.Scene {
  map!: WorldMap;
  world!: WorldView;
  hud!: Hud;
  fx!: Effects;
  units = new Map<string, UnitView>();
  me: UnitView | null = null;
  /** Предсказанная позиция своего героя. */
  pos = { x: 0, y: 0 };
  keys = new Set<string>();
  lastInput = { mx: 0, my: 0, at: 0 };
  targetId: string | null = null;
  bagViews = new Map<string, Phaser.GameObjects.Image>();
  pendingPickup: string | null = null;
  /** NPC города (только в мире): торговка и распорядитель арены. */
  npcs: Npc[] = [];
  pendingNpc: Npc | null = null;
  /** Узлы добычи: исчерпанные и узел, к которому идём. */
  depletedNodes = new Set<number>();
  pendingGather: number | null = null;
  private npcExtras: Phaser.GameObjects.GameObject[] = [];
  private cleanup: (() => void)[] = [];
  bubbles: { t: Phaser.GameObjects.Text; id: string; until: number }[] = [];
  zone: Zone = Zone.Town;
  clickMark!: Phaser.GameObjects.Image;
  hoverId: string | null = null;
  ambient: Record<string, Phaser.GameObjects.Particles.ParticleEmitter> = {};
  dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  selfLight!: Phaser.GameObjects.Image;
  dustAt = new Map<string, number>();

  constructor() {
    super("game");
  }

  private scenes: Scenes | null = null;

  create() {
    // сцена перезапускается при переходе мир ⇄ арена: сбрасываем состояние прошлого запуска
    this.units = new Map();
    this.me = null;
    this.targetId = null;
    this.bagViews = new Map();
    this.pendingPickup = null;
    this.pendingNpc = null;
    this.bubbles = [];
    this.keys.clear();
    this.ambient = {};
    this.dustAt = new Map();
    this.npcs = [];
    this.hoverId = null;
    this.zone = -1 as Zone;
    this.lastInput = { mx: 0, my: 0, at: 0 };
    this.events.once("shutdown", () => {
      for (const fn of this.cleanup.splice(0)) fn();
    });

    this.hud = this.registry.get("hud") as Hud;
    this.map = net.kind === "arena" ? generateArenaMap() : generateMap(net.seed);
    this.world = buildWorld(this, this.map);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.w * TILE, this.map.h * TILE);
    const fitZoom = () => cam.setZoom(Math.max(2, Math.min(3, Math.round(Math.min(window.innerWidth / 640, window.innerHeight / 400)))));
    fitZoom();
    this.scale.on("resize", fitZoom);
    this.cleanup.push(() => this.scale.off("resize", fitZoom));

    this.fx = new Effects(this, (id) => this.units.get(id), net.id, (id, text) => this.say(id, text));
    this.cleanup.push(
      net.on("node", (m) => { this.world.setNode(m.id, m.up); if (m.up) this.depletedNodes.delete(m.id); else this.depletedNodes.add(m.id); }),
      net.on("nodes", (m) => { for (const id of m.depleted) { this.depletedNodes.add(id); this.world.setNode(id, false); } }),
    );
    let lastGold = -1;
    this.cleanup.push(net.on("self", (s) => { if (lastGold >= 0 && s.gold > lastGold) { const u = this.units.get(net.id); if (u) this.fx.goldPop(u.x, u.y - 40, s.gold - lastGold); } lastGold = s.gold; }));
    this.cleanup.push(net.on("fx", (list) => this.fx.play(list)), net.on("loot", (bags) => this.syncBags(bags)));

    // NPC — декоративные, проверки дальности делает сервер
    if (net.kind === "world") {
      this.addNpc("shop", "merchant", this.map.merchant, "Торговка Марфа", "#ffd27a");
      this.addNpc("arena", "arenamaster", ARENA_NPC, "Распорядитель арены", "#ff9a7a");
      this.addNpc("cook", COOK.sprite, COOK, COOK.name, COOK.color, COOK.tint, COOK.id);
      this.addNpc("smith", SMITH.sprite, SMITH, SMITH.name, SMITH.color, SMITH.tint, SMITH.id);
      this.addNpc("bank", BANKER.sprite, BANKER, BANKER.name, BANKER.color, BANKER.tint, BANKER.id);
      this.addNpc("bags", BAGMAN.sprite, BAGMAN, BAGMAN.name, BAGMAN.color, BAGMAN.tint, BAGMAN.id);
      for (const r of RUMOR_NPCS) this.addNpc("rumor", r.sprite, r, r.name, r.color, r.tint, r.id);
      for (const c of CITIES) {
        if (c.style) {
          const m = c.merchant!, k = c.cook!, q = c.quest!;
          this.addNpc("shop", m.sprite, m, m.name, m.color, m.tint, m.id);
          this.addNpc("cook", k.sprite, k, k.name, k.color, k.tint, k.id);
          this.addNpc("quest", q.sprite, q, q.name, q.color, q.tint, q.id);
        }
        // камень телепорта нарисован картой; здесь только невидимая точка нажатия
        const st = this.add.sprite(c.stone.x, c.stone.y - 14, "u_merchant", 0).setVisible(false);
        this.npcs.push({ sprite: st, kind: "stone", id: c.id, name: "Камень телепорта" });
      }
      this.scenes = new Scenes(this, this.map);
      this.setupEncounters();
    } else this.scenes = null;

    this.clickMark = this.add.image(0, 0, "fx_target").setDepth(DEPTH.ground + 7).setVisible(false).setScale(0.6);

    net.watchUnits("players", (id, u) => this.addUnit(id, u), (id) => this.removeUnit(id));
    net.watchUnits("mobs", (id, u) => this.addUnit(id, u), (id) => this.removeUnit(id));

    this.hud.bind({
      net,
      map: this.map,
      useSkill: (i) => this.useSkill(i),
      toggleMount: () => this.toggleMount(),
      togglePet: () => this.togglePet(),
      usePotion: (k) => this.usePotion(k),
      closeTarget: () => this.setTarget(null),
      focusGame: () => this.game.canvas.focus(),
    });

    this.setupInput();
    this.setupAmbient();
  }

  private addNpc(kind: NpcKind, sprite: string, at: { x: number; y: number }, name: string, color: string, tint?: number, id?: string) {
    const tex = this.textures.exists(`u_${sprite}`) ? `u_${sprite}` : "u_merchant";
    const s = this.add.sprite(at.x, at.y, tex, 0).setOrigin(0.5, 30 / 32).setDepth(at.y);
    if (tint) s.setTint(tint);
    const shadow = this.add.image(at.x, at.y - 2, "fx_shadow_blob").setDepth(DEPTH.ground + 5);
    const label = { fontFamily: FONT, fontSize: "9px", fontStyle: "600", color, stroke: "#120a10", strokeThickness: 4, resolution: 4 };
    const nameT = this.add.text(at.x, at.y - 31, name, label).setOrigin(0.5, 1).setDepth(DEPTH.top - 5);
    const mark = this.add.text(at.x, at.y - 40, kind === "enc" ? (at as { icon?: string }).icon ?? "!" : kind === "arena" ? "⚔" : kind === "rumor" ? "…" : kind === "cook" ? "♨" : kind === "smith" ? "⚒" : kind === "bank" ? "$" : kind === "bags" ? "▣" : "!", { ...label, fontSize: "10px", color: "#ffd84a" }).setOrigin(0.5, 1).setDepth(DEPTH.top - 5);
    this.time.addEvent({ delay: 2600 + Math.random() * 800, loop: true, callback: () => s.active && s.setFrame(Math.random() < 0.5 ? 0 : 24) });
    this.npcExtras = [shadow, nameT, mark];
    this.npcs.push({ sprite: s, kind, id, name });
  }

  /** Случайные встречи: NPC видит только его владелец, сервер присылает появление, реплики, уход. */
  private setupEncounters() {
    const find = (id: string) => this.npcs.find((n) => n.kind === "enc" && n.id === id);
    const drop = (n: Npc) => {
      this.npcs = this.npcs.filter((x) => x !== n);
      this.tweens.killTweensOf(n.objs ?? []);
      for (const o of n.objs ?? []) o.destroy();
      n.sprite.destroy();
    };
    this.cleanup.push(
      net.on("enc:npc", (m) => {
        const old = find(m.id);
        if (old) drop(old);
        this.addNpc("enc", m.sprite, m, m.name, m.color, m.tint, m.id);
        const n = this.npcs[this.npcs.length - 1];
        n.sprite.setFlipX(false);
        if (m.lying) n.sprite.setAngle(90).y += 8;
        n.objs = this.npcExtras;
      }),
      net.on("enc:say", (m) => {
        const n = find(m.id);
        if (!n) return;
        const t = this.add.text(n.sprite.x, n.sprite.y - 52, m.text, { fontFamily: FONT, fontSize: "10px", color: "#ffe0b0", stroke: "#200a0a", strokeThickness: 4, resolution: 4, align: "center", wordWrap: { width: 160 } }).setOrigin(0.5, 1).setDepth(DEPTH.top);
        this.time.delayedCall(3500, () => t.destroy());
        this.hud.chatLine({ from: n.name ?? "", text: m.text, sys: false });
      }),
      net.on("enc:move", (m) => {
        const n = find(m.id);
        if (!n) return;
        n.sprite.setAngle(0);
        const dx = m.x - n.sprite.x, dy = m.y - n.sprite.y;
        this.tweens.add({ targets: [n.sprite, ...(n.objs ?? [])], x: `+=${dx}`, y: `+=${dy}`, duration: m.ms });
        this.tweens.add({ targets: n.sprite, alpha: 0, delay: m.ms * 0.7, duration: m.ms * 0.3 });
        n.sprite.setDepth(m.y);
      }),
      net.on("enc:gone", (m) => {
        const n = find(m.id);
        if (n) drop(n);
      }),
    );
  }

  /** Атмосферные частицы по зонам, пыль из-под ног, свет героя в темноте. */
  private setupAmbient() {
    const area = () => new Phaser.Geom.Rectangle(0, 0, 700, 420);
    const mk = (key: string, tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const e = this.add.particles(0, 0, tex, { emitZone: { type: "random", source: area() } as any, emitting: false, ...cfg });
      e.setDepth(DEPTH.top - 15);
      this.ambient[key] = e;
    };
    mk("leaves", "fx_leaf", { frequency: 260, lifespan: 6000, speedX: { min: -14, max: 14 }, speedY: { min: 10, max: 22 }, rotate: { start: 0, end: 360 }, alpha: { start: 0.9, end: 0 }, tint: [0x8ac850, 0xd09a34, 0x6aa040] });
    mk("fireflies", "fx_spark", { frequency: 220, lifespan: 4000, speed: { min: 4, max: 14 }, scale: { start: 0.35, end: 0.1 }, alpha: { values: [0, 1, 0.3, 1, 0] } as any, tint: 0xc8ff6a, blendMode: Phaser.BlendModes.ADD });
    mk("embers", "fx_ember", { frequency: 120, lifespan: 3500, speedY: { min: -30, max: -12 }, speedX: { min: -8, max: 8 }, alpha: { start: 1, end: 0 }, scale: { start: 1, end: 0.3 }, blendMode: Phaser.BlendModes.ADD });
    mk("snow", "fx_spark", { frequency: 40, lifespan: 5000, speedX: { min: -20, max: 10 }, speedY: { min: 30, max: 60 }, scale: { min: 0.15, max: 0.35 }, alpha: { start: 0.9, end: 0.2 }, tint: 0xffffff });
    mk("sand", "fx_smoke", { frequency: 90, lifespan: 2600, speedX: { min: 120, max: 220 }, speedY: { min: -10, max: 10 }, scale: { start: 0.35, end: 0.8 }, alpha: { start: 0.18, end: 0 }, tint: 0xe0b878 });
    mk("ash", "fx_smoke", { frequency: 120, lifespan: 5000, speedX: { min: -10, max: 12 }, speedY: { min: 14, max: 30 }, scale: { start: 0.18, end: 0.1 }, alpha: { start: 0.55, end: 0 }, tint: 0x6a6460 });
    mk("fog", "fx_smoke", { frequency: 420, lifespan: 7000, speedX: { min: 6, max: 14 }, scale: { start: 2.2, end: 3.4 }, alpha: { values: [0, 0.14, 0.14, 0] } as any, tint: 0x9ab8a0 });
    mk("bubbles", "fx_bubble", { frequency: 100, lifespan: 4000, speedY: { min: -50, max: -25 }, speedX: { min: -8, max: 8 }, scale: { start: 0.8, end: 1.6 }, alpha: { start: 0.8, end: 0 } });
    mk("pollen", "fx_spark", { frequency: 500, lifespan: 5000, speedX: { min: 4, max: 14 }, speedY: { min: -4, max: 4 }, scale: 0.2, alpha: { start: 0.8, end: 0 }, tint: 0xfff6c0 });
    this.dust = this.add.particles(0, 0, "fx_smoke", { emitting: false, lifespan: 420, speed: { min: 4, max: 12 }, angle: { min: 200, max: 340 }, scale: { start: 0.45, end: 0.1 }, alpha: { start: 0.45, end: 0 }, tint: 0xc8b898 });
    this.dust.setDepth(DEPTH.ground + 4);
    this.selfLight = this.add.image(0, 0, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc88a).setScale(5.5).setAlpha(0).setDepth(DEPTH.top - 10);
  }

  private updateAmbient(z: Zone) {
    const cam = this.cameras.main;
    const v = cam.worldView;
    const want: Record<string, boolean> = {
      leaves: z === Zone.Forest, fireflies: z === Zone.Swamp, fog: z === Zone.Swamp,
      embers: z === Zone.Ashlands || z === Zone.Dungeon || z === Zone.Arena || z === Zone.Volcano, ash: z === Zone.Volcano,
      pollen: z === Zone.Meadow || z === Zone.Town, snow: z === Zone.Snow || z === Zone.SnowCity, sand: z === Zone.Desert || z === Zone.OasisCity, bubbles: z === Zone.Underwater,
    };
    for (const [k, e] of Object.entries(this.ambient)) {
      e.setPosition(v.x - 40, v.y - (k === "leaves" ? 60 : 0));
      (e.emitZones[0] as any)?.source?.setSize?.(v.width + 80, v.height + 40);
      if (want[k] && !e.emitting) e.start();
      else if (!want[k] && e.emitting) e.stop();
    }
    this.selfLight.setPosition(this.pos.x, this.pos.y - 12).setAlpha(this.world.dark.alpha * 0.55);
    // пыль из-под ног идущих
    const now = this.time.now;
    for (const [id, u] of this.units) {
      if (u.dead || u.u.anim !== Anim.Walk || u.frame > 32 && u.u.sprite === "witch") continue;
      if ((this.dustAt.get(id) ?? 0) > now) continue;
      this.dustAt.set(id, now + 260);
      if (z !== Zone.Dungeon) this.dust.emitParticleAt(u.x, u.y);
    }
  }

  // ---------- юниты ----------
  addUnit(id: string, u: UnitState) {
    if (this.units.has(id)) return;
    const v = new UnitView(this, id, u, id === net.id);
    this.units.set(id, v);
    if (id === net.id) {
      this.me = v;
      this.pos = { x: u.x, y: u.y };
      this.cameras.main.startFollow(v.sprite, true, 0.15, 0.15, 0, 12);
    }
  }
  removeUnit(id: string) {
    this.units.get(id)?.destroy();
    this.units.delete(id);
    if (this.targetId === id) this.setTarget(null);
  }

  setTarget(id: string | null) {
    if (this.targetId) {
      const old = this.units.get(this.targetId);
      if (old) old.selected = false;
    }
    this.targetId = id;
    if (id) {
      const v = this.units.get(id);
      if (v) v.selected = true;
    }
    net.send("target", { id });
  }

  // ---------- ввод ----------
  private setupInput() {
    const isTyping = () => this.hud.isTyping();
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      const code = e.code;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) {
        this.keys.add(code);
        this.pendingPickup = null;
        this.pendingNpc = null;
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (code.startsWith("Digit") && "1234".includes(code.slice(5))) this.useSkill(Number(code.slice(5)) - 1);
      else if (code === "KeyQ") this.usePotion("hp_potion");
      else if (code === "KeyE") this.usePotion("mp_potion");
      else if (code === "Tab") { e.preventDefault(); this.cycleTarget(); }
      else if (code === "Space") { e.preventDefault(); this.pickupNearest(); }
      else if (code === "KeyF") this.talkNearest();
      else if (code === "KeyX") { if (e.shiftKey) this.cycleMount(); else this.toggleMount(); }
      else if (code === "KeyG") { if (e.shiftKey) this.cyclePet(); else this.togglePet(); }
      else if (code === "KeyP") this.hud.toggle("arena");
      else if (code === "KeyB") this.hud.toggle("bestiary");
      else if (code === "F10") { e.preventDefault(); this.hud.toggle("admin"); }
      else if (code === "KeyM") this.hud.toggleMinimap();
      else if (code === "Escape") this.hud.escape(!!this.targetId, () => this.setTarget(null));
      else if (code === "KeyI" || code === "KeyC" || code === "KeyK") this.hud.toggle(code === "KeyI" ? "inv" : code === "KeyC" ? "char" : "skills");
      else if (code === "Enter") { e.preventDefault(); this.hud.focusChat(); }
      void k;
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const id = this.pick(p.worldX, p.worldY);
      if (id !== this.hoverId) {
        if (this.hoverId) { const v = this.units.get(this.hoverId); if (v) v.hovered = false; }
        this.hoverId = id;
        if (id) { const v = this.units.get(id); if (v) v.hovered = true; }
        this.game.canvas.style.cursor = id ? "crosshair" : "default";
      }
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.me || this.me.dead) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const wx = p.worldX, wy = p.worldY;
      // мешок с добычей
      for (const [bid, img] of this.bagViews) {
        if (Math.hypot(img.x - wx, img.y - 10 - wy) < 16) {
          this.pendingPickup = bid;
          if (Math.hypot(img.x - this.pos.x, img.y - this.pos.y) > PICKUP_RANGE - 8) net.send("moveTo", { x: img.x, y: img.y });
          return;
        }
      }
      // узлы добычи (кактус, кристалл, обсидиан, жемчуг)
      for (const n of this.map.nodes) {
        if (this.depletedNodes.has(n.id) || Math.hypot(n.x - wx, n.y - 16 - wy) > 24) continue;
        this.pendingGather = n.id;
        if (Math.hypot(n.x - this.pos.x, n.y - 14 - this.pos.y) > ENV.gatherRange - 12) net.send("moveTo", { x: n.x, y: n.y + 26 });
        return;
      }
      // NPC
      for (const n of this.npcs) if (Math.hypot(n.sprite.x - wx, n.sprite.y - 14 - wy) < 18) return this.talk(n);
      // правый клик по другому игроку — меню обмена
      if (p.rightButtonDown() && net.kind === "world") {
        for (const [uid, v] of this.units) {
          if (uid === net.id || v.u.kind !== UnitKind.Player || v.hitTest(wx, wy) > 20) continue;
          const ev = p.event as MouseEvent;
          return this.hud.trade.showMenu(uid, v.u.name, ev.clientX, ev.clientY);
        }
      }
      const id = this.pick(wx, wy) ?? (net.self?.cls === "healer" ? this.pickFriend(wx, wy) : null);
      if (id && p.rightButtonDown()) return this.setTarget(id);
      if (id) return this.setTarget(id);
      this.setTarget(null);
      this.pendingPickup = null;
      this.pendingNpc = null;
      this.pendingGather = null;
      net.send("moveTo", { x: wx, y: wy });
      this.clickMark.setPosition(wx, wy).setVisible(true).setAlpha(1).setScale(0.9);
      this.tweens.add({ targets: this.clickMark, alpha: 0, scale: 0.4, duration: 500 });
    });
  }

  /** Враг ли юнит: мобы всегда, игроки — только на арене из другой команды. */
  isEnemy(v: UnitView): boolean {
    if (v.u.kind === UnitKind.Pet || v.npc) return false;
    if (v.u.kind !== UnitKind.Player) return true;
    return net.kind === "arena" && v.u.team !== 0 && v.u.team !== net.arena?.team && !(v.u.buffs & BUFF_STEALTH);
  }

  /** Ближайший к курсору живой враг. */
  pick(wx: number, wy: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const [id, v] of this.units) {
      if (!this.isEnemy(v)) continue;
      const d = v.hitTest(wx, wy);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  /** Союзник под курсором (для лекаря): игроки, включая себя и павших, и питомцы. */
  pickFriend(wx: number, wy: number): string | null {
    let best: string | null = null, bd = 22;
    for (const [id, v] of this.units) {
      if (this.isEnemy(v) || (v.u.kind !== UnitKind.Player && v.u.kind !== UnitKind.Pet)) continue;
      const d = v.hitTest(wx, wy);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  cycleTarget() {
    const list = [...this.units.entries()]
      .filter(([, v]) => this.isEnemy(v) && !v.dead && Math.hypot(v.x - this.pos.x, v.y - this.pos.y) < (net.kind === "arena" ? 1400 : 420))
      .sort((a, b) => Math.hypot(a[1].x - this.pos.x, a[1].y - this.pos.y) - Math.hypot(b[1].x - this.pos.x, b[1].y - this.pos.y));
    if (!list.length) return;
    const i = list.findIndex(([id]) => id === this.targetId);
    this.setTarget(list[(i + 1) % list.length][0]);
  }

  toggleMount() {
    if (!this.me || this.me.dead) return;
    net.send("mount:toggle");
  }

  togglePet() {
    if (!this.me || this.me.dead) return;
    net.send("pet:toggle");
  }

  /** Shift+G: выбрать следующего из своих питомцев. */
  cyclePet() {
    const own = Object.keys(net.self?.pets ?? {});
    if (own.length < 2) return;
    const next = own[(own.indexOf(net.self?.pet ?? "") + 1) % own.length];
    net.send("pet:select", { id: next });
    this.hud.toast({ text: `Питомец: ${PETS[next]?.name ?? next}`, kind: "info" });
  }

  /** Shift+X: выбрать следующий из своих маунтов. */
  cycleMount() {
    const own = net.self?.mounts ?? [];
    if (own.length < 2) return;
    const next = own[(own.indexOf(net.self?.mount ?? "") + 1) % own.length];
    net.send("mount:select", { id: next });
    this.hud.toast({ text: `Маунт: ${MOUNTS[next]?.name ?? next}`, kind: "info" });
  }

  useSkill(i: number) {
    const self = net.self;
    if (!self || !this.me || this.me.dead) return;
    const def = activeSkills(self.cls)[i];
    if (!def) return;
    if (!self.skills[def.id]) return this.hud.toast({ text: `«${def.name}» ещё не изучено (K — умения)`, kind: "error" });
    const p = this.input.activePointer;
    let x = p.worldX, y = p.worldY;
    const t = this.targetId ? this.units.get(this.targetId) : undefined;
    if (def.target === "enemy" && !t) return this.hud.toast({ text: "Нужна цель: кликните по врагу", kind: "error" });
    if (t && def.target !== "self" && (def.target === "enemy" || !this.hud.aimAtCursor)) { x = t.x; y = t.y; }
    if (def.id === "blink" || def.id === "roll") { x = p.worldX; y = p.worldY; }
    // умения-лечилки: врага в цель не берём (сервер лечит самого лекаря)
    const target = def.target === "ally" && t && this.isEnemy(t) ? null : this.targetId;
    net.send("skill", { id: def.id, x, y, target });
  }

  usePotion(base: string) {
    const inv = net.self?.inventory;
    if (!inv) return;
    const idx = inv.findIndex((it) => it && it.base === base);
    if (idx < 0) return this.hud.toast({ text: base === "hp_potion" ? "Нет зелий здоровья" : "Нет зелий маны", kind: "error" });
    net.send("use", { index: idx });
  }

  pickupNearest() {
    let best: string | null = null, bd = PICKUP_RANGE + 40;
    for (const [id, img] of this.bagViews) {
      const d = Math.hypot(img.x - this.pos.x, img.y - this.pos.y);
      if (d < bd) { bd = d; best = id; }
    }
    if (best) {
      this.pendingPickup = best;
      const img = this.bagViews.get(best)!;
      if (bd > PICKUP_RANGE - 8) net.send("moveTo", { x: img.x, y: img.y });
    } else this.talkNearest();
  }

  talkNearest() {
    const n = this.npcs.find((x) => Math.hypot(x.sprite.x - this.pos.x, x.sprite.y - this.pos.y) < MERCHANT_RANGE);
    if (n) this.talk(n);
  }

  /** Подойти к NPC и открыть его окно. */
  talk(n: Npc) {
    const d = Math.hypot(n.sprite.x - this.pos.x, n.sprite.y - this.pos.y);
    if (d < MERCHANT_RANGE - 10) {
      this.pendingNpc = null;
      this.openNpc(n);
    } else {
      this.pendingNpc = n;
      net.send("moveTo", { x: n.sprite.x, y: n.sprite.y + 26 });
    }
  }
  private openNpc(n: Npc) {
    if (n.kind === "shop") this.hud.openShop();
    else if (n.kind === "cook") this.hud.cook.open(n.id);
    else if (n.kind === "smith") this.hud.smith.open();
    else if (n.kind === "bank") this.hud.bank.open();
    else if (n.kind === "bags") this.hud.bags.open();
    else if (n.kind === "quest") this.hud.quest.open(n.id!);
    else if (n.kind === "stone") this.hud.tp.open(this.pos);
    else if (n.kind === "rumor") this.hud.rumor.open(n.id!, n.name!);
    else if (n.kind === "enc") this.hud.enc.open(n.id!);
    else this.hud.arena.open();
  }

  syncBags(bags: LootBag[]) {
    const ids = new Set(bags.map((b) => b.id));
    for (const [id, img] of this.bagViews) if (!ids.has(id)) { img.destroy(); this.bagViews.delete(id); }
    for (const b of bags) {
      if (this.bagViews.has(b.id)) continue;
      const img = this.add.image(b.x, b.y, b.boss ? "o_bag_boss" : "o_bag").setOrigin(0.5, 1).setDepth(b.y - 1);
      img.y -= 30;
      this.tweens.add({ targets: img, y: b.y, duration: 380, ease: "Bounce.easeOut" });
      const best = Math.max(...b.items.map((it) => it.rarity));
      if (best > 0 || b.boss) {
        const glow = this.add.image(b.x, b.y - 8, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setTint(best >= 3 ? 0xff9a2e : best >= 2 || b.boss ? 0xc47bff : 0x5fa8ff).setScale(0.9).setDepth(b.y - 2);
        this.tweens.add({ targets: glow, alpha: { from: 0.7, to: 0.25 }, duration: 700, yoyo: true, repeat: -1 });
        img.once("destroy", () => glow.destroy());
      }
      this.bagViews.set(b.id, img);
    }
  }

  say(id: string, text: string) {
    const v = this.units.get(id);
    if (!v) return;
    const t = this.add.text(v.x, v.y - 70, text, { fontFamily: FONT, fontSize: "10px", color: "#ffe0b0", stroke: "#200a0a", strokeThickness: 4, resolution: 4, align: "center", wordWrap: { width: 160 } }).setOrigin(0.5, 1).setDepth(DEPTH.top);
    this.bubbles.push({ t, id, until: this.time.now + 3500 });
    this.hud.chatLine({ from: v.u.name, text, sys: false });
  }

  // ---------- кадр ----------
  override update(_time: number, deltaMs: number) {
    const dt = Math.min(0.05, deltaMs / 1000);
    this.world.update(this.cameras.main);
    this.world.drift.x += dt * 6;
    this.world.drift.y += dt * 3;

    // движение своего героя: предсказание + мягкая сверка с сервером
    const me = this.me;
    let mx = 0, my = 0;
    if (me && !me.dead && !this.hud.isTyping()) {
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx += 1;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) my -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) my += 1;
    }
    const now = this.time.now;
    if (mx !== this.lastInput.mx || my !== this.lastInput.my || ((mx || my) && now - this.lastInput.at > 250)) {
      net.send("input", { mx, my });
      this.lastInput = { mx, my, at: now };
    }
    if (me) {
      const u = me.u;
      const blocked = u.buffs & (BUFF_STUN | BUFF_ROOT) || u.anim === Anim.Dead;
      if ((mx || my) && !blocked) {
        const len = Math.hypot(mx, my);
        const sp = PLAYER_SPEED * (MOUNTS[u.mount]?.speed ?? 1) * (u.buffs & BUFF_SLOW ? 0.55 : 1) * terrainSpeedMul(this.map, this.pos.x, this.pos.y) * dt;
        const n = moveWithCollision(this.map, this.pos.x, this.pos.y, (mx / len) * sp, (my / len) * sp, PLAYER_RADIUS);
        this.pos.x = n.x;
        this.pos.y = n.y;
        const err = Math.hypot(u.x - this.pos.x, u.y - this.pos.y);
        const k = err > 64 ? 1 : err > 24 ? 0.15 : 0.03;
        this.pos.x += (u.x - this.pos.x) * k;
        this.pos.y += (u.y - this.pos.y) * k;
      } else {
        const err = Math.hypot(u.x - this.pos.x, u.y - this.pos.y);
        const k = err > 96 ? 1 : Math.min(1, dt * 14);
        this.pos.x += (u.x - this.pos.x) * k;
        this.pos.y += (u.y - this.pos.y) * k;
      }
      me.update(dt, this.pos.x, this.pos.y);
    }
    for (const [id, v] of this.units) if (id !== net.id) v.update(dt);
    this.scenes?.update(this.pos.x, this.pos.y);
    if (this.targetId && !this.units.get(this.targetId)) this.targetId = null;

    // отложенные действия по прибытии
    if (this.pendingPickup) {
      const img = this.bagViews.get(this.pendingPickup);
      if (!img) this.pendingPickup = null;
      else if (Math.hypot(img.x - this.pos.x, img.y - this.pos.y) < PICKUP_RANGE - 4) {
        net.send("pickup", { bag: this.pendingPickup });
        this.pendingPickup = null;
      }
    }
    if (this.pendingGather !== null) {
      const n = this.map.nodes.find((q) => q.id === this.pendingGather);
      if (!n || this.depletedNodes.has(n.id)) this.pendingGather = null;
      else if (Math.hypot(n.x - this.pos.x, n.y - 14 - this.pos.y) < ENV.gatherRange - 12) {
        this.pendingGather = null;
        net.send("gather", { id: n.id });
      }
    }
    if (this.pendingNpc) {
      const n = this.pendingNpc;
      if (Math.hypot(n.sprite.x - this.pos.x, n.sprite.y - this.pos.y) < MERCHANT_RANGE - 10) {
        this.pendingNpc = null;
        this.openNpc(n);
      }
    }

    // реплики
    this.bubbles = this.bubbles.filter((b) => {
      const v = this.units.get(b.id);
      if (!v || now > b.until) { b.t.destroy(); return false; }
      b.t.setPosition(v.x, v.y - (v.frame > 32 ? 76 : 44));
      return true;
    });

    // зона: название, затемнение
    const z = zoneAtPx(this.map, this.pos.x, this.pos.y);
    if (z !== this.zone) {
      this.zone = z;
      if (z === Zone.Arena) this.hud.showZone(`Арена · ${MODE_NAMES[net.arena?.mode ?? "1v1"]}`, "Победит тот, кто устоит");
      else this.hud.showZone(ZONES[z].name, ZONES[z].note ?? (ZONES[z].safe ? "Безопасная зона" : `Уровни ${ZONES[z].levels[0]}–${ZONES[z].levels[1]}`), ZONE_COLOR[z]);
    }
    const cam = this.cameras.main;
    const tint = zoneTint(z);
    const target = tint.dark;
    const dark = this.world.dark;
    dark.setFillStyle(tint.color, 1);
    const cs = this.world.caustics;
    cs.setSize(cam.width, cam.height).setAlpha(cs.alpha + ((z === Zone.Underwater ? 0.3 : 0) - cs.alpha) * Math.min(1, dt * 2));
    cs.setTilePosition(now * 0.02, now * 0.012);
    sfx.setAmbience(AMBIENCE[z] ?? null);
    dark.setSize(cam.width / cam.zoom + 4, cam.height / cam.zoom + 4).setPosition(-2, -2);
    dark.setAlpha(dark.alpha + (target - dark.alpha) * Math.min(1, dt * 2));
    dark.setDisplayOrigin(0, 0);
    dark.setScrollFactor(0);
    dark.x = (cam.width - cam.width / cam.zoom) / 2 - 2;
    dark.y = (cam.height - cam.height / cam.zoom) / 2 - 2;

    this.updateAmbient(z);
    this.hud.frame({
      me: me?.u ?? null,
      target: this.targetId ? (this.units.get(this.targetId)?.u ?? null) : null,
      pos: this.pos,
      units: this.units,
    });
  }
}

export { SKILLS };
