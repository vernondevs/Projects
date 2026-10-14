/** Визуальные эффекты: цифры урона, снаряды, взрывы, телеграфы атак боссов, лужи, частицы. */
import Phaser from "phaser";
import type { Fx } from "../../../shared/protocol";
import { DEPTH } from "./terrain";
import { FONT, type UnitView } from "./UnitView";
import * as sfx from "./sfx";

const MAX_BURST = 36;
const MAX_POOL = 90;
const SFX_OF: Record<string, sfx.SfxName> = { fire: "fire", frost: "frost", poison: "poison", arcane: "arcane", shadow: "shadow", holy: "holy", nature: "poison", phys: "hit" };

const KIND_COLOR: Record<string, number> = {
  phys: 0xffffff, fire: 0xff8a3a, frost: 0x8ad0ff, poison: 0x9aff5a, arcane: 0xc08aff, shadow: 0xa070ff, nature: 0x8adf5a, holy: 0xfff0a0, heal: 0x9affb8,
};
const PROJ_TEX: Record<string, string> = { arrow: "fx_arrow", arcane: "fx_arcane", fireball: "fx_fireball", fire: "fx_fire", poison: "fx_poison", shadow: "fx_shadow", frost: "fx_frost", aimed: "fx_arrow", holy: "fx_holy" };

export class Effects {
  private hazards = new Map<string, Phaser.GameObjects.GameObject[]>();

  constructor(
    readonly scene: Phaser.Scene,
    readonly unit: (id: string) => UnitView | undefined,
    readonly selfId: string,
    readonly onSay: (id: string, text: string) => void,
  ) {}

  play(list: Fx[]) {
    for (const f of list) {
      try {
        this.one(f);
      } catch (e) {
        console.warn("fx", f, e);
      }
    }
  }

  private pool = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

  /** Сила эффекта по расстоянию до своего героя (1 вблизи, 0 далеко). */
  private near(x: number, y: number, range = 420) {
    const me = this.unit(this.selfId);
    if (!me) return 1;
    return Math.max(0, 1 - Math.hypot(me.x - x, me.y - y) / range);
  }
  private shake(x: number, y: number, ms: number, power: number) {
    const k = this.near(x, y, 320);
    if (k > 0.2) this.scene.cameras.main.shake(ms, power * k);
  }
  private sound(name: sfx.SfxName, x: number, y: number) {
    sfx.play(name, this.near(x, y, 600));
  }

