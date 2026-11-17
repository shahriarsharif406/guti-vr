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

/** Stereo position (-1 left .. 1 right) applied to the next procedural sounds; see withPan. */
let panV = 0;
export function withPan(p: number, f: () => void): void {
  panV = Math.max(-1, Math.min(1, p));
  try {
    f();
  } finally {
    panV = 0;
  }
}
/** Connect a node to the speakers, panned if a position is active. */
function outTo(c: AudioContext, node: AudioNode): void {
  if (panV !== 0 && typeof c.createStereoPanner === 'function') {
    const sp = c.createStereoPanner();
    sp.pan.value = panV;
    node.connect(sp);
    sp.connect(c.destination);
  } else node.connect(c.destination);
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
  o.connect(g);
  outTo(c, g);
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
  s.connect(f).connect(g);
  outTo(c, g);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}


// ------------------------------------------------------------ samples
// Real recordings: "Oculus Audio Pack 01" by Oculus VR, LLC (CC BY 4.0).
// Procedural sounds stay as the fallback until a sample has loaded.
const SAMPLE_FILES: Record<string, string> = {
  confirm: 'UIClick_CasualPopsConfirm_OS_01',
  close: 'UIClick_CasualPopsClose_OS_01',
  wood: 'WOODImpt_LargeWoodDrop_OS_01',
  plastic: 'PLASImpt_PlasticObjDrop_OS_01',
  ceramic: 'CERMImpt_CeramicSmallImpact_OS_01',
  metal: 'METLImpt_MetalHitSurface_OS_01',
  win: 'MUSCStngr_LevelUpMallet_OS_01',
  lose: 'MUSCStngr_LossMallet_OS_01',
  whoosh: 'WHSH_WhooshMedium_OS_01',
  room: 'AMBHome_RoomTone_LOOP_01',
};
const samples: Record<string, AudioBuffer> = {};
let loading = false;

function loadSamples(): void {
  const c = ac();
  if (!c || loading) return;
  loading = true;
  for (const [k, f] of Object.entries(SAMPLE_FILES)) {
    fetch(import.meta.env.BASE_URL + 'audio/' + f + '.ogg')
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .then((buf) => {
        samples[k] = buf;
      })
      .catch(() => {});
  }
}

