/** Сценки Эмберхолла: чисто косметические NPC. Всё детерминировано от Date.now() — у всех игроков одинаково. */
import Phaser from "phaser";
import data from "../../../data/scenes.json";
import { TILE } from "../../../shared/constants";
import { TOWN, walkable, type WorldMap } from "../../../shared/map";
import { DEPTH } from "./terrain";
import { FONT } from "./UnitView";

const cx = (o: number) => (TOWN.x + o) * TILE + 16;
const cy = (o: number) => (TOWN.y + o) * TILE + 16;
const R = 6;

interface Actor {
  s: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Container;
  txt: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Graphics;
  tex: string;
  x: number;
  y: number;
  shown: string;
}
interface Notes { x: number; y: number; every: number; pool: Phaser.GameObjects.Text[] }

export class Scenes {
  private actors: Actor[] = [];
  private notes: Notes[] = [];
  private active = false;
  private brawl: { a: Actor; b: Actor; m: Actor };
  private bard: Actor;
  private mus: Actor[] = [];
  private crowd: Actor;
  private kids: Actor[] = [];
  private kidPos: { x: number; y: number }[] = [];

  constructor(private sc: Phaser.Scene, private map: WorldMap) {
    const d = data;
    const [bx, by] = d.brawl.at;
    const mk = (sprite: string, tint: string, x: number, y: number, scale = 1) => this.mk(sprite, Number(tint), x, y, scale);
    this.brawl = {
      a: mk(d.brawl.patrons[0].sprite, d.brawl.patrons[0].tint, cx(bx - d.brawl.gap), cy(by)),
      b: mk(d.brawl.patrons[1].sprite, d.brawl.patrons[1].tint, cx(bx + d.brawl.gap), cy(by)),
      m: mk(d.brawl.barmaid.sprite, d.brawl.barmaid.tint, cx(bx + d.brawl.barmaid.dx), cy(by)),
    };
    this.bard = mk(d.bard.sprite, d.bard.tint, cx(d.bard.at[0]), cy(d.bard.at[1]));
    this.notes.push(this.mkNotes(this.bard.x, this.bard.y - 34, d.bard.noteEvery));
    const [mx, my] = d.musicians.at;
    for (const p of d.musicians.players) this.mus.push(mk(p.sprite, p.tint, cx(mx + p.dx), cy(my)));
    this.notes.push(this.mkNotes(cx(mx), cy(my) - 34, d.musicians.noteEvery));
    const c = d.musicians.crowd;
    this.crowd = mk(c.sprite, c.tint, cx(mx + c.dx), cy(my + c.dy));
    for (const k of d.kids.sprites) {
      this.kids.push(mk(k.sprite, k.tint, cx(d.kids.at[0]), cy(d.kids.at[1]), d.kids.scale));
      this.kidPos.push({ x: cx(d.kids.at[0]), y: cy(d.kids.at[1]) });
    }
    this.setActive(false);
  }

  private mk(sprite: string, tint: number, x: number, y: number, scale = 1): Actor {
    const sc = this.sc;
    const tex = sc.textures.exists(`u_${sprite}`) ? sprite : "merchant";
    const s = sc.add.sprite(x, y, `u_${tex}`, 0).setOrigin(0.5, 30 / 32).setScale(scale).setTint(tint);
    const shadow = sc.add.image(x, y - 2, "fx_shadow_blob").setDepth(DEPTH.ground + 5).setScale(scale);
    const bg = sc.add.graphics();
    const txt = sc.add.text(0, 0, "", { fontFamily: FONT, fontSize: "9px", fontStyle: "600", color: "#2a1a10", stroke: "#fff4dc", strokeThickness: 1, resolution: 4, align: "center" }).setOrigin(0.5, 1);
    const bubble = sc.add.container(x, y, [bg, txt]).setDepth(DEPTH.top - 4).setVisible(false);
    const a: Actor = { s, shadow, bubble, txt, bg, tex, x, y, shown: "" };
    this.actors.push(a);
    return a;
  }