  /** Всплеск частиц; эмиттеры переиспользуются по набору параметров, число частиц ограничено. */
  private burst(x: number, y: number, tex: string, color: number, count: number, speed = 60, life = 500, gravity = 0, scale = 1) {
    if (!this.scene.textures.exists(tex)) return;
    const key = [tex, color, Math.round(speed), life, gravity, scale].join("|");
    let p = this.pool.get(key);
    if (!p) {
      if (this.pool.size >= MAX_POOL) return;
      p = this.scene.add.particles(0, 0, tex, {
        speed: { min: speed * 0.3, max: speed },
        angle: { min: 0, max: 360 },
        lifespan: { min: life * 0.6, max: life },
        scale: { start: scale, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: color,
        gravityY: gravity,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      p.setDepth(DEPTH.top - 30);
      this.pool.set(key, p);
    }
    p.explode(Math.min(MAX_BURST, count), x, y);
  }

  /** Короткая вспышка удара на месте попадания. */
  private flash(x: number, y: number, color: number, size = 1) {
    const g = this.scene.add.image(x, y, "fx_glow").setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.top - 32).setScale(0.3 * size).setAlpha(0.95);
    this.scene.tweens.add({ targets: g, scale: 1.1 * size, alpha: 0, duration: 160, onComplete: () => g.destroy() });
  }

  number(x: number, y: number, text: string, color: string, big = false) {
    const t = this.scene.add
      .text(x + (Math.random() - 0.5) * 10, y, text, { fontFamily: FONT, fontSize: big ? "14px" : "11px", color, stroke: "#14080c", strokeThickness: 4, resolution: 4, fontStyle: big ? "bold" : "600" })
      .setOrigin(0.5)
      .setDepth(DEPTH.top);
    if (big) t.setScale(1.6);
    this.scene.tweens.add({ targets: t, scale: big ? 1 : 1, duration: 140 });
    this.scene.tweens.add({ targets: t, y: y - 26, alpha: { from: 1, to: 0 }, duration: 900, ease: "Cubic.easeOut", delay: 120, onComplete: () => t.destroy() });
  }

  private one(f: Fx) {
    const s = this.scene;
    switch (f.t) {
      case "dmg": {
        const u = this.unit(f.id);
        if (!u) return;
        const y = u.y - (u.frame > 32 ? 56 : 28);
        if (f.miss) return this.number(u.x, y, "Уклонение", "#c8c0b0");
        if (f.heal) { this.sound("heal", u.x, u.y); this.burst(u.x, u.y - 8, "fx_spark", 0x9affb8, 5, 25, 600, -50, 0.7); return this.number(u.x, y, `+${f.v}`, "#7aff7a"); }
        if (f.abs) this.sound("shield", u.x, u.y);
        if (f.abs) return this.number(u.x, y, `Щит ${f.v}`, "#ffd84a");
        u.flash();
        const mine = f.id === this.selfId;
        this.flash(u.x, u.y - 14, f.crit ? 0xffe070 : (KIND_COLOR[f.k ?? "phys"] ?? 0xffffff), f.crit ? 1.2 : 0.7);
        this.sound(f.crit ? "crit" : (SFX_OF[f.k ?? "phys"] ?? "hit"), u.x, u.y);
        if (mine ? f.crit || f.v > 40 : f.crit) this.shake(u.x, u.y, 90, mine ? 0.003 : 0.002);
        const col = mine ? "#ff6a5a" : f.crit ? "#ffd84a" : "#" + (KIND_COLOR[f.k ?? "phys"] ?? 0xffffff).toString(16).padStart(6, "0");
        this.number(u.x, y, f.crit ? `${f.v}!` : String(f.v), col, f.crit);
        if (f.k && f.k !== "phys") this.burst(u.x, u.y - 12, "fx_spark", KIND_COLOR[f.k], 6, 50, 350);
        else this.burst(u.x, u.y - 12, "fx_spark", 0xffffff, 3, 40, 200, 0, 0.6);
        break;
      }
      case "proj": {
        const from = this.unit(f.from);
        if (!from) return;
        const tex = PROJ_TEX[f.k] ?? "fx_arcane";
        const sx = from.x, sy = from.y - (from.frame > 32 ? 30 : 14);
        const to = f.to ? this.unit(f.to) : undefined;
        const tx = to ? to.x : f.tx, ty = to ? to.y - (to.frame > 32 ? 26 : 12) : f.ty - 12;
        this.sound(f.k === "arrow" || f.k === "aimed" ? "arrow" : (SFX_OF[f.k === "fireball" ? "fire" : f.k] ?? "arcane"), sx, sy);
        const img = s.add.image(sx, sy, tex).setDepth(DEPTH.top - 40).setRotation(Math.atan2(ty - sy, tx - sx));
        if (f.k === "fireball" || f.k === "fire") img.setScale(f.k === "fireball" ? 1.3 : 1);
        const trailColor = f.k === "arrow" ? 0xd8c8a0 : f.k === "poison" ? 0x9aff5a : f.k === "shadow" ? 0x8a5aff : f.k === "frost" ? 0x8ad0ff : f.k === "arcane" ? 0xc08aff : f.k === "holy" ? 0xffe890 : 0xff8a3a;
        const trail = s.add.particles(0, 0, "fx_spark", { follow: img, lifespan: 260, scale: { start: f.k === "arrow" ? 0.35 : 0.8, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: trailColor, frequency: 20, blendMode: Phaser.BlendModes.ADD });
        trail.setDepth(DEPTH.top - 41);
        s.tweens.add({
          targets: img, x: tx, y: ty, duration: Math.max(60, f.ms), ease: "Linear",
          onComplete: () => {
            img.destroy();
            trail.stop();
            s.time.delayedCall(300, () => trail.destroy());
            this.flash(tx, ty, trailColor, f.k === "fireball" ? 1 : 0.6);
            if (f.k !== "arrow") this.burst(tx, ty, "fx_spark", trailColor, 10, 70, 380);
            if (f.k === "fireball") { this.sound("explosion", tx, ty); this.burst(tx, ty, "fx_ember", trailColor, 12, 90, 500, 40); }
          },
        });
        break;
      }
      case "chain": {
        const g = s.add.graphics().setDepth(DEPTH.top - 38).setBlendMode(Phaser.BlendModes.ADD);
        const col = f.k ? (KIND_COLOR[f.k as keyof typeof KIND_COLOR] ?? 0xffe070) : 0xffe070;
        for (let pass = 0; pass < 2; pass++) {
          g.lineStyle(pass ? 1 : 4, pass ? 0xffffff : col, pass ? 1 : 0.5);
          for (let i = 0; i + 3 < f.pts.length; i += 2) {
            const x0 = f.pts[i], y0 = f.pts[i + 1], x1 = f.pts[i + 2], y1 = f.pts[i + 3];
            g.beginPath(); g.moveTo(x0, y0);
            const n = 5;
            for (let j = 1; j < n; j++) { const t = j / n; g.lineTo(x0 + (x1 - x0) * t + (Math.random() - 0.5) * 14, y0 + (y1 - y0) * t + (Math.random() - 0.5) * 14); }
            g.lineTo(x1, y1); g.strokePath();
          }
        }
        for (let i = 0; i < f.pts.length; i += 2) this.burst(f.pts[i], f.pts[i + 1], "fx_spark", col, 6, 50, 300);
        s.tweens.add({ targets: g, alpha: 0, duration: 320, onComplete: () => g.destroy() });
        break;
      }
      case "aoe": {
        this.sound(f.k === "quake" ? "slam" : f.k === "heal" ? "heal" : f.k === "fire" ? "explosion" : (SFX_OF[f.k] ?? "hit"), f.x, f.y);
        this.flash(f.x, f.y - 6, KIND_COLOR[f.k] ?? 0xffffff, Math.min(2.5, f.r / 40));
        const col = f.k === "taunt" ? 0xffa040 : f.k === "quake" ? 0xc09060 : (KIND_COLOR[f.k] ?? 0xffffff);
        const ring = s.add.image(f.x, f.y, "fx_ring").setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ground + 20).setScale(0.2, 0.14);
        s.tweens.add({ targets: ring, scaleX: f.r / 30, scaleY: (f.r / 30) * 0.7, alpha: { from: 1, to: 0 }, duration: 450, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
        const tex = f.k === "shadow" ? "fx_smoke" : f.k === "frost" ? "fx_shard" : f.k === "fire" ? "fx_ember" : f.k === "poison" ? "fx_bubble" : f.k === "nature" ? "fx_leaf" : "fx_spark";
        this.burst(f.x, f.y - 6, tex, col, Math.min(40, 10 + f.r / 5), f.r * 1.4, 520);
        if (f.k === "slash") {
          const g = s.add.graphics().setDepth(DEPTH.top - 40);
          g.lineStyle(3, 0xffffff, 0.95);
          g.beginPath(); g.moveTo(f.x - f.r * 0.8, f.y - f.r * 0.9); g.lineTo(f.x + f.r * 0.8, f.y + f.r * 0.5); g.strokePath();
          g.lineStyle(2, 0xc0a0ff, 0.8);
          g.beginPath(); g.moveTo(f.x - f.r * 0.5, f.y - f.r * 1.0); g.lineTo(f.x + f.r * 0.9, f.y + f.r * 0.2); g.strokePath();
          s.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
          this.burst(f.x, f.y - 8, "fx_spark", 0xe0d0ff, 8, 40, 300);
        }
        if (f.k === "heal") {
          const r3 = s.add.image(f.x, f.y, "fx_ring").setTint(0xffe890).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ground + 21).setScale(0.1, 0.07);
          s.tweens.add({ targets: r3, scaleX: f.r / 26, scaleY: (f.r / 26) * 0.7, alpha: { from: 1, to: 0 }, duration: 650, ease: "Cubic.easeOut", onComplete: () => r3.destroy() });
          this.burst(f.x, f.y - 4, "fx_spark", 0xfff0b0, Math.min(30, 8 + f.r / 6), f.r * 0.5, 900, -70, 0.9);
        }
        if (f.k === "taunt") {
          const r2 = s.add.image(f.x, f.y, "fx_ring").setTint(0xffe0a0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.ground + 21).setScale(0.1, 0.07);
          s.tweens.add({ targets: r2, scaleX: f.r / 18, scaleY: (f.r / 18) * 0.7, alpha: { from: 1, to: 0 }, duration: 650, delay: 120, ease: "Cubic.easeOut", onComplete: () => r2.destroy() });
        }
        if (f.k === "quake") {
          this.shake(f.x, f.y, 220, 0.006);
          const g = s.add.graphics().setDepth(DEPTH.ground + 22);
          g.lineStyle(2, 0x2a1a10, 0.9);
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + Math.random() * 0.3;
            let x = f.x, y = f.y; g.beginPath(); g.moveTo(x, y);
            for (let j = 1; j <= 4; j++) { const d = (f.r * j) / 4; x = f.x + Math.cos(a + (Math.random() - 0.5) * 0.3) * d; y = f.y + Math.sin(a + (Math.random() - 0.5) * 0.3) * d * 0.7; g.lineTo(x, y); }
            g.strokePath();
          }
          this.burst(f.x, f.y - 4, "fx_smoke", 0x806040, 14, f.r * 0.8, 800, -10, 1.4);
          s.tweens.add({ targets: g, alpha: 0, delay: 900, duration: 600, onComplete: () => g.destroy() });
        }
        if (f.k === "fire" && f.r >= 90) {
          this.shake(f.x, f.y, 180, 0.004);
          this.burst(f.x, f.y - 6, "fx_smoke", 0x605050, 12, 40, 900, -20, 1.5);
        }
        break;
      }
      case "cone": {
        this.sound(SFX_OF[f.k] ?? "hit", f.x, f.y);
        this.flash(f.x + Math.cos(f.a) * f.r * 0.6, f.y + Math.sin(f.a) * f.r * 0.6, KIND_COLOR[f.k] ?? 0xffffff, 0.8);
        const slash = s.add.image(f.x, f.y - 10, "fx_slash").setRotation(f.a).setDepth(DEPTH.top - 35).setBlendMode(Phaser.BlendModes.ADD).setScale(f.r / 30);
        slash.setTint(KIND_COLOR[f.k] ?? 0xffffff);
        s.tweens.add({ targets: slash, alpha: { from: 1, to: 0 }, rotation: f.a + 0.5, duration: 260, onComplete: () => slash.destroy() });
        break;
      }
      case "tele": {
        const g = s.add.graphics().setDepth(DEPTH.ground + 10);
        const color = f.k === "poison" ? 0x7aff3a : f.k === "nature" ? 0xa0ff50 : f.k === "frost" ? 0x6ac0ff : 0xff3a1a;
        const t0 = s.time.now;
        const draw = () => {
          const k = Math.min(1, (s.time.now - t0) / f.ms);
          g.clear();
          g.lineStyle(2.5, color, 0.7 + 0.3 * k);
          g.fillStyle(color, 0.16 + 0.2 * k);
          if (f.shape === "circle") {
            g.fillCircle(f.x, f.y, f.r).strokeCircle(f.x, f.y, f.r);
            g.fillStyle(color, 0.3).fillCircle(f.x, f.y, f.r * k);
          } else if (f.shape === "ring") {
            const r2 = f.r2 ?? f.r * 2;
            g.lineStyle(r2 - f.r, color, 0.16 + 0.24 * k).strokeCircle(f.x, f.y, (f.r + r2) / 2);
            g.lineStyle(2.5, color, 0.95).strokeCircle(f.x, f.y, f.r).strokeCircle(f.x, f.y, r2);
          } else {
            const a = f.a ?? 0, w = f.w ?? 1;
            g.slice(f.x, f.y, f.r, a - w / 2, a + w / 2, false).fillPath();
            g.slice(f.x, f.y, f.r * k, a - w / 2, a + w / 2, false).fillPath();
            g.slice(f.x, f.y, f.r, a - w / 2, a + w / 2, false).strokePath();
          }
        };
        draw();
        const ev = s.time.addEvent({ delay: 30, loop: true, callback: draw });
        s.time.delayedCall(f.ms, () => {
          ev.remove();
          g.destroy();
          const cx = f.shape === "cone" ? f.x + Math.cos(f.a ?? 0) * f.r * 0.5 : f.x, cy = f.shape === "cone" ? f.y + Math.sin(f.a ?? 0) * f.r * 0.5 : f.y;
          this.flash(cx, cy, color, Math.min(3, f.r / 50));
          this.sound(f.shape === "circle" && f.r < 70 ? "hit" : f.shape === "cone" ? "slam" : "explosion", cx, cy);
          if (f.r >= 90) this.shake(cx, cy, 200, 0.005);
          if (f.shape === "circle") this.burst(f.x, f.y - 4, f.k === "poison" ? "fx_bubble" : "fx_ember", color, 18, f.r * 1.2, 500);
          else if (f.shape === "ring") for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const r = ((f.r + (f.r2 ?? f.r * 2)) / 2); this.burst(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, "fx_ember", color, 4, 40, 400); }
          else this.burst(f.x + Math.cos(f.a ?? 0) * f.r * 0.5, f.y + Math.sin(f.a ?? 0) * f.r * 0.5, "fx_ember", color, 20, f.r, 500);
        });
        break;
      }
      case "hazard": {
        const color = f.k === "poison" ? 0x6adf2a : f.k === "fire" ? 0xff6a1a : 0x8a5aff;
        const pool = s.add.ellipse(f.x, f.y, f.r * 2, f.r * 1.5, color, 0.28).setDepth(DEPTH.ground + 8).setStrokeStyle(1.5, color, 0.8);
        const bub = s.add.particles(f.x, f.y, f.k === "poison" ? "fx_bubble" : "fx_ember", {
          x: { min: -f.r * 0.8, max: f.r * 0.8 }, y: { min: -f.r * 0.5, max: f.r * 0.5 }, lifespan: 900, speedY: { min: -20, max: -8 }, scale: { start: 1, end: 0.2 }, alpha: { start: 0.9, end: 0 }, frequency: 90, tint: color,
        }).setDepth(DEPTH.ground + 9);
        pool.setScale(0.2);
        s.tweens.add({ targets: pool, scale: 1, duration: 250 });
        this.hazards.set(f.id, [pool, bub]);
        s.time.delayedCall(f.ms, () => {
          s.tweens.add({ targets: pool, alpha: 0, duration: 400, onComplete: () => pool.destroy() });
          bub.stop();
          s.time.delayedCall(900, () => bub.destroy());
          this.hazards.delete(f.id);
        });
        break;
      }
      case "blink": {
        if (f.k === "charge") {
          const tr = s.add.graphics().setDepth(DEPTH.top - 40).setBlendMode(Phaser.BlendModes.ADD);
          tr.lineStyle(8, 0xffd070, 0.5).lineBetween(f.x0, f.y0 - 10, f.x1, f.y1 - 10);
          tr.lineStyle(2, 0xffffff, 0.9).lineBetween(f.x0, f.y0 - 10, f.x1, f.y1 - 10);
          s.tweens.add({ targets: tr, alpha: 0, duration: 260, onComplete: () => tr.destroy() });
          this.sound("hit", f.x1, f.y1);
          for (let i = 0; i <= 8; i++) { const t = i / 8; this.burst(f.x0 + (f.x1 - f.x0) * t, f.y0 + (f.y1 - f.y0) * t - 10, "fx_smoke", 0xd0b890, 2, 20, 500); }
          this.burst(f.x1, f.y1 - 8, "fx_spark", 0xffd070, 14, 70, 350);
          s.cameras.main.shake(120, 0.004);
          break;
        }
        if (f.k === "shadow") {
          const tr = s.add.graphics().setDepth(DEPTH.top - 40).setBlendMode(Phaser.BlendModes.ADD);
          tr.lineStyle(5, 0x8a5aff, 0.6).lineBetween(f.x0, f.y0 - 10, f.x1, f.y1 - 10);
          s.tweens.add({ targets: tr, alpha: 0, duration: 300, onComplete: () => tr.destroy() });
          this.sound("shadow", f.x1, f.y1);
          this.burst(f.x0, f.y0 - 10, "fx_smoke", 0x6a40a0, 12, 40, 600);
          this.burst(f.x1, f.y1 - 10, "fx_smoke", 0x6a40a0, 12, 40, 600);
          this.burst(f.x1, f.y1 - 12, "fx_spark", 0xc08aff, 8, 50, 400);
          break;
        }
        this.sound("arcane", f.x1, f.y1);
        this.burst(f.x0, f.y0 - 12, "fx_spark", 0xc08aff, 16, 60, 450);
        this.burst(f.x1, f.y1 - 12, "fx_spark", 0xc08aff, 16, 60, 450);
        break;
      }
      case "lvl": {
        const u = this.unit(f.id);
        if (!u) return;
        const col = s.add.image(u.x, u.y - 30, "fx_glow").setTint(0xffd84a).setBlendMode(Phaser.BlendModes.ADD).setScale(1, 4).setDepth(DEPTH.top - 30).setAlpha(0.9);
        s.tweens.add({ targets: col, scaleX: 0.2, alpha: 0, duration: 1100, onComplete: () => col.destroy() });
        this.burst(u.x, u.y - 10, "fx_spark", 0xffd84a, 30, 90, 900, -60);
        this.number(u.x, u.y - 44, `Уровень ${f.level}!`, "#ffd84a", true);
        break;
      }
      case "buff": {
        const u = this.unit(f.id);
        if (!u) return;
        const color = f.k === "warcry" ? 0xff6a3a : f.k === "haste" ? 0x6aff8a : f.k === "enrage" ? 0xff2a1a : 0xffffff;
        if (f.k === "heal" || f.k === "renew") {
          this.sound("heal", u.x, u.y);
          this.burst(u.x, u.y - 6, "fx_spark", f.k === "heal" ? 0x9affb8 : 0xffe890, 14, 30, 900, -80, 0.8);
          if (f.k === "renew") {
            const rep = s.time.addEvent({ delay: 450, loop: true, callback: () => { const q = this.unit(f.id); if (q) this.burst(q.x, q.y - 4, "fx_spark", 0xb8ffc8, 2, 20, 700, -70, 0.6); } });
            s.time.delayedCall(f.ms, () => rep.remove());
          }
          break;
        }
        if (f.k === "block" || f.k === "shield") {
          this.sound("shield", u.x, u.y);
          const gold = f.k === "shield";
          const bub = s.add.ellipse(u.x, u.y - 10, 44, 52, gold ? 0xffd84a : 0x6ac0ff, 0.22).setStrokeStyle(2, gold ? 0xfff0b0 : 0xbfe6ff, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.top - 30);
          const follow = s.time.addEvent({ delay: 30, loop: true, callback: () => { const q = this.unit(f.id); if (q) bub.setPosition(q.x, q.y - 10); } });
          s.tweens.add({ targets: bub, alpha: { from: 0.9, to: 0.5 }, yoyo: true, repeat: -1, duration: 300 });
          s.time.delayedCall(f.ms, () => { follow.remove(); s.tweens.killTweensOf(bub); s.tweens.add({ targets: bub, alpha: 0, duration: 200, onComplete: () => bub.destroy() }); });
          break;
        }
        this.burst(u.x, u.y - 12, "fx_spark", f.k === "taunted" ? 0xff8030 : f.k === "weak" ? 0x8a6a9a : color, 20, 80, 600, -40);
        if (f.k === "enrage") { this.shake(u.x, u.y, 300, 0.006); this.sound("slam", u.x, u.y); }
        break;
      }
      case "say": {
        this.onSay(f.id, f.text);
        break;
      }
      case "spawn": {
        const u = this.unit(f.id);
        const x = u?.x ?? 0, y = u?.y ?? 0;
        if (u) this.burst(x, y - 8, f.k === "nature" ? "fx_leaf" : "fx_smoke", f.k === "nature" ? 0x9adf5a : 0x9a8a9a, 14, 50, 700, -20);
        break;
      }
    }
  }
}
