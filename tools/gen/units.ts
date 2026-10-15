/**
 * Спрайт-листы юнитов. Раскладка (для всех юнитов одинакова):
 *   столбцы 0–3 — ходьба, 4–7 — атака, 8–11 — смерть;
 *   строки 0 — вниз (к зрителю), 1 — вверх (спиной), 2 — вбок (вправо, влево = отражение).
 * Кадр 32×32, у боссов 64×64.
 */
import { OUTLINE, PC, hex, mix, shade, withA, type RGBA, type Ramp } from "./canvas";
import { P } from "./palette";
import { MOUNTS, mountSprite } from "../../shared/mounts";

export type View = "down" | "up" | "side";
export type Pose = { kind: "walk" | "attack"; i: number };
export const VIEWS: View[] = ["down", "up", "side"];
const DEG = Math.PI / 180;

export interface HSpec {
  skin: Ramp;
  hair?: Ramp;
  hairStyle?: "short" | "long" | "none" | "wild";
  torso: Ramp;
  legs: Ramp;
  boots: Ramp;
  belt?: Ramp;
  robe?: Ramp;
  cape?: Ramp;
  head?: "helmet" | "hat" | "hood" | "horns" | "feathers" | "darkhelm" | "witchhat" | "cap" | "none";
  headRamp?: Ramp;
  /** Султан на шлеме (стража): яркий цвет города, виден издалека. */
  plume?: Ramp;
  weapon?: "sword" | "axe" | "staff" | "bow" | "dagger" | "flamesword" | "skullstaff" | "claws" | "none";
  orb?: Ramp;
  shield?: Ramp;
  ears?: boolean;
  eye?: RGBA;
  glowEyes?: boolean;
  ribs?: boolean;
  wings?: Ramp;
  tail?: Ramp;
  hover?: boolean;
  legLen?: number;
  headR?: number;
  bodyW?: number;
  beard?: Ramp;
  apron?: Ramp;
  quiver?: boolean;
  armorPlates?: Ramp;
  lavaCracks?: boolean;
}

// ---------------- оружие ----------------
function drawWeapon(c: PC, kind: NonNullable<HSpec["weapon"]>, hx: number, hy: number, ang: number, k: number, spec: HSpec, glow = 0) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const L = (n: number) => n * k;
  switch (kind) {
    case "sword":
    case "flamesword":
    case "dagger": {
      const len = L(kind === "dagger" ? 5 : kind === "flamesword" ? 12 : 9);
      const blade = kind === "flamesword" ? P.magic.fire : P.steel;
      // рукоять и гарда
      c.line(hx - dx * L(2), hy - dy * L(2), hx, hy, P.wood[1], Math.max(1, k));
      const px = -dy, py = dx;
      c.line(hx - px * L(2), hy - py * L(2), hx + px * L(2), hy + py * L(2), P.gold[2], Math.max(1, k));
      // клинок: тёмная кромка и светлая середина
      c.line(hx + dx * L(1), hy + dy * L(1), hx + dx * len, hy + dy * len, blade[1], Math.max(2, k * 2));
      c.line(hx + dx * L(1), hy + dy * L(1), hx + dx * (len - L(1)), hy + dy * (len - L(1)), blade[3], Math.max(1, k));
      c.set(Math.round(hx + dx * len), Math.round(hy + dy * len), blade[4] ?? blade[3]);
      if (kind === "flamesword") for (let s = 2; s < 12; s += 2) c.set(Math.round(hx + dx * L(s) + px * L(1.5)), Math.round(hy + dy * L(s) + py * L(1.5)), P.magic.fire[4]);
      break;
    }
    case "axe": {
      const len = L(9);
      c.line(hx - dx * L(2), hy - dy * L(2), hx + dx * len, hy + dy * len, P.wood[2], Math.max(1, k));
      const px = -dy, py = dx;
      const ex = hx + dx * (len - L(2)), ey = hy + dy * (len - L(2));
      c.poly([[ex, ey], [ex + px * L(4) - dx * L(1.5), ey + py * L(4) - dy * L(1.5)], [ex + px * L(4) + dx * L(3), ey + py * L(4) + dy * L(3)], [ex + dx * L(2), ey + dy * L(2)]], P.steel[2]);
      c.line(ex + px * L(4) - dx * L(1.5), ey + py * L(4) - dy * L(1.5), ex + px * L(4) + dx * L(3), ey + py * L(4) + dy * L(3), P.steel[4], 1);
      break;
    }
    case "staff":
    case "skullstaff": {
      const len = L(13);
      c.line(hx - dx * L(4), hy - dy * L(4), hx + dx * len, hy + dy * len, P.wood[2], Math.max(1, k));
      c.line(hx - dx * L(4) + 1, hy - dy * L(4), hx + dx * len + 1, hy + dy * len, P.wood[1], 1);
      const ox = hx + dx * (len + L(1.5)), oy = hy + dy * (len + L(1.5));
      if (kind === "skullstaff") {
        c.shadedEllipse(ox, oy, L(2.6), L(2.4), P.bone);
        c.set(Math.round(ox - L(1)), Math.round(oy), hex("#30ff60"));
        c.set(Math.round(ox + L(1)), Math.round(oy), hex("#30ff60"));
      } else {
        const orb = spec.orb ?? P.magic.blue;
        if (glow) c.ellipse(ox, oy, L(2 + glow), L(2 + glow), withA(orb[3], 110));
        c.shadedEllipse(ox, oy, L(2), L(2), orb);
      }
      break;
    }
    case "bow": {
      const px = -dy, py = dx;
      const cx = hx + dx * L(1), cy = hy + dy * L(1);
      const pull = glow; // натяжение тетивы 0..3
      let prev: [number, number] | null = null;
      for (let t = -1; t <= 1.001; t += 0.1) {
        const x = cx + px * t * L(6) + dx * (1 - t * t) * L(2.5), y = cy + py * t * L(6) + dy * (1 - t * t) * L(2.5);
        if (prev) c.line(prev[0], prev[1], x, y, P.wood[2], Math.max(1, k));
        prev = [x, y];
      }
      const ax = cx + px * L(6), ay = cy + py * L(6), bx = cx - px * L(6), by = cy - py * L(6);
      const mx = cx - dx * L(pull), my = cy - dy * L(pull);
      c.line(ax, ay, mx, my, hex("#e8e4d8"), 1);
      c.line(bx, by, mx, my, hex("#e8e4d8"), 1);
      if (pull > 0) {
        c.line(mx, my, mx + dx * L(9), my + dy * L(9), P.wood[3], 1);
        c.set(Math.round(mx + dx * L(9)), Math.round(my + dy * L(9)), P.steel[4]);
      }
      break;
    }
    case "claws":
    case "none":
      break;
  }
}

