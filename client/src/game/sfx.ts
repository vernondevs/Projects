/** Процедурные звуки на WebAudio (без файлов). AudioContext стартует по первому действию игрока. */
export type SfxName = "hit" | "crit" | "fire" | "frost" | "arrow" | "heal" | "shield" | "poison" | "explosion" | "slam" | "arcane" | "holy" | "shadow" | "step" | "clink" | "call" | "halt" | "bell" | "horn" | "tpgo" | "tparrive" | "tpfizzle";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volume = 0.6;
let musicVolume = 0.5;
let musicGain: GainNode | null = null;
let ambBuf: AudioBuffer | null = null;
let muted = false;
const lastPlay = new Map<string, number>();

try {
  const v = localStorage.getItem("sfxVolume");
  if (v !== null) volume = Math.min(1, Math.max(0, Number(v)));
  muted = localStorage.getItem("sfxMuted") === "1";
  const mv = localStorage.getItem("musicVolume");
  if (mv !== null) musicVolume = Math.min(1, Math.max(0, Number(mv)));
} catch {}

function ensure(): boolean {
  if (ctx) return ctx.state !== "suspended" || (void ctx.resume(), true);
  try {
    const C = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!C) return false;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = muted ? 0 : musicVolume;
    musicGain.connect(ctx.destination);
    ambBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const ad = ambBuf.getChannelData(0);
    for (let i = 0; i < ad.length; i++) ad[i] = Math.random() * 2 - 1;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch { return false; }
}

for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => { ensure(); }, { once: false, passive: true });

export function getVolume() { return volume; }
export function isMuted() { return muted; }
export function getMusicVolume() { return musicVolume; }
export function setMusicVolume(v: number) {
  musicVolume = Math.min(1, Math.max(0, v));
  if (musicGain) musicGain.gain.value = muted ? 0 : musicVolume;
  try { localStorage.setItem("musicVolume", String(musicVolume)); } catch {}
}
export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master) master.gain.value = muted ? 0 : volume;
  try { localStorage.setItem("sfxVolume", String(volume)); } catch {}
}
export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : volume;
  if (musicGain) musicGain.gain.value = muted ? 0 : musicVolume;
  try { localStorage.setItem("sfxMuted", m ? "1" : "0"); } catch {}
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, dest: AudioNode = master!) {
  const c = ctx!, t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = "lowpass", delay = 0, dest: AudioNode = master!) {
  const c = ctx!, t = c.currentTime + delay;
  const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  fl.type = type;
  fl.frequency.setValueAtTime(f0, t);
  fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl).connect(g).connect(dest);
  s.start(t);
  s.stop(t + dur + 0.02);
}

/** Голосоподобный возглас: слоги пилы через формантный фильтр. */
function voice(v: number, pitches: number[], syl: number, _n: number) {
  const c = ctx!;
  pitches.forEach((f, i) => {
    const t = c.currentTime + i * syl * 1.15;
    const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (i % 2 ? 0.85 : 1.15), t + syl);
    fl.type = "bandpass";
    fl.frequency.value = i % 2 ? 700 : 1100;
    fl.Q.value = 3;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(v * 1.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + syl);
    o.connect(fl).connect(g).connect(master!);
    o.start(t);
    o.stop(t + syl + 0.02);
  });
}

