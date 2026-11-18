/**
 * Aura Weaver browser end-to-end check (Playwright + Chromium). Needs `npm run build && npx vite preview --port 4175`.
 * Software-rendered CI runs at ~1 fps, so real input waits between steps and the simulation is advanced with the
 * fixed-step hook window.__auraStep(n) instead of waiting on wall-clock time.
 * Covers: menu and chapter entry, a thread woven and cut with REAL mouse input on the loom (pmndrs pointer events on
 * the RayInteractable board plane), ERA and HINT buttons, every one of the 15 puzzles solved and saved (save v2),
 * resource stability, finale, reload persistence. Usage: node tests/aura-e2e.mjs [chromiumPath]
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
const T = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__auraThread())));
const step = (n) => p.evaluate((n) => window.__auraStep(n), n);
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(1500);
  }
  return false;
};
/** real mouse drag from one board node to another, slow enough for a ~1 fps renderer */
const drag = async (a, z) => {
  const [x0, y0] = await p.evaluate((i) => window.__auraNodeScreen(i), a);
  const [x1, y1] = await p.evaluate((i) => window.__auraNodeScreen(i), z);
  await p.mouse.move(x0, y0);
  await p.waitForTimeout(1500);
  await p.mouse.down();
  await p.waitForTimeout(2500);
  for (let k = 1; k <= 4; k++) {
    await p.mouse.move(x0 + ((x1 - x0) * k) / 4, y0 + ((y1 - y0) * k) / 4);
    await p.waitForTimeout(1500);
  }
  await p.mouse.up();
  await p.waitForTimeout(2500);
};

await p.goto('https://127.0.0.1:4175/');
await p.waitForTimeout(15000);
await p.evaluate(() => window.__setMode('aura'));
await p.waitForTimeout(6000);
await p.evaluate(() => window.__auraWipe());
let s = await A();
check('opens on title screen with the full 15-puzzle journey', s.screen === 'title' && s.count === 15, 'count=' + s.count);
// enter the thread puzzles from the chapter (level) menu
await p.evaluate(() => window.__auraPress(5)); // CHAPTERS
await p.waitForTimeout(1500);
check('chapter menu opens', (await A()).screen === 'chapters');
await p.evaluate(() => window.__auraPress(4)); // chapter 1
await p.waitForTimeout(3000);
s = await A();
let t = await T();
check('chapter 1 enters the first thread puzzle', s.screen === 'game' && s.puzzle === 'first-thread' && t !== null, s.puzzle);
check('loom accepts pointer rays during a thread puzzle', t && t.board === 'auto', t && t.board);

// ---- real input: weave a thread with the mouse, cut it with a tap, weave it again
await drag(0, 1);
t = await T();
s = await A();
check('mouse drag weaves a thread crystal-to-crystal', t.threads.length === 1 && t.receivers === 1, JSON.stringify(t.threads));
check('connect event reached the save stats (audio/haptic path ran)', s.stats.threads >= 1 && s.stats.connections >= 1, JSON.stringify(s.stats));
{
  const [ax, ay] = await p.evaluate(() => window.__auraNodeScreen(0));
  const [bx, by] = await p.evaluate(() => window.__auraNodeScreen(1));
  await p.mouse.move((ax + bx) / 2, (ay + by) / 2);
  await p.waitForTimeout(1500);
  await p.mouse.down();
  await p.waitForTimeout(1200);
  await p.mouse.up();
  await p.waitForTimeout(2500);
}
t = await T();
check('tapping the thread cuts it', t.threads.length === 0 && !t.solved, JSON.stringify(t.threads));
await drag(0, 1);
t = await T();
check('re-woven with the mouse', t.solved === true);
await step(40);
s = await A();
check('solving saves progress and unlocks the next puzzle', s.saved[0] === true && s.unlocked >= 1 && s.time[0] > 0, JSON.stringify([s.saved[0], s.unlocked, s.time[0]]));

