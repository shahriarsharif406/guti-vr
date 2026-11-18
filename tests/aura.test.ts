/**
 * Aura Weaver automated tests (pure logic: optics, colour mixing, puzzles, save data).
 * Run: npm run test:aura   (bundles with esbuild, runs on Node, exits non-zero on failure)
 * Rendering, audio and XR input are NOT covered here; they were checked manually in a browser.
 */
import assert from 'node:assert/strict';
import { CHAPTER_NAMES, CYAN, GOLD, MAGENTA, MIRROR_STEPS, PRISM_STEPS, WHITE, makeLevels, solve, stepsOf, trace } from '../src/auralogic';
import type { Elem, Level } from '../src/auralogic';
import { defaultSave, loadSave, writeSave, SAVE_VERSION } from '../src/aurasave';
import { ECHO_SUSTAIN, EchoTrack, brokenThreads, canWeave, echoReady, evaluate, freshState, holdLimit, latchMemories, node, nodePos, solveWeave } from '../src/threadlogic';
import type { Weave, WeaveState } from '../src/threadlogic';
import { MECH_NAME, V1_TO_V2, WORLDS, makePuzzles } from '../src/auralevels';
import { ThreadPlay } from '../src/threadplay';

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
  store.set('pw-aura-v2', '{not json');
  assert.deepEqual(loadSave(7), defaultSave(7));
});
test('outdated or foreign save version is ignored', () => {
  store.set('pw-aura-v2', JSON.stringify({ v: 0, unlocked: 5 }));
  assert.equal(loadSave(7).unlocked, 0);
});
test('out-of-range values are clamped, wrong types ignored', () => {
  store.set('pw-aura-v2', JSON.stringify({ v: SAVE_VERSION, unlocked: 99, solved: [true, 'x'], best: [-5], settings: { volume: 9, sfx: 'loud', reach: 7, difficulty: -3 } }));
  const r = loadSave(7);
  assert.equal(r.unlocked, 6);
  assert.deepEqual(r.solved.slice(0, 2), [true, false]);
  assert.equal(r.best[0], 0);
  assert.equal(r.settings.volume, 1);
  assert.equal(r.settings.sfx, 1);
  assert.equal(r.settings.reach, 2);
  assert.equal(r.settings.difficulty, 0);
});
test('a version-1 save migrates: restored light puzzles keep their place in the new journey', () => {
  store.clear();
  store.set('pw-aura-v1', JSON.stringify({ v: 1, unlocked: 2, solved: [true, true, false, false, false, false, false], best: [3, 5, 0, 0, 0, 0, 0], settings: { muted: true } }));
  const r = loadSave(15);
  assert.equal(r.v, SAVE_VERSION);
  assert.equal(r.solved[V1_TO_V2[0]], true);
  assert.equal(r.solved[V1_TO_V2[1]], true);
  assert.equal(r.best[V1_TO_V2[1]], 5);
  assert.equal(r.solved[0], false, 'new thread puzzles start unsolved');
  assert.equal(r.settings.muted, true);
  assert.ok(r.unlocked >= V1_TO_V2[1]);
});
test('an interim v2 save with one slot per light puzzle is re-indexed into the full journey', () => {
  store.clear();
  store.set('pw-aura-v2', JSON.stringify({ v: SAVE_VERSION, unlocked: 2, solved: [true, true, false, false, false, false, false], best: [3, 5, 0, 0, 0, 0, 0], time: [9, 0, 0, 0, 0, 0, 0], finished: true, settings: { sfx: 0.5 } }));
  const r = loadSave(15);
  assert.equal(r.solved[V1_TO_V2[0]], true);
  assert.equal(r.solved[V1_TO_V2[1]], true);
  assert.equal(r.best[V1_TO_V2[1]], 5);
  assert.equal(r.time[V1_TO_V2[0]], 9);
  assert.equal(r.solved[0], false, 'thread puzzles stay unsolved');
  assert.equal(r.finished, false);
  assert.equal(r.unlocked, V1_TO_V2[1] + 1);
  assert.equal(r.settings.sfx, 0.5);
  // a full-length v2 save is read as is
  const d = defaultSave(15);
  d.solved[0] = true;
  writeSave(d);
  assert.equal(loadSave(15).solved[0], true);
});
test('missing storage never throws', () => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
  assert.equal(loadSave(7).unlocked, 0);
  writeSave(defaultSave(7));
});


