/**
 * Aura Weaver: pure optics + puzzle logic (no rendering, no DOM) so a node script can verify every level.
 *
 * LIGHT MODEL (documented, deterministic)
 *  The sanctuary has three primary lights, stored as bits of a mask:  CYAN = 1, MAGENTA = 2, GOLD = 4.
 *  Mixing is additive and is the bitwise union of the masks of every beam that reaches a gate:
 *    Cyan + Magenta = Violet      Cyan + Gold = Emerald      Magenta + Gold = Ember      all three = White
 *  A gate opens only when the union EXACTLY equals the colour it needs (extra light = impure, gate stays shut).
 *  A prism re-emits each primary of an incoming beam as its own beam in a fan (-30 / 0 / +30 degrees from its
 *  facing). A filter keeps only its colour. A splitter sends a copy straight on and a copy mirrored.
 */
export const CYAN = 1;
export const MAGENTA = 2;
export const GOLD = 4;
export const WHITE = 7;

export type Kind = 'mirror' | 'prism' | 'splitter' | 'filter' | 'wall';
export interface Elem {
  kind: Kind;
  x: number;
  y: number;
  /** current orientation step (player-controlled when rot is true) */
  a: number;
  rot: boolean;
  /** half length of mirror / splitter / filter / wall segments */
  len: number;
  /** filters: colour kept. walls/mirrors: unused */
  mask: number;
  /** fixed segment angle (radians) for non-rotating line elements */
  fixedAng?: number;
}
export interface Source {
  x: number;
  y: number;
  ang: number;
  mask: number;
}
export interface Target {
  x: number;
  y: number;
  mask: number;
  r: number;
}
export interface Level {
  name: string;
  chapter: string;
  goal: string;
  hint: string;
  sources: Source[];
  elems: Elem[];
  targets: Target[];
}

export const MIRROR_STEPS = 12; // over 180 degrees -> 15 degree steps
export const PRISM_STEPS = 24; // over 360 degrees -> 15 degree steps
export const BOUND_X = 0.54;
export const BOUND_Y = 0.33;
const PRISM_R = 0.04;
const MAX_RAYS = 48;
const MAX_DEPTH = 12;
const FAN = (30 * Math.PI) / 180;

export const angleOf = (e: Elem): number => {
  if (e.fixedAng !== undefined && !e.rot) return e.fixedAng;
  return e.kind === 'prism' ? (e.a * Math.PI * 2) / PRISM_STEPS : (e.a * Math.PI) / MIRROR_STEPS;
};
export const stepsOf = (e: Elem): number => (e.kind === 'prism' ? PRISM_STEPS : MIRROR_STEPS);

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mask: number;
}
export interface Trace {
  segs: Seg[];
  /** union of light colours reaching each target */
  got: number[];
  /** which target indices are satisfied */
  ok: boolean[];
  solved: boolean;
}

interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
  mask: number;
  depth: number;
  from: number; // element index to skip, -1 none
}

const EPS = 1e-5;

function hitSeg(r: Ray, cx: number, cy: number, th: number, len: number): number {
  const sx = Math.cos(th);
  const sy = Math.sin(th);
  const ax = cx - sx * len;
  const ay = cy - sy * len;
  const ex = sx * len * 2;
  const ey = sy * len * 2;
  const den = r.dx * ey - r.dy * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((ax - r.x) * ey - (ay - r.y) * ex) / den;
  const u = ((ax - r.x) * r.dy - (ay - r.y) * r.dx) / den;
  return t > EPS && u >= 0 && u <= 1 ? t : Infinity;
}
function hitCircle(r: Ray, cx: number, cy: number, rad: number): number {
  const fx = r.x - cx;
  const fy = r.y - cy;
  const b = fx * r.dx + fy * r.dy;
  const c = fx * fx + fy * fy - rad * rad;
  const d = b * b - c;
  if (d < 0) return Infinity;
  const s = Math.sqrt(d);
  const t0 = -b - s;
  const t1 = -b + s;
  if (t0 > EPS) return t0;
  return t1 > EPS && c < 0 ? t1 : Infinity;
}
function boundT(r: Ray): number {
  let t = Infinity;
  if (r.dx > 1e-9) t = Math.min(t, (BOUND_X - r.x) / r.dx);
  else if (r.dx < -1e-9) t = Math.min(t, (-BOUND_X - r.x) / r.dx);
  if (r.dy > 1e-9) t = Math.min(t, (BOUND_Y - r.y) / r.dy);
  else if (r.dy < -1e-9) t = Math.min(t, (-BOUND_Y - r.y) / r.dy);
  return Math.max(t, 0);
}

