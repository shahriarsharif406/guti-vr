/**
 * Tiny procedural sound effects (no audio files). The AudioContext is created
 * lazily on the first call, which always follows a user gesture.
 */
let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function tone(
  freq: number,
  dur: number,
  vol: number,
  type: OscillatorType = 'sine',
  slideTo?: number,
  delay = 0,
): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function burst(dur: number, vol: number, freq: number, q = 1): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

// ------------------------------------------------------------------ music
// Procedural Bengali-folk style score: tanpura drone, bansuri flute or dotara
// pluck, tabla/dhol, soft reverb. Every game screen has its own raga and rhythm.
import { modeState } from './mode.js';

interface Track {
  bpm: number;
  root: number;
  scale: number[];
  lead: 'flute' | 'pluck';
  density: number;
  bass: number[]; // 16th steps with a deep drum hit
  hi: number[]; // steps with a sharp drum hit
  shaker: number;
  drum: number; // drum loudness
  leadVol: number;
}

const TRACKS: Record<'calm' | 'kite' | 'lattim', Track> = {
  // marbles + menu: slow evening raga, bansuri over a drone
  calm: { bpm: 62, root: 146.8, scale: [0, 2, 4, 6, 7, 9, 11], lead: 'flute', density: 0.34, bass: [0, 8], hi: [], shaker: 0, drum: 0.5, leadVol: 0.07 },
  // kite: bright, playful Bhupali with keherwa tabla
  kite: { bpm: 98, root: 164.8, scale: [0, 2, 4, 7, 9, 12, 14, 16], lead: 'flute', density: 0.62, bass: [0, 6, 8, 10], hi: [2, 4, 12, 14], shaker: 2, drum: 0.9, leadVol: 0.08 },
  // lattim: folk dhol rhythm with a plucked dotara
  lattim: { bpm: 112, root: 130.8, scale: [0, 1, 3, 5, 7, 8, 10, 12], lead: 'pluck', density: 0.55, bass: [0, 3, 6, 8, 11, 14], hi: [2, 4, 10, 12, 15], shaker: 2, drum: 1.1, leadVol: 0.09 },
};

let musicGain: GainNode | null = null;
let musicOn = true;
let musicStarted = false;
let curTrack: Track = TRACKS.calm;
let curKey = '';
let step = 0;
let nextT = 0;
let lastDeg = 2;
let phrase: number[] = [];
let reverb: ConvolverNode | null = null;

function trackFor(): 'calm' | 'kite' | 'lattim' {
  const m = modeState.mode;
  return m === 'kite' ? 'kite' : m === 'lattim' || m === 'danguli' ? 'lattim' : 'calm';
}

function out(c: AudioContext): AudioNode {
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = musicOn ? 0.9 : 0;
    // cheap reverb from decaying noise
    const len = Math.floor(c.sampleRate * 2.2);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb = c.createConvolver();
    reverb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet).connect(c.destination);
    musicGain.connect(c.destination);
    musicGain.connect(reverb);
  }
  return musicGain;
}

function mNote(c: AudioContext, t: number, freq: number, dur: number, vol: number, kind: 'flute' | 'pluck' | 'tanpura'): void {
  const g = c.createGain();
  const dest = out(c);
  if (kind === 'flute') {
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = freq;
    o2.frequency.value = freq * 2;
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 5.2;
    lg.gain.value = freq * 0.007;
    lfo.connect(lg).connect(o.frequency);
    const g2 = c.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.07);
    g.gain.setValueAtTime(vol, t + Math.max(0.08, dur - 0.18));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    // breath
    const n = c.createBufferSource();
    n.buffer = noise(c);
    n.loop = true;
    const bf = c.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = freq * 2.5;
    bf.Q.value = 3;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vol * 0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, 0.4));
    n.connect(bf).connect(ng).connect(dest);
    for (const x of [o, o2, lfo]) {
      x.start(t);
      x.stop(t + dur + 0.05);
    }
    n.start(t);
    n.stop(t + Math.min(dur, 0.4) + 0.05);
  } else if (kind === 'pluck') {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 7, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.35);
    o.connect(f).connect(g);
    g.gain.setValueAtTime(vol * 0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.4, dur));
    g.connect(dest);
    o.start(t);
    o.stop(t + Math.max(0.4, dur) + 0.05);
  } else {
    // tanpura string: two slightly detuned saws, dark and long
    for (const det of [1, 1.004]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq * det;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      o.connect(f).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
  }
}