// ====================================================================== threads (mechanic A)
const W = (o: Partial<Weave>): Weave => ({ nodes: [], rings: [], walls: [], fixed: [], maxLen: 0.5, eras: 1, echoSlots: 0, sockets: [], ...o });
const st = (w: Weave, threads: WeaveState['threads'] = []): WeaveState => {
  const s = freshState(w);
  s.threads = threads;
  s.lightOn = [true];
  return s;
};
console.log('thread weaving');
test('a thread carries energy from a source to a receiver', () => {
  const w = W({ nodes: [node('source', -0.2, 0, { mask: CYAN }), node('receiver', 0.2, 0, { mask: CYAN })] });
  assert.equal(evaluate(w, st(w)).solved, false);
  assert.equal(evaluate(w, st(w, [{ a: 0, b: 1, era: 2 }])).solved, true);
});
test('direction matters: a reversed thread carries nothing', () => {
  const w = W({ nodes: [node('source', -0.2, 0, { mask: CYAN }), node('receiver', 0.2, 0, { mask: CYAN })] });
  assert.notEqual(canWeave(w, st(w), 1, 0), '', 'a receiver has no outgoing capacity');
  const w2 = W({ nodes: [node('source', -0.3, 0, { mask: CYAN }), node('relay', 0, 0), node('receiver', 0.3, 0, { mask: CYAN })] });
  assert.equal(evaluate(w2, st(w2, [{ a: 0, b: 1, era: 2 }, { a: 2, b: 1, era: 2 }])).solved, false);
});
test('tension: a thread longer than its reach cannot be woven; relaxed slack extends it', () => {
  const w = W({ maxLen: 0.3, nodes: [node('source', -0.2, 0, { mask: CYAN }), node('receiver', 0.2, 0, { mask: CYAN })] });
  assert.equal(canWeave(w, st(w), 0, 1), 'too-long');
  const s = st(w);
  s.slack = 0.4;
  assert.equal(canWeave(w, s, 0, 1), '');
});
test('walls block threads; threads may not cross each other', () => {
  const w = W({ nodes: [node('source', -0.2, 0, { mask: CYAN }), node('receiver', 0.2, 0, { mask: CYAN })], walls: [{ x1: 0, y1: -0.1, x2: 0, y2: 0.1, era: 0 }] });
  assert.equal(canWeave(w, st(w), 0, 1), 'wall');
  const w2 = W({ nodes: [node('source', -0.2, 0, { mask: CYAN }), node('receiver', 0.2, 0, { mask: CYAN }), node('source', 0, -0.2, { mask: CYAN }), node('receiver', 0, 0.2, { mask: CYAN })] });
  assert.equal(canWeave(w2, st(w2, [{ a: 0, b: 1, era: 2 }]), 2, 3), 'crossing');
});
test('capacity: a relay feeds one thread, a splitter two', () => {
  const w = W({ nodes: [node('source', -0.3, 0, { mask: CYAN }), node('relay', 0, 0), node('receiver', 0.2, 0.1, { mask: CYAN }), node('receiver', 0.2, -0.1, { mask: CYAN }), node('splitter', 0, 0.25)] });
  assert.equal(canWeave(w, st(w, [{ a: 1, b: 2, era: 2 }]), 1, 3), 'capacity-out');
  assert.equal(canWeave(w, st(w, [{ a: 4, b: 2, era: 2 }]), 4, 3), '');
});
test('colour: a receiver needs EXACTLY its colour (two threads mix)', () => {
  const w = W({ nodes: [node('source', -0.3, 0.1, { mask: CYAN }), node('source', -0.3, -0.1, { mask: MAGENTA }), node('receiver', 0.2, 0, { mask: CYAN | MAGENTA })] });
  assert.equal(evaluate(w, st(w, [{ a: 0, b: 2, era: 2 }])).solved, false);
  assert.equal(evaluate(w, st(w, [{ a: 0, b: 2, era: 2 }, { a: 1, b: 2, era: 2 }])).solved, true);
});
test('a locked node conducts only while its seal node is powered', () => {
  const w = W({ nodes: [node('source', -0.3, 0, { mask: CYAN }), node('splitter', -0.1, 0), node('receiver', 0.1, 0.2, { mask: CYAN }), node('locked', 0.1, -0.1, { lockBy: 2 }), node('receiver', 0.3, -0.1, { mask: CYAN })] });
  const half = [{ a: 0, b: 1, era: 2 as const }, { a: 1, b: 3, era: 2 as const }, { a: 3, b: 4, era: 2 as const }];
  assert.equal(evaluate(w, st(w, half)).receiverOk[4], false);
  assert.equal(evaluate(w, st(w, half.concat([{ a: 1, b: 2, era: 2 }]))).solved, true);
});
test('a key conducts only while held; one living hand holds one key', () => {
  const w = W({ nodes: [node('source', -0.3, 0, { mask: CYAN }), node('key', 0, 0), node('receiver', 0.3, 0, { mask: CYAN })], fixed: [{ a: 0, b: 1, era: 2, fixed: true }, { a: 1, b: 2, era: 2, fixed: true }] });
  const s = st(w);
  assert.equal(evaluate(w, s).solved, false);
  s.held = [1];
  assert.equal(evaluate(w, s).solved, true);
  assert.equal(holdLimit(w, s, 1), 1, 'no memory charged, so no echo');
});
test('a memory node latches once powered and enables echoes', () => {
  const w = W({ echoSlots: 1, nodes: [node('source', -0.3, 0, { mask: CYAN }), node('memory', 0, 0, { mask: CYAN }), node('relay', 0.3, 0)] });
  const s = st(w, [{ a: 0, b: 1, era: 2 }]);
  assert.equal(echoReady(w, s), false);
  assert.equal(latchMemories(w, s), true);
  s.threads = [];
  assert.equal(echoReady(w, s), true);
  s.threads = [{ a: 1, b: 2, era: 2 }];
  assert.ok(evaluate(w, s).mask[1][2] !== 0, 'the latched memory still feeds energy after its thread is gone');
  assert.equal(holdLimit(w, s, 1), 2);
});
test('fixed threads cannot be broken; woven ones snap when a ring turns them too far', () => {
  const w = W({ maxLen: 0.25, rings: [{ cx: 0, cy: 0, r: 0.15, steps: 8, a: 0, motor: -1 }], nodes: [node('source', -0.3, 0, { mask: CYAN }), node('star', 0, 0, { ring: 0, phase: Math.PI })] });
  const s = st(w, [{ a: 0, b: 1, era: 2 }]);
  assert.equal(brokenThreads(w, s).length, 0);
  w.rings[0].a = 4; // star swings to the far side
  assert.equal(brokenThreads(w, s).length, 1);
});