export function trace(lv: Level, wantSegs = true): Trace {
  const segs: Seg[] = [];
  const got = lv.targets.map(() => 0);
  const queue: Ray[] = [];
  for (const s of lv.sources) queue.push({ x: s.x, y: s.y, dx: Math.cos(s.ang), dy: Math.sin(s.ang), mask: s.mask, depth: 0, from: -1 });
  let spawned = queue.length;
  while (queue.length) {
    const r = queue.pop() as Ray;
    let bt = boundT(r);
    let hitKind: 'bound' | 'elem' | 'target' = 'bound';
    let hi = -1;
    for (let i = 0; i < lv.elems.length; i++) {
      if (i === r.from) continue;
      const e = lv.elems[i];
      const t = e.kind === 'prism' ? hitCircle(r, e.x, e.y, PRISM_R) : hitSeg(r, e.x, e.y, angleOf(e), e.len);
      if (t < bt) {
        bt = t;
        hitKind = 'elem';
        hi = i;
      }
    }
    // targets absorb light only to record it; the beam continues to its end point inside the monolith
    let tHit = -1;
    let tt = Infinity;
    for (let i = 0; i < lv.targets.length; i++) {
      const g = lv.targets[i];
      const t = hitCircle(r, g.x, g.y, g.r);
      if (t < tt) {
        tt = t;
        tHit = i;
      }
    }
    if (tHit >= 0 && tt < bt) {
      got[tHit] |= r.mask;
      bt = tt;
      hitKind = 'target';
    }
    const ex = r.x + r.dx * bt;
    const ey = r.y + r.dy * bt;
    if (wantSegs) segs.push({ x1: r.x, y1: r.y, x2: ex, y2: ey, mask: r.mask });
    if (hitKind !== 'elem' || r.depth >= MAX_DEPTH) continue;
    const e = lv.elems[hi];
    const push = (dx: number, dy: number, mask: number): void => {
      if (spawned >= MAX_RAYS || !mask) return;
      spawned++;
      queue.push({ x: ex, y: ey, dx, dy, mask, depth: r.depth + 1, from: hi });
    };
    if (e.kind === 'wall') continue;
    if (e.kind === 'prism') {
      const th = angleOf(e);
      const parts: [number, number][] = [
        [CYAN, th - FAN],
        [MAGENTA, th],
        [GOLD, th + FAN],
      ];
      for (const [m, a] of parts) if (r.mask & m) push2(queue, e.x, e.y, Math.cos(a), Math.sin(a), m, r.depth + 1, hi, () => spawned++ < MAX_RAYS);
      continue;
    }
    if (e.kind === 'filter') {
      const m = r.mask & e.mask;
      // a filter is thin: pass straight through, minus the colours it blocks
      push(r.dx, r.dy, m);
      continue;
    }
    const th = angleOf(e);
    const nx = -Math.sin(th);
    const ny = Math.cos(th);
    const dn = r.dx * nx + r.dy * ny;
    const rx = r.dx - 2 * dn * nx;
    const ry = r.dy - 2 * dn * ny;
    if (e.kind === 'mirror') push(rx, ry, r.mask);
    else {
      push(rx, ry, r.mask);
      push(r.dx, r.dy, r.mask);
    }
  }
  const ok = lv.targets.map((g, i) => got[i] === g.mask);
  return { segs, got, ok, solved: ok.every(Boolean) };
}

function push2(q: Ray[], x: number, y: number, dx: number, dy: number, mask: number, depth: number, from: number, can: () => boolean): void {
  if (can()) q.push({ x, y, dx, dy, mask, depth, from });
}

/** Exhaustive search over every rotatable element. Returns all solved angle sets (up to cap). */
export function solve(lv: Level, cap = 50): number[][] {
  const rots = lv.elems.map((e, i) => (e.rot ? i : -1)).filter((i) => i >= 0);
  const saved = lv.elems.map((e) => e.a);
  const out: number[][] = [];
  const rec = (k: number): void => {
    if (out.length >= cap) return;
    if (k === rots.length) {
      if (trace(lv, false).solved) out.push(rots.map((i) => lv.elems[i].a));
      return;
    }
    const e = lv.elems[rots[k]];
    for (let a = 0; a < stepsOf(e); a++) {
      e.a = a;
      rec(k + 1);
    }
  };
  rec(0);
  lv.elems.forEach((e, i) => (e.a = saved[i]));
  return out;
}

// ------------------------------------------------------------------ chapters
const el = (kind: Kind, x: number, y: number, a: number, rot = true, len = 0.075, mask = 0, fixedAng?: number): Elem => ({ kind, x, y, a, rot, len, mask, fixedAng });
const D = (deg: number): number => (deg * Math.PI) / 180;

export const CHAPTER_NAMES = ['THE FIRST BREATH', 'THE PRISM GARDEN', 'THE FORGOTTEN GEOMETRY', 'THE HEART OF RESONANCE', 'THE ETERNAL BLOOM'];

