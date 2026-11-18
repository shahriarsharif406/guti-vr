/**
 * GearShift bench logic tests: every level is solvable by its intended placement, is not solved by an empty bench,
 * and fits inside the board field with the (bigger) gears. Rendering and audio are NOT covered here. Run: npm run test:gear
 */
import assert from 'node:assert/strict';
import { FIELD, LEVELS, evaluate, outerRadius } from '../src/gearlogic';

let passed = 0;
let failed = 0;
const test = (name: string, fn: () => void): void => {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '  ' + (e as Error).message);
  }
};

LEVELS.forEach((lv, i) => {
  test('level ' + (i + 1) + ' (' + lv.name + '): intended solution wins', () => {
    assert.equal(evaluate(lv, lv.solution).win, true);
  });
  test('level ' + (i + 1) + ': empty bench does not win', () => {
    assert.equal(evaluate(lv, lv.solution.map(() => -1)).win, false);
  });
  test('level ' + (i + 1) + ': gears fit inside the board field', () => {
    const ns = new Map<number, number>([[lv.motor.peg, lv.motor.n], [lv.target.peg, lv.target.n]]);
    lv.solution.forEach((it, peg) => {
      if (it >= 0) for (const p of lv.inventory[it].parts) ns.set(peg, Math.max(ns.get(peg) ?? 0, p.n));
    });
    lv.pegs.forEach((pg, k) => {
      const r = outerRadius(ns.get(k) ?? 10);
      assert.ok(pg.x - r >= -FIELD.x - 0.001 && pg.x + r <= FIELD.x + 0.001, 'x overflow at peg ' + k + ': ' + (pg.x - r).toFixed(3) + '..' + (pg.x + r).toFixed(3));
      assert.ok(pg.y - r >= FIELD.yMin - 0.02 && pg.y + r <= FIELD.yMax + 0.02, 'y overflow at peg ' + k);
    });
  });
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
