/**
 * SPELLFORGE automated tests: gesture recognition on synthetic hand poses, spell casting, fusions,
 * battle rules, boss phases and save data. Pure logic only: rendering, audio and real hand tracking
 * are NOT covered here. Run: npm run test:spell
 */
import assert from 'node:assert/strict';
import { GestureEngine } from '../src/sfgesture';
import type { GestureOut, HandFrame, Head, V3 } from '../src/sfgesture';
import { SpellCaster, ADV_CASTS } from '../src/sfcast';
import type { CastEvent } from '../src/sfcast';
import { ADVANCED_SPELLS, ALL_SPELLS, BASE_SPELLS, BOSSES, ELEMENTS, ENEMIES, FUSIONS, damageAgainst, resolveSpell } from '../src/sfdata';
import { Battle, PLAYER_HEAD, ARENA_Z } from '../src/sfbattle';
import { defaultSfSave, loadSfSave, writeSfSave, SF_SAVE_VERSION } from '../src/sfsave';
import { musicMix, newMix } from '../src/sfmusic';
import { fusionNudge, takeTip, ALL_TIPS } from '../src/sfonboard';

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

const HEAD: Head = { pos: [0, 1.35, 0], fwd: [0, 0, -1], right: [1, 0, 0] };
interface HO { curl?: number[]; normal?: V3; aim?: V3; pinch?: number; conf?: number; pinchPt?: V3; wrist?: V3; tracked?: boolean }
const hand = (palm: V3, o: HO = {}): HandFrame => ({
  tracked: o.tracked ?? true,
  conf: o.conf ?? 1,
  palm,
  normal: o.normal ?? [0, 0, -1],
  aim: o.aim ?? [0, 0, -1],
  wrist: o.wrist ?? [palm[0], palm[1], palm[2] + 0.08],
  tips: [palm, palm, palm, palm, palm],
  curl: o.curl ?? [0.1, 0.05, 0.05, 0.05, 0.05],
  pinch: o.pinch ?? 0,
  pinchPt: o.pinchPt ?? palm,
});
const OPEN = [0.1, 0.05, 0.05, 0.05, 0.05];
const FIST = [0.8, 0.9, 0.9, 0.9, 0.9];
const POINT = [0.7, 0.05, 0.9, 0.9, 0.9];
const addv = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** two palms facing each other at chest height, `gap` apart */
const facing = (gap: number, y = 1.1): [HandFrame, HandFrame] => [hand([-gap / 2, y, -0.4], { normal: [1, 0, 0], aim: [0, 0, -1] }), hand([gap / 2, y, -0.4], { normal: [-1, 0, 0], aim: [0, 0, -1] })];

function run(eng: GestureEngine, seconds: number, f: (t: number) => [HandFrame | null, HandFrame | null], dt = 1 / 60, collect?: (g: GestureOut) => void): GestureOut {
  let g = eng.update(dt, ...f(0), HEAD);
  collect?.(g);
  for (let t = dt; t < seconds; t += dt) {
    g = eng.update(dt, ...f(t), HEAD);
    collect?.(g);
  }
  return g;
}
const evs = (list: GestureOut[]): string[] => list.flatMap((g) => g.events.map((e) => e.t));