/** gain 0..1 — громкость по расстоянию/важности. Одинаковые звуки чаще раза в 50 мс не играются. */
export function play(name: SfxName, gain = 1) {
  if (muted || volume <= 0 || gain <= 0.02 || !ctx || ctx.state !== "running" || !master) return;
  const now = performance.now();
  if (now - (lastPlay.get(name) ?? 0) < 50) return;
  lastPlay.set(name, now);
  const v = 0.3 * gain;
  switch (name) {
    case "hit": noise(0.07, v, 2400, 300, "bandpass"); tone("square", 180, 60, 0.07, v * 0.5); break;
    case "crit": noise(0.12, v, 4000, 400, "bandpass"); tone("sawtooth", 420, 90, 0.14, v * 0.6); tone("triangle", 900, 1400, 0.08, v * 0.4, 0.03); break;
    case "fire": noise(0.28, v, 1800, 200, "lowpass"); tone("sawtooth", 220, 70, 0.22, v * 0.35); break;
    case "frost": tone("sine", 1800, 900, 0.18, v * 0.5); tone("sine", 2600, 1500, 0.14, v * 0.3, 0.04); noise(0.1, v * 0.4, 7000, 3000, "highpass"); break;
    case "arrow": noise(0.12, v * 0.8, 800, 4000, "bandpass"); tone("triangle", 600, 200, 0.06, v * 0.3, 0.08); break;
    case "heal": tone("sine", 520, 520, 0.18, v * 0.5); tone("sine", 780, 780, 0.22, v * 0.5, 0.08); tone("sine", 1040, 1040, 0.26, v * 0.4, 0.16); break;
    case "shield": tone("triangle", 300, 600, 0.22, v * 0.6); tone("sine", 1200, 1200, 0.3, v * 0.25, 0.05); break;
    case "poison": for (let i = 0; i < 3; i++) tone("sine", 200 + i * 60, 500 + i * 120, 0.08, v * 0.4, i * 0.06); break;
    case "explosion": noise(0.55, v * 1.4, 1200, 60, "lowpass"); tone("sine", 110, 30, 0.5, v * 0.9); break;
    case "slam": noise(0.4, v * 1.3, 600, 50, "lowpass"); tone("sine", 70, 25, 0.45, v * 1.2); break;
    case "arcane": tone("sine", 400, 1200, 0.18, v * 0.5); tone("triangle", 800, 1800, 0.14, v * 0.3, 0.04); break;
    case "holy": tone("sine", 880, 880, 0.2, v * 0.4); tone("sine", 1320, 1320, 0.25, v * 0.3, 0.06); break;
    case "step": noise(0.06, v * 0.7, 700, 180, "lowpass"); tone("sine", 120 + Math.random() * 30, 60, 0.05, v * 0.4); break;
    case "clink": tone("triangle", 2600 + Math.random() * 500, 2000, 0.07, v * 0.25); tone("square", 3900, 3000, 0.04, v * 0.12, 0.02); noise(0.05, v * 0.3, 7000, 4000, "highpass"); break;
    case "call": voice(v, [150, 190, 170], 0.14, 3); break;
    case "halt": voice(v * 1.2, [180, 230, 200, 150], 0.12, 4); break;
    case "bell": for (let i = 0; i < 4; i++) { tone("sine", 660, 640, 0.5, v * 0.7, i * 0.32); tone("sine", 1320, 1300, 0.35, v * 0.3, i * 0.32); tone("triangle", 1980, 1950, 0.2, v * 0.12, i * 0.32); } break;
    case "horn": tone("sawtooth", 196, 190, 0.7, v * 0.5); tone("sawtooth", 294, 290, 0.7, v * 0.35, 0.02); tone("sawtooth", 196, 185, 0.5, v * 0.5, 0.85); tone("sawtooth", 294, 280, 0.5, v * 0.35, 0.87); break;
    case "tpgo":
      noise(0.7, v * 1.1, 400, 7000, "bandpass"); tone("sine", 300, 2200, 0.6, v * 0.7); tone("triangle", 600, 3200, 0.5, v * 0.4, 0.05);
      for (let i = 0; i < 6; i++) tone("sine", 1400 + i * 380, 1400 + i * 380, 0.22, v * 0.25, 0.1 + i * 0.05);
      break;
    case "tparrive":
      tone("sine", 100, 38, 0.5, v * 1.0); noise(0.5, v * 0.7, 6000, 500, "bandpass");
      [880, 1320, 1760, 2640].forEach((f, i) => { tone("sine", f, f, 0.7, v * (0.5 - i * 0.07), 0.04 + i * 0.07); tone("triangle", f * 2, f * 2, 0.35, v * 0.12, 0.04 + i * 0.07); });
      break;
    case "tpfizzle": noise(0.45, v * 0.9, 3500, 250, "bandpass"); tone("sawtooth", 520, 70, 0.35, v * 0.4); tone("sine", 1600, 300, 0.25, v * 0.3); break;
    case "shadow": tone("sawtooth", 300, 80, 0.2, v * 0.4); noise(0.18, v * 0.5, 1500, 200, "bandpass"); break;
  }
}

