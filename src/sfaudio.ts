/**
 * SPELLFORGE audio department.
 * - 3D positional one-shots: `at()` places shared procedural sounds at a world point through an HRTF
 *   PannerNode (audio.ts withPos); the listener follows the camera via `listener()`. Falls back to a
 *   stereo pan when PannerNode is unavailable.
 * - Adaptive battle music: a procedural layer (drums, ticks, boss ostinato, heartbeat, final-phase
 *   choir, phase stingers) on top of the shared spell music, mixed by sfmusic.ts rules.
 * No recorded audio. Nothing here was heard on a headset.
 */
import { audioCore, getMusicVolume, getSfxVolume, setListenerPose } from './audio.js';
import type { V3 } from './sfgesture';
import { musicMix, newMix } from './sfmusic.js';
import type { MusicMix } from './sfmusic.js';

const ROOTS = [38, 41, 36]; // Ignar (D), Vyra (F), Void King (C) - midi notes for the ostinato
const OST = [0, 0, 12, 0, 7, 0, 10, 3];
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

class SfAudio {
  /** current inputs (written each frame, read by the scheduler) */
  private active = false;
  private tension = 0;
  private phase = -1;
  private phases = 0;
  private hp = 1;
  private bossIdx = 0;
  readonly mix: MusicMix = newMix();
  private bus: GainNode | null = null;
  private timer = 0;
  private nextT = 0;
  private step = 0;
  private musicOn = true;
  private lastPhase = -1;
  /** counts of scheduled notes per layer (exposed for the e2e test) */
  readonly played = { drums: 0, hats: 0, ostinato: 0, heartbeat: 0, choir: 0, stingers: 0, ambient: 0 };

