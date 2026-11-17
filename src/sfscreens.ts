/**
 * SPELLFORGE screen art: canvas drawing for the menu card, the spell library, the bestiary and the HUD panels.
 * Pure drawing helpers: no game state lives here.
 */
import type { TextPanel } from './panel';
import { FONT } from './panel';
import type { SpellDef } from './sfdata';
import { ADVANCED_SPELLS, BASE_SPELLS, BOSSES, BOSS_ORDER, ELEMENTS, ELEMENT_CSS, ELEMENT_NAME, ENEMIES, FUSIONS } from './sfdata';
import type { Element } from './sfdata';

export const CARD_W = 1.5;
export const CARD_H = 1.14;
export const CARD_PX = 1280;
export const LETTER: Record<Element, string> = { fire: 'F', ice: 'I', lightning: 'L', aether: 'A', nature: 'N', shadow: 'S' };

export function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** the shared dark-glass card with an arcane frame */
export function drawCard(p: TextPanel, accent = '#b48cff'): void {
  const c = p.ctx;
  const w = p.w;
  const h = p.h;
  c.clearRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(18,10,40,0.94)');
  g.addColorStop(1, 'rgba(6,4,18,0.96)');
  c.fillStyle = g;
  rr(c, 6, 6, w - 12, h - 12, 34);
  c.fill();
  c.save();
  c.shadowColor = accent;
  c.shadowBlur = 24;
  c.strokeStyle = accent;
  c.lineWidth = 4;
  rr(c, 8, 8, w - 16, h - 16, 32);
  c.stroke();
  c.restore();
  c.strokeStyle = accent + '66';
  c.lineWidth = 1.5;
  rr(c, 22, 22, w - 44, h - 44, 24);
  c.stroke();
  // corner ornaments
  c.fillStyle = accent;
  for (const [x, y] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) {
    c.beginPath();
    c.moveTo(x, y - 9);
    c.lineTo(x + 9, y);
    c.lineTo(x, y + 9);
    c.lineTo(x - 9, y);
    c.closePath();
    c.fill();
  }
}
export function line(p: TextPanel, s: string, y: number, size: number, color: string, x = p.w / 2, align: CanvasTextAlign = 'center', weight = 700): void {
  const c = p.ctx;
  c.fillStyle = color;
  c.textAlign = align;
  c.font = weight + ' ' + size + 'px ' + FONT;
  const maxW = align === 'center' ? p.w - 120 : p.w - x - 50;
  const m = c.measureText(s).width;
  if (m > maxW) c.font = weight + ' ' + Math.floor((size * maxW) / m) + 'px ' + FONT;
  c.fillText(s, x, y);
}
/** word-wrapped paragraph; returns the y after the last line */
export function para(p: TextPanel, s: string, x: number, y: number, maxW: number, size: number, color: string, lh = 1.28, align: CanvasTextAlign = 'left'): number {
  const c = p.ctx;
  c.font = '600 ' + size + 'px ' + FONT;
  c.fillStyle = color;
  c.textAlign = align;
  const words = s.split(' ');
  let cur = '';
  let yy = y;
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > maxW && cur) {
      c.fillText(cur, x, yy);
      yy += size * lh;
      cur = w;
    } else cur = t;
  }
  if (cur) {
    c.fillText(cur, x, yy);
    yy += size * lh;
  }
  return yy;
}
export function pill(p: TextPanel, x: number, y: number, w: number, h: number, fill: string, stroke: string): void {
  const c = p.ctx;
  c.fillStyle = fill;
  rr(c, x, y, w, h, h / 2);
  c.fill();
  c.strokeStyle = stroke;
  c.lineWidth = 2.5;
  rr(c, x, y, w, h, h / 2);
  c.stroke();
}
export function elementDot(p: TextPanel, x: number, y: number, r: number, e: Element, letter = false): void {
  const c = p.ctx;
  c.save();
  c.shadowColor = ELEMENT_CSS[e];
  c.shadowBlur = 12;
  c.fillStyle = ELEMENT_CSS[e];
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
  if (letter) {
    c.fillStyle = '#10081c';
    c.textAlign = 'center';
    c.font = '800 ' + Math.round(r * 1.25) + 'px ' + FONT;
    c.fillText(LETTER[e], x, y + r * 0.42);
  }
}