/** play a loaded sample; returns false when it is not available yet */
function play(key: string, vol = 1, rate = 1, loop = false): boolean {
  const c = ac();
  const buf = samples[key];
  if (!c || !buf) return false;
  const s = c.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  s.loop = loop;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(g);
  outTo(c, g);
  s.start();
  return true;
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
  return m === 'kite' || m === 'kitecraft' ? 'kite' : m === 'lattim' || m === 'danguli' ? 'lattim' : 'calm';
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
  loadSamples();
  window.setTimeout(() => play('room', 0.35, 1, true), 1500);
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
    if (play('plastic', 0.25 + 0.6 * Math.min(1, strength), 0.9 + Math.random() * 0.25)) return;
    const v = 0.08 + 0.25 * Math.min(1, strength);
    tone(1800 + Math.random() * 600, 0.07, v, 'triangle', 900);
    burst(0.03, v * 0.6, 4000, 2);
  },
  shot(power: number): void {
    tone(300 + power * 200, 0.12, 0.2, 'triangle', 120);
    burst(0.1, 0.12, 900, 0.8);
  },
  grab(): void {
    if (play('close', 0.5, 1.2)) return;
    tone(660, 0.06, 0.1, 'sine', 880);
  },
  win(): void {
    if (play('win', 0.8)) return;
    tone(523, 0.18, 0.2, 'triangle', undefined, 0);
    tone(659, 0.18, 0.2, 'triangle', undefined, 0.12);
    tone(784, 0.3, 0.22, 'triangle', undefined, 0.24);
  },
  lose(): void {
    if (play('lose', 0.8)) return;
    tone(330, 0.25, 0.2, 'sawtooth', 160);
  },
  /** marble dropping into the hole */
  plop(): void {
    if (play('ceramic', 0.9, 0.8)) return;
    tone(420, 0.14, 0.18, 'sine', 140);
    tone(180, 0.1, 0.1, 'triangle', 90, 0.08);
  },
  select(): void {
    if (play('confirm', 0.7)) return;
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
    if (play('whoosh', 0.5)) return;
    burst(0.25, 0.08, 600, 0.5);
  },
  /** wood on wood: a dry, hollow knock (danda hitting the guli); strength 0..1 */
  wood(strength: number): void {
    if (play('wood', 0.2 + 0.6 * Math.min(1, strength), 1.1 + Math.random() * 0.4)) return;
    const v = 0.1 + 0.3 * Math.min(1, strength);
    tone(420 + Math.random() * 60, 0.09, v, 'triangle', 300);
    tone(1150 + Math.random() * 120, 0.05, v * 0.6, 'sine', 800);
    burst(0.025, v * 0.5, 2500, 1.5);
  },
  /** wet clay squelch while sculpting */
  clay(): void {
    burst(0.05, 0.035, 420 + Math.random() * 120, 0.7);
  },
  /** kiln roar, then a soft chime */
  kiln(): void {
    burst(0.9, 0.09, 260, 0.4);
    tone(660, 0.5, 0.12, 'sine', 990, 0.7);
    tone(880, 0.6, 0.1, 'sine', undefined, 0.9);
  },
  /** the guli landing on packed earth */
  thud(strength: number): void {
    if (play('metal', 0.3 + 0.6 * Math.min(1, strength), 0.7)) return;
    const v = 0.06 + 0.16 * Math.min(1, strength);
    tone(110, 0.14, v, 'sine', 60);
    burst(0.06, v * 0.7, 500, 0.8);
  },
  /** a soft gear tick while a machine runs */
  tick(): void {
    if (play('metal', 0.07, 1.7 + Math.random() * 0.4)) return;
    burst(0.02, 0.03, 2500, 0.8);
  },
  /** clock tick-tock from the escapement; pan places it in the room; rpm 0..1 */
  tickTock(tock: boolean, rpm: number, pan = 0): void {
    withPan(pan, () => {
      const f = (tock ? 1500 : 2100) * (0.9 + rpm * 0.3);
      tone(f, 0.035, 0.09, 'square', f * 0.6);
      burst(0.02, 0.05, f * 1.6, 2);
      play('metal', 0.05, (tock ? 1.3 : 1.8) + rpm * 0.3);
    });
  },
  /**
   * Steam-turbine whirr: filtered saw + triangle, plus noise whose band-pass centre is frequency-modulated.
   * Call every frame with rpm 0..1; 0 fades it out.
   */
  whirr(rpm: number): void {
    const c = ac();
    if (!c) return;
    if (!whirrNode) {
      if (rpm <= 0.01) return;
      const o = c.createOscillator();
      const o2 = c.createOscillator();
      const f = c.createBiquadFilter();
      const g = c.createGain();
      const n = c.createBufferSource();
      n.buffer = noise(c);
      n.loop = true;
      const nf = c.createBiquadFilter();
      const ng = c.createGain();
      const lfo = c.createOscillator();
      const lg = c.createGain();
      o.type = 'sawtooth';
      o2.type = 'triangle';
      f.type = 'lowpass';
      f.frequency.value = 500;
      g.gain.value = 0;
      nf.type = 'bandpass';
      nf.Q.value = 1.4;
      nf.frequency.value = 900;
      ng.gain.value = 0;
      lfo.frequency.value = 7;
      lg.gain.value = 300;
      lfo.connect(lg);
      lg.connect(nf.frequency); // FM on the noise band
      o.connect(f);
      o2.connect(f);
      f.connect(g);
      n.connect(nf);
      nf.connect(ng);
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = 0.15;
        g.connect(pan);
        ng.connect(pan);
        pan.connect(c.destination);
      } else {
        g.connect(c.destination);
        ng.connect(c.destination);
      }
      o.start();
      o2.start();
      n.start();
      lfo.start();
      whirrNode = { o, o2, g, f, nf, ng, lfo, lg };
    }
    const t = c.currentTime;
    const w = whirrNode;
    w.o.frequency.setTargetAtTime(55 + rpm * 110, t, 0.1);
    w.o2.frequency.setTargetAtTime(110 + rpm * 220, t, 0.1);
    w.f.frequency.setTargetAtTime(300 + rpm * 700, t, 0.1);
    w.nf.frequency.setTargetAtTime(500 + rpm * 1800, t, 0.1);
    w.lfo.frequency.setTargetAtTime(4 + rpm * 22, t, 0.1);
    w.lg.gain.setTargetAtTime(150 + rpm * 700, t, 0.1);
    w.g.gain.setTargetAtTime(rpm > 0.01 ? 0.016 + rpm * 0.028 : 0, t, 0.12);
    w.ng.gain.setTargetAtTime(rpm > 0.01 ? 0.01 + rpm * 0.05 : 0, t, 0.12);
  },
  /** steam released; pan 1 = from the right-side valves */
  hiss(pan = 0.8): void {
    withPan(pan, () => {
      burst(1.3, 0.12, 5200, 0.5);
      burst(0.9, 0.08, 2600, 0.4);
    });
  },
  /** a gear seats on its shaft; bronze/brass ring higher than iron */
  clank(kind: 'brass' | 'bronze' | 'copper' | 'iron' = 'bronze', pan = 0): void {
    const ring: Record<string, number[]> = { brass: [1320, 2480, 3510], bronze: [980, 1870, 2650], copper: [760, 1500, 2230], iron: [330, 720, 1190] };
    const f = ring[kind];
    withPan(pan, () => {
      if (!play('metal', 0.55, kind === 'iron' ? 0.55 : 0.75 + Math.random() * 0.15)) burst(0.05, 0.3, 900, 3);
      tone(kind === 'iron' ? 120 : 180, 0.25, 0.14, 'triangle', 80);
      tone(f[0], kind === 'iron' ? 0.18 : 0.5, 0.07, 'sine', f[0] * 0.98);
      tone(f[1], kind === 'iron' ? 0.12 : 0.35, 0.045, 'sine', f[1] * 0.98);
      tone(f[2], kind === 'iron' ? 0.08 : 0.25, 0.03, 'sine');
    });
  },
  /** teeth grinding in a jam */
  grind(pan = 0): void {
    withPan(pan, () => {
      burst(0.35, 0.2, 1800 + Math.random() * 600, 1.2);
      tone(90 + Math.random() * 30, 0.35, 0.12, 'sawtooth', 70);
    });
  },
  /** harmonic chime chord on success */
  chime(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(f, 1.6, 0.1, 'sine', undefined, i * 0.13);
      tone(f * 2, 1.1, 0.03, 'sine', undefined, i * 0.13);
    });
  },
  /** lever slammed down */
  lever(): void {
    tone(70, 0.3, 0.3, 'triangle', 40);
    burst(0.06, 0.25, 700, 2);
    tone(1600, 0.2, 0.04, 'sine');
  },
  /** finale: a swelling, cascading major-chord drone while the orrery unfolds (about 9 seconds) */
  finale(): void {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.5, t0 + 6);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 11);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t0);
    lp.frequency.exponentialRampToValueAtTime(5000, t0 + 6);
    master.connect(lp);
    lp.connect(c.destination);
    const notes = [65.41, 130.81, 196, 261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5]; // C major stack
    notes.forEach((f, i) => {
      for (const det of [-4, 4]) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = i < 3 ? 'sawtooth' : 'sine';
        o.frequency.value = f;
        o.detune.value = det;
        const start = t0 + i * 0.45; // cascade upward
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(i < 3 ? 0.035 : 0.05, start + 1.5);
        o.connect(g);
        g.connect(master);
        o.start(start);
        o.stop(t0 + 11.5);
      }
    });
  },
};
let whirrNode: { o: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode; nf: BiquadFilterNode; ng: GainNode; lfo: OscillatorNode; lg: GainNode } | null = null;
