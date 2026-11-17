/**
 * Aura Weaver automated tests (pure logic: optics, colour mixing, puzzles, save data).
 * Run: npm run test:aura   (bundles with esbuild, runs on Node, exits non-zero on failure)
 * Rendering, audio and XR input are NOT covered here; they were checked manually in a browser.
 */
import assert from 'node:assert/strict';
import { CHAPTER_NAMES, CYAN, GOLD, MAGENTA, MIRROR_STEPS, PRISM_STEPS, WHITE, makeLevels, solve, stepsOf, trace } from '../src/auralogic';
import type { Elem, Level } from '../src/auralogic';
import { defaultSave, loadSave, writeSave, SAVE_VERSION } from '../src/aurasave';

let passed = 0;
let failed = 0;
const test = (name: string, fn: () => void): void => {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + (e as Error).message);
  }
};

// minimal in-memory localStorage for the save tests
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const lvl = (sources: Level['sources'], elems: Elem[], targets: Level['targets']): Level => ({ name: 't', chapter: CHAPTER_NAMES[0], goal: '', hint: '', sources, elems, targets });
const gate = (x: number, y: number, mask: number) => ({ x, y, mask, r: 0.05 });
const src = (x: number, y: number, ang: number, mask: number) => ({ x, y, ang, mask });

console.log('colour mixing');
test('cyan beam alone lights a cyan gate', () => {
  const t = trace(lvl([src(-0.4, 0, 0, CYAN)], [], [gate(0.4, 0, CYAN)]));
  assert.equal(t.got[0], CYAN);
  assert.ok(t.solved);
});
test('cyan + magenta mix additively to violet (mask 3)', () => {
  const t = trace(lvl([src(-0.4, 0.01, 0, CYAN), src(-0.4, -0.01, 0, MAGENTA)], [], [gate(0.4, 0, CYAN | MAGENTA)]));
  assert.equal(t.got[0], CYAN | MAGENTA);
});
test('cyan + gold = emerald mask 5 and magenta + gold = ember mask 6', () => {
  assert.equal(CYAN | GOLD, 5);
  assert.equal(MAGENTA | GOLD, 6);
  assert.equal(CYAN | MAGENTA | GOLD, WHITE);
});
test('a gate needing violet is NOT opened by cyan only (impure / insufficient)', () => {
  const t = trace(lvl([src(-0.4, 0, 0, CYAN)], [], [gate(0.4, 0, CYAN | MAGENTA)]));
  assert.equal(t.solved, false);
});
test('extra colour keeps a gate shut (exact match required)', () => {
  const t = trace(lvl([src(-0.4, 0.005, 0, CYAN), src(-0.4, -0.005, 0, MAGENTA)], [], [gate(0.4, 0, CYAN)]));
  assert.equal(t.got[0], CYAN | MAGENTA);
  assert.equal(t.solved, false);
});

console.log('optics elements');
test('a wall absorbs light', () => {
  const wall: Elem = { kind: 'wall', x: 0, y: 0, a: 0, rot: false, len: 0.2, mask: 0, fixedAng: Math.PI / 2 };
  const t = trace(lvl([src(-0.4, 0, 0, CYAN)], [wall], [gate(0.4, 0, CYAN)]));
  assert.equal(t.got[0], 0);
});
test('a filter keeps only its own colour', () => {
  const f: Elem = { kind: 'filter', x: 0, y: 0, a: 0, rot: false, len: 0.1, mask: CYAN, fixedAng: Math.PI / 2 };
  const t = trace(lvl([src(-0.4, 0, 0, CYAN | MAGENTA)], [f], [gate(0.4, 0, CYAN)]));
  assert.equal(t.got[0], CYAN);
});
test('a mirror turns the beam; rotating it changes the outcome', () => {
  const m: Elem = { kind: 'mirror', x: 0, y: 0, a: 3, rot: true, len: 0.08, mask: 0 };
  const l = lvl([src(-0.4, 0, 0, CYAN)], [m], [gate(0, 0.25, CYAN)]);
  const before = trace(l).solved;
  m.a = 9; // 135 degrees steers the beam up
  const after = trace(l).solved;
  assert.notEqual(before, after);
});
test('a prism fans white light into three primaries', () => {
  const p: Elem = { kind: 'prism', x: 0, y: 0, a: 0, rot: true, len: 0, mask: 0 };
  const t = trace(lvl([src(-0.4, 0, 0, WHITE)], [p], []));
  const masks = new Set(t.segs.map((s) => s.mask));
  assert.ok(masks.has(CYAN) && masks.has(MAGENTA) && masks.has(GOLD), 'expected single-colour beams after the prism');
});
test('a splitter transmits and reflects', () => {
  const s: Elem = { kind: 'splitter', x: 0, y: 0, a: 3, rot: true, len: 0.08, mask: 0 };
  const t = trace(lvl([src(-0.4, 0, 0, CYAN)], [s], []));
  assert.ok(t.segs.length >= 3);
});
test('mirror boxes cannot loop forever (ray budget bounds the trace)', () => {
  const elems: Elem[] = [];
  for (let i = 0; i < 6; i++) elems.push({ kind: 'mirror', x: -0.3 + i * 0.12, y: i % 2 ? 0.1 : -0.1, a: 3, rot: true, len: 0.3, mask: 0 });
  const t = trace(lvl([src(-0.5, 0, 0, WHITE)], elems, []));
  assert.ok(t.segs.length < 200);
});
test('rotation wraps: stepsOf gives 12 per mirror and 24 per prism', () => {
  assert.equal(MIRROR_STEPS, 12);
  assert.equal(PRISM_STEPS, 24);
  const m: Elem = { kind: 'mirror', x: 0, y: 0, a: 11, rot: true, len: 0.1, mask: 0 };
  assert.equal(((m.a + 1) % stepsOf(m)), 0);
});

