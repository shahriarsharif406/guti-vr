/**
 * Aura Weaver: THREAD logic (pure; no rendering, no DOM). The signature mechanic of the station.
 *
 * MODEL (documented, deterministic, unit-tested in tests/aura.test.ts)
 *  - A puzzle board holds energy NODES. The player weaves directed THREADS from one node to another.
 *    Energy flows only along a thread's direction (a -> b) and carries a colour mask (CYAN 1, MAGENTA 2, GOLD 4).
 *  - Node kinds:
 *      source    emits its colour (optionally only while a light gate is awake: `light`)
 *      receiver  must receive EXACTLY its colour (union of every incoming thread), like a light gate
 *      relay     passes energy on (1 thread out)            splitter  passes energy to 2 threads
 *      rotator   a sink; while powered, its linked celestial ring may be turned
 *      locked    conducts only while the node named by `lockBy` is powered
 *      memory    remembers energy: once powered it stays charged (latched) and awakens the ECHO recorder
 *      key       conducts only while held (by the player's hand or by a recorded memory ECHO);
 *                the player can hold only one key at a time, so more keys need echoes
 *      seed      exists only in the PAST. If it is powered in the past, its BLOOM exists in the present
 *      bloom     exists only in the present (only if its seed bloomed) and emits the seed's colour
 *      star      rides a celestial ring; its position turns with the ring
 *  - Threads: at most `maxLen` long (tension), may not pass through walls, and may not cross another thread of
 *    the same era (crossing threads would short the energy). Each node has an out / in capacity.
 *  - Time weaving: a puzzle may have two eras (1 = past, 2 = present). Threads are woven into the era you are in.
 *    Nodes and walls exist in both eras (0) or one era. Goals are judged in the era each receiver exists in
 *    (both-era receivers are judged in the present).
 *  - Celestial geometry: rings turn in discrete steps. Constellation sockets require a star to sit on a point.
 */
import { CYAN, GOLD, MAGENTA, WHITE } from './auralogic.js';

export type NodeKind = 'source' | 'receiver' | 'relay' | 'splitter' | 'rotator' | 'locked' | 'memory' | 'key' | 'seed' | 'bloom' | 'star';
export type Era = 1 | 2;
export interface WNode {
  kind: NodeKind;
  x: number;
  y: number;
  mask: number;
  era: 0 | 1 | 2;
  ring: number;
  phase: number;
  lockBy: number;
  seed: number;
  light: number;
}
export interface Ring {
  cx: number;
  cy: number;
  r: number;
  steps: number;
  a: number;
  /** rotator node index that must be powered to turn this ring (-1: always free) */
  motor: number;
}
export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  era: 0 | 1 | 2;
}
export interface Thread {
  a: number;
  b: number;
  era: Era;
  fixed?: boolean;
}
export interface Socket {
  node: number;
  x: number;
  y: number;
}
export interface Weave {
  nodes: WNode[];
  rings: Ring[];
  walls: Wall[];
  fixed: Thread[];
  maxLen: number;
  eras: 1 | 2;
  echoSlots: number;
  sockets: Socket[];
}
export interface WeaveState {
  threads: Thread[];
  era: Era;
  /** key node indices currently held (player + echoes) */
  held: number[];
  /** memory nodes that have been charged at least once */
  latched: boolean[];
  /** light gates that are awake (combined light + thread puzzles) */
  lightOn: boolean[];
  /** relaxed difficulty stretches the reach of every thread */
  slack: number;
}
export interface WeaveEval {
  /** colour mask arriving at / flowing through each node, per era index (0 = past, 1 = present) */
  mask: number[][];
  /** does node i exist in era (0 past, 1 present) */
  exists: boolean[][];
  /** does node i pass energy on, per era */
  live: boolean[][];
  receiverOk: boolean[];
  aligned: boolean[];
  solved: boolean;
  /** rotator nodes powered in the current evaluation */
  motorOn: boolean[];
  /** memory nodes powered right now (caller latches them) */
  memoryHit: boolean[];
}

export const OUT_CAP: Record<NodeKind, number> = { source: 1, receiver: 0, relay: 1, splitter: 2, rotator: 0, locked: 1, memory: 1, key: 1, seed: 1, bloom: 1, star: 1 };
export const IN_CAP: Record<NodeKind, number> = { source: 0, receiver: 2, relay: 1, splitter: 1, rotator: 1, locked: 1, memory: 1, key: 1, seed: 1, bloom: 0, star: 1 };
export const NODE_R = 0.03;
export const SOCKET_EPS = 0.012;
/** one key can be held by the living hand at a time; each echo slot adds one more */
export const LIVE_HOLDS = 1;