  private mkNotes(x: number, y: number, every: number): Notes {
    const n = Math.ceil(2.4 / every) + 1;
    const pool = Array.from({ length: n }, () =>
      this.sc.add.text(0, 0, "♪", { fontFamily: FONT, fontSize: "11px", fontStyle: "700", color: "#ffe9a0", stroke: "#120a10", strokeThickness: 3, resolution: 4 }).setOrigin(0.5).setDepth(DEPTH.top - 6));
    return { x, y, every, pool };
  }

  private setActive(on: boolean) {
    this.active = on;
    for (const a of this.actors) {
      a.s.setVisible(on);
      a.shadow.setVisible(on);
      if (!on) a.bubble.setVisible(false);
    }
    for (const n of this.notes) for (const t of n.pool) t.setVisible(false);
  }

  private pose(a: Actor, x: number, y: number, mode: "idle" | "walk" | "attack", flip?: boolean, hop = 0) {
    a.x = x;
    a.y = y;
    a.s.setPosition(x, y - hop).setDepth(y);
    a.shadow.setPosition(x, y - 2);
    if (flip !== undefined) a.s.setFlipX(flip);
    if (mode === "idle") {
      a.s.anims.stop();
      a.s.setFrame(0);
    } else {
      const key = `${a.tex}-${mode}-0`;
      if (a.s.anims.currentAnim?.key !== key || !a.s.anims.isPlaying) a.s.play(key, true);
    }
  }

  /** Реплика по расписанию: активна первые `sec` секунд каждого периода `every`. */
  private say(a: Actor, t: number, every: number, sec: number, off: number, lines: string[]) {
    const u = t + off;
    const slot = Math.floor(u / every);
    this.speak(a, u - slot * every < sec ? lines[slot % lines.length] : "");
  }

  private speak(a: Actor, text: string) {
    if (!text) {
      a.bubble.setVisible(false);
      a.shown = "";
      return;
    }
    if (a.shown !== text) {
      a.shown = text;
      a.txt.setText(text);
      const w = a.txt.width + 10, h = a.txt.height + 6;
      a.bg.clear().fillStyle(0xfff4dc, 0.95).lineStyle(1.5, 0x3a2418, 1).fillRoundedRect(-w / 2, -h - 3, w, h, 4).strokeRoundedRect(-w / 2, -h - 3, w, h, 4);
      a.bg.fillTriangle(-3, -3, 3, -3, 0, 2);
      a.txt.setPosition(0, -6);
    }
    a.bubble.setPosition(a.x, a.y - (34 * a.s.scaleY + 2)).setVisible(true);
  }

  private emit(n: Notes, t: number) {
    const life = 2.4;
    const base = Math.floor(t / n.every);
    n.pool.forEach((o, i) => {
      const slot = base - i;
      const age = t - slot * n.every;
      if (age < 0 || age > life) {
        o.setVisible(false);
        return;
      }
      const h = Math.sin(slot * 12.9898) * 43758.5453;
      const r = h - Math.floor(h);
      const k = age / life;
      o.setVisible(true).setPosition(n.x + (r - 0.5) * 22 + Math.sin(age * 3 + r * 6) * 4, n.y - age * 14).setAlpha(1 - k * k).setText(r > 0.5 ? "♪" : "♫").setScale(0.9 + r * 0.4);
    });
  }

  update(px: number, py: number) {
    const R2 = data.nearRadius;
    const near = [data.brawl.at, data.bard.at, data.musicians.at, data.kids.at].some((p) => Math.hypot(px - cx(p[0]), py - cy(p[1])) < R2);
    if (near !== this.active) this.setActive(near);
    if (!near) return;
    const t = Date.now() / 1000;
    this.updBrawl(t);
    this.updBard(t);
    this.updMusic(t);
    this.updKids(t);
  }