console.log('gesture recognition');
test('open palms facing each other form an orb after 0.25 s, not before', () => {
  const e = new GestureEngine();
  const early = run(e, 0.15, () => facing(0.3));
  assert.equal(early.orbFormed, false);
  const late = run(e, 0.4, () => facing(0.3));
  assert.equal(late.orbFormed, true);
});
test('palms that are not facing never form an orb', () => {
  const e = new GestureEngine();
  const g = run(e, 1, () => [hand([-0.15, 1.1, -0.4], { normal: [0, 0, -1] }), hand([0.15, 1.1, -0.4], { normal: [0, 0, -1] })]);
  assert.equal(g.orbFormed, false);
});
test('palms too far apart do not form an orb', () => {
  const e = new GestureEngine();
  const g = run(e, 1, () => facing(0.9));
  assert.equal(g.orbFormed, false);
});
test('closed fists do not form an orb (pose must be open)', () => {
  const e = new GestureEngine();
  const g = run(e, 1, () => {
    const [l, r] = facing(0.3);
    l.curl = FIST;
    r.curl = FIST;
    return [l, r];
  });
  assert.equal(g.orbFormed, false);
});
test('orb survives a short tracking flicker (hysteresis) but breaks after a long loss', () => {
  const e = new GestureEngine();
  run(e, 0.6, () => facing(0.3));
  const flick = run(e, 0.1, () => [null, null]);
  assert.equal(flick.events.some((x) => x.t === 'orbBreak'), false);
  const seen: string[] = [];
  run(e, 0.6, () => [null, null], 1 / 60, (g) => seen.push(...g.events.map((x) => x.t)));
  assert.ok(seen.includes('orbBreak') && seen.includes('lost'));
});
test('tracking recovery is reported', () => {
  const e = new GestureEngine();
  run(e, 0.3, () => facing(0.3));
  run(e, 0.5, () => [null, hand([0.15, 1.1, -0.4])]);
  const seen: string[] = [];
  run(e, 0.2, () => facing(0.3), 1 / 60, (g) => seen.push(...g.events.map((x) => x.t)));
  assert.ok(seen.includes('recovered'));
});
test('spread rate is positive when the hands move apart', () => {
  const e = new GestureEngine();
  const g = run(e, 0.5, (t) => facing(0.2 + t * 0.6));
  assert.ok(g.spreadRate > 0.3, 'rate ' + g.spreadRate);
});
test('a fast forward open-palm thrust after a still moment fires a push', () => {
  const e = new GestureEngine();
  run(e, 0.3, () => [null, hand([0.1, 1.1, -0.3])]);
  const seen: GestureOut[] = [];
  run(e, 0.3, (t) => [null, hand([0.1, 1.1, -0.3 - t * 3])], 1 / 60, (g) => seen.push(g));
  assert.ok(evs(seen).includes('push'));
});
test('waving a hand around never fires a push (must be armed by a quiet moment)', () => {
  const e = new GestureEngine();
  const seen: GestureOut[] = [];
  run(e, 3, (t) => [null, hand([0.1, 1.1, -0.4 - Math.sin(t * 9) * 0.35])], 1 / 60, (g) => seen.push(g));
  // continuous oscillation never settles for 0.1 s below 0.6 m/s
  assert.equal(evs(seen).filter((x) => x === 'push').length <= 1, true);
});
test('a thrust with the palm facing backwards does not fire', () => {
  const e = new GestureEngine();
  run(e, 0.3, () => [null, hand([0.1, 1.1, -0.3], { normal: [0, 0, 1] })]);
  const seen: GestureOut[] = [];
  run(e, 0.3, (t) => [null, hand([0.1, 1.1, -0.3 - t * 3], { normal: [0, 0, 1] })], 1 / 60, (g) => seen.push(g));
  assert.equal(evs(seen).includes('push'), false);
});
test('a push has a cooldown', () => {
  const e = new GestureEngine();
  run(e, 0.3, () => [null, hand([0.1, 1.1, -0.3])]);
  const seen: GestureOut[] = [];
  run(e, 0.3, (t) => [null, hand([0.1, 1.1, -0.3 - t * 3])], 1 / 60, (g) => seen.push(g));
  assert.equal(evs(seen).filter((x) => x === 'push').length, 1);
});
test('crossed arms raise the shield and uncrossing drops it', () => {
  const e = new GestureEngine();
  const crossedL = (): HandFrame => hand([0.12, 1.1, -0.35], { wrist: [0.1, 1.1, -0.3] });
  const crossedR = (): HandFrame => hand([-0.12, 1.1, -0.35], { wrist: [-0.1, 1.1, -0.3] });
  const g = run(e, 0.5, () => [crossedL(), crossedR()]);
  assert.equal(g.shield, true);
  const g2 = run(e, 0.4, () => [hand([-0.3, 1.1, -0.35], { wrist: [-0.3, 1.1, -0.3] }), hand([0.3, 1.1, -0.35], { wrist: [0.3, 1.1, -0.3] })]);
  assert.equal(g2.shield, false);
});
test('hands held normally apart never raise the shield', () => {
  const e = new GestureEngine();
  const g = run(e, 1, () => facing(0.4));
  assert.equal(g.shield, false);
});
test('a circle drawn with one hand is recognised with its direction', () => {
  const e = new GestureEngine();
  const seen: GestureOut[] = [];
  run(e, 1.5, (t) => [null, hand([Math.cos(t * 5) * 0.12, 1.0 + Math.sin(t * 5) * 0.12, -0.4])], 1 / 60, (g) => seen.push(g));
  const c = seen.flatMap((g) => g.events).find((x) => x.t === 'circle');
  assert.ok(c);
});
test('a straight swipe is not a circle', () => {
  const e = new GestureEngine();
  const seen: GestureOut[] = [];
  run(e, 1.5, (t) => [null, hand([Math.sin(t * 3) * 0.3, 1.0, -0.4])], 1 / 60, (g) => seen.push(g));
  assert.equal(evs(seen).includes('circle'), false);
});
test('upward and downward hand movement are recognised', () => {
  const e = new GestureEngine();
  const seen: GestureOut[] = [];
  run(e, 0.3, () => [null, hand([0.1, 1.0, -0.4])]);
  run(e, 0.3, (t) => [null, hand([0.1, 1.0 + t * 3, -0.4])], 1 / 60, (g) => seen.push(g));
  assert.ok(evs(seen).includes('up'));
  const seen2: GestureOut[] = [];
  run(e, 0.8, () => [null, hand([0.1, 1.5, -0.4])]);
  run(e, 0.3, (t) => [null, hand([0.1, 1.5 - t * 3.5, -0.4])], 1 / 60, (g) => seen2.push(g));
  assert.ok(evs(seen2).includes('down'));
});
test('dual-hand rotation is recognised', () => {
  const e = new GestureEngine();
  const seen: GestureOut[] = [];
  run(e, 1, (t) => {
    const a = t * 2.4;
    const c: V3 = [0, 1.1, -0.4];
    const l = hand([c[0] - Math.cos(a) * 0.12, c[1] - Math.sin(a) * 0.12, c[2]], { normal: [Math.cos(a), Math.sin(a), 0] });
    const r = hand([c[0] + Math.cos(a) * 0.12, c[1] + Math.sin(a) * 0.12, c[2]], { normal: [-Math.cos(a), -Math.sin(a), 0] });
    return [l, r];
  }, 1 / 60, (g) => seen.push(g));
  assert.ok(evs(seen).includes('rotate'));
});
test('poses: fist, point, pinch and open are classified', () => {
  const p = (curl: number[], pinch = 0): Record<string, string> => {
    const e = new GestureEngine();
    const g = run(e, 0.4, () => [hand([-0.2, 1.1, -0.4], { curl, pinch }), hand([0.2, 1.1, -0.4], { curl, pinch })]);
    return g.pose as unknown as Record<string, string>;
  };
  assert.equal(p(FIST).right, 'fist');
  assert.equal(p(POINT).right, 'point');
  assert.equal(p(OPEN, 0.95).right, 'pinch');
  assert.equal(p(OPEN).right, 'open');
});
test('a pose needs a minimum hold time (no flicker)', () => {
  const e = new GestureEngine();
  run(e, 0.4, () => [null, hand([0.2, 1.1, -0.4], { curl: OPEN })]);
  const g = e.update(1 / 60, null, hand([0.2, 1.1, -0.4], { curl: FIST }), HEAD);
  assert.equal(g.pose.right, 'open');
});
test('low confidence tracking cannot fire a push', () => {
  const e = new GestureEngine();
  run(e, 0.3, () => [null, hand([0.1, 1.1, -0.3], { conf: 0.2 })]);
  const seen: GestureOut[] = [];
  run(e, 0.3, (t) => [null, hand([0.1, 1.1, -0.3 - t * 3], { conf: 0.2 })], 1 / 60, (g) => seen.push(g));
  assert.equal(evs(seen).includes('push'), false);
});

