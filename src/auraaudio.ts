/**
 * Aura Weaver sound: an original procedural score and event sounds (no audio files).
 * Idea: light spreading out in every direction. A glassy lydian pad, harp-like plucks that fan out from the centre
 * to the left and right, bell accents, a dotted echo and a long soft reverb. Routed through the shared master chain
 * (compressor + limiter) of audio.ts, so master volume, mute and the limiter apply. While Aura is open the workshop
 * music steps aside (auraRoom.music), so this is the only music.
 */
import { audioCore, getMusicVolume, getSfxVolume } from './audio.js';
import { auraRoom, modeState } from './mode.js';

const MAX_VOICES = 48;
const BPM = 56;
const BEAT = 60 / BPM;
// D lydian colours: Dmaj7, A/C#, Bm9, Gmaj7#11 (four bars each, one chord per two beats group of 8 beats)
const CHORDS: number[][] = [
  [50, 54, 57, 61],
  [49, 52, 57, 64],
  [47, 54, 57, 61],
  [43, 50, 54, 59],
];
const PENT = [0, 2, 4, 7, 9]; // major pentatonic from D
const D4 = 293.66;
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Core {
  c: AudioContext;
  out: AudioNode;
  music: GainNode;
  sfx: GainNode;
  rev: ConvolverNode;
  revIn: GainNode;
  dly: DelayNode;
  dlyIn: GainNode;
  an: AnalyserNode;
  buf: Float32Array;
  noise: AudioBuffer;
}
let core: Core | null = null;
let voices = 0;
let nextBar = 0;
let step = 0;
let timer = 0;
let panNow = 0;
let level = 0; // 0..1 how much light is flowing (drives density)
let beamV: { o: OscillatorNode; g: GainNode; base: number; vol: number; kind: number }[] | null = null;
let lastPeak = 0;
let started = false;

function build(): Core | null {
  const k = audioCore();
  if (!k) return null;
  const c = k.ctx;
  const music = c.createGain();
  music.gain.value = 0;
  const sfx = c.createGain();
  sfx.gain.value = 1;
  const an = c.createAnalyser();
  an.fftSize = 2048;
  music.connect(an);
  sfx.connect(an);
  music.connect(k.out);
  sfx.connect(k.out);
  // reverb: generated stereo impulse, soft and long
  const len = Math.floor(c.sampleRate * 3.2);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      d[i] = lp * Math.pow(1 - t, 2.4) * 0.7;
    }
  }
  const rev = c.createConvolver();
  rev.buffer = ir;
  const revIn = c.createGain();
  revIn.gain.value = 0.55;
  revIn.connect(rev);
  const revOut = c.createGain();
  revOut.gain.value = 0.9;
  rev.connect(revOut);
  revOut.connect(music);
  // dotted-eighth echo that feeds the reverb: the "spreading" feel
  const dly = c.createDelay(2);
  dly.delayTime.value = BEAT * 0.75;
  const fb = c.createGain();
  fb.gain.value = 0.38;
  const dlf = c.createBiquadFilter();
  dlf.type = 'lowpass';
  dlf.frequency.value = 3200;
  const dlyIn = c.createGain();
  dlyIn.gain.value = 0.5;
  dlyIn.connect(dly);
  dly.connect(dlf);
  dlf.connect(fb);
  fb.connect(dly);
  dlf.connect(music);
  dlf.connect(revIn);
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { c, out: k.out, music, sfx, rev, revIn, dly, dlyIn, an, buf: new Float32Array(an.fftSize), noise };
}

