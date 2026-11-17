import { makeLevels, solve, trace, angleOf } from '../src/auralogic';
let bad = 0;
makeLevels().forEach((lv, i) => {
  const start = trace(lv, false);
  const sols = solve(lv, 200);
  const rots = lv.elems.filter((e) => e.rot).length;
  console.log(`L${i + 1} ${lv.name}: rotatables=${rots} startSolved=${start.solved} solutions=${sols.length}`, sols.slice(0, 3).map((s) => s.join(',')).join(' | '));
  if (start.solved || sols.length === 0) bad++;
});
console.log(bad ? 'FAIL ' + bad : 'ALL LEVELS SOLVABLE AND START UNSOLVED');
process.exit(bad ? 1 : 0);