console.log('celestial geometry, time and memory echoes');
test('stars ride their ring: positions follow the ring angle', () => {
  const w = W({ rings: [{ cx: 0, cy: 0, r: 0.2, steps: 8, a: 0, motor: -1 }], nodes: [node('star', 0, 0, { ring: 0, phase: 0 })] });
  assert.ok(Math.abs(nodePos(w, 0).x - 0.2) < 1e-9);
  w.rings[0].a = 2;
  assert.ok(Math.abs(nodePos(w, 0).y - 0.2) < 1e-9);
});
test('time: a seed lit in the past becomes a living bloom in the present', () => {
  const w = W({ eras: 2, nodes: [node('source', -0.3, 0, { mask: GOLD }), node('seed', 0, 0, { era: 1 }), node('bloom', 0, 0, { era: 2, seed: 1 }), node('receiver', 0.3, 0, { mask: GOLD, era: 2 })] });
  const s = st(w, [{ a: 2, b: 3, era: 2 }]);
  assert.equal(evaluate(w, s).exists[1][2], false, 'no bloom without the past');
  s.threads.push({ a: 0, b: 1, era: 1 });
  const ev = evaluate(w, s);
  assert.equal(ev.exists[1][2], true);
  assert.equal(ev.solved, true);
});
test('time: threads belong to the era they were woven in; past-only walls do not block the present', () => {
  const w = W({ eras: 2, nodes: [node('source', -0.2, 0, { mask: CYAN }), node('receiver', 0.2, 0, { mask: CYAN })], walls: [{ x1: 0, y1: -0.1, x2: 0, y2: 0.1, era: 1 }] });
  assert.equal(canWeave(w, st(w), 0, 1, 1), 'wall');
  assert.equal(canWeave(w, st(w), 0, 1, 2), '');
  assert.equal(evaluate(w, st(w, [{ a: 0, b: 1, era: 1 }])).solved, false, 'a past thread does not light a present receiver');
});
test('echo recorder: replays the motion, then holds the final pose, then loops', () => {
  const e = new EchoTrack();
  e.start(10);
  e.add(10, 0, 0, false);
  e.add(10.5, 0.1, 0, false);
  e.add(11, 0.2, 0, true);
  e.stop();
  const o = { t: 0, x: 0, y: 0, down: false };
  assert.equal(e.sample(0.25, o).down, false);
  assert.ok(Math.abs(e.sample(0.25, o).x - 0.05) < 1e-6);
  assert.equal(e.sample(1 + ECHO_SUSTAIN * 0.5, o).down, true, 'final pose sustained');
  assert.equal(e.sample(e.loop + 0.1, o).down, false, 'loop restarts');
});

