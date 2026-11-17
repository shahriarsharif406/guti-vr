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
  Pressed,
  RayInteractable,
  RingGeometry,
  Quaternion,
  Group,
  SphereGeometry,
  CircleGeometry,
  PMREMGenerator,
  Scene,
  Texture,
  EquirectangularReflectionMapping,
  AssetManager,
  BackSide,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { LevelTile } from './ui-components.js';
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

type Phase = 'aim' | 'rolling' | 'message' | 'ai';
type HandName = 'left' | 'right';

type Formation = 'cluster' | 'line' | 'ring' | 'cross';

type Kind = 'ring' | 'pit' | 'race' | 'duel';
type Grp = 'classic' | 'gorto' | 'tip' | 'race' | 'duel' | 'fantasy';

interface LevelDef {
  world: WorldId;
  grp: Grp;
  kind: Kind;
  targets: number;
  shots: number;
  ring: number;
  rc?: [number, number]; // ring centre offset from the table centre
  formation: Formation;
  heavy: number;
  gold: number;
  rocks: [number, number][]; // x, z offsets from the table centre
  pit?: { x: number; z: number; r: number }; // গর্ত: the hole (marbles in 'pit', your marble in 'race')
  ai?: number; // duel: aiming error of the opponent, degrees
  tip: string;
}

const GROUPS: { id: Grp; label: string }[] = [
  { id: 'classic', label: 'Classic • গোল্লা' },
  { id: 'gorto', label: 'Hole • গর্ত' },
  { id: 'tip', label: 'Precision • টিপ' },
  { id: 'race', label: 'Race' },
  { id: 'duel', label: 'Duel • 1v1' },
  { id: 'fantasy', label: 'Fantasy' },
];

const L = (o: Partial<LevelDef> & Pick<LevelDef, 'world' | 'targets' | 'shots' | 'tip'>): LevelDef => ({
  grp: 'classic',
  kind: 'ring',
  ring: 0.13,
  formation: 'cluster',
  heavy: 0,
  gold: 0,
  rocks: [],
  ...o,
});
const TWO_ROCKS: [number, number][] = [[-0.085, 0.16], [0.085, 0.16]];

