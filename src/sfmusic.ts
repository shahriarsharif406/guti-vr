/**
 * SPELLFORGE adaptive music: pure mix rules (no audio, no DOM) so they can be unit tested.
 * The procedural synth that plays these layers lives in sfaudio.ts.
 */
export interface MusicMix {
  /** beats per minute of the battle layer */
  bpm: number;
  /** kick / low drum level 0..1 */
  drums: number;
  /** off-beat noise ticks 0..1 */
  hats: number;
  /** boss ostinato (low repeating figure) 0..1 */
  ostinato: number;
  /** extra semitones added to the ostinato as the boss escalates */
  lift: number;
  /** heartbeat pulse when the player is low 0..1 */
  heartbeat: number;
  /** high sustained "choir" pad for the final phase 0..1 */
  choir: number;
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * tension 0..1 (smoothed threat), phase = boss phase index (or -1 when no boss), phases = phase count,
 * hp = player hp fraction 0..1. Deterministic: same input, same mix. Writes into `out` (no allocation).
 */
export function musicMix(tension: number, phase: number, phases: number, hp: number, out: MusicMix): MusicMix {
  const t = clamp(tension);
  const boss = phase >= 0 && phases > 0;
  const prog = boss ? (phases > 1 ? clamp(phase / (phases - 1)) : 1) : 0;
  out.bpm = boss ? 92 + Math.round(prog * 28) : 84 + Math.round(t * 12);
  out.drums = boss ? 0.55 + 0.45 * prog : t < 0.2 ? 0 : clamp((t - 0.2) * 1.25);
  out.hats = boss ? (prog >= 0.34 ? 0.4 + 0.6 * prog : 0.25) : t < 0.5 ? 0 : clamp((t - 0.5) * 2) * 0.6;
  out.ostinato = boss ? 0.5 + 0.5 * prog : 0;
  out.lift = boss ? (prog >= 0.99 ? 3 : prog >= 0.5 ? 2 : 0) : 0;
  out.heartbeat = hp < 0.35 ? clamp((0.35 - hp) / 0.25) : 0;
  out.choir = boss && phases > 1 && phase >= phases - 1 ? 1 : 0;
  return out;
}

export const newMix = (): MusicMix => ({ bpm: 84, drums: 0, hats: 0, ostinato: 0, lift: 0, heartbeat: 0, choir: 0 });
