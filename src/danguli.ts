import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Entity,
  LatheGeometry,
  Pressed,
  RayInteractable,
  SRGBColorSpace,
  Vector2,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState, setMode } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { DanOpt } from './ui-components.js';

// ---- Pitch layout (metres, in front of the seated player)
const TABLE_Y = 0.72;
const SURFACE_Y = 0.745;
const CX = 0;
const CZ = -0.7;
const TABLE_R = 0.46;
const GULI_START = new Vector3(0, SURFACE_Y + 0.012, -0.62);
const GULI_LEN = 0.1;
const GULI_R = 0.012;
const DANDA_LEN = 0.42;
/** the stick tip, relative to the pinch point (the stick points forward and a little down) */
const TIP_OFF = new Vector3(0, -0.1, -0.41);
const GRIP_REST = new Vector3(0, 0.87, -0.1);
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const ATTEMPTS = 3;
const G = 9.81;
/** the game shows kid-size "metres": world distance times this */
const DIST_SCALE = 2;
const STRIKE1_SPEED = 0.8;
const STRIKE2_SPEED = 1.0;
const MAX_V = 14;

type HandName = 'left' | 'right';
type Phase = 'ready' | 'air' | 'flight' | 'message';
type DMode = 'classic' | 'distance' | 'precision' | 'free';

const MODES: { id: DMode; name: string; rule: string }[] = [
  { id: 'distance', name: 'Distance Challenge', rule: 'Hit it far. Points for distance' },
  { id: 'classic', name: 'Classic Danguli', rule: 'Traditional: distance counted in danda lengths' },
  { id: 'precision', name: 'Precision (modern)', rule: 'Land the guli inside the target ring' },
  { id: 'free', name: 'Free Play', rule: 'Practise as long as you like' },
];
const DIFFS: { name: string; s1: number; s2: number; hit: number; lift: number }[] = [
  { name: 'Easy', s1: 0.6, s2: 0.7, hit: 0.1, lift: 1.15 },
  { name: 'Normal', s1: 0.8, s2: 1.0, hit: 0.075, lift: 1 },
  { name: 'Hard', s1: 1.0, s2: 1.3, hit: 0.058, lift: 0.9 },
];