export const node = (kind: NodeKind, x: number, y: number, o: Partial<WNode> = {}): WNode => ({ kind, x, y, mask: 0, era: 0, ring: -1, phase: 0, lockBy: -1, seed: -1, light: -1, ...o });

export function nodePos(w: Weave, i: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const n = w.nodes[i];
  if (n.ring >= 0) {
    const r = w.rings[n.ring];
    const th = n.phase + (r.a * Math.PI * 2) / r.steps;
    out.x = r.cx + Math.cos(th) * r.r;
    out.y = r.cy + Math.sin(th) * r.r;
  } else {
    out.x = n.x;
    out.y = n.y;
  }
  return out;
}
const eraIdx = (e: Era): number => e - 1;
const inEra = (n: WNode, e: Era): boolean => n.era === 0 || n.era === e;

/** proper segment intersection (shared end points do not count) */
export function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

export const allThreads = (w: Weave, s: WeaveState): Thread[] => w.fixed.concat(s.threads);
export const reach = (w: Weave, s: WeaveState): number => w.maxLen * (1 + s.slack);
export function threadLen(w: Weave, t: { a: number; b: number }): number {
  const p = nodePos(w, t.a);
  const q = nodePos(w, t.b);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

export type WeaveRefusal = '' | 'self' | 'era' | 'capacity-out' | 'capacity-in' | 'duplicate' | 'too-long' | 'wall' | 'crossing';
/** Why a new thread a -> b cannot be woven in the current era ('' = it can). `ignore` skips one existing thread. */
export function canWeave(w: Weave, s: WeaveState, a: number, b: number, era: Era = s.era, ignore: Thread | null = null, bloomOk = true): WeaveRefusal {
  if (a === b) return 'self';
  const na = w.nodes[a];
  const nb = w.nodes[b];
  if (!inEra(na, era) || !inEra(nb, era)) return 'era';
  if (!bloomOk && (na.kind === 'bloom' || nb.kind === 'bloom')) return 'era';
  const ts = allThreads(w, s).filter((t) => t !== ignore && t.era === era);
  if (ts.filter((t) => t.a === a).length >= OUT_CAP[na.kind]) return 'capacity-out';
  if (ts.filter((t) => t.b === b).length >= IN_CAP[nb.kind]) return 'capacity-in';
  if (ts.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a))) return 'duplicate';
  const p = nodePos(w, a);
  const q = nodePos(w, b);
  if (Math.hypot(q.x - p.x, q.y - p.y) > reach(w, s) + 1e-9) return 'too-long';
  for (const wl of w.walls) if ((wl.era === 0 || wl.era === era) && segCross(p.x, p.y, q.x, q.y, wl.x1, wl.y1, wl.x2, wl.y2)) return 'wall';
  for (const t of ts) {
    if (t.a === a || t.a === b || t.b === a || t.b === b) continue;
    const u = nodePos(w, t.a);
    const v = nodePos(w, t.b);
    if (segCross(p.x, p.y, q.x, q.y, u.x, u.y, v.x, v.y)) return 'crossing';
  }
  return '';
}

/** Threads that became impossible (a ring turned and stretched or crossed them). Fixed threads never break. */
export function brokenThreads(w: Weave, s: WeaveState): Thread[] {
  const out: Thread[] = [];
  for (const t of s.threads) if (canWeave(w, s, t.a, t.b, t.era, t) !== '') out.push(t);
  return out;
}