// ---------------- гуманоид ----------------
export function drawHumanoid(spec: HSpec, view: View, pose: Pose, k = 1): PC {
  const W = 32 * k;
  const c = new PC(W, W);
  const L = (n: number) => n * k;
  const legLen = spec.legLen ?? 6;
  const bw = spec.bodyW ?? 10;
  const headR = spec.headR ?? 6;
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const hover = spec.hover ? [0, -1, -2, -1][walk] - 2 : 0;
  const bob = spec.hover ? hover : [0, -1, 0, -1][walk];
  const G = 30;
  const hip = G - legLen + bob;
  const tTop = hip - 8;
  const hy = tTop - 5 + (spec.hover ? 0 : 0);
  const cx = 16;
  const F = view === "down" ? 90 * DEG : view === "up" ? -90 * DEG : 0;
  const lean = atk === 1 || atk === 2 ? 1 : 0;
  const lx = view === "side" ? lean : 0, ly = view === "down" ? lean : view === "up" ? -lean : 0;

  // базовый цвет одежды
  const torso = spec.torso, legs = spec.legs, boots = spec.boots;
  const weapon = spec.weapon ?? "none";

  // углы оружия по кадрам атаки
  let wAng: number, wGlow = 0;
  const melee = weapon === "sword" || weapon === "axe" || weapon === "dagger" || weapon === "flamesword";
  if (melee) wAng = atk >= 0 ? F + [-135, -45, 45, -20][atk] * DEG : view === "side" ? -60 * DEG : view === "down" ? -70 * DEG : -110 * DEG;
  else if (weapon === "bow") { wAng = view === "side" ? 0 : F; if (atk >= 0) wGlow = [2, 3, 0, 0][atk]; if (view !== "side" && atk < 0) wAng = view === "down" ? 90 * DEG : -90 * DEG; }
  else { wAng = atk >= 0 ? [-90, F * 0.5 - 45 * DEG, F * 0.5 - 30 * DEG, -80][atk] : -90 * DEG; if (atk >= 0) { wAng = [-95 * DEG, -70 * DEG + F * 0.25, -60 * DEG + F * 0.3, -85 * DEG][atk]; wGlow = [1, 2, 3, 0][atk]; } }

  // рука с оружием
  const armSwing = pose.kind === "walk" ? [0, 1, 0, -1][walk] : 0;
  const handFwd = atk === 1 || atk === 2 ? 2 : 0;
  let hand: [number, number];
  if (view === "side") hand = [cx + 2 + armSwing + handFwd, tTop + 6];
  else hand = [view === "down" ? cx + bw / 2 + 1.5 : cx - bw / 2 - 1.5, tTop + 6 + (view === "down" ? handFwd * 0.5 : -handFwd * 0.5)];
  if (weapon === "bow" && view !== "side") hand = [cx + (view === "down" ? 5 : -5), tTop + 5];
  if ((weapon === "staff" || weapon === "skullstaff") && atk >= 0) hand = [hand[0], hand[1] - [2, 1, 1, 0][atk]];

  const drawW = () => drawWeapon(c, weapon, L(hand[0] + lx), L(hand[1] + ly), wAng, k, spec, wGlow);

  // ---- сзади ----
  if (spec.wings) {
    const wf = [0, 2, 3, 1][walk];
    for (const s of [-1, 1]) {
      const bx = cx + s * 2, by = tTop + 2;
      c.poly([[L(bx), L(by)], [L(bx + s * (9 + wf)), L(by - 6 + wf)], [L(bx + s * 8), L(by + 2)], [L(bx + s * 5), L(by + 5)]], spec.wings[1]);
      c.line(L(bx), L(by), L(bx + s * (9 + wf)), L(by - 6 + wf), spec.wings[2], k);
    }
  }
  if (spec.cape && view !== "up") c.shadedRect(L(cx - bw / 2 + 0.5), L(tTop + 1), L(bw - 1), L(9 + (spec.hover ? 0 : 0)), spec.cape.map((x) => shade(x, 0.8)));
  if (view === "up" && (melee || weapon === "staff" || weapon === "skullstaff")) drawW();
  if (view === "up" && spec.shield) c.shadedEllipse(L(cx + bw / 2 + 1), L(tTop + 5), L(3.5), L(4), spec.shield);
  if (view === "side" && spec.tail) c.line(L(cx - 3), L(hip - 1), L(cx - 9), L(hip - 4 + armSwing), spec.tail[1], Math.max(1, k));

  // ---- ноги ----
  if (!spec.robe || spec.hover) {
    if (!spec.hover || view !== "up") {
      if (view === "side") {
        const sw = [0, 2.5, 0, -2.5][walk] + (atk === 1 || atk === 2 ? 1.5 : 0);
        for (const [s, dark] of [[-1, true], [1, false]] as [number, boolean][]) {
          const fx = cx + s * sw;
          const col = dark ? shade(legs[1], 0.8) : legs[2];
          c.line(L(cx), L(hip + 0.5), L(fx), L(G - 1.5 + (spec.hover ? hover : 0)), col, Math.max(3, 3 * k));
          c.rect(L(fx - 1.5), L(G - 2 + (spec.hover ? hover : 0)), L(4), L(2), dark ? shade(boots[1], 0.8) : boots[2]);
        }
      } else {
        for (const s of [-1, 1]) {
          const lift = (walk === 1 && s === -1) || (walk === 3 && s === 1) ? 1.5 : 0;
          const x = cx + s * 2 - 1.5;
          c.shadedRect(L(x), L(hip), L(3), L(legLen - 1 - lift - bob + (spec.hover ? hover : 0)), legs);
          c.shadedRect(L(x - 0.25), L(G - 2.5 - lift + (spec.hover ? hover : 0)), L(3.5), L(2.5), boots);
        }
      }
    }
  }

  // ---- туловище ----
  const tw = view === "side" ? bw - 3 : bw;
  if (spec.robe) {
    const rb = spec.robe;
    const bottom = G - 1 + (spec.hover ? hover : 0);
    const flare = view === "side" ? 2 : 2.5;
    const sway = pose.kind === "walk" ? [0, 0.6, 0, -0.6][walk] : 0;
    c.poly(
      [[L(cx - tw / 2 + lx), L(tTop + ly)], [L(cx + tw / 2 + lx), L(tTop + ly)], [L(cx + tw / 2 + flare + sway), L(bottom)], [L(cx - tw / 2 - flare + sway), L(bottom)]],
      (x, y) => {
        const u = (x / k - (cx - tw / 2 - flare)) / (tw + flare * 2);
        const v = (y / k - tTop) / (bottom - tTop);
        const idx = u < 0.18 ? 3 : u > 0.82 ? 0 : v > 0.85 ? 1 : 2;
        return rb[idx];
      },
    );
    // подол и ступни
    c.line(L(cx - tw / 2 - flare + sway), L(bottom) - 1, L(cx + tw / 2 + flare + sway), L(bottom) - 1, rb[0], k);
    if (!spec.hover) for (const s of [-1, 1]) c.rect(L(cx + s * 2 - 1.5 + (view === "side" ? [0, 1.5, 0, -1.5][walk] * s : 0)), L(G - 1), L(3), L(1), boots[1]);
  }
  c.shadedRect(L(cx - tw / 2 + lx), L(tTop + ly), L(tw), L(8.5), torso, 0);
  if (spec.ribs) for (let r = 0; r < 3; r++) c.rect(L(cx - tw / 2 + 2 + lx), L(tTop + 2 + r * 2 + ly), L(tw - 4), Math.max(1, k), withA(P.bone[0], 255));
  if (spec.armorPlates) {
    c.shadedRect(L(cx - tw / 2 + lx), L(tTop + ly), L(tw), L(5), spec.armorPlates, 1);
    if (view !== "side") c.rect(L(cx - 0.5 + lx), L(tTop + 1 + ly), L(1), L(4), spec.armorPlates[3]);
  }
  if (spec.lavaCracks) for (const [a, b] of [[2, 3], [5, 5], [7, 2]]) c.line(L(cx - tw / 2 + a + lx), L(tTop + b + ly), L(cx - tw / 2 + a + 2 + lx), L(tTop + b + 2 + ly), P.magic.fire[3], k);
  if (spec.apron && view !== "up") c.shadedRect(L(cx - tw / 2 + 1.5 + lx), L(tTop + 3 + ly), L(tw - 3), L(7), spec.apron, 1);
  if (spec.belt) c.rect(L(cx - tw / 2 + lx), L(tTop + 6 + ly), L(tw), L(1.5), spec.belt[1]);
  if (spec.belt && view === "down") c.rect(L(cx - 1 + lx), L(tTop + 6 + ly), L(2), L(1.5), P.gold[3]);
  if (spec.cape && view === "up") c.shadedRect(L(cx - bw / 2 - 0.5), L(tTop), L(bw + 1), L(10 + (spec.robe ? 4 : 0)), spec.cape);
  if (spec.quiver && view === "up") {
    c.shadedRect(L(cx + 1), L(tTop - 1), L(3), L(8), P.leather);
    for (let i = 0; i < 3; i++) c.rect(L(cx + 1.5 + i), L(tTop - 3), L(1), L(2), i % 2 ? P.cloth.red[2] : hex("#e8e4d8"));
  }

  // ---- руки ----
  const arm = (x: number, y: number, len: number, back = false) => {
    const r = back ? torso.map((q) => shade(q, 0.75)) : torso;
    c.shadedRect(L(x - 1.25), L(y), L(2.5), L(len), r, 1);
    if (spec.weapon === "claws") {
      c.rect(L(x - 1.25), L(y + len), L(2.5), L(1.5), spec.skin[2]);
      c.set(L(x - 1.5), L(y + len + 2), P.bone[3]);
      c.set(L(x + 1), L(y + len + 2), P.bone[3]);
    } else c.shadedEllipse(L(x), L(y + len + 0.5), L(1.4), L(1.4), spec.skin, undefined, false);
  };
  if (view === "side") {
    arm(cx - 1 - armSwing + lx, tTop + 1 + ly, 5, true);
  } else {
    const ay = tTop + 1 + ly;
    arm(cx - bw / 2 - 1.2, ay + (view === "down" ? armSwing : -armSwing) * 0.5, 5);
    if (!(view === "down" && melee) && !(weapon === "bow")) arm(cx + bw / 2 + 1.2, ay - (view === "down" ? armSwing : -armSwing) * 0.5, 5);
    else arm(hand[0], hand[1] - 5 + ly, 4.5);
    if (weapon === "bow") arm(cx + bw / 2 + 1.2, ay, 4.5);
  }
  if (spec.shield && view === "down") c.shadedEllipse(L(cx - bw / 2 - 1.5), L(tTop + 5 + ly), L(3.5), L(4), spec.shield);
  if (view !== "up") drawW();
  if (view === "side") {
    arm(hand[0] - 0.5 + lx, tTop + 1 + ly, Math.max(3, hand[1] - tTop - 2), false);
    if (spec.shield) c.shadedEllipse(L(cx - 2 + lx), L(tTop + 4 + ly), L(2), L(4), spec.shield);
  }

  // ---- голова ----
  const hcx = cx + (view === "side" ? 0.5 + lx : 0) + (spec.hair === P.hair.seaweed && view === "side" ? 1 : 0);
  const hcy = hy + ly;
  if (spec.ears) for (const s of view === "side" ? [-1] : [-1, 1]) c.poly([[L(hcx + s * (headR - 1)), L(hcy - 1)], [L(hcx + s * (headR + 3)), L(hcy - 3)], [L(hcx + s * (headR - 1)), L(hcy + 1.5)]], spec.skin[2]);
  c.shadedEllipse(L(hcx), L(hcy), L(headR), L(headR * 0.93), spec.skin, undefined, false);

  // волосы под головным убором
  const hair = spec.hair;
  if (hair && spec.hairStyle !== "none") {
    if (view === "up") c.shadedEllipse(L(hcx), L(hcy - 0.5), L(headR + 0.3), L(headR * 0.95), hair);
    else if (view === "down") {
      c.poly([[L(hcx - headR - 0.3), L(hcy)], [L(hcx - headR + 1), L(hcy - headR + 0.5)], [L(hcx + headR - 1), L(hcy - headR + 0.5)], [L(hcx + headR + 0.3), L(hcy)], [L(hcx + headR - 1.5), L(hcy - 2.5)], [L(hcx - headR + 1.5), L(hcy - 2.5)]], hair[2]);
      c.shadedEllipse(L(hcx), L(hcy - headR * 0.55), L(headR * 0.95), L(headR * 0.5), hair);
      if (spec.hairStyle === "long") for (const s of [-1, 1]) c.shadedRect(L(hcx + s * (headR - 0.5) - 1), L(hcy - 1), L(2), L(7), hair, 1);
    } else {
      c.shadedEllipse(L(hcx - 1.5), L(hcy - 1.2), L(headR - 0.5), L(headR * 0.85), hair);
      if (spec.hairStyle === "long") c.shadedRect(L(hcx - headR), L(hcy - 1), L(3), L(7), hair, 1);
    }
    if (spec.hairStyle === "wild" && view !== "up") for (let i = -2; i <= 2; i++) c.line(L(hcx + i * 2), L(hcy - headR), L(hcx + i * 2.6), L(hcy - headR - 2), hair[2], k);
  }
  // лицо
  const eye = spec.eye ?? hex("#2a1a24");
  const eyeY = hcy + 0.5;
  if (view === "down") {
    for (const s of [-1, 1]) {
      c.rect(L(hcx + s * 2.5 - 0.5), L(eyeY), Math.max(1, k), L(spec.glowEyes ? 1 : 2), eye);
      if (spec.glowEyes) c.rect(L(hcx + s * 2.5 - 0.5) - k, L(eyeY), 3 * k, k, withA(eye, 90));
    }
    if (spec.beard) {
      c.shadedEllipse(L(hcx), L(hcy + headR * 0.78), L(headR * 0.55), L(headR * 0.38), spec.beard);
      c.rect(L(hcx - 1.5), L(eyeY + 2), L(3), Math.max(1, k), spec.beard[1]);
    } else if (!spec.ribs && !spec.glowEyes) c.set(L(hcx + 0.5), L(eyeY + 2.5), shade(spec.skin[1], 0.9));
  } else if (view === "side") {
    c.rect(L(hcx + 3), L(eyeY), Math.max(1, k), L(spec.glowEyes ? 1 : 2), eye);
    if (spec.beard) c.shadedEllipse(L(hcx + 2.5), L(hcy + headR * 0.6), L(headR * 0.5), L(headR * 0.4), spec.beard);
    c.set(L(hcx + headR), L(eyeY + 1), spec.skin[2]);
  }

  // головные уборы
  const hr = spec.headRamp ?? P.steel;
  switch (spec.head) {
    case "helmet":
    case "darkhelm": {
      const open = spec.head === "helmet" && view !== "up";
      c.shadedEllipse(L(hcx), L(hcy - 1.2), L(headR + 0.6), L(headR * 0.8), hr, undefined, true, open ? L(eyeY - 0.5) : Infinity);
      if (open) for (const s of view === "side" ? [-1] : [-1, 1]) c.shadedRect(L(hcx + s * (headR - 0.4) - 1), L(eyeY - 1), L(2), L(4), hr, 0);
      if (spec.head === "darkhelm" && view !== "up") {
        const ex = view === "side" ? [hcx + 3] : [hcx - 2.5, hcx + 2.5];
        c.rect(L(hcx - headR + 1.5), L(eyeY - 0.5), L(headR * 2 - 3), Math.max(1, k), hex("#0c0a10"));
        for (const x of ex) { c.rect(L(x - 0.5), L(eyeY - 0.5), Math.max(1, k * 1.5), Math.max(1, k), eye); }
      }
      if (view === "down") {
        c.rect(L(hcx - headR + 1), L(eyeY - 1.2), L(headR * 2 - 2), L(1), hr[1]);
        if (!open) c.rect(L(hcx - 0.5), L(hcy - 1), L(1), L(3.5), hr[3]);
        if (spec.head === "darkhelm") for (const s of [-1, 1]) c.poly([[L(hcx + s * 4), L(hcy - 4)], [L(hcx + s * 8), L(hcy - 9)], [L(hcx + s * 5.5), L(hcy - 3)]], P.bone[2]);
      } else if (view === "side") {
        c.rect(L(hcx - headR + 1), L(eyeY - 1.2), L(headR * 2 - 1), L(1), hr[1]);
        if (spec.head === "darkhelm") c.poly([[L(hcx + 1), L(hcy - 4)], [L(hcx + 4), L(hcy - 10)], [L(hcx + 3.5), L(hcy - 3)]], P.bone[2]);
      } else if (spec.head === "darkhelm") for (const s of [-1, 1]) c.poly([[L(hcx + s * 4), L(hcy - 4)], [L(hcx + s * 8), L(hcy - 9)], [L(hcx + s * 5.5), L(hcy - 3)]], P.bone[2]);
      if (spec.head === "helmet" && spec.plume) {
        const sx = view === "side" ? -2.2 : 0;
        c.shadedEllipse(L(hcx + sx), L(hcy - headR - 1.6), L(view === "side" ? 2.6 : 1.7), L(3), spec.plume);
        if (view === "side") c.shadedEllipse(L(hcx - 4), L(hcy - headR + 0.4), L(2), L(1.4), spec.plume);
      } else if (spec.head === "helmet" && view !== "side") c.rect(L(hcx - 0.5), L(hcy - headR - 1.5), L(1), L(2), P.cloth.red[2]);
      break;
    }
    case "hat":
    case "witchhat": {
      const big = spec.head === "witchhat" ? 1.3 : 1;
      c.shadedEllipse(L(hcx), L(hcy - headR * 0.55), L((headR + 2.5) * big), L(1.8 * big), hr);
      const tip = view === "side" ? -4 : view === "up" ? 2 : 3;
      c.poly([[L(hcx - headR * 0.75 * big), L(hcy - headR * 0.6)], [L(hcx + headR * 0.75 * big), L(hcy - headR * 0.6)], [L(hcx + tip), L(hcy - headR - 7 * big)]], (x) => hr[x / k < hcx ? 3 : 2]);
      c.rect(L(hcx - headR * 0.72 * big), L(hcy - headR * 0.9), L(headR * 1.44 * big), L(1.2), P.gold[3]);
      break;
    }
    case "hood": {
      if (view === "up") c.shadedEllipse(L(hcx), L(hcy - 0.3), L(headR + 0.8), L(headR + 0.3), hr);
      else if (view === "down") {
        c.poly([[L(hcx - headR - 0.8), L(hcy + 2)], [L(hcx - headR), L(hcy - headR + 1)], [L(hcx), L(hcy - headR - 1.5)], [L(hcx + headR), L(hcy - headR + 1)], [L(hcx + headR + 0.8), L(hcy + 2)], [L(hcx + headR - 1.5), L(hcy + 1)], [L(hcx + headR - 2), L(hcy - 2.5)], [L(hcx - headR + 2), L(hcy - 2.5)], [L(hcx - headR + 1.5), L(hcy + 1)]], (x) => hr[x / k < hcx - 2 ? 3 : x / k > hcx + 2 ? 1 : 2]);
      } else {
        c.poly([[L(hcx - headR - 0.8), L(hcy + 3)], [L(hcx - headR + 0.5), L(hcy - headR + 0.5)], [L(hcx + 1), L(hcy - headR - 1.2)], [L(hcx + headR), L(hcy - headR + 2)], [L(hcx + 1.5), L(hcy - 2)], [L(hcx - 1), L(hcy + 3)]], (x) => hr[x / k < hcx - 2 ? 3 : 2]);
      }
      break;
    }
    case "horns":
      for (const s of view === "side" ? [1] : [-1, 1]) c.poly([[L(hcx + s * 2.5), L(hcy - headR + 1.5)], [L(hcx + s * 5.5), L(hcy - headR - 4)], [L(hcx + s * 4.5), L(hcy - headR + 2)]], P.bone[2]);
      break;
    case "feathers":
      for (let i = -2; i <= 2; i++) c.line(L(hcx + i * 1.6), L(hcy - headR + 1), L(hcx + i * 2.8), L(hcy - headR - 5 + Math.abs(i)), [P.cloth.red[2], P.gold[3], P.cloth.blue[3], P.gold[3], P.cloth.red[2]][i + 2], Math.max(1, k));
      c.shadedEllipse(L(hcx), L(hcy - headR + 1.5), L(headR * 0.85), L(2), P.bone);
      break;
    case "cap":
      c.shadedEllipse(L(hcx), L(hcy - headR * 0.6), L(headR * 0.95), L(headR * 0.5), hr);
      if (view === "down") c.rect(L(hcx - headR + 1), L(hcy - headR * 0.3), L(headR * 2 - 2), L(1), hr[0]);
      break;
  }
  return c;
}

