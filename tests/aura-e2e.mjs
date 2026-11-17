/**
 * Aura Weaver browser end-to-end check (Playwright + Chromium). Needs `npm run build && npx vite preview --port 4175`.
 * Software-rendered CI runs at ~1 fps, so waits are long. Usage: node tests/aura-e2e.mjs [chromiumPath]
 */
import { chromium } from 'playwright-core';
const exe = process.argv[2] || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: exe, args: ['--ignore-certificate-errors', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 520 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && !m.text().includes('TUNNEL') && errors.push(m.text().slice(0, 200)));
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fail++;
};
const A = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__aura())));
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(1500);
  }
  return false;
};
await p.goto('https://127.0.0.1:4175/');
await p.waitForTimeout(15000);
await p.evaluate(() => window.__setMode('aura'));
await p.waitForTimeout(6000);
await p.evaluate(() => window.__auraWipe());
let s = await A();
check('opens on title screen', s.screen === 'title');
await p.evaluate(() => window.__auraPress(4));
await p.waitForTimeout(2000);
s = await A();
check('START enters the game', s.screen === 'game');
// pause / settings / mute
await p.evaluate(() => window.__auraPress(3));
await p.waitForTimeout(1500);
check('pause opens', (await A()).paused === true);
await p.evaluate(() => window.__auraPress(7)); // MUTE
s = await A();
check('mute toggles', s.settings.muted === true);
await p.evaluate(() => window.__auraPress(7));
await p.evaluate(() => window.__auraPress(5)); // MUSIC cycle
check('music volume cycles', (await A()).settings.music !== 1);
await p.evaluate(() => window.__auraPress(15));
check('resume closes pause', (await A()).paused === false);
// resource stability across repeated level loads
for (let k = 0; k < 7; k++) await p.evaluate((k) => window.__auraLevel(k), k); // warm-up: first use uploads each geometry once
await p.waitForTimeout(3000);
const i0 = await p.evaluate(() => window.__auraInfo());
for (let k = 0; k < 20; k++) await p.evaluate((k) => window.__auraLevel(k % 7), k);
await p.waitForTimeout(2000);
const i1 = await p.evaluate(() => window.__auraInfo());
check('no geometry/texture growth over 20 level loads', i1.geometries <= i0.geometries + 4 && i1.textures <= i0.textures + 4, JSON.stringify([i0, i1]));
// play every level via the solver
for (let l = 0; l < 7; l++) {
  await p.evaluate((i) => window.__auraLevel(i), l);
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__auraSolve());
  const ok = await until(async () => (await A()).saved[l] === true, 120000);
  s = await A();
  check('level ' + (l + 1) + ' completes, gates awake and saves', ok && s.awake.some(Boolean));
}
const fin = await until(async () => (await A()).finaleT > 1, 90000);
check('finale sequence runs after the last level', fin);
await p.screenshot({ path: 'aura-e2e-final.png' });
// save survives reload
await p.reload();
await p.waitForTimeout(15000);
await p.evaluate(() => window.__setMode('aura'));
await p.waitForTimeout(6000);
s = await A();
check('progress survives reload', s.saved.filter(Boolean).length === 7, JSON.stringify(s.saved));
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fail ? 'E2E FAIL ' + fail : 'E2E PASS');
await b.close();
process.exit(fail ? 1 : 0);
