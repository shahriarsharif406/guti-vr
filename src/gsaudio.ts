/**
 * Neon Overdrive procedural audio (Web Audio API, no sample files):
 * engine (idle / acceleration / high-rpm roar layers + combustion noise + firing-pulse modulation),
 * turbo whistle + spool, wind, tyres, transmission clicks, blow-off, backfire, penalties,
 * environment beds (city, tunnel reverb, highway wind, electrical hum, distant traffic)
 * and an original adaptive synthwave score with five layers switched on bar lines.
 *
 * Mix safety: every continuous voice is created once per session and only re-targeted, one-shots are
 * capped by a voice counter, the race bus has its own compressor and then runs into the shared limiter.
 * Nothing here has been auditioned by a human in this build environment (no audio output available).
 */
import { audioCore } from './audio.js';

export interface EngineVoice {
  /** firing pulses per crank revolution (cylinders / 2) */
  pulses: number;
  /** electric whine harmonic (0 = none) */
  whine: number;
  grit: number;
}
export const ENGINE_VOICES: Record<string, EngineVoice> = {
  vx1: { pulses: 3, whine: 0.5, grit: 0.8 },
  titan: { pulses: 4, whine: 0, grit: 1.2 },
  kestrel: { pulses: 5, whine: 0, grit: 0.7 },
};

export interface EngineFrame {
  rpm: number;
  load: number; // throttle 0..1
  speed: number; // m/s
  turbo: number; // boost pressure 0..1
  boosting: boolean;
  wheelspin: number;
  braking: boolean;
  limiter: boolean;
  zone: 'city' | 'tunnel' | 'highway';
  rain: boolean;
}

