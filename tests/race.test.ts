/**
 * GEAR SHIFT: NEON OVERDRIVE automated tests: the pure racing simulation (racelogic.ts) and
 * the save/settings layer (gssave.ts). Rendering, audio, VR and input devices are NOT covered here
 * (see tests/gearshift-e2e.mjs for the browser run). Run: npm run test:race
 */
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS, CARS, DIFFS, MODES, TRACKS, RaceSim, STEP, applyRecords, coachLive, coachReport, dailyFor, findCar, findDiff, findMode, findTrack,
  ghostDistanceAt, ghostGap, gradeOf, idealShiftRpm, medalOf, newAchievements, resultOf, rpmFromSpeed, tierOf, torqueFrac, zoneAt,
} from '../src/racelogic';
import type { GhostData, RaceEvent, RaceSetup, Records } from '../src/racelogic';
import { actionFor, defaultSave, loadSave, rebind, sanitize, writeSave, SAVE_KEY } from '../src/gssave';

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
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage;

const setup = (o: Partial<RaceSetup> = {}): RaceSetup => ({ car: CARS[0], diff: findDiff('expert'), track: TRACKS[0], mode: MODES[0], introTime: 0.05, ...o });
/** run until the race starts (intro + countdown) */
function toGreen(sim: RaceSim): RaceEvent[] {
  const all: RaceEvent[] = [];
  let g = 0;
  while (sim.phase !== 'race' && g++ < 2000) all.push(...sim.step(1 / 60).map((e) => ({ ...e })));
  return all;
}
/** a driver that shifts when rpm reaches `at(sim)` */
function drive(sim: RaceSim, at: (s: RaceSim) => number, seconds: number, dt = 1 / 60): RaceEvent[] {
  const all: RaceEvent[] = [];
  const end = sim.raceT + seconds;
  let g = 0;
  while (sim.raceT < end && (sim.phase === 'race' || sim.phase === 'countdown' || sim.phase === 'intro') && g++ < 100000) {
    if (sim.running && !sim.braking && sim.gear < sim.gears - 1 && sim.rpm >= at(sim) && sim.shiftT <= 0) sim.shiftUp();
    all.push(...sim.step(dt).map((e) => ({ ...e })));
  }
  return all;
}
const perfectAt = (s: RaceSim): number => s.window().center;

// ---------------------------------------------------------------- engine model
test('torque curve rises to a peak then falls (shape drives the shift point)', () => {
  assert.ok(torqueFrac(0.2) < torqueFrac(0.5));
  assert.ok(torqueFrac(0.5) < torqueFrac(0.65));
  assert.ok(torqueFrac(0.85) > torqueFrac(1.0));
  assert.equal(torqueFrac(0.65), 1);
});
test('ideal shift rpm is inside the playable band and differs per gear', () => {
  for (const car of CARS) {
    const ideals = car.ratios.slice(0, -1).map((_, g) => idealShiftRpm(car, g));
    for (const r of ideals) assert.ok(r >= car.redline * 0.8 && r <= car.redline * 0.965, car.id + ' ' + r);
    assert.ok(new Set(ideals.map(Math.round)).size > 1, car.id + ' ideal shift point should vary by gear');
  }
});
test('rpm and speed are linked through the gear ratio (no fake speedometer)', () => {
  const car = CARS[0];
  const r1 = rpmFromSpeed(car, 0, 20);
  const r2 = rpmFromSpeed(car, 1, 20);
  assert.ok(r1 > r2, 'lower gear revs higher at the same speed');
  assert.ok(Math.abs(r1 / r2 - car.ratios[0] / car.ratios[1]) < 1e-9);
});

