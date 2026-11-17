import { makeLevels, trace } from '../src/auralogic';
const lv = makeLevels()[4];
const ang = process.argv.slice(2).map(Number);
lv.elems.filter((e) => e.rot).forEach((e, i) => (e.a = ang[i]));
const t = trace(lv);
t.segs.forEach((s) => console.log(s.mask, s.x1.toFixed(2), s.y1.toFixed(2), '->', s.x2.toFixed(2), s.y2.toFixed(2)));
console.log(t.got, t.ok);