type Bus = 'music' | 'engine' | 'sfx' | 'ambient';
const BPM = 112;
const S16 = 60 / BPM / 4;
// i - VI - III - VII in A minor (Am F C G), classic synthwave motion
const PROG = [
  { root: 45, chord: [57, 60, 64, 69] },
  { root: 41, chord: [53, 57, 60, 65] },
  { root: 48, chord: [55, 60, 64, 67] },
  { root: 43, chord: [55, 59, 62, 67] },
];
const LEAD = [76, 74, 72, 74, 76, 79, 77, 76, 72, 74, 71, 72, 74, 72, 69, 67];
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export class RaceAudio {
  private c: AudioContext | null = null;
  private bus: GainNode | null = null;
  private buses = {} as Record<Bus, GainNode>;
  private verbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private live = false;
  private voices = 0;
  // engine
  private eOscA!: OscillatorNode;
  private eOscB!: OscillatorNode;
  private eOscC!: OscillatorNode;
  private eWhine!: OscillatorNode;
  private eWhineG!: GainNode;
  private eShaper!: WaveShaperNode;
  private eLow!: BiquadFilterNode;
  private eHigh!: BiquadFilterNode;
  private gIdle!: GainNode;
  private gMid!: GainNode;
  private gHigh!: GainNode;
  private eNoiseF!: BiquadFilterNode;
  private eNoiseG!: GainNode;
  private eAm!: OscillatorNode;
  private eAmG!: GainNode;
  private eOut!: GainNode;
  private panner: PannerNode | null = null;
  // turbo / wind / tyres
  private tWhistle!: OscillatorNode;
  private tWhistleG!: GainNode;
  private tSpoolF!: BiquadFilterNode;
  private tSpoolG!: GainNode;
  private windF!: BiquadFilterNode;
  private windG!: GainNode;
  private tyreG!: GainNode;
  private rainG!: GainNode;
  // ambience
  private cityG!: GainNode;
  private humG!: GainNode;
  private trafficG!: GainNode;
  private trafficLfo!: OscillatorNode;
  private stopList: AudioScheduledSourceNode[] = [];
  // music
  private layerG: GainNode[] = [];
  private delay!: DelayNode;
  private nextT = 0;
  private step = 0;
  private intensity = 0;
  private wantLayers = [1, 0, 0, 0, 0];
  private accentQueued = false;
  private riser = false;
  private riserStarted = false;
  private menuMusic = true;
  voice: EngineVoice = ENGINE_VOICES.vx1;
  /** captions for the subtitle option */
  onCaption: ((s: string) => void) | null = null;

  get ready(): boolean {
    return this.live;
  }
  get ctx(): AudioContext | null {
    return this.c;
  }

  /** Build the graph (call after a user gesture). Safe to call repeatedly. */
  start(): boolean {
    if (this.live) return true;
    const core = audioCore();
    if (!core) return false;
    const c = core.ctx;
    this.c = c;
    if (!this.bus) {
      this.bus = c.createGain();
      this.bus.gain.value = 0;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.01;
      comp.release.value = 0.25;
      this.bus.connect(comp);
      comp.connect(core.out);
      for (const b of ['music', 'engine', 'sfx', 'ambient'] as Bus[]) {
        const g = c.createGain();
        g.connect(this.bus);
        this.buses[b] = g;
      }
      const len = Math.floor(c.sampleRate * 2);
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647) * 2 - 1;
      }
      // tunnel reverb: short bright concrete space
      const irLen = Math.floor(c.sampleRate * 1.6);
      const ir = c.createBuffer(2, irLen, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const x = ir.getChannelData(ch);
        for (let k = 0; k < irLen; k++) x[k] = (((k * 7919 + ch * 104729) % 1000) / 500 - 1) * Math.pow(1 - k / irLen, 2.4);
      }
      const verb = c.createConvolver();
      verb.buffer = ir;
      this.verbSend = c.createGain();
      this.verbSend.gain.value = 0;
      const wet = c.createGain();
      wet.gain.value = 0.6;
      this.verbSend.connect(verb);
      verb.connect(wet);
      wet.connect(this.bus);
      this.buildMusic(c);
    }
    this.buildEngine(c);
    this.buildBeds(c);
    this.live = true;
    this.nextT = c.currentTime + 0.1;
    this.bus.gain.setTargetAtTime(1, c.currentTime, 0.4);
    return true;
  }

  /** Tear down the continuous voices (leaving the racer). */
  stop(): void {
    if (!this.live || !this.c || !this.bus) return;
    const c = this.c;
    this.bus.gain.setTargetAtTime(0, c.currentTime, 0.12);
    const list = this.stopList;
    this.stopList = [];
    window.setTimeout(() => {
      for (const s of list) {
        try {
          s.stop();
          s.disconnect();
        } catch {
          /* already stopped */
        }
      }
    }, 600);
    this.live = false;
  }

  setVolumes(v: { master: number; music: number; engine: number; sfx: number; ambient: number }, muted: boolean): void {
    if (!this.c || !this.bus) return;
    const t = this.c.currentTime;
    if (this.live) this.bus.gain.setTargetAtTime(muted ? 0 : v.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(v.music * 0.9, t, 0.05);
    this.buses.engine.gain.setTargetAtTime(v.engine, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(v.ambient, t, 0.05);
  }

  private noiseSrc(c: AudioContext): AudioBufferSourceNode {
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random() * 1.5;
    return s;
  }

  private buildEngine(c: AudioContext): void {
    const osc = (type: OscillatorType, f: number): OscillatorNode => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      this.stopList.push(o);
      return o;
    };
    this.eOscA = osc('sawtooth', 60);
    this.eOscB = osc('square', 30);
    this.eOscC = osc('sawtooth', 120);
    this.eOscC.detune.value = 9;
    this.eWhine = osc('sine', 900);
    this.eWhineG = c.createGain();
    this.eWhineG.gain.value = 0;
    // soft-clip shaper: rounder at low load, rasp at high load
    this.eShaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
    }
    this.eShaper.curve = curve;
    this.eShaper.oversample = '2x';
    const pre = c.createGain();
    pre.gain.value = 0.5;
    this.eOscA.connect(pre);
    this.eOscC.connect(pre);
    this.eLow = c.createBiquadFilter();
    this.eLow.type = 'lowpass';
    this.eLow.Q.value = 1.2;
    this.eHigh = c.createBiquadFilter();
    this.eHigh.type = 'bandpass';
    this.eHigh.Q.value = 2.2;
    this.gIdle = c.createGain();
    this.gMid = c.createGain();
    this.gHigh = c.createGain();
    this.gIdle.gain.value = this.gMid.gain.value = this.gHigh.gain.value = 0;
    // idle rumble: the sub square through a dark filter
    const idleF = c.createBiquadFilter();
    idleF.type = 'lowpass';
    idleF.frequency.value = 220;
    this.eOscB.connect(idleF).connect(this.gIdle);
    // acceleration: saws -> shaper -> lowpass tracking rpm and load
    pre.connect(this.eShaper);
    this.eShaper.connect(this.eLow).connect(this.gMid);
    // high-rpm roar: resonant band on the upper harmonics
    this.eShaper.connect(this.eHigh).connect(this.gHigh);
    // combustion grit
    const n = this.noiseSrc(c);
    this.stopList.push(n);
    this.eNoiseF = c.createBiquadFilter();
    this.eNoiseF.type = 'bandpass';
    this.eNoiseF.Q.value = 0.9;
    this.eNoiseG = c.createGain();
    this.eNoiseG.gain.value = 0;
    n.connect(this.eNoiseF).connect(this.eNoiseG);
    // firing-pulse amplitude modulation (lumpy idle, roughness at speed)
    this.eOut = c.createGain();
    this.eOut.gain.value = 0.8;
    this.eAm = osc('sine', 15);
    this.eAmG = c.createGain();
    this.eAmG.gain.value = 0.25;
    this.eAm.connect(this.eAmG).connect(this.eOut.gain);
    for (const g of [this.gIdle, this.gMid, this.gHigh, this.eNoiseG]) g.connect(this.eOut);
    this.eWhine.connect(this.eWhineG).connect(this.eOut);
    // spatial: the engine sits behind the driver (mid-engine car)
    if (typeof c.createPanner === 'function') {
      this.panner = c.createPanner();
      this.panner.panningModel = 'HRTF';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 1.2;
      this.panner.rolloffFactor = 0.6;
      this.eOut.connect(this.panner).connect(this.buses.engine);
    } else this.eOut.connect(this.buses.engine);
    this.eOut.connect(this.verbSend);
    // turbo whistle + spool hiss
    this.tWhistle = osc('sine', 2000);
    this.tWhistleG = c.createGain();
    this.tWhistleG.gain.value = 0;
    this.tWhistle.connect(this.tWhistleG).connect(this.buses.engine);
    const tn = this.noiseSrc(c);
    this.stopList.push(tn);
    this.tSpoolF = c.createBiquadFilter();
    this.tSpoolF.type = 'bandpass';
    this.tSpoolF.Q.value = 6;
    this.tSpoolG = c.createGain();
    this.tSpoolG.gain.value = 0;
    tn.connect(this.tSpoolF).connect(this.tSpoolG).connect(this.buses.engine);
    for (const o of [this.eOscA, this.eOscB, this.eOscC, this.eWhine, this.eAm, this.tWhistle]) o.start();
    n.start();
    tn.start();
  }

  private buildBeds(c: AudioContext): void {
    const nz = (type: BiquadFilterType, f: number, q: number, bus: AudioNode): { f: BiquadFilterNode; g: GainNode } => {
      const s = this.noiseSrc(c);
      this.stopList.push(s);
      const fl = c.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(fl).connect(g).connect(bus);
      s.start();
      return { f: fl, g };
    };
    const wind = nz('bandpass', 500, 0.7, this.buses.ambient);
    this.windF = wind.f;
    this.windG = wind.g;
    this.tyreG = nz('bandpass', 950, 1.6, this.buses.sfx).g;
    this.rainG = nz('highpass', 3500, 0.5, this.buses.ambient).g;
    this.trafficG = nz('lowpass', 320, 0.5, this.buses.ambient).g;
    this.trafficLfo = c.createOscillator();
    this.trafficLfo.frequency.value = 0.07;
    const lg = c.createGain();
    lg.gain.value = 0.012;
    this.trafficLfo.connect(lg).connect(this.trafficG.gain);
    this.trafficLfo.start();
    this.stopList.push(this.trafficLfo);
    // city drone: two detuned low saws, very dark
    this.cityG = c.createGain();
    this.cityG.gain.value = 0;
    const cf = c.createBiquadFilter();
    cf.type = 'lowpass';
    cf.frequency.value = 140;
    for (const f of [55, 55.4]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(cf);
      o.start();
      this.stopList.push(o);
    }
    cf.connect(this.cityG).connect(this.buses.ambient);
    // neon infrastructure hum
    this.humG = c.createGain();
    this.humG.gain.value = 0;
    for (const [f, a] of [[120, 1], [240, 0.4], [360, 0.15]]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = a;
      o.connect(g).connect(this.humG);
      o.start();
      this.stopList.push(o);
    }
    this.humG.connect(this.buses.ambient);
  }

  /** Per-frame continuous update (no allocation). */
  engine(f: EngineFrame, active: boolean, dt: number): void {
    if (!this.live || !this.c) return;
    const c = this.c;
    const t = c.currentTime;
    const v = this.voice;
    const fire = Math.max(20, (f.rpm / 60) * v.pulses);
    const r = Math.min(1.2, f.rpm / 8000);
    const k = 0.012;
    this.eOscA.frequency.setTargetAtTime(fire, t, k);
    this.eOscB.frequency.setTargetAtTime(fire * 0.5, t, k);
    this.eOscC.frequency.setTargetAtTime(fire * 2, t, k);
    this.eAm.frequency.setTargetAtTime(fire / v.pulses, t, k);
    this.eAmG.gain.setTargetAtTime(f.limiter ? 0.6 : 0.28 - 0.18 * Math.min(1, r), t, 0.05);
    this.eLow.frequency.setTargetAtTime(260 + fire * 2.4 + f.load * 1600, t, 0.03);
    this.eHigh.frequency.setTargetAtTime(fire * 3, t, 0.03);
    // crossfade: idle -> acceleration -> high-rpm roar
    const idle = active ? Math.max(0, 1 - r * 2.2) : 0;
    const mid = active ? Math.min(1, r * 2.5) * (1 - Math.max(0, r - 0.75) * 1.2) * (0.45 + 0.55 * f.load) : 0;
    const high = active ? Math.max(0, (r - 0.55) / 0.45) * (0.3 + 0.7 * f.load) : 0;
    this.gIdle.gain.setTargetAtTime(idle * 0.5, t, 0.06);
    this.gMid.gain.setTargetAtTime(mid * 0.32, t, 0.04);
    this.gHigh.gain.setTargetAtTime(high * 0.22 * v.grit, t, 0.04);
    this.eNoiseF.frequency.setTargetAtTime(fire * 2.2, t, 0.03);
    this.eNoiseG.gain.setTargetAtTime(active ? (0.03 + 0.09 * f.load * r) * v.grit : 0, t, 0.05);
    this.eWhine.frequency.setTargetAtTime((f.rpm / 60) * 9, t, k);
    this.eWhineG.gain.setTargetAtTime(active ? v.whine * 0.012 * Math.min(1, r) : 0, t, 0.08);
    // turbo
    const p = active ? f.turbo : 0;
    this.tWhistle.frequency.setTargetAtTime(1600 + 4200 * p + (f.boosting ? 900 : 0), t, 0.08);
    this.tWhistleG.gain.setTargetAtTime(p * p * (f.boosting ? 0.03 : 0.016), t, 0.08);
    this.tSpoolF.frequency.setTargetAtTime(3000 + 3500 * p, t, 0.1);
    this.tSpoolG.gain.setTargetAtTime(p * (f.boosting ? 0.06 : 0.025), t, 0.1);
    // wind grows with the square of speed; tunnel walls focus it, the open highway broadens it
    const s = Math.min(1, f.speed / 90);
    this.windF.frequency.setTargetAtTime(380 + s * 900 + (f.zone === 'tunnel' ? 300 : 0), t, 0.2);
    this.windF.Q.setTargetAtTime(f.zone === 'highway' ? 0.35 : f.zone === 'tunnel' ? 1.4 : 0.7, t, 0.5);
    this.windG.gain.setTargetAtTime(active ? s * s * (f.zone === 'highway' ? 0.32 : 0.22) : 0, t, 0.15);
    this.tyreG.gain.setTargetAtTime(active ? f.wheelspin * 0.22 + (f.braking ? 0.1 * s : 0) + s * 0.025 : 0, t, 0.05);
    this.rainG.gain.setTargetAtTime(f.rain ? 0.05 : 0, t, 0.6);
    // environment beds
    const tunnel = f.zone === 'tunnel';
    this.verbSend.gain.setTargetAtTime(tunnel ? 0.42 : 0.04, t, 0.4);
    this.cityG.gain.setTargetAtTime(f.zone === 'city' ? 0.05 : tunnel ? 0.025 : 0.015, t, 0.8);
    this.humG.gain.setTargetAtTime(tunnel ? 0.012 : f.zone === 'city' ? 0.006 : 0.002, t, 0.8);
    this.trafficG.gain.setTargetAtTime(f.zone === 'highway' ? 0.03 : f.zone === 'city' ? 0.022 : 0.004, t, 1);
    void dt;
  }

  /** Spatial placement: engine world position and listener pose (call each frame in VR and desktop). */
  place(ex: number, ey: number, ez: number, lx: number, ly: number, lz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const c = this.c;
    if (!c || !this.panner) return;
    const p = this.panner;
    if (p.positionX) {
      p.positionX.value = ex;
      p.positionY.value = ey;
      p.positionZ.value = ez;
    } else p.setPosition(ex, ey, ez);
    const L = c.listener;
    if (L.positionX) {
      L.positionX.value = lx;
      L.positionY.value = ly;
      L.positionZ.value = lz;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      L.setPosition(lx, ly, lz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ------------------------------------------------------------ one-shots (voice-limited)
  private shot(bus: Bus, build: (c: AudioContext, t: number, out: AudioNode) => number): void {
    if (!this.live || !this.c || this.voices > 14) return;
    const c = this.c;
    const t = c.currentTime + 0.005;
    const g = c.createGain();
    g.connect(this.buses[bus]);
    if (bus !== 'music') g.connect(this.verbSend);
    this.voices++;
    const dur = build(c, t, g);
    window.setTimeout(() => {
      this.voices--;
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    }, (dur + 0.2) * 1000);
  }
  private tone(c: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, attack = 0.003): void {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  private noise(c: AudioContext, out: AudioNode, t: number, type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, vol: number, attack = 0.004): void {
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loopStart = 0;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.03);
  }

  /** Transmission: dog-ring clack; a perfect shift adds a bright metallic snap. */
  shift(cls: string): void {
    this.shot('sfx', (c, t, o) => {
      this.noise(c, o, t, 'bandpass', 2600, 1800, 3, 0.05, 0.25);
      this.tone(c, o, t, 'square', 180, 90, 0.07, 0.12);
      if (cls === 'perfect') {
        this.tone(c, o, t, 'triangle', 2650, 2600, 0.35, 0.09);
        this.tone(c, o, t + 0.004, 'sine', 3970, 3900, 0.25, 0.05);
        this.noise(c, o, t + 0.01, 'highpass', 5000, 9000, 0.7, 0.2, 0.06);
        this.tone(c, o, t, 'sine', 70, 40, 0.3, 0.3); // low impact under the snap
      } else if (cls === 'excellent') this.tone(c, o, t, 'triangle', 1900, 1850, 0.2, 0.06);
      else if (cls === 'overload') {
        this.noise(c, o, t, 'bandpass', 300, 120, 1.5, 0.35, 0.3); // grind
        this.tone(c, o, t, 'sawtooth', 70, 45, 0.3, 0.12);
      }
      return 0.4;
    });
  }
  downshift(): void {
    this.shot('sfx', (c, t, o) => {
      this.noise(c, o, t, 'bandpass', 2000, 1500, 3, 0.04, 0.12);
      this.tone(c, o, t, 'square', 140, 80, 0.06, 0.06);
      return 0.1;
    });
  }
  blowoff(): void {
    this.shot('sfx', (c, t, o) => {
      this.noise(c, o, t, 'bandpass', 4200, 1400, 1.4, 0.38, 0.16, 0.01);
      return 0.4;
    });
  }
  backfire(): void {
    this.shot('sfx', (c, t, o) => {
      this.noise(c, o, t, 'lowpass', 1800, 300, 0.7, 0.12, 0.5, 0.002);
      this.tone(c, o, t, 'sine', 90, 40, 0.18, 0.4, 0.002);
      this.noise(c, o, t + 0.09, 'lowpass', 1400, 300, 0.7, 0.08, 0.3, 0.002);
      return 0.3;
    });
  }
  boost(on: boolean): void {
    this.shot('sfx', (c, t, o) => {
      if (on) {
        this.tone(c, o, t, 'sawtooth', 160, 900, 0.7, 0.06, 0.08);
        this.noise(c, o, t, 'bandpass', 800, 6000, 2, 0.7, 0.12, 0.1);
      } else this.noise(c, o, t, 'bandpass', 5000, 1200, 1.5, 0.4, 0.08, 0.01);
      return 0.8;
    });
  }
  /** Mini turbo kick of a perfect shift: rising turbine chirp. */
  kick(): void {
    this.shot('sfx', (c, t, o) => {
      this.tone(c, o, t, 'sine', 2400, 5200, 0.32, 0.035, 0.02);
      return 0.35;
    });
  }
  /** Engine overload / penalty alarm. */
  alarm(): void {
    this.shot('sfx', (c, t, o) => {
      for (let i = 0; i < 2; i++) {
        this.tone(c, o, t + i * 0.18, 'square', 880, 880, 0.12, 0.05, 0.005);
        this.tone(c, o, t + i * 0.18 + 0.09, 'square', 660, 660, 0.09, 0.05, 0.005);
      }
      return 0.4;
    });
  }
  /** Collision / engine failure. */
  crash(): void {
    this.shot('sfx', (c, t, o) => {
      this.noise(c, o, t, 'lowpass', 3000, 200, 0.8, 1.2, 0.5, 0.002);
      this.tone(c, o, t, 'sawtooth', 120, 30, 1.0, 0.25, 0.002);
      this.noise(c, o, t + 0.05, 'bandpass', 600, 150, 2, 0.8, 0.25);
      return 1.3;
    });
  }
  beep(go: boolean): void {
    this.shot('sfx', (c, t, o) => {
      this.tone(c, o, t, 'square', go ? 880 : 440, go ? 880 : 440, go ? 0.5 : 0.16, 0.07, 0.004);
      this.tone(c, o, t, 'sine', go ? 1760 : 880, go ? 1760 : 880, go ? 0.5 : 0.16, 0.04, 0.004);
      return 0.6;
    });
  }
  /** Timing assist audio cue: soft tick when the green window opens. */
  cue(): void {
    this.shot('sfx', (c, t, o) => {
      this.tone(c, o, t, 'sine', 1320, 1320, 0.08, 0.06, 0.003);
      return 0.1;
    });
  }
  chime(): void {
    this.shot('sfx', (c, t, o) => {
      for (const [i, n] of [76, 81, 88].entries()) this.tone(c, o, t + i * 0.06, 'triangle', midi(n), midi(n), 0.5, 0.05, 0.005);
      return 0.7;
    });
  }
  /** Engine startup: starter whir, catch, flare. */
  startup(): void {
    this.shot('sfx', (c, t, o) => {
      for (let i = 0; i < 5; i++) this.tone(c, o, t + i * 0.09, 'square', 60, 55, 0.07, 0.05, 0.004);
      this.tone(c, o, t + 0.45, 'sawtooth', 80, 300, 0.45, 0.12, 0.01);
      this.noise(c, o, t + 0.45, 'lowpass', 600, 1800, 0.8, 0.5, 0.15, 0.01);
      return 1;
    });
  }
  ui(): void {
    this.shot('sfx', (c, t, o) => {
      this.tone(c, o, t, 'sine', 1200, 1500, 0.06, 0.04, 0.003);
      return 0.08;
    });
  }

  // ------------------------------------------------------------ music
  private buildMusic(c: AudioContext): void {
    for (let i = 0; i < 5; i++) {
      const g = c.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      g.connect(this.buses.music);
      this.layerG.push(g);
    }
    // tempo-synced feedback delay on the lead (dotted 8th)
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = S16 * 3;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    this.layerG[3].connect(this.delay);
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(wet).connect(this.buses.music);
  }

  /**
   * Music intensity 0..1 (speed, rpm, combo, turbo, race progress mixed by the caller). Layers fade in or out on
   * the next bar line so changes land on the beat. `menu` = title/garage screens (atmosphere only).
   */
  setIntensity(x: number, menu: boolean, finalStretch: boolean): void {
    this.intensity = x;
    this.menuMusic = menu;
    this.wantLayers[0] = 1;
    this.wantLayers[1] = menu ? 0.5 : x > 0.12 ? 1 : 0;
    this.wantLayers[2] = !menu && x > 0.38 ? 1 : 0;
    this.wantLayers[3] = !menu && x > 0.62 ? 1 : 0;
    if (finalStretch && !this.riserStarted) this.riser = true;
    if (!finalStretch) this.riserStarted = false;
  }
  /** Layer 5: celebration accent on the next 8th note. */
  accent(): void {
    this.accentQueued = true;
  }

  /** Lookahead scheduler (call every frame). */
  music(): void {
    if (!this.live || !this.c) return;
    const c = this.c;
    while (this.nextT < c.currentTime + 0.2) {
      this.scheduleStep(c, this.nextT, this.step);
      this.nextT += S16;
      this.step++;
    }
  }

  private mv(c: AudioContext, layer: number, t: number, type: OscillatorType, f: number, dur: number, vol: number, cutoff: number, attack = 0.005, detune = 0): void {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(cutoff, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.35), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl).connect(g).connect(this.layerG[layer]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private drum(c: AudioContext, t: number, kind: 'kick' | 'snare' | 'hat' | 'crash', vol: number): void {
    const out = this.layerG[kind === 'crash' ? 4 : 2];
    if (kind === 'kick') {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.32);
      return;
    }
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = kind === 'snare' ? 'bandpass' : 'highpass';
    fl.frequency.value = kind === 'snare' ? 1800 : kind === 'hat' ? 7500 : 4000;
    fl.Q.value = kind === 'snare' ? 0.8 : 0.5;
    const g = c.createGain();
    const d = kind === 'snare' ? 0.18 : kind === 'hat' ? 0.04 : 1.4;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(fl).connect(g).connect(out);
    s.start(t, (t * 7.31) % 1.5);
    s.stop(t + d + 0.02);
    if (kind === 'snare') {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 190;
      const g2 = c.createGain();
      g2.gain.setValueAtTime(vol * 0.6, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g2).connect(out);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  private scheduleStep(c: AudioContext, t: number, n: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16);
    const ch = PROG[bar % 4];
    const x = this.intensity;
    // beat-synchronised layer crossfades: only on the bar line
    if (s === 0) {
      for (let i = 0; i < 4; i++) this.layerG[i].gain.setTargetAtTime(this.wantLayers[i], t, 0.35);
      // Layer 1: atmospheric pad (two detuned saws per chord tone)
      for (const note of ch.chord) {
        this.mv(c, 0, t, 'sawtooth', midi(note), S16 * 16.5, 0.012, 900 + x * 1400, 0.6, -8);
        this.mv(c, 0, t, 'sawtooth', midi(note), S16 * 16.5, 0.012, 900 + x * 1400, 0.6, 8);
      }
      this.mv(c, 0, t, 'sine', midi(ch.root - 12), S16 * 16, 0.05, 300, 0.3);
    }
    // Layer 2: driving octave bass pulse on 8ths
    if (s % 2 === 0) this.mv(c, 1, t, 'sawtooth', midi(ch.root + (s % 4 === 2 ? 12 : 0)), S16 * 1.8, 0.05, 500 + x * 900, 0.004);
    // Layer 3: drums (four-on-the-floor kick once intense)
    if (s % 4 === 0 && (s % 8 === 0 || x > 0.6)) this.drum(c, t, 'kick', 0.32);
    if (s === 4 || s === 12) this.drum(c, t, 'snare', 0.13);
    if (s % 2 === 1 || x > 0.7) this.drum(c, t, 'hat', s % 4 === 2 ? 0.05 : 0.03);
    // Layer 4: racing lead / arpeggio
    if (x > 0.85 && s % 2 === 0) this.mv(c, 3, t, 'square', midi(LEAD[(s / 2 + bar * 8) % LEAD.length]), S16 * 2, 0.022, 3200, 0.004);
    else this.mv(c, 3, t, 'square', midi(ch.chord[(s * 3) % 4] + 12), S16 * 0.9, 0.016, 2600, 0.003);
    // Layer 5: perfect-shift accent on the next 8th
    if (this.accentQueued && s % 2 === 0) {
      this.accentQueued = false;
      this.layerG[4].gain.setValueAtTime(1, t);
      for (const note of ch.chord) this.mv(c, 4, t, 'sawtooth', midi(note + 12), S16 * 3, 0.02, 4200, 0.003);
      this.drum(c, t, 'crash', 0.06);
    }
    // final-stretch riser: 2 bars of rising filtered noise + snare roll, starting on a bar line
    if (this.riser && s === 0) {
      this.riser = false;
      this.riserStarted = true;
      const len = S16 * 32;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const fl = c.createBiquadFilter();
      fl.type = 'bandpass';
      fl.Q.value = 3;
      fl.frequency.setValueAtTime(300, t);
      fl.frequency.exponentialRampToValueAtTime(6000, t + len);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + len * 0.95);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
      src.connect(fl).connect(g).connect(this.layerG[4]);
      this.layerG[4].gain.setValueAtTime(1, t);
      src.start(t);
      src.stop(t + len + 0.2);
      for (let k = 0; k < 16; k++) this.drum(c, t + len - S16 * (16 - k) * 0.5, 'snare', 0.03 + k * 0.004);
    }
    void this.menuMusic;
  }
}

export const raceAudio = new RaceAudio();