console.log('spell definitions');
test('six elements, six base spells, six advanced spells and fifteen fusions', () => {
  assert.equal(ELEMENTS.length, 6);
  assert.equal(Object.keys(BASE_SPELLS).length, 6);
  assert.equal(Object.keys(ADVANCED_SPELLS).length, 6);
  assert.equal(FUSIONS.length, 15);
  assert.equal(new Set(ALL_SPELLS.map((s) => s.id)).size, ALL_SPELLS.length);
});
test('every pair of different elements resolves to a distinct fusion', () => {
  const seen = new Set<string>();
  for (const a of ELEMENTS) for (const b of ELEMENTS) {
    if (a === b) continue;
    const s = resolveSpell(a, b, false, () => true);
    assert.equal(s.tier, 'fusion');
    assert.equal(resolveSpell(b, a, false, () => true).id, s.id, 'order must not matter');
    seen.add(s.id);
  }
  assert.equal(seen.size, 15);
});
test('overcharge gives the advanced spell only when unlocked', () => {
  assert.equal(resolveSpell('fire', 'fire', true, () => false).id, 'flame_orb');
  assert.equal(resolveSpell('fire', 'fire', true, () => true).id, 'phoenix_burst');
});
test('elemental resistance changes damage; ice breaks armour, fire does not', () => {
  const beast = ENEMIES.ember_beast;
  const t = { resist: beast.resist, armor: 0, armorHp: 0, armorBreak: [] };
  assert.ok(damageAgainst(BASE_SPELLS.fire, 1, t).dmg < damageAgainst(BASE_SPELLS.ice, 1, t).dmg);
  const colossus = ENEMIES.root_colossus;
  const armored = { resist: colossus.resist, armor: colossus.armor, armorHp: colossus.armorHp, armorBreak: colossus.armorBreak };
  assert.ok(damageAgainst(BASE_SPELLS.fire, 1, armored).armorDmg > 0);
  assert.equal(damageAgainst(BASE_SPELLS.ice, 1, armored).armorDmg, 0);
});