// refused thread: drop in empty space gives feedback and weaves nothing
await p.evaluate(() => window.__auraLevel(1));
await p.waitForTimeout(2000);
{
  const [x0, y0] = await p.evaluate(() => window.__auraNodeScreen(0));
  await p.mouse.move(x0, y0);
  await p.waitForTimeout(1500);
  await p.mouse.down();
  await p.waitForTimeout(2500);
  await p.mouse.move(x0 + 60, y0 - 90);
  await p.waitForTimeout(1500);
  await p.mouse.move(x0 + 120, y0 - 160);
  await p.waitForTimeout(1500);
  await p.mouse.up();
  await p.waitForTimeout(2500);
}
s = await A();
t = await T();
check('dropping a thread in empty space is refused with a message', t.threads.length === 0 && s.msg.length > 0, s.msg);

// pause / settings / mute
await p.evaluate(() => window.__auraPress(3));
await p.waitForTimeout(1500);
s = await A();
t = await T();
check('pause opens and the loom stops taking rays', s.paused === true && t.board === 'none', t.board);
await p.evaluate(() => window.__auraPress(7)); // MUTE
check('mute toggles', (await A()).settings.muted === true);
await p.evaluate(() => window.__auraPress(7));
await p.evaluate(() => window.__auraPress(5)); // MUSIC cycle
check('music volume cycles', (await A()).settings.music !== 1);
await p.evaluate(() => window.__auraPress(15));
check('resume closes pause', (await A()).paused === false);

// resource stability across repeated puzzle loads (thread pool is reused)
for (let k = 0; k < 15; k++) await p.evaluate((k) => window.__auraLevel(k), k); // warm-up
await p.waitForTimeout(3000);
const i0 = await p.evaluate(() => window.__auraInfo());
for (let k = 0; k < 30; k++) await p.evaluate((k) => window.__auraLevel(k % 15), k);
await p.waitForTimeout(2000);
const i1 = await p.evaluate(() => window.__auraInfo());
check('no geometry/texture growth over 30 puzzle loads', i1.geometries <= i0.geometries + 4 && i1.textures <= i0.textures + 4, JSON.stringify([i0, i1]));

// ERA and HINT buttons on the time-weaving puzzle
const ids = await p.evaluate(() => {
  const out = [];
  for (let i = 0; i < 15; i++) {
    window.__auraLevel(i);
    out.push(window.__aura().puzzle);
  }
  return out;
});
const two = ids.indexOf('two-eras');
await p.evaluate((i) => window.__auraLevel(i), two);
await p.waitForTimeout(1500);
const e0 = (await T()).era;
await p.evaluate(() => window.__auraPress(16)); // ERA
await p.waitForTimeout(1000);
const e1 = (await T()).era;
check('ERA button switches past/present', e0 !== e1, e0 + '->' + e1);
await p.evaluate(() => window.__auraPress(17)); // HINT
s = await A();
check('HINT button gives a step and is counted', s.msg.startsWith('Hint') || s.msg.startsWith('Nothing'), s.msg);

// every puzzle of the journey: light half via the light solver, thread half via the hint-following assist
for (let l = 0; l < 15; l++) {
  await p.evaluate((i) => window.__auraLevel(i), l);
  await p.waitForTimeout(600);
  await p.evaluate(() => window.__auraSolve());
  await step(40);
  await p.evaluate(() => window.__auraWeave());
  await step(40);
  const ok = await until(async () => (await A()).saved[l] === true, 60000);
  check('puzzle ' + (l + 1) + ' (' + ids[l] + ') completes and saves', ok);
}
await step(30);
const fin = await until(async () => (await A()).finaleT > 1, 90000);
check('finale sequence runs after the last puzzle', fin);
await p.screenshot({ path: 'aura-e2e-final.png' });
// save survives reload
await p.reload();
await p.waitForTimeout(15000);
await p.evaluate(() => window.__setMode('aura'));
await p.waitForTimeout(6000);
s = await A();
check('progress survives reload (save v2, 15 slots)', s.saved.length === 15 && s.saved.filter(Boolean).length === 15, JSON.stringify(s.saved));
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fail ? 'E2E FAIL ' + fail : 'E2E PASS');
await b.close();
process.exit(fail ? 1 : 0);