// ---------------------------------------------------------------- phases + determinism
test('intro -> countdown 3,2,1 -> GO', () => {
  const sim = new RaceSim(setup());
  const ev = toGreen(sim);
  const counts = ev.filter((e) => e.type === 'count').map((e) => (e as { n: number }).n);
  assert.deepEqual(counts, [3, 2, 1]);
  assert.ok(ev.some((e) => e.type === 'go'));
  assert.equal(sim.phase, 'race');
  assert.equal(sim.gear, 0);
});
test('inputs before GO are ignored', () => {
  const sim = new RaceSim(setup());
  sim.shiftUp();
  sim.boost();
  toGreen(sim);
  sim.step(0.1);
  assert.equal(sim.gear, 0);
  assert.equal(sim.upshifts, 0);
});
test('deterministic: identical input sequences give identical races', () => {
  const run = (): string => {
    const sim = new RaceSim(setup());
    toGreen(sim);
    drive(sim, (s) => s.window().center - 150, 25);
    return JSON.stringify([sim.distance, sim.score, sim.log, sim.temp, sim.stress]);
  };
  assert.equal(run(), run());
});
test('frame-rate independent: 30/60/90 fps give the same physics (fixed 1/120 s steps)', () => {
  const dist = (dt: number): number => {
    const sim = new RaceSim(setup());
    toGreen(sim);
    let t = 0;
    while (t < 3) {
      sim.step(dt);
      t += dt;
    }
    return sim.distance;
  };
  const a = dist(1 / 30);
  const b = dist(1 / 60);
  const c = dist(1 / 90);
  assert.ok(Math.abs(a - b) < 0.6 && Math.abs(b - c) < 0.6, [a, b, c].join(' '));
  assert.ok(STEP === 1 / 120);
});

// ---------------------------------------------------------------- timing classification
test('five timing classes by distance from the ideal rpm', () => {
  const sim = new RaceSim(setup({ diff: findDiff('elite') }));
  toGreen(sim);
  const w = sim.window();
  assert.equal(sim.classify(w.center).cls, 'perfect');
  assert.equal(sim.classify(w.center + w.perfect * 1.5).cls, 'excellent');
  assert.equal(sim.classify(w.center - w.excellent * 1.2).cls, 'good');
  assert.equal(sim.classify(w.center - w.good * 1.5).cls, 'early');
  assert.equal(sim.classify(Math.min(w.center + w.good * 1.2, sim.car.limiter - 60)).cls, 'late');
  assert.equal(sim.classify(sim.car.limiter).cls, 'overload');
});
test('timing window narrows with difficulty, gear and heat; shifts earlier when hot', () => {
  const easy = new RaceSim(setup({ diff: findDiff('beginner') }));
  const hard = new RaceSim(setup({ diff: findDiff('elite') }));
  assert.ok(easy.window().perfect > hard.window().perfect * 2.5);
  const sim = new RaceSim(setup());
  const w0 = { ...sim.window() };
  sim.gear = 3;
  const w3 = { ...sim.window() };
  assert.ok(w3.perfect < w0.perfect, 'higher gear tighter');
  sim.gear = 0;
  sim.temp = 1.1;
  const hot = { ...sim.window() };
  assert.ok(hot.perfect < w0.perfect, 'hot engine tighter');
  assert.ok(hot.center < w0.center, 'hot engine wants an earlier shift');
  sim.temp = 0.35;
  sim.v = sim.topSpeed * 0.9;
  assert.ok(sim.window().perfect < w0.perfect, 'faster = tighter');
});
test('rain narrows the window (race conditions)', () => {
  const dry = new RaceSim(setup());
  const wet = new RaceSim(setup({ rainMod: true }));
  assert.ok(wet.window().perfect < dry.window().perfect);
});