// ---------------------------------------------------------------- buttons
export function drawButton(p: TextPanel, label: string, sub: string, accent: string, hot: boolean, disabled: boolean, xs = 1): void {
  const c = p.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, p.w, p.h);
  // a stretched (wide) button is drawn in a squeezed coordinate space so text keeps its proportions
  c.scale(1 / xs, 1);
  const w = p.w * xs;
  const h = p.h;
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, hot ? accent + 'cc' : 'rgba(40,26,80,0.92)');
  g.addColorStop(1, hot ? accent + '88' : 'rgba(20,12,48,0.92)');
  c.fillStyle = g;
  rr(c, 4, 4, w - 8, h - 8, h / 2 - 4);
  c.fill();
  c.save();
  c.shadowColor = accent;
  c.shadowBlur = hot ? 18 : 8;
  c.strokeStyle = disabled ? '#5a5070' : accent;
  c.lineWidth = hot ? 5 : 3;
  rr(c, 4, 4, w - 8, h - 8, h / 2 - 4);
  c.stroke();
  c.restore();
  const col = disabled ? '#7a7090' : hot ? '#0c0618' : '#f2e8ff';
  if (sub) {
    line(p, label, h * 0.46, h * 0.38, col, w / 2);
    line(p, sub, h * 0.82, h * 0.25, disabled ? '#6a6080' : hot ? '#201030' : '#c9b8ee', w / 2, 'center', 600);
  } else line(p, label, h * 0.66, h * 0.44, col, w / 2);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------------------------------------------------------------- title
export function drawTitleArt(p: TextPanel, top: number): void {
  line(p, 'SPELLFORGE', top + 70, 112, '#f4eaff');
  const c = p.ctx;
  const g = c.createLinearGradient(p.w / 2 - 300, 0, p.w / 2 + 300, 0);
  g.addColorStop(0, 'rgba(180,140,255,0)');
  g.addColorStop(0.5, 'rgba(210,170,255,1)');
  g.addColorStop(1, 'rgba(180,140,255,0)');
  c.fillStyle = g;
  c.fillRect(p.w / 2 - 300, top + 92, 600, 4);
  line(p, 'THE  ARCANE  AWAKENING', top + 138, 40, '#c9a8ff');
  // six element gems
  const xs = ELEMENTS.map((_, i) => p.w / 2 + (i - 2.5) * 110);
  ELEMENTS.forEach((e, i) => elementDot(p, xs[i], top + 190, 24, e, true));
}

// ---------------------------------------------------------------- spell library
export const LIB_PER_PAGE = 5;
export interface LibEntry {
  spell: SpellDef;
  unlocked: boolean;
  discovered: boolean;
  masteryHint?: string;
}
export function libraryEntries(discovered: Set<string>, counts: Record<Element, number>, advAt: number): LibEntry[] {
  const out: LibEntry[] = [];
  for (const e of ELEMENTS) out.push({ spell: BASE_SPELLS[e], unlocked: true, discovered: true });
  for (const e of ELEMENTS) {
    const ok = counts[e] >= advAt;
    out.push({ spell: ADVANCED_SPELLS[e], unlocked: ok, discovered: ok, masteryHint: ok ? '' : 'Cast ' + ELEMENT_NAME[e] + ' ' + (advAt - counts[e]) + ' more times' });
  }
  for (const f of FUSIONS) out.push({ spell: f, unlocked: true, discovered: discovered.has(f.id) });
  return out;
}
export const libraryPages = (n: number): number => Math.ceil(n / LIB_PER_PAGE);

export function drawLibrary(p: TextPanel, top: number, page: number, entries: LibEntry[], colourCues: boolean): void {
  const total = libraryPages(entries.length);
  line(p, 'SPELL LIBRARY', top + 44, 56, '#f4eaff');
  const disc = entries.filter((e) => e.spell.tier === 'fusion' && e.discovered).length;
  line(p, 'Page ' + (page + 1) + ' / ' + total + '   -   Fusions discovered ' + disc + ' / ' + FUSIONS.length, top + 84, 28, '#b8a4e0', p.w / 2, 'center', 600);
  const list = entries.slice(page * LIB_PER_PAGE, page * LIB_PER_PAGE + LIB_PER_PAGE);
  const rowH = 118;
  const c = p.ctx;
  list.forEach((en, i) => {
    const y = top + 110 + i * rowH;
    const sp = en.spell;
    const x0 = 56;
    c.fillStyle = 'rgba(40,24,84,0.55)';
    rr(c, x0, y, p.w - 112, rowH - 10, 20);
    c.fill();
    const els = sp.elements;
    if (en.discovered) {
      els.forEach((e, k) => elementDot(p, x0 + 46 + k * 52, y + (rowH - 10) / 2, 22, e, colourCues));
      line(p, sp.name, y + 38, 36, '#fbf4ff', x0 + 46 + els.length * 52 + 12, 'left');
      const tier = sp.tier === 'base' ? 'Base spell' : sp.tier === 'advanced' ? 'Advanced - overcharge' : 'Fusion';
      line(p, tier + '   ' + '*'.repeat(sp.difficulty) + '.'.repeat(5 - sp.difficulty), y + 38, 22, '#a894d6', p.w - 70, 'right', 600);
      para(p, sp.gesture, x0 + 46 + els.length * 52 + 12, y + 70, p.w - x0 - 46 - els.length * 52 - 150, 23, '#d9ccf2', 1.18);
    } else if (sp.tier === 'fusion') {
      els.forEach((e, k) => elementDot(p, x0 + 46 + k * 52, y + (rowH - 10) / 2, 22, e, colourCues));
      line(p, '? ? ? ? ?', y + 40, 36, '#8a7ab0', x0 + 46 + els.length * 52 + 12, 'left');
      para(p, 'Attune your two hands to ' + ELEMENT_NAME[els[0]] + ' and ' + ELEMENT_NAME[els[1]] + ', bring your palms together and push. What happens is up to you.', x0 + 46 + els.length * 52 + 12, y + 72, p.w - x0 - 46 - els.length * 52 - 150, 22, '#8f82b8', 1.18);
    } else {
      els.forEach((e, k) => elementDot(p, x0 + 46 + k * 52, y + (rowH - 10) / 2, 22, e, colourCues));
      line(p, sp.name + '  (locked)', y + 40, 34, '#8a7ab0', x0 + 46 + els.length * 52 + 12, 'left');
      para(p, en.masteryHint ?? '', x0 + 46 + els.length * 52 + 12, y + 74, p.w - x0 - 200, 24, '#8f82b8', 1.18);
    }
  });
}