const LEVELS: LevelDef[] = [
  // ================= Classic: knock the marbles out of the goalla ring
  // ---- Village (Earth gravity)
  L({ world: 'earth', targets: 3, shots: 5, tip: 'Pinch the white marble, pull back, release' }),
  L({ world: 'earth', targets: 4, shots: 6, tip: 'Aim dots show where your shot will go' }),
  L({ world: 'earth', targets: 5, shots: 6, formation: 'line', rocks: TWO_ROCKS, tip: 'Rocks block the way: thread the gap' }),
  L({ world: 'earth', targets: 5, shots: 6, gold: 1, tip: 'Knock out the golden marble for a bonus shot' }),
  // ---- Harvest field (dry, slides far)
  L({ world: 'moon', targets: 5, shots: 6, tip: 'Dry ground: marbles slide far. Pull gently' }),
  L({ world: 'moon', targets: 6, shots: 7, ring: 0.115, formation: 'ring', rocks: [[-0.1, 0.12], [0.1, 0.12]], tip: 'The ring is smaller. Soft taps are enough' }),
  L({ world: 'moon', targets: 6, shots: 7, ring: 0.125, gold: 1, rocks: TWO_ROCKS, tip: 'Golden marble: bonus shot' }),
  // ---- Monsoon mud
  L({ world: 'mars', targets: 6, shots: 9, heavy: 2, tip: 'Heavy stone marbles need a strong hit' }),
  L({ world: 'mars', targets: 7, shots: 9, formation: 'cross', rocks: [[-0.09, 0.16], [0.09, 0.16]], tip: 'Rocks guard the sides: use the centre lane' }),
  L({ world: 'mars', targets: 8, shots: 9, ring: 0.1, formation: 'ring', gold: 1, tip: 'Tight ring, golden bonus inside' }),
  // ---- Dhaka rooftop (slippery)
  L({ world: 'station', targets: 5, shots: 6, tip: 'Slippery cement: marbles keep sliding' }),
  L({ world: 'station', targets: 8, shots: 8, ring: 0.12, heavy: 2, gold: 1, rocks: TWO_ROCKS, tip: 'Heavy, golden and rocks together' }),
  L({ world: 'station', targets: 10, shots: 9, ring: 0.095, formation: 'ring', heavy: 3, gold: 1, rocks: [[-0.09, 0.17], [0.09, 0.17]], tip: 'Final level. Clear the ring!' }),

  // ================= Hole (গর্ত): roll the marbles into the hole
  L({ grp: 'gorto', kind: 'pit', world: 'earth', targets: 3, shots: 7, formation: 'line', pit: { x: 0, z: -0.2, r: 0.05 }, tip: 'Gorto: roll every marble into the hole' }),
  L({ grp: 'gorto', kind: 'pit', world: 'earth', targets: 4, shots: 8, formation: 'line', rocks: [[0.02, -0.1]], pit: { x: 0.12, z: -0.22, r: 0.045 }, tip: 'Gorto: go around the rock. Gentle taps drop in' }),
  L({ grp: 'gorto', kind: 'pit', world: 'earth', targets: 5, shots: 9, gold: 1, rocks: [[-0.04, -0.12], [0.07, -0.1]], pit: { x: -0.1, z: -0.22, r: 0.04 }, tip: 'Gorto: smaller hole, golden bonus shot' }),
  L({ grp: 'gorto', kind: 'pit', world: 'earth', targets: 6, shots: 10, heavy: 1, rocks: [[-0.1, -0.06], [0.1, -0.06], [0, -0.14]], pit: { x: 0, z: -0.25, r: 0.04 }, tip: 'Gorto: guarded hole, one heavy stone' }),

  // ================= Precision (টিপ): knock a marble out of a small, far ring
  L({ grp: 'tip', world: 'earth', targets: 1, shots: 3, ring: 0.05, rc: [0, -0.2], formation: 'line', tip: 'Tip: hit the marble out of the small ring' }),
  L({ grp: 'tip', world: 'earth', targets: 1, shots: 3, ring: 0.05, rc: [0.14, -0.2], formation: 'line', tip: 'Tip: angle shot, three tries' }),
  L({ grp: 'tip', world: 'earth', targets: 2, shots: 4, ring: 0.06, rc: [-0.13, -0.18], formation: 'line', rocks: [[-0.04, -0.02]], tip: 'Tip: two marbles, one rock in the way' }),
  L({ grp: 'tip', world: 'earth', targets: 1, shots: 3, ring: 0.045, rc: [0, -0.25], formation: 'line', rocks: [[-0.075, -0.1], [0.075, -0.1]], tip: 'Tip: shoot straight through the gate' }),
  L({ grp: 'tip', world: 'earth', targets: 3, shots: 5, ring: 0.075, rc: [0.1, -0.2], heavy: 1, rocks: [[-0.04, -0.05]], tip: 'Tip: a heavy stone among three' }),

  // ================= Race: roll YOUR marble into the hole in as few shots as possible
  L({ grp: 'race', kind: 'race', world: 'earth', targets: 0, shots: 6, pit: { x: 0, z: -0.22, r: 0.05 }, tip: 'Race: your marble stays where it stops' }),
  L({ grp: 'race', kind: 'race', world: 'earth', targets: 0, shots: 6, rocks: [[0, -0.06]], pit: { x: 0.1, z: -0.22, r: 0.045 }, tip: 'Race: curve around the rock' }),
  L({ grp: 'race', kind: 'race', world: 'earth', targets: 0, shots: 6, rocks: [[-0.06, -0.05], [0.07, -0.05]], pit: { x: -0.12, z: -0.2, r: 0.045 }, tip: 'Race: through the gate, then left' }),
  L({ grp: 'race', kind: 'race', world: 'moon', targets: 0, shots: 7, rocks: [[-0.08, 0.1], [0.08, 0.0], [-0.08, -0.1], [0.04, -0.17]], pit: { x: 0.14, z: -0.2, r: 0.04 }, tip: 'Race: zig-zag on dry ground, go gently' }),
  L({ grp: 'race', kind: 'race', world: 'mars', targets: 0, shots: 7, rocks: [[-0.2, -0.1], [-0.14, -0.1], [-0.08, -0.1], [-0.02, -0.1], [0.1, 0.05]], pit: { x: 0, z: -0.26, r: 0.04 }, tip: 'Race: find the gap in the wall' }),

  // ================= Duel: you against Rafiq, take turns, most marbles out wins
  L({ grp: 'duel', kind: 'duel', world: 'earth', targets: 5, shots: 3, ai: 12, tip: 'Duel: Rafiq is a beginner. Out more marbles to win' }),
  L({ grp: 'duel', kind: 'duel', world: 'earth', targets: 6, shots: 4, ring: 0.12, ai: 7, tip: 'Duel: Rafiq knows the village' }),
  L({ grp: 'duel', kind: 'duel', world: 'moon', targets: 6, shots: 4, ring: 0.12, formation: 'ring', ai: 4, tip: 'Duel: dry ground, Rafiq is good' }),
  L({ grp: 'duel', kind: 'duel', world: 'station', targets: 7, shots: 5, ring: 0.115, ai: 2, tip: 'Duel: the champion of the rooftop' }),

  // ================= Fantasy (optional): real space gravity
  L({ grp: 'fantasy', world: 'luna', targets: 4, shots: 6, tip: 'Moon: low gravity, marbles glide far' }),
  L({ grp: 'fantasy', world: 'luna', targets: 6, shots: 7, ring: 0.115, formation: 'ring', rocks: [[-0.1, 0.12], [0.1, 0.12]], tip: 'Moon: tight ring, soft taps' }),
  L({ grp: 'fantasy', world: 'ares', targets: 5, shots: 7, tip: 'Mars: a third of Earth gravity' }),
  L({ grp: 'fantasy', world: 'ares', targets: 7, shots: 9, heavy: 2, formation: 'cross', tip: 'Mars: heavy stones in a cross' }),
  L({ grp: 'fantasy', world: 'orbit', targets: 4, shots: 6, tip: 'Space station: zero gravity, nothing falls' }),
  L({ grp: 'fantasy', world: 'orbit', targets: 7, shots: 9, ring: 0.1, formation: 'ring', gold: 1, tip: 'Space station: final fantasy level' }),
];

