/** Эффект телепорта: руны под ногами, спираль света, нить от кристалла, столб света, вспышка и материализация. */
import Phaser from "phaser";
import type { Fx } from "../../../shared/protocol";
import { DEPTH } from "./terrain";
import type { UnitView } from "./UnitView";
import * as sfx from "./sfx";

type TpFx = Extract<Fx, { t: "tp" }>;
const ADD = Phaser.BlendModes.ADD;
const COL = 0x8fd0ff, COL2 = 0xc4a4ff;

interface Cast {
  id: string; x: number; y: number; sx: number; sy: number; t0: number; ms: number; acc: number;
  rune: Phaser.GameObjects.Container; disk: Phaser.GameObjects.Image; pillar: Phaser.GameObjects.Image;
  stone: Phaser.GameObjects.Image; beam: Phaser.GameObjects.Graphics; bead: Phaser.GameObjects.Image;
}

/** Текстуры рисуются один раз: руническое кольцо и вертикальный столб света. */
function makeTextures(scene: Phaser.Scene) {
  const tx = scene.textures;
  if (!tx.exists("fx_rune")) {
    const t = tx.createCanvas("fx_rune", 256, 256)!, c = t.getContext();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.translate(128, 128);
    c.strokeStyle = "#fff"; c.fillStyle = "#fff"; c.lineCap = "round"; c.shadowColor = "#9fd8ff"; c.shadowBlur = 7;
    const ring = (r: number, w: number) => { c.lineWidth = w; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); };
    ring(122, 3); ring(113, 1.2); ring(86, 2.5); ring(78, 1); ring(28, 2);
    // 24 рун в поясе между кольцами
    for (let i = 0; i < 24; i++) {
      c.save(); c.rotate((i / 24) * Math.PI * 2); c.translate(0, -100); c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(0, -9); c.lineTo(0, 9); c.stroke();
      const k = Math.floor(rnd() * 4);
      c.beginPath();
      if (k === 0) { c.moveTo(-6, -4); c.lineTo(0, 2); c.lineTo(6, -6); }
      else if (k === 1) { c.moveTo(-6, 6); c.lineTo(6, -2); c.moveTo(-5, -6); c.lineTo(0, -2); }
      else if (k === 2) { c.moveTo(-6, 0); c.lineTo(6, 0); c.moveTo(0, 9); c.lineTo(-5, 4); }
      else { c.moveTo(0, -9); c.lineTo(6, -3); c.lineTo(0, 3); c.lineTo(-6, 7); }
      c.stroke();
      if (k === 2) { c.beginPath(); c.arc(0, -3, 2, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    // две звезды-треугольника
    c.lineWidth = 2.4;
    for (const rot of [0, Math.PI]) {
      c.beginPath();
      for (let i = 0; i < 3; i++) { const a = rot + (i / 3) * Math.PI * 2 - Math.PI / 2; c[i ? "lineTo" : "moveTo"](Math.cos(a) * 78, Math.sin(a) * 78); }
      c.closePath(); c.stroke();
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; c.beginPath(); c.arc(Math.cos(a) * 78, Math.sin(a) * 78, 4, 0, Math.PI * 2); c.fill(); }
    c.lineWidth = 1; c.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; c.moveTo(Math.cos(a) * 28, Math.sin(a) * 28); c.lineTo(Math.cos(a) * 78, Math.sin(a) * 78); } c.stroke();
    t.refresh();
  }
  if (!tx.exists("fx_pillar")) {
    const t = tx.createCanvas("fx_pillar", 64, 256)!, c = t.getContext();
    const h = c.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, "rgba(255,255,255,0)"); h.addColorStop(0.3, "rgba(200,230,255,0.55)"); h.addColorStop(0.5, "rgba(255,255,255,1)"); h.addColorStop(0.7, "rgba(200,230,255,0.55)"); h.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = h; c.fillRect(0, 0, 64, 256);
    c.globalCompositeOperation = "destination-in";
    const v = c.createLinearGradient(0, 0, 0, 256);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.45, "rgba(0,0,0,0.55)"); v.addColorStop(1, "rgba(0,0,0,1)");
    c.fillStyle = v; c.fillRect(0, 0, 64, 256);
    t.refresh();
  }
}

export class TeleportFx {
  private casts = new Map<string, Cast>();
  private up: Phaser.GameObjects.Particles.ParticleEmitter;
  private pop: Phaser.GameObjects.Particles.ParticleEmitter;
  private off: () => void;

