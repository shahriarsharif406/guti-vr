import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Points,
  PointsMaterial,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Entity,
  InputComponent,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PhysicsSystem,
  RingGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { readPinchPoint } from './hand.js';
import { emitBurst } from './fx.js';
import { Marble, MarbleKinds } from './marble-component.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { WORLDS, WorldId, worldState } from './worlds.js';

// ---- Layout (meters). Everything sits within arm's reach of a seated player.
const TABLE_Y = 0.72;
const TABLE_CENTER_Z = -0.55;
const TABLE_RADIUS = 0.36;
const RING_RADIUS = 0.13; // the "গোল্লা" circle
const MARBLE_R = 0.02;
const SHOOTER_START_Z = TABLE_CENTER_Z + 0.27;
// ---- Slingshot tuning
const GRAB_RADIUS = 0.2; // generous: hand-tracking jitter must not cost a shot
const SKINS: { name: string; color: number; emissive: number; at: number }[] = [
  { name: 'Pearl', color: 0xfafafa, emissive: 0xffffff, at: 0 },
  { name: 'Jade', color: 0x5fe0a0, emissive: 0x2fbf80, at: 6 },
  { name: 'Ruby', color: 0xff5a6a, emissive: 0xd02040, at: 14 },
  { name: 'Gold', color: 0xffd23f, emissive: 0xc89a10, at: 24 },
  { name: 'Galaxy', color: 0x8f7bff, emissive: 0x5a3fe0, at: 33 },
];
const MAX_PULL = 0.18;
const MIN_PULL = 0.03;
const MAX_SPEED = 3.2;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const MOUSE_METERS_PER_PX = 0.0006;

type Phase = 'aim' | 'rolling' | 'message';
type HandName = 'left' | 'right';

type Formation = 'cluster' | 'line' | 'ring' | 'cross';

interface LevelDef {
  world: WorldId;
  targets: number;
  shots: number;
  ring: number;
  formation: Formation;
  heavy: number;
  gold: number;
  rocks: [number, number][]; // x, z offsets from the ring center
  tip: string;
}

const LEVELS: LevelDef[] = [
  // ---- Village (Earth gravity)
  { world: 'earth', targets: 3, shots: 5, ring: 0.13, formation: 'cluster', heavy: 0, gold: 0, rocks: [], tip: 'Pinch the white marble, pull back, release' },
  { world: 'earth', targets: 4, shots: 6, ring: 0.13, formation: 'cluster', heavy: 0, gold: 0, rocks: [], tip: 'Aim dots show where your shot will go' },
  { world: 'earth', targets: 5, shots: 6, ring: 0.13, formation: 'line', heavy: 0, gold: 0, rocks: [[-0.085, 0.16], [0.085, 0.16]], tip: 'Rocks block the way: thread the gap' },
  { world: 'earth', targets: 5, shots: 6, ring: 0.13, formation: 'cluster', heavy: 0, gold: 1, rocks: [], tip: 'Knock out the golden marble for a bonus shot' },
  // ---- Moon (gravity 1.62)
  { world: 'moon', targets: 5, shots: 6, ring: 0.13, formation: 'cluster', heavy: 0, gold: 0, rocks: [], tip: 'Low gravity: marbles slide far. Pull gently' },
  { world: 'moon', targets: 6, shots: 7, ring: 0.115, formation: 'ring', heavy: 0, gold: 0, rocks: [[-0.1, 0.12], [0.1, 0.12]], tip: 'The ring is smaller. Soft taps are enough' },
  { world: 'moon', targets: 6, shots: 7, ring: 0.125, formation: 'cluster', heavy: 0, gold: 1, rocks: [[-0.085, 0.16], [0.085, 0.16]], tip: 'Golden marble: bonus shot' },
  // ---- Mars (gravity 3.71)
  { world: 'mars', targets: 6, shots: 7, ring: 0.13, formation: 'cluster', heavy: 2, gold: 0, rocks: [], tip: 'Heavy grey marbles need a strong hit' },
  { world: 'mars', targets: 7, shots: 8, ring: 0.13, formation: 'cross', heavy: 0, gold: 0, rocks: [[-0.09, 0.16], [0.09, 0.16]], tip: 'Rocks guard the sides: use the centre lane' },
  { world: 'mars', targets: 8, shots: 8, ring: 0.1, formation: 'ring', heavy: 0, gold: 1, rocks: [], tip: 'Tight ring, golden bonus inside' },
  // ---- Space Station (zero gravity)
  { world: 'station', targets: 5, shots: 6, ring: 0.13, formation: 'cluster', heavy: 0, gold: 0, rocks: [], tip: 'Zero gravity: no friction. Marbles keep drifting' },
  { world: 'station', targets: 8, shots: 8, ring: 0.12, formation: 'cluster', heavy: 2, gold: 1, rocks: [[-0.085, 0.16], [0.085, 0.16]], tip: 'Heavy, golden and rocks together' },
  { world: 'station', targets: 10, shots: 9, ring: 0.095, formation: 'ring', heavy: 3, gold: 1, rocks: [[-0.09, 0.17], [0.09, 0.17]], tip: 'Final level. Clear the ring!' },
];

