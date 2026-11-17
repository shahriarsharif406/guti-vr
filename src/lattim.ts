import {
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Entity,
  Pressed,
  RayInteractable,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState, setMode } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { LatOpt } from './ui-components.js';

// ---- Arena layout (metres, in front of the seated player)
const TABLE_Y = 0.72;
const SURFACE_Y = 0.745;
const CX = 0;
const CZ = -0.7;
const RING_R = 0.3;
const TABLE_R = 0.46;
const REST = new Vector3(0, 0.84, -0.3);
const GRAB_R = 0.25;
const TOP_R = 0.046;
const TOP_SCALE = 1.35;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const MAX_TOPS = 3;
const HAND_GAIN = 0.5;
const MAX_THROW = 3;

type HandName = 'left' | 'right';
type Phase = 'ready' | 'held' | 'live' | 'message';

interface LevelDef {
  enemies: number;
  spin: number;
  dash: number;
  tip: string;
}
const LEVELS: LevelDef[] = [
  { enemies: 1, spin: 52, dash: 3.6, tip: 'Pinch the top, swing forward, let go' },
  { enemies: 2, spin: 58, dash: 3.2, tip: 'A faster flick gives your top more spin' },
  { enemies: 2, spin: 66, dash: 2.8, tip: 'Hit them out of the ring, they hit back' },
  { enemies: 3, spin: 70, dash: 2.6, tip: 'Keep your top inside the chalk ring' },
  { enemies: 3, spin: 78, dash: 2.3, tip: 'Stay in the centre and let them come' },
  { enemies: 4, spin: 84, dash: 2.0, tip: 'Final round: clear the ring' },
];

/** Three real-world style tops. wc = critical spin: below it the top can no longer
 *  hold itself upright (gyroscopic stability); P = gravity torque / inertia. */
const DESIGNS = [
  { name: 'Natural', color: 0xff9a2e, wc: 28, P: 300, fric: 1 },
  { name: 'Painted', color: 0x3b6fd0, wc: 24, P: 380, fric: 1.15 },
  { name: 'Tall', color: 0xd0a030, wc: 34, P: 240, fric: 0.8 },
];
const TOP_COLORS = [0xe0483f, 0x2f9e6b, 0x3b82f6, 0xf2b134, 0x9b59d0];

let bandTex: CanvasTexture | null = null;
/** Painted bands around the top: reads as a blur of colour when it spins. */
function bandTexture(): CanvasTexture {
  if (bandTex) return bandTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const cols = ['#ffffff', '#3a3a3a', '#ffffff', '#ffe27a', '#ffffff', '#3a3a3a', '#ffffff'];
  for (let i = 0; i < cols.length; i++) {
    g.fillStyle = cols[i];
    g.fillRect(0, i * (128 / cols.length), 128, 128 / cols.length);
  }
  // one pale stripe from tip to top so rotation is visible
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 14, 128);
  bandTex = new CanvasTexture(c);
  bandTex.colorSpace = SRGBColorSpace;
  return bandTex;
}

const profile: Vector2[] = [
  new Vector2(0.001, 0.0),
  new Vector2(0.006, 0.018),
  new Vector2(0.018, 0.03),
  new Vector2(0.032, 0.046),
  new Vector2(0.034, 0.058),
  new Vector2(0.028, 0.07),
  new Vector2(0.014, 0.08),
  new Vector2(0.011, 0.092),
  new Vector2(0.016, 0.098),
  new Vector2(0.001, 0.102),
];
const topGeo = new LatheGeometry(profile, 24);
const tipGeo = new ConeGeometry(0.007, 0.022, 8);
const tipMat = new MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.9, roughness: 0.3 });

class Top {
  readonly group = new Group();
  readonly body: Mesh;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  spin = 0;
  state: 'off' | 'live' | 'dying' | 'out' = 'off';
  fallT = 0;
  phase = Math.random() * 6;
  enemy = false;
  nextDash = 3;
  spinRot = 0;
  tilt = 0;
  prec = 0;
  life = 0;
  peak = 0;
  wc = 28;
  P = 300;
  fric = 1;