  private updBrawl(t: number) {
    const b = data.brawl, { a, b: c, m } = this.brawl;
    const ph = t % b.period;
    const [bx, by] = b.at;
    const sway = (o: number) => Math.sin(t * 1.6 + o) * 2;
    if (ph < b.fightSec) {
      const lunge = Math.max(0, Math.sin(t * 5)) * 7;
      const shake = Math.sin(t * 20);
      this.pose(a, cx(bx - b.gap) + lunge + shake, cy(by), "attack", false);
      this.pose(c, cx(bx + b.gap) - Math.max(0, Math.sin(t * 5 + 2.5)) * 7 - shake, cy(by) + 1, "attack", true);
      this.pose(m, cx(bx + b.barmaid.dx), cy(by) + 14, "idle", true);
      const i = Math.floor(t / 2);
      const [on, off] = i % 2 ? [a, c] : [c, a];
      this.speak(on, b.fightLines[i % b.fightLines.length]);
      off.bubble.setVisible(false);
      m.bubble.setVisible(false);
    } else if (ph < b.fightSec + b.breakupSec) {
      const k = Math.min(1, (ph - b.fightSec) / 1.2);
      const away = k * 12;
      this.pose(m, cx(bx + b.barmaid.dx) - k * b.barmaid.dx * TILE, cy(by) + 14 * (1 - k), k < 1 ? "walk" : "idle", k < 1);
      this.pose(a, cx(bx - b.gap) - away, cy(by), "idle", false);
      this.pose(c, cx(bx + b.gap) + away, cy(by), "idle", true);
      a.bubble.setVisible(false);
      c.bubble.setVisible(false);
      this.speak(m, b.barmaidLines[Math.floor(t / b.period) % b.barmaidLines.length]);
    } else {
      this.pose(a, cx(bx - b.gap) - 12 + sway(0), cy(by), "idle", false);
      this.pose(c, cx(bx + b.gap) + 12 + sway(2), cy(by), "idle", true);
      this.pose(m, cx(bx + b.barmaid.dx), cy(by) + 14, "idle", true);
      m.bubble.setVisible(false);
      this.say(a, t, 5, 2, 0, b.idleLines);
      this.say(c, t, 5, 2, 2.5, b.idleLines.slice().reverse());
    }
  }

  private updBard(t: number) {
    const b = data.bard;
    this.pose(this.bard, cx(b.at[0]), cy(b.at[1]), "idle", false, Math.max(0, Math.sin(t * 4)) * 1.5);
    this.say(this.bard, t, b.lineEvery, b.lineSec, 0, b.lines);
    this.emit(this.notes[0], t);
  }

  private updMusic(t: number) {
    const m = data.musicians;
    m.players.forEach((p, i) => {
      this.pose(this.mus[i], cx(m.at[0] + p.dx), cy(m.at[1]), "idle", i === 1, Math.max(0, Math.sin(t * (i ? 6 : 4) + i)) * 1.5);
    });
    this.say(this.mus[0], t, m.lineEvery, m.lineSec, 0, m.lines);
    this.mus[1].bubble.setVisible(false);
    this.pose(this.crowd, cx(m.at[0] + m.crowd.dx), cy(m.at[1] + m.crowd.dy), "idle", false, Math.abs(Math.sin(t * 5)) * 2.5);
    this.say(this.crowd, t, m.lineEvery, m.lineSec, 4, m.crowdLines);
    this.emit(this.notes[1], t);
  }

  private updKids(t: number) {
    const k = data.kids;
    this.kids.forEach((a, i) => {
      // петля; каждый следующий «гонится» за предыдущим с отставанием по фазе
      const ang = t * k.speed - i * 0.55;
      const x = cx(k.at[0]) + Math.cos(ang) * k.radius[0] * TILE;
      const y = cy(k.at[1]) + Math.sin(ang * 1.3) * k.radius[1] * TILE;
      const p = this.kidPos[i];
      const ok = walkable(this.map, x, y, R);
      const nx = ok ? x : p.x, ny = ok ? y : p.y;
      const dx = nx - p.x;
      this.kidPos[i] = { x: nx, y: ny };
      this.pose(a, nx, ny, ok ? "walk" : "idle", dx < 0 ? true : dx > 0 ? false : undefined);
      this.say(a, t, k.lineEvery, k.lineSec, i * 2.3, k.lines.slice(i).concat(k.lines.slice(0, i)));
    });
  }
}