// ---------------------------------------------------------------- consequences
test('PERFECT shift: combo up, turbo energy, mini boost, points, shift event', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  let ev: RaceEvent[] = [];
  let g = 0;
  while (sim.rpm < sim.window().center && g++ < 2000) sim.step(STEP);
  sim.shiftUp();
  ev = sim.step(STEP).map((e) => ({ ...e }));
  const sh = ev.find((e) => e.type === 'shift') as Extract<RaceEvent, { type: 'shift' }>;
  assert.ok(sh, 'shift event');
  assert.equal(sh.cls, 'perfect');
  assert.equal(sim.gear, 1);
  assert.equal(sim.combo, 1);
  assert.equal(sim.turboE, 22);
  assert.ok(sim.miniBoostT > 0.5);
  assert.ok(sh.points >= 1000);
  assert.ok(ev.some((e) => e.type === 'boost' && !e.manual), 'perfect fires the turbo kick');
});
test('EARLY shift: combo reset, power loss', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  sim.combo = 4;
  let g = 0;
  while (sim.rpm < sim.window().center - sim.window().good * 2 && g++ < 2000) sim.step(STEP);
  sim.shiftUp();
  const ev = sim.step(STEP);
  assert.equal((ev.find((e) => e.type === 'shift') as { cls: string }).cls, 'early');
  assert.equal(sim.combo, 0);
  assert.ok(sim.lagT > 0.3);
});
test('LATE + OVERLOAD shifts add engine stress; overload backfires', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  let g = 0;
  while (sim.rpm < sim.car.limiter - 1 && g++ < 4000) sim.step(STEP);
  sim.step(0.5); // sit on the limiter
  const before = sim.stress;
  assert.ok(before > 5, 'limiter builds stress: ' + before);
  sim.shiftUp();
  const ev = sim.step(STEP);
  assert.equal((ev.find((e) => e.type === 'shift') as { cls: string }).cls, 'overload');
  assert.ok(ev.some((e) => e.type === 'backfire'));
  assert.ok(sim.stress > before);
});
test('shift timing changes the race: perfect driver beats early and late drivers', () => {
  const run = (at: (s: RaceSim) => number): number => {
    const sim = new RaceSim(setup());
    toGreen(sim);
    drive(sim, at, 20);
    return sim.distance;
  };
  const perfect = run(perfectAt);
  const early = run((s) => s.window().center - 1800);
  const late = run((s) => s.car.limiter); // waits for the limiter
  assert.ok(perfect > early + 5, 'perfect ' + perfect + ' vs early ' + early);
  assert.ok(perfect > late + 5, 'perfect ' + perfect + ' vs late ' + late);
});
test('missed shift (sitting on the limiter) warns and blows the engine on EXPERT', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  const ev = drive(sim, () => 1e9, 30);
  assert.ok(ev.some((e) => e.type === 'warn' && e.what === 'limiter'));
  assert.ok(ev.some((e) => e.type === 'warn' && e.what === 'stress'));
  assert.ok(ev.some((e) => e.type === 'blown'));
  assert.equal(sim.phase, 'over');
  assert.equal(gradeOf(sim), 'DNF');
});
test('BEGINNER is forgiving: limp mode instead of game over', () => {
  const sim = new RaceSim(setup({ diff: findDiff('beginner') }));
  toGreen(sim);
  const ev = drive(sim, () => 1e9, 40);
  assert.ok(ev.some((e) => e.type === 'limp'));
  assert.notEqual(sim.phase, 'over');
});
test('max rpm, speed and distance records track the run', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  drive(sim, perfectAt, 15);
  assert.ok(sim.maxRpm >= sim.window().center * 0.9);
  assert.ok(sim.maxSpeed * 3.6 > 150);
  assert.ok(sim.distance > 300);
});
test('speed milestones fire once each', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  const ev = drive(sim, perfectAt, 20);
  const ms = ev.filter((e) => e.type === 'milestone').map((e) => (e as { kmh: number }).kmh);
  assert.ok(ms.includes(100) && ms.includes(150));
  assert.equal(new Set(ms).size, ms.length);
});