// ---------------- монстры без рук и ног ----------------
function slime(body: Ramp, pose: Pose, k = 1, bubbles = false): PC {
  const c = new PC(32 * k, 32 * k);
  const L = (n: number) => n * k;
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  let sx = [1, 1.08, 1, 0.92][walk], sy = [1, 0.86, 1, 1.12][walk], fx = 0;
  if (atk >= 0) { sx = [0.85, 1.25, 1.1, 1][atk]; sy = [1.2, 0.8, 0.9, 1][atk]; fx = [-1, 3, 2, 0][atk]; }
  const rx = 9 * sx, ry = 7.5 * sy;
  const cx = 16 + fx, cy = 29 - ry;
  c.shadedEllipse(L(cx), L(cy), L(rx), L(ry), body);
  c.ellipse(L(cx), L(29 - 1.2), L(rx * 0.95), L(1.4), withA(body[0], 255));
  c.ellipse(L(cx - rx * 0.4), L(cy - ry * 0.45), L(2), L(1.2), withA(hex("#ffffff"), 200));
  for (const s of [-1, 1]) {
    c.rect(L(cx + 2.5 + s * 2.2 - 0.5), L(cy - 1), L(1.5), L(2.5), hex("#1b1422"));
    c.set(L(cx + 2.5 + s * 2.2), L(cy - 1), hex("#ffffff"));
  }
  if (bubbles) for (const [bx, by] of [[-3, 2], [1, 3.5], [-5, -1]]) c.ellipse(L(cx + bx), L(cy + by), L(1), L(1), withA(body[3], 220));
  return c.outline();
}

