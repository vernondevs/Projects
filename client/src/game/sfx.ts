/** Процедурные звуки на WebAudio (без файлов). AudioContext стартует по первому действию игрока. */
export type SfxName = "hit" | "crit" | "fire" | "frost" | "arrow" | "heal" | "shield" | "poison" | "explosion" | "slam" | "arcane" | "holy" | "shadow";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volume = 0.6;
let muted = false;
const lastPlay = new Map<string, number>();

try {
  const v = localStorage.getItem("sfxVolume");
  if (v !== null) volume = Math.min(1, Math.max(0, Number(v)));
  muted = localStorage.getItem("sfxMuted") === "1";
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
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch { return false; }
}

for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => { ensure(); }, { once: false, passive: true });

export function getVolume() { return volume; }
export function isMuted() { return muted; }
export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master) master.gain.value = muted ? 0 : volume;
  try { localStorage.setItem("sfxVolume", String(volume)); } catch {}
}
export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : volume;
  try { localStorage.setItem("sfxMuted", m ? "1" : "0"); } catch {}
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  const c = ctx!, t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = "lowpass", delay = 0) {
  const c = ctx!, t = c.currentTime + delay;
  const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  fl.type = type;
  fl.frequency.setValueAtTime(f0, t);
  fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl).connect(g).connect(master!);
  s.start(t);
  s.stop(t + dur + 0.02);
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
    case "shadow": tone("sawtooth", 300, 80, 0.2, v * 0.4); noise(0.18, v * 0.5, 1500, 200, "bandpass"); break;
  }
}