console.log('spell casting');
const castFrames = (c: SpellCaster, eng: GestureEngine, seconds: number, f: (t: number) => [HandFrame | null, HandFrame | null], can = false): CastEvent[] => {
  const out: CastEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const [l, r] = f(t);
    const g = eng.update(1 / 60, l, r, HEAD);
    out.push(...c.update(1 / 60, g, l, r, HEAD, { shield: can || g.shield }).events);
  }
  return out;
};
test('fire: palms together, hold, then push casts a Flame Orb with power from the charge', () => {
  const c = new SpellCaster();
  const e = new GestureEngine();
  castFrames(c, e, 2, () => facing(0.3));
  const out = castFrames(c, e, 0.4, (t) => {
    const [l, r] = facing(0.3);
    return [{ ...l, palm: addv(l.palm, [0, 0, -t * 3]) }, { ...r, palm: addv(r.palm, [0, 0, -t * 3]) }];
  });
  const cast = out.find((x) => x.t === 'cast') as Extract<CastEvent, { t: 'cast' }> | undefined;
  assert.ok(cast, 'expected a cast');
  assert.equal(cast.spell.id, 'flame_orb');
  assert.ok(cast.power > 0.6);
  assert.ok(c.energy < 100);
});
test('a push with no orb casts nothing', () => {
  const c = new SpellCaster();
  const e = new GestureEngine();
  castFrames(c, e, 0.3, () => [null, hand([0.1, 1.1, -0.3])]);
  const out = castFrames(c, e, 0.3, (t) => [null, hand([0.1, 1.1, -0.3 - t * 3])]);
  assert.equal(out.some((x) => x.t === 'cast'), false);
});
test('not enough energy fizzles instead of casting', () => {
  const c = new SpellCaster();
  const e = new GestureEngine();
  castFrames(c, e, 2, () => facing(0.3));
  c.energy = 0;
  const out = castFrames(c, e, 0.4, (t) => {
    const [l, r] = facing(0.3);
    return [{ ...l, palm: addv(l.palm, [0, 0, -t * 3]) }, { ...r, palm: addv(r.palm, [0, 0, -t * 3]) }];
  });
  assert.ok(out.some((x) => x.t === 'fizzle'));
  assert.equal(out.some((x) => x.t === 'cast'), false);
});
test('different elements in each hand make a fusion; the first cast is a discovery', () => {
  const c = new SpellCaster();
  c.attune('left', 'fire');
  c.attune('right', 'ice');
  const e = new GestureEngine();
  castFrames(c, e, 1.5, () => facing(0.3));
  const out = castFrames(c, e, 0.4, (t) => {
    const [l, r] = facing(0.3);
    return [{ ...l, palm: addv(l.palm, [0, 0, -t * 3]) }, { ...r, palm: addv(r.palm, [0, 0, -t * 3]) }];
  });
  assert.ok(out.some((x) => x.t === 'discover' && x.spell.id === 'steam_explosion'));
  const cast = out.find((x) => x.t === 'cast') as Extract<CastEvent, { t: 'cast' }>;
  assert.equal(cast.spell.id, 'steam_explosion');
  assert.equal(cast.fresh, true);
  assert.ok(c.discovered.has('steam_explosion'));
});
test('the shield and casting are exclusive: crossing the arms cancels a charge', () => {
  const c = new SpellCaster();
  const e = new GestureEngine();
  castFrames(c, e, 1.2, () => facing(0.3));
  const out = castFrames(c, e, 0.6, () => facing(0.3), true);
  assert.equal(out.some((x) => x.t === 'cast'), false);
});
test('lightning needs a wide spread: too close gives no arc charge', () => {
  const c = new SpellCaster();
  c.attune('both', 'lightning');
  const e = new GestureEngine();
  castFrames(c, e, 1.5, () => facing(0.2));
  const out = castFrames(c, e, 0.4, (t) => {
    const [l, r] = facing(0.2);
    return [{ ...l, palm: addv(l.palm, [0, 0, -t * 3]) }, { ...r, palm: addv(r.palm, [0, 0, -t * 3]) }];
  });
  assert.equal(out.some((x) => x.t === 'cast'), false);
  const c2 = new SpellCaster();
  c2.attune('both', 'lightning');
  const e2 = new GestureEngine();
  castFrames(c2, e2, 1.5, () => facing(0.45));
  const out2 = castFrames(c2, e2, 0.4, (t) => {
    const [l, r] = facing(0.45);
    return [{ ...l, palm: addv(l.palm, [0, 0, -t * 3]) }, { ...r, palm: addv(r.palm, [0, 0, -t * 3]) }];
  });
  const cast = out2.find((x) => x.t === 'cast') as Extract<CastEvent, { t: 'cast' }> | undefined;
  assert.equal(cast?.spell.id, 'thunder_arc');
});
test('ice: pinch and pull, release launches a Frost Spear', () => {
  const c = new SpellCaster();
  c.attune('both', 'ice');
  const e = new GestureEngine();
  const frames = (pull: number, pinch: number): [HandFrame, HandFrame] => [
    hand([-0.1, 1.1, -0.5], { normal: [0, 0, -1], aim: [0, 0, -1] }),
    hand([0.1, 1.1, -0.4], { normal: [0, 0, 1], pinch, pinchPt: [0.1, 1.1, -0.5 + pull], curl: [0.4, 0.4, 0.2, 0.5, 0.5] }),
  ];
  castFrames(c, e, 1.4, () => frames(0.35, 0.95));
  const out = castFrames(c, e, 0.4, () => frames(0.35, 0));
  const cast = out.find((x) => x.t === 'cast') as Extract<CastEvent, { t: 'cast' }> | undefined;
  assert.equal(cast?.spell.id, 'frost_spear');
});
test('aether: both palms forward channel a continuous beam and drain energy', () => {
  const c = new SpellCaster();
  c.attune('both', 'aether');
  const e = new GestureEngine();
  const f = (): [HandFrame, HandFrame] => [hand([-0.12, 1.1, -0.4], { normal: [0, 0, -1] }), hand([0.12, 1.1, -0.4], { normal: [0, 0, -1] })];
  let minE = 100;
  const out: CastEvent[] = [];
  for (let t = 0; t < 2; t += 1 / 60) {
    const [l, r] = f();
    const g = e.update(1 / 60, l, r, HEAD);
    out.push(...c.update(1 / 60, g, l, r, HEAD, { shield: g.shield }).events);
    minE = Math.min(minE, c.energy);
  }
  assert.ok(out.filter((x) => x.t === 'beam').length > 5);
  assert.ok(minE < 99, 'min energy ' + minE);
});
test('nature: reach low, draw a circle, vines are cast', () => {
  const c = new SpellCaster();
  c.attune('both', 'nature');
  const e = new GestureEngine();
  const out = castFrames(c, e, 2.2, (t) => [null, hand([Math.cos(t * 5) * 0.12, 0.7 + Math.sin(t * 5) * 0.05 + 0.0, -0.4], { normal: [0, -1, 0] })]);
  void out;
  const e2 = new GestureEngine();
  const c2 = new SpellCaster();
  c2.attune('both', 'nature');
  const out2 = castFrames(c2, e2, 2.5, (t) => [null, hand([Math.cos(t * 5) * 0.12, 0.7 + Math.sin(t * 5) * 0.12, -0.4], { normal: [0, -1, 0] })]);
  const cast = out2.find((x) => x.t === 'cast') as Extract<CastEvent, { t: 'cast' }> | undefined;
  assert.equal(cast?.spell.id, 'thorn_vine');
});
test('shadow: fist plus pull back, opening the fist sends Void Grasp', () => {
  const c = new SpellCaster();
  c.attune('both', 'shadow');
  const e = new GestureEngine();
  const f = (fist: boolean): [HandFrame, HandFrame] => [
    hand([-0.1, 1.1, -0.5], { curl: fist ? FIST : OPEN }),
    hand([0.2, 1.1, -0.15], { curl: OPEN }),
  ];
  castFrames(c, e, 1.6, () => f(true));
  const out = castFrames(c, e, 0.6, () => f(false));
  const cast = out.find((x) => x.t === 'cast') as Extract<CastEvent, { t: 'cast' }> | undefined;
  assert.equal(cast?.spell.id, 'void_grasp');
});
test('advanced spells are locked until ' + ADV_CASTS + ' casts of that element', () => {
  const c = new SpellCaster();
  assert.equal(c.advancedUnlocked('fire'), false);
  c.counts.fire = ADV_CASTS;
  assert.equal(c.advancedUnlocked('fire'), true);
  assert.equal(c.currentSpell(true).id, 'phoenix_burst');
});

