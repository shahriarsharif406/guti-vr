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
let sfxBus: GainNode | null = null;
let masterVol = 0.9;
let muted = false;
let sfxVol = 1;
let musicVol = 1;
const applyMaster = (): void => {
  if (master) master.gain.value = muted ? 0 : masterVol;
};
export function setMasterVolume(v: number): void {
  masterVol = Math.max(0, Math.min(1, v));
  applyMaster();
}
export const getMasterVolume = (): number => masterVol;
export function setMuted(m: boolean): void {
  muted = m;
  applyMaster();
}
export const isMuted = (): boolean => muted;
/** Effects bus volume (0..1), separate from the music bus. */
export function setSfxVolume(v: number): void {
  sfxVol = Math.max(0, Math.min(1, v));
  if (sfxBus) sfxBus.gain.value = sfxVol;
}
export const getSfxVolume = (): number => sfxVol;
/** Ambient music volume (0..1). */
export function setMusicVolume(v: number): void {
  musicVol = Math.max(0, Math.min(1, v));
  if (musicGain && musicOn) musicGain.gain.value = 0.8 * musicVol;
}
export const getMusicVolume = (): number => musicVol;
/** Single output bus: every sound goes through one master gain (volume keys). */
function mainOut(c: AudioContext): AudioNode {
  dest(c);
  return master as GainNode;
}
function dest(c: AudioContext): AudioNode {
  if (!master) {
    master = c.createGain();
    master.gain.value = muted ? 0 : masterVol;
    sfxBus = c.createGain();
    sfxBus.gain.value = sfxVol;
    sfxBus.connect(master);
    const comp = c.createDynamicsCompressor();
    // gentle glue compressor (slow attack so tooth clicks do not pump the music), then a brick-wall limiter
    comp.threshold.value = -10;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.1;
    master.connect(comp);
    comp.connect(lim);
    lim.connect(c.destination);
  }
  return sfxBus as GainNode;
}
/** Adaptive music/mix state driven by the GearShift bench (0..1). */
export const musicState = { tension: 0, jam: 0, swell: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === '[' || e.key === ']') {
      masterVol = Math.max(0, Math.min(1, masterVol + (e.key === ']' ? 0.15 : -0.15)));
      applyMaster();
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
type Colour = 'menu' | 'gears' | 'play' | 'aura' | 'spell';
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
// Dm9 - Bb - F - C : bass note + pad voicing (MIDI)
const PROG: { bass: number; pad: number[] }[] = [
  { bass: 38, pad: [50, 57, 60, 64, 65] },
  { bass: 34, pad: [46, 53, 58, 62, 65] },
  { bass: 41, pad: [53, 57, 60, 64, 67] },
  { bass: 36, pad: [48, 55, 60, 64, 67] },
];
const MELODY = [62, 65, 67, 69, 72, 74, 77]; // D minor pentatonic-ish, upper register
// Aura Weaver: open, luminous D major colours that bloom as the sanctuary is restored
const AURA_PROG: { bass: number; pad: number[] }[] = [
  { bass: 38, pad: [50, 54, 57, 61, 64] },
  { bass: 35, pad: [47, 54, 57, 61, 66] },
  { bass: 43, pad: [55, 59, 62, 66, 69] },
  { bass: 45, pad: [57, 61, 64, 66, 69] },
];
const AURA_MELODY = [62, 64, 66, 69, 71, 74, 76];
// Spellforge: dark, heroic A minor. tension = combat intensity, jam = boss fight.
const SPELL_PROG: { bass: number; pad: number[] }[] = [
  { bass: 33, pad: [45, 52, 57, 60, 64] },
  { bass: 29, pad: [41, 53, 57, 60, 65] },
  { bass: 36, pad: [48, 55, 60, 64, 67] },
  { bass: 31, pad: [43, 55, 59, 62, 67] },
];
const SPELL_MELODY = [69, 71, 72, 74, 76, 79, 81];

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
  return m === 'menu' ? 'menu' : m === 'gears' ? 'gears' : m === 'aura' ? 'aura' : m === 'spell' ? 'spell' : 'play';
}