console.log('the journey: 5 worlds, 15 puzzles, every one solver-verified');
const PZ = makePuzzles();
test('five distinct worlds, each with puzzles; all five mechanics appear', () => {
  assert.equal(WORLDS.length, 5);
  for (let w = 0; w < 5; w++) assert.ok(PZ.some((p) => p.world === w), 'world ' + w);
  const all = new Set(PZ.flatMap((p) => p.mech));
  for (const m of Object.keys(MECH_NAME)) assert.ok(all.has(m as never), 'mechanic ' + m);
  assert.ok(PZ.length >= 5);
});
test('progression teaches one mechanic at a time before combining', () => {
  const seen = new Set<string>();
  for (const p of PZ) {
    if (p.mech.length > 1) for (const m of p.mech.slice(1)) assert.ok(seen.has(m) || p.mech.length === 5 || m === 'A', p.id + ' combines ' + m + ' before it was taught');
    p.mech.forEach((m) => seen.add(m));
  }
  assert.equal(PZ[PZ.length - 1].mech.length, 5, 'the finale combines all five mechanics');
});
PZ.forEach((p, i) => {
  test('puzzle ' + (i + 1) + ' "' + p.name + '" [' + p.mech.join('+') + '] starts unsolved and has a solution', () => {
    const f = makePuzzles()[i];
    if (f.light) {
      const sols = solve(f.light, 2);
      assert.ok(sols.length > 0, 'light half has no solution');
      if (!f.weave) assert.equal(trace(f.light, false).solved, false, 'already solved');
    }
    if (f.weave) {
      const s = freshState(f.weave);
      s.lightOn = [true];
      assert.equal(evaluate(f.weave, s).solved, false, 'already solved');
      const sol = solveWeave(f.weave);
      assert.ok(sol, 'thread half has no solution');
    }
  });
});
const byId = (id: string) => makePuzzles().find((p) => p.id === id) as ReturnType<typeof makePuzzles>[number];
test('"Roots of light": the threads stay dark until the light gate wakes', () => {
  assert.equal(solveWeave(byId('root-light').weave as Weave, { lightOn: false }), null);
});
test('"Star bridge": only solvable after the orbit engine turns the ring', () => {
  const sol = solveWeave(byId('star-bridge').weave as Weave);
  assert.ok(sol && sol.rings[0] !== 0);
  const w = byId('star-bridge').weave as Weave;
  w.rings[0].motor = -1;
  w.nodes[1].x = 9; // an engine that can never be reached: ring locked at its start
  w.rings[0].motor = 1;
  assert.equal(solveWeave(w), null);
});
test('"The orrery": exactly one ring setting forms the constellation', () => {
  const w = byId('orrery').weave as Weave;
  let n = 0;
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let c = 0; c < 8; c++) {
    w.rings[0].a = a; w.rings[1].a = b; w.rings[2].a = c;
    const s = freshState(w);
    if (evaluate(w, s).solved) n++;
  }
  assert.equal(n, 1);
});
test('"Two eras": impossible in the present alone; the solution weaves a past thread', () => {
  const sol = solveWeave(byId('two-eras').weave as Weave);
  assert.ok(sol && sol.threads.some((t) => t.era === 1));
  const w = byId('two-eras').weave as Weave;
  w.eras = 1;
  assert.equal(solveWeave(w), null);
});
test('"Memory echo": impossible with one hand alone, solvable with one echo', () => {
  assert.equal(solveWeave(byId('memory-echo').weave as Weave, { echoSlots: 0 }), null);
  const sol = solveWeave(byId('memory-echo').weave as Weave);
  assert.ok(sol && sol.echoes === 1);
});
test('"Heart of eternity" needs light, the past, a star alignment and an echo', () => {
  const h = byId('heart');
  assert.equal(h.mech.length, 5);
  assert.equal(solveWeave(h.weave as Weave, { lightOn: false }), null, 'needs light');
  assert.equal(solveWeave(byId('heart').weave as Weave, { echoSlots: 0 }), null, 'needs an echo');
  const sol = solveWeave(byId('heart').weave as Weave);
  assert.ok(sol, 'solvable');
  assert.ok(sol && sol.threads.some((t) => t.era === 1), 'needs the past');
  assert.equal(sol && sol.rings[0], 2, 'star aligned');
  assert.ok(solve(h.light as Level, 1).length > 0, 'light half solvable');
});

