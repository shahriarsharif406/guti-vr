import {
  Entity,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  RayInteractable,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { modeState, setMode } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { MenuButton, MenuTargets } from './ui-components.js';

const TABLE_Y = 0.72;
const TABLE_CENTER_Z = -0.55;

interface Btn {
  entity: Entity;
  panel: TextPanel;
  mesh: Mesh;
  home: number;
}

const SERIF = 'Georgia, "Times New Roman", serif';

function gearPath(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number, rot: number): void {
  c.beginPath();
  for (let k = 0; k < teeth; k++) {
    const a = rot + (k / teeth) * Math.PI * 2;
    const w = Math.PI / teeth;
    const pts: [number, number][] = [
      [r * 0.84, a - w * 0.62],
      [r * 1.02, a - w * 0.3],
      [r * 1.02, a + w * 0.3],
      [r * 0.84, a + w * 0.62],
    ];
    pts.forEach(([rr, aa], i) => {
      const x = cx + Math.cos(aa) * rr;
      const y = cy + Math.sin(aa) * rr;
      if (k === 0 && i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
  }
  c.closePath();
}

function drawGear(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number, rot: number, light: string, dark: string): void {
  const gr = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 1.05);
  gr.addColorStop(0, light);
  gr.addColorStop(1, dark);
  c.fillStyle = gr;
  gearPath(c, cx, cy, r, teeth, rot);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.55)';
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = 'rgba(10,6,2,0.85)';
  c.beginPath();
  c.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,225,160,0.35)';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(cx, cy, r * 0.62, 0.2, 2.2);
  c.stroke();
}

/** Cinematic poster card: dark leather, brass frame with rivets, a painted vignette, serif title and tagline. */
function drawPoster(p: TextPanel, kind: 'gears' | 'aura' | 'spell', title: string, tag: string, accent: string): void {
  const c = p.ctx;
  const W = p.w;
  const H = p.h;
  c.clearRect(0, 0, W, H);
  // modern glass card: deep navy body with a soft accent bloom, rounded corners
  c.save();
  c.beginPath();
  c.roundRect(2, 2, W - 4, H - 4, 44);
  c.clip();
  const bg = c.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#080c1c');
  bg.addColorStop(1, '#010206');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const bloom = c.createRadialGradient(W / 2, H * 1.02, 10, W / 2, H * 1.02, W * 0.9);
  bloom.addColorStop(0, accent + '40');
  bloom.addColorStop(1, accent + '00');
  c.fillStyle = bloom;
  c.fillRect(0, 0, W, H);
  // illustration window
  const ix = 38;
  const iy = 38;
  const iw = W - 76;
  const ih = H * 0.6;
  c.save();
  c.beginPath();
  c.roundRect(ix, iy, iw, ih, 30);
  c.clip();
  const sky = c.createLinearGradient(0, iy, 0, iy + ih);
  const tints: Record<string, [string, string]> = {
    gears: ['#143846', '#071a22'],
    spell: ['#3a0f1c', '#0a0410'],
    aura: ['#1b1048', '#06041a'],
  };
  sky.addColorStop(0, tints[kind][0]);
  sky.addColorStop(1, tints[kind][1]);
  c.fillStyle = sky;
  c.fillRect(ix, iy, iw, ih);
  // warm glow behind the subject
  const glow = c.createRadialGradient(W / 2, iy + ih * 0.55, 10, W / 2, iy + ih * 0.55, iw * 0.7);
  glow.addColorStop(0, 'rgba(255,190,110,0.38)');
  glow.addColorStop(1, 'rgba(255,190,110,0)');
  c.fillStyle = glow;
  c.fillRect(ix, iy, iw, ih);
  const cx = W / 2;
  const cy = iy + ih * 0.55;
  if (kind === 'gears') {
    drawGear(c, cx - 70, cy + 20, 100, 16, 0.1, '#f0cf8a', '#7a5524');
    drawGear(c, cx + 80, cy - 30, 74, 12, 0.35, '#e8b86a', '#5d3d18');
    drawGear(c, cx + 50, cy + 100, 48, 9, 0.2, '#b9bfc8', '#3a3f48');
    c.strokeStyle = 'rgba(110,220,255,0.7)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - 70, cy + 20);
    c.lineTo(cx + 80, cy - 30);
    c.lineTo(cx + 50, cy + 100);
    c.stroke();
  }
  if (kind === 'aura') {
    // a white beam enters a prism and fans into cyan, magenta and gold; a lotus wakes below
    for (let i = 0; i < 70; i++) {
      c.fillStyle = 'rgba(255,255,255,' + (0.2 + ((i * 37) % 10) / 20).toFixed(2) + ')';
      c.fillRect(ix + ((i * 97) % iw), iy + ((i * 53) % (ih * 0.9)), 2, 2);
    }
    const beam = (x1: number, y1: number, x2: number, y2: number, col: string, w: number): void => {
      c.strokeStyle = col;
      c.lineCap = 'round';
      c.shadowColor = col;
      c.shadowBlur = 18;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
      c.shadowBlur = 0;
    };
    const px = cx + 5;
    const py = cy - 10;
    beam(ix, py, px - 30, py, '#ffffff', 6);
    beam(px + 10, py, ix + iw, py - 80, '#ffc233', 5);
    beam(px + 12, py + 4, ix + iw, py + 4, '#ff3bd6', 5);
    beam(px + 10, py + 8, ix + iw, py + 90, '#33f0ff', 5);
    c.fillStyle = 'rgba(190,225,255,0.35)';
    c.strokeStyle = '#d8efff';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(px - 36, py + 34);
    c.lineTo(px + 2, py - 34);
    c.lineTo(px + 40, py + 34);
    c.closePath();
    c.fill();
    c.stroke();
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (k - 4) * 0.28;
      c.fillStyle = k % 2 ? 'rgba(255,120,220,0.7)' : 'rgba(120,240,255,0.75)';
      c.beginPath();
      c.ellipse(cx + Math.sin(a) * 36, iy + ih - 34 + (1 - Math.cos(a)) * 26, 7, 24, a, 0, Math.PI * 2);
      c.fill();
    }
  }
  if (kind === 'spell') {
    // a colossal ember titan looms; two bare hands hold a living fireball
    for (let i = 0; i < 60; i++) {
      c.fillStyle = 'rgba(255,200,140,' + (0.15 + ((i * 29) % 10) / 22).toFixed(2) + ')';
      c.fillRect(ix + ((i * 89) % iw), iy + ((i * 47) % (ih * 0.8)), 2, 2);
    }
    const tg = c.createLinearGradient(0, iy, 0, iy + ih);
    tg.addColorStop(0, '#120611');
    tg.addColorStop(1, '#2a0c14');
    c.fillStyle = tg;
    c.beginPath();
    c.moveTo(cx - 120, iy + ih);
    c.lineTo(cx - 105, iy + 70);
    c.lineTo(cx - 70, iy + 40);
    c.lineTo(cx - 40, iy + 18);
    c.lineTo(cx + 40, iy + 18);
    c.lineTo(cx + 70, iy + 40);
    c.lineTo(cx + 105, iy + 70);
    c.lineTo(cx + 120, iy + ih);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffb040';
    c.shadowColor = '#ff6a00';
    c.shadowBlur = 16;
    c.fillRect(cx - 34, iy + 46, 22, 7);
    c.fillRect(cx + 12, iy + 46, 22, 7);
    c.shadowBlur = 0;
    const fy = cy + 70;
    const fg = c.createRadialGradient(cx, fy, 4, cx, fy, 80);
    fg.addColorStop(0, 'rgba(255,250,200,1)');
    fg.addColorStop(0.3, 'rgba(255,160,40,0.95)');
    fg.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = fg;
    c.beginPath();
    c.arc(cx, fy, 80, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(120,230,255,0.9)';
    c.lineWidth = 3;
    c.shadowColor = '#40d0ff';
    c.shadowBlur = 12;
    c.beginPath();
    c.moveTo(cx - 150, fy - 60);
    c.lineTo(cx - 120, fy - 30);
    c.lineTo(cx - 135, fy - 20);
    c.lineTo(cx - 100, fy + 10);
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#c99a7a';
    for (const sx of [-1, 1]) {
      c.save();
      c.translate(cx + sx * 96, fy + 36);
      c.rotate(sx * 0.5);
      c.beginPath();
      c.ellipse(0, 0, 22, 44, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }
  c.restore();
  // inner vignette over the illustration
  const vig = c.createRadialGradient(W / 2, iy + ih / 2, ih * 0.3, W / 2, iy + ih / 2, ih * 0.95);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = vig;
  c.fillRect(ix, iy, iw, ih);
  // thin accent frame around the picture and the card
  c.strokeStyle = accent;
  c.shadowColor = accent;
  c.shadowBlur = 14;
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(ix, iy, iw, ih, 30);
  c.stroke();
  c.shadowBlur = 0;
  c.restore();
  c.strokeStyle = accent + 'aa';
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(3, 3, W - 6, H - 6, 44);
  c.stroke();
  // chapter number chip over the picture
  const num = kind === 'gears' ? '01' : kind === 'aura' ? '02' : '03';
  c.fillStyle = 'rgba(5,8,20,0.72)';
  c.beginPath();
  c.roundRect(ix + 16, iy + 16, 86, 44, 22);
  c.fill();
  c.fillStyle = accent;
  c.textAlign = 'center';
  c.font = '800 28px "Segoe UI", Arial, sans-serif';
  c.fillText(num, ix + 59, iy + 46);
  // title, tagline and a play pill
  const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
  c.fillStyle = '#f4f6ff';
  c.font = '800 50px ' + SANS;
  (c as unknown as { letterSpacing: string }).letterSpacing = '6px';
  const tw = c.measureText(title).width;
  if (tw > W - 70) c.font = '800 ' + Math.floor((50 * (W - 70)) / tw) + 'px ' + SANS;
  c.fillText(title, W / 2, iy + ih + 72);
  (c as unknown as { letterSpacing: string }).letterSpacing = '1px';
  c.fillStyle = '#9fb0d6';
  c.font = '500 30px ' + SANS;
  c.fillText(tag, W / 2, iy + ih + 114);
  const pw = 200;
  c.fillStyle = accent;
  c.shadowColor = accent;
  c.shadowBlur = 16;
  c.beginPath();
  c.roundRect(W / 2 - pw / 2, iy + ih + 134, pw, 48, 24);
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = '#080b18';
  c.font = '800 26px ' + SANS;
  (c as unknown as { letterSpacing: string }).letterSpacing = '4px';
  c.fillText('PLAY  \u25B6', W / 2, iy + ih + 168);
  (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
  p.commit();
}

/**
 * Hands-first mode menu: big floating cards you point at and pinch (or click).
 * Also owns the small "back" card shown while a game is running.
 */
export class MenuSystem extends createSystem({
  pressed: { required: [MenuButton, Pressed] },
  hovered: { required: [MenuButton, Hovered] },
}) {
  private buttons: Btn[] = [];
  private title!: TextPanel;
  private back!: Btn;
  private lastMode = '';
  private fontWasReady = false;
  private cooldown = 0;
  private dwell = 0;
  private dwellIdx = -1;
  private head = new Vector3();
  private fwd = new Vector3();
  private to = new Vector3();

  private makeButton(
    target: (typeof MenuTargets)[keyof typeof MenuTargets],
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    tilt: number,
    draw: (p: TextPanel) => void,
  ): Btn {
    const panel = new TextPanel(w, h, 640);
    panel.mesh.position.set(x, y, z);
    panel.mesh.rotation.x = tilt;
    const entity = this.world.createTransformEntity(panel.mesh);
    entity.addComponent(RayInteractable);
    entity.addComponent(MenuButton, { target });
    draw(panel);
    return { entity, panel, mesh: panel.mesh, home: y };
  }

  private drawButtons(): void {
    drawPoster(this.buttons[0].panel, 'gears', 'GEARSHIFT', "The Clockmaker's Bench", '#ffc857');
    drawPoster(this.buttons[1].panel, 'aura', 'AURA WEAVER', 'Compose the light.', '#5fe0ff');
    drawPoster(this.buttons[2].panel, 'spell', 'SPELLFORGE', 'Become the magic.', '#ff7a59');
    const b = this.back.panel;
    b.card('rgba(24,14,8,0.92)', '#c79a46');
    b.ctx.textAlign = 'center';
    b.ctx.fillStyle = '#f2d38a';
    b.ctx.font = '700 62px ' + SERIF;
    b.ctx.fillText('‹  MENU', b.w / 2, b.h * 0.66);
    b.commit();
    const t = this.title;
    const tc = t.ctx;
    tc.clearRect(0, 0, t.w, t.h);
    tc.textAlign = 'center';
    tc.shadowColor = 'rgba(0,0,0,0.9)';
    tc.shadowBlur = 14;
    tc.fillStyle = '#ffffff';
    tc.font = '800 66px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    (tc as unknown as { letterSpacing: string }).letterSpacing = '9px';
    const tm = tc.measureText('POCKET WORKSHOP').width;
    if (tm > t.w - 40) tc.font = '800 ' + Math.floor((66 * (t.w - 40)) / tm) + 'px "Segoe UI", Arial, sans-serif';
    tc.fillText('POCKET WORKSHOP', t.w / 2, t.h * 0.52);
    tc.shadowBlur = 0;
    tc.fillStyle = '#c79a46';
    tc.fillRect(t.w / 2 - 230, t.h * 0.64, 460, 3);
    tc.fillStyle = '#e6d3b0';
    tc.font = '500 32px "Segoe UI", Arial, sans-serif';
    (tc as unknown as { letterSpacing: string }).letterSpacing = '3px';
    tc.fillText('three benches.  your bare hands.', t.w / 2, t.h * 0.88);
    (tc as unknown as { letterSpacing: string }).letterSpacing = '0px';
    t.commit();
  }

  init(): void {
    const y = TABLE_Y + 0.22;
    const z = TABLE_CENTER_Z + 0.02;
    this.buttons.push(
      this.makeButton(MenuTargets.Gears, 0.23, 0.29, -0.3, y, z, -0.5, () => {}),
      this.makeButton(MenuTargets.Aura, 0.23, 0.29, 0, y, z, -0.5, () => {}),
      this.makeButton(MenuTargets.Spell, 0.23, 0.29, 0.3, y, z, -0.5, () => {}),
    );
    this.back = this.makeButton(
      MenuTargets.Menu,
      0.14,
      0.07,
      0.34,
      TABLE_Y + 0.07,
      TABLE_CENTER_Z + 0.2,
      -0.9,
      () => {},
    );
    this.title = new TextPanel(0.6, 0.15, 720);
    this.title.mesh.position.set(0, TABLE_Y + 0.5, TABLE_CENTER_Z - 0.05);
    this.title.mesh.rotation.x = -0.35;
    this.world.createTransformEntity(this.title.mesh);
    this.drawButtons();
    (window as unknown as Record<string, unknown>).__setMode = (m: string) => setMode(m as never);

    const onPress = (entity: Entity) => {
      if (this.cooldown > 0) return;
      const target = entity.getValue(MenuButton, 'target');
      if (!target) return;
      // only act on buttons that are visible in the current mode
      const o = entity.object3D;
      if (!o || !o.visible) return;
      sfx.ambience();
      sfx.select();
      this.cooldown = 0.4;
      setMode(target === 'kite' ? 'kitecraft' : (target as 'menu' | 'guti' | 'marblerun' | 'paperplane' | 'gears' | 'aura' | 'spell'));
    };
    this.cleanupFuncs.push(this.queries.pressed.subscribe('qualify', onPress));
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const menu = modeState.mode === 'menu';
      for (const b of this.buttons) b.mesh.visible = menu;
      this.title.mesh.visible = menu;
      this.back.mesh.visible = !menu && modeState.mode !== 'spell'; // Spellforge has its own exit
    }
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.drawButtons();
    }
    // accessibility: look at a card for ~1.5 s to choose it (no hand press needed)
    if (modeState.mode === 'menu' && this.cooldown <= 0 && this.world.visibilityState.value === 'visible') {
      const cam = this.world.camera;
      cam.getWorldPosition(this.head);
      cam.getWorldDirection(this.fwd);
      let hit = -1;
      for (let i = 0; i < 3; i++) {
        this.buttons[i].mesh.getWorldPosition(this.to).sub(this.head).normalize();
        if (this.to.dot(this.fwd) > 0.985) hit = i;
      }
      if (hit === this.dwellIdx && hit >= 0) this.dwell += delta;
      else {
        this.dwellIdx = hit;
        this.dwell = 0;
      }
      if (this.dwell > 1.5) {
        this.dwell = 0;
        this.cooldown = 0.4;
        sfx.ambience();
        sfx.select();
        setMode(hit === 0 ? 'gears' : hit === 1 ? 'aura' : 'spell');
      }
    }
    // hover feedback: buttons lift a little
    for (const b of this.buttons) {
      let hov = false;
      for (const e of this.queries.hovered.entities) {
        if (e === b.entity) hov = true;
      }
      const gazed = this.dwellIdx >= 0 && this.buttons[this.dwellIdx] === b;
      const target = b.home + (hov || gazed ? 0.025 : 0);
      b.mesh.position.y += (target - b.mesh.position.y) * Math.min(1, delta * 12);
      (b.mesh.material as MeshBasicMaterial).opacity = hov ? 1 : 0.92;
    }
  }
}