function out(c: AudioContext): AudioNode {
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = musicOn ? 0.8 * musicVol : 0;
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
    wet.connect(mainOut(c));
    musicGain.connect(mainOut(c));
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
  if (musicGain && musicOn) musicGain.gain.setTargetAtTime(musicVol * (curColour === 'spell' ? 0.8 : 0.8 - 0.5 * Math.max(musicState.tension, musicState.jam)), c.currentTime, 0.4);
  const stepDur = 60 / BPM / 2; // eighth notes; 8 per bar (4 beats)
  while (nextT < c.currentTime + 0.3) {
    const s = step % 8;
    const chord = (col === 'aura' ? AURA_PROG : PROG)[Math.floor(bar) % 4];
    if (col === 'spell') {
      const sp = SPELL_PROG[Math.floor(bar) % 4];
      const tn = musicState.tension;
      const boss = musicState.jam;
      if (s === 0) {
        for (const n of sp.pad) mNote(c, nextT, midi(n), stepDur * 8.4, 0.012 + 0.012 * tn, 'pad');
        mNote(c, nextT, midi(sp.bass), stepDur * 8, 0.08, 'sub');
        if (boss > 0.5) for (const n of sp.pad.slice(0, 3)) mNote(c, nextT, midi(n + 12), stepDur * 8, 0.012, 'pad');
      }
      if (tn > 0.15 && s % 2 === 0) mNote(c, nextT, midi(sp.bass + (s % 4 === 0 ? 12 : 19)), 0.35, 0.05 * tn + 0.02 * boss, 'piano');
      if (tn > 0.4 && s % 2 === 1) mNote(c, nextT, midi(sp.pad[(s + bar) % sp.pad.length] + 12), 0.5, 0.025 * tn, 'box');
      if (s % 2 === 1 && Math.random() < 0.35) mNote(c, nextT, midi(sp.pad[(s + bar) % sp.pad.length] + 24), 2.2, 0.02, 'bell');
      if ((s === 0 || s === 4) && Math.random() < 0.45 + 0.3 * boss) {
        melodyIdx = Math.max(0, Math.min(SPELL_MELODY.length - 1, melodyIdx + Math.floor(Math.random() * 3) - 1));
        mNote(c, nextT, midi(SPELL_MELODY[melodyIdx]), 2.6, 0.026 + 0.01 * boss, 'bell');
      }
      nextT += stepDur;
      step += 1;
      if (step % 8 === 0) bar += 1;
      continue;
    }
    if (col === 'aura') {
      const sw = musicState.swell;
      if (s === 0) {
        for (const n of chord.pad) mNote(c, nextT, midi(n), stepDur * 8.4, 0.012 + 0.016 * sw, 'pad');
        mNote(c, nextT, midi(chord.bass), stepDur * 8, 0.07, 'sub');
      }
      if (s % 2 === 1 && Math.random() < 0.3 + 0.5 * sw) mNote(c, nextT, midi(chord.pad[(s + bar) % chord.pad.length] + 24), 2.2, 0.018 + 0.02 * sw, 'bell');
      if ((s === 0 || s === 4) && Math.random() < 0.4 + 0.4 * sw) {
        melodyIdx = Math.max(0, Math.min(AURA_MELODY.length - 1, melodyIdx + Math.floor(Math.random() * 3) - 1));
        mNote(c, nextT, midi(AURA_MELODY[melodyIdx] + 12), 3.6, 0.026, 'box');
      }
      nextT += stepDur;
      step += 1;
      if (step % 8 === 0) bar += 1;
      continue;
    }
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
      if (musicGain) musicGain.gain.value = musicOn ? 0.8 * musicVol : 0;
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
    w.nf.frequency.setTargetAtTime(300 + rpm * 600, t, 0.1);
    w.lfo.frequency.setTargetAtTime(4 + rpm * 22, t, 0.1);
    w.lg.gain.setTargetAtTime(60 + rpm * 200, t, 0.1);
    w.g.gain.setTargetAtTime(rpm > 0.01 ? 0.02 + rpm * 0.03 : 0, t, 0.12);
    w.ng.gain.setTargetAtTime(rpm > 0.01 ? 0.004 + rpm * 0.012 : 0, t, 0.12);
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
      lfo.type = 'sine'; // soft pulse: a square gate made harsh, crackly edges
      const depth = c.createGain();
      depth.gain.value = 0.4;
      const bias = c.createConstantSource();
      bias.offset.value = 0.6;
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
    const cf = { brass: 1700, bronze: 1400, copper: 1100, iron: 520 }[kind];
    v.lfo.frequency.setTargetAtTime(Math.max(0.1, Math.min(9, clicksPerSec * 0.3)), t, 0.05);
    v.bp.frequency.setTargetAtTime(cf, t, 0.05);
    v.bp.Q.setTargetAtTime(1.2, t, 0.05);
    v.level.gain.setTargetAtTime(clicksPerSec > 0.01 ? vol * (kind === 'iron' ? 0.25 : 0.14) : 0, t, 0.06);
    if (v.sp) v.sp.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  },
  /** gritty bite when teeth first engage or the train reverses */
  crunch(kind: 'brass' | 'bronze' | 'copper' | 'iron' = 'bronze', pan = 0): void {
    withPan(pan, () => {
      burst(0.1, 0.12, kind === 'iron' ? 500 : 1200, 0.9);
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
  /** lever slammed home: heavy clunk with a mid body so laptop speakers carry it */
  lever(): void {
    tone(70, 0.3, 0.3, 'triangle', 40);
    burst(0.06, 0.25, 700, 2);
    tone(1600, 0.2, 0.04, 'sine');
  },
  /** ratchet click while a lever is dragged; up = release click */
  leverTick(up = false): void {
    tone(up ? 520 : 380, 0.04, 0.05, 'triangle', up ? 300 : 220);
    burst(0.02, 0.05, 1500, 2);
  },
  // ---------------------------------------------------------------- Aura Weaver
  /** Persistent colour voices: cyan = pure crystal, magenta = shimmering pair, gold = deep resonance. lv = 0..1 each. bend 0..1 shifts pitch with the selected element. */
  auraBeams(cy: number, ma: number, go: number, bend: number): void {
    const c = ac();
    if (!c) return;
    if (!auraV) {
      if (cy + ma + go < 0.01) return;
      const mk = (type: OscillatorType, f: number, det = 0): { o: OscillatorNode; g: GainNode } => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det;
        g.gain.value = 0;
        o.connect(g);
        g.connect(dest(c));
        o.start();
        return { o, g };
      };
      auraV = {
        cy: [mk('sine', 784), mk('sine', 1568)],
        ma: [mk('triangle', 587, -7), mk('triangle', 587, 7)],
        go: [mk('sine', 130.8), mk('triangle', 261.6)],
      };
    }
    const t = c.currentTime;
    const m = 1 + bend * 0.18;
    const set = (v: { o: OscillatorNode; g: GainNode }[], base: number[], lvl: number, vol: number[]): void => {
      v.forEach((n, i) => {
        n.o.frequency.setTargetAtTime(base[i] * m, t, 0.08);
        n.g.gain.setTargetAtTime(lvl * vol[i], t, 0.12);
      });
    };
    set(auraV.cy, [784, 1568], cy, [0.014, 0.004]);
    set(auraV.ma, [587, 587], ma, [0.01, 0.01]);
    set(auraV.go, [130.8, 261.6], go, [0.03, 0.008]);
  },
  /** crystal tick when a dial passes a step; pitch climbs a pentatonic scale with the angle */
  auraTick(stepIdx: number): void {
    const sc = [0, 2, 4, 7, 9];
    const n = sc[((stepIdx % 5) + 5) % 5] + 12 * Math.floor(stepIdx / 5 % 3);
    tone(523.25 * Math.pow(2, n / 12), 0.35, 0.06, 'sine');
    tone(1046.5 * Math.pow(2, n / 12), 0.2, 0.02, 'sine');
  },
  /** a monolith wakes: cascading chord with echo and a rising shimmer */
  auraAwaken(idx: number, chapter: number): void {
    const roots = [261.63, 293.66, 329.63, 392, 440];
    const r = roots[Math.min(4, Math.max(0, chapter))] * (idx === 1 ? 1.5 : idx === 2 ? 2 : 1);
    [1, 1.5, 2, 3, 4].forEach((m, i) => {
      tone(r * m, 2.4, 0.07 / (1 + i * 0.4), 'sine', undefined, i * 0.11);
      tone(r * m * 1.003, 2.0, 0.03, 'triangle', undefined, i * 0.11 + 0.01);
      tone(r * m, 1.6, 0.025, 'sine', undefined, i * 0.11 + 0.34);
    });
    withPan(0, () => burst(0.9, 0.04, 3200, 0.6));
  },
  /** gentle wrong mix: a soft low interval, never a harsh buzz */
  auraImpure(): void {
    tone(196, 0.5, 0.05, 'sine', 180);
    tone(207.7, 0.5, 0.04, 'sine', 190);
  },
  /** level complete: world pulse sweep + wide major chord */
  auraPulse(): void {
    tone(110, 1.8, 0.1, 'sine', 330);
    [523.25, 659.25, 783.99, 987.77, 1318.5].forEach((f, i) => tone(f, 3.2, 0.06, 'sine', undefined, 0.15 + i * 0.16));
    burst(1.6, 0.05, 1400, 0.4);
  },
  /** the final awakening: long layered harmonies */
  auraFinale(): void {
    const base = 146.83;
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].forEach((m, i) => {
      tone(base * m, 9, 0.05 / (1 + i * 0.25), 'sine', undefined, i * 0.6);
      tone(base * m * 1.004, 8, 0.02, 'triangle', undefined, i * 0.6 + 0.02);
    });
    burst(5, 0.05, 900, 0.4);
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
  // ---------------------------------------------------------------- Spellforge
  /** persistent charge voice: lvl 0..1 (size), el 0..5 (element index). lvl 0 silences it */
  spellVoice(lvl: number, el: number): void {
    const c = ac();
    if (!c) return;
    if (!spellV) {
      if (lvl < 0.01) return;
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      const f = c.createBiquadFilter();
      const g = c.createGain();
      o1.type = 'sawtooth';
      o2.type = 'sine';
      f.type = 'lowpass';
      f.frequency.value = 500;
      g.gain.value = 0;
      o1.connect(f);
      o2.connect(g);
      f.connect(g);
      g.connect(dest(c));
      o1.start();
      o2.start();
      spellV = { o1, o2, f, g };
    }
    const base = [98, 233, 311, 174, 130, 82][el % 6];
    const t = c.currentTime;
    const m = 1 + lvl * 0.9;
    spellV.o1.frequency.setTargetAtTime(base * m, t, 0.06);
    spellV.o2.frequency.setTargetAtTime(base * m * 2.003, t, 0.06);
    spellV.f.frequency.setTargetAtTime(300 + lvl * 2200, t, 0.08);
    spellV.g.gain.setTargetAtTime(lvl < 0.01 ? 0 : 0.012 + lvl * 0.03, t, 0.1);
  },
  spellCast(el: number, power: number, pan = 0): void {
    withPan(pan, () => {
      const p = 0.6 + power * 0.5;
      if (el === 0) {
        burst(0.5, 0.12 * p, 700, 0.7);
        tone(120, 0.5, 0.12 * p, 'sawtooth', 60);
      } else if (el === 1) {
        tone(1800, 0.3, 0.07 * p, 'triangle', 700);
        tone(2600, 0.2, 0.03, 'sine', 1200);
        burst(0.12, 0.08, 6000, 2);
      } else if (el === 2) {
        burst(0.25, 0.16 * p, 3200, 0.6);
        tone(90, 0.35, 0.1 * p, 'square', 40);
      } else if (el === 3) {
        tone(330, 0.5, 0.07 * p, 'sine', 990);
        tone(332, 0.5, 0.06 * p, 'sine', 996);
      } else if (el === 4) {
        burst(0.4, 0.1 * p, 450, 0.8);
        tone(180, 0.4, 0.07, 'triangle', 260);
      } else {
        tone(70, 0.7, 0.12 * p, 'sine', 35);
        tone(140, 0.6, 0.05, 'sawtooth', 50);
      }
    });
  },
  spellHit(el: number, big = false, pan = 0): void {
    withPan(pan, () => {
      const v = big ? 1.6 : 1;
      const f = [260, 1400, 2200, 520, 200, 100][el % 6];
      burst(0.18 * v, 0.07 * v, f, 1.4);
      tone(f * 0.5, 0.18 * v, 0.05 * v, el === 1 ? 'triangle' : 'sine', f * 0.25);
    });
  },
  spellShield(on: boolean): void {
    if (on) {
      tone(440, 0.35, 0.06, 'sine', 880);
      tone(660, 0.45, 0.03, 'triangle', 1320, 0.05);
    } else tone(660, 0.25, 0.04, 'sine', 330);
  },
  spellBlock(): void {
    burst(0.12, 0.1, 2500, 2);
    tone(900, 0.2, 0.06, 'triangle', 500);
  },
  spellDiscover(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => {
      tone(f, 2.2, 0.06 / (1 + i * 0.2), 'sine', undefined, i * 0.09);
      tone(f * 1.004, 1.8, 0.02, 'triangle', undefined, i * 0.09 + 0.02);
    });
    burst(1.2, 0.04, 4200, 0.8);
  },
  spellUnlock(): void {
    [392, 523.25, 784, 1046.5].forEach((f, i) => tone(f, 1.6, 0.06, 'sine', undefined, i * 0.14));
  },
  spellFizzle(): void {
    tone(220, 0.25, 0.05, 'sawtooth', 110);
    burst(0.15, 0.04, 900, 1);
  },
  spellHurt(): void {
    tone(110, 0.35, 0.12, 'sawtooth', 55);
    burst(0.25, 0.1, 400, 0.8);
  },
  spellTelegraph(kind: number): void {
    const f = [330, 262, 392, 294][kind % 4];
    tone(f, 0.5, 0.05, 'triangle', f * 1.6);
  },
  bossRoar(): void {
    tone(55, 1.6, 0.16, 'sawtooth', 28);
    tone(82, 1.4, 0.08, 'square', 41);
    burst(1.4, 0.09, 220, 0.6);
  },
  spellDie(): void {
    tone(300, 0.4, 0.06, 'triangle', 80);
    burst(0.3, 0.06, 1200, 1);
  },
  spellStomp(): void {
    tone(70, 0.4, 0.15, 'sine', 30);
    burst(0.3, 0.12, 180, 0.6);
  },
  spellWin(): void {
    [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, 3.4, 0.06, 'sine', undefined, i * 0.2));
    burst(2, 0.04, 2200, 0.5);
  },
  spellLose(): void {
    [220, 185, 147].forEach((f, i) => tone(f, 2.4, 0.07, 'sine', f * 0.9, i * 0.3));
  },
};
let spellV: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
let auraV: { cy: { o: OscillatorNode; g: GainNode }[]; ma: { o: OscillatorNode; g: GainNode }[]; go: { o: OscillatorNode; g: GainNode }[] } | null = null;
const meshVoices: ({ bp: BiquadFilterNode; lfo: OscillatorNode; level: GainNode; sp: StereoPannerNode | null } | undefined)[] = [];
let whirrNode: { o: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode; nf: BiquadFilterNode; ng: GainNode; lfo: OscillatorNode; lg: GainNode } | null = null;
