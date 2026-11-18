/** Aura Weaver persistence: one versioned LocalStorage record, validated on load (bad or old data is ignored or migrated). */
import { V1_TO_V2 } from './auralevels.js';

export const SAVE_VERSION = 2;
const KEY = 'pw-aura-v2';
const KEY_V1 = 'pw-aura-v1';
/** number of hidden discoveries (memory fragments, secret constellation, hidden echo, alternate solutions) */
export const DISCOVERIES = 12;

export interface AuraSettings {
  volume: number; // 0..1 master
  reducedMotion: boolean;
  labels: boolean; // colour-independent letter labels on beams, gates and nodes
  wisps: boolean; // guiding wisps / hint threads
  music: number; // 0..1 ambient music bus
  sfx: number; // 0..1 effects bus
  muted: boolean;
  reducedFlash: boolean; // calmer pulses, no fast flicker
  tutorial: boolean; // staged first-puzzle hints and quicker wisps
  /** comfort + accessibility (v2) */
  standing: boolean; // false = seated: the loom sits lower
  reach: number; // 0 near, 1 normal, 2 far: loom distance
  pointer: number; // 0 auto (hands direct, controllers ray), 1 always ray, 2 always direct
  aim: number; // 0 precise, 1 normal, 2 generous pick radius (controller sensitivity)
  highContrast: boolean;
  particles: number; // 0 full, 1 reduced, 2 minimal
  subtitles: boolean;
  difficulty: number; // 0 relaxed (longer threads, early hints), 1 standard, 2 challenge (no auto hints)
  snapTurn: boolean;
  ambience: number; // 0..1 environment soundscape bus
}
export interface AuraSave {
  v: number;
  unlocked: number; // highest unlocked puzzle index
  solved: boolean[];
  best: number[]; // fewest moves per puzzle, 0 = none
  time: number[]; // best seconds per puzzle, 0 = none
  hints: number[]; // hints used on the best run
  swift: boolean[]; // optional time record met
  found: boolean[]; // hidden discoveries
  stats: { moves: number; connections: number; hues: number[]; plays: number; threads: number; echoes: number; eraShifts: number };
  settings: AuraSettings;
  finished: boolean;
}

export const defaultSettings = (): AuraSettings => ({
  volume: 0.9,
  reducedMotion: false,
  labels: false,
  wisps: true,
  music: 1,
  sfx: 1,
  muted: false,
  reducedFlash: false,
  tutorial: true,
  standing: true,
  reach: 1,
  pointer: 0,
  aim: 1,
  highContrast: false,
  particles: 0,
  subtitles: true,
  difficulty: 1,
  snapTurn: false,
  ambience: 1,
});

export const defaultSave = (levels: number): AuraSave => ({
  v: SAVE_VERSION,
  unlocked: 0,
  solved: Array.from({ length: levels }, () => false),
  best: Array.from({ length: levels }, () => 0),
  time: Array.from({ length: levels }, () => 0),
  hints: Array.from({ length: levels }, () => 0),
  swift: Array.from({ length: levels }, () => false),
  found: Array.from({ length: DISCOVERIES }, () => false),
  stats: { moves: 0, connections: 0, hues: [0, 0, 0, 0, 0, 0, 0, 0], plays: 0, threads: 0, echoes: 0, eraShifts: 0 },
  settings: defaultSettings(),
  finished: false,
});

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const int = (x: unknown, lo: number, hi: number, d: number): number => Math.round(num(x, lo, hi, d));
const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);

