/** Отображение одного юнита: спрайт с анимациями, тень, имя, полоска здоровья, эффекты состояния. */
import Phaser from "phaser";
import { BUFF_BURN, BUFF_ENRAGE, BUFF_HASTE, BUFF_POISON, BUFF_ROOT, BUFF_SLOW, BUFF_STUN, BUFF_WARCRY, Anim, Dir, UnitKind } from "../../../shared/protocol";
import { RARITY_COLORS } from "../../../shared/items";
import { net, type UnitState } from "../net";
import { rankById } from "../../../shared/arena";
import { DEPTH } from "./terrain";
import { mountSprite } from "../../../shared/mounts";

export const FONT = '"Rubik", "Trebuchet MS", sans-serif';
const MELEE = new Set(["pet_wolf", "pet_turtle", "warrior", "goblin", "skeleton", "skeleton_knight", "wolf", "boar", "spider", "drowned", "golem", "ent", "ashlord"]);
const rowOf = (dir: number) => (dir === Dir.Down ? 0 : dir === Dir.Up ? 1 : 2);

export class UnitView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Image;
  aura?: Phaser.GameObjects.Image;
  stun?: Phaser.GameObjects.Text;
  /** Титул над именем и рамка ранга арены. */
  titleText: Phaser.GameObjects.Text;
  frameGfx: Phaser.GameObjects.Graphics;
  mountSpr?: Phaser.GameObjects.Sprite;
  private mountId = "";
  private lastTitle = "";
  private lastColor = "";
  x: number;
  y: number;
  frame: number;
  private lastAseq: number;
  private lastAnim = -1;
  private lastRow = -1;
  private lastHp = -1;
  private lastLabel = "";
  private attacking = false;
  private flashUntil = 0;
  dead = false;
  selected = false;
  hovered = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly id: string,
    readonly u: UnitState,
    readonly isSelf: boolean,
  ) {
    this.x = u.x;
    this.y = u.y;
    const tex = scene.textures.exists(`u_${u.sprite}`) ? `u_${u.sprite}` : "u_slime";
    this.frame = scene.textures.get(tex).get(0).width;
    const big = this.frame > 32;
    this.shadow = scene.add.image(u.x, u.y, "fx_shadow_blob").setScale(big ? 2.2 : 1, big ? 2 : 1).setDepth(DEPTH.ground + 5);
    this.ring = scene.add.image(u.x, u.y, "fx_target").setVisible(false).setDepth(DEPTH.ground + 6).setScale(big ? 2 : 1);
    this.sprite = scene.add.sprite(u.x, u.y, tex, 0).setOrigin(0.5, 30 / 32);
    if (u.kind === UnitKind.Pet) {
      this.sprite.setScale(0.8);
      this.shadow.setScale(0.8);
    }
    this.lastAseq = u.aseq;
    const color = u.kind === UnitKind.Player ? (isSelf ? "#ffe9a8" : "#a8e0ff") : u.kind === UnitKind.Boss ? "#ff8a5a" : u.kind === UnitKind.Pet ? "#8ae88a" : "#f0e6d2";
    this.label = scene.add
      .text(u.x, u.y, this.labelText(), { fontFamily: FONT, fontSize: u.kind === UnitKind.Boss ? "11px" : u.kind === UnitKind.Pet ? "8px" : "9px", fontStyle: "600", color, stroke: "#120a10", strokeThickness: 4, resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.top - 5);
    this.bar = scene.add.graphics().setDepth(DEPTH.top - 6);
    this.titleText = scene.add.text(u.x, u.y, "", { fontFamily: FONT, fontSize: "8px", color: "#f0c050", stroke: "#120a10", strokeThickness: 4, resolution: 4 }).setOrigin(0.5, 1).setDepth(DEPTH.top - 5);
    this.frameGfx = scene.add.graphics().setDepth(DEPTH.top - 7);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, (a: Phaser.Animations.Animation) => {
      if (a.key.includes("-attack-")) {
        this.attacking = false;
        this.lastAnim = -1;
      }
    });
    if (u.anim === Anim.Dead) this.showDead(true);
  }

  private labelText() {
    const u = this.u;
    if (u.kind === UnitKind.Mob) return `${u.name} · ${u.level}`;
    if (u.kind === UnitKind.Boss) return `${u.name}`;
    if (u.kind === UnitKind.Pet) return `${u.name} (${net.unit(u.ownerId)?.name ?? "?"}) · ${u.level}`;
    return `${u.name} · ${u.level}`;
  }

  /** Короткий след удара оружием в сторону взгляда. */
  private slash(dir: number) {
    const a = dir === Dir.Down ? Math.PI / 2 : dir === Dir.Up ? -Math.PI / 2 : dir === Dir.Left ? Math.PI : 0;
    const big = this.frame > 32;
    const s = this.scene.add.image(this.x + Math.cos(a) * (big ? 22 : 10), this.y - (big ? 24 : 12) + Math.sin(a) * (big ? 18 : 8), "fx_slash")
      .setRotation(a - 0.6).setScale(big ? 1.2 : 0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.y + 1).setAlpha(0);
    if (this.u.sprite === "ashlord") s.setTint(0xff8a3a);
    this.scene.tweens.add({ targets: s, alpha: { from: 0.9, to: 0 }, rotation: a + 0.6, delay: 90, duration: 200, onComplete: () => s.destroy() });
  }

  flash() {
    this.flashUntil = this.scene.time.now + 90;
  }

  private showDead(instant: boolean) {
    this.dead = true;
    const row = rowOf(this.u.dir);
    const key = `${this.u.sprite}-death-${row}`;
    if (instant || !this.scene.anims.exists(key)) this.sprite.setFrame(row * 12 + 11);
    else this.sprite.play(key);
    this.sprite.setFlipX(this.u.dir === Dir.Left);
    this.label.setVisible(false);
    this.bar.clear();
    this.scene.tweens.add({ targets: [this.sprite, this.shadow], alpha: this.u.kind === UnitKind.Player ? 0.75 : 0.55, duration: 600, delay: 400 });
  }

  /** Вызывается каждый кадр; px/py — позиция для отрисовки (у своего игрока — предсказанная). */
  update(dt: number, px?: number, py?: number) {
    const u = this.u;
    if (px !== undefined && py !== undefined) {
      this.x = px;
      this.y = py;
    } else {
      const dx = u.x - this.x, dy = u.y - this.y;
      if (dx * dx + dy * dy > 160 * 160) {
        this.x = u.x;
        this.y = u.y;
      } else {
        const k = Math.min(1, dt * 12);
        this.x += dx * k;
        this.y += dy * k;
      }
    }
    // смерть и возрождение
    if (u.anim === Anim.Dead && !this.dead) this.showDead(false);
    else if (u.anim !== Anim.Dead && this.dead) {
      this.dead = false;
      this.x = u.x;
      this.y = u.y;
      this.sprite.setAlpha(0);
      this.shadow.setAlpha(1);
      this.label.setVisible(true);
      this.scene.tweens.add({ targets: this.sprite, alpha: 1, duration: 500 });
      this.lastAnim = -1;
      this.lastHp = -1;
    }

    const row = rowOf(u.dir);
    const anim = u.mount ? Anim.Idle : u.anim;
    if (!this.dead) {
      this.sprite.setFlipX(u.dir === Dir.Left);
      if (u.aseq !== this.lastAseq) {
        this.lastAseq = u.aseq;
        this.attacking = true;
        this.sprite.play(`${u.sprite}-attack-${row}`);
        if (MELEE.has(u.sprite)) this.slash(u.dir);
      } else if (!this.attacking && (anim !== this.lastAnim || row !== this.lastRow)) {
        if (anim === Anim.Walk) this.sprite.play(`${u.sprite}-walk-${row}`, true);
        else {
          this.sprite.stop();
          this.sprite.setFrame(row * 12);
        }
      }
      this.lastAnim = anim;
      this.lastRow = row;
    }

    // позиция и глубина
    const bob = !this.dead && anim === Anim.Idle && !u.mount && !this.attacking ? Math.round(Math.sin(this.scene.time.now / 380 + this.x) * 0.6) : 0;
    const mounted = !!u.mount && !this.dead && this.scene.textures.exists(`u_${mountSprite(u.mount)}`);
    if (mounted && (!this.mountSpr || this.mountId !== u.mount)) {
      this.mountSpr?.destroy();
      this.mountId = u.mount;
      this.mountSpr = this.scene.add.sprite(this.x, this.y, `u_${mountSprite(u.mount)}`, 0).setOrigin(0.5, 30 / 32);
    }
    if (this.mountSpr) {
      const ms = this.mountSpr;
      ms.setVisible(mounted).setPosition(Math.round(this.x), Math.round(this.y)).setDepth(this.y - 0.5).setFlipX(u.dir === Dir.Left).setScale(1.15);
      const key = `${mountSprite(this.mountId)}-walk-0`;
      if (u.anim === Anim.Walk) ms.play(key, true);
      else if (ms.anims.isPlaying) { ms.stop(); ms.setFrame(0); }
    }
    const lift = mounted ? 9 : 0;
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y) + bob - lift).setDepth(this.y);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 2);
    this.ring.setPosition(Math.round(this.x), Math.round(this.y) - 1).setVisible(this.selected && !this.dead);
    const top = this.y - (this.frame > 32 ? 58 : u.kind === UnitKind.Pet ? 22 : 27) - lift;
    this.label.setPosition(Math.round(this.x), Math.round(top - 4));
    const lt = this.labelText();
    if (lt !== this.lastLabel) { this.lastLabel = lt; this.label.setText(lt); }
    // на арене: союзники зелёные, враги красные
    if (u.kind === UnitKind.Player) {
      const color = this.isSelf ? "#ffe9a8" : net.kind === "arena" && u.team ? (u.team === net.arena?.team ? "#9ae07a" : "#ff8a7a") : "#a8e0ff";
      if (color !== this.lastColor) { this.lastColor = color; this.label.setColor(color); }
    }
    if (u.title !== this.lastTitle) { this.lastTitle = u.title; this.titleText.setText(u.title ? `«${u.title.replace(/ \(.*\)$/, "")}»` : ""); }
    const showName = !this.dead && this.label.visible;
    this.titleText.setVisible(showName && !!u.title).setPosition(Math.round(this.x), Math.round(top - 13));
    this.frameGfx.clear();
    if (u.elite && showName) {
      const w = this.label.width + 6, h = 11;
      const fx = Math.round(this.x - w / 2), fy = Math.round(top - 4 - h + 1);
      this.frameGfx.fillStyle(0x120a10, 0.55).fillRoundedRect(fx, fy, w, h, 3);
      this.frameGfx.lineStyle(1, 0xf0c040, 1).strokeRoundedRect(fx, fy, w, h, 3);
      this.frameGfx.fillStyle(0xf0c040, 1).fillRect(fx - 2, fy + h / 2 - 1, 2, 2).fillRect(fx + w, fy + h / 2 - 1, 2, 2);
      if (this.lastColor !== "#ffd24a") { this.lastColor = "#ffd24a"; this.label.setColor("#ffd24a"); }
    }
    const rank = u.frame ? rankById(u.frame) : undefined;
    if (rank && showName) {
      const w = this.label.width + 6, h = 11;
      const fx = Math.round(this.x - w / 2), fy = Math.round(top - 4 - h + 1);
      const c = Phaser.Display.Color.HexStringToColor(rank.color).color;
      this.frameGfx.fillStyle(0x120a10, 0.55).fillRoundedRect(fx, fy, w, h, 3);
      this.frameGfx.lineStyle(1, c, 1).strokeRoundedRect(fx, fy, w, h, 3);
      this.frameGfx.fillStyle(c, 1).fillRect(fx - 2, fy + h / 2 - 1, 2, 2).fillRect(fx + w, fy + h / 2 - 1, 2, 2);
    }

    // цвет: вспышка от удара и эффекты
    const b = u.buffs;
    if (this.scene.time.now < this.flashUntil) { if (this.frame > 32) this.sprite.setTint(0xffb0a0); else this.sprite.setTintFill(0xffffff); }
    else if (b & BUFF_STUN) this.sprite.setTint(0xfff0a0);
    else if (b & BUFF_SLOW || b & BUFF_ROOT) this.sprite.setTint(0x9ac8ff);
    else if (b & BUFF_POISON) this.sprite.setTint(0xb0ff90);
    else if (b & BUFF_BURN) this.sprite.setTint(0xffb080);
    else if (b & BUFF_ENRAGE) this.sprite.setTint(0xff8a7a);
    else if (this.hovered && u.kind !== UnitKind.Player) this.sprite.setTint(0xffe0c0);
    else this.sprite.clearTint();

    const auraOn = (!!(b & (BUFF_WARCRY | BUFF_HASTE | BUFF_ENRAGE)) || !!u.elite) && !this.dead;
    if (auraOn && !this.aura) this.aura = this.scene.add.image(0, 0, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    if (this.aura) {
      this.aura.setVisible(auraOn).setPosition(this.x, this.y - 12).setDepth(this.y - 1).setScale(this.frame > 32 ? 2.2 : 1.1);
      this.aura.setTint(u.elite && !(b & BUFF_ENRAGE) ? 0xf0c040 : b & BUFF_ENRAGE ? 0xff3a1a : b & BUFF_WARCRY ? 0xff6a3a : 0x6aff8a);
    }
    if (b & BUFF_STUN && !this.dead) {
      this.stun ??= this.scene.add.text(0, 0, "✦ ✦", { fontFamily: FONT, fontSize: "8px", color: "#fff070", stroke: "#000", strokeThickness: 2, resolution: 4 }).setOrigin(0.5).setDepth(DEPTH.top - 4);
      this.stun.setVisible(true).setPosition(this.x + Math.sin(this.scene.time.now / 120) * 3, top - 14);
    } else this.stun?.setVisible(false);

    // полоска здоровья
    const showBar = !this.dead && (u.kind !== UnitKind.Player || u.hp < u.maxHp || this.isSelf);
    if (!showBar) this.bar.clear();
    else if (u.hp !== this.lastHp || true) {
      this.lastHp = u.hp;
      const w = (this.frame > 32 ? 44 : 22) + (u.elite ? 8 : 0);
      const bx = Math.round(this.x - w / 2), by = Math.round(top - 2);
      const k = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)));
      this.bar.clear();
      this.bar.fillStyle(u.elite ? 0xf0c040 : 0x0a0608, 0.9).fillRect(bx - 1, by - 1, w + 2, 4);
      if (u.elite) this.bar.fillStyle(0x0a0608, 1).fillRect(bx, by, w, 2);
      const col = u.kind === UnitKind.Player ? (this.isSelf ? 0x5ad04a : 0x4ab0ff) : u.kind === UnitKind.Pet ? 0x6ad06a : k > 0.5 ? 0xd8443a : k > 0.25 ? 0xe0902a : 0xff3a2a;
      this.bar.fillStyle(col, 1).fillRect(bx, by, Math.round(w * k), 2);
      if (u.kind === UnitKind.Player && u.weapon) {
        const r = Number(u.weapon.split(":")[1] || 0);
        if (r > 0) this.bar.fillStyle(Phaser.Display.Color.HexStringToColor(RARITY_COLORS[r]).color, 1).fillRect(bx - 4, by, 2, 2);
      }
    }
  }

  hitTest(wx: number, wy: number): number {
    if (this.dead) return Infinity;
    const r = this.frame > 32 ? 30 : 14;
    const dx = wx - this.x, dy = wy - (this.y - (this.frame > 32 ? 26 : 12));
    const d = Math.hypot(dx, dy);
    return d < r ? d : Infinity;
  }

  destroy() {
    this.sprite.destroy();
    this.mountSpr?.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.bar.destroy();
    this.ring.destroy();
    this.aura?.destroy();
    this.stun?.destroy();
    this.titleText.destroy();
    this.frameGfx.destroy();
  }
}