// ---------------------------------------------------------------- turbo + combo
test('manual turbo needs 40% energy and adds acceleration', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  sim.step(0.5);
  sim.boost();
  sim.step(STEP);
  assert.equal(sim.boosting, false, 'no energy, no boost');
  sim.turboE = 100;
  sim.boost();
  const ev = sim.step(STEP);
  assert.ok(ev.some((e) => e.type === 'boost' && e.on && e.manual));
  assert.ok(sim.boosting);
  assert.equal(sim.turboE, 0);
  // compare acceleration with a twin without boost
  const twin = new RaceSim(setup());
  toGreen(twin);
  twin.step(0.5 + STEP * 2);
  sim.step(0.2);
  twin.step(0.2);
  assert.ok(sim.v > twin.v, 'boosted ' + sim.v + ' vs ' + twin.v);
});
test('combo multiplier grows with consecutive perfect/excellent shifts and caps at x4', () => {
  const sim = new RaceSim(setup());
  sim.combo = 3;
  assert.ok(Math.abs(sim.multiplier - 1.6) < 1e-9);
  sim.combo = 40;
  assert.equal(sim.multiplier, 4);
});
test('perfect bot keeps a combo through a whole quick race and finishes with S+', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  const ev = drive(sim, perfectAt, 200);
  assert.equal(sim.phase, 'finished');
  assert.ok(ev.some((e) => e.type === 'finish'));
  assert.ok(sim.bestCombo >= 10, 'combo ' + sim.bestCombo);
  assert.equal(sim.counts.perfect, sim.log.length);
  assert.equal(gradeOf(sim), 'S+');
  assert.ok(sim.distance >= 3000);
});

// ---------------------------------------------------------------- track
test('braking zones slow the car toward corner speed and auto-downshift', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  const ev = drive(sim, perfectAt, 40);
  assert.ok(ev.some((e) => e.type === 'brake' && e.on));
  assert.ok(ev.some((e) => e.type === 'downshift'));
  assert.ok(sim.log.length > sim.gears, 'braking zones create more shift chances: ' + sim.log.length);
});
test('track zones follow the pattern and fire zone events', () => {
  const t = findTrack('city');
  assert.equal(zoneAt(t, 10), 'city');
  assert.equal(zoneAt(t, 950), 'tunnel');
  assert.equal(zoneAt(t, 2000), 'highway');
  assert.equal(zoneAt(t, 2500 + 10), 'city');
  const sim = new RaceSim(setup());
  toGreen(sim);
  const ev = drive(sim, perfectAt, 60);
  assert.ok(ev.some((e) => e.type === 'zone' && e.kind === 'tunnel'));
});

