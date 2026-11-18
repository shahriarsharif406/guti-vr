/**
 * Aura Weaver sound: a light-music language, procedural (no audio files).
 * There is NO looping song. Music happens when light moves: every time a beam is re-routed through mirrors and prisms a
 * glass-harp phrase spreads out along the path (pitch rises with each bounce, pan follows the beam), gates wake with an
 * outward arpeggio, a finished puzzle ends in a warm swell. Everything is in D lydian so any combination is consonant.
 * Between events only the soft beam hum is heard (silent when no light flows). Routed through the shared master chain of
 * audio.ts (compressor + limiter). While Aura is open the workshop music steps aside (auraRoom.music).
 */
import { audioCore, getSfxVolume } from './audio.js';
import { auraRoom, modeState } from './mode.js';

const MAX_VOICES = 56;
const LYD = [0, 2, 4, 6, 7, 9, 11]; // D lydian
const D4 = 62; // midi
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const degree = (k: number, base = D4): number => base + LYD[((k % 7) + 7) % 7] + 12 * Math.floor(k / 7);

interface Core {
  c: BaseAudioContext;
  out: AudioNode;
  sfx: GainNode;
  rev: ConvolverNode;
  revIn: GainNode;
  dlyIn: GainNode;
  an: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  noise: AudioBuffer;
}
let core: Core | null = null;
let voices = 0;
let panNow = 0;
let force = false; // offline rendering and tests: ignore the mode gate
let beamV: { o: OscillatorNode; g: GainNode; base: number; vol: number; kind: number }[] | null = null;
let lastPhrase = -9;
let lastTick = -9;

function build(c: BaseAudioContext, out: AudioNode): Core {
  const sfx = c.createGain();
  sfx.gain.value = 1;
  const an = c.createAnalyser();
  an.fftSize = 2048;
  sfx.connect(an);
  sfx.connect(out);
  // long soft reverb from a generated stereo impulse
  const len = Math.floor(c.sampleRate * 3.6);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * 0.3;
      d[i] = lp * Math.pow(1 - t, 2.2) * 0.8;
    }
  }
  const rev = c.createConvolver();
  rev.buffer = ir;
  const revIn = c.createGain();
  revIn.gain.value = 0.5;
  revIn.connect(rev);
  const revOut = c.createGain();
  revOut.gain.value = 0.85;
  rev.connect(revOut);
  revOut.connect(sfx);
  // dotted echo that feeds the reverb: the sound keeps spreading after the note
  const dly = c.createDelay(2);
  dly.delayTime.value = 0.36;
  const fb = c.createGain();
  fb.gain.value = 0.34;
  const dlf = c.createBiquadFilter();
  dlf.type = 'lowpass';
  dlf.frequency.value = 3600;
  const dlyIn = c.createGain();
  dlyIn.gain.value = 0.5;
  dlyIn.connect(dly);
  dly.connect(dlf);
  dlf.connect(fb);
  fb.connect(dly);
  dlf.connect(sfx);
  dlf.connect(revIn);
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { c, out, sfx, rev, revIn, dlyIn, an, buf: new Float32Array(an.fftSize), noise };
}

function ensure(): Core | null {
  if (!core) {
    const k = audioCore();
    if (!k) return null;
    core = build(k.ctx, k.out);
  }
  const c = core.c as AudioContext;
  if (typeof c.resume === 'function' && c.state === 'suspended') void c.resume();
  return core;
}
const live = (): boolean => (force || modeState.mode === 'aura') && !!ensure();

function pannerFor(c: BaseAudioContext, p: number): AudioNode | null {
  if (typeof c.createStereoPanner !== 'function') return null;
  const s = c.createStereoPanner();
  s.pan.value = Math.max(-1, Math.min(1, p));
  return s;
}

interface ToneOpts {
  f: number;
  dur: number;
  vol: number;
  type?: OscillatorType;
  at?: number;
  attack?: number;
  pan?: number;
  verb?: number;
  echo?: number;
  glide?: number;
  detune?: number;
}