function quadruped(o: { body: Ramp; belly?: Ramp; tusk?: boolean; ears?: "point" | "round"; snout?: Ramp; tail?: "bushy" | "thin"; mane?: Ramp }, pose: Pose): PC {
  const c = new PC(32, 32);
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const lunge = atk >= 0 ? [-1.5, 3, 2, 0.5][atk] : 0;
  const bob = [0, -1, 0, -1][walk];
  const bx = 14 + lunge * 0.4, by = 19 + bob;
  const legPh = [0, 2, 0, -2][walk];
  const legs: [number, number, boolean][] = [[bx - 5, -legPh, true], [bx + 4, legPh, true], [bx - 4, legPh, false], [bx + 5, -legPh, false]];
  for (const [lx, sw, back] of legs) {
    const col = back ? shade(o.body[1], 0.7) : o.body[1];
    c.line(lx, by + 3, lx + sw * 0.6, 28.5, col, 2.2);
    c.rect(lx + sw * 0.6 - 1, 28, 2.5, 1.5, shade(o.body[0], 0.8));
  }
  if (o.tail === "bushy") c.line(bx - 8, by - 1, bx - 12, by - 4 + bob, o.body[2], 2.5);
  else c.line(bx - 8, by - 1, bx - 11, by + 1 + bob, o.body[1], 1);
  c.shadedEllipse(bx, by, 8.5, 5.2, o.body);
  if (o.mane) c.shadedEllipse(bx + 4, by - 3, 4.5, 3.5, o.mane);
  if (o.belly) c.ellipse(bx, by + 3.2, 6, 1.4, o.belly[2]);
  const hx = bx + 8.5 + lunge * 0.6, hy = by - 2 + (atk === 1 ? 1 : 0);
  c.shadedEllipse(hx, hy, 4.5, 4, o.body);
  const sn = o.snout ?? o.body;
  c.shadedEllipse(hx + 3.5, hy + 1.2, 2.6, 2, sn, undefined, false);
  c.set(Math.round(hx + 5.5), Math.round(hy + 0.5), hex("#1b1422"));
  if (o.ears === "point") c.poly([[hx - 2.5, hy - 2.5], [hx - 1, hy - 7.5], [hx + 1, hy - 3]], o.body[2]);
  else c.ellipse(hx - 1.5, hy - 3.5, 1.6, 1.6, o.body[1]);
  c.rect(Math.round(hx + 1), Math.round(hy - 1), 1, 1, atk >= 1 && atk <= 2 ? hex("#ff4030") : hex("#1b1422"));
  if (o.tusk) c.line(hx + 4, hy + 2.8, hx + 5.5, hy + 0.5, P.bone[3], 1);
  if (atk === 1 || atk === 2) c.line(hx + 3, hy + 3, hx + 5, hy + 3.5, hex("#f2ecdf"), 1);
  return c.outline();
}