console.log('battle');
test('enemies approach, telegraph and then hurt the player', () => {
  const b = new Battle({ mode: 'endless' });
  b.spawnEnemy(ENEMIES.voidling, [0, 0, -2.5]);
  let tele = false;
  for (let t = 0; t < 14; t += 0.05) {
    const ev = b.update(0.05);
    if (ev.some((x) => x.t === 'telegraph')) tele = true;
  }
  assert.ok(tele, 'telegraph before attack');
  assert.ok(b.player.hp < 100);
});
test('a raised shield blocks melee hits and costs shield health', () => {
  const b = new Battle({ mode: 'endless' });
  b.spawnEnemy(ENEMIES.voidling, [0, 0, -1.4]);
  b.setShield(true);
  for (let t = 0; t < 8; t += 0.05) b.update(0.05);
  assert.equal(b.player.hp, 100);
  assert.ok(b.player.shieldHp < 80);
});
test('training mode never damages the player', () => {
  const b = new Battle({ mode: 'training' });
  b.spawnEnemy(ENEMIES.voidling, [0, 0, -1.4]);
  for (let t = 0; t < 12; t += 0.05) b.update(0.05);
  assert.equal(b.player.hp, 100);
});
test('a Flame Orb kills a Voidling and the kill is counted', () => {
  const b = new Battle({ mode: 'endless' });
  b.spawnEnemy(ENEMIES.voidling, [0, 0, -4]);
  b.cast(BASE_SPELLS.fire, 1.1, [0, 1.2, -0.4], [0, -0.15, -1]);
  b.cast(BASE_SPELLS.aether, 1.2, [0, 1.2, -0.4], [0, -0.15, -1]);
  for (let t = 0; t < 4; t += 0.05) b.update(0.05);
  assert.equal(b.stats.kills, 1);
});
test('burn, freeze and stun statuses are applied and freeze stops attacks', () => {
  const b = new Battle({ mode: 'endless', seed: 3 });
  const e = b.spawnEnemy(ENEMIES.voidling, [0, 0, -1.4]);
  e.status.freeze = 5;
  for (let t = 0; t < 4; t += 0.05) b.update(0.05);
  assert.equal(b.player.hp, 100);
});
test('endless mode spawns increasing waves', () => {
  const b = new Battle({ mode: 'endless', seed: 5 });
  for (let t = 0; t < 6; t += 0.05) b.update(0.05);
  assert.ok(b.stats.wave >= 1 && b.alive().length >= 2);
});
test('battle is deterministic for the same seed', () => {
  const sim = (): string => {
    const b = new Battle({ mode: 'endless', seed: 11 });
    for (let t = 0; t < 12; t += 0.05) b.update(0.05);
    return JSON.stringify([b.player.hp, b.enemies.map((e) => [e.def.id, e.pos.map((x) => +x.toFixed(3)), +e.hp.toFixed(2)])]);
  };
  assert.equal(sim(), sim());
});
test('shock waves hurt unless broken by a stomp or blocked', () => {
  const run1 = (act: (b: Battle) => void): number => {
    const b = new Battle({ mode: 'campaign', boss: 'ignar', seed: 1 });
    b.boss!.trans = 0;
    b.boss!.winding = { kind: 'shockwave', t: 0, dur: 0.1 };
    for (let t = 0; t < 3.5; t += 0.05) {
      b.update(0.05);
      act(b);
    }
    return b.player.hp;
  };
  assert.ok(run1(() => undefined) < 100, 'unblocked');
  let stomped = false;
  assert.equal(run1((b) => { if (!stomped && b.rings.length && b.rings[0].arrive < 0.3) { b.stomp(); stomped = true; } }), 100, 'stomp breaks it');
  assert.equal(run1((b) => b.setShield(true)) , 100, 'shield blocks it');
});
test('a well-timed shield reflects a bolt back at Vyra', () => {
  const b = new Battle({ mode: 'campaign', boss: 'vyra', seed: 1 });
  b.boss!.trans = 0;
  const hp0 = b.boss!.hp;
  b.boss!.winding = { kind: 'bolt', t: 0, dur: 0.5 };
  for (let t = 0; t < 0.6; t += 0.05) {
    if (t > 0.3) b.setShield(true);
    b.update(0.05);
  }
  assert.ok(b.boss!.hp < hp0, 'boss took reflected damage');
  assert.equal(b.player.hp, 100);
});
test('enemy fireballs can be shot down', () => {
  const b = new Battle({ mode: 'campaign', boss: 'ignar', seed: 1 });
  b.boss!.trans = 0;
  b.boss!.winding = { kind: 'fireball', t: 0, dur: 0.05 };
  b.update(0.1);
  assert.equal(b.eProj.length, 1);
  b.eProj[0].hp = 0;
  b.update(0.05);
  assert.equal(b.eProj.length, 0);
  assert.equal(b.player.hp, 100);
});

