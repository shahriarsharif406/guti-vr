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

export const sfx = {
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
};