function readSettings(o: Partial<AuraSettings> | undefined, d: AuraSettings): void {
  if (!o) return;
  d.volume = num(o.volume, 0, 1, d.volume);
  d.reducedMotion = bool(o.reducedMotion, d.reducedMotion);
  d.labels = bool(o.labels, d.labels);
  d.wisps = bool(o.wisps, d.wisps);
  d.music = num(o.music, 0, 1, d.music);
  d.sfx = num(o.sfx, 0, 1, d.sfx);
  d.muted = bool(o.muted, d.muted);
  d.reducedFlash = bool(o.reducedFlash, d.reducedFlash);
  d.tutorial = bool(o.tutorial, d.tutorial);
  d.standing = bool(o.standing, d.standing);
  d.reach = int(o.reach, 0, 2, d.reach);
  d.pointer = int(o.pointer, 0, 2, d.pointer);
  d.aim = int(o.aim, 0, 2, d.aim);
  d.highContrast = bool(o.highContrast, d.highContrast);
  d.particles = int(o.particles, 0, 2, d.particles);
  d.subtitles = bool(o.subtitles, d.subtitles);
  d.difficulty = int(o.difficulty, 0, 2, d.difficulty);
  d.snapTurn = bool(o.snapTurn, d.snapTurn);
  d.ambience = num(o.ambience, 0, 1, d.ambience);
}

export function loadSave(levels: number): AuraSave {
  const d = defaultSave(levels);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return migrateV1(levels) ?? d;
    const o = JSON.parse(raw) as Partial<AuraSave>;
    if (!o || o.v !== SAVE_VERSION) return d;
    d.unlocked = int(o.unlocked, 0, levels - 1, 0);
    const arr = <T>(src: unknown, dst: T[], f: (x: unknown, i: number) => T): void => {
      if (Array.isArray(src)) for (let i = 0; i < dst.length; i++) dst[i] = f(src[i], i);
    };
    arr(o.solved, d.solved, (x) => x === true);
    arr(o.best, d.best, (x) => int(x, 0, 9999, 0));
    arr(o.time, d.time, (x) => num(x, 0, 1e5, 0));
    arr(o.hints, d.hints, (x) => int(x, 0, 999, 0));
    arr(o.swift, d.swift, (x) => x === true);
    arr(o.found, d.found, (x) => x === true);
    if (o.stats) {
      const s = o.stats;
      d.stats.moves = int(s.moves, 0, 1e6, 0);
      d.stats.connections = int(s.connections, 0, 1e6, 0);
      d.stats.plays = int(s.plays, 0, 1e6, 0);
      d.stats.threads = int(s.threads, 0, 1e6, 0);
      d.stats.echoes = int(s.echoes, 0, 1e6, 0);
      d.stats.eraShifts = int(s.eraShifts, 0, 1e6, 0);
      arr(s.hues, d.stats.hues, (x) => int(x, 0, 1e6, 0));
    }
    readSettings(o.settings, d.settings);
    d.finished = o.finished === true;
    return d;
  } catch {
    return d;
  }
}

/** A player from the first version keeps their restored light puzzles and settings. */
function migrateV1(levels: number): AuraSave | null {
  try {
    const raw = localStorage.getItem(KEY_V1);
    if (!raw) return null;
    const o = JSON.parse(raw) as { v?: number; solved?: unknown[]; best?: unknown[]; settings?: Partial<AuraSettings>; stats?: { moves?: unknown; connections?: unknown; plays?: unknown } };
    if (!o || o.v !== 1) return null;
    const d = defaultSave(levels);
    V1_TO_V2.forEach((ni, oi) => {
      if (ni >= levels) return;
      d.solved[ni] = o.solved?.[oi] === true;
      d.best[ni] = int(o.best?.[oi], 0, 9999, 0);
    });
    readSettings(o.settings, d.settings);
    if (o.stats) {
      d.stats.moves = int(o.stats.moves, 0, 1e6, 0);
      d.stats.connections = int(o.stats.connections, 0, 1e6, 0);
      d.stats.plays = int(o.stats.plays, 0, 1e6, 0);
    }
    // the new thread puzzles of world 1 open first; everything up to the furthest restored puzzle stays open
    let far = 0;
    d.solved.forEach((s, i) => s && (far = Math.max(far, i + 1)));
    d.unlocked = Math.min(levels - 1, far);
    return d;
  } catch {
    return null;
  }
}

export function writeSave(s: AuraSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the game still works without saving */
  }
}