function spider(pose: Pose, bodyR: Ramp = P.cloth.purple, mark: RGBA = P.cloth.red[2], eye: RGBA = hex("#ff3040"), tail = false): PC {
  const c = new PC(32, 32);
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const lunge = atk >= 0 ? [-1, 3, 2, 0][atk] : 0;
  const body = ramp4(bodyR);
  const bx = 13 + lunge * 0.5, by = 20;
  for (let i = 0; i < 4; i++) {
    const ph = ((walk + i) % 2 ? 1.5 : -1.5) * (pose.kind === "walk" ? 1 : 0.3);
    for (const back of [true, false]) {
      const ox = bx + 3 + i * 2 - 3, kx = ox + (back ? -3 : 3) + ph, ky = by - 5 - (back ? 0 : 1);
      const col = back ? shade(body[0], 0.8) : body[1];
      c.line(ox, by, kx, ky, col, 1);
      c.line(kx, ky, kx + (back ? -2 : 2) + ph * 0.5, 28.5, col, 1);
    }
  }
  c.shadedEllipse(bx - 2, by - 1, 6.5, 5.5, body);
  c.line(bx - 4, by - 4, bx - 1, by - 5, mark, 1);
  c.line(bx - 4, by - 2, bx, by - 2, mark, 1);
  if (tail) {
    // изогнутый хвост с жалом
    for (let t = 0; t <= 1; t += 0.1) c.rect(bx - 8 - t * 3, by - 3 - Math.sin(t * Math.PI * 0.9) * 10, 2, 2, body[2]);
    c.poly([[bx - 12, by - 12], [bx - 9, by - 13], [bx - 10, by - 8]], mark);
  }
  c.shadedEllipse(bx + 5.5 + lunge * 0.5, by + 1, 3.8, 3.2, body);
  for (const [ex, ey] of [[7, 0], [8.5, 0.5], [7.5, 1.6]]) c.set(Math.round(bx + ex + lunge * 0.5), Math.round(by + ey), eye);
  if (atk === 1 || atk === 2) c.line(bx + 8 + lunge, by + 3, bx + 9.5 + lunge, by + 4.5, P.bone[3], 1);
  return c.outline();
}
const ramp4 = (r: Ramp) => r;

function golem(pose: Pose, k = 1, stone: Ramp = P.stone, vein: Ramp = P.lava): PC {
  const c = new PC(32 * k, 32 * k);
  const L = (n: number) => n * k;
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const bob = [0, -1, 0, -1][walk];
  const armUp = atk >= 0 ? [-6, -8, 2, 0][atk] : [0, 1, 0, -1][walk];
  for (const s of [-1, 1]) {
    const lift = (walk === 1 && s < 0) || (walk === 3 && s > 0) ? 1 : 0;
    c.shadedRect(L(16 + s * 4 - 2.5), L(23 + bob - lift), L(5), L(7 - bob + lift - lift), stone, 1);
  }
  c.shadedEllipse(L(16), L(17 + bob), L(9.5), L(7.5), stone);
  for (const [a, b, d, e] of [[11, 14, 14, 18], [18, 13, 20, 19], [14, 20, 18, 21]]) c.line(L(a), L(b + bob), L(d), L(e + bob), vein[3], k);
  c.shadedEllipse(L(16), L(8.5 + bob), L(4.5), L(3.8), stone);
  for (const s of [-1, 1]) c.rect(L(16 + s * 1.8 - 0.5), L(8.5 + bob), L(1.2), L(1), vein[4]);
  for (const s of [-1, 1]) {
    const ax = 16 + s * 10.5, ay = 14 + bob + (s > 0 ? armUp : -armUp * 0.3);
    c.shadedEllipse(L(ax), L(ay), L(3.5), L(5), stone);
    c.shadedEllipse(L(ax + s * 0.5), L(ay + 5), L(3.2), L(3), shadeRamp(stone, 0.85));
  }
  return c.outline();
}
const shadeRamp = (r: Ramp, k: number) => r.map((x) => shade(x, k));

function sapling(pose: Pose): PC {
  const c = new PC(32, 32);
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const bob = [0, -1, 0, -1][walk];
  const lean = atk >= 0 ? [-1, 2, 2, 0][atk] : 0;
  for (const s of [-1, 1]) c.line(16 + s * 2, 25 + bob, 16 + s * (4 + (walk % 2 ? s : 0)), 29, P.bark[2], 2);
  c.shadedRect(12 + lean * 0.5, 15 + bob, 8, 11, P.bark, 2);
  c.rect(14 + lean * 0.5, 19 + bob, 1, 2, hex("#f0e060"));
  c.rect(18 + lean * 0.5, 19 + bob, 1, 2, hex("#f0e060"));
  c.shadedEllipse(16 + lean, 11 + bob, 7.5, 5.5, P.leaf);
  c.shadedEllipse(12 + lean, 9 + bob, 3.5, 3, P.leaf);
  c.shadedEllipse(20 + lean, 8.5 + bob, 3.5, 3, P.leaf);
  for (const s of [-1, 1]) c.line(16 + s * 4, 18 + bob, 16 + s * 7 + lean, 20 + bob - (atk === 1 ? 3 : 0), P.bark[2], 1.5);
  return c.outline();
}

// ---------------- боссы 64×64 ----------------
function ent(pose: Pose): PC {
  const c = new PC(64, 64);
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const bob = [0, -1, 0, -1][walk];
  const slam = atk >= 0 ? [-10, -14, 6, 2][atk] : [0, 1, 0, -1][walk];
  // корни-ноги
  for (const s of [-1, 1]) {
    const lift = (walk === 1 && s < 0) || (walk === 3 && s > 0) ? 2 : 0;
    c.line(32 + s * 5, 48 + bob, 32 + s * 10, 61 - lift, P.bark[1], 5);
    c.line(32 + s * 10, 61 - lift, 32 + s * 14, 62, P.bark[1], 3);
  }
  // ствол
  c.poly([[22, 50 + bob], [42, 50 + bob], [40, 20 + bob], [24, 20 + bob]], (x, y) => {
    const u = (x - 22) / 20;
    const groove = Math.abs(((x + Math.floor(y / 6)) % 5) - 2) < 0.6;
    return groove ? P.bark[0] : P.bark[u < 0.25 ? 3 : u > 0.75 ? 1 : 2];
  });
  // лицо
  c.ellipse(28, 30 + bob, 2.2, 1.6, hex("#20140c"));
  c.ellipse(36, 30 + bob, 2.2, 1.6, hex("#20140c"));
  c.rect(27, 30 + bob, 2, 1, hex("#ffe060"));
  c.rect(35, 30 + bob, 2, 1, hex("#ffe060"));
  c.poly([[27, 38 + bob], [37, 38 + bob], [35, 41 + bob], [29, 41 + bob]], hex("#20140c"));
  c.line(29, 26 + bob, 31, 27 + bob, P.bark[0], 1);
  c.line(35, 26 + bob, 33, 27 + bob, P.bark[0], 1);
  // руки-ветви
  for (const s of [-1, 1]) {
    const ay = 28 + bob + (s > 0 ? slam : slam * 0.4);
    c.line(32 + s * 8, 26 + bob, 32 + s * 18, ay, P.bark[2], 4);
    c.line(32 + s * 18, ay, 32 + s * 22, ay + 8, P.bark[1], 3);
    c.shadedEllipse(32 + s * 22, ay + 9, 4, 3.5, P.leaf);
  }
  // крона
  for (const [x, y, rx, ry] of [[32, 14, 15, 10], [21, 18, 8, 6], [43, 18, 8, 6], [26, 8, 7, 6], [39, 8, 7, 6], [32, 4, 6, 4.5]]) c.shadedEllipse(x, y + bob, rx, ry, P.leaf);
  for (const [x, y] of [[24, 10], [38, 6], [30, 16], [44, 16], [20, 18]]) c.rect(x, y + bob, 2, 1, P.leaf[4]);
  for (const [x, y] of [[27, 13], [40, 12], [34, 19]]) c.ellipse(x, y + bob, 1.2, 1.2, hex("#e04848"));
  return c.outline();
}