// ---------------------------------------------------------------- modes
test('Perfect Shift Challenge ends after 20 upshifts', () => {
  const sim = new RaceSim(setup({ mode: findMode('perfect') }));
  toGreen(sim);
  drive(sim, perfectAt, 300);
  assert.equal(sim.phase, 'finished');
  assert.equal(sim.upshifts, 20);
});
test('Turbo Rush ends on its timer and charges turbo twice as fast', () => {
  const sim = new RaceSim(setup({ mode: findMode('turborush') }));
  toGreen(sim);
  let g = 0;
  while (sim.rpm < sim.window().center && g++ < 2000) sim.step(STEP);
  sim.shiftUp();
  sim.step(STEP);
  assert.equal(sim.turboE, 44);
  drive(sim, perfectAt, 100);
  assert.equal(sim.phase, 'finished');
  assert.ok(Math.abs(sim.raceT - 75) < 0.05);
});
test('Time Attack: perfect driving earns a medal', () => {
  const sim = new RaceSim(setup({ mode: findMode('timeattack') }));
  toGreen(sim);
  drive(sim, perfectAt, 200);
  assert.equal(sim.phase, 'finished');
  assert.notEqual(medalOf(sim.mode, sim.raceT), '', 'time ' + sim.raceT);
  assert.equal(medalOf(sim.mode, 999), '');
});
test('Endurance heats a heavy car much more than a quick race', () => {
  const hot = new RaceSim(setup({ mode: findMode('endurance'), car: findCar('titan') }));
  const cool = new RaceSim(setup({ mode: findMode('quick'), car: findCar('vx1') }));
  toGreen(hot);
  toGreen(cool);
  drive(hot, perfectAt, 60);
  drive(cool, perfectAt, 60);
  assert.ok(hot.temp > cool.temp + 0.2, hot.temp + ' vs ' + cool.temp);
});
test('VR Cockpit Challenge: lever shifts are counted and score x1.25', () => {
  const a = new RaceSim(setup({ mode: findMode('vrcockpit') }));
  const b = new RaceSim(setup({ mode: findMode('vrcockpit') }));
  for (const s of [a, b]) {
    toGreen(s);
    let g = 0;
    while (s.rpm < s.window().center && g++ < 2000) s.step(STEP);
  }
  a.shiftUp(true);
  b.shiftUp(false);
  a.step(STEP);
  b.step(STEP);
  assert.equal(a.leverShifts, 1);
  assert.equal(b.leverShifts, 0);
  assert.equal(a.log[0].points, Math.round(b.log[0].points * 1.25));
});
test('every car / track / difficulty / mode combination runs without NaN', () => {
  for (const car of CARS)
    for (const track of TRACKS)
      for (const diff of [DIFFS[0], DIFFS[4]])
        for (const mode of MODES) {
          const sim = new RaceSim({ car, track, diff, mode, introTime: 0.05 });
          toGreen(sim);
          drive(sim, perfectAt, 6, 1 / 45);
          assert.ok(isFinite(sim.distance) && isFinite(sim.rpm) && isFinite(sim.score) && isFinite(sim.temp), [car.id, track.id, diff.id, mode.id].join('/'));
        }
});

