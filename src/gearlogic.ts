/**
 * GearShift rules, free of any rendering so they can be tested on their own.
 * Board coordinates are metres, x right, y up. A "part" is one toothed wheel on one layer
 * (layer 0 = front, 1 = back); a compound gear is two parts on one axle (peg).
 */
export const M = 0.0135; // tooth module: pitch radius = N * M / 2
export const radius = (n: number): number => (n * M) / 2;
export const outerRadius = (n: number): number => radius(n) + M * 0.9;
const MESH_TOL = M * 0.45;
const CLEAR = M * 1.62; // gap beyond the pitch radii at which teeth no longer touch

export interface PartDef {
  n: number;
  layer: 0 | 1;
}
export interface GearDef {
  parts: PartDef[];
}
export interface Peg {
  x: number;
  y: number;
}
export interface Level {
  name: string;
  goal: string;
  hint: string;
  pegs: Peg[];
  motor: { peg: number; n: number };
  target: { peg: number; n: number; layer: 0 | 1; dir: 1 | -1; minRatio: number; maxRatio: number };
  inventory: GearDef[];
  solution: number[]; // peg index -> inventory index, -1 empty
}

// ------------------------------------------------------------------ building levels from a solution
interface Link {
  parts: PartDef[];
  inPart: number; // which part meshes with the previous gear
  outPart: number; // which part meshes with the next gear
  angle: number; // degrees, direction from the previous gear to this one
}

function build(
  name: string,
  goal: string,
  hint: string,
  motorN: number,
  start: Peg,
  chain: Link[],
  target: { n: number; layer: 0 | 1; dir: 1 | -1; minRatio: number; maxRatio: number },
  targetAngle: number,
  decoys: GearDef[],
  extraPegs: Peg[] = [],
): Level {
  const pegs: Peg[] = [start];
  let prev = start;
  let prevR = radius(motorN);
  const inventory: GearDef[] = [];
  const solution: number[] = [-1];
  for (const l of chain) {
    const a = (l.angle * Math.PI) / 180;
    const d = prevR + radius(l.parts[l.inPart].n);
    prev = { x: prev.x + Math.cos(a) * d, y: prev.y + Math.sin(a) * d };
    pegs.push(prev);
    inventory.push({ parts: l.parts });
    solution.push(inventory.length - 1);
    prevR = radius(l.parts[l.outPart].n);
  }
  const ta = (targetAngle * Math.PI) / 180;
  const td = prevR + radius(target.n);
  pegs.push({ x: prev.x + Math.cos(ta) * td, y: prev.y + Math.sin(ta) * td });
  solution.push(-1);
  for (const e of extraPegs) {
    pegs.push(e);
    solution.push(-1);
  }
  for (const d of decoys) inventory.push(d);
  return { name, goal, hint, pegs, motor: { peg: 0, n: motorN }, target: { peg: 1 + chain.length, ...target }, inventory, solution };
}

const g = (n: number, layer: 0 | 1 = 0): GearDef => ({ parts: [{ n, layer }] });
const link = (n: number, angle: number): Link => ({ parts: [{ n, layer: 0 }], inPart: 0, outPart: 0, angle });
const comp = (nFront: number, nBack: number, angle: number): Link => ({
  parts: [
    { n: nFront, layer: 0 },
    { n: nBack, layer: 1 },
  ],
  inPart: 0,
  outPart: 1,
  angle,
});