const SPECS: Record<string, HSpec> = {
  warrior: {
    skin: P.skin, hair: P.hair.brown, hairStyle: "short", torso: P.cloth.red, legs: P.cloth.brown, boots: P.leather, belt: P.leather,
    head: "helmet", headRamp: P.steel, weapon: "sword", shield: P.wood, armorPlates: P.steel,
  },
  mage: {
    skin: P.skin, hair: P.hair.white, hairStyle: "long", torso: P.cloth.purple, legs: P.cloth.purple, boots: P.cloth.black, robe: P.cloth.purple,
    head: "hat", headRamp: P.cloth.purple, weapon: "staff", orb: P.magic.blue, belt: P.gold, beard: P.hair.white,
  },
  healer: {
    skin: P.skin, hair: P.hair.blond, hairStyle: "long", torso: P.cloth.white, legs: P.cloth.white, boots: P.leather, robe: P.cloth.white,
    head: "hood", headRamp: P.cloth.white, weapon: "staff", orb: P.gold, belt: P.gold, cape: P.gold,
  },
  ranger: {
    skin: P.skin, hair: P.hair.blond, hairStyle: "short", torso: P.leather, legs: P.cloth.brown, boots: P.leather, belt: P.cloth.brown,
    head: "hood", headRamp: P.cloth.green, weapon: "bow", cape: P.cloth.green, quiver: true,
  },
  rogue: {
    skin: P.skin, hair: P.hair.black, hairStyle: "short", torso: P.cloth.black, legs: P.cloth.black, boots: P.cloth.black, belt: P.leather,
    head: "hood", headRamp: P.cloth.black, weapon: "dagger", cape: P.cloth.black,
  },
  // ---------- Умбрат: нежить (бледно-зелёная кожа, тёмный металл, пурпур и ядовитая зелень, горящие глаза) ----------
  deathknight: {
    skin: ramp_("#3a4a44", "#5a6e64", "#84988a", "#b0c4b0"), hair: P.hair.white, hairStyle: "long", torso: P.darkSteel, legs: P.darkSteel, boots: P.darkSteel, belt: P.bone,
    head: "darkhelm", headRamp: P.darkSteel, weapon: "sword", shield: P.bone, armorPlates: P.darkSteel, cape: P.cloth.purple, eye: hex("#7ad8ff"), glowEyes: true,
  },
  bloodweaver: {
    skin: ramp_("#4a3a44", "#6e5866", "#9a8290", "#c4b0b8"), hair: P.hair.black, hairStyle: "long", torso: P.cloth.black, legs: P.cloth.black, boots: P.cloth.black,
    robe: ramp_("#3a0a14", "#6a1424", "#a02436", "#d04a52"), head: "hood", headRamp: ramp_("#3a0a14", "#6a1424", "#a02436", "#d04a52"), weapon: "skullstaff", orb: ramp_("#5a0a14", "#a01828", "#e0304a", "#ff8a8a", "#ffd0d0"),
    belt: P.bone, eye: hex("#ff4050"), glowEyes: true,
  },
  darkranger: {
    skin: ramp_("#3a4a44", "#5a6e64", "#84988a", "#b0c4b0"), hair: P.hair.white, hairStyle: "long", torso: P.cloth.black, legs: P.cloth.black, boots: P.leather, belt: P.cloth.purple,
    head: "hood", headRamp: P.cloth.purple, weapon: "bow", cape: P.cloth.purple, quiver: true, eye: hex("#c070ff"), glowEyes: true,
  },
  warlock: {
    skin: P.bone, torso: P.cloth.black, legs: P.cloth.black, boots: P.cloth.black, robe: P.cloth.purple, hairStyle: "none",
    head: "horns", headRamp: P.bone, weapon: "skullstaff", orb: P.magic.green, belt: P.magic.green, cape: P.cloth.black, eye: hex("#8aff5a"), glowEyes: true, ribs: true,
  },
  reaver: {
    skin: ramp_("#3e3a40", "#5e5860", "#8a8288", "#b4aab0"), hair: P.hair.black, hairStyle: "wild", torso: ramp_("#2a0e14", "#4a1820", "#6e2430", "#94404a"), legs: P.cloth.black, boots: P.darkSteel, belt: P.bone,
    head: "none", weapon: "axe", armorPlates: P.bone, eye: hex("#ff5030"), glowEyes: true,
  },
  merchant: {
    skin: P.skin, hair: P.hair.brown, hairStyle: "short", torso: P.cloth.blue, legs: P.cloth.brown, boots: P.leather, belt: P.leather,
    head: "cap", headRamp: P.cloth.red, apron: ramp_("#8a7a60", "#b8a684", "#d8c8a4", "#efe2c4"), beard: P.hair.brown, weapon: "none", bodyW: 11,
  },
  arenamaster: {
    skin: P.skin, hair: P.hair.black, hairStyle: "short", torso: P.cloth.red, legs: P.cloth.black, boots: P.leather, belt: P.gold,
    head: "helmet", headRamp: P.gold, weapon: "sword", shield: P.cloth.red, armorPlates: P.gold, cape: P.cloth.red, beard: P.hair.black,
  },
  /** Стражник Эмберхолла: латы, алый табард с золотом, шлем, меч и щит в цветах города. */
  guard: {
    skin: P.skin, hair: P.hair.brown, hairStyle: "short", torso: ramp_("#7a1620", "#b02a30", "#e0463c", "#ff7a58"), legs: P.steel, boots: P.darkSteel, belt: P.gold,
    head: "helmet", headRamp: P.steel, plume: ramp_("#8a1020", "#c82030", "#f04a48", "#ff9a88"), weapon: "sword", shield: ramp_("#6a4210", "#a8681c", "#e0a630", "#ffd864"), armorPlates: P.steel, cape: P.cloth.red, beard: P.hair.brown,
  },
  /** Стражи малых городов: тот же силуэт, цвета оазиса (песочный табард, бирюза) и долины (синий табард, мех). */
  guard_desert: {
    skin: P.skin, hair: P.hair.black, hairStyle: "short", torso: ramp_("#9a5c10", "#d89028", "#ffbe48", "#ffe088"), legs: P.cloth.brown, boots: P.leather, belt: P.cloth.green,
    head: "helmet", headRamp: P.gold, plume: ramp_("#1a5a58", "#2a9a90", "#50d0c0", "#a0f0e0"), weapon: "sword", shield: ramp_("#1a4a48", "#2a7a74", "#46a89c", "#80d4c4"), armorPlates: P.gold, cape: ramp_("#1a4a48", "#2a7a74", "#46a89c", "#80d4c4"), beard: P.hair.black,
  },
  guard_snow: {
    skin: P.skinPale, hair: P.hair.white, hairStyle: "short", torso: ramp_("#1c3a78", "#3a68c8", "#5a94f0", "#a4cbff"), legs: P.cloth.blue, boots: P.leather, belt: P.leather,
    head: "helmet", headRamp: P.steel, plume: ramp_("#a0b4d0", "#d0def0", "#f0f6ff", "#ffffff"), weapon: "sword", shield: P.wood, armorPlates: P.steel, cape: P.cloth.white, beard: P.hair.white,
  },
  citizen_desert: {
    skin: P.skin, hair: P.hair.black, hairStyle: "short", torso: P.cloth.rag, legs: P.cloth.rag, boots: P.leather, belt: P.cloth.red,
    robe: ramp_("#8a6a30", "#b8944a", "#dcc078", "#f2dca0"), head: "hood", headRamp: ramp_("#8a6a30", "#b8944a", "#dcc078", "#f2dca0"), weapon: "none", bodyW: 10,
  },
  citizen_snow: {
    skin: P.skinPale, hair: P.hair.brown, hairStyle: "short", torso: P.cloth.brown, legs: P.cloth.brown, boots: P.leather, belt: P.leather,
    robe: ramp_("#2a3a52", "#44607e", "#6a8aae", "#a0bcd8"), head: "hood", headRamp: ramp_("#2a3a52", "#44607e", "#6a8aae", "#a0bcd8"), weapon: "none", bodyW: 10, beard: P.hair.brown,
  },
  citizen1: {
    skin: P.skin, hair: P.hair.brown, hairStyle: "long", torso: P.cloth.green, legs: P.cloth.brown, boots: P.leather, belt: P.leather,
    robe: ramp_("#3a4a22", "#56683a", "#768a52", "#98ac6e"), weapon: "none", bodyW: 10,
  },
  citizen2: {
    skin: P.skin, hair: P.hair.black, hairStyle: "short", torso: ramp_("#5a3a14", "#8a5a22", "#b07e34", "#d4a24e"), legs: P.cloth.brown, boots: P.leather, belt: P.cloth.brown,
    head: "cap", headRamp: P.cloth.blue, weapon: "none", bodyW: 10, beard: P.hair.black,
  },
  citizen3: {
    skin: P.skin, hair: P.hair.blond, hairStyle: "long", torso: P.cloth.purple, legs: P.cloth.purple, boots: P.leather, robe: ramp_("#4a2a4a", "#6e3e6a", "#94588c", "#b67aae"),
    apron: ramp_("#8a7a60", "#b8a684", "#d8c8a4", "#efe2c4"), weapon: "none", bodyW: 10,
  },
  citizen4: {
    skin: P.skin, hair: P.hair.white, hairStyle: "short", torso: P.cloth.rag, legs: P.cloth.brown, boots: P.leather, belt: P.leather,
    head: "hood", headRamp: P.cloth.brown, weapon: "none", bodyW: 11, beard: P.hair.white,
  },
  goblin: {
    skin: P.goblin, torso: P.cloth.rag, legs: P.cloth.brown, boots: P.leather, belt: P.leather, ears: true, weapon: "dagger", legLen: 5, headR: 6, bodyW: 9,
    eye: hex("#ffd040"), hairStyle: "none",
  },
  goblin_shaman: {
    skin: P.goblin, torso: P.cloth.rag, legs: P.cloth.rag, boots: P.leather, robe: P.cloth.rag, ears: true, weapon: "staff", orb: P.magic.purple, head: "feathers",
    legLen: 5, headR: 6, bodyW: 9, eye: hex("#ff6040"), hairStyle: "none",
  },
  skeleton: {
    skin: P.bone, torso: P.bone, legs: P.bone, boots: P.bone, ribs: true, weapon: "sword", eye: hex("#ff4030"), glowEyes: true, hairStyle: "none", bodyW: 8,
  },
  skeleton_knight: {
    skin: P.bone, torso: P.darkSteel, legs: P.darkSteel, boots: P.darkSteel, armorPlates: P.darkSteel, head: "darkhelm", headRamp: P.darkSteel,
    weapon: "axe", shield: P.darkSteel, eye: hex("#40c0ff"), glowEyes: true, cape: P.cloth.black,
  },
  drowned: {
    skin: P.drowned, hair: P.hair.seaweed, hairStyle: "long", torso: P.cloth.rag.map((x) => mix(x, hex("#3a5a7a"), 0.4)), legs: P.cloth.rag, boots: P.drowned,
    weapon: "claws", eye: hex("#d0ff80"), glowEyes: true,
  },
  imp: {
    skin: P.imp, torso: P.imp, legs: P.imp, boots: P.imp, head: "horns", wings: ramp_("#3a1010", "#6a1c18", "#9a2c22"), tail: P.imp, hover: true,
    weapon: "none", legLen: 4, headR: 5.5, bodyW: 8, eye: hex("#ffe040"), glowEyes: true, hairStyle: "none",
  },
  witch: {
    skin: ramp_("#3a5a3a", "#5a7e52", "#86a870", "#b0cc90"), hair: P.hair.white, hairStyle: "long", torso: P.cloth.black, legs: P.cloth.black, boots: P.cloth.black,
    robe: P.cloth.purple, head: "witchhat", headRamp: P.cloth.black, weapon: "skullstaff", hover: true, eye: hex("#c0ff40"), glowEyes: true, cape: P.cloth.purple,
  },
  ashlord: {
    skin: P.darkSteel, torso: P.darkSteel, legs: P.darkSteel, boots: P.darkSteel, armorPlates: P.darkSteel, head: "darkhelm", headRamp: P.darkSteel,
    weapon: "flamesword", cape: P.cloth.red, eye: hex("#ffa020"), glowEyes: true, lavaCracks: true, hairStyle: "none",
  },
};
function ramp_(...cs: string[]): Ramp {
  return cs.map((x) => hex(x));
}