function pannerFor(c: AudioContext, p: number): AudioNode | null {
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
  bus?: 'music' | 'sfx';
  verb?: number; // reverb send 0..1
  echo?: number; // echo send 0..1
  glide?: number; // end frequency
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
  tail.connect(o.bus === 'music' ? k.music : k.sfx);
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

/** a glassy bell: fundamental plus an inharmonic partial */
function bell(f: number, vol: number, dur: number, at: number, pan: number, bus: 'music' | 'sfx' = 'sfx', verb = 0.6, echo = 0.25): void {
  tone({ f, dur, vol, at, pan, bus, verb, echo, attack: 0.004 });
  tone({ f: f * 2.76, dur: dur * 0.45, vol: vol * 0.32, at, pan, bus, verb, echo: 0, attack: 0.003 });
  tone({ f: f * 1.002, dur: dur * 0.8, vol: vol * 0.4, at, pan, bus, verb, echo: 0, attack: 0.01, type: 'triangle' });
}

/** harp-like pluck */
function pluck(f: number, vol: number, at: number, pan: number): void {
  tone({ f, dur: 1.5, vol, at, pan, bus: 'music', verb: 0.7, echo: 0.55, attack: 0.004, type: 'triangle' });
  tone({ f: f * 2, dur: 0.7, vol: vol * 0.35, at, pan, bus: 'music', verb: 0.6, echo: 0.3, attack: 0.003 });
}

function pad(chord: number[], at: number, len: number): void {
  const k = core;
  if (!k) return;
  chord.forEach((m, i) => {
    const pan = (i - 1.5) * 0.45;
    tone({ f: mtof(m + 12), dur: len + 2.5, vol: 0.034, at, attack: 2.2, pan, bus: 'music', verb: 0.7, type: 'triangle', detune: i % 2 ? 6 : -6 });
    tone({ f: mtof(m + 24), dur: len + 2.5, vol: 0.014, at: at + 0.4, attack: 2.6, pan: -pan, bus: 'music', verb: 0.9 });
  });
  tone({ f: mtof(chord[0] - 12), dur: len + 1.5, vol: 0.05, at, attack: 1.6, pan: 0, bus: 'music', verb: 0.2 });
}

function scheduleMusic(): void {
  const k = core;
  if (!k) return;
  const c = k.c;
  const active = modeState.mode === 'aura';
  const want = active ? 1.5 * getMusicVolume() : 0;
  k.music.gain.setTargetAtTime(want, c.currentTime, active ? 0.8 : 0.25);
  k.sfx.gain.setTargetAtTime(active ? getSfxVolume() : 0, c.currentTime, 0.05);
  if (!active || c.state !== 'running') {
    nextBar = c.currentTime + 0.3;
    return;
  }
  if (nextBar < c.currentTime - 0.5) nextBar = c.currentTime + 0.1; // after a stall, do not replay the missed bars at once
  const horizon = c.currentTime + 0.9;
  const bar = BEAT * 4;
  while (nextBar < horizon) {
    const n = Math.floor(step / 4); // bar index
    const chord = CHORDS[Math.floor(n / 2) % 4];
    if (step % 8 === 0) pad(chord, nextBar, bar * 2);
    const q = step % 4;
    if (q === 0) {
      // bell on the bar: top chord tone
      const m = chord[(n * 3) % 4] + 24;
      bell(mtof(m), 0.06, 3.2, nextBar, ((n % 5) - 2) * 0.35, 'music', 0.9, 0.5);
    }
    // arpeggio: fans out from the centre (low register, pan 0) to the edges (high register, wide pan)
    const dense = level > 0.25 ? 2 : 1;
    for (let j = 0; j < 2 * dense; j++) {
      const t = nextBar + (j * BEAT) / dense / 2;
      const idx = (step * 2 * dense + j) % 12;
      const out = idx < 6 ? idx : 11 - idx; // 0..5..0: out and back in
      const note = chord[out % 4] + 12 + 12 * Math.floor(out / 4);
      const pan = ((idx < 6 ? 1 : -1) * out) / 5 * 0.85;
      pluck(mtof(note), 0.05 + 0.03 * level, t, pan);
    }
    nextBar += BEAT;
    step++;
  }
}

function tick(): void {
  if (!core) return;
  try {
    scheduleMusic();
  } catch {
    /* audio is best effort */
  }
}

function ensure(): Core | null {
  if (!core) core = build();
  if (core && !started) {
    started = true;
    nextBar = core.c.currentTime + 0.3;
    timer = window.setInterval(tick, 100);
  }
  if (core && core.c.state === 'suspended') void core.c.resume();
  return core;
}

const live = (): boolean => modeState.mode === 'aura' && !!ensure();

const scalePitch = (i: number, oct = 0): number => {
  const n = ((i % 5) + 5) % 5;
  return D4 * 2 * Math.pow(2, (PENT[n] + 12 * (Math.floor(i / 5) % 3 + oct)) / 12);
};

export const aa = {
  /** call every frame while Aura is the active mode */
  update(flow: number): void {
    auraRoom.music = modeState.mode === 'aura';
    if (modeState.mode !== 'aura') {
      if (beamV && core) for (const v of beamV) v.g.gain.setTargetAtTime(0, core.c.currentTime, 0.1);
      return;
    }
    if (!live()) return;
    level += (flow - level) * 0.05;
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
  /** persistent light voices: cyan = pure glass, magenta = shimmering pair, gold = warm low glow */
  beams(cy: number, ma: number, go: number, bend: number): void {
    if (modeState.mode !== 'aura' || !core || core.c.state !== 'running') return;
    const c = core.c;
    if (!beamV) {
      if (cy + ma + go < 0.01) return;
      const mk = (kind: number, type: OscillatorType, f: number, vol: number, det = 0): { o: OscillatorNode; g: GainNode; base: number; vol: number; kind: number } => {
        const o = c.createOscillator();
        const g = c.createGain();
        const f2 = c.createBiquadFilter();
        f2.type = 'lowpass';
        f2.frequency.value = 2600;
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det;
        g.gain.value = 0;
        o.connect(f2);
        f2.connect(g);
        g.connect(core!.music);
        const s = c.createGain();
        s.gain.value = 0.5;
        g.connect(s);
        s.connect(core!.revIn);
        o.start();
        return { o, g, base: f, vol, kind };
      };
      beamV = [mk(0, 'sine', D4 * 4, 0.02), mk(0, 'sine', D4 * 6, 0.008), mk(1, 'triangle', D4 * 2, 0.012, -8), mk(1, 'triangle', D4 * 2, 0.012, 8), mk(2, 'sine', D4 / 2, 0.03), mk(2, 'sine', D4, 0.01)];
    }
    const t = c.currentTime;
    const m = 1 + bend * 0.12;
    const lv = [cy, ma, go];
    for (const v of beamV) {
      v.o.frequency.setTargetAtTime(v.base * m, t, 0.12);
      v.g.gain.setTargetAtTime(lv[v.kind] * v.vol, t, 0.2);
    }
  },
  /** a dial passes a step: glass tick, pitch tied to the angle (pentatonic) */
  tick(stepIdx: number): void {
    if (!live()) return;
    const f = scalePitch(stepIdx);
    tone({ f, dur: 0.55, vol: 0.09, verb: 0.5, echo: 0.2, attack: 0.003 });
    tone({ f: f * 2.01, dur: 0.22, vol: 0.025, attack: 0.002 });
    noiseBurst(0.02, 0.025, 6000, 1.2, 'highpass');
  },
  /** a monolith wakes: rising chime cascade */
  awaken(idx: number, chapter: number): void {
    if (!live() || !core) return;
    const root = 50 + Math.min(4, Math.max(0, chapter)) * 2 + (idx % 3) * 7; // midi
    const t = core.c.currentTime;
    [0, 4, 7, 11, 14, 16].forEach((iv, i) => bell(mtof(root + 12 + iv), 0.07, 2.6, t + i * 0.1, ((i % 3) - 1) * 0.5));
    tone({ f: mtof(root - 12), dur: 2.6, vol: 0.08, attack: 0.25, verb: 0.3, glide: mtof(root - 5) });
    noiseBurst(1.1, 0.025, 1200, 0.7, 'bandpass', 5200);
  },
  /** gentle wrong mix: a soft low glass thud, never harsh */
  impure(): void {
    if (!live()) return;
    tone({ f: 233, dur: 0.45, vol: 0.07, glide: 175, verb: 0.3, attack: 0.01 });
    tone({ f: 349, dur: 0.3, vol: 0.025, glide: 262, attack: 0.01 });
  },
  /** puzzle solved: a warm swell with sparkle */
  pulse(): void {
    if (!live() || !core) return;
    const t = core.c.currentTime;
    pad([50, 54, 57, 61], t, 3.2);
    tone({ f: 73.4, dur: 2.2, vol: 0.09, attack: 0.6, glide: 110, verb: 0.2 });
    [0, 4, 7, 9, 12, 16, 19, 21, 24].forEach((iv, i) => bell(mtof(74 + iv), 0.05, 2.2, t + 0.25 + i * 0.12, Math.sin(i * 1.7) * 0.8));
    noiseBurst(1.8, 0.03, 900, 0.5, 'bandpass', 4200);
  },
  /** the final awakening */
  finale(): void {
    if (!live() || !core) return;
    const t = core.c.currentTime;
    pad([50, 57, 61, 66], t, 8);
    pad([55, 59, 62, 66], t + 6, 8);
    [0, 7, 12, 16, 19, 24, 28, 31, 36].forEach((iv, i) => bell(mtof(62 + iv), 0.05, 4, t + 0.8 + i * 0.7, Math.sin(i * 2.3) * 0.9, 'sfx', 0.9, 0.5));
    noiseBurst(6, 0.03, 700, 0.4, 'bandpass', 4800);
  },
  /** pick up / touch a mirror or a thread node */
  grab(): void {
    if (!live()) return;
    tone({ f: 660, dur: 0.16, vol: 0.06, glide: 990, attack: 0.004, verb: 0.3 });
    noiseBurst(0.03, 0.02, 4500, 1, 'highpass');
  },
  /** thread snip */
  cut(): void {
    if (!live()) return;
    noiseBurst(0.12, 0.05, 5200, 2, 'bandpass', 2400);
    tone({ f: 880, dur: 0.2, vol: 0.04, glide: 440, attack: 0.002 });
  },
  whoosh(): void {
    if (!live()) return;
    noiseBurst(0.7, 0.05, 400, 0.8, 'bandpass', 3600);
  },
  /** a single warm chime (thread connected / small success) */
  chime(): void {
    if (!live() || !core) return;
    bell(scalePitch(3, 0), 0.07, 1.8, core.c.currentTime, panNow);
  },
  /** UI button click */
  click(): void {
    if (!live()) return;
    tone({ f: 1046, dur: 0.12, vol: 0.05, attack: 0.002, verb: 0.2 });
    tone({ f: 1568, dur: 0.08, vol: 0.02, attack: 0.002 });
  },
  /** test hook: peak amplitude (0..1) of the Aura output since the last call */
  peak(): number {
    if (!core) return 0;
    core.an.getFloatTimeDomainData(core.buf as Float32Array<ArrayBuffer>);
    let p = 0;
    for (let i = 0; i < core.buf.length; i++) p = Math.max(p, Math.abs(core.buf[i]));
    lastPeak = Math.max(lastPeak * 0.5, p);
    return lastPeak;
  },
  state(): { ctx: string; voices: number; music: number; level: number; bars: number } {
    return { ctx: core?.c.state ?? 'none', voices, music: core?.music.gain.value ?? -1, level, bars: step };
  },
  /** stop the scheduler (tests) */
  dispose(): void {
    window.clearInterval(timer);
    started = false;
  },
};