/** One enveloped oscillator voice with optional reverb/echo sends. The voice count is capped. */
function tone(o: ToneOpts): void {
  const k = core;
  if (!k || voices >= MAX_VOICES) return;
  const c = k.c;
  const t0 = Math.max(c.currentTime, o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t0 + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const a = o.attack ?? 0.006;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(o.vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g);
  let tail: AudioNode = g;
  const pn = pannerFor(c, o.pan ?? panNow);
  if (pn) {
    g.connect(pn);
    tail = pn;
  }
  tail.connect(k.sfx);
  if (o.verb) {
    const s = c.createGain();
    s.gain.value = o.verb;
    tail.connect(s);
    s.connect(k.revIn);
  }
  if (o.echo) {
    const s = c.createGain();
    s.gain.value = o.echo;
    tail.connect(s);
    s.connect(k.dlyIn);
  }
  voices++;
  osc.onended = () => {
    voices--;
    g.disconnect();
    if (pn) pn.disconnect();
  };
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

function noiseBurst(dur: number, vol: number, f: number, q: number, type: BiquadFilterType = 'bandpass', sweepTo?: number, pan = panNow): void {
  const k = core;
  if (!k || voices >= MAX_VOICES) return;
  const c = k.c;
  const src = c.createBufferSource();
  src.buffer = k.noise;
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, c.currentTime);
  if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
  flt.Q.value = q;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  const pn = pannerFor(c, pan);
  if (pn) {
    g.connect(pn);
    pn.connect(k.sfx);
  } else g.connect(k.sfx);
  voices++;
  src.onended = () => {
    voices--;
    g.disconnect();
  };
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

/** glass-harp note: a pure fundamental with a soft octave, a faint triangle and a short inharmonic shimmer */
function glass(m: number, vol: number, at: number, pan: number, dur = 2.6, verb = 0.75, echo = 0.4): void {
  const f = mtof(m);
  tone({ f, dur, vol, at, pan, verb, echo, attack: 0.004 });
  tone({ f: f * 2, dur: dur * 0.6, vol: vol * 0.36, at, pan, verb, echo: echo * 0.5, attack: 0.004 });
  tone({ f: f * 1.003, dur: dur * 0.8, vol: vol * 0.3, at, pan, verb, echo: 0, attack: 0.012, type: 'triangle' });
  tone({ f: f * 2.76, dur: Math.min(0.5, dur * 0.2), vol: vol * 0.2, at, pan, verb: verb * 0.6, echo: 0, attack: 0.002 });
}

function pad(ms: number[], at: number, len: number, vol: number): void {
  ms.forEach((m, i) => {
    const pan = (i - (ms.length - 1) / 2) * 0.4;
    tone({ f: mtof(m), dur: len + 2, vol, at, attack: len * 0.45, pan, verb: 0.8, type: 'triangle', detune: i % 2 ? 5 : -5 });
    tone({ f: mtof(m + 12), dur: len + 2, vol: vol * 0.45, at: at + 0.15, attack: len * 0.5, pan: -pan, verb: 0.9 });
  });
}

const panOf = (x: number): number => Math.max(-0.95, Math.min(0.95, x / 0.6));

export const aa = {
  /** call every frame while Aura is the active mode */
  update(): void {
    auraRoom.music = modeState.mode === 'aura'; // the workshop music steps aside; Aura has no looping music of its own
    if (core) core.sfx.gain.setTargetAtTime(modeState.mode === 'aura' || force ? getSfxVolume() : 0, core.c.currentTime, 0.05);
    if (modeState.mode !== 'aura' && beamV && core) for (const v of beamV) v.g.gain.setTargetAtTime(0, core.c.currentTime, 0.1);
  },
  pan(p: number, f: () => void): void {
    const o = panNow;
    panNow = Math.max(-1, Math.min(1, p));
    try {
      f();
    } finally {
      panNow = o;
    }
  },
  /** soft beam hum (airy, silent when no light flows): cyan pure glass, magenta shimmering pair, gold warm low glow */
  beams(cy: number, ma: number, go: number, bend: number): void {
    if (!(force || modeState.mode === 'aura') || !core || (core.c as AudioContext).state === 'suspended') return;
    const c = core.c;
    if (!beamV) {
      if (cy + ma + go < 0.01) return;
      const mk = (kind: number, type: OscillatorType, f: number, vol: number, det = 0): { o: OscillatorNode; g: GainNode; base: number; vol: number; kind: number } => {
        const o = c.createOscillator();
        const g = c.createGain();
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det;
        g.gain.value = 0;
        o.connect(lp);
        lp.connect(g);
        g.connect(core!.sfx);
        const s = c.createGain();
        s.gain.value = 0.6;
        g.connect(s);
        s.connect(core!.revIn);
        o.start();
        return { o, g, base: f, vol, kind };
      };
      const D = mtof(D4);
      beamV = [mk(0, 'sine', D * 4, 0.018), mk(0, 'sine', D * 6, 0.006), mk(1, 'triangle', D * 2, 0.01, -8), mk(1, 'triangle', D * 2, 0.01, 8), mk(2, 'sine', D / 2, 0.026), mk(2, 'sine', D, 0.008)];
    }
    const t = c.currentTime;
    const m = 1 + bend * 0.12;
    const lv = [cy, ma, go];
    for (const v of beamV) {
      v.o.frequency.setTargetAtTime(v.base * m, t, 0.12);
      v.g.gain.setTargetAtTime(lv[v.kind] * v.vol, t, 0.2);
    }
  },
  /**
   * Light has been routed: play a phrase along the beam path. `pts` are the beam segment end points in board metres.
   * Pitch climbs the lydian scale with each bounce, pan follows the beam from the source outwards, long reverb tail.
   */
  light(pts: { x: number; y: number }[]): void {
    if (!live() || !core || pts.length === 0) return;
    const now = core.c.currentTime;
    if (now - lastPhrase < 0.45) return;
    lastPhrase = now;
    const n = Math.min(9, pts.length);
    for (let i = 0; i < n; i++) {
      const p = pts[Math.floor((i * (pts.length - 1)) / Math.max(1, n - 1))];
      const k = i + (i > 3 ? i - 3 : 0) + 1; // rises in steps, then in thirds
      glass(degree(k), 0.19 - i * 0.008, now + 0.02 + i * 0.085, panOf(p.x), 2.4 + i * 0.12);
    }
    const last = pts[pts.length - 1];
    glass(degree(n + 7), 0.1, now + 0.12 + n * 0.085, panOf(last.x), 3.2, 0.9, 0.5); // a high sparkle at the end of the beam
  },
  /** a dial passes a step: one glass note of the same scale, pitch tied to the angle */
  tick(stepIdx: number): void {
    if (!live() || !core) return;
    const now = core.c.currentTime;
    if (now - lastTick < 0.05) return;
    lastTick = now;
    glass(degree(((stepIdx % 7) + 7) % 7 + 7), 0.42, now, panNow, 1.3, 0.6, 0.25);
    noiseBurst(0.02, 0.03, 6500, 1.2, 'highpass');
  },
  /** a monolith wakes: an arpeggio that spreads outward from the centre */
  awaken(idx: number, chapter: number): void {
    if (!live() || !core) return;
    const t = core.c.currentTime;
    const base = D4 - 12 + Math.min(4, Math.max(0, chapter)) * 2;
    const seq = [0, 2, 4, 6, 7, 9, 11, 13];
    seq.forEach((k, i) => {
      const side = i % 2 ? 1 : -1;
      glass(degree(k + (idx % 3), base + 12), 0.2 - i * 0.008, t + i * 0.075, side * Math.min(0.95, 0.1 + i * 0.13), 3.2, 0.9, 0.5);
    });
    tone({ f: mtof(base), dur: 3, vol: 0.14, attack: 0.3, verb: 0.4, glide: mtof(base + 7) });
    noiseBurst(1.2, 0.04, 1500, 0.7, 'bandpass', 6000);
  },
  /** gentle wrong mix: a soft descending pair from the scale, never harsh */
  impure(): void {
    if (!live() || !core) return;
    const t = core.c.currentTime;
    glass(degree(2, D4 - 12), 0.36, t, panNow, 1.4, 0.5, 0.2);
    glass(degree(0, D4 - 12), 0.32, t + 0.16, panNow, 1.6, 0.5, 0.2);
  },
  /** puzzle solved: a warm swell with sparkle fanning out to both sides */
  pulse(): void {
    if (!live() || !core) return;
    const t = core.c.currentTime;
    pad([D4 - 12, D4 - 5, D4 + 4, D4 + 9], t, 2.2, 0.1);
    tone({ f: mtof(D4 - 24), dur: 3.4, vol: 0.16, attack: 0.9, glide: mtof(D4 - 12), verb: 0.2 });
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      glass(degree(i + 2, D4 + 12), 0.17 - i * 0.005, t + 0.5 + i * 0.1, side * Math.min(0.95, 0.15 + i * 0.07), 3.4, 0.9, 0.5);
    }
    noiseBurst(2.2, 0.045, 900, 0.5, 'bandpass', 5000);
  },
  /** the final awakening: two big swells and a long cascade */
  finale(): void {
    if (!live() || !core) return;
    const t = core.c.currentTime;
    pad([D4 - 12, D4 - 5, D4 + 4, D4 + 9], t, 5, 0.11);
    pad([D4 - 10, D4 - 3, D4 + 6, D4 + 11], t + 5, 5, 0.11);
    for (let i = 0; i < 20; i++) glass(degree(i, D4 + 12), 0.15, t + 1 + i * 0.35, Math.sin(i * 1.9) * 0.9, 4, 0.9, 0.5);
    noiseBurst(7, 0.04, 700, 0.4, 'bandpass', 5200);
  },
  /** pick up / touch a mirror or a thread node */
  grab(): void {
    if (!live() || !core) return;
    glass(degree(4, D4 + 12), 0.4, core.c.currentTime, panNow, 0.9, 0.4, 0.15);
  },
  /** thread snip */
  cut(): void {
    if (!live() || !core) return;
    noiseBurst(0.12, 0.06, 5200, 2, 'bandpass', 2400);
    glass(degree(5, D4), 0.25, core.c.currentTime + 0.04, panNow, 0.9, 0.4, 0.1);
  },
  whoosh(): void {
    if (!live()) return;
    noiseBurst(0.8, 0.07, 400, 0.8, 'bandpass', 3800);
  },
  /** a single warm chime (thread connected / small success) */
  chime(): void {
    if (!live() || !core) return;
    glass(degree(4, D4 + 12), 0.36, core.c.currentTime, panNow, 2, 0.8, 0.4);
    glass(degree(6, D4 + 12), 0.3, core.c.currentTime + 0.09, panNow, 2, 0.8, 0.4);
  },
  /** UI button click */
  click(): void {
    if (!live() || !core) return;
    glass(degree(2, D4 + 12), 0.32, core.c.currentTime, 0, 0.5, 0.3, 0.1);
  },
  /** test hook: peak amplitude (0..1) at the Aura bus since the last call */
  peak(): number {
    if (!core) return 0;
    core.an.getFloatTimeDomainData(core.buf);
    let p = 0;
    for (let i = 0; i < core.buf.length; i++) p = Math.max(p, Math.abs(core.buf[i]));
    return p;
  },
  state(): { ctx: string; voices: number } {
    return { ctx: (core?.c as AudioContext | undefined)?.state ?? 'none', voices };
  },
};

/**
 * Offline measurement: renders one sound event through the same graph plus the shared master gain, compressor and
 * limiter settings of audio.ts, and returns the peak (dBFS) at the limiter output. Deterministic, no speakers needed.
 */
export async function renderAuraEvent(kind: string, seconds = 6, masterGain = 0.9): Promise<{ peakDb: number; rmsDb: number; clipped: boolean }> {
  const SR = 48000;
  const oc = new OfflineAudioContext(2, SR * seconds, SR);
  const master = oc.createGain();
  master.gain.value = masterGain;
  const comp = oc.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 24;
  comp.ratio.value = 3;
  comp.attack.value = 0.02;
  comp.release.value = 0.4;
  const lim = oc.createDynamicsCompressor();
  lim.threshold.value = -2;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.1;
  master.connect(comp);
  comp.connect(lim);
  lim.connect(oc.destination);
  const saved = { core, voices, force, beamV, lastPhrase, lastTick };
  core = build(oc, master);
  voices = 0;
  force = true;
  beamV = null;
  lastPhrase = -9;
  lastTick = -9;
  try {
    const path = [-0.45, -0.2, 0.05, 0.3, 0.45, 0.2, -0.1].map((x, i) => ({ x, y: i * 0.05 }));
    if (kind === 'light') aa.light(path);
    else if (kind === 'tick') aa.tick(3);
    else if (kind === 'awaken') aa.awaken(1, 2);
    else if (kind === 'pulse') aa.pulse();
    else if (kind === 'finale') aa.finale();
    else if (kind === 'chime') aa.chime();
    else if (kind === 'impure') aa.impure();
    else if (kind === 'grab') aa.grab();
    else if (kind === 'click') aa.click();
    else if (kind === 'beams') aa.beams(1, 1, 1, 0.2);
    const buf = await oc.startRendering();
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sum += d[i] * d[i];
        n++;
      }
    }
    return { peakDb: 20 * Math.log10(peak || 1e-9), rmsDb: 10 * Math.log10(sum / n || 1e-12), clipped: peak >= 0.999 };
  } finally {
    core = saved.core;
    voices = saved.voices;
    force = saved.force;
    beamV = saved.beamV;
    lastPhrase = saved.lastPhrase;
    lastTick = saved.lastTick;
  }
}