/** Global (1-based) level numbers belonging to each group, in order. */
const GROUP_LEVELS: number[][] = GROUPS.map((g) => LEVELS.map((d, i) => (d.grp === g.id ? i + 1 : 0)).filter((n) => n > 0));
const groupOf = (level: number): number => GROUPS.findIndex((g) => g.id === LEVELS[level - 1].grp);

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

function clayTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#f0e8e0';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 150 + Math.random() * 100;
    g.fillStyle = 'rgba(' + v + ',' + (v - 10) + ',' + (v - 25) + ',' + (0.15 + Math.random() * 0.35) + ')';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  // scuffs from thousands of earlier games
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = 'rgba(90,60,40,' + (0.05 + Math.random() * 0.1) + ')';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const MAX_LEVEL = LEVELS.length;

export class GameSystem extends createSystem({
  tilePressed: { required: [LevelTile, Pressed] },
}) {
  private tiles: { entity: Entity; panel: TextPanel }[] = [];
  private tileCooldown = 0;
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
  private earthEnv: Texture | null = null;
  private shadows: Mesh[] = [];
  private showFps = new URLSearchParams(location.search).has('fps');
  private fpsAcc = 0;
  private fpsN = 0;
  private fpsText = '';
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
  private pitMesh!: Group;
  private pit: LevelDef['pit'] = undefined;
  private kind: Kind = 'ring';
  private group = 0;
  private rc: [number, number] = [0, 0];
  private tabs: { entity: Entity; panel: TextPanel }[] = [];
  private shooterIn = false;
  private sawMotion = false;
  private raceT = 0;
  private raceSec = -1;
  private lastRest: [number, number] = [0, SHOOTER_START_Z];
  private duelTurn: 'me' | 'ai' = 'me';
  private aiLeft = 0;
  private meScore = 0;
  private aiScore = 0;
  private aiTimer = 0;
  private aiVel = new Vector3();
  private potted: boolean[] = [];
  private homes: [number, number][] = [];
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
  private floorMesh!: Mesh;
  private tableMesh!: Mesh;
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
      this.bestStars = JSON.parse(localStorage.getItem('guti-stars-v3') ?? '[]');
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
        kind: this.kind,
        group: this.group,
        shooterIn: this.shooterIn,
        duel: [this.meScore, this.aiScore, this.aiLeft, this.duelTurn],
        potted: this.potted.filter(Boolean).length,
        calls: this.world.renderer.info.render.calls,
        tris: this.world.renderer.info.render.triangles,
        targets: this.targets
          .filter((t, i) => t.object3D && !this.wasOut[i])
          .map((t) => [t.object3D!.position.x, t.object3D!.position.z + 0.55]),
      };
    };
    this.buildStage();
    this.buildArrow();
    this.buildHud();
    this.buildLevelMap();
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
    this.floorMesh = floor;
    floor.scale.set(0.4, 1, 0.4);
    floor.position.set(0, -0.01, TABLE_CENTER_Z);
    world.createTransformEntity(floor);

    // the playing ground: a round disc of packed clay at hand height
    this.tableMat = new MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.95, map: clayTexture() });
    const table = new Mesh(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.04, 64), this.tableMat);
    this.tableMesh = table;
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

    // the gorto (hole) for the hole game: a dark pit with a raised rim, scaled per level
    const pitG = new Group();
    const pitDisc = new Mesh(new CircleGeometry(1, 40), new MeshStandardMaterial({ color: 0x140b06, roughness: 1 }));
    pitDisc.rotation.x = -Math.PI / 2;
    pitDisc.position.y = 0.0015;
    const pitRim = new Mesh(new TorusGeometry(1, 0.07, 8, 48), new MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 }));
    pitRim.rotation.x = Math.PI / 2;
    pitRim.position.y = 0.002;
    pitG.add(pitDisc, pitRim);
    pitG.visible = false;
    world.createTransformEntity(pitG);
    this.pitMesh = pitG;

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
    this.applyReflections();
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

  /**
   * Gives glass and metal marbles something to reflect: a small sunset-sky
   * environment (warm horizon, bright sun, dark ground) baked once into a PMREM map.
   */
  private applyReflections(): void {
    try {
      let env = null as Texture | null;
      const hdr = AssetManager.getAsset('sunsetHdr') as Texture | undefined;
      if (hdr) {
        hdr.mapping = EquirectangularReflectionMapping;
        const pm0 = new PMREMGenerator(this.world.renderer);
        env = pm0.fromEquirectangular(hdr).texture;
        pm0.dispose();
        this.earthEnv = env;
      }
      if (!env) env = this.gradientEnv();
      this.finishReflections(env);
    } catch {
      // reflections are a nicety; the marbles still render without them
    }
  }

  private gradientEnv(): Texture {
    {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 256;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#5b86c9');
      grad.addColorStop(0.45, '#ffb27a');
      grad.addColorStop(0.5, '#ffd9a8');
      grad.addColorStop(0.52, '#4a3224');
      grad.addColorStop(1, '#2a1c14');
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 256);
      const sun = g.createRadialGradient(130, 100, 2, 130, 100, 40);
      sun.addColorStop(0, 'rgba(255,250,230,1)');
      sun.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = sun;
      g.fillRect(60, 40, 140, 120);
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const sc = new Scene();
      sc.add(new Mesh(new SphereGeometry(10, 32, 16), new MeshBasicMaterial({ map: tex, side: BackSide })));
      const pm = new PMREMGenerator(this.world.renderer);
      const env = pm.fromScene(sc, 0, 0.1, 50).texture;
      pm.dispose();
      return env;
    }
  }

  private finishReflections(env: Texture): void {
    for (const m of [...this.targetMats, this.goldMat, this.heavyMat, this.shooterMat]) {
      m.envMap = env;
      m.envMapIntensity = m === this.heavyMat || m === this.goldMat ? 1.2 : 0.9;
      m.needsUpdate = true;
    }
    // the village (houses, trees, clay) is lit by the same sky
    this.world.scene.environmentIntensity = 0.55;
    if (this.earthEnv) this.world.scene.environment = this.earthEnv;
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
    // soft contact shadows under every marble: they ground the marbles on the clay
    const sg = new CircleGeometry(MARBLE_R * 1.35, 20);
    const sm = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
    for (let i = 0; i < 24; i++) {
      const m = new Mesh(sg, sm);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.world.createTransformEntity(m);
      this.shadows.push(m);
      this.modeObjects.push(m);
    }
  }

  private updateShadows(): void {
    let k = 0;
    const put = (e: Entity, gone: boolean): void => {
      const o = e.object3D;
      const m = this.shadows[k++];
      if (!m) return;
      if (!o || gone || o.position.y > TABLE_Y + 0.12 || this.offTable(e)) {
        m.visible = false;
        return;
      }
      m.visible = true;
      m.position.set(o.position.x, TABLE_Y + 0.0015, o.position.z);
      const lift = Math.max(0, o.position.y - (TABLE_Y + MARBLE_R));
      const sc = 1 + lift * 6;
      m.scale.set(sc, sc, sc);
    };
    put(this.shooter, false);
    for (let i = 0; i < this.targets.length; i++) put(this.targets[i], this.wasOut[i]);
    for (; k < this.shadows.length; k++) this.shadows[k].visible = false;
  }

  private isLocked(lv: number): boolean {
    const list = GROUP_LEVELS[groupOf(lv)];
    const pos = list.indexOf(lv);
    return pos > 0 && (this.bestStars[list[pos - 1] - 1] ?? 0) <= 0;
  }

  private buildLevelMap(): void {
    const cols = 5;
    const maxN = Math.max(...GROUP_LEVELS.map((g) => g.length));
    for (let i = 0; i < maxN; i++) {
      const panel = new TextPanel(0.06, 0.06, 128);
      const c = i % cols;
      const r = Math.floor(i / cols);
      panel.mesh.position.set(-0.46 + c * 0.07, TABLE_Y + 0.2 - r * 0.07, TABLE_CENTER_Z - 0.05);
      panel.mesh.rotation.x = -0.5;
      const e = this.world.createTransformEntity(panel.mesh);
      e.addComponent(RayInteractable);
      e.addComponent(LevelTile, { level: i + 1 });
      this.tiles.push({ entity: e, panel });
      this.modeObjects.push(panel.mesh);
    }
    // one tab per way of playing marbles
    for (let g = 0; g < GROUPS.length; g++) {
      const panel = new TextPanel(0.2, 0.052, 400);
      panel.mesh.position.set(0.57, TABLE_Y + 0.3 - g * 0.056, TABLE_CENTER_Z - 0.05);
      panel.mesh.rotation.x = -0.5;
      panel.mesh.rotation.y = -0.3;
      const e = this.world.createTransformEntity(panel.mesh);
      e.addComponent(RayInteractable);
      e.addComponent(LevelTile, { level: -(g + 1) });
      this.tabs.push({ entity: e, panel });
      this.modeObjects.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.tilePressed.subscribe('qualify', (e) => {
        if (this.tileCooldown > 0 || modeState.mode !== 'guti') return;
        const lv = e.getValue(LevelTile, 'level') as number;
        if (lv < 0) {
          const g = -lv - 1;
          if (g === this.group) return;
          this.tileCooldown = 0.5;
          sfx.select();
          const list = GROUP_LEVELS[g];
          this.startLevel(list.find((n) => (this.bestStars[n - 1] ?? 0) <= 0 && !this.isLocked(n)) ?? list[0]);
          return;
        }
        if (this.isLocked(lv)) return;
        if (lv === this.level && this.phase === 'aim') return;
        this.tileCooldown = 0.5;
        sfx.select();
        this.startLevel(lv);
      }),
    );
  }

  /** Point the level tiles at the levels of the current group. */
  private refreshTiles(): void {
    const list = GROUP_LEVELS[this.group];
    for (let i = 0; i < this.tiles.length; i++) {
      if (i < list.length) this.tiles[i].entity.setValue(LevelTile, 'level', list[i]);
      this.tiles[i].panel.mesh.visible = modeState.mode === 'guti' && i < list.length;
    }
  }

  private drawTiles(): void {
    const list = GROUP_LEVELS[this.group];
    for (let i = 0; i < list.length; i++) {
      const p = this.tiles[i].panel;
      const lv = list[i];
      const locked = this.isLocked(lv);
      const cur = lv === this.level;
      p.card(locked ? 'rgba(20,14,10,0.7)' : 'rgba(40,24,12,0.9)', cur ? '#7fd8ff' : locked ? '#6b5a48' : '#ffd9a0');
      p.text(locked ? '🔒' : String(i + 1), 62, 52, locked ? '#8a7860' : '#ffe9c4');
      const st = this.bestStars[lv - 1] ?? 0;
      p.text('★'.repeat(st) + '·'.repeat(3 - st), 108, 26, '#ffd23f');
      p.commit();
    }
    for (let g = 0; g < this.tabs.length; g++) {
      const p = this.tabs[g].panel;
      const cur = g === this.group;
      p.card(cur ? 'rgba(60,40,18,0.95)' : 'rgba(30,18,10,0.85)', cur ? '#7fd8ff' : '#8a7a60');
      p.text(GROUPS[g].label, 60, 36, cur ? '#ffffff' : '#cdb99a');
      p.commit();
    }
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
    const gl = GROUP_LEVELS[this.group];
    h.text('GUTI  •  ' + WORLDS[this.curWorld].name + '  •  Level ' + (gl.indexOf(this.level) + 1) + '/' + gl.length + this.fpsText, 70, 40);
    if (this.phase === 'message') {
      h.text(this.messageText, 150, 44, this.won ? '#8dff9d' : '#ff9d8d');
    } else {
      const stars = '   ★ ' + this.totalStars() + '/' + LEVELS.length * 3;
      let line: string;
      if (this.kind === 'race') {
        const t = Math.floor(this.raceT);
        line = 'Shots ' + this.shotsLeft + '   Time ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') + stars;
      } else if (this.kind === 'duel') {
        line = 'You ' + this.meScore + '   Rafiq ' + this.aiScore + '   Shots ' + this.shotsLeft;
      } else {
        line = (this.kind === 'pit' ? 'In hole ' : 'Out ') + this.outCount + '/' + this.totalTargets + '   Shots ' + this.shotsLeft + stars;
      }
      h.text(line, 148, 36);
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
      localStorage.setItem('guti-stars-v3', JSON.stringify(this.bestStars));
    } catch {
      /* ignore */
    }
  }

  private setModeVisible(on: boolean): void {
    for (const m of this.modeObjects) m.visible = on;
    this.ringMesh.visible = on && !this.pit;
    this.pitMesh.visible = on && !!this.pit;
    this.refreshTiles();
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
    // the real-sky lighting only belongs to the village
    this.world.scene.environment = this.earthEnv;
    this.floorMat.color.setHex(w.floorColor);
    const fs = id === 'station' || id === 'orbit' ? 1 : 0.4;
    this.floorMesh.scale.set(fs, 1, fs);
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
    this.pit = def.pit;
    this.kind = def.kind;
    this.group = groupOf(level);
    this.rc = def.rc ?? [0, 0];
    this.ringMesh.position.set(this.rc[0], TABLE_Y + 0.002, TABLE_CENTER_Z + this.rc[1]);
    this.shooterIn = false;
    this.raceT = 0;
    this.raceSec = -1;
    this.lastRest = [0, SHOOTER_START_Z];
    this.duelTurn = 'me';
    this.aiLeft = def.shots;
    this.meScore = 0;
    this.aiScore = 0;
    this.refreshTiles();
    this.ringMesh.visible = !def.pit;
    this.pitMesh.visible = !!def.pit;
    if (def.pit) {
      this.pitMesh.position.set(def.pit.x, TABLE_Y, TABLE_CENTER_Z + def.pit.z);
      this.pitMesh.scale.set(def.pit.r, def.pit.r, def.pit.r);
    }
    this.potted.length = 0;
    this.homes.length = 0;

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
      this.homes.push([this.rc[0] + offs[i][0], this.rc[1] + offs[i][1]]);
      this.potted.push(false);
      this.tmp.set(this.rc[0] + offs[i][0], TABLE_Y + MARBLE_R + 0.001, TABLE_CENTER_Z + this.rc[1] + offs[i][1]);
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

  /** Teleport a marble onto the table with all motion cleared (no tunnelling through the clay). */
  private place(e: Entity, x: number, z: number): void {
    const physics = this.world.getSystem(PhysicsSystem);
    if (!physics) return;
    this.tmp.set(x, TABLE_Y + MARBLE_R + 0.001, z);
    physics.setBodyTransform(e, { position: this.tmp, quaternion: this.identityQuat });
    e.addComponent(PhysicsManipulation, { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
  }

  private resetShooter(): void {
    const physics = this.world.getSystem(PhysicsSystem);
    if (!physics) return;
    this.tmp.set(0, TABLE_Y + MARBLE_R + 0.001, SHOOTER_START_Z);
    physics.setBodyTransform(this.shooter, {
      position: this.tmp,
      quaternion: this.identityQuat,
    });
    this.shooter.addComponent(PhysicsManipulation, { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
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
      emitBurst(this.shooterPos.x, TABLE_Y + 0.01, this.shooterPos.z, 0.85, 0.7, 0.5, 10, 0.12);
      this.phase = 'rolling';
      this.rollTimer = 0;
      this.restTimer = 0;
      this.sawMotion = false;
      this.hudDirty = true;
    }
    this.pullLen = 0;
  }

  // ------------------------------------------------------------------ rules
  private isOut(e: Entity): boolean {
    const o = e.object3D;
    if (!o) return true;
    const dx = o.position.x - this.rc[0];
    const dz = o.position.z - TABLE_CENTER_Z - this.rc[1];
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
      if (this.pit && this.potted[i]) continue;
      const sp = this.speedOf(t);
      if (this.pit && this.checkPot(i, sp)) continue;
      if (sp > 0.04 && !this.offTable(t)) moving = true;
      if (sp - this.prevSpeeds[i] > 0.12) {
        sfx.clack((sp - this.prevSpeeds[i]) / 1.5);
        const q = t.object3D.position;
        emitBurst(q.x, q.y, q.z, 1, 0.96, 0.85, 5, 0.25);
      }
      this.prevSpeeds[i] = sp;
    }
    const sh = this.shooter.object3D;
    if (sh && this.speedOf(this.shooter) > 0.7) {
      emitBurst(sh.position.x, TABLE_Y + 0.008, sh.position.z, 0.8, 0.68, 0.5, 1, 0.05);
    }
    if (this.kind === 'race' && !this.shooterIn && this.checkShooterPot()) {
      this.resolveShot();
      return;
    }
    if (moving) this.sawMotion = true;
    // the launch velocity is applied on the next physics step: do not call a shot finished before it moved
    this.restTimer = moving || (!this.sawMotion && this.rollTimer < 1.2) ? 0 : this.restTimer + delta;
    const shooterFell =
      (this.shooter.object3D?.position.y ?? 0) < TABLE_Y - 0.1 ||
      this.offTable(this.shooter);
    if (this.restTimer > 0.5 || this.rollTimer > 9 || shooterFell) {
      this.resolveShot();
    }
  }

  /** Pit game: a slow-enough marble over the hole drops in and is gone. */
  private checkPot(i: number, sp: number): boolean {
    const pit = this.pit;
    const t = this.targets[i];
    if (!pit || !t.object3D) return false;
    const p = t.object3D.position;
    const d = Math.hypot(p.x - pit.x, p.z - (TABLE_CENTER_Z + pit.z));
    if (d > pit.r - 0.004 || sp > 0.8) return false;
    this.potted[i] = true;
    const physics = this.world.getSystem(PhysicsSystem);
    if (physics) {
      this.tmp.set(pit.x, TABLE_Y - 0.3, TABLE_CENTER_Z + pit.z);
      physics.setBodyTransform(t, { position: this.tmp, quaternion: this.identityQuat });
    }
    sfx.plop();
    emitBurst(pit.x, TABLE_Y + 0.01, TABLE_CENTER_Z + pit.z, 0.9, 0.7, 0.4, 14, 0.35);
    return true;
  }

  /** Pit game: marbles that left the table come back to where they started. */
  private returnStrays(): void {
    const physics = this.world.getSystem(PhysicsSystem);
    if (!physics) return;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (this.potted[i] || !t.object3D) continue;
      if (this.offTable(t) || t.object3D.position.y < TABLE_Y - 0.1) {
        this.place(t, this.homes[i][0], TABLE_CENTER_Z + this.homes[i][1]);
      }
    }
  }

  /** Race: your own marble drops into the hole. */
  private checkShooterPot(): boolean {
    const pit = this.pit;
    const o = this.shooter.object3D;
    if (!pit || !o) return false;
    const d = Math.hypot(o.position.x - pit.x, o.position.z - (TABLE_CENTER_Z + pit.z));
    if (d > pit.r - 0.004 || this.speedOf(this.shooter) > 0.8) return false;
    this.shooterIn = true;
    const physics = this.world.getSystem(PhysicsSystem);
    if (physics) {
      this.tmp.set(pit.x, TABLE_Y - 0.3, TABLE_CENTER_Z + pit.z);
      physics.setBodyTransform(this.shooter, { position: this.tmp, quaternion: this.identityQuat });
    }
    sfx.plop();
    emitBurst(pit.x, TABLE_Y + 0.01, TABLE_CENTER_Z + pit.z, 0.9, 0.7, 0.4, 14, 0.35);
    return true;
  }

  /** Race: the marble stays where it stopped; one that left the table goes back. */
  private keepShooter(): void {
    const o = this.shooter.object3D;
    const physics = this.world.getSystem(PhysicsSystem);
    if (!o || !physics) return;
    if (o.position.y < TABLE_Y - 0.1 || this.offTable(this.shooter)) {
      this.place(this.shooter, this.lastRest[0], this.lastRest[1]);
    } else {
      this.lastRest = [o.position.x, o.position.z];
    }
  }

  /** Detects newly-out marbles: sparks, sound, combo, bonus shot. Returns how many are out. */
  private scanOut(): number {
    let out = 0;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const o = this.pit ? this.potted[i] : this.isOut(t);
      if (o) out++;
      if (o && !this.wasOut[i] && t.object3D) {
        const pos = t.object3D.position;
        const kind = this.kinds[i];
        const c = ((t.object3D as Mesh).material as MeshStandardMaterial).emissive;
        emitBurst(pos.x, Math.max(pos.y, TABLE_Y), pos.z, c.r + 0.3, c.g + 0.3, c.b + 0.3, 18, 0.55);
        this.shotOut += 1;
        if (this.kind === 'duel') {
          this.flash(this.duelTurn === 'me' ? 'You knocked one out!' : 'Rafiq knocked one out', 1.2);
          sfx.select();
        } else {
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

  private nextInGroup(): number {
    const list = GROUP_LEVELS[this.group];
    const pos = list.indexOf(this.level);
    return pos + 1 < list.length ? list[pos + 1] : 0;
  }

  private resolveShot(): void {
    if (this.kind === 'pit') this.returnStrays();
    const out = this.scanOut();
    if (this.kind === 'duel') {
      this.resolveDuel(out);
      return;
    }
    const solved = this.kind === 'race' ? this.shooterIn : out >= this.totalTargets;
    if (solved) {
      this.score += this.shotsLeft * 150;
      this.winLevel(this.shotsLeft >= 2 ? 3 : this.shotsLeft === 1 ? 2 : 1);
    } else if (this.shotsLeft <= 0) {
      this.won = false;
      this.messageText = 'Out of shots — try again';
      sfx.lose();
      this.beginMessage(2);
    } else {
      if (this.kind === 'race') this.keepShooter();
      else this.resetShooter();
      this.phase = 'aim';
    }
    this.hudDirty = true;
  }

  private winLevel(stars: number, customMsg?: string): void {
    this.won = true;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      try {
        localStorage.setItem('guti-best', String(this.bestScore));
      } catch {
        /* ignore */
      }
    }
    this.stars = stars;
    const oldSkin = this.skinIdx;
    this.saveStars();
    const newSkin = this.skinFor(this.totalStars());
    emitBurst(0, TABLE_Y + 0.12, TABLE_CENTER_Z, 1, 0.85, 0.35, 70, 0.9);
    const next = this.nextInGroup();
    const nextWorldDiffers = next > 0 && levelDef(next).world !== levelDef(this.level).world;
    this.messageText =
      customMsg ??
      (next === 0
        ? 'Set complete! Score ' + this.score
        : nextWorldDiffers || this.level === 1
          ? WORLDS[this.curWorld].fact
          : 'Level clear!  Best ' + this.bestScore);
    if (newSkin > oldSkin) {
      this.messageText = 'New marble unlocked: ' + SKINS[newSkin].name + '!';
      this.applySkin(newSkin);
    }
    sfx.win();
    this.beginMessage(nextWorldDiffers || newSkin > oldSkin ? 2.6 : 1.8);
    this.hudDirty = true;
  }

  // ------------------------------------------------------------------ duel (you vs Rafiq)
  private resolveDuel(out: number): void {
    const mine = this.duelTurn === 'me';
    if (mine) this.meScore += this.shotOut;
    else this.aiScore += this.shotOut;
    this.shotOut = 0;
    const done = out >= this.totalTargets || (this.shotsLeft <= 0 && this.aiLeft <= 0);
    if (done) {
      const margin = this.meScore - this.aiScore;
      const tally = this.meScore + ' - ' + this.aiScore;
      if (margin > 0) {
        this.score += margin * 300;
        this.winLevel(margin >= 3 ? 3 : margin >= 2 ? 2 : 1, 'You win ' + tally + '!');
      } else {
        this.won = false;
        this.messageText = margin === 0 ? 'Draw ' + tally + ' — rematch' : 'Rafiq wins ' + tally + ' — rematch';
        sfx.lose();
        this.beginMessage(2.4);
      }
    } else if (mine) {
      this.duelTurn = 'ai';
      this.startAi();
    } else {
      this.duelTurn = 'me';
      this.applySkin(this.skinIdx);
      this.resetShooter();
      this.phase = 'aim';
      this.flash('Your turn', 1.2);
    }
    this.hudDirty = true;
  }

  /** Rafiq lines up the marble nearest to the ring edge and fires after a short pause. */
  private startAi(): void {
    const def = levelDef(this.level);
    let best = -1;
    let bd = -1;
    for (let i = 0; i < this.targets.length; i++) {
      const o = this.targets[i].object3D;
      if (!o || this.wasOut[i]) continue;
      const d = Math.hypot(o.position.x - this.rc[0], o.position.z - TABLE_CENTER_Z - this.rc[1]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    const tp = best >= 0 ? this.targets[best].object3D!.position : null;
    if (!tp) {
      this.resolveDuel(this.totalTargets);
      return;
    }
    let ux = tp.x - this.rc[0];
    let uz = tp.z - TABLE_CENTER_Z - this.rc[1];
    const len = Math.hypot(ux, uz);
    if (len < 0.01) {
      ux = 0;
      uz = -1;
    } else {
      ux /= len;
      uz /= len;
    }
    let sx = tp.x + ux * 0.2;
    let sz = tp.z + uz * 0.2;
    const rr = Math.hypot(sx, sz - TABLE_CENTER_Z);
    if (rr > 0.32) {
      sx *= 0.32 / rr;
      sz = TABLE_CENTER_Z + (sz - TABLE_CENTER_Z) * (0.32 / rr);
    }
    this.place(this.shooter, sx, sz);
    const ang = ((Math.random() * 2 - 1) * (def.ai ?? 8) * Math.PI) / 180;
    const dx = tp.x - sx;
    const dz = tp.z - sz;
    const dl = Math.hypot(dx, dz) || 1;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const speed = 1.3 + Math.random() * 0.8;
    this.aiVel.set(((dx / dl) * c - (dz / dl) * sn) * speed, 0, ((dx / dl) * sn + (dz / dl) * c) * speed);
    this.shooterMat.color.setHex(0xff5a5a);
    this.shooterMat.emissive.setHex(0xd02040);
    this.phase = 'ai';
    this.aiTimer = 1.4;
    this.flash("Rafiq's turn", 1.4);
    this.hudDirty = true;
  }

  private updateAi(delta: number): void {
    this.aiTimer -= delta;
    if (this.aiTimer > 0) return;
    this.shooter.addComponent(PhysicsManipulation, { linearVelocity: [this.aiVel.x, 0, this.aiVel.z] });
    this.aiLeft -= 1;
    this.shotOut = 0;
    sfx.shot(0.6);
    this.phase = 'rolling';
    this.rollTimer = 0;
    this.restTimer = 0;
    this.sawMotion = false;
    this.hudDirty = true;
  }

  private beginMessage(seconds: number): void {
    this.phase = 'message';
    this.messageTimer = seconds;
  }

  // ------------------------------------------------------------------ frame
  update(delta: number): void {
    // optional on-device frame-rate readout: open the game with ?fps in the URL
    if (this.showFps && delta > 0) {
      this.fpsAcc += delta;
      this.fpsN++;
      if (this.fpsAcc >= 1) {
        this.fpsText = '  •  ' + Math.round(this.fpsN / this.fpsAcc) + ' fps';
        this.fpsAcc = 0;
        this.fpsN = 0;
        this.hudDirty = true;
      }
    }
    this.elapsed += delta;
    if (modeState.mode !== this.lastMode) {
      const wasGuti = this.lastMode === 'guti';
      this.lastMode = modeState.mode;
      const open = modeState.mode === 'kite' || modeState.mode === 'lattim' || modeState.mode === 'danguli' || modeState.mode === 'pottery' || modeState.mode === 'kitecraft' || modeState.mode === 'marblerun' || modeState.mode === 'dominoes' || modeState.mode === 'bricks' || modeState.mode === 'paperplane' || modeState.mode === 'gears' || modeState.mode === 'menu';
      this.floorMesh.visible = !open;
      this.tableMesh.visible = !open;
      if (open) {
        this.sun.color.setHex(0xffe6b8);
        this.sun.intensity = 2.6;
      }
      if (modeState.mode === 'guti') {
        this.setModeVisible(true);
        for (const t of this.targets) if (t.object3D) t.object3D.visible = true;
        for (const r of this.rocks) if (r.object3D) r.object3D.visible = true;
        this.firedOnce = false;
        this.score = 0;
        const classic = GROUP_LEVELS[0];
        let first = classic.find((n) => (this.bestStars[n - 1] ?? 0) <= 0) ?? classic[0];
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

    this.updateShadows();

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

    if (this.kind === 'race' && (this.phase === 'aim' || this.phase === 'rolling')) {
      this.raceT += delta;
      const rs = Math.floor(this.raceT);
      if (rs !== this.raceSec) {
        this.raceSec = rs;
        this.hudDirty = true;
      }
    }
    if (this.phase === 'ai') this.updateAi(delta);
    if (this.phase === 'rolling') {
      this.updateRolling(delta);
    } else if (this.phase === 'message') {
      this.messageTimer -= delta;
      if (this.messageTimer <= 0) {
        if (this.won) {
          this.startLevel(this.nextInGroup() || GROUP_LEVELS[this.group][0]);
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

    this.tileCooldown = Math.max(0, this.tileCooldown - delta);
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawTiles();
      this.drawHud();
    }
  }
}