/** Черепашка-питомец: панцирь-купол, голова и четыре лапки. */
function turtle(pose: Pose): PC {
  const c = new PC(32, 32);
  const walk = pose.kind === "walk" ? pose.i : 0;
  const atk = pose.kind === "attack" ? pose.i : -1;
  const bob = [0, -1, 0, -1][walk];
  const lunge = atk >= 0 ? [-1, 3, 2, 0][atk] : 0;
  const skin = ramp_("#3e5a2a", "#5e8438", "#86ae4c", "#b0d470");
  const shell = ramp_("#2c4a3a", "#3e6c52", "#5a9470", "#86bc98");
  const cx = 15 + lunge * 0.3, cy = 22 + bob;
  const ph = [0, 1.5, 0, -1.5][walk];
  for (const [lx, s] of [[cx - 6, ph], [cx + 3, -ph], [cx - 3, -ph], [cx + 6, ph]] as [number, number][]) c.rect(lx, 24 + Math.max(0, s * 0.5), 3, 4, skin[1]);
  c.ellipse(cx + 9 + lunge, cy - 2 + (atk === 1 ? 1 : 0), 4, 3.2, skin[2]);
  c.set(Math.round(cx + 10 + lunge), Math.round(cy - 3), hex("#14100e"));
  c.shadedEllipse(cx, cy - 1, 10, 7.5, shell);
  for (const [px, py] of [[-4, -3], [0, -4], [4, -3], [-2, 0], [2, 0]]) c.set(Math.round(cx + px), Math.round(cy + py), shell[3]);
  c.ellipse(cx - 11, cy + 2, 2.5, 1.5, skin[1]);
  return c.outline();
}

export interface UnitArt {
  frame: number;
  squashDeath?: boolean;
  draw: (view: View, pose: Pose) => PC;
}

function humanoidArt(spec: HSpec, k = 1): UnitArt {
  return { frame: 32 * k, draw: (v, p) => drawHumanoid(spec, v, p, k).outline() };
}
function sideOnly(fn: (p: Pose) => PC, frame = 32, squashDeath = true): UnitArt {
  return { frame, squashDeath, draw: (_v, p) => fn(p) };
}