console.log('thread play: the interaction layer (grab, pull, connect, cut, rings, eras, echoes, hints)');
const WV = (id: string): Weave => makePuzzles().find((q) => q.id === id)!.weave as Weave;
test('grab a crystal, pull and release on another: a thread is woven and the receiver wakes', () => {
  const pl = new ThreadPlay(WV('first-thread'));
  assert.equal(pl.down(1, -0.26, -0.02), true);
  pl.move(1, 0.1, 0.0);
  assert.equal(pl.threadDrags().length, 1);
  pl.up(1, 0.26, 0.04);
  assert.equal(pl.s.threads.length, 1);
  assert.equal(pl.ev.solved, true);
  assert.ok(pl.events.some((e) => e.t === 'grab') && pl.events.some((e) => e.t === 'connect') && pl.events.some((e) => e.t === 'receiver'));
});
test('releasing in empty space or too far away is refused with a reason; nothing is woven', () => {
  const pl = new ThreadPlay(WV('splitter'));
  pl.down(1, -0.45, 0);
  pl.move(1, 0, 0.3);
  pl.up(1, 0, 0.3);
  assert.ok(pl.events.some((e) => e.t === 'refuse' && e.reason === 'no-node'));
  pl.events.length = 0;
  assert.equal(pl.tryConnect(0, 3), false);
  assert.ok(pl.events.some((e) => e.t === 'refuse' && (e.reason === 'too-long' || e.reason === 'wall')));
  assert.equal(pl.s.threads.length, 0);
});
test('tapping a woven thread cuts it; reset restores the untouched puzzle', () => {
  const pl = new ThreadPlay(WV('first-thread'));
  pl.tryConnect(0, 1);
  pl.down(2, 0, 0.01);
  pl.tick(0.1);
  pl.up(2, 0, 0.01);
  assert.equal(pl.s.threads.length, 0);
  assert.equal(pl.ev.solved, false);
  pl.tryConnect(0, 1);
  pl.reset();
  assert.equal(pl.s.threads.length, 0);
  assert.equal(pl.moves, 0);
});
test('a motor ring refuses to turn until its orbit engine is powered', () => {
  const pl = new ThreadPlay(WV('star-bridge'));
  pl.setRing(0, 2);
  assert.equal(pl.w.rings[0].a, 0);
  assert.ok(pl.events.some((e) => e.t === 'ringLocked'));
  assert.equal(pl.tryConnect(0, 1), true);
  pl.setRing(0, 2);
  assert.equal(pl.w.rings[0].a, 2);
});
test('dragging around a ring turns it step by step', () => {
  const pl = new ThreadPlay(WV('orrery'));
  assert.equal(pl.down(1, 0.27, 0), false === false && true);
  pl.move(1, 0, 0.27);
  pl.up(1, 0, 0.27);
  assert.notEqual(pl.w.rings[2].a + pl.w.rings[1].a + pl.w.rings[0].a, 0);
});
test('a recorded echo keeps holding its keystone after the hand lets go', () => {
  const pl = new ThreadPlay(WV('memory-echo'));
  assert.equal(pl.tryConnect(4, 5), true);
  assert.equal(echoReady(pl.w, pl.s), true);
  pl.toggleRecord(1);
  assert.equal(pl.recording, true);
  pl.trackPointer(1, -0.18, 0.16, true);
  pl.down(1, -0.18, 0.16);
  for (let i = 0; i < 8; i++) pl.tick(0.1);
  pl.trackPointer(1, -0.18, 0.16, false);
  pl.up(1, -0.18, 0.16);
  assert.equal(pl.recording, false);
  assert.equal(pl.echoes.length, 1);
  for (let i = 0; i < 60; i++) {
    pl.tick(0.1);
    assert.ok(pl.s.held.includes(1), 'echo holds key at t=' + i);
  }
  assert.equal(pl.ev.solved, false);
  pl.down(2, 0.12, 0.16);
  pl.tick(0.1);
  assert.equal(pl.ev.solved, true);
});
for (const pz of makePuzzles().filter((q) => q.weave)) {
  test('following the hints alone solves "' + pz.name + '" (hints are never random)', () => {
    const pl = new ThreadPlay(pz.weave as Weave);
    pl.s.lightOn = [true, true, true];
    pl.refresh();
    let n = 0;
    while (!pl.ev.solved && n < 40) {
      assert.ok(pl.autoStep(), 'stuck at step ' + n + ' with hint ' + JSON.stringify(pl.hint()));
      pl.tick(0.1);
      n++;
    }
    assert.equal(pl.ev.solved, true);
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
