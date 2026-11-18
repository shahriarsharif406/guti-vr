/**
 * GearShift: Neon Overdrive browser check (Playwright + Chromium). Needs `npm run build && npx vite preview --port 4175`.
 * Software rendering is ~1 fps, so the race is advanced with the fixed-step __raceStep hook (auto-driver shifts at the ideal rpm).
 * Usage: node tests/gearshift-e2e.mjs [chromiumPath] [screenshotDir]
 */
import { chromium } from 'playwright-core';
const exe = process.argv[2] || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const shots = process.argv[3] || '';
const b = await chromium.launch({ executablePath: exe, args: ['--ignore-certificate-errors', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1000, height: 560 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fail++;
};
const R = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__race())));
const shot = async (n) => shots && (await p.screenshot({ path: shots + '/' + n + '.png' }));
await p.goto('https://127.0.0.1:4175/');
await p.waitForTimeout(15000);
await p.evaluate(() => window.__setMode('gears'));
await p.waitForTimeout(5000);
let s = await R();
check('bench is the default stage', s.stage === 'bench' && !s.active);
await p.evaluate(() => window.__raceOpen());
await p.waitForTimeout(4000);
s = await R();
check('racer menu opens', s.active && s.screen === 'menu' && s.stage === 'pick');
await shot('menu');
await p.evaluate(() => window.__raceStart(0));
await p.waitForTimeout(2500);
s = await R();
check('quick race starts (intro phase)', s.screen === 'race' && ['intro', 'countdown'].includes(s.phase));
await p.evaluate(() => window.__raceStep(7, 0));
s = await R();
check('countdown ends and race runs', s.phase === 'race');
await p.evaluate(() => window.__raceStep(9, 1));
s = await R();
check('auto-driver shifts through gears and gains speed', s.kmh > 120 && s.gear >= 2 && s.shifts >= 2, 'kmh ' + Math.round(s.kmh) + ' gear ' + s.gear);
check('shift scoring accumulates', s.score > 0 && s.counts.perfect + s.counts.excellent + s.counts.good > 0, 'score ' + Math.round(s.score));
await p.waitForTimeout(1500);
await shot('race');
await p.evaluate(() => window.__raceStep(120, 1));
s = await R();
check('race finishes with a result and grade', s.screen === 'results' && !!s.result && s.result.finished, s.result ? s.result.grade + ' ' + s.result.score : '');
await shot('results');
await p.evaluate(() => window.__racePress(20));
s = await R();
check('retry restarts', s.screen === 'race');
await p.evaluate(() => window.__racePress(16));
s = await R();
check('exit returns to the bench', !s.active && s.stage === 'bench');
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fail ? fail + ' FAILED' : 'all passed');
process.exit(fail ? 1 : 0);
