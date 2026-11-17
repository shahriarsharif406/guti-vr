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

let master: GainNode | null = null;
let masterVol = 0.9;
/** Single output bus: every sound goes through one master gain (volume keys). */
function dest(c: AudioContext): AudioNode {
  if (!master) {
    master = c.createGain();
    master.gain.value = masterVol;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(c.destination);
  }
  return master;
}
/** Adaptive music/mix state driven by the GearShift bench (0..1). */
export const musicState = { tension: 0, jam: 0, swell: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === '[' || e.key === ']') {
      masterVol = Math.max(0, Math.min(1, masterVol + (e.key === ']' ? 0.15 : -0.15)));
      if (master) master.gain.value = masterVol;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
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
    sp.connect(dest(c));
  } else node.connect(dest(c));
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

// Cinematic score: warm string pad, felt-piano arpeggios, a sparse bell melody and a soft sub, in D minor.
// Each screen gets its own colour (menu: open and gentle; gears: darker with a clockwork pulse; others: lighter).
type Colour = 'menu' | 'gears' | 'play';
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
// Dm9 - Bb - F - C : bass note + pad voicing (MIDI)
const PROG: { bass: number; pad: number[] }[] = [
  { bass: 38, pad: [50, 57, 60, 64, 65] },
  { bass: 34, pad: [46, 53, 58, 62, 65] },
  { bass: 41, pad: [53, 57, 60, 64, 67] },
  { bass: 36, pad: [48, 55, 60, 64, 67] },
];
const MELODY = [62, 65, 67, 69, 72, 74, 77]; // D minor pentatonic-ish, upper register

let musicGain: GainNode | null = null;
let musicOn = true;
let musicStarted = false;
let curColour: Colour | '' = '';
let step = 0;
let nextT = 0;
let bar = 0;
let reverb: ConvolverNode | null = null;
let melodyIdx = 2;

function colourFor(): Colour {
  const m = modeState.mode;
  return m === 'menu' ? 'menu' : m === 'gears' ? 'gears' : 'play';
}

function out(c: AudioContext): AudioNode {
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = musicOn ? 0.8 : 0;
    // long, soft hall reverb from decaying noise
    const len = Math.floor(c.sampleRate * 3.4);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 3.2);
    }
    reverb = c.createConvolver();
    reverb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet);
    wet.connect(dest(c));
    musicGain.connect(dest(c));
    musicGain.connect(reverb);
  }
  return musicGain;
}