function mDrum(c: AudioContext, t: number, kind: 'bass' | 'hi' | 'shake', vol: number): void {
  const dest = out(c);
  if (kind === 'shake') {
    const n = c.createBufferSource();
    n.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 0.07);
    return;
  }
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  if (kind === 'bass') {
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.22);
    g.gain.setValueAtTime(vol * 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  } else {
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.08);
    g.gain.setValueAtTime(vol * 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    const n = c.createBufferSource();
    n.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vol * 0.06, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(f).connect(ng).connect(dest);
    n.start(t);
    n.stop(t + 0.06);
  }
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.42);
}

/** New 16-step phrase: stepwise melody over the raga, repeated with small changes. */
function newPhrase(tr: Track): void {
  const prev = phrase;
  const out2: number[] = [];
  const keep = prev.length === 16 && Math.random() < 0.45;
  for (let i = 0; i < 16; i++) {
    if (keep) {
      out2.push(Math.random() < 0.15 ? -1 : prev[i]);
      continue;
    }
    const onBeat = i % 4 === 0;
    if (Math.random() < (onBeat ? tr.density + 0.25 : tr.density * 0.5)) {
      const move = Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : Math.floor(Math.random() * 5) - 2;
      lastDeg = Math.max(0, Math.min(tr.scale.length - 1, lastDeg + move));
      out2.push(lastDeg);
    } else {
      out2.push(-1);
    }
  }
  // resolve to the tonic at the end of every second phrase
  phrase = out2;
}

let bar = 0;
function schedule(): void {
  const c = ctx;
  if (!c || !musicOn) return;
  const key = trackFor();
  if (key !== curKey) {
    curKey = key;
    curTrack = TRACKS[key];
    step = 0;
    bar = 0;
    phrase = [];
    lastDeg = 2;
    nextT = c.currentTime + 0.15;
  }
  const tr = curTrack;
  const stepDur = 60 / tr.bpm / 4;
  while (nextT < c.currentTime + 0.25) {
    const s = step % 16;
    if (s === 0) {
      bar += 1;
      newPhrase(tr);
      // tanpura: Pa - Sa - Sa - low Sa, once per bar
      const p = tr.root * 0.75;
      mNote(c, nextT, p, stepDur * 6, 0.05, 'tanpura');
      mNote(c, nextT + stepDur * 4, tr.root, stepDur * 6, 0.045, 'tanpura');
      mNote(c, nextT + stepDur * 8, tr.root, stepDur * 6, 0.045, 'tanpura');
      mNote(c, nextT + stepDur * 12, tr.root * 0.5, stepDur * 6, 0.055, 'tanpura');
    }
    const deg = phrase[s];
    if (deg !== undefined && deg >= 0) {
      let len = 1;
      while (s + len < 16 && phrase[s + len] === -1 && len < 6) len++;
      const semi = tr.scale[deg];
      const f = tr.root * 2 * Math.pow(2, semi / 12);
      mNote(c, nextT, f, stepDur * len * (tr.lead === 'flute' ? 0.95 : 1.4), tr.leadVol, tr.lead);
    }
    if (tr.bass.includes(s)) mDrum(c, nextT, 'bass', tr.drum);
    if (tr.hi.includes(s)) mDrum(c, nextT, 'hi', tr.drum);
    if (tr.shaker && s % tr.shaker === 0) mDrum(c, nextT, 'shake', tr.drum);
    nextT += stepDur;
    step += 1;
  }
}

