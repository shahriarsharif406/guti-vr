/**
 * SPELLFORGE audio department.
 * - 3D positional one-shots: `at()` places shared procedural sounds at a world point through an HRTF
 *   PannerNode (audio.ts withPos); the listener follows the camera via `listener()`. Falls back to a
 *   stereo pan when PannerNode is unavailable.
 * - Adaptive battle music: a procedural layer (drums, ticks, boss ostinato, heartbeat, final-phase
 *   choir, phase stingers) on top of the shared spell music, mixed by sfmusic.ts rules.
 * No recorded audio. Nothing here was heard on a headset.
 */
import { audioCore, getMusicVolume, setListenerPose, sfx, withPos } from './audio.js';
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
  readonly played = { drums: 0, hats: 0, ostinato: 0, heartbeat: 0, choir: 0, stingers: 0 };

  /** listener = head pose (world). Call once per frame. */
  listener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    setListenerPose(px, py, pz, fx, fy, fz, ux, uy, uz);
  }
  /** play `f` (one or more sfx.* calls) positioned at a world point; `pan` is the stereo fallback */
  at(pos: V3, pan: number, f: () => void): void {
    withPos(pos[0], pos[1], pos[2], pan, f);
  }
  /** boss rig cues (slam, land, shatter) as positioned sounds */
  event(name: string, pos: V3, amount = 1): void {
    const pan = Math.max(-1, Math.min(1, pos[0] / 5));
    withPos(pos[0], pos[1], pos[2], pan, () => {
      if (name === 'slam' || name === 'land') {
        sfx.spellStomp();
        if (amount > 0.5) sfx.spellHit(4, true);
      } else if (name === 'shatter') sfx.spellHit(1, true);
    });
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
    const want = this.active && this.musicOn ? 0.9 * getMusicVolume() : 0;
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
      if (m.drums > 0 && (s % 4 === 0 || (m.drums > 0.8 && s === 10))) {
        this.kick(c, t, 0.22 * m.drums);
        this.played.drums++;
      }
      if (m.hats > 0 && s % 2 === 1) {
        this.tick(c, t, 0.05 * m.hats);
        this.played.hats++;
      }
      if (m.ostinato > 0 && s % 2 === 0) {
        const root = ROOTS[this.bossIdx % ROOTS.length] + m.lift;
        this.pluck(c, t, midi(root + OST[(s / 2) % OST.length]), sixteenth * 1.8, 0.07 * m.ostinato);
        this.played.ostinato++;
      }
      if (m.heartbeat > 0 && (s === 0 || s === 3)) {
        this.kick(c, t, 0.16 * m.heartbeat, 48);
        this.played.heartbeat++;
      }
      if (m.choir > 0 && s === 0 && (this.step / 16) % 2 === 0) {
        const root = ROOTS[this.bossIdx % ROOTS.length] + 24;
        for (const iv of [0, 7, 15]) this.pad(c, t, midi(root + iv), sixteenth * 32, 0.018 * m.choir);
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
    for (const iv of [0, 7, 12]) this.pluck(c, t, midi(root + iv), 1.6, 0.08, 'sawtooth');
    this.kick(c, t, 0.3);
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