const RAW_LEVELS: Level[] = [
  build('First link', 'Make the blue wheel turn the same way', 'Fit the gear that touches both wheels', 12, { x: -0.3, y: 0.12 }, [link(12, 0)], { n: 12, layer: 0, dir: 1, minRatio: 0.9, maxRatio: 1.1 }, 0, [g(16)]),
  build('Turn it around', 'Make the blue wheel turn the OPPOSITE way', 'Every touching pair flips the direction', 12, { x: -0.28, y: 0.2 }, [link(12, -20), link(12, 25)], { n: 12, layer: 0, dir: -1, minRatio: 0.9, maxRatio: 1.1 }, 20, [g(8), g(16)]),
  build('Speed it up', 'Make the output spin 2x faster, opposite way', 'A small wheel turns faster than a big one', 20, { x: -0.3, y: 0.05 }, [link(10, 30), link(14, -25)], { n: 10, layer: 0, dir: -1, minRatio: 1.9, maxRatio: 2.1 }, 20, [g(12), g(20), g(16)]),
  build('Slow and strong', 'Make the output spin at half speed, same way', 'Idle gears only change the direction, not the speed', 10, { x: -0.3, y: 0.18 }, [link(14, -15), link(12, 30), link(8, -10)], { n: 20, layer: 0, dir: 1, minRatio: 0.45, maxRatio: 0.55 }, 25, [g(10), g(16), g(20)]),
  build(
    'Two layers',
    'Reach the back-layer wheel: one gear has two sets of teeth',
    'Front teeth touch the motor, back teeth touch the output',
    10,
    { x: -0.28, y: 0.15 },
    [comp(10, 20, -10)],
    { n: 10, layer: 1, dir: 1, minRatio: 1.9, maxRatio: 2.1 },
    35,
    [g(10), g(20)],
  ),
  build(
    'Double compound',
    'Two double gears in a row: make it spin 3x faster, opposite way',
    'Back teeth of the first feed the front teeth of the second',
    10,
    { x: -0.32, y: 0.2 },
    [comp(10, 20, -20), { parts: [{ n: 10, layer: 1 }, { n: 15, layer: 0 }], inPart: 0, outPart: 1, angle: 20 }],
    { n: 10, layer: 0, dir: -1, minRatio: 2.85, maxRatio: 3.15 },
    -10,
    [g(10), g(20), g(15)],
  ),
  build('Long train', 'Three idle gears in a row: the output is a big slow wheel, same way', 'Only the first and last wheel decide the speed', 10, { x: -0.3, y: 0.15 }, [link(15, -20), link(10, 25), link(20, -15)], { n: 24, layer: 0, dir: 1, minRatio: 0.38, maxRatio: 0.45 }, 20, [g(12), g(25)]),
  build(
    'Big reduction',
    'A double gear slows the output to a quarter, same way',
    'The big front wheel takes the motor, the small back wheel gives it away',
    12,
    { x: -0.3, y: 0.2 },
    [comp(24, 12, -8)],
    { n: 24, layer: 1, dir: 1, minRatio: 0.22, maxRatio: 0.28 },
    8,
    [g(12), g(24)],
  ),
  build(
    'Overdrive',
    'Spin the output 4x faster, same way',
    'Small teeth up front, big teeth behind: the speed climbs',
    20,
    { x: -0.32, y: 0.1 },
    [comp(10, 20, 25)],
    { n: 10, layer: 1, dir: 1, minRatio: 3.8, maxRatio: 4.2 },
    -20,
    [g(10), g(20), g(15)],
  ),
  build(
    'Back-layer relay',
    'The output sits at the back: relay through a back-layer idler, 2x faster, opposite way',
    'After the double gear, the next wheel must be a back-layer one',
    10,
    { x: -0.34, y: 0.2 },
    [comp(10, 20, -30), { parts: [{ n: 12, layer: 1 }], inPart: 0, outPart: 0, angle: 15 }],
    { n: 10, layer: 1, dir: -1, minRatio: 1.9, maxRatio: 2.1 },
    40,
    [g(12), g(12, 1), g(20, 1)],
  ),
  build(
    'Crawler',
    'Two double gears in a row: crawl at a quarter speed, opposite way',
    'Each double gear takes big teeth in and gives small teeth out',
    16,
    { x: -0.34, y: 0.16 },
    [comp(16, 8, -20), { parts: [{ n: 20, layer: 1 }, { n: 8, layer: 0 }], inPart: 0, outPart: 1, angle: 25 }],
    { n: 14, layer: 0, dir: -1, minRatio: 0.21, maxRatio: 0.25 },
    45,
    [g(8), g(16), g(12)],
  ),
  build(
    'Grand gearbox',
    'The final gearbox: output 5x faster, opposite way',
    'Two double gears: 10 and 25 teeth, then 10 and 20 teeth',
    10,
    { x: -0.36, y: 0.2 },
    [comp(10, 25, -6), { parts: [{ n: 10, layer: 1 }, { n: 20, layer: 0 }], inPart: 0, outPart: 1, angle: 10 }],
    { n: 10, layer: 0, dir: -1, minRatio: 4.8, maxRatio: 5.2 },
    -4,
    [g(20), g(25), g(15)],
  ),
];

/** Board box (metres, board coordinates) that every level must fit in: the gears stay clear of the rack and the frame. */
export const FIELD = { x: 0.7, yMin: -0.08, yMax: 0.31 };

/** Centre a finished level's pegs in the board field so the machine sits in the middle however big the gears are. */
function centred(lv: Level): Level {
  const ns = new Map<number, number>();
  const note = (peg: number, n: number): void => void ns.set(peg, Math.max(ns.get(peg) ?? 0, n));
  note(lv.motor.peg, lv.motor.n);
  note(lv.target.peg, lv.target.n);
  lv.solution.forEach((it, peg) => {
    if (it >= 0) for (const p of lv.inventory[it].parts) note(peg, p.n);
  });
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  lv.pegs.forEach((pg, i) => {
    const r = outerRadius(ns.get(i) ?? 10);
    x0 = Math.min(x0, pg.x - r);
    x1 = Math.max(x1, pg.x + r);
    y0 = Math.min(y0, pg.y - r);
    y1 = Math.max(y1, pg.y + r);
  });
  const dx = -(x0 + x1) / 2;
  const dy = (FIELD.yMin + FIELD.yMax) / 2 - (y0 + y1) / 2;
  return { ...lv, pegs: lv.pegs.map((pg) => ({ x: pg.x + dx, y: pg.y + dy })) };
}
export const LEVELS: Level[] = RAW_LEVELS.map(centred);

