/**
 * Spellforge browser end-to-end check (Playwright + Chromium). Needs `npm run build && npx vite preview --port 4175`.
 * Logic is stepped with __sfStep (software GL runs at ~1 fps). Usage: node tests/spell-e2e.mjs [chromiumPath] [shotDir]
 */
import { chromium } from 'playwright-core';
const exe = process.argv[2] || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const shots = process.argv[3] || '';
const b = await chromium.launch({ executablePath: exe, args: ['--ignore-certificate-errors', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1000, height: 600 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && !m.text().includes('TUNNEL') && errors.push(m.text().slice(0, 240)));
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fail++;
};
const S = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__sf())));
const step = (n, dt = 1 / 30) => p.evaluate(([n, dt]) => window.__sfStep(n, dt), [n, dt]);
const shot = async (name) => { if (shots) await p.screenshot({ path: shots + '/' + name + '.png' }); };
await p.goto('https://127.0.0.1:4175/');
await p.waitForTimeout(15000);
await p.evaluate(() => { localStorage.removeItem('pw-spellforge-v1'); window.__setMode('spell'); });
await p.waitForTimeout(6000);
let s = await S();
check('opens on the title screen', s.screen === 'title' && s.mode === 'spell');
const labels = await p.evaluate(() => window.__sfLayout());
check('title buttons present', labels.length >= 6, JSON.stringify(labels));
await shot('01-title');
for (const [slot, scr] of [[3, 'library'], [4, 'bestiary'], [5, 'settings'], [6, 'credits'], [2, 'modes']]) {
  await p.evaluate((x) => window.__sfPress(x), slot);
  await step(2);
  s = await S();
  check('screen ' + scr, s.screen === scr, s.screen);
  if (scr === 'library') await shot('02-library');
  if (scr === 'modes') await shot('03-modes');
  // return to the title through a short training run + quit
  await p.evaluate(() => window.__sfStart('training'));
  await step(2);
  await p.evaluate(() => window.__sfPress(40));
  await step(1);
  await p.evaluate(() => window.__sfPress(3));
  await step(2);
}
// training run: a fire spell through the real gesture pipeline (desktop mouse stand-in)
await p.evaluate(() => window.__sfStart('training'));
await step(5);
s = await S();
check('training starts', s.screen === 'play' && s.run === 'training', JSON.stringify([s.screen, s.run]));
await p.evaluate(() => window.__sfInput({ l: true, x: 500, y: 250 }));
await step(160);
s = await S();
check('holding the mouse charges an orb', s.view && s.view.mode === 'orb' && s.view.charge > 0.2, JSON.stringify(s.view));
await shot('04-charging');
await p.evaluate(() => window.__sfInput({ l: false }));
await step(60);
s = await S();
check('releasing casts a Flame Orb', s.casts >= 1, 'casts ' + s.casts);
await step(120);
// every element signature spell via the same pipeline
const sigs = { fire: 'orb', ice: 'spear', lightning: 'arc', aether: 'beam', nature: 'vines', shadow: 'void' };
for (const el of Object.keys(sigs)) {
  await p.evaluate((el) => { window.__sfAttune('both', el); window.__sfCaster().energy = 100; }, el);
  const before = (await S()).casts;
  await p.evaluate(() => window.__sfInput({ l: true }));
  await step(el === 'nature' || el === 'shadow' ? 90 : 120);
  const mid = await S();
  await p.evaluate(() => window.__sfInput({ l: false }));
  await step(el === 'aether' ? 10 : 50);
  const after = await S();
  const okCharge = mid.view && mid.view.mode === sigs[el];
  check(el + ': charges (' + sigs[el] + ') and casts', okCharge && (el === 'aether' ? mid.counts.aether > 0 : after.casts > before), JSON.stringify([mid.view, before, after.casts]));
  if (el === 'ice') await shot('05-ice');
}
// shield
await p.evaluate(() => window.__sfInput({ shield: true }));
await step(40);
s = await S();
check('crossed wrists raise the shield', s.shield === true);
await shot('06-shield');
await p.evaluate(() => window.__sfInput({ shield: false }));
await step(20);
// fusion discovery
await p.evaluate(() => { window.__sfAttune('left', 'fire'); window.__sfAttune('right', 'ice'); window.__sfCaster().energy = 100; window.__sfInput({ l: true }); });
await step(150);
await p.evaluate(() => window.__sfInput({ l: false }));
await step(60);
s = await S();
check('a fusion is discovered and saved', s.discovered.includes('steam_explosion'), JSON.stringify(s.discovered));
await shot('07-fusion');
// campaign boss fights: run the simulation with a scripted caster
for (const id of ['ignar', 'vyra', 'voidking']) {
  await p.evaluate((id) => window.__sfStart('campaign', id), id);
  await step(10);
  s = await S();
  check(id + ': boss spawned', s.boss && s.boss.id === id);
  await shot('08-' + id);
  // drive the boss through all phases with direct damage, stepping the real simulation inside the page
  const r = await p.evaluate((id) => {
    const b = window.__sfBattle();
    const phases = [];
    for (let i = 0; i < 900; i++) {
      if (!b.boss || b.over !== 'none') break;
      b.boss.trans = 0;
      b.boss.armorHp = 0;
      b.player.hp = b.player.maxHp;
      const last = b.boss.phase === b.boss.def.phases.length - 1;
      if (!last || !b.boss.def.phases[b.boss.phase].finisher) b.boss.hp = Math.max(b.boss.hp - b.boss.maxHp * 0.012, last ? 1 : 1);
      window.__sfStep(3);
      if (!phases.includes(b.boss.phase)) phases.push(b.boss.phase);
      if (last && b.boss.hp <= 1) break;
    }
    return { phases, max: b.boss.def.phases.length };
  }, id);
  check(id + ': phases advance through the whole fight', r.phases.length === r.max, JSON.stringify(r));
}
// endless
await p.evaluate(() => window.__sfStart('endless'));
await step(300);
s = await S();
check('endless spawns a wave', s.wave >= 1 && s.enemies >= 1, JSON.stringify([s.wave, s.enemies]));
await shot('09-endless');
// trials & sandbox & tutorial start
for (const id of ['embers', 'storm', 'mixing', 'sentinels']) {
  await p.evaluate((id) => window.__sfStart('trial', id), id);
  await step(30);
  s = await S();
  check('trial ' + id + ' runs', s.screen === 'play' && s.run === 'trial');
}
await p.evaluate(() => window.__sfStart('sandbox'));
await p.evaluate(() => { window.__sfPress(42); window.__sfPress(42); });
await step(60);
s = await S();
check('sandbox spawns enemies', s.enemies >= 2, String(s.enemies));
await p.evaluate(() => window.__sfStart('tutorial'));
await step(90);
s = await S();
check('tutorial progresses', s.tut >= 1, String(s.tut));
// leaving restores the workshop
await p.evaluate(() => window.__setMode('menu'));
await p.waitForTimeout(3000);
check('no console or page errors', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
console.log(fail ? 'E2E FAIL ' + fail : 'E2E OK');
await b.close();
process.exit(fail ? 1 : 0);