/** Нарастающий гул телепорта на время каста; stopHum — оборвать (отмена). */
let hum: { id: string; stop: () => void } | null = null;
export function startHum(id: string, dur: number, gain = 1) {
  if (muted || volume <= 0 || gain <= 0.02 || !ctx || ctx.state !== "running" || !master) return;
  stopHum(hum?.id ?? "");
  const c = ctx, t = c.currentTime, v = 0.3 * gain;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(v * 0.9, t + dur * 0.92);
  out.connect(master);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(3600, t + dur);
  lp.connect(out);
  const trem = c.createGain();
  trem.gain.value = 0.7;
  trem.connect(lp);
  const lfo = c.createOscillator(), lg = c.createGain();
  lfo.frequency.setValueAtTime(4, t);
  lfo.frequency.linearRampToValueAtTime(17, t + dur);
  lg.gain.value = 0.3;
  lfo.connect(lg).connect(trem.gain);
  const oscs: OscillatorNode[] = [lfo];
  for (const [type, a, b, vol] of [["triangle", 80, 260, 0.6], ["sawtooth", 160, 520, 0.22], ["sine", 320, 1040, 0.4]] as const) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(a, t);
    o.frequency.exponentialRampToValueAtTime(b, t + dur);
    g.gain.value = vol;
    o.connect(g).connect(trem);
    oscs.push(o);
  }
  for (const o of oscs) { o.start(t); o.stop(t + dur + 0.1); }
  for (let i = 0; i < 12; i++) tone("sine", 1500 + Math.random() * 2200, 2400 + Math.random() * 2000, 0.12, v * 0.18, 0.4 + (i / 12) * dur * 0.9 + Math.random() * 0.1);
  const me = { id, stop: () => {
    out.gain.cancelScheduledValues(c.currentTime);
    out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), c.currentTime);
    out.gain.linearRampToValueAtTime(0, c.currentTime + 0.12);
    for (const o of oscs) { try { o.stop(c.currentTime + 0.15); } catch {} }
    if (hum === me) hum = null;
  } };
  hum = me;
  setTimeout(() => { if (hum === me) hum = null; }, dur * 1000 + 100);
}
export function stopHum(id: string) {
  if (hum && hum.id === id) hum.stop();
}

// ---------- фоновая музыка и атмосфера биомов ----------
type EventKind = "bird" | "wind" | "bubble" | "rumble" | "drip";
interface Amb {
  pad: number[];
  type: OscillatorType;
  vol: number;
  cutoff: number;
  noise?: { type: BiquadFilterType; f: number; vol: number };
  events: [EventKind, number][];
}
const AMB: Record<string, Amb> = {
  town: { pad: [262, 330, 392], type: "triangle", vol: 0.035, cutoff: 900, events: [["bird", 0.05]] },
  meadow: { pad: [196, 247, 294], type: "sine", vol: 0.05, cutoff: 800, noise: { type: "bandpass", f: 900, vol: 0.006 }, events: [["bird", 0.18]] },
  forest: { pad: [147, 185, 220], type: "sine", vol: 0.05, cutoff: 700, noise: { type: "bandpass", f: 1300, vol: 0.012 }, events: [["bird", 0.3]] },
  swamp: { pad: [110, 131, 165], type: "sawtooth", vol: 0.02, cutoff: 320, noise: { type: "lowpass", f: 220, vol: 0.02 }, events: [["bubble", 0.4]] },
  ash: { pad: [98, 117, 147], type: "sawtooth", vol: 0.02, cutoff: 260, noise: { type: "lowpass", f: 420, vol: 0.03 }, events: [["wind", 0.1], ["rumble", 0.06]] },
  desert: { pad: [165, 196, 247], type: "triangle", vol: 0.04, cutoff: 650, noise: { type: "bandpass", f: 800, vol: 0.03 }, events: [["wind", 0.2]] },
  snow: { pad: [220, 277, 330], type: "sine", vol: 0.04, cutoff: 900, noise: { type: "bandpass", f: 1600, vol: 0.04 }, events: [["wind", 0.28]] },
  volcano: { pad: [65, 82, 98], type: "sawtooth", vol: 0.03, cutoff: 200, noise: { type: "lowpass", f: 260, vol: 0.04 }, events: [["bubble", 0.3], ["rumble", 0.12]] },
  water: { pad: [130, 164, 196], type: "sine", vol: 0.06, cutoff: 360, noise: { type: "lowpass", f: 300, vol: 0.035 }, events: [["bubble", 0.45], ["drip", 0.15]] },
  dungeon: { pad: [82, 98, 123], type: "sawtooth", vol: 0.02, cutoff: 220, events: [["drip", 0.1], ["rumble", 0.04]] },
};
interface Layer { name: string; out: GainNode; stop: () => void }
let layer: Layer | null = null;
let wantedAmb: string | null = null;