/** Маунты из data/mounts.json: четвероногое без смерти, рисуется под всадником. */
const MOUNT_ART: Record<string, UnitArt> = Object.fromEntries(
  Object.values(MOUNTS).map((m) => [
    mountSprite(m.id),
    sideOnly((p) => quadruped({ body: ramp_(...m.colors), mane: ramp_(...m.mane), ears: "point", tail: m.id === "horse" ? "thin" : "bushy", snout: ramp_(...m.colors) }, p)),
  ]),
);

export const UNIT_ART: Record<string, UnitArt> = {
  ...MOUNT_ART,
  /** Питомцы (data/pets.json): волчонок, огонёк, черепашка. */
  pet_wolf: sideOnly((p) => quadruped({ body: ramp_("#5a4a34", "#86704c", "#b09468", "#d8c090"), belly: P.bone, ears: "point", tail: "bushy" }, p)),
  pet_ember: sideOnly((p) => slime(ramp_("#8a2410", "#d0501c", "#f08a2c", "#ffd060"), p, 1, true)),
  pet_turtle: sideOnly(turtle),
  warrior: humanoidArt(SPECS.warrior),
  mage: humanoidArt(SPECS.mage),
  ranger: humanoidArt(SPECS.ranger),
  healer: humanoidArt(SPECS.healer),
  rogue: humanoidArt(SPECS.rogue),
  deathknight: humanoidArt(SPECS.deathknight),
  bloodweaver: humanoidArt(SPECS.bloodweaver),
  darkranger: humanoidArt(SPECS.darkranger),
  warlock: humanoidArt(SPECS.warlock),
  reaver: humanoidArt(SPECS.reaver),
  merchant: humanoidArt(SPECS.merchant),
  arenamaster: humanoidArt(SPECS.arenamaster),
  guard: humanoidArt(SPECS.guard),
  guard_desert: humanoidArt(SPECS.guard_desert),
  guard_snow: humanoidArt(SPECS.guard_snow),
  citizen_desert: humanoidArt(SPECS.citizen_desert),
  citizen_snow: humanoidArt(SPECS.citizen_snow),
  citizen1: humanoidArt(SPECS.citizen1),
  citizen2: humanoidArt(SPECS.citizen2),
  citizen3: humanoidArt(SPECS.citizen3),
  citizen4: humanoidArt(SPECS.citizen4),
  goblin: humanoidArt(SPECS.goblin),
  goblin_shaman: humanoidArt(SPECS.goblin_shaman),
  skeleton: humanoidArt(SPECS.skeleton),
  skeleton_knight: humanoidArt(SPECS.skeleton_knight),
  drowned: humanoidArt(SPECS.drowned),
  imp: humanoidArt(SPECS.imp),
  slime: sideOnly((p) => slime(P.magic.green.slice(0, 4).map((x) => mix(x, hex("#6ad04a"), 0.3)), p)),
  toxic_slime: sideOnly((p) => slime(ramp_("#4a5a10", "#7a9a18", "#b2d030", "#e0f070"), p, 1, true)),
  boar: sideOnly((p) => quadruped({ body: ramp_("#3a2418", "#5e3c28", "#86583a", "#a87650"), tusk: true, ears: "round", snout: ramp_("#7a4a40", "#a06a5a", "#c88a78", "#e0a898"), mane: ramp_("#2a1a12", "#3e281c", "#56382a", "#6e4c38") }, p)),
  wolf: sideOnly((p) => quadruped({ body: ramp_("#3a3c48", "#5c606e", "#8a8f9c", "#b4b8c4"), belly: P.bone, ears: "point", tail: "bushy" }, p)),
  spider: sideOnly(spider),
  golem: sideOnly((p) => golem(p)),
  // биомы Неизведанных земель
  jackal: sideOnly((p) => quadruped({ body: ramp_("#5a3c1c", "#8a6030", "#c0904c", "#e8c078"), belly: P.bone, ears: "point", tail: "thin" }, p)),
  scorpion: sideOnly((p) => spider(p, ramp_("#5a3a14", "#8a5c20", "#c08a34", "#e8b858"), hex("#f2d070"), hex("#ffe040"), true)),
  frost_wolf: sideOnly((p) => quadruped({ body: ramp_("#5a7088", "#8aa4bc", "#c0d8ec", "#f0faff"), belly: P.snow, ears: "point", tail: "bushy", mane: ramp_("#8aa4bc", "#b0c8e0", "#d8ecfa", "#ffffff") }, p)),
  ice_golem: sideOnly((p) => golem(p, 1, P.ice, ramp_("#a0e0ff", "#c8f0ff", "#e0faff", "#ffffff", "#ffffff"))),
  magma_slime: sideOnly((p) => slime(ramp_("#6a1a08", "#c03a10", "#f07a1c", "#ffd060"), p, 1, true)),
  lava_hound: sideOnly((p) => quadruped({ body: ramp_("#2a1814", "#4a2418", "#7a3a20", "#a85a2c"), belly: ramp_("#c03a10", "#f06a1a", "#ff9a2a", "#ffd060"), ears: "point", tail: "bushy", mane: ramp_("#c03a10", "#f06a1a", "#ff9a2a", "#ffd060") }, p)),
  sea_crab: sideOnly((p) => spider(p, ramp_("#6a1a14", "#a8301e", "#d8503a", "#f88a6c"), hex("#ffd0c0"), hex("#101018"))),
  jellyfish: sideOnly((p) => slime(ramp_("#4a2a8a", "#7a52c8", "#b08af0", "#e8d8ff"), p, 1, true)),
  sapling: sideOnly(sapling),
  ent: sideOnly(ent, 64, false),
  witch: humanoidArt(SPECS.witch, 2),
  ashlord: humanoidArt(SPECS.ashlord, 2),
};

/** Смерть «бесформенных» мобов: сплющивание к земле и потемнение. */
function squashFrames(base: PC): PC[] {
  return [0.75, 0.5, 0.3, 0.2].map((sy, i) => {
    const out = new PC(base.w, base.h);
    const sx = 1 + (1 - sy) * 0.5;
    for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) {
      const srcX = Math.floor(base.w / 2 + (x + 0.5 - base.w / 2) / sx), srcY = Math.floor(base.h - (base.h - y - 0.5) / sy);
      const c = base.get(srcX, srcY);
      if (c && c[3]) out.set(x, y, i >= 2 ? mix(c, hex("#2a2030", c[3]), 0.2 * i) : c);
    }
    return out;
  });
}

/** Кадры смерти: поворот силуэта, падение и потемнение. */
function deathFrames(base: PC): PC[] {
  const f = base.w;
  const k = f / 32;
  const out: PC[] = [];
  const angles = [0.4, 1.0, Math.PI / 2, Math.PI / 2];
  angles.forEach((a, i) => {
    const t = a / (Math.PI / 2);
    let r = base.rotated(a, 16 * k, 29 * k, -9 * k * t, -4 * k * t);
    if (i === 3) r = r.map((c) => mix(c, hex("#2a2030", c[3]), 0.35));
    out.push(r);
  });
  return out;
}

export function buildUnitSheet(id: string): PC {
  const art = UNIT_ART[id];
  const rows: PC[][] = VIEWS.map((view) => {
    const row: PC[] = [];
    for (let i = 0; i < 4; i++) row.push(art.draw(view, { kind: "walk", i }));
    for (let i = 0; i < 4; i++) row.push(art.draw(view, { kind: "attack", i }));
    const still = art.draw(view === "up" ? "down" : view, { kind: "walk", i: 0 });
    row.push(...(art.squashDeath ? squashFrames(still) : deathFrames(still)));
    return row;
  });
  const out = new PC(art.frame * 12, art.frame * 3);
  rows.forEach((row, j) => row.forEach((fr, i) => out.blit(fr, i * art.frame, j * art.frame)));
  return out;
}

export { OUTLINE };
