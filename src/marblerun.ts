import {
  BoxGeometry,
  CylinderGeometry,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { RunOpt } from './ui-components.js';

// ---- Board: an easel on the table. u = across, v = up, relative to the board centre.
const BX = 0;
const BY = 1.12;
const BZ = -0.68;
const HALF_U = 0.43;
const HALF_V = 0.28;
const Z_PIECE = BZ + 0.03;
const TRAY_Y = 0.79;
const R = 0.016; // marble radius
const T = 0.006; // half plank thickness
const GRAV = 3.2;
const REST = 0.38;
const STEP = 1 / 240;
const PLANK_LEN = 0.17;
const GRAB_R = 0.09;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const MAX_SEGS = 64;

type HandName = 'left' | 'right';
type PlankType = 'R' | 'L' | 'FR' | 'FL' | 'F';
const ANG: Record<PlankType, number> = { R: -0.42, L: 0.42, FR: -0.95, FL: 0.95, F: 0 };

interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Level {
  start: [number, number];
  goal: [number, number];
  goalW: number;
  walls: Wall[];
  pegs: [number, number][];
  pieces: PlankType[];
  tip: string;
}

const peg = (cx: number, cy: number, n: number, m: number, s: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out.push([cx + (i - (n - 1) / 2) * s, cy + (j - (m - 1) / 2) * s]);
  return out;
};

const LEVELS: Level[] = [
  {
    start: [-0.33, 0.22],
    goal: [0.1, -0.2],
    goalW: 0.17,
    walls: [],
    pegs: [],
    pieces: ['R', 'R'],
    tip: 'Place a ramp so the marble rolls into the basket',
  },
  {
    start: [-0.33, 0.22],
    goal: [0.28, -0.2],
    goalW: 0.17,
    walls: [{ x1: -0.4, y1: 0.0, x2: 0.08, y2: 0.0 }],
    pegs: [],
    pieces: ['R', 'L', 'R'],
    tip: 'A shelf catches the marble. Tilt it with a ramp',
  },
  {
    start: [-0.33, 0.22],
    goal: [0.3, -0.2],
    goalW: 0.17,
    walls: [],
    pegs: peg(0.0, -0.02, 3, 2, 0.12),
    pieces: ['R', 'R', 'FR'],
    tip: 'Guide the marble past the pegs',
  },
  {
    start: [0.33, 0.22],
    goal: [-0.3, -0.2],
    goalW: 0.17,
    walls: [{ x1: 0.0, y1: 0.07, x2: 0.4, y2: 0.07 }],
    pegs: [],
    pieces: ['L', 'L', 'R', 'FL'],
    tip: 'Start on the right this time',
  },
  {
    start: [-0.33, 0.22],
    goal: [0.31, -0.1],
    goalW: 0.17,
    walls: [{ x1: 0, y1: -0.28, x2: 0, y2: 0.02 }],
    pegs: [],
    pieces: ['R', 'R', 'R', 'F'],
    tip: 'Final run: over the wall into the high basket',
  },
];

interface Placed {
  type: PlankType;
  x: number;
  y: number;
}

interface Piece {
  g: Group;
  mesh: Mesh;
  active: boolean;
  type: PlankType;
  slot: number;
  home: Vector3;
  held: boolean;
  returning: boolean;
  placed: boolean;
}

interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  held: Piece | null;
}

// ---- Pure physics (no rendering): used live and by the headless solver.
const segs = new Float32Array(MAX_SEGS * 4);
let nSegs = 0;
const sim = { x: 0, y: 0, vx: 0, vy: 0, hit: 0 };

function addSeg(x1: number, y1: number, x2: number, y2: number): void {
  if (nSegs >= MAX_SEGS) return;
  const i = nSegs * 4;
  segs[i] = x1;
  segs[i + 1] = y1;
  segs[i + 2] = x2;
  segs[i + 3] = y2;
  nSegs++;
}

function buildSegs(level: Level, planks: Placed[]): void {
  nSegs = 0;
  for (const w of level.walls) addSeg(w.x1, w.y1, w.x2, w.y2);
  for (const p of level.pegs) addSeg(p[0], p[1], p[0], p[1]);
  // basket: two sides and a floor
  const [gx, gy] = level.goal;
  const hw = level.goalW / 2;
  addSeg(gx - hw, gy + 0.05, gx - hw, gy - 0.03);
  addSeg(gx + hw, gy + 0.05, gx + hw, gy - 0.03);
  addSeg(gx - hw, gy - 0.03, gx + hw, gy - 0.03);
  for (const p of planks) {
    const a = ANG[p.type];
    const dx = Math.cos(a) * PLANK_LEN * 0.5;
    const dy = Math.sin(a) * PLANK_LEN * 0.5;
    addSeg(p.x - dx, p.y - dy, p.x + dx, p.y + dy);
  }
}

