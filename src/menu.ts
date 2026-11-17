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
function drawPoster(p: TextPanel, kind: 'gears' | 'bricks' | 'pottery' | 'dominoes', title: string, tag: string, accent: string): void {
  const c = p.ctx;
  const W = p.w;
  const H = p.h;
  c.clearRect(0, 0, W, H);
  // leather body
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d140d');
  bg.addColorStop(1, '#0d0805');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  // illustration window
  const ix = 38;
  const iy = 38;
  const iw = W - 76;
  const ih = H * 0.6;
  c.save();
  c.beginPath();
  c.rect(ix, iy, iw, ih);
  c.clip();
  const sky = c.createLinearGradient(0, iy, 0, iy + ih);
  const tints: Record<string, [string, string]> = {
    gears: ['#143846', '#071a22'],
    bricks: ['#3a2a14', '#150e06'],
    pottery: ['#3d2416', '#130a06'],
    dominoes: ['#3a1622', '#14070b'],
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
  } else if (kind === 'bricks') {
    const brick = (x: number, y: number, w: number, hh: number, col: string): void => {
      const g = c.createLinearGradient(x, y, x, y + hh);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      c.fillStyle = col;
      c.fillRect(x, y, w, hh);
      c.fillStyle = g;
      c.fillRect(x, y, w, hh);
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.fillRect(x, y, w, 4);
      for (let k = 0; k < Math.round(w / 52); k++) {
        const sx = x + 26 + k * 52;
        c.fillStyle = col;
        c.fillRect(sx - 15, y - 12, 30, 12);
        c.fillStyle = 'rgba(255,255,255,0.3)';
        c.fillRect(sx - 15, y - 12, 30, 3);
      }
    };
    brick(cx - 130, cy + 70, 260, 60, '#d94a3a');
    brick(cx - 104, cy + 10, 208, 60, '#e8b830');
    brick(cx - 52, cy - 50, 104, 60, '#3f86d4');
    brick(cx + 70, cy - 8, 104, 60, '#3aa860');
  } else if (kind === 'pottery') {
    // wheel + vase silhouette with rim light
    c.fillStyle = '#2a1a10';
    c.beginPath();
    c.ellipse(cx, cy + 118, 130, 30, 0, 0, Math.PI * 2);
    c.fill();
    const vg = c.createLinearGradient(cx - 90, 0, cx + 90, 0);
    vg.addColorStop(0, '#6b3a22');
    vg.addColorStop(0.35, '#e0a070');
    vg.addColorStop(1, '#4a2616');
    c.fillStyle = vg;
    c.beginPath();
    c.moveTo(cx - 38, cy - 105);
    c.bezierCurveTo(cx - 40, cy - 60, cx - 100, cy - 20, cx - 70, cy + 50);
    c.bezierCurveTo(cx - 60, cy + 95, cx - 44, cy + 100, cx - 44, cy + 112);
    c.lineTo(cx + 44, cy + 112);
    c.bezierCurveTo(cx + 44, cy + 100, cx + 60, cy + 95, cx + 70, cy + 50);
    c.bezierCurveTo(cx + 100, cy - 20, cx + 40, cy - 60, cx + 38, cy - 105);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,220,170,0.5)';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(cx, cy - 105, 38, 9, 0, 0, Math.PI * 2);
    c.stroke();
  } else {
    // dominoes mid-fall
    for (let k = 0; k < 7; k++) {
      c.save();
      c.translate(cx - 150 + k * 50, cy + 110);
      c.rotate(Math.max(0, (k - 2) * 0.17) * 1.0);
      const g = c.createLinearGradient(-16, -150, 16, 0);
      g.addColorStop(0, '#f6efe4');
      g.addColorStop(1, '#b9ab98');
      c.fillStyle = g;
      c.fillRect(-16, -150, 32, 150);
      c.fillStyle = '#2a1a1a';
      c.fillRect(-16, -78, 32, 3);
      for (const [dx, dy] of [[0, -112], [-6, -46], [6, -28]]) {
        c.beginPath();
        c.arc(dx, dy, 4.5, 0, Math.PI * 2);
        c.fill();
      }
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
  // brass frame around the picture and the whole card
  c.strokeStyle = '#c79a46';
  c.lineWidth = 5;
  c.strokeRect(ix, iy, iw, ih);
  c.strokeStyle = 'rgba(199,154,70,0.55)';
  c.lineWidth = 2;
  c.strokeRect(14, 14, W - 28, H - 28);
  c.strokeStyle = '#8a6a30';
  c.lineWidth = 8;
  c.strokeRect(4, 4, W - 8, H - 8);
  for (const [rx, ry] of [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]]) {
    const rg = c.createRadialGradient(rx - 2, ry - 2, 1, rx, ry, 8);
    rg.addColorStop(0, '#f6dc9a');
    rg.addColorStop(1, '#5a4120');
    c.fillStyle = rg;
    c.beginPath();
    c.arc(rx, ry, 7, 0, Math.PI * 2);
    c.fill();
  }
  // title and tagline
  c.textAlign = 'center';
  c.fillStyle = accent;
  c.font = '700 54px ' + SERIF;
  (c as unknown as { letterSpacing: string }).letterSpacing = '5px';
  const tw = c.measureText(title).width;
  if (tw > W - 70) c.font = '700 ' + Math.floor((54 * (W - 70)) / tw) + 'px ' + SERIF;
  c.shadowColor = 'rgba(0,0,0,0.8)';
  c.shadowBlur = 6;
  c.fillText(title, W / 2, iy + ih + 78);
  c.shadowBlur = 0;
  (c as unknown as { letterSpacing: string }).letterSpacing = '1px';
  c.fillStyle = '#d8c3a0';
  c.font = 'italic 34px ' + SERIF;
  c.fillText(tag, W / 2, iy + ih + 128);
  c.fillStyle = 'rgba(199,154,70,0.8)';
  c.fillRect(W / 2 - 60, iy + ih + 98, 120, 2);
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
    drawPoster(this.buttons[0].panel, 'gears', 'GEARSHIFT', "The Clockmaker's Bench", '#f2d38a');
    drawPoster(this.buttons[1].panel, 'bricks', 'BRICKWORKS', 'Build it.  Then break it.', '#ffd05a');
    drawPoster(this.buttons[2].panel, 'pottery', 'THE WHEEL', 'Clay turns in your hands', '#f0b080');
    drawPoster(this.buttons[3].panel, 'dominoes', 'DOMINO FALL', 'One touch.  Chain reaction.', '#ff9db8');
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
    tc.fillStyle = '#f2d38a';
    tc.font = '700 70px ' + SERIF;
    (tc as unknown as { letterSpacing: string }).letterSpacing = '9px';
    const tm = tc.measureText('POCKET WORKSHOP').width;
    if (tm > t.w - 40) tc.font = '700 ' + Math.floor((70 * (t.w - 40)) / tm) + 'px ' + SERIF;
    tc.fillText('POCKET WORKSHOP', t.w / 2, t.h * 0.52);
    tc.shadowBlur = 0;
    tc.fillStyle = '#c79a46';
    tc.fillRect(t.w / 2 - 230, t.h * 0.64, 460, 3);
    tc.fillStyle = '#e6d3b0';
    tc.font = 'italic 34px ' + SERIF;
    (tc as unknown as { letterSpacing: string }).letterSpacing = '3px';
    tc.fillText('four benches.  your bare hands.', t.w / 2, t.h * 0.88);
    (tc as unknown as { letterSpacing: string }).letterSpacing = '0px';
    t.commit();
  }

  init(): void {
    const y = TABLE_Y + 0.22;
    const z = TABLE_CENTER_Z + 0.02;
    this.buttons.push(
      this.makeButton(MenuTargets.Gears, 0.2, 0.25, -0.375, y, z, -0.5, () => {}),
      this.makeButton(MenuTargets.Bricks, 0.2, 0.25, -0.125, y, z, -0.5, () => {}),
      this.makeButton(MenuTargets.Pottery, 0.2, 0.25, 0.125, y, z, -0.5, () => {}),
      this.makeButton(MenuTargets.Dominoes, 0.2, 0.25, 0.375, y, z, -0.5, () => {}),
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
      setMode(target === 'kite' ? 'kitecraft' : (target as 'menu' | 'guti' | 'pottery' | 'marblerun' | 'dominoes' | 'bricks' | 'paperplane' | 'gears'));
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
      this.back.mesh.visible = !menu;
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
      for (let i = 0; i < 4; i++) {
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
        setMode(hit === 0 ? 'gears' : hit === 1 ? 'bricks' : hit === 2 ? 'pottery' : 'dominoes');
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