export function makeLevels(): Level[] {
  return [
    {
      name: 'First light',
      chapter: CHAPTER_NAMES[0],
      goal: 'Bend the cyan light into the sleeping monolith',
      hint: 'Turn the mirror until the beam climbs',
      sources: [{ x: -0.5, y: -0.12, ang: 0, mask: CYAN }],
      elems: [el('mirror', 0.0, -0.12, 0)],
      targets: [{ x: 0.0, y: 0.2, mask: CYAN, r: 0.05 }],
    },
    {
      name: 'Echo',
      chapter: CHAPTER_NAMES[0],
      goal: 'Two mirrors: carry the light around the corner',
      hint: 'The second mirror catches what the first one sends',
      sources: [{ x: -0.5, y: 0.2, ang: 0, mask: CYAN }],
      elems: [el('mirror', -0.12, 0.2, 0), el('mirror', -0.12, -0.14, 0)],
      targets: [{ x: 0.36, y: -0.14, mask: CYAN, r: 0.05 }],
    },
    {
      name: 'Split the dawn',
      chapter: CHAPTER_NAMES[1],
      goal: 'A prism splits white light: wake all three gates',
      hint: 'Rotate the prism so each colour meets its gate',
      sources: [{ x: -0.5, y: 0.0, ang: 0, mask: WHITE }],
      elems: [el('prism', -0.15, 0.0, 6, true)],
      targets: [
        { x: 0.3, y: 0.26, mask: GOLD, r: 0.05 },
        { x: 0.3, y: 0.0, mask: MAGENTA, r: 0.05 },
        { x: 0.3, y: -0.26, mask: CYAN, r: 0.05 },
      ],
    },
    {
      name: 'Violet gate',
      chapter: CHAPTER_NAMES[1],
      goal: 'Mix cyan and magenta into violet',
      hint: 'Both beams must reach the same gate. Extra light spoils the mix',
      sources: [
        { x: -0.5, y: 0.22, ang: 0, mask: CYAN },
        { x: -0.5, y: -0.22, ang: 0, mask: MAGENTA },
      ],
      elems: [el('mirror', 0.02, 0.22, 0), el('mirror', 0.02, -0.22, 6)],
      targets: [{ x: 0.4, y: 0.0, mask: CYAN | MAGENTA, r: 0.055 }],
    },
    {
      name: 'Lost cathedral',
      chapter: CHAPTER_NAMES[2],
      goal: 'Reflect around the stone and light two gates',
      hint: 'Stone blocks light. Mirrors can step around it',
      sources: [{ x: -0.5, y: 0.0, ang: 0, mask: CYAN | GOLD }],
      elems: [
        el('wall', -0.15, 0.0, 0, false, 0.09, 0, D(90)),
        el('prism', -0.4, 0.0, 6, true),
        el('mirror', 0.1, 0.29, 0),
        el('mirror', 0.1, -0.29, 0),
      ],
      targets: [
        { x: 0.42, y: 0.29, mask: GOLD, r: 0.05 },
        { x: 0.42, y: -0.29, mask: CYAN, r: 0.05 },
      ],
    },
    {
      name: 'Resonance',
      chapter: CHAPTER_NAMES[3],
      goal: 'Split the light: wake the emerald, magenta and cyan gates',
      hint: 'The splitter lends a copy of the light to a second path',
      sources: [{ x: -0.5, y: 0.0, ang: 0, mask: WHITE }],
      elems: [
        el('splitter', -0.3, 0.0, 0),
        el('mirror', -0.3, 0.25, 0),
        el('filter', 0.0, 0.25, 0, false, 0.05, CYAN | GOLD, D(90)),
        el('prism', 0.0, 0.0, 6, true),
      ],
      targets: [
        { x: 0.42, y: 0.25, mask: CYAN | GOLD, r: 0.05 },
        { x: 0.42, y: 0.0, mask: MAGENTA, r: 0.05 },
        { x: 0.42, y: -0.25, mask: CYAN, r: 0.05 },
      ],
    },
    {
      name: 'Eternal bloom',
      chapter: CHAPTER_NAMES[4],
      goal: 'Weave cyan, magenta and gold into the white heart',
      hint: 'Mirrors from above and below, a prism to turn the gold',
      sources: [
        { x: -0.5, y: 0.26, ang: 0, mask: CYAN },
        { x: -0.5, y: -0.26, ang: 0, mask: MAGENTA },
        { x: 0.5, y: 0.0, ang: Math.PI, mask: GOLD },
      ],
      elems: [el('splitter', -0.05, 0.26, 0), el('splitter', -0.05, -0.26, 0), el('prism', 0.25, 0.0, 6, true)],
      targets: [
        { x: -0.05, y: 0.0, mask: WHITE, r: 0.06 },
        { x: 0.42, y: 0.26, mask: CYAN, r: 0.05 },
        { x: 0.42, y: -0.26, mask: MAGENTA, r: 0.05 },
      ],
    },
  ];
}