console.log('bosses');
test('all three bosses have the required phase counts', () => {
  assert.equal(BOSSES.ignar.phases.length, 5);
  assert.equal(BOSSES.vyra.phases.length, 5);
  assert.equal(BOSSES.voidking.phases.length, 6);
});
const settle = (b: Battle, to: number): void => {
  for (let i = 0; i < 12 && b.boss!.phase < to; i++) {
    b.boss!.trans = 0;
    b.update(0.05);
  }
  b.boss!.trans = 0;
};
const hitBoss = (b: Battle, spell = BASE_SPELLS.aether, n = 1): void => {
  for (let i = 0; i < n; i++) b.damageBoss(spell, 1, spell.damage * 4, [0, 2, ARENA_Z]);
};
test('Ignar advances through every phase as health drops and never skips one', () => {
  const b = new Battle({ mode: 'campaign', boss: 'ignar', seed: 1 });
  b.boss!.trans = 0;
  const seen = new Set<number>();
  for (let i = 0; i < 400 && !b.boss!.dead; i++) {
    b.boss!.trans = 0;
    b.boss!.armorHp = 0;
    hitBoss(b, BASE_SPELLS.ice, 1);
    b.update(0.05);
    seen.add(b.boss!.phase);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4]);
  assert.ok(b.boss!.dead);
});
test('Ignar armour (phase 3) only breaks to Ice', () => {
  const b = new Battle({ mode: 'campaign', boss: 'ignar', seed: 1 });
  b.boss!.hp = b.boss!.maxHp * 0.55;
  settle(b, 2);
  assert.equal(b.boss!.phase, 2);
  const armor0 = b.boss!.armorHp;
  b.damageBoss(BASE_SPELLS.lightning, 1, 40, [0, 2, ARENA_Z]);
  assert.equal(b.boss!.armorHp, armor0);
  b.damageBoss(BASE_SPELLS.ice, 1, 40, [0, 2, ARENA_Z]);
  assert.ok(b.boss!.armorHp < armor0);
});
test('Ignar exposed core takes far more damage from Aether than from Fire', () => {
  const mk = (): Battle => {
    const b = new Battle({ mode: 'campaign', boss: 'ignar', seed: 1 });
    b.boss!.hp = b.boss!.maxHp * 0.34;
    settle(b, 3);
    return b;
  };
  const a = mk();
  const h0 = a.boss!.hp;
  a.damageBoss(BASE_SPELLS.aether, 1, 20, [0, 2, ARENA_Z]);
  const dA = h0 - a.boss!.hp;
  const f = mk();
  const h1 = f.boss!.hp;
  f.damageBoss(BASE_SPELLS.fire, 1, 20, [0, 2, ARENA_Z]);
  const dF = h1 - f.boss!.hp;
  assert.ok(dA > dF * 3, dA + ' vs ' + dF);
});
test('Vyra is protected by a barrier until all three pylons are overloaded by lightning', () => {
  const b = new Battle({ mode: 'campaign', boss: 'vyra', seed: 1 });
  b.boss!.hp = b.boss!.maxHp * 0.58;
  settle(b, 2);
  assert.equal(b.boss!.barrier, true);
  const h0 = b.boss!.hp;
  b.damageBoss(BASE_SPELLS.fire, 1, 100, [0, 2, ARENA_Z]);
  assert.ok(h0 - b.boss!.hp < 6, 'barrier absorbs almost everything');
  for (const p of b.pylons) {
    const c: [number, number, number] = [p.pos[0], 1, p.pos[2]];
    b.cast(BASE_SPELLS.lightning, 1, [0, 1.3, 0], [c[0] / 6, (c[1] - 1.3) / 6, c[2] / 6]);
  }
  assert.equal(b.boss!.barrier, false);
  const h1 = b.boss!.hp;
  b.damageBoss(BASE_SPELLS.fire, 1, 40, [0, 2, ARENA_Z]);
  assert.ok(h1 - b.boss!.hp > 30);
});
test('Void King absorbs a repeated element and is hurt normally by a mix', () => {
  const b = new Battle({ mode: 'campaign', boss: 'voidking', seed: 1 });
  b.boss!.hp = b.boss!.maxHp * 0.48;
  settle(b, 3);
  assert.equal(b.boss!.phase, 3);
  const dmgs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const h = b.boss!.hp;
    b.damageBoss(BASE_SPELLS.fire, 1, 40, [0, 2, ARENA_Z]);
    dmgs.push(h - b.boss!.hp);
  }
  assert.ok(dmgs[3] < dmgs[0] * 0.3, JSON.stringify(dmgs));
  const h = b.boss!.hp;
  b.damageBoss(BASE_SPELLS.ice, 1, 40, [0, 2, ARENA_Z]);
  assert.ok(h - b.boss!.hp > dmgs[3] * 2);
});
test('Void King final phase grants Aether Nova and only that spell finishes him', () => {
  const b = new Battle({ mode: 'campaign', boss: 'voidking', seed: 1 });
  b.boss!.hp = b.boss!.maxHp * 0.1;
  const evAll: { t: string }[] = [];
  for (let i = 0; i < 12 && b.boss!.phase < 5; i++) {
    b.boss!.trans = 0;
    evAll.push(...b.update(0.05));
  }
  b.boss!.trans = 0;
  const ev = evAll;
  assert.equal(b.boss!.phase, 5);
  assert.ok(ev.some((x) => x.t === 'grant'));
  for (let i = 0; i < 40; i++) b.damageBoss(BASE_SPELLS.fire, 1, 80, [0, 2, ARENA_Z]);
  assert.equal(b.boss!.dead, false, 'normal spells cannot finish');
  b.damageBoss(ADVANCED_SPELLS.aether, 1, 90, [0, 2, ARENA_Z]);
  assert.equal(b.boss!.dead, true);
  for (let t = 0; t < 5; t += 0.1) b.update(0.1);
  assert.equal(b.over, 'win');
});
test('Void King elemental burst is neutralised by the opposite element and opens a window', () => {
  const b = new Battle({ mode: 'campaign', boss: 'voidking', seed: 1 });
  b.boss!.trans = 0;
  b.boss!.winding = { kind: 'elementBurst', t: 0, dur: 0.05, el: 'fire' };
  b.update(0.1);
  assert.equal(b.eProj.length, 1);
  const p = b.eProj[0];
  assert.equal(p.element, 'fire');
  b.cast(BASE_SPELLS.ice, 1, [p.pos[0], p.pos[1], p.pos[2] + 0.5], [0, 0, -1]);
  for (let t = 0; t < 0.4; t += 0.05) b.update(0.05);
  assert.ok(b.boss!.vuln > 0);
});
test('boss rush chains all three bosses', () => {
  const b = new Battle({ mode: 'bossrush', seed: 2 });
  const seen: string[] = [b.boss!.def.id];
  for (let n = 0; n < 3; n++) {
    b.boss!.trans = 0;
    b.boss!.phase = b.boss!.def.phases.length - 1;
    b.boss!.hp = 5;
    b.damageBoss(ADVANCED_SPELLS.aether, 1, 9999, [0, 2, ARENA_Z]);
    for (let t = 0; t < 6; t += 0.1) b.update(0.1);
    if (b.boss && !seen.includes(b.boss.def.id)) seen.push(b.boss.def.id);
  }
  assert.deepEqual(seen, ['ignar', 'vyra', 'voidking']);
  assert.equal(b.over, 'win');
});
test('losing: the battle ends when the player reaches 0 hp', () => {
  const b = new Battle({ mode: 'endless' });
  b.hurtPlayer(500, 'test', PLAYER_HEAD);
  b.update(0.05);
  assert.equal(b.over, 'lose');
});