function startLayer(name: string): Layer {
  const c = ctx!, a = AMB[name], t = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + 3);
  out.connect(musicGain!);
  const srcs: AudioScheduledSourceNode[] = [];
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = a.cutoff;
  lp.connect(out);
  const lfo = c.createOscillator(), lg = c.createGain();
  lfo.frequency.value = 0.05 + Math.random() * 0.06;
  lg.gain.value = a.cutoff * 0.35;
  lfo.connect(lg).connect(lp.frequency);
  lfo.start();
  srcs.push(lfo);
  a.pad.forEach((f, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = a.type;
    o.frequency.value = f;
    o.detune.value = (i - 1) * 7;
    g.gain.value = a.vol;
    o.connect(g).connect(lp);
    o.start();
    srcs.push(o);
  });
  if (a.noise && ambBuf) {
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), sw = c.createOscillator(), swg = c.createGain();
    s.buffer = ambBuf;
    s.loop = true;
    fl.type = a.noise.type;
    fl.frequency.value = a.noise.f;
    g.gain.value = a.noise.vol;
    sw.frequency.value = 0.08 + Math.random() * 0.1;
    swg.gain.value = a.noise.vol * 0.7;
    sw.connect(swg).connect(g.gain);
    s.connect(fl).connect(g).connect(out);
    s.start();
    sw.start();
    srcs.push(s, sw);
  }
  return {
    name,
    out,
    stop() {
      const now = c.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + 2.5);
      setTimeout(() => {
        for (const s of srcs) { try { s.stop(); } catch {} }
        out.disconnect();
      }, 2800);
    },
  };
}

function ambEvent(kind: EventKind) {
  const d = musicGain!, r = Math.random();
  switch (kind) {
    case "bird": {
      const n = 2 + Math.floor(r * 3), f = 2000 + Math.random() * 1200;
      for (let i = 0; i < n; i++) tone("sine", f, f * (1.2 + Math.random() * 0.3), 0.08, 0.05, i * 0.11, d);
      break;
    }
    case "wind": noise(2.2, 0.06, 500 + r * 500, 1500, "bandpass", 0, d); break;
    case "bubble": for (let i = 0; i < 1 + Math.floor(r * 3); i++) tone("sine", 260 + Math.random() * 200, 600 + Math.random() * 400, 0.09, 0.08, i * 0.1, d); break;
    case "rumble": noise(1.4, 0.07, 220, 55, "lowpass", 0, d); tone("sine", 55, 32, 1.2, 0.07, 0, d); break;
    case "drip": tone("sine", 900 + r * 300, 450, 0.14, 0.06, 0, d); break;
  }
}

/** Включить фон биома (плавный переход). null — тишина. Сработает после первого действия игрока. */
export function setAmbience(name: string | null) {
  wantedAmb = name && AMB[name] ? name : null;
  syncAmbience();
}
function syncAmbience() {
  if (!ctx || ctx.state !== "running" || !musicGain || !ambBuf) return;
  if ((layer?.name ?? null) === wantedAmb) return;
  layer?.stop();
  layer = wantedAmb ? startLayer(wantedAmb) : null;
}
setInterval(() => {
  syncAmbience();
  if (!layer || muted || musicVolume <= 0 || !ctx || ctx.state !== "running") return;
  for (const [kind, chance] of AMB[layer.name].events) if (Math.random() < chance * 0.6) ambEvent(kind);
}, 800);