type MarbleType = 'normal' | 'heavy' | 'gold';

function levelDef(level: number): LevelDef {
  return LEVELS[Math.min(level, LEVELS.length) - 1];
}

const CROSS: [number, number][] = [
  [0, 0], [0.045, 0], [-0.045, 0], [0, 0.045], [0, -0.045],
  [0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09],
];

/** Starting offsets (x, z) of target marbles relative to the ring center. */
function formationOffsets(def: LevelDef): [number, number][] {
  const n = def.targets;
  const out: [number, number][] = [];
  if (def.formation === 'line') {
    for (let i = 0; i < n; i++) out.push([(i - (n - 1) / 2) * 0.046, 0]);
  } else if (def.formation === 'cross') {
    for (let i = 0; i < n; i++) out.push(CROSS[i]);
  } else if (def.formation === 'ring') {
    const r = def.ring * 0.7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  } else {
    const spread = Math.min(def.ring * 0.72, 0.03 + n * 0.007);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963;
      const r = spread * Math.sqrt((i + 0.5) / n);
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return out;
}

function swirlTexture(hex: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const col = '#' + hex.toString(16).padStart(6, '0');
  g.fillStyle = col;
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 7; i++) {
    g.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.28)';
    g.lineWidth = 3 + Math.random() * 5;
    g.beginPath();
    const y0 = Math.random() * 64;
    g.moveTo(0, y0);
    g.bezierCurveTo(40, y0 + 25 * (Math.random() - 0.5), 80, y0 + 40 * (Math.random() - 0.5), 128, y0 + 10 * (Math.random() - 0.5));
    g.stroke();
  }
  return new CanvasTexture(c);
}

const MAX_LEVEL = LEVELS.length;

export class GameSystem extends createSystem({}) {
  private phase: Phase = 'aim';
  private level = 1;
  private shotsLeft = 0;
  private totalTargets = 0;
  private outCount = 0;
  private messageTimer = 0;
  private restTimer = 0;
  private rollTimer = 0;
  private won = false;
  private messageText = '';

  private shooter!: Entity;
  private targets: Entity[] = [];
  private tableEntity!: Entity;
  private hud!: TextPanel;
  private hudDirty = true;
  private lastMode = '';
  private fontWasReady = false;
  private hintRing!: Mesh;
  private ghost!: Mesh;
  private skinIdx = 0;
  private firedOnce = false;
  private noHands = false;
  private elapsed = 0;
  private prevSpeeds: number[] = [];
  private wasOut: boolean[] = [];
  private stars = 0;
  private bestStars: number[] = [];
  private modeObjects: Mesh[] = [];
  private ringMesh!: Mesh;
  private ringR = RING_RADIUS;
  private kinds: MarbleType[] = [];
  private rocks: Entity[] = [];
  private score = 0;
  private bestScore = 0;
  private shotOut = 0;
  private flashText = '';
  private flashTimer = 0;
  private levelTip = '';
  private goldMat!: MeshStandardMaterial;
  private heavyMat!: MeshStandardMaterial;
  private rockMat!: MeshStandardMaterial;
  private rockGeo!: CylinderGeometry;
  private sun!: DirectionalLight;
  private floorMat!: MeshStandardMaterial;
  private tableMat!: MeshStandardMaterial;
  private curWorld: WorldId = 'earth';
  private dots!: Points;
  private dotPos = new Float32Array(16 * 3);

  // aim arrow
  private arrowShaft!: Mesh;
  private arrowHead!: Mesh;
  private arrowMat!: MeshBasicMaterial;
  private shooterMat!: MeshStandardMaterial;

  // sharing geometry/materials across marbles
  private marbleGeo!: SphereGeometry;
  private targetMats: MeshStandardMaterial[] = [];

  // input state
  private dragging = false;
  private dragHand: HandName | 'mouse' | null = null;
  private anchor = new Vector3();
  private handPos = new Vector3();
  private shotDir = new Vector3();
  private pullLen = 0;
  private tmp = new Vector3();
  private identityQuat = new Quaternion();
  private shooterPos = new Vector3();
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private mouseDown = false;
  private mouseAnchorX = 0;
  private mouseAnchorY = 0;
  private mouseX = 0;
  private mouseY = 0;