export function evaluate(w: Weave, s: WeaveState): WeaveEval {
  const N = w.nodes.length;
  const mask: number[][] = [new Array(N).fill(0), new Array(N).fill(0)];
  const exists: boolean[][] = [new Array(N).fill(false), new Array(N).fill(false)];
  const live: boolean[][] = [new Array(N).fill(false), new Array(N).fill(false)];
  const ts = allThreads(w, s);
  const held = new Set(s.held);
  const eras: Era[] = w.eras === 2 ? [1, 2] : [2];
  for (const era of eras) {
    const ei = eraIdx(era);
    const m = mask[ei];
    for (let i = 0; i < N; i++) {
      const n = w.nodes[i];
      exists[ei][i] = inEra(n, era) && (n.kind !== 'bloom' || (n.seed >= 0 && mask[0][n.seed] !== 0));
    }
    // fixpoint: locked nodes depend on other nodes' power; everything is monotone so this terminates
    for (let iter = 0; iter < N + 2; iter++) {
      let changed = false;
      const lv = live[ei];
      for (let i = 0; i < N; i++) {
        const n = w.nodes[i];
        if (!exists[ei][i]) continue;
        let own = 0;
        if (n.kind === 'source' && (n.light < 0 || s.lightOn[n.light])) own = n.mask;
        if (n.kind === 'bloom') own = mask[0][n.seed];
        if (n.kind === 'memory' && s.latched[i]) own = n.mask || WHITE;
        if (own && (m[i] | own) !== m[i]) {
          m[i] |= own;
          changed = true;
        }
        let on = m[i] !== 0 && OUT_CAP[n.kind] > 0;
        if (n.kind === 'key') on = on && held.has(i);
        if (n.kind === 'locked') on = on && n.lockBy >= 0 && m[n.lockBy] !== 0;
        if (on !== lv[i]) {
          lv[i] = on;
          changed = true;
        }
      }
      for (const t of ts) {
        if (t.era !== era || !exists[ei][t.a] || !exists[ei][t.b] || !lv[t.a]) continue;
        const add = m[t.a];
        if ((m[t.b] | add) !== m[t.b]) {
          m[t.b] |= add;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  const judgeEra = (n: WNode): number => (n.era === 1 ? 0 : 1);
  const receiverOk: boolean[] = [];
  const motorOn: boolean[] = [];
  const memoryHit: boolean[] = [];
  w.nodes.forEach((n, i) => {
    const e = judgeEra(n);
    receiverOk.push(n.kind === 'receiver' ? exists[e][i] && mask[e][i] === n.mask : true);
    motorOn.push(n.kind === 'rotator' && (mask[0][i] !== 0 || mask[1][i] !== 0));
    memoryHit.push(n.kind === 'memory' && (mask[0][i] !== 0 || mask[1][i] !== 0));
  });
  const aligned = w.sockets.map((k) => {
    const p = nodePos(w, k.node);
    return Math.hypot(p.x - k.x, p.y - k.y) < SOCKET_EPS;
  });
  const solved = receiverOk.every(Boolean) && aligned.every(Boolean);
  return { mask, exists, live, receiverOk, aligned, solved, motorOn, memoryHit };
}

/** Echoes are available once any memory node has been charged. */
export const echoReady = (w: Weave, s: WeaveState): boolean => w.echoSlots > 0 && w.nodes.some((n, i) => n.kind === 'memory' && s.latched[i]);
/** How many keys may be held at once (the living hand plus available echoes). */
export const holdLimit = (w: Weave, s: WeaveState, echoes: number): number => LIVE_HOLDS + Math.min(echoes, echoReady(w, s) ? w.echoSlots : 0);

export function freshState(w: Weave, startEra: Era = 2): WeaveState {
  return { threads: [], era: w.eras === 2 ? startEra : 2, held: [], latched: w.nodes.map(() => false), lightOn: [], slack: 0 };
}

/** latch every memory node that is powered now; returns true if something new was remembered */
export function latchMemories(w: Weave, s: WeaveState, ev: WeaveEval = evaluate(w, s)): boolean {
  let any = false;
  ev.memoryHit.forEach((h, i) => {
    if (h && !s.latched[i]) {
      s.latched[i] = true;
      any = true;
    }
  });
  return any;
}

// ------------------------------------------------------------------ solver
export interface WeaveSolution {
  threads: Thread[];
  rings: number[];
  held: number[];
  echoes: number;
}
export interface SolveOpts {
  /** echo slots allowed (defaults to the puzzle's) */
  echoSlots?: number;
  /** all light gates awake (combined puzzles assume the light half is solved) */
  lightOn?: boolean;
  maxThreads?: number;
  slack?: number;
}

/**
 * Exhaustive-but-pruned search. For every ring setting that aligns the constellation sockets (and whose motor can
 * be powered), threads are grown only from nodes that already receive energy (a thread from a dark node can never
 * help), breadth-first, so the first hit uses the FEWEST threads (the par). Key holds: the largest allowed set.
 * Memory latching is monotone: any memory node that can be powered is assumed charged (the player can re-weave).
 */
export function solveWeave(w: Weave, opts: SolveOpts = {}): WeaveSolution | null {
  const echoSlots = opts.echoSlots ?? w.echoSlots;
  const maxT = opts.maxThreads ?? 8;
  const keys = w.nodes.map((n, i) => (n.kind === 'key' ? i : -1)).filter((i) => i >= 0);
  const ringSaved = w.rings.map((r) => r.a);
  const lightN = Math.max(0, ...w.nodes.map((n) => n.light + 1));
  const base = (): WeaveState => {
    const s = freshState(w);
    s.lightOn = new Array(lightN).fill(opts.lightOn ?? true);
    s.slack = opts.slack ?? 0;
    return s;
  };
  // 1) which memory nodes can ever be charged (ignoring rings / keys: generous upper bound, then verified below)
  const memo = new Map<string, WeaveSolution | null>();
  const search = (latched: boolean[], holdSets: number[][], ringCfg: number[]): WeaveSolution | null => {
    const key = latched.join() + '|' + ringCfg.join();
    if (memo.has(key)) return memo.get(key) ?? null;
    let found: WeaveSolution | null = null;
    for (const held of holdSets) {
      const s0 = base();
      s0.latched = latched.slice();
      s0.held = held;
      const seen = new Set<string>();
      let layer: Thread[][] = [[]];
      for (let depth = 0; depth <= maxT && !found; depth++) {
        const next: Thread[][] = [];
        for (const set of layer) {
          s0.threads = set;
          const ev = evaluate(w, s0);
          if (ev.solved) {
            found = { threads: set.map((t) => ({ ...t })), rings: ringCfg.slice(), held: held.slice(), echoes: Math.max(0, held.length - LIVE_HOLDS) };
            break;
          }
          if (depth === maxT) continue;
          const eras: Era[] = w.eras === 2 ? [1, 2] : [2];
          for (const era of eras) {
            const ei = era - 1;
            for (let a = 0; a < w.nodes.length; a++) {
              if (!ev.exists[ei][a] || ev.mask[ei][a] === 0 || OUT_CAP[w.nodes[a].kind] === 0) continue;
              for (let b = 0; b < w.nodes.length; b++) {
                if (!ev.exists[ei][b]) continue;
                if (canWeave(w, s0, a, b, era) !== '') continue;
                const nt = set.concat([{ a, b, era }]);
                const k = nt
                  .map((t) => t.era + ':' + t.a + '>' + t.b)
                  .sort()
                  .join(',');
                if (seen.has(k)) continue;
                seen.add(k);
                next.push(nt);
              }
            }
          }
        }
        layer = next;
        if (layer.length > 60000) break; // safety valve: puzzles are designed far below this
      }
      if (found) break;
    }
    memo.set(key, found);
    return found;
  };
  const ringCfgs: number[][] = [[]];
  for (const r of w.rings) {
    const nx: number[][] = [];
    for (const c of ringCfgs) for (let a = 0; a < r.steps; a++) nx.push(c.concat([a]));
    ringCfgs.splice(0, ringCfgs.length, ...nx);
  }
  const subsets = (k: number): number[][] => {
    const out: number[][] = [];
    const rec = (i: number, cur: number[]): void => {
      if (cur.length === k) {
        out.push(cur.slice());
        return;
      }
      if (i >= keys.length) return;
      cur.push(keys[i]);
      rec(i + 1, cur);
      cur.pop();
      rec(i + 1, cur);
    };
    rec(0, []);
    return out;
  };
  let result: WeaveSolution | null = null;
  // memory nodes that some configuration can charge (latched upper bound, two passes)
  let latched = w.nodes.map(() => false);
  for (let pass = 0; pass < 2 && !result; pass++) {
    const echoOk = echoSlots > 0 && latched.some(Boolean);
    const holdN = Math.min(keys.length, LIVE_HOLDS + (echoOk ? echoSlots : 0));
    const holdSets = subsets(holdN);
    for (const cfg of ringCfgs) {
      cfg.forEach((a, i) => (w.rings[i].a = a));
      if (w.sockets.length && !w.sockets.every((k) => {
        const p = nodePos(w, k.node);
        return Math.hypot(p.x - k.x, p.y - k.y) < SOCKET_EPS;
      }))
        continue;
      // a motor-driven ring can only be away from its start angle if its rotator can be powered
      if (w.rings.some((r, i) => r.motor >= 0 && cfg[i] !== ringSaved[i] && !motorPowerable(w, r.motor, base))) continue;
      result = search(latched, holdSets, cfg);
      if (result) break;
    }
    if (!result) {
      const nl = w.nodes.map((n, i) => n.kind === 'memory' && (latched[i] || memoryPowerable(w, i, base)));
      if (nl.join() === latched.join()) break;
      latched = nl;
    }
  }
  w.rings.forEach((r, i) => (r.a = ringSaved[i]));
  return result;
}

function reachTarget(w: Weave, base: () => WeaveState, ok: (ev: WeaveEval) => boolean): boolean {
  const s0 = base();
  s0.held = w.nodes.map((n, i) => (n.kind === 'key' ? i : -1)).filter((i) => i >= 0).slice(0, LIVE_HOLDS);
  let layer: Thread[][] = [[]];
  const seen = new Set<string>();
  for (let d = 0; d <= 5; d++) {
    const next: Thread[][] = [];
    for (const set of layer) {
      s0.threads = set;
      const ev = evaluate(w, s0);
      if (ok(ev)) return true;
      const eras: Era[] = w.eras === 2 ? [1, 2] : [2];
      for (const era of eras) {
        const ei = era - 1;
        for (let a = 0; a < w.nodes.length; a++) {
          if (!ev.exists[ei][a] || ev.mask[ei][a] === 0 || OUT_CAP[w.nodes[a].kind] === 0) continue;
          for (let b = 0; b < w.nodes.length; b++) {
            if (!ev.exists[ei][b] || canWeave(w, s0, a, b, era) !== '') continue;
            const nt = set.concat([{ a, b, era }]);
            const k = nt.map((t) => t.era + ':' + t.a + '>' + t.b).sort().join(',');
            if (seen.has(k)) continue;
            seen.add(k);
            next.push(nt);
          }
        }
      }
    }
    layer = next;
  }
  return false;
}
const motorPowerable = (w: Weave, i: number, base: () => WeaveState): boolean => reachTarget(w, base, (ev) => ev.motorOn[i]);
const memoryPowerable = (w: Weave, i: number, base: () => WeaveState): boolean => reachTarget(w, base, (ev) => ev.memoryHit[i]);

// ------------------------------------------------------------------ memory echoes (pure recorder)
export interface EchoSample {
  t: number;
  x: number;
  y: number;
  down: boolean;
}
/** How long an echo keeps its final pose before the loop restarts (seconds). */
export const ECHO_SUSTAIN = 3;
export const ECHO_MAX = 6;
/**
 * A short recording of one pointer (board coordinates + pinch). It replays in a loop: the recorded motion, then
 * its final pose held for ECHO_SUSTAIN seconds. The echo holds a key whenever its replayed pinch is down on it.
 */
export class EchoTrack {
  samples: EchoSample[] = [];
  recording = false;
  private t0 = 0;
  start(time: number): void {
    this.samples.length = 0;
    this.recording = true;
    this.t0 = time;
  }
  /** returns false once the maximum length is reached (recording stops) */
  add(time: number, x: number, y: number, down: boolean): boolean {
    if (!this.recording) return false;
    const t = time - this.t0;
    if (t > ECHO_MAX) {
      this.recording = false;
      return false;
    }
    const last = this.samples[this.samples.length - 1];
    if (!last || t - last.t >= 1 / 30 || last.down !== down) this.samples.push({ t, x, y, down });
    return true;
  }
  stop(): void {
    this.recording = false;
  }
  get length(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].t : 0;
  }
  get loop(): number {
    return this.length + ECHO_SUSTAIN;
  }
  ready(): boolean {
    return !this.recording && this.samples.length > 0;
  }
  /** replayed pose at playback time (seconds since the echo began) */
  sample(time: number, out: EchoSample): EchoSample {
    const n = this.samples.length;
    if (!n) {
      out.t = 0;
      out.x = 0;
      out.y = 0;
      out.down = false;
      return out;
    }
    const tt = ((time % this.loop) + this.loop) % this.loop;
    let k = 0;
    while (k + 1 < n && this.samples[k + 1].t <= tt) k++;
    const a = this.samples[k];
    const b = this.samples[Math.min(n - 1, k + 1)];
    const f = b.t > a.t && tt < b.t ? (tt - a.t) / (b.t - a.t) : 0;
    out.t = tt;
    out.x = a.x + (b.x - a.x) * f;
    out.y = a.y + (b.y - a.y) * f;
    out.down = a.down;
    return out;
  }
}

/** The key node under a board point (or -1). */
export function keyAt(w: Weave, x: number, y: number, r = 0.05): number {
  let best = -1;
  let bd = r;
  w.nodes.forEach((n, i) => {
    if (n.kind !== 'key') return;
    const p = nodePos(w, i);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export { CYAN, GOLD, MAGENTA, WHITE };