/** Advances the marble one fixed step. Returns 1 = in basket, -1 = lost, 0 = still rolling. */
function stepSim(level: Level): number {
  sim.vy -= GRAV * STEP;
  const damp = 1 - 0.12 * STEP;
  sim.vx *= damp;
  sim.vy *= damp;
  sim.x += sim.vx * STEP;
  sim.y += sim.vy * STEP;
  sim.hit = 0;
  for (let k = 0; k < nSegs; k++) {
    const i = k * 4;
    const ax = segs[i];
    const ay = segs[i + 1];
    const bx = segs[i + 2];
    const by = segs[i + 3];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-9 ? ((sim.x - ax) * ex + (sim.y - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    let dx = sim.x - cx;
    let dy = sim.y - cy;
    const d = Math.hypot(dx, dy);
    const rr = R + T;
    if (d >= rr) continue;
    if (d < 1e-6) {
      dx = 0;
      dy = 1;
    } else {
      dx /= d;
      dy /= d;
    }
    sim.x += dx * (rr - d);
    sim.y += dy * (rr - d);
    const vn = sim.vx * dx + sim.vy * dy;
    if (vn < 0) {
      sim.vx -= (1 + REST) * vn * dx;
      sim.vy -= (1 + REST) * vn * dy;
      const tx = sim.vx - (sim.vx * dx + sim.vy * dy) * dx;
      const ty = sim.vy - (sim.vx * dx + sim.vy * dy) * dy;
      sim.vx -= tx * 0.004;
      sim.vy -= ty * 0.004;
      if (-vn > sim.hit) sim.hit = -vn;
    }
  }
  const [gx, gy] = level.goal;
  if (Math.abs(sim.x - gx) < level.goalW / 2 - R * 0.4 && sim.y < gy + 0.03 && sim.y > gy - 0.03) return 1;
  if (Math.abs(sim.x) > HALF_U + 0.05 || sim.y < -HALF_V - 0.1) return -1;
  return 0;
}

function simulate(level: Level, planks: Placed[], maxSteps: number): boolean {
  buildSegs(level, planks);
  sim.x = level.start[0];
  sim.y = level.start[1];
  sim.vx = 0;
  sim.vy = 0;
  for (let i = 0; i < maxSteps; i++) {
    const r = stepSim(level);
    if (r === 1) return true;
    if (r === -1) return false;
  }
  return false;
}

export class MarbleRunSystem extends createSystem({
  opts: { required: [RunOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private pieces: Piece[] = [];
  private levelGroup = new Group();
  private marble!: Mesh;
  private basketRing!: Mesh;
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'right', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, held: null },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private level = 0;
  private unlocked = 0;
  private phase: 'build' | 'run' | 'won' = 'build';
  private runT = 0;
  private acc = 0;
  private stillT = 0;
  private lastMode = '';
  private fontWasReady = false;
  private elapsed = 0;
  private hudDirty = true;
  private optCooldown = 0;
  private msg = '';
  private msgT = 0;
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private ndc = new Vector3();
  private cam = new Vector3();
  private nextT = 0;
  private stars = 0;
  private placedBuf: Placed[] = [];

  init(): void {
    const add = (o: Mesh | Group): void => {
      this.world.createTransformEntity(o);
      this.root.push(o);
    };
    const wood = new MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.85 });
    const dark = new MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.8 });

    const top = new Mesh(new CylinderGeometry(0.46, 0.46, 0.04, 56), wood);
    top.position.set(0, 0.72, -0.55);
    add(top);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 0.72, 8), wood);
      leg.position.set(Math.cos(a) * 0.3, 0.34, -0.55 + Math.sin(a) * 0.3);
      add(leg);
    }
    const board = new Mesh(new BoxGeometry(HALF_U * 2, HALF_V * 2, 0.02), new MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.95 }));
    board.position.set(BX, BY, BZ);
    add(board);
    const edge = new Mesh(new BoxGeometry(HALF_U * 2 + 0.04, HALF_V * 2 + 0.04, 0.016), wood);
    edge.position.set(BX, BY, BZ - 0.012);
    add(edge);
    for (const sx of [-0.36, 0.36]) {
      const post = new Mesh(new CylinderGeometry(0.014, 0.014, 0.4, 8), dark);
      post.position.set(sx, 0.94, BZ - 0.02);
      add(post);
    }
    // tray strip
    const tray = new Mesh(new BoxGeometry(HALF_U * 2, 0.07, 0.03), wood);
    tray.position.set(BX, TRAY_Y - 0.01, BZ + 0.025);
    add(tray);

    this.levelGroup.position.set(BX, BY, BZ + 0.025);
    add(this.levelGroup);

    this.marble = new Mesh(new SphereGeometry(R, 20, 14), new MeshStandardMaterial({ color: 0x2f9fd8, roughness: 0.15, metalness: 0.3 }));
    add(this.marble);
    this.basketRing = new Mesh(new RingGeometry(0.03, 0.036, 24), new MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9 }));
    this.basketRing.position.z = 0.012;
    this.levelGroup.add(this.basketRing);

    const bamboo = new MeshStandardMaterial({ color: 0xc9a85c, roughness: 0.6 });
    for (let slot = 0; slot < 4; slot++) {
      const g = new Group();
      const m = new Mesh(new BoxGeometry(PLANK_LEN, T * 2, 0.016), bamboo);
      g.add(m);
      add(g);
      this.pieces.push({ g, mesh: m, active: false, type: 'R', slot, home: new Vector3(), held: false, returning: false, placed: false });
    }

    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, 1.5, -0.72);
    this.hud.mesh.rotation.x = -0.25;
    add(this.hud.mesh);
    for (let i = 0; i < 3; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.56, 1.0 - i * 0.085, -0.45);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(RunOpt, { id: i });
      this.btns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'marblerun' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(RunOpt, 'id') as number);
      }),
    );
    for (const o of this.root) o.visible = false;
    try {
      this.unlocked = Math.min(LEVELS.length - 1, Math.max(0, Number(localStorage.getItem('guti-run-level') ?? '0') || 0));
    } catch {
      this.unlocked = 0;
    }

    // ---- test hooks
    const w = window as unknown as Record<string, unknown>;
    w.__run = () => ({ mode: modeState.mode, level: this.level, phase: this.phase, placed: this.placed().length, stars: this.stars });
    w.__runSolve = (lv: number, trials: number) => {
      const L = LEVELS[lv];
      let best: Placed[] | null = null;
      for (let n = 0; n < trials && !best; n++) {
        const tryPlanks: Placed[] = L.pieces.map((type) => ({
          type,
          x: (Math.random() * 2 - 1) * (HALF_U - 0.1),
          y: (Math.random() * 2 - 1) * (HALF_V - 0.04),
        }));
        if (simulate(L, tryPlanks, 240 * 8)) best = tryPlanks;
      }
      return best;
    };
    w.__runRate = (lv: number, trials: number) => {
      const L = LEVELS[lv];
      let ok = 0;
      let first: Placed[] | null = null;
      for (let n = 0; n < trials; n++) {
        const tryPlanks: Placed[] = L.pieces.map((type) => ({
          type,
          x: (Math.random() * 2 - 1) * (HALF_U - 0.1),
          y: (Math.random() * 2 - 1) * (HALF_V - 0.04),
        }));
        if (simulate(L, tryPlanks, 240 * 8)) {
          ok++;
          if (!first) first = tryPlanks;
        }
      }
      return { ok, trials, first };
    };
    w.__runPlace = (lv: number, planks: Placed[]) => {
      this.loadLevel(lv);
      planks.forEach((p, i) => {
        const pc = this.pieces[i];
        if (!pc || !pc.active) return;
        pc.placed = true;
        pc.g.position.set(BX + p.x, BY + p.y, Z_PIECE);
      });
      this.press(0);
    };

    const down = (e: PointerEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
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

  // ------------------------------------------------------------------ levels
  private placed(): Placed[] {
    this.placedBuf.length = 0;
    for (const p of this.pieces) {
      if (p.active && p.placed) this.placedBuf.push({ type: p.type, x: p.g.position.x - BX, y: p.g.position.y - BY });
    }
    return this.placedBuf;
  }

  private loadLevel(i: number): void {
    this.level = i;
    const L = LEVELS[i];
    while (this.levelGroup.children.length > 1) this.levelGroup.remove(this.levelGroup.children[1]);
    const wood = new MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 });
    for (const w of L.walls) {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const m = new Mesh(new BoxGeometry(len, T * 2, 0.02), wood);
      m.position.set((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, 0);
      m.rotation.z = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
      this.levelGroup.add(m);
    }
    for (const p of L.pegs) {
      const m = new Mesh(new CylinderGeometry(0.008, 0.008, 0.02, 10), wood);
      m.rotation.x = Math.PI / 2;
      m.position.set(p[0], p[1], 0);
      this.levelGroup.add(m);
    }
    // basket
    const [gx, gy] = L.goal;
    const hw = L.goalW / 2;
    const basketMat = new MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.8 });
    for (const sx of [-hw, hw]) {
      const side = new Mesh(new BoxGeometry(0.012, 0.08, 0.02), basketMat);
      side.position.set(gx + sx, gy + 0.01, 0);
      this.levelGroup.add(side);
    }
    const floor = new Mesh(new BoxGeometry(L.goalW + 0.012, 0.012, 0.02), basketMat);
    floor.position.set(gx, gy - 0.03, 0);
    this.levelGroup.add(floor);
    this.basketRing.position.set(gx, gy + 0.06, 0.012);

    // loose planks in the tray (pooled, created once)
    const n = L.pieces.length;
    for (let slot = 0; slot < this.pieces.length; slot++) {
      const pc = this.pieces[slot];
      pc.active = slot < n;
      pc.g.visible = pc.active;
      pc.held = false;
      pc.returning = false;
      pc.placed = false;
      if (!pc.active) continue;
      pc.type = L.pieces[slot];
      pc.mesh.rotation.z = ANG[pc.type];
      pc.home.set(BX + (slot - (n - 1) / 2) * 0.2, TRAY_Y + 0.045, Z_PIECE);
      pc.g.position.copy(pc.home);
    }
    this.phase = 'build';
    this.marble.position.set(BX + L.start[0], BY + L.start[1], BZ + 0.035);
    this.marble.visible = true;
    this.say(L.tip, 6);
    this.drawBtns();
    this.hudDirty = true;
  }

  private press(id: number): void {
    if (id === 0) {
      if (this.phase === 'build') this.startRun();
      else if (this.phase === 'won') this.loadLevel(Math.min(LEVELS.length - 1, this.level + 1));
      else this.resetRun();
    } else if (id === 1) {
      this.resetRun();
    } else {
      this.loadLevel((this.level + 1) % (this.unlocked + 1));
    }
    this.drawBtns();
  }

  private startRun(): void {
    const L = LEVELS[this.level];
    buildSegs(L, this.placed());
    sim.x = L.start[0];
    sim.y = L.start[1];
    sim.vx = 0;
    sim.vy = 0;
    this.phase = 'run';
    this.runT = 0;
    this.acc = 0;
    this.stillT = 0;
    for (const p of this.pieces) p.returning = false;
    sfx.whoosh();
    this.hudDirty = true;
  }

  private resetRun(): void {
    const L = LEVELS[this.level];
    this.phase = 'build';
    this.marble.position.set(BX + L.start[0], BY + L.start[1], BZ + 0.035);
    this.hudDirty = true;
  }

  private lose(): void {
    sfx.lose();
    this.say('Missed! Move a ramp and try again', 3);
    this.resetRun();
  }

  private win(): void {
    this.phase = 'won';
    const used = this.pieces.filter((p) => p.active && p.placed).length;
    const n = LEVELS[this.level].pieces.length;
    this.stars = used <= Math.ceil(n / 2) ? 3 : used <= n - 1 ? 2 : 1;
    sfx.win();
    emitBurst(BX + LEVELS[this.level].goal[0], BY + LEVELS[this.level].goal[1] + 0.05, BZ + 0.05, 1, 0.85, 0.4, 70, 0.4);
    if (this.level < LEVELS.length - 1) {
      this.unlocked = Math.max(this.unlocked, this.level + 1);
      try {
        localStorage.setItem('guti-run-level', String(this.unlocked));
      } catch {
        /* ignore */
      }
      this.say('In the basket!  ' + '★'.repeat(this.stars) + '  Press Next', 8);
    } else {
      this.say('All runs done!  ' + '★'.repeat(this.stars), 8);
    }
    this.drawBtns();
  }

  private say(text: string, seconds: number): void {
    this.msg = text;
    this.msgT = seconds;
    this.hudDirty = true;
  }

  private drawBtns(): void {
    const labels = [
      [this.phase === 'won' ? 'NEXT' : 'GO', this.phase === 'won' ? 'Next run' : 'Release marble'],
      ['RESET', 'Marble back'],
      ['RUN', 'Run ' + ((this.level + 1) % (this.unlocked + 1) + 1)],
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.btns[i];
      p.card('rgba(40,24,12,0.9)', i === 0 && this.phase === 'won' ? '#8dff9d' : '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 32, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    const placed = this.pieces.filter((p) => p.active && p.placed).length;
    h.card();
    h.text('Marble run  •  গুলির পথ  ' + (this.level + 1) + '/' + LEVELS.length, 56, 32);
    h.text('Ramps placed ' + placed + ' / ' + LEVELS[this.level].pieces.length, 100, 26, '#ffd9a0');
    if (this.msgT > 0) h.text(this.msg, 150, 30, '#8dff9d');
    else h.text(this.phase === 'build' ? 'Place ramps, then press Release marble' : this.phase === 'run' ? 'Rolling...' : 'Nice!', 150, 28, '#ffe9c4');
    h.text('Pinch a plank, drop it on the board. Pinch it again to move it', 195, 22, '#cdb99a');
    h.commit();
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

  private mousePoint(out: Vector3): boolean {
    const cam = this.world.camera;
    this.ndc.set((this.mouseX / window.innerWidth) * 2 - 1, -(this.mouseY / window.innerHeight) * 2 + 1, 0.5);
    this.ndc.unproject(cam);
    cam.getWorldPosition(this.cam);
    this.ndc.sub(this.cam);
    if (Math.abs(this.ndc.z) < 1e-5) return false;
    const t = (BZ - this.cam.z) / this.ndc.z;
    if (t <= 0) return false;
    out.copy(this.cam).addScaledVector(this.ndc, t);
    return true;
  }

  private updatePointer(pt: Pointer): void {
    let have = false;
    if (pt.src === 'mouse') {
      pt.down = this.mouseDown;
      have = pt.down && this.mousePoint(pt.pos);
    } else {
      const p = this.readPinch(pt.src);
      this.pinching[pt.src] = p;
      pt.down = p;
      have = p && this.readHandPos(pt.src, pt.pos);
    }
    if (!have) pt.down = false;
    if (this.phase !== 'build') {
      pt.was = pt.down;
      return;
    }
    if (pt.down && !pt.was) {
      let best: Piece | null = null;
      let bd = GRAB_R;
      for (const pc of this.pieces) {
        if (!pc.active || pc.held) continue;
        const d = Math.hypot(pc.g.position.x - pt.pos.x, pc.g.position.y - pt.pos.y);
        if (d < bd) {
          bd = d;
          best = pc;
        }
      }
      if (best) {
        best.held = true;
        best.returning = false;
        best.placed = false;
        pt.held = best;
        sfx.grab();
      }
    }
    if (pt.down && pt.held) pt.held.g.position.set(pt.pos.x, pt.pos.y, Z_PIECE);
    if (!pt.down && pt.was && pt.held) {
      const pc = pt.held;
      pt.held = null;
      pc.held = false;
      const x = pc.g.position.x - BX;
      const y = pc.g.position.y - BY;
      if (Math.abs(x) < HALF_U - 0.04 && Math.abs(y) < HALF_V - 0.02) {
        pc.placed = true;
        sfx.wood(0.4);
      } else {
        pc.returning = true;
      }
      this.hudDirty = true;
    }
    pt.was = pt.down;
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'marblerun';
      for (const o of this.root) o.visible = on;
      if (on) this.loadLevel(this.unlocked);
    }
    if (modeState.mode !== 'marblerun') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    for (const pt of this.pointers) this.updatePointer(pt);

    for (const p of this.pieces) {
      if (!p.active) continue;
      if (p.returning) {
        p.g.position.lerp(p.home, Math.min(1, dt * 10));
        if (p.g.position.distanceTo(p.home) < 0.003) p.returning = false;
      } else if (!p.held && !p.placed) {
        p.g.position.y = p.home.y + Math.sin(this.elapsed * 2 + p.slot) * 0.003;
      }
    }

    if (this.phase === 'run') {
      const L = LEVELS[this.level];
      this.acc += dt;
      this.runT += dt;
      let r = 0;
      while (this.acc >= STEP && r === 0) {
        this.acc -= STEP;
        r = stepSim(L);
        if (sim.hit > 0.25) sfx.wood(Math.min(1, sim.hit / 2));
      }
      this.marble.position.set(BX + sim.x, BY + sim.y, BZ + 0.035);
      const sp = Math.hypot(sim.vx, sim.vy);
      this.stillT = sp < 0.03 ? this.stillT + dt : 0;
      if (r === 1) this.win();
      else if (r === -1 || this.runT > 14 || this.stillT > 2) this.lose();
    }
    const s = 1 + Math.sin(this.elapsed * 4) * 0.1;
    this.basketRing.scale.set(s, s, 1);
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.hudDirty = true;
    }
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