  /** listener = head pose (world). Call once per frame. */
  listener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    setListenerPose(px, py, pz, fx, fy, fz, ux, uy, uz);
  }
  // ------------------------------------------------------------------ battle sound design
  // Own gain staging: the shared audio.ts spell sounds peak at 0.05-0.16 and the HRTF panner attenuates them
  // again at 8-10 m, which left battle effects tens of dB under the music. Everything below is mixed here.
  private sfxBus: GainNode | null = null;
  private meter: AnalyserNode | null = null;
  private meterBuf: Float32Array | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private live = 0;
  private unlockHooked = false;
  /** debug counters for the e2e test */
  readonly sfxCount = { cast: 0, hit: 0, die: 0, telegraph: 0, hurt: 0, block: 0, other: 0 };

  /** create / resume the AudioContext on the first user gesture so sounds are never lost to autoplay rules */
  unlockOnGesture(): void {
    if (this.unlockHooked || typeof window === 'undefined') return;
    this.unlockHooked = true;
    const go = (): void => {
      audioCore();
      this.ensureBus();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, go, { passive: true });
  }
  private ensureBus(): { c: AudioContext; bus: GainNode } | null {
    const core = audioCore();
    if (!core) return null;
    if (!this.sfxBus) {
      const c = core.ctx;
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = 1.6;
      // soft saturation (tanh) so big hits get fat and dense instead of clipping
      const sat = c.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.2) / Math.tanh(2.2);
      sat.curve = curve;
      sat.oversample = '2x';
      const trim = c.createGain();
      trim.gain.value = 0.66;
      this.sfxBus.connect(sat).connect(trim).connect(core.out);
      this.meter = c.createAnalyser();
      this.meter.fftSize = 1024;
      this.meterBuf = new Float32Array(this.meter.fftSize);
      trim.connect(this.meter);
    }
    this.sfxBus.gain.value = 1.6 * getSfxVolume();
    return { c: core.ctx, bus: this.sfxBus };
  }
  /** peak of the battle effects bus over the last analysis window (0..1+), for tests */
  peak(): number {
    if (!this.meter || !this.meterBuf) return 0;
    this.meter.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let m = 0;
    for (let i = 0; i < this.meterBuf.length; i++) m = Math.max(m, Math.abs(this.meterBuf[i]));
    return m;
  }
  private noise(c: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const n = Math.floor(c.sampleRate * 1.2);
      this.noiseBuf = c.createBuffer(1, n, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }
  /** route a voice to the bus, panned by world x (a light stereo pan: no distance loss, so far enemies stay audible) */
  private dest(c: AudioContext, bus: GainNode, x: number): AudioNode {
    if (!x || typeof c.createStereoPanner !== 'function') return bus;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-0.85, Math.min(0.85, x / 5));
    p.connect(bus);
    return p;
  }
  private begin(c: AudioContext, dur: number): boolean {
    if (this.live >= 40) return false; // voice cap
    this.live++;
    window.setTimeout(() => (this.live = Math.max(0, this.live - 1)), (dur + 0.1) * 1000);
    return true;
  }
  private tn(c: AudioContext, d: AudioNode, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, lp = 0): void {
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n: AudioNode = o;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f);
      n = f;
    }
    n.connect(g).connect(d);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  private nz(c: AudioContext, d: AudioNode, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0, attack = 0.01): void {
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise(c);
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(d);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.03);
  }
  /** run a recipe with a live voice slot; `x` = world x for panning */
  private fx(x: number, dur: number, f: (c: AudioContext, d: AudioNode) => void): void {
    const e = this.ensureBus();
    if (!e || !this.begin(e.c, dur)) return;
    f(e.c, this.dest(e.c, e.bus, x));
  }

  /** the "DOOM": deep sub thump with a fast pitch drop, noisy crack, roar body and a rumble tail. size ~0.5..1.6 */
  private boom(c: AudioContext, d: AudioNode, size: number, delay = 0, crackHz = 2600): void {
    this.tn(c, d, 170, 46, 0.16, 0.95 * size, 'sine', delay); // fast pitch-drop thump
    this.tn(c, d, 58, 30, 1.0 * size + 0.3, 0.85 * size, 'sine', delay + 0.02); // sub body
    this.nz(c, d, 0.2, 0.85 * size, 'bandpass', crackHz, 500, 0.7, delay, 0.002); // crack
    this.nz(c, d, 0.55 * size + 0.2, 0.7 * size, 'lowpass', 1900, 180, 0.7, delay, 0.004); // roar
    this.nz(c, d, 1.1 * size + 0.4, 0.5 * size, 'lowpass', 170, 70, 0.8, delay + 0.05, 0.06); // rumble tail
  }
  /** element index: 0 fire, 1 ice, 2 lightning, 3 aether, 4 nature, 5 shadow */
  cast(el: number, power: number, x = 0): void {
    this.sfxCount.cast++;
    const p = 0.7 + Math.min(1.3, power) * 0.5;
    this.fx(x, 1.2, (c, d) => {
      // common release whoosh
      this.nz(c, d, 0.5, 0.65 * p, 'bandpass', 250, 2600, 0.9, 0, 0.05);
      this.tn(c, d, 60, 110, 0.35, 0.4 * p, 'sine', 0.02);
      if (el === 0) {
        this.nz(c, d, 0.7, 0.5 * p, 'lowpass', 600, 2400, 0.7, 0, 0.06);
        this.tn(c, d, 150, 55, 0.6, 0.45 * p, 'sawtooth', 0, 700);
        for (let i = 0; i < 7; i++) this.nz(c, d, 0.05, 0.3, 'highpass', 3200, 3200, 1, 0.08 + i * 0.07 + Math.random() * 0.04, 0.002);
      } else if (el === 1) {
        this.tn(c, d, 2400, 900, 0.45, 0.22 * p, 'triangle');
        this.tn(c, d, 3600, 1800, 0.3, 0.12 * p, 'sine', 0.03);
        this.nz(c, d, 0.35, 0.3 * p, 'highpass', 6500, 6500, 1.5, 0, 0.02);
        for (const [f, dl] of [[2093, 0.06], [2637, 0.14], [3136, 0.22]]) this.tn(c, d, f, f, 0.5, 0.1 * p, 'sine', dl);
      } else if (el === 2) {
        this.nz(c, d, 0.18, 0.7 * p, 'bandpass', 3400, 900, 0.7, 0, 0.002);
        this.tn(c, d, 110, 38, 0.4, 0.4 * p, 'square', 0, 600);
        for (let i = 0; i < 5; i++) this.nz(c, d, 0.04, 0.45, 'bandpass', 2600 + Math.random() * 3000, 2600, 3, 0.05 + i * 0.05, 0.001);
      } else if (el === 3) {
        for (const [f, v] of [[330, 0.3], [495, 0.22], [660, 0.2], [990, 0.12]]) {
          this.tn(c, d, f, f * 1.01, 0.9, v * p, 'sine');
          this.tn(c, d, f * 1.006, f * 1.016, 0.9, v * 0.6 * p, 'triangle', 0.02);
        }
      } else if (el === 4) {
        this.nz(c, d, 0.5, 0.45 * p, 'bandpass', 500, 1500, 1.1, 0, 0.08);
        this.tn(c, d, 200, 110, 0.32, 0.5 * p, 'triangle');
        this.nz(c, d, 0.3, 0.22, 'highpass', 4200, 4200, 1, 0.1, 0.03);
      } else {
        this.tn(c, d, 80, 34, 0.9, 0.55 * p, 'sine');
        this.tn(c, d, 160, 70, 0.7, 0.25 * p, 'sawtooth', 0, 380);
        this.nz(c, d, 0.8, 0.3 * p, 'lowpass', 200, 1400, 0.8, 0, 0.5);
      }
    });
  }
  hit(el: number, big: boolean, x = 0): void {
    this.sfxCount.hit++;
    const v = big ? 1.5 : 1;
    const heavy = el === 0 || el === 5 || el === 4 ? 1 : 0.75;
    this.fx(x, 2.2, (c, d) => {
      this.boom(c, d, (big ? 1.35 : 0.85) * heavy, 0, el === 1 ? 4200 : 2600);
      this.tn(c, d, 130 * (big ? 0.8 : 1), 42, 0.26 * v, 0.55 * v, 'sine');
      this.nz(c, d, 0.22 * v, 0.5 * v, 'lowpass', 2800, 500, 0.7, 0, 0.003);
      if (el === 0) this.nz(c, d, 0.5 * v, 0.34, 'bandpass', 1200, 380, 0.8, 0.02, 0.04);
      else if (el === 1) {
        this.nz(c, d, 0.18, 0.5, 'highpass', 5000, 5000, 2, 0, 0.002);
        for (const f of [2400, 3200, 4100]) this.tn(c, d, f, f * 0.8, 0.35 * v, 0.14, 'triangle', Math.random() * 0.05);
      } else if (el === 2) {
        this.nz(c, d, 0.12, 0.7, 'bandpass', 4200, 1200, 1.2, 0, 0.001);
        this.tn(c, d, 900, 120, 0.12, 0.3, 'square');
      } else if (el === 3) {
        this.tn(c, d, 880, 880, 0.7 * v, 0.28, 'sine');
        this.tn(c, d, 1320, 1320, 0.6 * v, 0.18, 'sine', 0.02);
      } else if (el === 4) {
        this.tn(c, d, 140, 70, 0.3 * v, 0.5, 'triangle');
        this.nz(c, d, 0.25, 0.3, 'bandpass', 700, 300, 1, 0, 0.01);
      } else {
        this.tn(c, d, 70, 30, 0.6 * v, 0.55, 'sine');
        this.nz(c, d, 0.5, 0.25, 'lowpass', 900, 150, 0.8, 0, 0.02);
      }
      if (big) {
        this.tn(c, d, 55, 24, 0.7, 0.5, 'sine', 0.02);
        this.nz(c, d, 0.5, 0.35, 'lowpass', 900, 120, 0.7, 0.02, 0.01);
      }
    });
  }
  die(x = 0): void {
    this.sfxCount.die++;
    this.fx(x, 2.4, (c, d) => {
      this.boom(c, d, 1.5, 0);
      this.boom(c, d, 0.8, 0.12, 1800);
      this.tn(c, d, 420, 70, 0.55, 0.38, 'sawtooth', 0, 1100);
      this.nz(c, d, 0.45, 0.5, 'bandpass', 2600, 400, 0.8, 0, 0.004);
      this.tn(c, d, 70, 28, 0.7, 0.55, 'sine', 0.03);
      for (let i = 0; i < 5; i++) this.tn(c, d, 1800 + Math.random() * 2400, 900, 0.25, 0.1, 'triangle', 0.05 + i * 0.05);
    });
  }
  telegraph(kind: number, x = 0): void {
    this.sfxCount.telegraph++;
    const f = [110, 98, 123, 87][kind % 4];
    this.fx(x, 1.2, (c, d) => {
      this.tn(c, d, f, f * 2.2, 0.8, 0.34, 'sawtooth', 0, 900);
      this.nz(c, d, 0.8, 0.3, 'bandpass', 300, 2600, 1.4, 0, 0.55);
      this.tn(c, d, f * 8, f * 8, 0.12, 0.18, 'square', 0.55, 3000);
      this.tn(c, d, f * 8 * 1.5, f * 8 * 1.5, 0.12, 0.18, 'square', 0.7, 3000);
    });
  }
  hurt(): void {
    this.sfxCount.hurt++;
    this.fx(0, 2.0, (c, d) => {
      this.boom(c, d, 1.1, 0, 2000);
      this.tn(c, d, 100, 36, 0.4, 0.8, 'sine');
      this.nz(c, d, 0.3, 0.7, 'lowpass', 1800, 220, 0.8, 0, 0.002);
      this.tn(c, d, 110, 60, 0.45, 0.3, 'sawtooth', 0, 500);
      this.tn(c, d, 117, 63, 0.45, 0.25, 'sawtooth', 0, 500);
    });
  }
  block(): void {
    this.sfxCount.block++;
    this.fx(0, 1.6, (c, d) => {
      this.tn(c, d, 150, 60, 0.25, 0.8, 'sine'); // body thud
      this.nz(c, d, 0.14, 0.9, 'bandpass', 1800, 700, 0.8, 0, 0.001);
      for (const [f, v] of [[233, 0.4], [311, 0.35], [467, 0.3]]) this.tn(c, d, f, f * 0.995, 1.0, v, 'square', 0, 1500); // ringing plate
      this.nz(c, d, 0.12, 0.7, 'highpass', 3000, 3000, 1, 0, 0.001);
      for (const [f, v] of [[820, 0.35], [1290, 0.3], [1930, 0.22], [2710, 0.14]]) this.tn(c, d, f, f * 0.98, 0.7, v, 'sine');
      this.tn(c, d, 180, 90, 0.2, 0.4, 'triangle');
    });
  }
  shield(on: boolean): void {
    this.sfxCount.other++;
    this.fx(0, 1.0, (c, d) => {
      if (on) {
        this.tn(c, d, 330, 990, 0.45, 0.3, 'sine');
        this.tn(c, d, 495, 1485, 0.55, 0.18, 'triangle', 0.05);
        this.nz(c, d, 0.4, 0.2, 'highpass', 4000, 7000, 1, 0, 0.1);
      } else this.tn(c, d, 660, 280, 0.3, 0.2, 'sine');
    });
  }
  stomp(): void {
    this.sfxCount.other++;
    this.fx(0, 2.0, (c, d) => {
      this.boom(c, d, 1.5, 0, 1500);
      this.tn(c, d, 80, 24, 0.7, 0.8, 'sine');
      this.nz(c, d, 0.6, 0.6, 'lowpass', 1200, 90, 0.7, 0, 0.005);
    });
  }
  roar(x = 0): void {
    this.sfxCount.other++;
    this.fx(x, 2.6, (c, d) => {
      this.boom(c, d, 1.0, 0.1, 1200);
      this.tn(c, d, 62, 34, 2.0, 0.6, 'sawtooth', 0, 340);
      this.tn(c, d, 93, 50, 1.8, 0.3, 'square', 0, 300);
      this.nz(c, d, 1.9, 0.5, 'bandpass', 220, 700, 1.6, 0, 0.3);
      this.nz(c, d, 1.6, 0.3, 'bandpass', 900, 380, 3, 0.1, 0.4);
      this.tn(c, d, 40, 28, 1.6, 0.6, 'sine', 0.05);
    });
  }
  fizzle(): void {
    this.sfxCount.other++;
    this.fx(0, 0.6, (c, d) => {
      this.tn(c, d, 260, 80, 0.3, 0.25, 'sawtooth', 0, 800);
      this.nz(c, d, 0.25, 0.25, 'bandpass', 1500, 300, 1, 0, 0.01);
    });
  }
  discover(): void {
    this.sfxCount.other++;
    this.fx(0, 3.2, (c, d) => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => {
        this.tn(c, d, f, f, 2.0, 0.22 / (1 + i * 0.15), 'sine', i * 0.09);
        this.tn(c, d, f * 1.004, f * 1.004, 1.6, 0.08, 'triangle', i * 0.09 + 0.02);
      });
      this.nz(c, d, 1.2, 0.18, 'highpass', 4200, 4200, 0.8, 0, 0.2);
    });
  }
  unlock(): void {
    this.sfxCount.other++;
    this.fx(0, 2.2, (c, d) => [392, 523.25, 784, 1046.5].forEach((f, i) => this.tn(c, d, f, f, 1.5, 0.26, 'sine', i * 0.14)));
  }
  win(): void {
    this.sfxCount.other++;
    this.fx(0, 4, (c, d) => {
      [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((f, i) => this.tn(c, d, f, f, 3.2, 0.24, 'sine', i * 0.2));
      this.nz(c, d, 2, 0.14, 'highpass', 2200, 2200, 0.5, 0.3, 0.5);
    });
  }
  lose(): void {
    this.sfxCount.other++;
    this.fx(0, 3.4, (c, d) => [220, 185, 147].forEach((f, i) => this.tn(c, d, f, f * 0.9, 2.4, 0.3, 'sine', i * 0.3)));
  }
  /** UI click for menu buttons */
  click(): void {
    this.sfxCount.other++;
    this.fx(0, 0.3, (c, d) => {
      this.tn(c, d, 900, 600, 0.09, 0.28, 'triangle');
      this.tn(c, d, 1800, 1200, 0.06, 0.12, 'sine');
    });
  }
  /** persistent charge-up hum: level 0..1 (0 = off), element index; pitch and brightness rise with level */
  private chV: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  charge(level: number, el: number): void {
    const e = this.ensureBus();
    if (!e) return;
    const c = e.c;
    if (!this.chV) {
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      const f = c.createBiquadFilter();
      const g = c.createGain();
      o1.type = 'sawtooth';
      o2.type = 'triangle';
      f.type = 'lowpass';
      g.gain.value = 0;
      o1.connect(f);
      o2.connect(f);
      f.connect(g).connect(e.bus);
      o1.start();
      o2.start();
      this.chV = { o1, o2, f, g };
    }
    const base = [98, 233, 311, 174, 130, 82][el % 6];
    const t = c.currentTime;
    const m = 1 + level * 1.4;
    this.chV.o1.frequency.setTargetAtTime(base * m, t, 0.06);
    this.chV.o2.frequency.setTargetAtTime(base * m * 2.003, t, 0.06);
    this.chV.f.frequency.setTargetAtTime(350 + level * 2600, t, 0.08);
    this.chV.g.gain.setTargetAtTime(level < 0.01 ? 0 : 0.07 + level * 0.16, t, 0.1);
  }
  /** boss rig cues (slam, land, shatter) */
  event(name: string, pos: V3, amount = 1): void {
    if (name === 'slam' || name === 'land') {
      this.stomp();
      if (amount > 0.5) this.hit(4, true, pos[0]);
    } else if (name === 'shatter') this.hit(1, true, pos[0]);
  }

  /** adaptive music inputs; phase -1 = no boss. Call every battle frame (no allocation). */
  music(active: boolean, tension: number, phase: number, phases: number, hp: number, bossIdx: number): void {
    this.active = active;
    this.tension = tension;
    this.phase = phase;
    this.phases = phases;
    this.hp = hp;
    this.bossIdx = bossIdx;
    musicMix(tension, phase, phases, hp, this.mix);
    if (active && phase !== this.lastPhase) {
      if (phase > 0) this.stinger(phase);
      this.lastPhase = phase;
    }
    if (!active) this.lastPhase = -1;
    if (active && !this.timer) this.start();
  }

  private start(): void {
    const core = audioCore();
    if (!core || typeof window === 'undefined') return;
    const c = core.ctx;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(core.out);
    this.nextT = c.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') this.musicOn = !this.musicOn;
    });
  }

  private schedule(): void {
    const core = audioCore();
    if (!core || !this.bus) return;
    const c = core.ctx;
    const want = this.active && this.musicOn ? 5.0 * getMusicVolume() : 0;
    this.bus.gain.setTargetAtTime(want, c.currentTime, 0.4);
    if (!this.active || !this.musicOn) {
      this.nextT = c.currentTime + 0.1;
      return;
    }
    const m = this.mix;
    const sixteenth = 60 / m.bpm / 4;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.02;
    while (this.nextT < c.currentTime + 0.25) {
      const s = this.step % 16;
      const t = this.nextT;
      // kick on the beat, extra push on the "and of 3" when the boss escalates
      // always-on battle ambience: a slow dark pad chord every two bars and a low pulse on 1 and 3
      if (s === 0 && (this.step / 16) % 2 === 0) {
        const r0 = ROOTS[this.bossIdx % ROOTS.length] + 12;
        for (const iv of [0, 7, 10]) this.pad(c, t, midi(r0 + iv), sixteenth * 32, 0.05 + 0.03 * this.tension);
        this.played.ambient++;
      }
      if (s === 0 || s === 8) this.kick(c, t, 0.12 + 0.1 * this.tension, 55);
      if (m.drums > 0 && (s % 4 === 0 || (m.drums > 0.8 && s === 10))) {
        this.kick(c, t, 0.34 * m.drums);
        this.played.drums++;
      }
      if (m.hats > 0 && s % 2 === 1) {
        this.tick(c, t, 0.08 * m.hats);
        this.played.hats++;
      }
      if (m.ostinato > 0 && s % 2 === 0) {
        const root = ROOTS[this.bossIdx % ROOTS.length] + m.lift;
        this.pluck(c, t, midi(root + OST[(s / 2) % OST.length]), sixteenth * 1.8, 0.12 * m.ostinato);
        this.played.ostinato++;
      }
      if (m.heartbeat > 0 && (s === 0 || s === 3)) {
        this.kick(c, t, 0.16 * m.heartbeat, 48);
        this.played.heartbeat++;
      }
      if (m.choir > 0 && s === 0 && (this.step / 16) % 2 === 0) {
        const root = ROOTS[this.bossIdx % ROOTS.length] + 24;
        for (const iv of [0, 7, 15]) this.pad(c, t, midi(root + iv), sixteenth * 32, 0.04 * m.choir);
        this.played.choir++;
      }
      this.nextT += sixteenth;
      this.step++;
    }
  }

  private stinger(phase: number): void {
    const core = audioCore();
    if (!core || !this.bus) return;
    const c = core.ctx;
    const root = ROOTS[this.bossIdx % ROOTS.length] + 12 + phase * 2;
    const t = c.currentTime + 0.05;
    for (const iv of [0, 7, 12]) this.pluck(c, t, midi(root + iv), 1.6, 0.14, 'sawtooth');
    this.kick(c, t, 0.45);
    this.played.stingers++;
  }

  private kick(c: AudioContext, t: number, vol: number, f0 = 70): void {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0 * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.18);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.32);
  }
  private tick(c: AudioContext, t: number, vol: number): void {
    const o = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 7200 + Math.random() * 900;
    f.type = 'highpass';
    f.frequency.value = 6000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(f).connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.05);
  }
  private pluck(c: AudioContext, t: number, freq: number, dur: number, vol: number, type: OscillatorType = 'triangle'): void {
    const o = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  private pad(c: AudioContext, t: number, freq: number, dur: number, vol: number): void {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
export const sfAudio = new SfAudio();