/** Campaign: six blueprints, two stages each (the look cycles through three styles). */
export const CHAPTERS = ['I  CHRONOMETER ESCAPEMENT', 'II  AETHER PRESSURE REGULATOR', 'III  CELESTIAL ORRERY', 'IV  TIDAL ENGINE', 'V  STARLIGHT DYNAMO', 'VI  GRAND GEARBOX'];
export const chapterOf = (level: number): number => Math.min(5, Math.floor(level / 2));
/** The orrery needs the clutch lever pulled as well as the ignition lever. */
export const needsClutch = (level: number): boolean => level >= 4;

// ------------------------------------------------------------------ evaluating a placement
export interface PartState {
  peg: number;
  layer: 0 | 1;
  n: number;
  x: number;
  y: number;
  omega: number; // relative to the motor (+1 = same sense as the motor)
  parent: number; // index into the same array, -1 for the motor
  sibling: boolean; // rigidly joined to its parent (same axle)
  theta: number; // direction parent -> this (radians)
  parentN: number;
  c: number; // phase constant of the meshing relation
}
export interface Evaluation {
  parts: PartState[];
  jam: boolean;
  win: boolean;
  ratio: number; // |omega| of the output part, 0 if unpowered
  dir: number;
}

interface RawPart {
  peg: number;
  layer: 0 | 1;
  n: number;
  x: number;
  y: number;
}

function rawParts(level: Level, placement: number[]): RawPart[] {
  const out: RawPart[] = [];
  level.pegs.forEach((p, i) => {
    if (i === level.motor.peg) out.push({ peg: i, layer: 0, n: level.motor.n, x: p.x, y: p.y });
    else if (i === level.target.peg) out.push({ peg: i, layer: level.target.layer, n: level.target.n, x: p.x, y: p.y });
    else if (placement[i] >= 0) for (const part of level.inventory[placement[i]].parts) out.push({ peg: i, layer: part.layer, n: part.n, x: p.x, y: p.y });
  });
  return out;
}

type Contact = 'none' | 'mesh' | 'clash';
export function contact(a: RawPart, b: RawPart): Contact {
  if (a.layer !== b.layer || a.peg === b.peg) return 'none';
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const sum = radius(a.n) + radius(b.n);
  if (Math.abs(d - sum) <= MESH_TOL) return 'mesh';
  if (d < sum + CLEAR) return 'clash';
  return 'none';
}

/** Can this inventory gear sit on this peg without crashing into a neighbour? */
export function fits(level: Level, placement: number[], peg: number, item: number): boolean {
  const trial = placement.slice();
  trial[peg] = item;
  const parts = rawParts(level, trial);
  const mine = parts.filter((p) => p.peg === peg);
  for (const a of mine) for (const b of parts) if (b.peg !== peg && contact(a, b) === 'clash') return false;
  return true;
}

export function evaluate(level: Level, placement: number[]): Evaluation {
  const raw = rawParts(level, placement);
  const states: PartState[] = [];
  const idx = new Map<RawPart, number>();
  const motor = raw.find((p) => p.peg === level.motor.peg) as RawPart;
  const push = (p: RawPart, omega: number, parent: number, sibling: boolean, theta: number, parentN: number, c: number): void => {
    idx.set(p, states.length);
    states.push({ peg: p.peg, layer: p.layer, n: p.n, x: p.x, y: p.y, omega, parent, sibling, theta, parentN, c });
  };
  push(motor, 1, -1, false, 0, 0, 0);
  let jam = false;
  for (let qi = 0; qi < states.length; qi++) {
    const s = states[qi];
    const cur = raw.find((p) => p.peg === s.peg && p.layer === s.layer) as RawPart;
    for (const o of raw) {
      if (o === cur || idx.has(o)) {
        if (o !== cur && idx.has(o) && o.peg !== cur.peg && contact(cur, o) === 'mesh') {
          const w = -s.omega * (s.n / o.n);
          if (Math.abs(w - states[idx.get(o) as number].omega) > 1e-6) jam = true;
        }
        continue;
      }
      if (o.peg === cur.peg) {
        push(o, s.omega, qi, true, 0, s.n, 0); // same axle: turns together
      } else if (contact(cur, o) === 'mesh') {
        const th = Math.atan2(o.y - cur.y, o.x - cur.x);
        push(o, -s.omega * (s.n / o.n), qi, false, th, s.n, th * (1 + s.n / o.n) + Math.PI + Math.PI / o.n);
      }
    }
  }
  const out = states.find((p) => p.peg === level.target.peg && p.layer === level.target.layer);
  const ratio = out ? Math.abs(out.omega) : 0;
  const dir = out ? Math.sign(out.omega) : 0;
  const T = level.target;
  const win = !jam && !!out && dir === T.dir && ratio >= T.minRatio && ratio <= T.maxRatio;
  return { parts: states, jam, win, ratio, dir };
}

/** Is this peg valid for the whole placement (no clashes anywhere)? */
export function clashFree(level: Level, placement: number[]): boolean {
  const parts = rawParts(level, placement);
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (contact(parts[i], parts[j]) === 'clash') return false;
  return true;
}
