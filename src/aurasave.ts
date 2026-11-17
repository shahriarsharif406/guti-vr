/** Aura Weaver persistence: one versioned LocalStorage record, validated on load (bad or old data is ignored). */
export const SAVE_VERSION = 1;
const KEY = 'pw-aura-v1';

export interface AuraSettings {
  volume: number; // 0..1 master
  reducedMotion: boolean;
  labels: boolean; // colour-blind-friendly letter labels on beams and gates
  wisps: boolean; // guiding wisps
}
export interface AuraSave {
  v: number;
  unlocked: number; // highest unlocked level index
  solved: boolean[];
  best: number[]; // fewest moves per level, 0 = none
  stats: { moves: number; connections: number; hues: number[]; plays: number };
  settings: AuraSettings;
  finished: boolean;
}

export const defaultSave = (levels: number): AuraSave => ({
  v: SAVE_VERSION,
  unlocked: 0,
  solved: Array.from({ length: levels }, () => false),
  best: Array.from({ length: levels }, () => 0),
  stats: { moves: 0, connections: 0, hues: [0, 0, 0, 0, 0, 0, 0], plays: 0 },
  settings: { volume: 0.9, reducedMotion: false, labels: false, wisps: true },
  finished: false,
});

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);

export function loadSave(levels: number): AuraSave {
  const d = defaultSave(levels);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<AuraSave>;
    if (!o || o.v !== SAVE_VERSION) return d;
    d.unlocked = Math.round(num(o.unlocked, 0, levels - 1, 0));
    if (Array.isArray(o.solved)) d.solved = d.solved.map((_, i) => o.solved?.[i] === true);
    if (Array.isArray(o.best)) d.best = d.best.map((_, i) => Math.round(num(o.best?.[i], 0, 9999, 0)));
    if (o.stats) {
      d.stats.moves = Math.round(num(o.stats.moves, 0, 1e6, 0));
      d.stats.connections = Math.round(num(o.stats.connections, 0, 1e6, 0));
      d.stats.plays = Math.round(num(o.stats.plays, 0, 1e6, 0));
      if (Array.isArray(o.stats.hues)) d.stats.hues = d.stats.hues.map((_, i) => Math.round(num(o.stats?.hues?.[i], 0, 1e6, 0)));
    }
    if (o.settings) {
      d.settings.volume = num(o.settings.volume, 0, 1, 0.9);
      d.settings.reducedMotion = o.settings.reducedMotion === true;
      d.settings.labels = o.settings.labels === true;
      d.settings.wisps = o.settings.wisps !== false;
    }
    d.finished = o.finished === true;
    return d;
  } catch {
    return d;
  }
}

export function writeSave(s: AuraSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the game still works without saving */
  }
}