// ---------------------------------------------------------------- bestiary
export function bestiaryEntries(): { name: string; sub: string; weak: string; hint: string; css: string; boss: boolean }[] {
  const out: { name: string; sub: string; weak: string; hint: string; css: string; boss: boolean }[] = [];
  const hints: Record<string, string> = {
    voidling: 'Drifts close and lunges after a visible wind-up. Block the lunge or burn it first.',
    ember_beast: 'Charges on four legs. Fire barely scratches it, Ice shatters it.',
    frost_wraith: 'Hovers back and hurls frost shards. Fire melts it. Shoot the shards down.',
    storm_stalker: 'Dashes in fast. Nature grounds the lightning; a shield stops the dash.',
    root_colossus: 'Slow and armoured. Fire breaks the bark, Nature does almost nothing.',
    shadow_reaper: 'Teleports behind you. Aether and Lightning cut through its shadow.',
    arcane_sentinel: 'Floats and fires arcane bolts. Its shell only breaks to Lightning or Shadow.',
  };
  for (const id of Object.keys(ENEMIES)) {
    const e = ENEMIES[id];
    out.push({ name: e.name, sub: 'Enemy  -  ' + ELEMENT_NAME[e.element], weak: e.weak, hint: hints[id] ?? '', css: ELEMENT_CSS[e.element], boss: false });
  }
  for (const id of BOSS_ORDER) {
    const b = BOSSES[id];
    out.push({ name: b.name + ' - ' + b.title, sub: 'Boss  -  ' + b.realm + '  -  ' + b.phases.length + ' phases', weak: b.phases.map((ph) => ph.name).join(' > '), hint: b.intro, css: ELEMENT_CSS[b.element], boss: true });
  }
  return out;
}
export const BEST_PER_PAGE = 5;
export function drawBestiary(p: TextPanel, top: number, page: number): void {
  const all = bestiaryEntries();
  const pages = Math.ceil(all.length / BEST_PER_PAGE);
  line(p, 'BESTIARY', top + 44, 56, '#f4eaff');
  line(p, 'Page ' + (page + 1) + ' / ' + pages, top + 84, 28, '#b8a4e0', p.w / 2, 'center', 600);
  const c = p.ctx;
  all.slice(page * BEST_PER_PAGE, page * BEST_PER_PAGE + BEST_PER_PAGE).forEach((en, i) => {
    const y = top + 110 + i * 118;
    c.fillStyle = 'rgba(40,24,84,0.55)';
    rr(c, 56, y, p.w - 112, 108, 20);
    c.fill();
    c.fillStyle = en.css;
    c.fillRect(56, y + 18, 8, 72);
    line(p, en.name, y + 36, 33, '#fbf4ff', 90, 'left');
    line(p, en.sub, y + 36, 21, '#a894d6', p.w - 70, 'right', 600);
    para(p, en.hint, 90, y + 64, p.w - 200, 22, '#d9ccf2', 1.15);
    line(p, (en.boss ? 'Phases: ' : 'Weak to: ') + en.weak, y + 98, 20, '#ffd98c', 90, 'left', 600);
  });
}

export const CREDITS = [
  'SPELLFORGE: THE ARCANE AWAKENING',
  'A hands-only WebXR spell-casting arena. Part of Pocket Workshop.',
  'Made by Anvia Labs with Claude (Anthropic).',
  'Built on IWSDK and Three.js. All visuals and audio are generated procedurally; no external assets.',
  'Hand poses are read from WebXR hand tracking. Desktop uses mouse and keyboard stand-ins.',
];
