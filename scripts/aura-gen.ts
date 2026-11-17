import { Level, Elem, Kind, trace, solve, stepsOf, WHITE, CYAN, MAGENTA, GOLD } from '../src/auralogic';
let seed = Number(process.argv[2] || 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const mk = (kind: Kind, x: number, y: number): Elem => ({ kind, x, y, a: 0, rot: kind !== 'filter' && kind !== 'wall', len: 0.075, mask: 0 });
function gen(name: string, srcs: Level['sources'], kinds: Kind[], nT: number, maxSol: number): Level | null {
  for (let tries = 0; tries < 4000; tries++) {
    const xs = [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3];
    const ys = [-0.24, -0.12, 0, 0.12, 0.24];
    const used: [number, number][] = [];
    const elems: Elem[] = [];
    let okp = true;
    for (const k of kinds) {
      let placed = false;
      for (let i = 0; i < 30 && !placed; i++) {
        const x = pick(xs), y = pick(ys);
        if (used.some(([ux, uy]) => Math.hypot(ux - x, uy - y) < 0.17)) continue;
        if (srcs.some((s) => Math.abs(s.y - y) < 0.01 && x < -0.2 && k !== 'prism')) {/* allow */}
        used.push([x, y]);
        elems.push(mk(k, x, y));
        placed = true;
      }
      if (!placed) okp = false;
    }
    if (!okp) continue;
    const lv: Level = { name, chapter: '', goal: '', hint: '', sources: srcs, elems, targets: [] };
    const rots = elems.filter((e) => e.rot);
    for (const e of rots) e.a = Math.floor(rnd() * stepsOf(e));
    const t0 = trace(lv);
    // candidate target points: ends of beams that reach the board edge
    const ends = t0.segs.filter((s) => Math.abs(Math.abs(s.x2) - 0.54) < 1e-3 || Math.abs(Math.abs(s.y2) - 0.33) < 1e-3).filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.12);
    if (ends.length < nT) continue;
    const pts: { x: number; y: number }[] = [];
    for (const s of ends) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, d = Math.hypot(dx, dy);
      const x = s.x2 - (dx / d) * 0.04, y = s.y2 - (dy / d) * 0.04;
      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.3) continue;
      if (pts.some((p) => Math.hypot(p.x - x, p.y - y) < 0.2)) continue;
      pts.push({ x, y });
    }
    if (pts.length < nT) continue;
    const chosen = pts.slice(0, nT);
    lv.targets = chosen.map((p) => ({ x: p.x, y: p.y, mask: 0, r: 0.05 }));
    const t1 = trace(lv, false);
    lv.targets.forEach((g, i) => (g.mask = t1.got[i]));
    if (lv.targets.some((g) => g.mask === 0)) continue;
    const solAngles = rots.map((e) => e.a);
    if (!trace(lv, false).solved) continue;
    // every rotatable must matter and target colours should vary
    const sols = solve(lv, 40);
    if (sols.length < 1 || sols.length > maxSol) continue;
    if (new Set(lv.targets.map((g) => g.mask)).size < Math.min(nT, 2)) continue;
    // scramble start: all rotatables off the solution
    rots.forEach((e, i) => { do e.a = Math.floor(rnd() * stepsOf(e)); while (e.a === solAngles[i]); });
    if (trace(lv, false).solved) continue;
    return lv;
  }
  return null;
}
const which = process.argv[3];
const lv = which === '6'
  ? gen('Resonance', [{ x: -0.5, y: 0, ang: 0, mask: WHITE }], ['splitter', 'prism', 'mirror', 'mirror'], 3, 4)
  : gen('Eternal bloom', [{ x: -0.5, y: 0.2, ang: 0, mask: CYAN | MAGENTA }, { x: -0.5, y: -0.2, ang: 0, mask: GOLD | MAGENTA }], ['prism', 'mirror', 'mirror', 'splitter', 'mirror'], 3, 6);
console.log(JSON.stringify(lv));