  init(): void {
    try {
      this.bestStars = JSON.parse(localStorage.getItem('guti-stars-v2') ?? '[]');
    } catch {
      this.bestStars = [];
    }
    try {
      this.bestScore = Number(localStorage.getItem('guti-best') ?? '0') || 0;
    } catch {
      this.bestScore = 0;
    }
    // read-only probe for automated tests; allocates only when called
    (window as unknown as { __guti?: () => unknown }).__guti = () => {
      const p = this.shooter.object3D?.position;
      return {
        world: this.curWorld,
        phase: this.phase,
        level: this.level,
        shots: this.shotsLeft,
        out: this.outCount,
        shooter: p ? [p.x, p.y, p.z] : null,
        speed: this.speedOf(this.shooter),
        ringR: this.ringR,
        won: this.won,
        score: this.score,
        targets: this.targets
          .filter((t, i) => t.object3D && !this.wasOut[i])
          .map((t) => [t.object3D!.position.x, t.object3D!.position.z + 0.55]),
      };
    };
    this.buildStage();
    this.buildArrow();
    this.buildHud();
    this.modeObjects.push(
      this.hud.mesh,
      this.hintRing,
      this.ringMesh,
      this.shooter.object3D as Mesh,
    );
    this.setModeVisible(false);

    const down = (e: PointerEvent) => {
      if (this.phase !== 'aim') return;
      this.mouseDown = true;
      this.mouseAnchorX = this.mouseX = e.clientX;
      this.mouseAnchorY = this.mouseY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const up = () => {
      this.mouseDown = false;
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

  // ------------------------------------------------------------------ build
  private buildStage(): void {
    const world = this.world;

    // warm low sun, like a late afternoon in a village courtyard
    const sun = new DirectionalLight(0xffc288, 2.2);
    sun.position.set(-1.5, 2.5, 1);
    world.createTransformEntity(sun);
    this.sun = sun;

    // earthen courtyard floor (visual only)
    this.floorMat = new MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 });
    const floor = new Mesh(new CylinderGeometry(6, 6, 0.02, 48), this.floorMat);
    floor.position.set(0, -0.01, TABLE_CENTER_Z);
    world.createTransformEntity(floor);

    // the playing ground: a round disc of packed clay at hand height
    this.tableMat = new MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.95 });
    const table = new Mesh(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.04, 64), this.tableMat);
    table.position.set(0, TABLE_Y - 0.02, TABLE_CENTER_Z);
    this.tableEntity = world.createTransformEntity(table);
    this.tableEntity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Cylinder,
      dimensions: [TABLE_RADIUS, 0.04, 0],
      friction: 0.7,
      restitution: 0.2,
    });
    this.tableEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });

    // pedestal so the clay disc is not floating
    const stem = new Mesh(
      new CylinderGeometry(0.06, 0.1, TABLE_Y - 0.04, 24),
      new MeshStandardMaterial({ color: 0x5a3d2a, roughness: 1 }),
    );
    stem.position.set(0, (TABLE_Y - 0.04) / 2, TABLE_CENTER_Z);
    world.createTransformEntity(stem);

    // the goalla ring drawn in the clay
    const ring = new Mesh(
      new TorusGeometry(RING_RADIUS, 0.003, 8, 96),
      new MeshStandardMaterial({
        color: 0xfff2d6,
        emissive: 0x4a3a20,
        roughness: 0.6,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, TABLE_Y + 0.002, TABLE_CENTER_Z);
    world.createTransformEntity(ring);
    this.ringMesh = ring;

    // shared marble geometry + a palette of glass-like colors
    this.marbleGeo = new SphereGeometry(MARBLE_R, 24, 16);
    const palette = [0x3fa7ff, 0xff5a5a, 0x5fe38a, 0xffd23f, 0xc77dff];
    for (const c of palette) {
      this.targetMats.push(
        new MeshStandardMaterial({
          color: 0xffffff,
          map: swirlTexture(c),
          roughness: 0.08,
          metalness: 0.1,
          emissive: c,
          emissiveIntensity: 0.12,
        }),
      );
      // tint used for sparks
      (this.targetMats[this.targetMats.length - 1] as MeshStandardMaterial).color.set(0xffffff);
    }
    this.goldMat = new MeshStandardMaterial({
      color: 0xffc400,
      roughness: 0.25,
      metalness: 0.9,
      emissive: 0xffa000,
      emissiveIntensity: 0.35,
    });
    this.heavyMat = new MeshStandardMaterial({
      color: 0x8a8f98,
      roughness: 0.3,
      metalness: 0.95,
    });
    this.rockMat = new MeshStandardMaterial({ color: 0x6d6a66, roughness: 1 });
    this.rockGeo = new CylinderGeometry(0.026, 0.03, 0.035, 10);
    this.shooterMat = new MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.05,
      metalness: 0.2,
      emissive: 0xffffff,
      emissiveIntensity: 0.1,
    });
    this.shooter = this.spawnMarble(
      new Vector3(0, TABLE_Y + MARBLE_R + 0.001, SHOOTER_START_Z),
      MarbleKinds.Shooter,
      this.shooterMat,
      1.4,
    );
  }

  private spawnMarble(
    pos: Vector3,
    kind: (typeof MarbleKinds)[keyof typeof MarbleKinds],
    mat: MeshStandardMaterial,
    densityScale: number,
  ): Entity {
    const mesh = new Mesh(this.marbleGeo, mat);
    mesh.position.copy(pos);
    const e = this.world.createTransformEntity(mesh);
    e.addComponent(Marble, { kind });
    e.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Sphere,
      dimensions: [MARBLE_R, 0, 0],
      density: 2.5 * densityScale,
      restitution: 0.55,
      friction: 0.5,
    });
    e.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      linearDamping: WORLDS[this.curWorld].damping,
      angularDamping: 0.6,
    });
    return e;
  }

  private buildArrow(): void {
    this.arrowMat = new MeshBasicMaterial({
      color: 0x66ff88,
      transparent: true,
      opacity: 0.9,
    });
    const shaftGeo = new BoxGeometry(0.008, 0.004, 1);
    shaftGeo.translate(0, 0, 0.5);
    this.arrowShaft = new Mesh(shaftGeo, this.arrowMat);
    const headGeo = new ConeGeometry(0.02, 0.04, 16);
    headGeo.rotateX(Math.PI / 2); // cone tip along +Z
    this.arrowHead = new Mesh(headGeo, this.arrowMat);
    this.arrowShaft.visible = false;
    this.arrowHead.visible = false;
    this.world.createTransformEntity(this.arrowShaft);
    this.world.createTransformEntity(this.arrowHead);
    for (let i = 0; i < 16; i++) this.dotPos[i * 3 + 1] = -100;
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(this.dotPos, 3));
    this.dots = new Points(
      dg,
      new PointsMaterial({ color: 0xffffff, size: 0.009, transparent: true, opacity: 0.85 }),
    );
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    this.world.createTransformEntity(this.dots);
  }

  private buildHud(): void {
    this.hud = new TextPanel(0.5, 0.2);
    this.hud.mesh.position.set(0, TABLE_Y + 0.27, TABLE_CENTER_Z - 0.3);
    this.hud.mesh.rotation.x = -0.45;
    this.world.createTransformEntity(this.hud.mesh);

    this.hintRing = new Mesh(
      new RingGeometry(0.03, 0.036, 40),
      new MeshBasicMaterial({
        color: 0xffee88,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.hintRing.rotation.x = -Math.PI / 2;
    this.world.createTransformEntity(this.hintRing);
    // ghost fingertip that demonstrates pinch -> pull -> release on the first level
    this.ghost = new Mesh(
      new SphereGeometry(0.014, 16, 12),
      new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.75 }),
    );
    this.world.createTransformEntity(this.ghost);
    this.modeObjects.push(this.ghost);
  }

  private totalStars(): number {
    let t = 0;
    for (const v of this.bestStars) t += v ?? 0;
    return t;
  }

  private skinFor(total: number): number {
    let k = 0;
    for (let i = 0; i < SKINS.length; i++) if (total >= SKINS[i].at) k = i;
    return k;
  }

  private applySkin(i: number): void {
    this.skinIdx = i;
    this.shooterMat.color.setHex(SKINS[i].color);
    this.shooterMat.emissive.setHex(SKINS[i].emissive);
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('GUTI  •  ' + WORLDS[this.curWorld].name + '  •  Level ' + this.level + '/' + LEVELS.length, 70, 40);
    if (this.phase === 'message') {
      h.text(this.messageText, 150, 44, this.won ? '#8dff9d' : '#ff9d8d');
    } else {
      h.text(
        'Out ' + this.outCount + '/' + this.totalTargets + '   Shots ' + this.shotsLeft + '   ★ ' + this.totalStars() + '/' + LEVELS.length * 3,
        148,
        36,
      );
    }
    let hint = '';
    let hintColor = '#cdb99a';
    if (this.flashTimer > 0) {
      hint = this.flashText;
      hintColor = '#ffe27a';
    } else if (this.noHands) hint = 'Raise both hands in front of you';
    else if (this.phase === 'aim')
      hint = this.firedOnce && this.level > 1 ? this.levelTip : this.levelTip;
    if (this.phase === 'message' && this.won) {
      for (let i = 0; i < 3; i++) {
        this.drawStar(h.ctx, 320 + (i - 1) * 70, 205, 26, i < this.stars);
      }
    } else {
      h.text(hint, 220, 28, hintColor);
    }
    h.commit();
  }

  private drawStar(c: CanvasRenderingContext2D, x: number, y: number, r: number, filled: boolean): void {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = filled ? '#ffd23f' : 'rgba(255,255,255,0.15)';
    c.fill();
  }

  private saveStars(): void {
    const prev = this.bestStars[this.level - 1] ?? 0;
    if (this.stars > prev) this.bestStars[this.level - 1] = this.stars;
    try {
      localStorage.setItem('guti-stars-v2', JSON.stringify(this.bestStars));
    } catch {
      /* ignore */
    }
  }

  private setModeVisible(on: boolean): void {
    for (const m of this.modeObjects) m.visible = on;
  }

  // ------------------------------------------------------------------ worlds
  private applyWorld(id: WorldId, announce: boolean): void {
    const w = WORLDS[id];
    const changed = worldState.id !== id;
    this.curWorld = id;
    worldState.id = id;
    const physics = this.world.getSystem(PhysicsSystem);
    if (physics) physics.config.gravity.value = [0, -w.gravity, 0];
    this.sun.color.setHex(w.sunColor);
    this.sun.intensity = w.sunIntensity;
    this.floorMat.color.setHex(w.floorColor);
    this.tableMat.color.setHex(w.tableColor);
    this.shooter.setValue(PhysicsBody, 'linearDamping', w.damping);
    sfx.setSpace(w.space);
    if (changed && announce) {
      sfx.warp();
      this.flash(w.intro, 3.4);
    }
  }

  // ------------------------------------------------------------------ levels
  private startLevel(level: number): void {
    this.level = level;
    const def = levelDef(level);
    this.applyWorld(def.world, true);
    this.shotsLeft = def.shots;
    this.totalTargets = def.targets;
    this.outCount = 0;
    this.won = false;
    this.ringR = def.ring;
    this.levelTip = def.tip;
    this.shotOut = 0;
    const rs = def.ring / RING_RADIUS;
    this.ringMesh.scale.set(rs, rs, rs);

    for (const t of this.targets) t.dispose();
    for (const r of this.rocks) r.dispose();
    this.targets.length = 0;
    this.rocks.length = 0;
    this.prevSpeeds.length = 0;
    this.wasOut.length = 0;
    this.kinds.length = 0;

    const offs = formationOffsets(def);
    const n = def.targets;
    // heavy marbles at the front of the pack, golden one near the middle
    for (let i = 0; i < n; i++) {
      let type: MarbleType = 'normal';
      if (i < def.heavy) type = 'heavy';
      else if (i >= def.heavy && i < def.heavy + def.gold) type = 'gold';
      this.kinds.push(type);
    }
    for (let i = 0; i < n; i++) {
      this.tmp.set(offs[i][0], TABLE_Y + MARBLE_R + 0.001, TABLE_CENTER_Z + offs[i][1]);
      const type = this.kinds[i];
      const mat =
        type === 'heavy'
          ? this.heavyMat
          : type === 'gold'
            ? this.goldMat
            : this.targetMats[i % this.targetMats.length];
      const dens = type === 'heavy' ? 5 : 1;
      this.targets.push(this.spawnMarble(this.tmp, MarbleKinds.Target, mat, dens));
    }
    for (const [rx, rz] of def.rocks) {
      const m = new Mesh(this.rockGeo, this.rockMat);
      m.position.set(rx, TABLE_Y + 0.0175, TABLE_CENTER_Z + rz);
      const e = this.world.createTransformEntity(m);
      e.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Cylinder,
        dimensions: [0.028, 0.035, 0],
        friction: 0.6,
        restitution: 0.4,
      });
      e.addComponent(PhysicsBody, { state: PhysicsState.Static });
      this.rocks.push(e);
    }
    // marbles must not start on top of a rock: fine by construction (rocks sit near the shooter side)
    this.prevSpeeds.length = n;
    this.prevSpeeds.fill(0);
    this.wasOut.length = n;
    this.wasOut.fill(false);
    this.applySkin(this.skinFor(this.totalStars()));
    this.resetShooter();
    this.phase = 'aim';
    this.hudDirty = true;
  }

  private resetShooter(): void {
    const physics = this.world.getSystem(PhysicsSystem);
    if (!physics) return;
    this.tmp.set(0, TABLE_Y + MARBLE_R + 0.001, SHOOTER_START_Z);
    physics.setBodyTransform(this.shooter, {
      position: this.tmp,
      quaternion: this.identityQuat,
    });
  }

  // ------------------------------------------------------------------ input
  /** Returns true if the given hand is currently pinching (with hysteresis). */
  private readPinch(hand: HandName): boolean {
    const adapter = this.input.xr.visualAdapters.hand[hand];
    if (adapter.connected) {
      const s = adapter.getPinchStrength();
      return this.pinching[hand] ? s >= PINCH_HOLD : s >= PINCH_START;
    }
    // controller fallback: trigger acts as the pinch
    const pad = this.input.xr.gamepads[hand];
    return pad ? pad.getButtonPressed(InputComponent.Trigger) : false;
  }

  private readHandPos(hand: HandName, out: Vector3): boolean {
    const hand3d = this.input.xr.visualAdapters.hand[hand];
    // true pinch point: midpoint of thumb tip and index tip
    if (readPinchPoint(hand3d as never, out)) return true;
    const space =
      (hand3d.connected ? hand3d.gripSpace : undefined) ??
      this.player.gripSpaces[hand];
    if (!space) return false;
    space.getWorldPosition(out);
    return true;
  }

  private updateInput(): void {
    this.shooter.object3D!.getWorldPosition(this.shooterPos);
    let nearHand = false;

    if (!this.dragging) {
      // Look for a hand that starts a pinch near the shooter marble.
      for (const hand of ['right', 'left'] as HandName[]) {
        const p = this.readPinch(hand);
        const wasPinching = this.pinching[hand];
        this.pinching[hand] = p;
        if (!this.readHandPos(hand, this.handPos)) continue;
        const near = this.handPos.distanceTo(this.shooterPos) < GRAB_RADIUS;
        if (near) nearHand = true;
        if (p && !wasPinching && near) {
          this.dragging = true;
          this.dragHand = hand;
          this.anchor.copy(this.handPos);
          sfx.grab();
          break;
        }
      }
      if (!this.dragging && this.mouseDown) {
        this.dragging = true;
        this.dragHand = 'mouse';
        sfx.grab();
      }
    } else if (this.dragHand === 'mouse') {
      if (!this.mouseDown) {
        this.releaseShot();
      }
    } else {
      const hand = this.dragHand as HandName;
      const p = this.readPinch(hand);
      this.pinching[hand] = p;
      if (!p) {
        this.releaseShot();
      } else if (this.readHandPos(hand, this.handPos)) {
        // pull vector is anchor -> hand; the marble flies the opposite way
        this.shotDir.copy(this.anchor).sub(this.handPos);
        this.shotDir.y = 0;
        this.pullLen = Math.min(this.shotDir.length(), MAX_PULL);
      }
    }

    if (this.dragging && this.dragHand === 'mouse') {
      this.shotDir.set(
        (this.mouseAnchorX - this.mouseX) * MOUSE_METERS_PER_PX,
        0,
        (this.mouseAnchorY - this.mouseY) * MOUSE_METERS_PER_PX,
      );
      this.pullLen = Math.min(this.shotDir.length(), MAX_PULL);
    }

    // marble glows when a hand is close enough to grab it
    this.shooterMat.emissiveIntensity = this.dragging
      ? 0.6
      : nearHand
        ? 0.45
        : 0.1;

    this.updateArrow();
  }

  private updateArrow(): void {
    const show =
      this.dragging && this.phase === 'aim' && this.pullLen > MIN_PULL * 0.5;
    this.arrowShaft.visible = show;
    this.arrowHead.visible = show;
    this.dots.visible = show;
    if (!show) return;
    const power = this.pullLen / MAX_PULL;
    const len = 0.05 + power * 0.25;
    const yaw = Math.atan2(this.shotDir.x, this.shotDir.z);
    this.arrowShaft.position.copy(this.shooterPos);
    this.arrowShaft.position.y = TABLE_Y + 0.006;
    this.arrowShaft.rotation.set(0, yaw, 0);
    this.arrowShaft.scale.set(1, 1, len);
    this.arrowHead.position.copy(this.arrowShaft.position);
    this.arrowHead.position.x += Math.sin(yaw) * (len + 0.02);
    this.arrowHead.position.z += Math.cos(yaw) * (len + 0.02);
    this.arrowHead.rotation.set(0, yaw, 0);
    this.arrowMat.color.setHSL(0.33 - 0.33 * power, 1, 0.55); // green -> red
    // dotted aim line beyond the arrow head, length grows with power
    const nd = 3 + Math.floor(power * 13);
    const sx = Math.sin(yaw);
    const cz = Math.cos(yaw);
    for (let i = 0; i < 16; i++) {
      if (i < nd) {
        const d = 0.07 + i * 0.03 + power * 0.05;
        this.dotPos[i * 3] = this.shooterPos.x + sx * d;
        this.dotPos[i * 3 + 1] = TABLE_Y + 0.004;
        this.dotPos[i * 3 + 2] = this.shooterPos.z + cz * d;
      } else {
        this.dotPos[i * 3 + 1] = -100;
      }
    }
    (this.dots.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  private releaseShot(): void {
    const fire = this.pullLen >= MIN_PULL && this.shotDir.lengthSq() > 1e-8;
    this.dragging = false;
    this.dragHand = null;
    this.mouseDown = false;
    if (fire && this.phase === 'aim') {
      const power = this.pullLen / MAX_PULL;
      this.shotDir.normalize().multiplyScalar(MAX_SPEED * (0.15 + 0.85 * power));
      this.shooter.addComponent(PhysicsManipulation, {
        linearVelocity: [this.shotDir.x, 0, this.shotDir.z],
      });
      this.shotsLeft -= 1;
      this.shotOut = 0;
      this.firedOnce = true;
      sfx.shot(power);
      this.phase = 'rolling';
      this.rollTimer = 0;
      this.restTimer = 0;
      this.hudDirty = true;
    }
    this.pullLen = 0;
  }

  // ------------------------------------------------------------------ rules
  private isOut(e: Entity): boolean {
    const o = e.object3D;
    if (!o) return true;
    const dx = o.position.x;
    const dz = o.position.z - TABLE_CENTER_Z;
    return (
      o.position.y < TABLE_Y - 0.1 ||
      Math.sqrt(dx * dx + dz * dz) > this.ringR + MARBLE_R * 0.5
    );
  }

  private offTable(e: Entity): boolean {
    const o = e.object3D;
    if (!o) return true;
    const dx = o.position.x;
    const dz = o.position.z - TABLE_CENTER_Z;
    const lim = TABLE_RADIUS + 0.12;
    return dx * dx + dz * dz > lim * lim;
  }

  private speedOf(e: Entity): number {
    const v = e.getVectorView(PhysicsBody, '_linearVelocity');
    return Math.hypot(v[0], v[1], v[2]);
  }

  private updateRolling(delta: number): void {
    this.rollTimer += delta;
    let moving = false;
    // in zero gravity a marble can float off the table for good: stop waiting for it
    if (this.speedOf(this.shooter) > 0.04 && !this.offTable(this.shooter)) moving = true;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.object3D) continue;
      const sp = this.speedOf(t);
      if (sp > 0.04 && !this.offTable(t)) moving = true;
      if (sp - this.prevSpeeds[i] > 0.12) sfx.clack((sp - this.prevSpeeds[i]) / 1.5);
      this.prevSpeeds[i] = sp;
    }
    this.restTimer = moving ? 0 : this.restTimer + delta;
    const shooterFell =
      (this.shooter.object3D?.position.y ?? 0) < TABLE_Y - 0.1 ||
      this.offTable(this.shooter);
    if (this.restTimer > 0.5 || this.rollTimer > 9 || shooterFell) {
      this.resolveShot();
    }
  }

  /** Detects newly-out marbles: sparks, sound, combo, bonus shot. Returns how many are out. */
  private scanOut(): number {
    let out = 0;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const o = this.isOut(t);
      if (o) out++;
      if (o && !this.wasOut[i] && t.object3D) {
        const pos = t.object3D.position;
        const kind = this.kinds[i];
        const c = ((t.object3D as Mesh).material as MeshStandardMaterial).emissive;
        emitBurst(pos.x, Math.max(pos.y, TABLE_Y), pos.z, c.r + 0.3, c.g + 0.3, c.b + 0.3, 18, 0.55);
        this.shotOut += 1;
        this.score += 100 * this.shotOut;
        if (kind === 'gold') {
          this.shotsLeft += 1;
          this.score += 300;
          this.flash('Golden marble! Bonus shot', 1.6);
          sfx.win();
          emitBurst(pos.x, TABLE_Y + 0.03, pos.z, 1, 0.8, 0.2, 40, 0.8);
        } else if (this.shotOut === 2) {
          this.flash('Double!', 1.2);
          sfx.select();
        } else if (this.shotOut === 3) {
          this.flash('Triple!', 1.2);
          sfx.select();
        } else if (this.shotOut > 3) {
          this.flash('Combo x' + this.shotOut + '!', 1.2);
          sfx.select();
        } else {
          sfx.select();
        }
        this.hudDirty = true;
      }
      this.wasOut[i] = o;
    }
    if (out !== this.outCount) {
      this.outCount = out;
      this.hudDirty = true;
    }
    return out;
  }

  private flash(text: string, seconds: number): void {
    this.flashText = text;
    this.flashTimer = seconds;
    this.hudDirty = true;
  }

  private resolveShot(): void {
    const out = this.scanOut();
    if (out >= this.totalTargets) {
      this.won = true;
      this.score += this.shotsLeft * 150;
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        try {
          localStorage.setItem('guti-best', String(this.bestScore));
        } catch {
          /* ignore */
        }
      }
      this.stars = this.shotsLeft >= 2 ? 3 : this.shotsLeft === 1 ? 2 : 1;
      const oldSkin = this.skinIdx;
      this.saveStars();
      const newSkin = this.skinFor(this.totalStars());
      emitBurst(0, TABLE_Y + 0.12, TABLE_CENTER_Z, 1, 0.85, 0.35, 70, 0.9);
      const nextWorldDiffers =
        this.level < MAX_LEVEL && levelDef(this.level + 1).world !== levelDef(this.level).world;
      this.messageText =
        this.level >= MAX_LEVEL
          ? 'Champion! Score ' + this.score
          : nextWorldDiffers || this.level === 1
            ? WORLDS[this.curWorld].fact
            : 'Level clear!  Best ' + this.bestScore;
      if (newSkin > oldSkin) {
        this.messageText = 'New marble unlocked: ' + SKINS[newSkin].name + '!';
        this.applySkin(newSkin);
      }
      sfx.win();
      this.beginMessage(nextWorldDiffers || newSkin > oldSkin ? 2.6 : 1.8);
    } else if (this.shotsLeft <= 0) {
      this.won = false;
      this.messageText = 'Out of shots — try again';
      sfx.lose();
      this.beginMessage(2);
    } else {
      this.resetShooter();
      this.phase = 'aim';
    }
    this.hudDirty = true;
  }

  private beginMessage(seconds: number): void {
    this.phase = 'message';
    this.messageTimer = seconds;
  }

  // ------------------------------------------------------------------ frame
  update(delta: number): void {
    this.elapsed += delta;
    if (modeState.mode !== this.lastMode) {
      const wasGuti = this.lastMode === 'guti';
      this.lastMode = modeState.mode;
      if (modeState.mode === 'guti') {
        this.setModeVisible(true);
        for (const t of this.targets) if (t.object3D) t.object3D.visible = true;
        for (const r of this.rocks) if (r.object3D) r.object3D.visible = true;
        this.firedOnce = false;
        this.score = 0;
        let first = 1;
        while (first < LEVELS.length && (this.bestStars[first - 1] ?? 0) > 0) first++;
        // deep link: ?level=5 jumps straight to a level (handy for demos and testing)
        try {
          const q = Number(new URLSearchParams(window.location.search).get('level'));
          if (q >= 1 && q <= LEVELS.length) first = Math.floor(q);
        } catch {
          /* ignore */
        }
        this.startLevel(first);
      } else if (wasGuti || this.lastMode !== 'guti') {
        this.setModeVisible(false);
        for (const t of this.targets) if (t.object3D) t.object3D.visible = false;
        this.arrowShaft.visible = false;
        this.arrowHead.visible = false;
        this.dots.visible = false;
        for (const r of this.rocks) if (r.object3D) r.object3D.visible = false;
        this.dragging = false;
        this.dragHand = null;
        this.applyWorld('earth', false);
      }
    }
    if (modeState.mode !== 'guti') return;
    // headset removed or system menu open: freeze timers and input
    if (this.world.visibilityState.value === 'visible-blurred') return;

    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
    }

    // XR with no hands/controllers in view: ask the player to raise their hands
    const hl = this.input.xr.visualAdapters.hand.left.connected;
    const hr = this.input.xr.visualAdapters.hand.right.connected;
    const gp = !!(this.input.xr.gamepads.left || this.input.xr.gamepads.right);
    const inXR = this.world.visibilityState.value !== 'non-immersive';
    const nh = inXR && !hl && !hr && !gp;
    if (nh !== this.noHands) {
      this.noHands = nh;
      this.hudDirty = true;
    }

    if (this.phase === 'aim') {
      this.updateInput();
    } else {
      this.arrowShaft.visible = false;
      this.arrowHead.visible = false;
      this.dots.visible = false;
      this.dragging = false;
    }

    // pulsing hint ring on the shooter for the very first shot
    const showHint =
      this.phase === 'aim' && !this.firedOnce && !this.dragging && this.level === 1;
    this.hintRing.visible = showHint;
    if (showHint) {
      this.shooter.object3D!.getWorldPosition(this.shooterPos);
      this.hintRing.position.set(
        this.shooterPos.x,
        TABLE_Y + 0.004,
        this.shooterPos.z,
      );
      const k = 1 + 0.35 * Math.sin(this.elapsed * 5);
      this.hintRing.scale.set(k, k, k);
    }

    // ghost hand: a looping wordless demo until the first shot is fired
    this.ghost.visible = showHint;
    if (showHint) {
      const k = (this.elapsed % 3) / 3; // 0..1 loop
      const pull = k < 0.25 ? 0 : k < 0.7 ? (k - 0.25) / 0.45 : 0;
      this.ghost.position.set(
        this.shooterPos.x,
        TABLE_Y + 0.03,
        this.shooterPos.z + 0.02 + pull * 0.18,
      );
      const sc = k < 0.25 ? 1 + 0.2 * Math.sin(k * 40) : k < 0.7 ? 0.7 : 1.2;
      this.ghost.scale.set(sc, sc, sc);
    }

    if (this.phase === 'rolling') {
      this.updateRolling(delta);
    } else if (this.phase === 'message') {
      this.messageTimer -= delta;
      if (this.messageTimer <= 0) {
        if (this.won) {
          this.startLevel(this.level >= MAX_LEVEL ? 1 : this.level + 1);
        } else {
          this.startLevel(this.level);
        }
      }
    }

    if (this.phase === 'rolling') this.scanOut();

    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0) this.hudDirty = true;
    }

    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