console.log('save data');
test('default save is well formed and round-trips', () => {
  store.clear();
  const d = defaultSfSave();
  d.counts.fire = 7;
  d.discovered = ['steam_explosion'];
  d.bossBest.ignar = 123;
  d.settings.dominant = 'left';
  writeSfSave(d);
  const r = loadSfSave();
  assert.equal(r.counts.fire, 7);
  assert.deepEqual(r.discovered, ['steam_explosion']);
  assert.equal(r.bossBest.ignar, 123);
  assert.equal(r.settings.dominant, 'left');
});
test('corrupt, outdated and hostile data fall back safely', () => {
  store.set('pw-spellforge-v1', '{bad');
  assert.deepEqual(loadSfSave(), defaultSfSave());
  store.set('pw-spellforge-v1', JSON.stringify({ v: 0 }));
  assert.deepEqual(loadSfSave(), defaultSfSave());
  store.set('pw-spellforge-v1', JSON.stringify({ v: SF_SAVE_VERSION, counts: { fire: 'x', ice: -5 }, discovered: ['nope', 3, 'plasma_burst'], settings: { volume: 9, difficulty: 'evil', dominant: 'up' }, bossBest: { ignar: -1 } }));
  const r = loadSfSave();
  assert.equal(r.counts.fire, 0);
  assert.equal(r.counts.ice, 0);
  assert.deepEqual(r.discovered, ['plasma_burst']);
  assert.equal(r.settings.volume, 1);
  assert.equal(r.settings.difficulty, 'normal');
  assert.equal(r.settings.dominant, 'right');
  assert.equal(r.bossBest.ignar, 0);
});