console.log('puzzles');
test('five chapters exist and every chapter has at least one level', () => {
  const lv = makeLevels();
  for (const c of CHAPTER_NAMES) assert.ok(lv.some((l) => l.chapter === c), 'no level in ' + c);
  assert.equal(CHAPTER_NAMES.length, 5);
});
makeLevels().forEach((l, i) => {
  test('level ' + (i + 1) + ' (' + l.name + ') starts unsolved and has a valid solution', () => {
    const fresh = makeLevels()[i];
    assert.equal(trace(fresh, false).solved, false);
    const sols = solve(fresh, 5);
    assert.ok(sols.length > 0, 'no solution');
    const rots = fresh.elems.map((e, k) => (e.rot ? k : -1)).filter((k) => k >= 0);
    rots.forEach((ei, k) => (fresh.elems[ei].a = sols[0][k]));
    assert.equal(trace(fresh, false).solved, true);
  });
});
test('reset: makeLevels returns fresh, independent angle state', () => {
  const a = makeLevels();
  a[0].elems.forEach((e) => (e.a = 5));
  const b = makeLevels();
  assert.notDeepEqual(a[0].elems.map((e) => e.a), b[0].elems.map((e) => e.a));
});
test('trace is deterministic', () => {
  const l = makeLevels()[4];
  assert.deepEqual(trace(l).got, trace(l).got);
});

console.log('save data');
test('default save is well formed', () => {
  const d = defaultSave(7);
  assert.equal(d.solved.length, 7);
  assert.equal(d.v, SAVE_VERSION);
});
test('save round trip keeps progress and settings', () => {
  store.clear();
  const d = defaultSave(7);
  d.solved[0] = true;
  d.unlocked = 1;
  d.best[0] = 4;
  d.settings.muted = true;
  d.settings.music = 0.5;
  writeSave(d);
  const r = loadSave(7);
  assert.equal(r.solved[0], true);
  assert.equal(r.unlocked, 1);
  assert.equal(r.best[0], 4);
  assert.equal(r.settings.muted, true);
  assert.equal(r.settings.music, 0.5);
});
test('corrupt JSON falls back to defaults', () => {
  store.set('pw-aura-v1', '{not json');
  assert.deepEqual(loadSave(7), defaultSave(7));
});
test('outdated or foreign save version is ignored', () => {
  store.set('pw-aura-v1', JSON.stringify({ v: 0, unlocked: 5 }));
  assert.equal(loadSave(7).unlocked, 0);
});
test('out-of-range values are clamped, wrong types ignored', () => {
  store.set('pw-aura-v1', JSON.stringify({ v: SAVE_VERSION, unlocked: 99, solved: [true, 'x'], best: [-5], settings: { volume: 9, sfx: 'loud' } }));
  const r = loadSave(7);
  assert.equal(r.unlocked, 6);
  assert.deepEqual(r.solved.slice(0, 2), [true, false]);
  assert.equal(r.best[0], 0);
  assert.equal(r.settings.volume, 1);
  assert.equal(r.settings.sfx, 1);
});
test('missing storage never throws', () => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
  assert.equal(loadSave(7).unlocked, 0);
  writeSave(defaultSave(7));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
