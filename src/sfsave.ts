/** SPELLFORGE persistence: one versioned LocalStorage record, validated on load (bad or old data is ignored). */
import type { Element } from './sfdata';
import { BOSS_ORDER, ELEMENTS, FUSIONS } from './sfdata';

export const SF_SAVE_VERSION = 1;
const KEY = 'pw-spellforge-v1';

export interface SfSettings {
  volume: number;
  music: number;
  sfx: number;
  muted: boolean;
  /** which hand is the "main" casting hand for pointing and menus */
  dominant: 'left' | 'right';
  /** seated mode lowers the cast reach and the body-height assumptions */
  seated: boolean;
  /** 0 = full effects, 1 = reduced flashes, bloom, shake and particles */
  reducedIntensity: boolean;
  subtitles: boolean;
  /** strength of the aim assist, 0..1 */
  aimAssist: number;
  difficulty: 'gentle' | 'normal' | 'hard';
  /** colour-blind-friendly element letters and shapes on spells and warnings */
  colourCues: boolean;
  tutorial: boolean;
}
export interface SfSave {
  v: number;
  counts: Record<Element, number>;
  discovered: string[];
  /** fastest win in seconds per boss, 0 = not defeated */
  bossBest: Record<string, number>;
  bestWave: number;
  accuracy: { casts: number; hits: number };
  trials: Record<string, number>;
  campaign: number; // bosses defeated in the campaign
  settings: SfSettings;
}

export const defaultSfSave = (): SfSave => ({
  v: SF_SAVE_VERSION,
  counts: { fire: 0, ice: 0, lightning: 0, aether: 0, nature: 0, shadow: 0 },
  discovered: [],
  bossBest: Object.fromEntries(BOSS_ORDER.map((b) => [b, 0])),
  bestWave: 0,
  accuracy: { casts: 0, hits: 0 },
  trials: {},
  campaign: 0,
  settings: { volume: 0.9, music: 1, sfx: 1, muted: false, dominant: 'right', seated: true, reducedIntensity: false, subtitles: true, aimAssist: 0.7, difficulty: 'normal', colourCues: false, tutorial: true },
});

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);

export function loadSfSave(): SfSave {
  const d = defaultSfSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<SfSave>;
    if (!o || o.v !== SF_SAVE_VERSION) return d;
    if (o.counts) for (const e of ELEMENTS) d.counts[e] = Math.round(num((o.counts as Record<string, unknown>)[e], 0, 1e6, 0));
    if (Array.isArray(o.discovered)) {
      const known = new Set<string>(FUSIONS.map((f) => f.id));
      d.discovered = o.discovered.filter((x): x is string => typeof x === 'string' && known.has(x));
    }
    if (o.bossBest) for (const b of BOSS_ORDER) d.bossBest[b] = num((o.bossBest as Record<string, unknown>)[b], 0, 1e5, 0);
    d.bestWave = Math.round(num(o.bestWave, 0, 1e4, 0));
    if (o.accuracy) {
      d.accuracy.casts = Math.round(num(o.accuracy.casts, 0, 1e7, 0));
      d.accuracy.hits = Math.round(num(o.accuracy.hits, 0, 1e7, 0));
    }
    if (o.trials && typeof o.trials === 'object') for (const [k, v] of Object.entries(o.trials)) if (typeof v === 'number' && isFinite(v) && k.length < 40) d.trials[k] = v;
    d.campaign = Math.round(num(o.campaign, 0, BOSS_ORDER.length, 0));
    const s = o.settings;
    if (s) {
      d.settings.volume = num(s.volume, 0, 1, 0.9);
      d.settings.music = num(s.music, 0, 1, 1);
      d.settings.sfx = num(s.sfx, 0, 1, 1);
      d.settings.muted = s.muted === true;
      d.settings.dominant = s.dominant === 'left' ? 'left' : 'right';
      d.settings.seated = s.seated !== false;
      d.settings.reducedIntensity = s.reducedIntensity === true;
      d.settings.subtitles = s.subtitles !== false;
      d.settings.aimAssist = num(s.aimAssist, 0, 1, 0.7);
      d.settings.difficulty = s.difficulty === 'gentle' || s.difficulty === 'hard' ? s.difficulty : 'normal';
      d.settings.colourCues = s.colourCues === true;
      d.settings.tutorial = s.tutorial !== false;
    }
    return d;
  } catch {
    return d;
  }
}
export function writeSfSave(s: SfSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the game still works without saving */
  }
}