/** Procedural wood: long grain streaks, growth rings and a few knots. Used as colour and bump. */
function woodTexture(r: number, g: number, b: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  x.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 110; i++) {
    const px = Math.random() * 128;
    const amp = 1 + Math.random() * 3;
    const ph = Math.random() * 6;
    x.strokeStyle = 'rgba(' + (r * 0.45) + ',' + (g * 0.4) + ',' + (b * 0.35) + ',' + (0.06 + Math.random() * 0.2) + ')';
    x.lineWidth = 0.6 + Math.random() * 2.2;
    x.beginPath();
    for (let y = 0; y <= 512; y += 16) {
      const xx = px + Math.sin(y * 0.02 + ph) * amp;
      if (y === 0) x.moveTo(xx, y);
      else x.lineTo(xx, y);
    }
    x.stroke();
  }
  for (let k = 0; k < 2; k++) {
    const kx = 20 + Math.random() * 88;
    const ky = 60 + Math.random() * 400;
    const gr = x.createRadialGradient(kx, ky, 1, kx, ky, 14);
    gr.addColorStop(0, 'rgba(60,34,16,0.8)');
    gr.addColorStop(1, 'rgba(60,34,16,0)');
    x.fillStyle = gr;
    x.fillRect(kx - 16, ky - 16, 32, 32);
  }
  // worn, darker ends
  const wear = x.createLinearGradient(0, 0, 0, 512);
  wear.addColorStop(0, 'rgba(40,24,10,0.35)');
  wear.addColorStop(0.12, 'rgba(40,24,10,0)');
  wear.addColorStop(0.9, 'rgba(40,24,10,0)');
  wear.addColorStop(1, 'rgba(40,24,10,0.4)');
  x.fillStyle = wear;
  x.fillRect(0, 0, 128, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const tmpA = new Vector3();
const segV = new Vector3();
const segW = new Vector3();
const segC = new Vector3();

/** Shortest distance from point p to the segment a-b (uses its own scratch vectors). */
function segDist(a: Vector3, b: Vector3, p: Vector3): number {
  segV.subVectors(b, a);
  const l2 = segV.lengthSq();
  let t = 0;
  if (l2 > 1e-9) {
    segW.subVectors(p, a);
    t = Math.max(0, Math.min(1, segW.dot(segV) / l2));
  }
  segC.copy(a).addScaledVector(segV, t);
  return segC.distanceTo(p);
}

const TRAIL = 40;

export class DanguliSystem extends createSystem({
  opts: { required: [DanOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private danda = new Group();
  private guli = new Group();
  private trail!: Line;
  private trailPos = new Float32Array(TRAIL * 3);
  private trailN = 0;
  private trailT = 0;
  private markers: Group[] = [];

  private phase: Phase = 'ready';
  private lastMode = '';
  private fontWasReady = false;
  private elapsed = 0;
  private hudDirty = true;
  private attempt = 1;
  private score = 0;
  private bests: Record<string, number> = {};
  private bestDist = 0;
  private roundBestDist = 0;
  private msg = '';
  private msgT = 0;
  private finalShown = false;
  private lifted = false;
  private hitAir = false;
  private airT = 0;
  private restT = 0;
  private lastDist = 0;
  private mode: DMode = 'distance';
  private diff = 1;
  private optBtns: TextPanel[] = [];
  private optCooldown = 0;
  private target = new Group();
  private targetPos = new Vector3();
  private targetR = 1;
  private lastLabel = '';

  // guli state
  private pos = new Vector3();
  private vel = new Vector3();
  private spin = 0;
  private rot = 0;

  // input
  private held: HandName | 'mouse' | null = null;
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private grab = new Vector3(GRIP_REST.x, GRIP_REST.y, GRIP_REST.z);
  private tip = new Vector3();
  private prevTip = new Vector3();
  private tipVel = new Vector3();
  private handPos = new Vector3();
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private mouseOff = new Vector3();
  private histT = new Float32Array(8);
  private histP = new Float32Array(8 * 3);
  private histN = 0;
  private histI = 0;
  private forced: Vector3 | null = null;

  init(): void {
    // wooden pitch: a round table with a clay hole (gorto) for the guli
    const wood = new MeshStandardMaterial({ color: 0xa8764a, roughness: 0.85 });
    const top = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R, 0.04, 56), wood);
    top.position.set(CX, TABLE_Y, CZ);
    this.add(top);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 0.72, 8), wood);
      leg.position.set(CX + Math.cos(a) * 0.3, TABLE_Y * 0.5 - 0.02, CZ + Math.sin(a) * 0.3);
      this.add(leg);
    }
    const dirt = new Mesh(new CircleGeometry(0.4, 48), new MeshStandardMaterial({ color: 0x9a7048, roughness: 1 }));
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(CX, SURFACE_Y - 0.002, CZ);
    this.add(dirt);
    const hole = new Mesh(new CircleGeometry(0.032, 20), new MeshBasicMaterial({ color: 0x2a1a0e }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(GULI_START.x, SURFACE_Y + 0.0005, GULI_START.z);
    this.add(hole);
    const ring = new Mesh(new RingGeometry(0.036, 0.042, 24), new MeshBasicMaterial({ color: 0xf4efe0 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(GULI_START.x, SURFACE_Y + 0.001, GULI_START.z);
    this.add(ring);

    // guli: a short wooden peg, thick in the middle and pointed at both ends
    const gTex = woodTexture(214, 168, 100);
    const gm = new MeshStandardMaterial({ map: gTex, bumpMap: gTex, bumpScale: 1.2, roughness: 0.72, metalness: 0 });
    const gp: Vector2[] = [
      [0.0006, -0.05],
      [0.0045, -0.04],
      [0.0095, -0.026],
      [0.0122, -0.01],
      [0.0126, 0.01],
      [0.0095, 0.026],
      [0.0045, 0.04],
      [0.0006, 0.05],
    ].map(([rr, yy]) => new Vector2(rr, yy));
    const gMesh = new Mesh(new LatheGeometry(gp, 14), gm);
    gMesh.rotation.z = -Math.PI / 2;
    this.guli.add(gMesh);
    const band = new Mesh(new CylinderGeometry(GULI_R * 1.02, GULI_R * 1.02, 0.008, 14), new MeshStandardMaterial({ color: 0xb23a2a, roughness: 0.6 }));
    band.rotation.z = Math.PI / 2;
    this.guli.add(band);
    this.addGroup(this.guli);

    // danda: a long wooden stick, slimmer at the grip and thicker at the striking end
    const dTex = woodTexture(150, 100, 58);
    const dm = new MeshStandardMaterial({ map: dTex, bumpMap: dTex, bumpScale: 1.4, roughness: 0.78, metalness: 0 });
    const dp: Vector2[] = [
      [0.0008, 0],
      [0.0095, 0.006],
      [0.0108, 0.06],
      [0.0122, 0.2],
      [0.0142, 0.36],
      [0.0152, 0.41],
      [0.0125, 0.421],
      [0.0008, 0.424],
    ].map(([rr, yy]) => new Vector2(rr, yy));
    const stick = new Mesh(new LatheGeometry(dp, 14), dm);
    stick.rotation.x = -Math.PI / 2;
    stick.position.z = 0.02;
    this.danda.add(stick);
    this.danda.rotation.x = Math.atan2(TIP_OFF.y, -TIP_OFF.z);
    this.addGroup(this.danda);

    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(this.trailPos, 3));
    this.trail = new Line(tg, new LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    this.world.createTransformEntity(this.trail);
    this.root.push(this.trail);

    // landing flags for each attempt
    for (let i = 0; i < ATTEMPTS; i++) {
      const f = new Group();
      const pole = new Mesh(new CylinderGeometry(0.01, 0.01, 1, 6), new MeshBasicMaterial({ color: 0xffffff }));
      pole.position.y = 0.5;
      f.add(pole);
      const cloth = new Mesh(new ConeGeometry(0.16, 0.34, 3), new MeshBasicMaterial({ color: 0xff4d4d }));
      cloth.rotation.z = -Math.PI / 2;
      cloth.position.set(0.17, 0.85, 0);
      f.add(cloth);
      f.visible = false;
      this.addGroup(f);
      this.markers.push(f);
    }

    this.hud = new TextPanel(0.5, 0.22);
    this.hud.mesh.position.set(-0.6, 1.0, -0.75);
    this.hud.mesh.rotation.y = 0.6;
    this.hud.mesh.rotation.x = -0.1;
    this.world.createTransformEntity(this.hud.mesh);
    this.root.push(this.hud.mesh);
    this.setVisible(false);

    // option buttons: game mode and difficulty
    for (let i = 0; i < 2; i++) {
      const panel = new TextPanel(0.22, 0.07, 512);
      panel.mesh.position.set(-0.56 + i * 0.0, 0.86 - i * 0.085, -0.6);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(DanOpt, { id: i });
      this.optBtns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'danguli' || this.optCooldown > 0 || this.phase === 'flight' || this.phase === 'air') return;
        this.optCooldown = 0.3;
        sfx.select();
        const id = entity.getValue(DanOpt, 'id') as number;
        if (id === 0) this.mode = MODES[(MODES.findIndex((m) => m.id === this.mode) + 1) % MODES.length].id;
        else this.diff = (this.diff + 1) % DIFFS.length;
        try {
          localStorage.setItem('guti-danguli-cfg', JSON.stringify({ mode: this.mode, diff: this.diff }));
        } catch {
          /* ignore */
        }
        this.startRound();
      }),
    );
    // target ring for the Precision mode (flat on the ground)
    const tr = new Mesh(new RingGeometry(0.92, 1, 40), new MeshBasicMaterial({ color: 0xffe27a, side: 2, transparent: true, opacity: 0.9 }));
    tr.rotation.x = -Math.PI / 2;
    this.target.add(tr);
    const td = new Mesh(new CircleGeometry(0.92, 40), new MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.25, side: 2 }));
    td.rotation.x = -Math.PI / 2;
    this.target.add(td);
    this.target.visible = false;
    this.addGroup(this.target);
    try {
      const cfg = JSON.parse(localStorage.getItem('guti-danguli-cfg') ?? '{}') as { mode?: DMode; diff?: number };
      if (cfg.mode && MODES.some((m) => m.id === cfg.mode)) this.mode = cfg.mode;
      if (typeof cfg.diff === 'number' && cfg.diff >= 0 && cfg.diff < DIFFS.length) this.diff = cfg.diff;
    } catch {
      /* ignore */
    }
    try {
      this.bests = JSON.parse(localStorage.getItem('guti-danguli-bests') ?? '{}') as Record<string, number>;
      this.bestDist = Number(localStorage.getItem('guti-danguli-dist') ?? '0') || 0;
    } catch {
      this.bests = {};
    }

    (window as unknown as { __danguli?: () => unknown }).__danguli = () => ({
      phase: this.phase,
      attempt: this.attempt,
      score: this.score,
      dist: this.lastDist,
      best: this.bests[this.mode] ?? 0,
      mode: this.mode,
      held: this.held,
      lifted: this.lifted,
      hitAir: this.hitAir,
      guli: [this.pos.x, this.pos.y, this.pos.z],
      tip: [this.tip.x, this.tip.y, this.tip.z],
    });
    // test hook: pretend the stick sweeps through the guli with this velocity
    (window as unknown as { __dangForce?: (x: number, y: number, z: number) => void }).__dangForce = (x, y, z) => {
      this.forced = new Vector3(x, y, z);
    };
    const down = (e: PointerEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (modeState.mode === 'danguli' && this.held === null && this.phase !== 'message') {
        this.held = 'mouse';
        this.mouseOff.set(0, 0, 0);
        this.histN = 0;
      }
    };
    const move = (e: PointerEvent) => {
      if (this.mouseDown && this.held === 'mouse') {
        this.mouseOff.x += (e.clientX - this.mouseX) * 0.003;
        this.mouseOff.z += (e.clientY - this.mouseY) * 0.003;
        this.mouseOff.x = Math.max(-0.5, Math.min(0.5, this.mouseOff.x));
        this.mouseOff.z = Math.max(-0.8, Math.min(0.3, this.mouseOff.z));
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const up = () => {
      this.mouseDown = false;
      if (this.held === 'mouse') this.held = null;
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

  private add(m: Mesh): void {
    this.world.createTransformEntity(m);
    this.root.push(m);
  }

  private addGroup(g: Group): void {
    this.world.createTransformEntity(g);
    this.root.push(g);
  }

  private setVisible(on: boolean): void {
    for (const o of this.root) o.visible = on;
    if (on) for (const m of this.markers) m.visible = false;
    this.target.visible = false;
  }

  private say(text: string, seconds: number): void {
    this.msg = text;
    this.msgT = seconds;
    this.hudDirty = true;
  }

  // ------------------------------------------------------------------ rounds
  private startRound(): void {
    this.attempt = 1;
    this.score = 0;
    this.roundBestDist = 0;
    this.finalShown = false;
    for (const m of this.markers) m.visible = false;
    this.drawOpts();
    this.prepare();
  }

  private prepare(): void {
    this.phase = 'ready';
    this.lifted = false;
    this.hitAir = false;
    this.pos.copy(GULI_START);
    this.vel.set(0, 0, 0);
    this.spin = 0;
    this.rot = 0;
    this.trailN = 0;
    this.trail.visible = false;
    if (this.mode === 'precision') {
      const d = [3, 4.5, 6][this.diff];
      this.targetR = [1.3, 1, 0.7][this.diff];
      this.targetPos.set((Math.random() - 0.5) * 2.4, 0.012, GULI_START.z - d);
      this.target.position.copy(this.targetPos);
      this.target.scale.set(this.targetR, 1, this.targetR);
      this.target.visible = true;
    } else this.target.visible = false;
    this.say('Pinch the stick. Flick the guli tip to pop it up', 4);
  }

  private haptic(strength: number, ms: number): void {
    if (this.held === null || this.held === 'mouse') return;
    try {
      const pad = this.input.xr.gamepads[this.held] as unknown as { gamepad?: { hapticActuators?: { pulse?: (v: number, d: number) => void }[] } } | undefined;
      pad?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
    } catch {
      /* haptics are optional */
    }
  }

  private drawOpts(): void {
    const md = MODES.find((m) => m.id === this.mode) ?? MODES[0];
    const labels = [['MODE', md.name], ['LEVEL', DIFFS[this.diff].name]];
    for (let i = 0; i < 2; i++) {
      const p = this.optBtns[i];
      p.card('rgba(40,24,12,0.9)', '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 34, '#ffe9c4');
      p.commit();
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

  private pushHist(p: Vector3): void {
    this.histT[this.histI] = this.elapsed;
    this.histP[this.histI * 3] = p.x;
    this.histP[this.histI * 3 + 1] = p.y;
    this.histP[this.histI * 3 + 2] = p.z;
    this.histI = (this.histI + 1) % 8;
    this.histN = Math.min(8, this.histN + 1);
  }

  /** Stick velocity from the last ~90 ms of hand positions. */
  private computeVel(): void {
    this.tipVel.set(0, 0, 0);
    if (this.histN < 2) return;
    const newest = (this.histI + 7) % 8;
    let oldest = newest;
    for (let k = 1; k < this.histN; k++) {
      const i = (newest - k + 8) % 8;
      if (this.elapsed - this.histT[i] > 0.09) break;
      oldest = i;
    }
    const dt = this.histT[newest] - this.histT[oldest];
    if (dt < 0.012) return;
    this.tipVel.set(
      (this.histP[newest * 3] - this.histP[oldest * 3]) / dt,
      (this.histP[newest * 3 + 1] - this.histP[oldest * 3 + 1]) / dt,
      (this.histP[newest * 3 + 2] - this.histP[oldest * 3 + 2]) / dt,
    );
  }

  private updateInput(delta: number): void {
    if (this.phase === 'message') return;
    if (this.held === null) {
      for (const hand of ['right', 'left'] as HandName[]) {
        const p = this.readPinch(hand);
        const was = this.pinching[hand];
        this.pinching[hand] = p;
        if (p && !was) {
          this.held = hand;
          this.histN = 0;
          break;
        }
      }
    } else if (this.held !== 'mouse') {
      const hand = this.held;
      const p = this.readPinch(hand);
      this.pinching[hand] = p;
      if (!p) this.held = null;
      else if (this.readHandPos(hand, this.handPos)) this.grab.copy(this.handPos);
    }
    if (this.held === 'mouse') {
      this.grab.set(GRIP_REST.x + this.mouseOff.x, GRIP_REST.y, GRIP_REST.z + this.mouseOff.z);
      // desktop assist: the stick height follows the guli while it is in the air
      if (this.phase === 'air') {
        const wantY = this.pos.y + 0.1;
        this.grab.y = this.danda.position.y + (wantY - this.danda.position.y) * Math.min(1, delta * 10);
      }
    }
    this.prevTip.copy(this.tip);
    if (this.held !== null) {
      this.danda.position.copy(this.grab);
      this.tip.copy(this.grab).add(TIP_OFF);
      this.pushHist(this.grab);
      this.computeVel();
    } else {
      // resting on the table edge until picked up
      this.danda.position.set(0.28, SURFACE_Y + 0.03, -0.25);
      this.tip.set(0.28, SURFACE_Y + 0.03, -0.66);
      this.prevTip.copy(this.tip);
      this.tipVel.set(0, 0, 0);
    }
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      this.held = 'mouse';
      if (this.phase === 'ready') tmpA.set(this.pos.x + GULI_LEN * 0.45, this.pos.y, this.pos.z);
      else tmpA.copy(this.pos);
      this.tip.copy(tmpA);
      this.prevTip.copy(tmpA).addScaledVector(f, -0.02);
      this.tipVel.copy(f);
    }
  }

  // ------------------------------------------------------------------ strikes
  private checkStrikes(): void {
    if (this.held === null) return;
    const speed = this.tipVel.length();
    if (this.phase === 'ready') {
      // first strike: flick the raised end of the guli
      tmpA.set(this.pos.x + GULI_LEN * 0.45, this.pos.y, this.pos.z);
      const df = DIFFS[this.diff];
      if (speed > STRIKE1_SPEED * (df.s1 / 0.8) && this.tipVel.y < 0.9 && segDist(this.prevTip, this.tip, tmpA) < 0.055) {
        this.vel.set(this.tipVel.x * 0.12, (2.9 + Math.min(speed, 4) * 0.25) * df.lift, this.tipVel.z * 0.12);
        this.spin = 16;
        this.lifted = true;
        this.phase = 'air';
        this.airT = 0;
        if (this.mode === 'distance' || this.mode === 'precision') this.score += 10;
        sfx.wood(0.5 + Math.min(speed, 4) * 0.12);
        this.haptic(0.5, 40);
        emitBurst(this.pos.x, this.pos.y, this.pos.z, 1, 0.85, 0.5, 14, 0.5);
        this.say('Up it goes! Swing again, now!', 1.4);
      }
    } else if (this.phase === 'air' && this.airT > 0.12) {
      if (speed > STRIKE2_SPEED * DIFFS[this.diff].s2 && segDist(this.prevTip, this.tip, this.pos) < DIFFS[this.diff].hit) {
        this.vel.copy(this.tipVel).multiplyScalar(2.4);
        this.vel.y += 1.2 + (this.pos.y - this.tip.y) * 8;
        if (this.vel.length() > MAX_V) this.vel.setLength(MAX_V);
        // contact point decides the tumble: a hit under the guli's centre spins it faster
        this.spin = Math.min(46, 14 + Math.abs(this.pos.y - this.tip.y) * 220 + speed * 2.5) * (this.tipVel.x >= 0 ? 1 : -1);
        this.hitAir = true;
        this.phase = 'flight';
        this.restT = 0;
        this.trailN = 0;
        this.trailT = 0;
        this.trail.visible = true;
        if (this.mode === 'distance' || this.mode === 'precision') this.score += 20;
        sfx.wood(1);
        sfx.whoosh();
        this.haptic(1, 70);
        emitBurst(this.pos.x, this.pos.y, this.pos.z, 1, 0.9, 0.4, 28, 0.8);
        this.say('Great hit!', 1.2);
      }
    }
  }

  // ------------------------------------------------------------------ flight
  private groundAt(x: number, z: number): number {
    const d = Math.hypot(x - CX, z - CZ);
    return d < TABLE_R ? SURFACE_Y + GULI_R : GULI_R;
  }

  private step(dt: number): void {
    if (this.phase !== 'air' && this.phase !== 'flight') return;
    const v = this.vel;
    const speed = v.length();
    v.y -= G * dt;
    const drag = 1 - Math.min(0.5, 0.05 * dt * speed + 0.12 * dt);
    v.x *= drag;
    v.z *= drag;
    this.pos.addScaledVector(v, dt);
    this.rot += this.spin * dt;
    if (this.phase === 'air') this.airT += dt;
    const gy = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      if (this.phase === 'air') {
        this.land();
        return;
      }
      if (v.y < -0.6) {
        v.y = -v.y * 0.32;
        v.x *= 0.7;
        v.z *= 0.7;
        this.spin *= 0.5;
        sfx.thud(Math.min(1, -v.y / 3 + 0.3));
      } else {
        v.y = 0;
        const f = Math.exp(-5 * dt);
        v.x *= f;
        v.z *= f;
        this.spin *= f;
        if (Math.hypot(v.x, v.z) < 0.12) {
          this.restT += dt;
          if (this.restT > 0.35) this.land();
        }
      }
    }
  }

  private land(): void {
    const world = Math.hypot(this.pos.x - GULI_START.x, this.pos.z - GULI_START.z);
    const d = this.hitAir ? world * DIST_SCALE : 0;
    this.lastDist = Math.round(d * 10) / 10;
    this.phase = 'message';
    this.trail.visible = false;
    let pts = 0;
    let text = '';
    if (this.hitAir) {
      if (this.mode === 'classic') {
        const lengths = Math.round(world / DANDA_LEN);
        pts = lengths;
        text = 'Landed ' + lengths + ' dandas away  +' + lengths;
      } else if (this.mode === 'precision') {
        const miss = Math.hypot(this.pos.x - this.targetPos.x, this.pos.z - this.targetPos.z);
        const inside = miss <= this.targetR;
        pts = Math.max(0, Math.round(100 - miss * 25)) + (inside ? 50 : 0);
        text = (inside ? 'In the ring!  +' : 'Off by ' + miss.toFixed(1) + ' m  +') + pts;
      } else if (this.mode === 'free') {
        text = 'Landed ' + this.lastDist + ' m';
      } else {
        let bonus = 0;
        if (d > 30) bonus = 30;
        else if (d > 20) bonus = 20;
        else if (d > 10) bonus = 10;
        pts = Math.floor(d) + bonus;
        text = 'Landed ' + this.lastDist + ' m  +' + (pts + 30);
      }
    }
    this.score += pts;
    if (this.lastDist > this.roundBestDist) this.roundBestDist = this.lastDist;
    const flag = this.markers[(this.attempt - 1) % ATTEMPTS];
    if (flag && this.hitAir) {
      flag.position.set(this.pos.x, 0, this.pos.z);
      flag.scale.setScalar(1 + d * 0.05);
      flag.visible = true;
    }
    if (this.hitAir) {
      sfx.win();
      this.say(text, 3);
    } else {
      sfx.lose();
      this.say(this.lifted ? 'Missed in the air! Swing sooner' : 'Missed', 2.5);
    }
    this.hudDirty = true;
  }

  private nextAttempt(): void {
    if (this.mode !== 'free' && this.attempt >= ATTEMPTS) {
      if (!this.finalShown) {
        this.finalShown = true;
        if (this.score > (this.bests[this.mode] ?? 0)) {
          this.bests[this.mode] = this.score;
          try {
            localStorage.setItem('guti-danguli-bests', JSON.stringify(this.bests));
          } catch {
            /* ignore */
          }
        }
        if (this.roundBestDist > this.bestDist) {
          this.bestDist = this.roundBestDist;
          try {
            localStorage.setItem('guti-danguli-dist', String(this.bestDist));
          } catch {
            /* ignore */
          }
        }
        this.phase = 'message';
        this.say('Round over: ' + this.score + ' pts' + (this.mode === 'classic' ? ' (dandas)' : ', best throw ' + this.roundBestDist + ' m'), 6);
        return;
      }
      this.startRound();
      return;
    }
    this.attempt++;
    if (this.mode === 'free') for (const m of this.markers) m.visible = false;
    this.prepare();
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    const md = MODES.find((m) => m.id === this.mode) ?? MODES[0];
    h.text('Danguli  ডাংগুলি', 48, 38);
    h.text(this.mode === 'free' ? 'Free play   Last ' + this.lastDist + ' m' : 'Try ' + this.attempt + '/' + ATTEMPTS + '   Score ' + this.score, 104, 32);
    if (this.msgT > 0) h.text(this.msg, 158, 26, this.msg.startsWith('Missed') ? '#ff9d8d' : '#8dff9d');
    else h.text('Best ' + (this.bests[this.mode] ?? 0) + ' pts / ' + this.bestDist + ' m', 158, 24, '#cdb99a');
    h.text(this.phase === 'air' ? 'Swing at it in the air!' : md.rule, 204, 20, '#cdb99a');
    h.commit();
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.optCooldown = Math.max(0, this.optCooldown - delta);
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'danguli';
      this.setVisible(on);
      this.held = null;
      this.mouseDown = false;
      if (on) this.startRound();
    }
    if (modeState.mode !== 'danguli') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawOpts();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;

    if (this.msgT > 0) {
      this.msgT -= delta;
      if (this.msgT <= 0) {
        this.hudDirty = true;
        if (this.phase === 'message') this.nextAttempt();
      }
    }

    this.updateInput(delta);
    this.checkStrikes();
    let dt = Math.min(delta, 0.05);
    while (dt > 0) {
      const s = Math.min(dt, 1 / 240);
      this.step(s);
      dt -= s;
      if (this.phase === 'message') break;
    }

    // visuals
    const g = this.guli;
    g.position.copy(this.pos);
    g.rotation.set(0, 0, 0);
    if (this.phase === 'ready') {
      g.rotation.z = 0.12; // resting across the hole, raised end up
    } else {
      g.rotation.z = this.rot;
      g.rotation.y = 0.4;
    }
    const far = Math.hypot(this.pos.x - GULI_START.x, this.pos.z - GULI_START.z);
    g.scale.setScalar(1 + Math.min(far, 14) * 0.25);
    if (this.phase === 'flight') {
      this.trailT += delta;
      if (this.trailT > 0.03) {
        this.trailT = 0;
        if (this.trailN < TRAIL) this.trailN++;
        for (let i = this.trailN - 1; i > 0; i--) {
          this.trailPos[i * 3] = this.trailPos[(i - 1) * 3];
          this.trailPos[i * 3 + 1] = this.trailPos[(i - 1) * 3 + 1];
          this.trailPos[i * 3 + 2] = this.trailPos[(i - 1) * 3 + 2];
        }
        this.trailPos[0] = this.pos.x;
        this.trailPos[1] = this.pos.y;
        this.trailPos[2] = this.pos.z;
        for (let i = this.trailN; i < TRAIL; i++) {
          this.trailPos[i * 3] = this.pos.x;
          this.trailPos[i * 3 + 1] = this.pos.y;
          this.trailPos[i * 3 + 2] = this.pos.z;
        }
        (this.trail.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      }
    }
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