function startMusic(): void {
  if (musicStarted) return;
  const c = ac();
  if (!c) return;
  musicStarted = true;
  nextT = c.currentTime + 0.2;
  window.setInterval(schedule, 60);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      musicOn = !musicOn;
      if (musicGain) musicGain.gain.value = musicOn ? 0.9 : 0;
      if (musicOn && ctx) nextT = ctx.currentTime + 0.1;
    }
  });
}

let ambientOn = false;
let inSpace = false;

/** Evening ambience: soft drone, crickets and the odd bird. Starts once. */
function startAmbience(): void {
  if (ambientOn) return;
  const c = ac();
  if (!c) return;
  ambientOn = true;
  startMusic();
  for (const f of [110, 164.8, 220]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.value = 0.0015;
    o.connect(g).connect(c.destination);
    o.start();
  }
  window.setInterval(() => {
    if (!inSpace && Math.random() < 0.6) {
      const base = 4000 + Math.random() * 600;
      for (let i = 0; i < 3; i++) tone(base, 0.035, 0.008, 'sine', undefined, i * 0.05);
    }
  }, 240);
  window.setInterval(() => {
    if (!inSpace && Math.random() < 0.5) {
      tone(1500 + Math.random() * 400, 0.18, 0.02, 'sine', 2300);
      tone(1800, 0.12, 0.015, 'sine', 2600, 0.22);
    }
  }, 6500);
}

export const sfx = {
  ambience: startAmbience,
  /** crickets and birds are for the village only */
  setSpace(on: boolean): void {
    inSpace = on;
  },
  /** travelling to another world */
  warp(): void {
    tone(180, 0.9, 0.12, 'sine', 900);
    tone(360, 0.9, 0.08, 'triangle', 1400, 0.1);
    burst(0.7, 0.07, 1200, 0.4);
  },
  /** glass-marble click; strength 0..1 */
  clack(strength: number): void {
    const v = 0.08 + 0.25 * Math.min(1, strength);
    tone(1800 + Math.random() * 600, 0.07, v, 'triangle', 900);
    burst(0.03, v * 0.6, 4000, 2);
  },
  shot(power: number): void {
    tone(300 + power * 200, 0.12, 0.2, 'triangle', 120);
    burst(0.1, 0.12, 900, 0.8);
  },
  grab(): void {
    tone(660, 0.06, 0.1, 'sine', 880);
  },
  win(): void {
    tone(523, 0.18, 0.2, 'triangle', undefined, 0);
    tone(659, 0.18, 0.2, 'triangle', undefined, 0.12);
    tone(784, 0.3, 0.22, 'triangle', undefined, 0.24);
  },
  lose(): void {
    tone(330, 0.25, 0.2, 'sawtooth', 160);
  },
  /** marble dropping into the hole */
  plop(): void {
    tone(420, 0.14, 0.18, 'sine', 140);
    tone(180, 0.1, 0.1, 'triangle', 90, 0.08);
  },
  select(): void {
    tone(520, 0.08, 0.15, 'triangle', 780);
  },
  /** slicing a kite string */
  cut(): void {
    burst(0.18, 0.3, 3000, 0.7);
    tone(900, 0.2, 0.15, 'sawtooth', 300);
  },
  hurt(): void {
    tone(200, 0.3, 0.25, 'square', 80);
  },
  whoosh(): void {
    burst(0.25, 0.08, 600, 0.5);
  },
  /** wood on wood: a dry, hollow knock (danda hitting the guli); strength 0..1 */
  wood(strength: number): void {
    const v = 0.1 + 0.3 * Math.min(1, strength);
    tone(420 + Math.random() * 60, 0.09, v, 'triangle', 300);
    tone(1150 + Math.random() * 120, 0.05, v * 0.6, 'sine', 800);
    burst(0.025, v * 0.5, 2500, 1.5);
  },
  /** the guli landing on packed earth */
  thud(strength: number): void {
    const v = 0.06 + 0.16 * Math.min(1, strength);
    tone(110, 0.14, v, 'sine', 60);
    burst(0.06, v * 0.7, 500, 0.8);
  },
};