type Voice = 'pad' | 'piano' | 'bell' | 'sub' | 'box';
function mNote(c: AudioContext, t: number, freq: number, dur: number, vol: number, kind: Voice): void {
  const dest = out(c);
  const g = c.createGain();
  g.connect(dest);
  if (kind === 'pad') {
    // three detuned saws through a slow lowpass: a warm string section
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(420, t + dur);
    f.connect(g);
    for (const det of [-7, 0, 8]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(1.6, dur * 0.4));
    g.gain.setValueAtTime(vol, t + dur * 0.65);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else if (kind === 'piano') {
    // felt piano: sine + soft octave, hammer tick, quick decay
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = freq;
    o2.frequency.value = freq * 2;
    g2.gain.value = 0.22;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  } else if (kind === 'box') {
    // music box: bright comb tine, fast decay
    [1, 3.01, 6.2].forEach((m, k) => {
      const o = c.createOscillator();
      const gg = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * m;
      gg.gain.setValueAtTime(vol / (1 + k * 2.2), t);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + k));
      o.connect(gg);
      gg.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  } else if (kind === 'bell') {
    // glassy bell: inharmonic partials with a long ring
    [1, 2.76, 5.4].forEach((m, k) => {
      const o = c.createOscillator();
      const gg = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * m;
      gg.gain.setValueAtTime(vol / (1 + k * 1.8), t);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + k * 0.7));
      o.connect(gg);
      gg.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  } else {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const BPM = 66;
function schedule(): void {
  const c = ctx;
  if (!c || !musicOn) return;
  const col = colourFor();
  if (col !== curColour) {
    curColour = col;
    nextT = Math.max(nextT, c.currentTime + 0.15);
  }
  const stepDur = 60 / BPM / 2; // eighth notes; 8 per bar (4 beats)
  while (nextT < c.currentTime + 0.3) {
    const s = step % 8;
    const chord = PROG[Math.floor(bar) % 4];
    if (s === 0) {
      const barDur = stepDur * 8;
      for (const n of chord.pad) mNote(c, nextT, midi(n), barDur * 1.05, col === 'gears' ? 0.012 : 0.016, 'pad');
      mNote(c, nextT, midi(chord.bass), barDur, 0.09, 'sub');
    }
    // piano arpeggio: rising pattern over the chord tones, with gaps so it breathes
    const arp = [0, 2, 3, 1, 4, 2, 3, 4];
    if (col !== 'gears' || s % 2 === 0) {
      if (Math.random() < (col === 'menu' ? 0.82 : col === 'gears' ? 0.7 : 0.88)) {
        const n = chord.pad[arp[s] % chord.pad.length] + 12;
        mNote(c, nextT, midi(n), 1.8, col === 'gears' ? 0.03 : 0.04, 'piano');
      }
    }
    // sparse melody bell, wandering stepwise
    if ((s === 0 || s === 4) && Math.random() < 0.55) {
      melodyIdx = Math.max(0, Math.min(MELODY.length - 1, melodyIdx + Math.floor(Math.random() * 3) - 1));
      mNote(c, nextT + (Math.random() < 0.4 ? stepDur : 0), midi(MELODY[melodyIdx] + 12), 3.2, 0.03, 'bell');
    }
    const ms = musicState;
    if (col === 'menu' && s % 2 === 1 && Math.random() < 0.6) {
      const n = chord.pad[(s + bar) % chord.pad.length] + 24;
      mNote(c, nextT, midi(n), 1.2, 0.03, 'box');
    }
    if (col === 'gears' && ms.tension > 0.2 && s % 2 === 0) {
      // running machine: low pulse that grows with tension
      mNote(c, nextT, midi(chord.bass + (s % 4 === 0 ? 12 : 19)), 0.4, 0.05 * ms.tension, 'piano');
      if (s === 0) for (const n of chord.pad.slice(0, 3)) mNote(c, nextT, midi(n - 12), stepDur * 8, 0.02 * ms.tension, 'pad');
    }
    if (col === 'gears' && ms.jam > 0.3 && s % 4 === 0) {
      // tritone against the bass: unease
      mNote(c, nextT, midi(chord.bass + 18), 1.2, 0.045 * ms.jam, 'bell');
      mNote(c, nextT, midi(chord.bass + 12), 1.2, 0.04 * ms.jam, 'bell');
    }
    if (col === 'gears' && ms.swell > 0.3 && s % 2 === 0) {
      mNote(c, nextT, midi(MELODY[(s + bar) % MELODY.length] + 12), 2.4, 0.05 * ms.swell, 'bell');
      if (s === 0) for (const n of chord.pad) mNote(c, nextT, midi(n + 12), stepDur * 8, 0.02 * ms.swell, 'pad');
    }
    // clockwork pulse for the GearShift bench: a soft tick on every beat
    if (col === 'gears' && s % 2 === 0) {
      const g = c.createGain();
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = s % 4 === 0 ? 1900 : 1400;
      g.gain.setValueAtTime(0.012, nextT);
      g.gain.exponentialRampToValueAtTime(0.0001, nextT + 0.03);
      o.connect(g);
      g.connect(out(c));
      o.start(nextT);
      o.stop(nextT + 0.04);
    }
    nextT += stepDur;
    step += 1;
    if (step % 8 === 0) bar += 1;
  }
}

function startMusic(): void {
  if (musicStarted) return;
  const c = ac();
  if (!c) return;
  musicStarted = true;
  nextT = c.currentTime + 0.3;
  window.setInterval(schedule, 80);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      musicOn = !musicOn;
      if (musicGain) musicGain.gain.value = musicOn ? 0.8 : 0;
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
    o.connect(g).connect(dest(c));
    o.start();
  }
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
        pan.connect(dest(c));
      } else {
        g.connect(dest(c));
        ng.connect(dest(c));
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
  /**
   * Tooth-mesh voice: a gated noise train whose click rate is the tooth-passing frequency
   * (rpm x teeth / 60). A fixed pool of three persistent voices is reused, so no nodes are created
   * while the machine runs. Pass rate 0 to silence a slot. kind picks the metal's tone.
   */
  mesh(slot: number, clicksPerSec: number, kind: 'brass' | 'bronze' | 'copper' | 'iron', vol: number, pan = 0): void {
    const c = ac();
    if (!c || slot < 0 || slot >= 3) return;
    let v = meshVoices[slot];
    if (!v) {
      if (clicksPerSec <= 0.01) return;
      const n = c.createBufferSource();
      n.buffer = noise(c);
      n.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      const gate = c.createGain(); // amplitude set by the square LFO below
      gate.gain.value = 0;
      const lfo = c.createOscillator();
      lfo.type = 'square';
      const depth = c.createGain();
      depth.gain.value = 0.5;
      const bias = c.createConstantSource();
      bias.offset.value = 0.5;
      lfo.connect(depth);
      depth.connect(gate.gain);
      bias.connect(gate.gain);
      const level = c.createGain();
      level.gain.value = 0;
      const sp = c.createStereoPanner ? c.createStereoPanner() : null;
      n.connect(bp);
      bp.connect(gate);
      gate.connect(level);
      if (sp) {
        level.connect(sp);
        sp.connect(dest(c));
      } else level.connect(dest(c));
      n.start();
      lfo.start();
      bias.start();
      v = { bp, lfo, level, sp };
      meshVoices[slot] = v;
    }
    const t = c.currentTime;
    const cf = { brass: 3600, bronze: 2800, copper: 2100, iron: 650 }[kind];
    v.lfo.frequency.setTargetAtTime(Math.max(0.1, clicksPerSec), t, 0.05);
    v.bp.frequency.setTargetAtTime(cf, t, 0.05);
    v.bp.Q.setTargetAtTime(kind === 'iron' ? 1.4 : 4, t, 0.05);
    v.level.gain.setTargetAtTime(clicksPerSec > 0.01 ? vol * (kind === 'iron' ? 0.7 : 0.35) : 0, t, 0.06);
    if (v.sp) v.sp.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  },
  /** gritty bite when teeth first engage or the train reverses */
  crunch(kind: 'brass' | 'bronze' | 'copper' | 'iron' = 'bronze', pan = 0): void {
    withPan(pan, () => {
      burst(0.12, 0.22, kind === 'iron' ? 700 : 2400, 0.9);
      burst(0.06, 0.18, 5200, 1.5);
      tone(kind === 'iron' ? 95 : 260, 0.12, 0.1, 'sawtooth', kind === 'iron' ? 60 : 140);
    });
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
    lp.connect(dest(c));
    // soft echo: delay line with feedback, torn down when the piece is over
    const dl = c.createDelay(1.5);
    dl.delayTime.value = 0.62;
    const fb = c.createGain();
    fb.gain.value = 0.42;
    const wet = c.createGain();
    wet.gain.value = 0.5;
    lp.connect(dl);
    dl.connect(fb);
    fb.connect(dl);
    dl.connect(wet);
    wet.connect(dest(c));
    window.setTimeout(() => {
      for (const n of [master, lp, dl, fb, wet]) n.disconnect();
    }, 18000);
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
const meshVoices: ({ bp: BiquadFilterNode; lfo: OscillatorNode; level: GainNode; sp: StereoPannerNode | null } | undefined)[] = [];
let whirrNode: { o: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode; nf: BiquadFilterNode; ng: GainNode; lfo: OscillatorNode; lg: GainNode } | null = null;
