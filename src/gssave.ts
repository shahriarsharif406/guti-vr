/**
 * Neon Overdrive settings + progress, persisted locally (localStorage key 'pw-gs-race-v1').
 * Pure apart from the storage calls, which are all wrapped so a blocked/missing storage never throws.
 */
import type { GhostData, Records } from './racelogic.js';

export type VrShift = 'lever' | 'button' | 'simple';
export type Graphics = 'auto' | 'low' | 'medium' | 'high';
export type Action = 'up' | 'down' | 'turbo' | 'pause' | 'camera';
export const ACTIONS: Action[] = ['up', 'down', 'turbo', 'pause', 'camera'];
export const ACTION_LABEL: Record<Action, string> = { up: 'Shift up', down: 'Shift down', turbo: 'Turbo boost', pause: 'Pause', camera: 'Camera view' };

export interface GsSettings {
  car: string;
  track: string;
  mode: string;
  diff: string;
  camera: 'cockpit' | 'chase';
  graphics: Graphics;
  vol: { master: number; music: number; engine: number; sfx: number; ambient: number };
  muted: boolean;
  highContrast: boolean;
  reducedCamera: boolean;
  vfx: number; // visual intensity 0..1
  timingAssist: boolean;
  audioCue: boolean;
  subtitles: boolean;
  haptics: boolean;
  seated: boolean;
  cockpitHeight: number; // metres, -0.3..0.3
  comfortVignette: boolean;
  vrShift: VrShift;
  leverSens: number; // 0.5..2
  touchSens: number; // 0.5..2
  touchSwipe: boolean;
  keys: Record<Action, string[]>;
  unlockAll: boolean;
  showGhost: boolean;
  coach: boolean;
}

export interface GsSave {
  v: 1;
  settings: GsSettings;
  xp: number;
  races: number;
  achievements: string[];
  records: Records;
  ghosts: Record<string, GhostData>;
  dailyDone: Record<string, number>;
  /** 'bench' or 'race': which GearShift mode the player picked last */
  lastPick: string;
}

export const SAVE_KEY = 'pw-gs-race-v1';

export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ['Space', 'ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  turbo: ['KeyF', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
};

export function defaultSettings(): GsSettings {
  return {
    car: 'vx1',
    track: 'city',
    mode: 'quick',
    diff: 'amateur',
    camera: 'chase',
    graphics: 'auto',
    vol: { master: 0.9, music: 0.7, engine: 0.85, sfx: 0.85, ambient: 0.6 },
    muted: false,
    highContrast: false,
    reducedCamera: false,
    vfx: 1,
    timingAssist: true,
    audioCue: false,
    subtitles: false,
    haptics: true,
    seated: true,
    cockpitHeight: 0,
    comfortVignette: true,
    vrShift: 'lever',
    leverSens: 1,
    touchSens: 1,
    touchSwipe: true,
    keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)) as Record<Action, string[]>,
    unlockAll: false,
    showGhost: true,
    coach: true,
  };
}

export function defaultSave(): GsSave {
  return { v: 1, settings: defaultSettings(), xp: 0, races: 0, achievements: [], records: { best: {}, board: {} }, ghosts: {}, dailyDone: {}, lastPick: '' };
}

const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const str = <T extends string>(v: unknown, d: T, ok?: readonly string[]): T => (typeof v === 'string' && (!ok || ok.includes(v)) ? (v as T) : d);

/** Merge untrusted stored data onto defaults, clamping every field. */
export function sanitize(raw: unknown): GsSave {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<GsSave> & { settings?: Partial<GsSettings> };
  const s = (r.settings ?? {}) as Partial<GsSettings>;
  const ds = d.settings;
  const vol = (s.vol ?? {}) as Partial<GsSettings['vol']>;
  const keys = { ...ds.keys };
  if (s.keys && typeof s.keys === 'object') {
    for (const a of ACTIONS) {
      const k = (s.keys as Record<string, unknown>)[a];
      if (Array.isArray(k) && k.length && k.every((x) => typeof x === 'string')) keys[a] = (k as string[]).slice(0, 3);
    }
  }
  d.settings = {
    car: str(s.car, ds.car),
    track: str(s.track, ds.track),
    mode: str(s.mode, ds.mode),
    diff: str(s.diff, ds.diff),
    camera: str(s.camera, ds.camera, ['cockpit', 'chase']),
    graphics: str(s.graphics, ds.graphics, ['auto', 'low', 'medium', 'high']),
    vol: { master: num(vol.master, ds.vol.master, 0, 1), music: num(vol.music, ds.vol.music, 0, 1), engine: num(vol.engine, ds.vol.engine, 0, 1), sfx: num(vol.sfx, ds.vol.sfx, 0, 1), ambient: num(vol.ambient, ds.vol.ambient, 0, 1) },
    muted: bool(s.muted, ds.muted),
    highContrast: bool(s.highContrast, ds.highContrast),
    reducedCamera: bool(s.reducedCamera, ds.reducedCamera),
    vfx: num(s.vfx, ds.vfx, 0, 1),
    timingAssist: bool(s.timingAssist, ds.timingAssist),
    audioCue: bool(s.audioCue, ds.audioCue),
    subtitles: bool(s.subtitles, ds.subtitles),
    haptics: bool(s.haptics, ds.haptics),
    seated: bool(s.seated, ds.seated),
    cockpitHeight: num(s.cockpitHeight, ds.cockpitHeight, -0.3, 0.3),
    comfortVignette: bool(s.comfortVignette, ds.comfortVignette),
    vrShift: str(s.vrShift, ds.vrShift, ['lever', 'button', 'simple']),
    leverSens: num(s.leverSens, ds.leverSens, 0.5, 2),
    touchSens: num(s.touchSens, ds.touchSens, 0.5, 2),
    touchSwipe: bool(s.touchSwipe, ds.touchSwipe),
    keys,
    unlockAll: bool(s.unlockAll, ds.unlockAll),
    showGhost: bool(s.showGhost, ds.showGhost),
    coach: bool(s.coach, ds.coach),
  };
  d.xp = num(r.xp, 0, 0, 1e9);
  d.races = num(r.races, 0, 0, 1e9);
  d.achievements = Array.isArray(r.achievements) ? r.achievements.filter((x) => typeof x === 'string') : [];
  const rec = r.records as Records | undefined;
  if (rec && typeof rec === 'object' && rec.best && rec.board) d.records = { best: { ...rec.best }, board: { ...rec.board } };
  if (r.ghosts && typeof r.ghosts === 'object') {
    for (const [k, g] of Object.entries(r.ghosts)) {
      if (g && g.v === 1 && Array.isArray(g.samples) && typeof g.time === 'number') d.ghosts[k] = g;
    }
  }
  if (r.dailyDone && typeof r.dailyDone === 'object') d.dailyDone = { ...r.dailyDone };
  d.lastPick = str(r.lastPick, '');
  return d;
}

export function loadSave(): GsSave {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: GsSave): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Human label for a KeyboardEvent.code */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  return code.replace('Left', ' L').replace('Right', ' R');
}

/** Rebind: put `code` first for `action` and remove it from every other action. */
export function rebind(keys: Record<Action, string[]>, action: Action, code: string): Record<Action, string[]> {
  const out = {} as Record<Action, string[]>;
  for (const a of ACTIONS) out[a] = keys[a].filter((k) => k !== code);
  out[action] = [code, ...out[action]].slice(0, 3);
  return out;
}

export function actionFor(keys: Record<Action, string[]>, code: string): Action | null {
  for (const a of ACTIONS) if (keys[a].includes(code)) return a;
  return null;
}