  constructor(
    private scene: Phaser.Scene,
    private unit: (id: string) => UnitView | undefined,
    private selfId: string,
    private near: (x: number, y: number) => number,
  ) {
    makeTextures(scene);
    const d = DEPTH.top - 30;
    this.up = scene.add.particles(0, 0, "fx_spark", { emitting: false, lifespan: { min: 650, max: 1050 }, scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffffff, COL, COL2, 0xffffff], blendMode: ADD }).setDepth(d);
    this.pop = scene.add.particles(0, 0, "fx_spark", { emitting: false, lifespan: { min: 450, max: 900 }, speed: { min: 40, max: 170 }, angle: { min: 0, max: 360 }, scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffffff, COL, COL2], blendMode: ADD, gravityY: -30 }).setDepth(d);
    scene.events.on("update", this.tick, this);
    this.off = () => scene.events.off("update", this.tick, this);
    scene.events.once("shutdown", () => { this.off(); for (const c of this.casts.values()) this.kill(c); });
  }

  handle(f: TpFx) {
    if (f.ph === "cast") return this.start(f);
    const c = this.casts.get(f.id);
    if (f.ph === "cancel") return this.cancel(f, c);
    if (f.ph === "go") return this.go(f, c);
    this.arrive(f);
  }

  private start(f: TpFx) {
    const old = this.casts.get(f.id);
    if (old) this.kill(old);
    const s = this.scene, ms = f.ms ?? 3000;
    const sx = f.sx ?? f.x, sy = (f.sy ?? f.y) - 34;
    const runeA = s.add.image(0, 0, "fx_rune").setBlendMode(ADD).setTint(COL);
    const runeB = s.add.image(0, 0, "fx_rune").setBlendMode(ADD).setTint(COL2).setScale(0.58);
    const rune = s.add.container(f.x, f.y - 1, [runeA, runeB]).setDepth(DEPTH.ground + 15).setScale(0.1, 0.05);
    const disk = s.add.image(f.x, f.y - 2, "fx_glow").setBlendMode(ADD).setTint(COL).setDepth(DEPTH.ground + 14).setAlpha(0);
    const pillar = s.add.image(f.x, f.y, "fx_pillar").setOrigin(0.5, 1).setBlendMode(ADD).setTint(COL).setDepth(DEPTH.top - 33).setAlpha(0);
    const stone = s.add.image(sx, sy, "fx_glow").setBlendMode(ADD).setTint(0xb8e0ff).setDepth(DEPTH.top - 32).setAlpha(0);
    const beam = s.add.graphics().setBlendMode(ADD).setDepth(DEPTH.top - 31);
    const bead = s.add.image(sx, sy, "fx_glow").setBlendMode(ADD).setTint(0xffffff).setScale(0.35).setDepth(DEPTH.top - 31).setAlpha(0);
    this.casts.set(f.id, { id: f.id, x: f.x, y: f.y, sx, sy, t0: s.time.now, ms, acc: 0, rune, disk, pillar, stone, beam, bead });
    this.sound(f.id, f.x, f.y, true, ms);
    this.pop.explode(8, sx, sy);
  }

  private sound(id: string, x: number, y: number, hum: boolean, ms = 3000, name?: sfx.SfxName) {
    const g = this.near(x, y);
    if (hum) sfx.startHum(id, ms / 1000, g);
    else if (name) sfx.play(name, g);
  }

  private tick = (_t: number, dt: number) => {
    const now = this.scene.time.now;
    for (const c of this.casts.values()) {
      const u = this.unit(c.id);
      if (u) { c.x = u.x; c.y = u.y; }
      const k = Math.min(1, (now - c.t0) / c.ms);
      const grow = 1 - Math.pow(1 - Math.min(1, k * 1.7), 3);
      const sc = 0.12 + 0.36 * grow;
      c.rune.setPosition(c.x, c.y - 1).setScale(sc, sc * 0.5).setAlpha(0.55 + 0.45 * Math.min(1, k * 3));
      (c.rune.list[0] as Phaser.GameObjects.Image).setRotation(now * 0.0007 * (1 + k * 2.5));
      (c.rune.list[1] as Phaser.GameObjects.Image).setRotation(-now * 0.0011 * (1 + k * 2.5));
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.012 * (1 + k * 1.5));
      c.disk.setPosition(c.x, c.y - 2).setScale(1.6 * grow + 0.2, 0.85 * grow + 0.1).setAlpha((0.22 + 0.4 * k) * (0.8 + 0.2 * pulse));
      c.pillar.setPosition(c.x, c.y).setDisplaySize(36 + 34 * k, 50 + 170 * k * k + 40 * k).setAlpha((0.12 + 0.85 * k * k) * (0.85 + 0.15 * pulse));
      c.stone.setScale(1.4 + 1.4 * k + 0.35 * pulse).setAlpha(0.3 + 0.55 * k + 0.15 * pulse);
      // нить кристалл → герой
      const tx = c.x, ty = c.y - 22, g = c.beam;
      g.clear();
      const a = 0.35 + 0.65 * k, amp = 3 + 6 * k, N = 14;
      for (const [w, col, al] of [[7, COL, 0.16], [3.2, COL, 0.4], [1.2, 0xffffff, 0.95]] as const) {
        g.lineStyle(w, col, al * a);
        g.beginPath();
        for (let i = 0; i <= N; i++) {
          const t = i / N, e = Math.sin(t * Math.PI);
          const x = c.sx + (tx - c.sx) * t + Math.sin(now * 0.02 + i * 1.3) * amp * e + (Math.random() - 0.5) * 1.5 * e;
          const y = c.sy + (ty - c.sy) * t + Math.cos(now * 0.017 + i * 1.7) * amp * e;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.strokePath();
      }
      const bt = (now * 0.0014 * (1 + k)) % 1;
      c.bead.setPosition(c.sx + (tx - c.sx) * bt, c.sy + (ty - c.sy) * bt).setAlpha(a).setScale(0.3 + 0.2 * pulse);
      // частицы: спираль вверх и частицы, стягивающиеся к герою
      c.acc += (38 + 120 * k) * (dt / 1000);
      const R = 54 * grow + 8;
      while (c.acc >= 1) {
        c.acc -= 1;
        const ang = now * (0.004 + k * 0.006) + Math.random() * 6.283;
        const px = c.x + Math.cos(ang) * R, py = c.y + Math.sin(ang) * R * 0.5;
        const p = this.up.emitParticleAt(px, py, 1) as unknown as Phaser.GameObjects.Particles.Particle | undefined;
        if (p) { p.velocityX = (c.x - px) * 0.9 + Math.cos(ang + 1.57) * 26; p.velocityY = -55 - Math.random() * 60 - 40 * k; }
        if (Math.random() < 0.18) {
          const bt2 = Math.random();
          this.pop.emitParticleAt(c.sx + (tx - c.sx) * bt2, c.sy + (ty - c.sy) * bt2, 1);
        }
      }
      if (Math.random() < 0.25 + k * 0.4) this.pop.emitParticleAt(c.sx + (Math.random() - 0.5) * 8, c.sy + (Math.random() - 0.5) * 8, 1);
    }
  };

  /** Убрать объекты каста; stone-свечение гаснет плавно. */
  private kill(c: Cast, fadeRune = false) {
    this.casts.delete(c.id);
    const s = this.scene;
    c.beam.destroy(); c.bead.destroy();
    s.tweens.add({ targets: [c.stone, c.pillar, c.disk], alpha: 0, duration: 400, onComplete: () => { c.stone.destroy(); c.pillar.destroy(); c.disk.destroy(); } });
    if (fadeRune) return;
    s.tweens.add({ targets: c.rune, alpha: 0, duration: 300, onComplete: () => c.rune.destroy() });
  }

  private cancel(f: TpFx, c?: Cast) {
    sfx.stopHum(f.id);
    if (!c) return;
    const s = this.scene;
    this.sound(f.id, c.x, c.y, false, 0, "tpfizzle");
    // кольцо схлопывается внутрь, искры разлетаются вниз
    s.tweens.add({ targets: c.rune, scaleX: 0.02, scaleY: 0.01, alpha: 0, duration: 320, ease: "Cubic.easeIn", onComplete: () => c.rune.destroy() });
    this.pop.explode(14, c.x, c.y - 6);
    this.kill(c, true);
  }

  private column(x: number, y: number, w: number, h: number, ms: number, tint = 0xffffff) {
    const s = this.scene;
    const col = s.add.image(x, y, "fx_pillar").setOrigin(0.5, 1).setBlendMode(ADD).setTint(tint).setDepth(DEPTH.top - 33).setDisplaySize(w, h);
    s.tweens.add({ targets: col, displayWidth: w * 0.25, alpha: 0, duration: ms, ease: "Cubic.easeIn", onComplete: () => col.destroy() });
    const core = s.add.image(x, y, "fx_pillar").setOrigin(0.5, 1).setBlendMode(ADD).setDepth(DEPTH.top - 32).setDisplaySize(w * 0.4, h * 1.1);
    s.tweens.add({ targets: core, displayWidth: 2, alpha: 0, duration: ms * 0.7, ease: "Quad.easeIn", onComplete: () => core.destroy() });
  }

  private ring(x: number, y: number, to: number, ms: number, tint: number, delay = 0) {
    const s = this.scene;
    const r = s.add.image(x, y, "fx_ring").setTint(tint).setBlendMode(ADD).setDepth(DEPTH.ground + 20).setScale(0.2, 0.1).setAlpha(0);
    s.tweens.add({ targets: r, scaleX: to, scaleY: to * 0.5, alpha: { from: 1, to: 0 }, duration: ms, delay, ease: "Cubic.easeOut", onStart: () => r.setAlpha(1), onComplete: () => r.destroy() });
  }

  private flash(x: number, y: number, size: number, ms: number) {
    const s = this.scene;
    const g = s.add.image(x, y, "fx_glow").setBlendMode(ADD).setDepth(DEPTH.top - 31).setScale(size * 0.4).setAlpha(1);
    s.tweens.add({ targets: g, scale: size * 1.6, alpha: 0, duration: ms, ease: "Cubic.easeOut", onComplete: () => g.destroy() });
  }

  private go(f: TpFx, c?: Cast) {
    const s = this.scene, u = this.unit(f.id);
    const x = c?.x ?? f.x, y = c?.y ?? f.y;
    sfx.stopHum(f.id);
    this.sound(f.id, x, y, false, 0, "tpgo");
    this.column(x, y, 74, 260, 700);
    this.flash(x, y - 20, 3, 420);
    this.ring(x, y, 3.4, 550, COL);
    this.ring(x, y, 2.2, 420, 0xffffff, 80);
    this.pop.explode(34, x, y - 14);
    for (let i = 0; i < 22; i++) { const p = this.up.emitParticleAt(x + (Math.random() - 0.5) * 24, y - Math.random() * 10, 1) as unknown as Phaser.GameObjects.Particles.Particle | undefined; if (p) { p.velocityX = (Math.random() - 0.5) * 30; p.velocityY = -140 - Math.random() * 160; } }
    if (c) {
      s.tweens.add({ targets: c.rune, scaleX: c.rune.scaleX * 1.5, scaleY: c.rune.scaleY * 1.5, alpha: 0, duration: 600, ease: "Cubic.easeOut", onComplete: () => c.rune.destroy() });
      this.kill(c, true);
    }
    if (u) {
      // силуэт героя вытягивается вверх и тает; настоящий спрайт скрыт до прибытия
      const sp = u.sprite;
      const ghost = s.add.sprite(sp.x, sp.y, sp.texture.key, sp.frame.name).setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX).setScale(sp.scaleX, sp.scaleY).setDepth(DEPTH.top - 34).setTintFill(0xffffff).setBlendMode(ADD);
      s.tweens.add({ targets: ghost, scaleY: sp.scaleY * 3.2, scaleX: sp.scaleX * 0.25, y: sp.y - 36, alpha: 0, duration: 480, ease: "Cubic.easeIn", onComplete: () => ghost.destroy() });
      sp.setAlpha(0); u.shadow.setAlpha(0);
    }
    if (f.id === this.selfId) {
      const cam = s.cameras.main;
      cam.flash(320, 215, 235, 255);
      cam.shake(280, 0.004);
    }
  }

  private arrive(f: TpFx) {
    const s = this.scene;
    this.sound(f.id, f.x, f.y, false, 0, "tparrive");
    this.column(f.x, f.y, 70, 230, 800, COL);
    this.flash(f.x, f.y - 14, 2.4, 500);
    this.ring(f.x, f.y, 4, 700, COL);
    this.ring(f.x, f.y, 2.6, 520, 0xffffff, 120);
    this.ring(f.x, f.y, 5.2, 900, COL2, 220);
    this.pop.explode(28, f.x, f.y - 8);
    for (let i = 0; i < 24; i++) { const a = Math.random() * 6.283, r = 10 + Math.random() * 40; const p = this.up.emitParticleAt(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r * 0.5, 1) as unknown as Phaser.GameObjects.Particles.Particle | undefined; if (p) { p.velocityX = 0; p.velocityY = -50 - Math.random() * 80; } }
    const u = this.unit(f.id);
    if (u) {
      const sp = u.sprite, bx = sp.scaleX, by = sp.scaleY;
      sp.setAlpha(0).setScale(bx * 0.3, by * 2.8);
      s.tweens.add({ targets: sp, alpha: 1, scaleX: bx, scaleY: by, duration: 520, delay: 160, ease: "Back.easeOut" });
      s.tweens.add({ targets: u.shadow, alpha: 1, duration: 400, delay: 200 });
      // белая «заливка» поверх проявляющегося силуэта
      const ghost = s.add.sprite(f.x, f.y, sp.texture.key, sp.frame.name).setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX).setTintFill(0xffffff).setBlendMode(ADD).setDepth(DEPTH.top - 34).setAlpha(0).setScale(bx * 0.3, by * 2.8);
      s.tweens.add({ targets: ghost, alpha: { from: 0.95, to: 0 }, scaleX: bx, scaleY: by, duration: 560, delay: 160, ease: "Cubic.easeOut", onComplete: () => ghost.destroy() });
    }
  }
}