// ---------------------------------------------------------------- ghost, coach, records, progression
test('ghost interpolation and time gap', () => {
  const g: GhostData = { v: 1, key: 'k', time: 10, score: 0, samples: [1, 2, 4, 8] };
  assert.equal(ghostDistanceAt(g, 0.1), 1);
  assert.equal(ghostDistanceAt(g, 0.25), 3);
  assert.equal(ghostDistanceAt(g, 99), 8);
  assert.equal(ghostDistanceAt(null, 3), 0);
  assert.ok(ghostGap(g, 0.3, 2, 10) > 0, 'behind the ghost = positive gap');
  assert.ok(ghostGap(g, 0.3, 6, 10) < 0);
});
test('a finished race records ghost samples every 0.1 s and can beat its own ghost', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  drive(sim, (s) => s.window().center - 400, 200);
  const ghost: GhostData = { v: 1, key: 'quick@city', time: sim.raceT, score: sim.score, samples: sim.ghostSamples.slice() };
  assert.ok(Math.abs(sim.ghostSamples.length - sim.raceT * 10) <= 2);
  const sim2 = new RaceSim(setup());
  toGreen(sim2);
  drive(sim2, perfectAt, 200);
  assert.ok(resultOf(sim2, ghost, false, '2026-11-18').ghostBeaten);
  assert.equal(resultOf(sim, { ...ghost, time: 1 }, false, '2026-11-18').ghostBeaten, false);
});
test('coach names early / late / limiter habits', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  drive(sim, (s) => s.window().center - s.window().good * 1.6, 40);
  const tips = coachReport(sim.log, sim.gears);
  assert.ok(tips.length >= 1 && tips.length <= 3);
  assert.ok(/early/i.test(tips.join(' ')), tips.join(' | '));
  assert.ok(/later/.test(coachLive(sim.log)));
  const sim2 = new RaceSim(setup({ diff: findDiff('beginner') }));
  toGreen(sim2);
  drive(sim2, (s) => s.car.limiter, 20);
  assert.ok(sim2.log.length > 2);
  assert.ok(/limiter/.test(coachReport(sim2.log, sim2.gears).join(' ')));
  assert.equal(coachReport([], 6).length, 1);
});
test('records: personal bests and a sorted local top-10 board', () => {
  const rec: Records = { best: {}, board: {} };
  const sim = new RaceSim(setup());
  toGreen(sim);
  drive(sim, perfectAt, 200);
  const r = resultOf(sim, null, false, '2026-11-18');
  const pb = applyRecords(rec, r);
  assert.ok(pb.score && pb.time && pb.combo && pb.kmh);
  assert.equal(pb.rank, 0);
  const worse = { ...r, score: r.score - 1000, time: r.time + 5 };
  const pb2 = applyRecords(rec, worse);
  assert.ok(!pb2.score && !pb2.time);
  assert.equal(pb2.rank, 1);
  for (let i = 0; i < 15; i++) applyRecords(rec, { ...r, score: i });
  assert.equal(rec.board['quick@city'].length, 10);
  assert.equal(rec.board['quick@city'][0].score, r.score);
});
test('achievements unlock once from race results', () => {
  const sim = new RaceSim(setup());
  toGreen(sim);
  drive(sim, perfectAt, 200);
  const r = resultOf(sim, null, false, '2026-11-18');
  const got = newAchievements([], r, sim).map((a) => a.id);
  assert.ok(got.includes('first-perfect') && got.includes('combo10') && got.includes('gradeS') && got.includes('flawless'), got.join(','));
  assert.equal(newAchievements(got, r, sim).length, 0);
  assert.ok(ACHIEVEMENTS.length >= 12);
});
test('career tiers Beginner..Elite', () => {
  assert.equal(tierOf(0), 0);
  assert.equal(tierOf(350), 1);
  assert.equal(tierOf(1e6), 4);
});
test('daily challenge is deterministic per date and valid', () => {
  const a = dailyFor('2026-11-18');
  assert.deepEqual(a, dailyFor('2026-11-18'));
  const days = new Set<string>();
  for (let d = 1; d <= 28; d++) {
    const x = dailyFor('2026-11-' + String(d).padStart(2, '0'));
    assert.ok(CARS.some((c) => c.id === x.car) && TRACKS.some((t) => t.id === x.track) && MODES.some((m) => m.id === x.mode) && DIFFS.some((q) => q.id === x.diff));
    days.add(JSON.stringify([x.mode, x.track, x.car, x.diff, x.modifier.name]));
  }
  assert.ok(days.size > 5, 'dailies vary: ' + days.size);
});

// ---------------------------------------------------------------- save layer
test('save: defaults, round trip and clamping of untrusted data', () => {
  store.clear();
  const s = loadSave();
  assert.equal(s.settings.car, 'vx1');
  s.xp = 123;
  s.settings.vol.music = 0.25;
  s.achievements.push('combo5');
  assert.ok(writeSave(s));
  const t = loadSave();
  assert.equal(t.xp, 123);
  assert.equal(t.settings.vol.music, 0.25);
  assert.deepEqual(t.achievements, ['combo5']);
  store.set(SAVE_KEY, '{not json');
  assert.equal(loadSave().xp, 0);
  const bad = sanitize({ settings: { vol: { master: 9 }, camera: 'drone', leverSens: -4, keys: { up: [5] } }, xp: -3 });
  assert.equal(bad.settings.vol.master, 1);
  assert.equal(bad.settings.camera, 'chase');
  assert.equal(bad.settings.leverSens, 0.5);
  assert.deepEqual(bad.settings.keys.up, defaultSave().settings.keys.up);
  assert.equal(bad.xp, 0);
});
test('keyboard remap moves a key between actions without duplicates', () => {
  const k = defaultSave().settings.keys;
  const r = rebind(k, 'turbo', 'Space');
  assert.equal(actionFor(r, 'Space'), 'turbo');
  assert.ok(!r.up.includes('Space'));
  assert.equal(actionFor(r, 'ArrowUp'), 'up');
});
test('missing storage never throws', () => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
  assert.equal(loadSave().xp, 0);
  assert.equal(writeSave(defaultSave()), false);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