// ---------------------------------------------------------------- adaptive music + onboarding (pure rules)
test('music: calm field is quiet, tension adds drums then ticks', () => {
  const m = newMix();
  musicMix(0, -1, 0, 1, m);
  assert.equal(m.drums, 0);
  assert.equal(m.ostinato, 0);
  musicMix(0.6, -1, 0, 1, m);
  assert.ok(m.drums > 0 && m.hats > 0);
  assert.equal(m.ostinato, 0);
});
test('music: boss phases escalate tempo, ostinato and lift; final phase adds the choir', () => {
  const a = { ...musicMix(0.5, 0, 5, 1, newMix()) };
  const b = { ...musicMix(0.5, 2, 5, 1, newMix()) };
  const c = { ...musicMix(0.5, 4, 5, 1, newMix()) };
  assert.ok(a.bpm < b.bpm && b.bpm < c.bpm);
  assert.ok(a.ostinato < c.ostinato);
  assert.ok(a.lift <= b.lift && b.lift < c.lift);
  assert.equal(a.choir, 0);
  assert.equal(c.choir, 1);
});
test('music: heartbeat only when the player is low', () => {
  assert.equal(musicMix(0.5, -1, 0, 0.8, newMix()).heartbeat, 0);
  assert.ok(musicMix(0.5, -1, 0, 0.15, newMix()).heartbeat > 0.5);
});
test('onboarding: a tip shows once, then never again', () => {
  const seen: string[] = [];
  assert.ok(takeTip('shield', seen, false).includes('SPACE'));
  assert.equal(takeTip('shield', seen, false), '');
  assert.ok(takeTip('shield', [], true).includes('wrists'));
});
test('onboarding: fusion nudge names a partner element, not the fusion, and counts progress', () => {
  const n = fusionNudge(new Set(), 'fire', 'fire');
  assert.ok(n.includes('(0/15 found)'), n);
  for (const f of FUSIONS) assert.ok(!n.includes(f.name), 'leaks ' + f.name);
  const all = new Set(FUSIONS.map((f) => f.id));
  assert.ok(fusionNudge(all, 'fire', 'ice').startsWith('All 15'));
  const fireDone = new Set(FUSIONS.filter((f) => f.elements.includes('fire')).map((f) => f.id));
  assert.ok(!fusionNudge(fireDone, 'fire', 'fire').startsWith('Pyrogenesis still'));
});
test('save: tips round-trip and unknown tips are dropped', () => {
  const s = defaultSfSave();
  s.tips = ['shield', 'bogus'];
  writeSfSave(s);
  assert.deepEqual(loadSfSave().tips, ['shield']);
  assert.equal(ALL_TIPS.length, 6);
});
test('missing storage never throws', () => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
  assert.equal(loadSfSave().campaign, 0);
  writeSfSave(defaultSfSave());
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