  constructor(color: number) {
    this.group.scale.setScalar(TOP_SCALE);
    this.body = new Mesh(
      topGeo,
      new MeshStandardMaterial({ color, map: bandTexture(), roughness: 0.4, metalness: 0.05 }),
    );
    this.group.add(this.body);
    const tip = new Mesh(tipGeo, tipMat);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.006;
    this.group.add(tip);
    this.group.visible = false;
  }

  get mass(): number {
    return (this.enemy ? 1 : 1.3) * (0.8 + Math.min(this.spin, 100) / 200);
  }
}

export class LattimSystem extends createSystem({
  opts: { required: [LatOpt, Pressed] },
}) {
  private master = false;
  private design = 0;
  private bestTime = 0;
  private lastTime = 0;
  private optBtns: TextPanel[] = [];
  private optCooldown = 0;
  private hudTick = 0;
  private tops: Top[] = []; // index 0 is the player's
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private phase: Phase = 'ready';
  private lastMode = '';
  private fontWasReady = false;
  private level = 1;
  private unlocked = 1;
  private topsLeft = MAX_TOPS;
  private enemiesLeft = 0;
  private msg = '';
  private msgT = 0;
  private msgNext: 'retry' | 'next' | 'menu' = 'retry';
  private tipText = '';
  private hudDirty = true;
  private elapsed = 0;
  private held: HandName | 'mouse' | null = null;
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private grabPos = new Vector3();
  private handPos = new Vector3();
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private mouseOff = new Vector3();
  private histT = new Float32Array(8);
  private histX = new Float32Array(8);
  private histZ = new Float32Array(8);
  private histN = 0;
  private histI = 0;
  private shotsStars = 0;

  init(): void {
    const player = new Top(0xffffff);
    this.tops.push(player);
    for (let i = 0; i < 5; i++) {
      const t = new Top(TOP_COLORS[i]);
      t.enemy = true;
      this.tops.push(t);
    }
    for (const t of this.tops) {
      this.world.createTransformEntity(t.group);
      this.root.push(t.group);
    }
    player.body.material = new MeshStandardMaterial({ color: 0xff9a2e, map: bandTexture(), roughness: 0.35, metalness: 0.08 });

    // round wooden table with a packed-earth fighting ring
    const wood = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: this.woodTexture() });
    const top = new Mesh(new CylinderGeometryShim(TABLE_R, 0.04, 56), wood);
    top.position.set(CX, TABLE_Y, CZ);
    this.add(top);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometryShim(0.03, 0.72, 8), wood);
      leg.position.set(CX + Math.cos(a) * 0.3, TABLE_Y * 0.5 - 0.02, CZ + Math.sin(a) * 0.3);
      this.add(leg);
    }
    const dirt = new Mesh(
      new CircleGeometry(RING_R, 56),
      new MeshStandardMaterial({ color: 0xa07a50, roughness: 1, map: this.dirtTexture() }),
    );
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(CX, SURFACE_Y - 0.002, CZ);
    this.add(dirt);
    const chalk = new Mesh(new RingGeometry(RING_R - 0.006, RING_R + 0.006, 64), new MeshBasicMaterial({ color: 0xf4efe0 }));
    chalk.rotation.x = -Math.PI / 2;
    chalk.position.set(CX, SURFACE_Y + 0.0005, CZ);
    this.add(chalk);

    this.hud = new TextPanel(0.5, 0.2);
    this.hud.mesh.position.set(0, TABLE_Y + 0.36, CZ - 0.32);
    this.hud.mesh.rotation.x = -0.4;
    this.world.createTransformEntity(this.hud.mesh);
    this.root.push(this.hud.mesh);
    this.setVisible(false);
    for (let i = 0; i < 2; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.62, 0.95 - i * 0.085, -0.52);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(LatOpt, { id: i });
      this.optBtns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'lattim' || this.optCooldown > 0 || this.phase === 'live') return;
        this.optCooldown = 0.3;
        sfx.select();
        const id = entity.getValue(LatOpt, 'id') as number;
        if (id === 0) this.master = !this.master;
        else this.design = (this.design + 1) % DESIGNS.length;
        this.tops[0].body.material = new MeshStandardMaterial({ color: DESIGNS[this.design].color, map: bandTexture(), roughness: 0.35, metalness: 0.08 });
        this.drawOpts();
        this.held = null;
        this.startLevel(this.master ? 1 : this.unlocked);
        this.hudDirty = true;
      }),
    );
    try {
      this.bestTime = Number(localStorage.getItem('guti-lattim-best') ?? '0') || 0;
    } catch {
      /* ignore */
    }
    this.drawOpts();

    try {
      this.unlocked = Math.min(LEVELS.length, Math.max(1, Number(localStorage.getItem('guti-lattim-level') ?? '1') || 1));
    } catch {
      this.unlocked = 1;
    }

    // read-only probe for automated tests
    (window as unknown as { __lattim?: () => unknown }).__lattim = () => ({
      level: this.level,
      phase: this.phase,
      tops: this.topsLeft,
      enemies: this.enemiesLeft,
      unlocked: this.unlocked,
      master: this.master,
      design: this.design,
      best: this.bestTime,
      tilt: this.tops[0].tilt,
      spin: this.tops[0].spin,
      life: this.tops[0].life,
    });
    (window as unknown as { __lattimSet?: (m: boolean, d: number) => void }).__lattimSet = (m, d) => {
      this.master = m;
      this.design = d % DESIGNS.length;
      this.tops[0].body.material = new MeshStandardMaterial({ color: DESIGNS[this.design].color, map: bandTexture(), roughness: 0.35, metalness: 0.08 });
      this.drawOpts();
      this.startLevel(m ? 1 : this.unlocked);
    };
    const down = (e: PointerEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (modeState.mode === 'lattim' && this.phase === 'ready' && this.held === null) {
        this.held = 'mouse';
        this.mouseOff.set(0, 0, 0);
        this.grabPos.copy(REST);
        this.histN = 0;
        this.beginHold();
      }
    };
    const move = (e: PointerEvent) => {
      if (this.mouseDown && this.held === 'mouse') {
        this.mouseOff.x += (e.clientX - this.mouseX) * 0.0016;
        this.mouseOff.z += (e.clientY - this.mouseY) * 0.0022;
        this.mouseOff.x = Math.max(-0.5, Math.min(0.5, this.mouseOff.x));
        this.mouseOff.z = Math.max(-0.9, Math.min(0.3, this.mouseOff.z));
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const up = () => {
      this.mouseDown = false;
      if (this.held === 'mouse') this.release();
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
  }

  private woodTexture(): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#b07a48';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = 'rgba(' + (40 + Math.random() * 40) + ',20,10,' + Math.random() * 0.25 + ')';
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      const y = Math.random() * 256;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + Math.random() * 10 - 5, 170, y + Math.random() * 10 - 5, 256, y);
      g.stroke();
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  private dirtTexture(): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#a07a50';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4500; i++) {
      const v = 120 + Math.random() * 70;
      g.fillStyle = 'rgba(' + v + ',' + v * 0.75 + ',' + v * 0.5 + ',0.45)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // scuffs from earlier games
    g.strokeStyle = 'rgba(70,45,25,0.35)';
    for (let i = 0; i < 14; i++) {
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      g.arc(x, y, 8 + Math.random() * 40, Math.random() * 6, Math.random() * 6 + 1.2);
      g.stroke();
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  }

  private add(m: Mesh): void {
    this.world.createTransformEntity(m);
    this.root.push(m);
  }

  private setVisible(on: boolean): void {
    for (const o of this.root) o.visible = on;
    if (on) for (const t of this.tops) t.group.visible = t.state !== 'off' && t.state !== 'out';
  }

  private say(text: string, seconds: number, next: 'retry' | 'next' | 'menu' | null = null): void {
    this.msg = text;
    this.msgT = seconds;
    if (next) {
      this.msgNext = next;
      this.phase = 'message';
    }
    this.hudDirty = true;
  }

  // ------------------------------------------------------------------ levels
  private startMaster(): void {
    this.master = true;
    this.tipText = 'Spin Master: how long can your top stay alive?';
    this.topsLeft = 99;
    this.enemiesLeft = 0;
    for (const t of this.tops) {
      t.state = 'off';
      t.group.visible = false;
    }
    this.prepareTop();
    this.say(this.tipText, 3);
  }

  private startLevel(level: number): void {
    if (this.master) {
      this.startMaster();
      return;
    }
    this.level = level;
    const def = LEVELS[level - 1];
    this.tipText = def.tip;
    this.topsLeft = MAX_TOPS;
    this.phase = 'ready';
    this.held = null;
    for (const t of this.tops) {
      t.state = 'off';
      t.group.visible = false;
    }
    this.enemiesLeft = def.enemies;
    for (let i = 0; i < def.enemies; i++) {
      const t = this.tops[1 + i];
      const a = (i / def.enemies) * Math.PI * 2 + Math.random();
      const r = def.enemies === 1 ? 0 : 0.11 + Math.random() * 0.05;
      t.x = CX + Math.cos(a) * r;
      t.z = CZ + Math.sin(a) * r;
      t.vx = t.vz = 0;
      t.spin = def.spin + Math.random() * 8;
      t.tilt = 0.05;
      t.wc = 28;
      t.P = 300;
      t.fric = 1;
      t.state = 'live';
      t.nextDash = 2 + Math.random() * def.dash;
      t.group.visible = true;
      t.group.scale.setScalar(TOP_SCALE);
      t.group.rotation.set(0, 0, 0);
    }
    this.prepareTop();
    this.say(def.tip, 4);
  }

  /** Put the player's top on the rest pad, ready to be picked up. */
  private prepareTop(): void {
    const p = this.tops[0];
    p.state = 'off';
    p.group.visible = true;
    p.group.scale.setScalar(TOP_SCALE);
    p.group.rotation.set(0, 0, 0);
    p.group.position.copy(REST);
    this.phase = 'ready';
    this.hudDirty = true;
  }

  private beginHold(): void {
    this.phase = 'held';
    this.histN = 0;
    sfx.grab();
  }

  private pushHist(x: number, z: number): void {
    this.histT[this.histI] = this.elapsed;
    this.histX[this.histI] = x;
    this.histZ[this.histI] = z;
    this.histI = (this.histI + 1) % 8;
    this.histN = Math.min(8, this.histN + 1);
  }

  /** Hand velocity over the last ~0.12 s, on the table plane. */
  private throwVelocity(out: Vector3): void {
    out.set(0, 0, 0);
    if (this.histN < 2) return;
    const newest = (this.histI + 7) % 8;
    let oldest = newest;
    for (let k = 1; k < this.histN; k++) {
      const i = (newest - k + 8) % 8;
      if (this.elapsed - this.histT[i] > 0.14) break;
      oldest = i;
    }
    const dt = this.histT[newest] - this.histT[oldest];
    if (dt < 0.02) return;
    out.set((this.histX[newest] - this.histX[oldest]) / dt, 0, (this.histZ[newest] - this.histZ[oldest]) / dt);
  }

  private release(): void {
    if (this.phase !== 'held') {
      this.held = null;
      return;
    }
    const v = new Vector3();
    this.throwVelocity(v);
    const p = this.tops[0];
    const sp = Math.hypot(v.x, v.z);
    const k = sp > MAX_THROW ? MAX_THROW / sp : 1;
    p.vx = v.x * k * HAND_GAIN;
    p.vz = v.z * k * HAND_GAIN;
    // land where the hand let go, kept on the wooden table
    let x = p.group.position.x;
    let z = p.group.position.z;
    const dx = x - CX;
    const dz = z - CZ;
    const d = Math.hypot(dx, dz);
    if (d > TABLE_R - 0.03) {
      x = CX + (dx / d) * (TABLE_R - 0.03);
      z = CZ + (dz / d) * (TABLE_R - 0.03);
    }
    p.x = x;
    p.z = z;
    p.spin = 75 + Math.min(Math.hypot(p.vx, p.vz) * 14, 45);
    p.state = 'live';
    p.group.rotation.set(0, 0, 0);
    const D = DESIGNS[this.design];
    p.wc = D.wc;
    p.P = D.P;
    p.fric = D.fric;
    p.tilt = 0.04 + Math.random() * 0.05;
    p.prec = Math.random() * 6;
    p.life = 0;
    p.peak = p.spin;
    this.topsLeft -= 1;
    this.phase = 'live';
    this.held = null;
    sfx.whoosh();
    emitBurst(x, SURFACE_Y + 0.01, z, 0.8, 0.65, 0.45, 10, 0.25);
    this.hudDirty = true;
  }

  private markOut(t: Top): void {
    if (t.state === 'out') return;
    t.state = 'out';
    t.fallT = 0;
    emitBurst(t.x, SURFACE_Y + 0.03, t.z, 0.9, 0.75, 0.5, 14, 0.45);
    if (t.enemy) {
      this.enemiesLeft -= 1;
      sfx.cut();
      this.hudDirty = true;
    } else {
      sfx.hurt();
    }
  }

  private afterThrowChecks(): void {
    if (this.phase !== 'live') return;
    if (this.master) {
      const p = this.tops[0];
      this.hudTick -= 0.016;
      if (this.hudTick <= 0) {
        this.hudTick = 0.2;
        this.hudDirty = true;
      }
      if (p.state === 'out' || p.state === 'off') {
        this.lastTime = p.life;
        const rec = p.life > this.bestTime;
        if (rec) {
          this.bestTime = p.life;
          try {
            localStorage.setItem('guti-lattim-best', String(p.life));
          } catch {
            /* ignore */
          }
        }
        sfx.lose();
        this.say((rec ? 'New best  ' : 'Spun ') + p.life.toFixed(1) + ' s', 3, 'retry');
      }
      return;
    }
    if (this.enemiesLeft <= 0) {
      const stars = Math.max(1, 4 - (MAX_TOPS - this.topsLeft));
      this.shotsStars = stars;
      sfx.win();
      emitBurst(CX, SURFACE_Y + 0.1, CZ, 1, 0.85, 0.35, 60, 0.9);
      if (this.level >= LEVELS.length) {
        this.say('Champion! All rings cleared', 4, 'menu');
      } else {
        if (this.level + 1 > this.unlocked) {
          this.unlocked = this.level + 1;
          try {
            localStorage.setItem('guti-lattim-level', String(this.unlocked));
          } catch {
            /* ignore */
          }
        }
        this.say('Ring cleared!  ' + '★'.repeat(stars), 3, 'next');
      }
      return;
    }
    if (this.tops[0].state === 'out' || this.tops[0].state === 'off') {
      if (this.topsLeft > 0) {
        this.prepareTop();
        this.say('Your top is out. ' + this.topsLeft + ' left', 2);
      } else {
        sfx.lose();
        this.say('Out of tops, try again', 3, 'retry');
      }
    }
  }

  // ------------------------------------------------------------------ input
  private readPinch(hand: HandName): boolean {
    const adapter = this.input.xr.visualAdapters.hand[hand];
    if (adapter.connected) {
      const s = adapter.getPinchStrength();
      return this.pinching[hand] ? s >= PINCH_HOLD : s >= PINCH_START;
    }
    const pad = this.input.xr.gamepads[hand];
    return pad ? pad.getButtonPressed('xr-standard-trigger') : false;
  }

  private readHandPos(hand: HandName, out: Vector3): boolean {
    const ad = this.input.xr.visualAdapters.hand[hand];
    if (readPinchPoint(ad as never, out)) return true;
    const space = (ad.connected ? ad.gripSpace : undefined) ?? this.player.gripSpaces[hand];
    if (!space) return false;
    space.getWorldPosition(out);
    return true;
  }

  private updateInput(): void {
    if (this.phase === 'ready') {
      for (const hand of ['right', 'left'] as HandName[]) {
        const p = this.readPinch(hand);
        const was = this.pinching[hand];
        this.pinching[hand] = p;
        if (p && !was && this.readHandPos(hand, this.handPos)) {
          if (this.handPos.distanceTo(REST) < GRAB_R) {
            this.held = hand;
            this.beginHold();
            break;
          }
        }
      }
    } else if (this.phase === 'held' && this.held && this.held !== 'mouse') {
      const hand = this.held;
      const p = this.readPinch(hand);
      this.pinching[hand] = p;
      if (!p) {
        this.release();
      } else if (this.readHandPos(hand, this.handPos)) {
        this.grabPos.copy(this.handPos);
      }
    }
    if (this.phase === 'held') {
      const g = this.tops[0].group;
      if (this.held === 'mouse') {
        this.grabPos.set(REST.x + this.mouseOff.x, REST.y, REST.z + this.mouseOff.z);
      }
      g.position.copy(this.grabPos);
      this.pushHist(this.grabPos.x, this.grabPos.z);
    }
  }

  // ------------------------------------------------------------------ physics
  private step(dt: number): void {
    const level = LEVELS[this.level - 1];
    const tops = this.tops;
    for (const t of tops) {
      if (t.state !== 'live') continue;
      const sp = Math.hypot(t.vx, t.vz);
      const damp = Math.exp(-(3.2 + (t.spin < 30 ? 1.6 : 0)) * dt);
      t.vx *= damp;
      t.vz *= damp;
      t.spin -= (2.1 + sp * 2.5) * dt * t.fric;
      // gyroscopic tilt: friction at the tip topples the axis faster as the spin falls
      const w = Math.max(t.spin, 8);
      const r = (t.wc / w) * (t.wc / w);
      t.tilt += (0.004 + 0.1 * r) * dt;
      t.prec += (t.P / w) * dt;
      t.life += dt;
      if (t.spin > t.peak) t.peak = t.spin;
      if (t.tilt > 0.85) t.spin = Math.min(t.spin, 13.9);
      // a spinning top wanders a little, like a real one on rough earth
      const k = (t.spin / 90) * 0.05;
      t.vx += Math.sin(this.elapsed * 1.7 + t.phase) * k * dt * 12;
      t.vz += Math.cos(this.elapsed * 1.3 + t.phase * 1.7) * k * dt * 12;
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      if (t.enemy) {
        t.nextDash -= dt;
        if (t.nextDash <= 0) {
          t.nextDash = level.dash * (0.7 + Math.random() * 0.6);
          const p = tops[0];
          let tx = CX;
          let tz = CZ;
          if (p.state === 'live') {
            tx = p.x;
            tz = p.z;
          }
          const dx = tx - t.x;
          const dz = tz - t.z;
          const d = Math.hypot(dx, dz) || 1;
          const s = 0.75 + this.level * 0.08;
          t.vx += (dx / d) * s;
          t.vz += (dz / d) * s;
          // when far out, steer home instead of charging off the edge
          const hx = CX - t.x;
          const hz = CZ - t.z;
          if (Math.hypot(hx, hz) > RING_R * 0.7) {
            t.vx = (hx / (Math.hypot(hx, hz) || 1)) * s * 0.8;
            t.vz = (hz / (Math.hypot(hx, hz) || 1)) * s * 0.8;
          }
        }
      }
      if (t.spin < 14) {
        t.state = 'dying';
        t.fallT = 0;
      }
      const dd = Math.hypot(t.x - CX, t.z - CZ);
      if (dd > RING_R + 0.005) this.markOut(t);
    }
    // collisions
    for (let i = 0; i < tops.length; i++) {
      const a = tops[i];
      if (a.state !== 'live') continue;
      for (let j = i + 1; j < tops.length; j++) {
        const b = tops[j];
        if (b.state !== 'live') continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = TOP_R * 2;
        if (d >= min || d < 1e-5) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = (min - d) * 0.5;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;
        const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vn <= 0) continue; // already separating
        const ma = a.mass;
        const mb = b.mass;
        const e = 1.05;
        const jn = ((1 + e) * vn) / (1 / ma + 1 / mb);
        a.vx -= (jn / ma) * nx;
        a.vz -= (jn / ma) * nz;
        b.vx += (jn / mb) * nx;
        b.vz += (jn / mb) * nz;
        a.spin *= 0.95;
        b.spin *= 0.95;
        a.tilt += 0.1 * vn;
        b.tilt += 0.1 * vn;
        sfx.clack(Math.min(1, vn / 1.5));
        emitBurst((a.x + b.x) / 2, SURFACE_Y + 0.04, (a.z + b.z) / 2, 1, 0.9, 0.6, 8, 0.35);
      }
    }
  }

  private drawOpts(): void {
    const labels = [['MODE', this.master ? 'Spin Master' : 'Battle'], ['TOP', DESIGNS[this.design].name]];
    for (let i = 0; i < 2; i++) {
      const p = this.optBtns[i];
      p.card('rgba(40,24,12,0.9)', '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 34, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    if (this.master) {
      const p = this.tops[0];
      h.text('Spin Master  •  ' + DESIGNS[this.design].name + ' top', 62, 40);
      if (this.phase === 'message') {
        h.text(this.msg, 140, 38, '#8dff9d');
      } else {
        const live = p.state === 'live';
        h.text(
          (live ? p.life.toFixed(1) : this.lastTime.toFixed(1)) + ' s   Best ' + this.bestTime.toFixed(1) + ' s   ' +
            Math.round(((live ? p.spin : 0) * 60) / (Math.PI * 2)) + ' rpm   Tilt ' + Math.round((live ? p.tilt : 0) * 57.3) + '°',
          140,
          30,
        );
      }
      h.text(this.phase === 'ready' || this.phase === 'held' ? this.tipText : 'Keep it upright and inside the ring', 215, 26, '#cdb99a');
      h.commit();
      return;
    }
    h.text('Lattim  •  Level ' + this.level + '/' + LEVELS.length, 62, 40);
    if (this.phase === 'message' || this.msgT > 0) {
      h.text(this.msg, 140, 38, this.phase === 'message' && this.msg.startsWith('Out of') ? '#ff9d8d' : '#8dff9d');
    } else {
      h.text('Tops ' + this.topsLeft + '   Enemies ' + this.enemiesLeft, 140, 38);
    }
    h.text(this.phase === 'ready' || this.phase === 'held' ? this.tipText : 'Knock them out of the ring', 215, 26, '#cdb99a');
    h.commit();
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'lattim';
      this.setVisible(on);
      this.held = null;
      this.mouseDown = false;
      if (on) this.startLevel(this.unlocked);
    }
    if (modeState.mode !== 'lattim') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;

    if (this.msgT > 0) {
      this.msgT -= delta;
      if (this.msgT <= 0) {
        this.hudDirty = true;
        if (this.phase === 'message') {
          const next = this.msgNext;
          if (next === 'menu') setMode('menu');
          else if (next === 'next') this.startLevel(this.level + 1);
          else this.startLevel(this.level);
        }
      }
    }

    this.updateInput();

    if (this.phase === 'live' || this.phase === 'ready' || this.phase === 'held') {
      let dt = Math.min(delta, 0.05);
      while (dt > 0) {
        const s = Math.min(dt, 1 / 120);
        this.step(s);
        dt -= s;
      }
    }

    // visuals
    for (const t of this.tops) {
      const g = t.group;
      if (t.state === 'live') {
        g.position.set(t.x, SURFACE_Y, t.z);
        t.spinRot += Math.min(t.spin, 30) * delta;
        g.rotation.y = t.spinRot;
        // wobble grows as the spin dies
        const wob = Math.min(t.tilt, 1.2);
        g.rotation.x = Math.sin(t.prec) * wob;
        g.rotation.z = Math.cos(t.prec) * wob;
      } else if (t.state === 'dying') {
        t.fallT += delta;
        g.position.set(t.x, SURFACE_Y + 0.01, t.z);
        const f = Math.min(1, t.fallT / 0.7);
        g.rotation.z = f * 1.45;
        g.rotation.y += delta * 6 * (1 - f);
        if (f >= 1 && t.fallT > 1) this.markOut(t);
      } else if (t.state === 'out') {
        t.fallT += delta;
        const f = Math.max(0, 1 - t.fallT / 0.5);
        g.scale.setScalar(f * TOP_SCALE);
        t.x += t.vx * delta;
        t.z += t.vz * delta;
        g.position.set(t.x, SURFACE_Y - (1 - f) * 0.05, t.z);
        if (f <= 0) g.visible = false;
      }
    }
    if (this.phase === 'ready') {
      const p = this.tops[0].group;
      p.position.copy(REST);
      p.position.y += Math.sin(this.elapsed * 2.2) * 0.008;
      p.rotation.y += delta * 1.2;
    }
    if (this.phase === 'live') this.afterThrowChecks();

    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}

/** Small helper so the table code above stays readable. */
class CylinderGeometryShim extends CylinderGeometry {
  constructor(radius: number, height: number, segments: number) {
    super(radius, radius, height, segments);
  }
}
