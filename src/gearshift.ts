import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Entity,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Pressed,
  RayInteractable,
  RingGeometry,
  SRGBColorSpace,
  Shape,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';
import { sfx } from './audio.js';
import { celebrate, emitBurst } from './fx.js';
import { M, LEVELS, evaluate, fits, outerRadius, radius } from './gearlogic.js';
import type { Evaluation, GearDef, Level } from './gearlogic.js';
import { roundedBox, woodTexture } from './geo.js';
import { readPinchPoint } from './hand.js';
import { askMentor } from './mentor.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { GearOpt } from './ui-components.js';

// ---- GearShift: pick gears from the rack, seat them on pegs, and make the machine do what the goal says.
const BZ = -0.85; // board front plane
const BY = 0.92; // board centre height
const BW = 1.16;
const BH = 0.74;
const Z0 = 0.024; // front layer offset from the board
const Z1 = 0.012; // back layer offset
const TRAY_Y = -0.29;
const PICK_R = 0.075;
const SNAP_R = 0.085;
const OMEGA = -1.5; // motor speed (negative = clockwise as seen by the player)
const PINCH_START = 0.85;
const PINCH_HOLD = 0.5;

type HandName = 'left' | 'right';

interface Item {
  def: GearDef;
  g: Group;
  meshes: Mesh[]; // one per part
  peg: number; // -1 in the rack
  x: number;
  y: number;
  home: { x: number; y: number };
  held: boolean;
  lift: number;
}
interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  held: Item | null;
}

const COLORS: Record<number, number> = { 8: 0xc9a14a, 10: 0xe0b34f, 12: 0x4fa3e0, 14: 0xd9774a, 15: 0xc76b8a, 16: 0xb8bcc6, 20: 0x7fbf8a, 24: 0x9a86d6 };
const gearGeo = new Map<number, BufferGeometry>();

/** A real toothed wheel: trapezoid teeth, a hub hole and round lightening holes, with bevelled edges. */
function gearGeometry(n: number): BufferGeometry {
  const hit = gearGeo.get(n);
  if (hit) return hit;
  const r = radius(n);
  const root = r - M * 1.05;
  const tip = r + M * 0.85;
  const pa = (Math.PI * 2) / n;
  const s = new Shape();
  for (let k = 0; k < n; k++) {
    const a = k * pa;
    const pts: [number, number][] = [
      [root, a - pa * 0.32],
      [tip, a - pa * 0.14],
      [tip, a + pa * 0.14],
      [root, a + pa * 0.32],
    ];
    pts.forEach(([rad, ang], i) => {
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      if (k === 0 && i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
  }
  s.closePath();
  const hub = new Path();
  hub.absarc(0, 0, Math.max(0.006, root * 0.16), 0, Math.PI * 2, true);
  s.holes.push(hub);
  if (n >= 14) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const h = new Path();
      h.absarc(Math.cos(a) * root * 0.58, Math.sin(a) * root * 0.58, root * 0.17, 0, Math.PI * 2, true);
      s.holes.push(h);
    }
  }
  const g = new ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0009, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -0.004);
  gearGeo.set(n, g);
  return g;
}

function gearMaterial(n: number, dim = false): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: COLORS[n] ?? 0xcccccc, metalness: 0.55, roughness: 0.32, emissive: dim ? 0x000000 : 0x000000 });
}

function blueprintTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1160;
  c.height = 740;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 740);
  grad.addColorStop(0, '#16345a');
  grad.addColorStop(1, '#0d2342');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1160, 740);
  const step = 50; // px = 0.05 m
  for (let x = 0; x <= 1160; x += step) {
    g.strokeStyle = x % 100 === 0 ? 'rgba(140,190,240,0.34)' : 'rgba(140,190,240,0.14)';
    g.lineWidth = x % 100 === 0 ? 1.6 : 1;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 740);
    g.stroke();
  }
  for (let y = 0; y <= 740; y += step) {
    g.strokeStyle = y % 100 === 0 ? 'rgba(140,190,240,0.34)' : 'rgba(140,190,240,0.14)';
    g.lineWidth = y % 100 === 0 ? 1.6 : 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1160, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(190,225,255,0.7)';
  g.lineWidth = 3;
  g.strokeRect(26, 26, 1108, 688);
  g.fillStyle = 'rgba(190,225,255,0.8)';
  g.font = '600 22px sans-serif';
  g.fillText('GEARSHIFT  -  ASSEMBLY BENCH', 46, 62);
  g.font = '16px sans-serif';
  g.fillStyle = 'rgba(190,225,255,0.55)';
  g.fillText('module 7.5 mm   |   front layer / back layer', 46, 88);
  // rack strip
  const ry = 740 / 2 - TRAY_Y * 1000 - 100;
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(34, ry, 1092, 200);
  g.strokeStyle = 'rgba(190,225,255,0.4)';
  g.setLineDash([10, 8]);
  g.strokeRect(34, ry, 1092, 200);
  g.setLineDash([]);
  g.fillStyle = 'rgba(190,225,255,0.5)';
  g.fillText('PARTS RACK', 48, ry + 26);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class GearShiftSystem extends createSystem({
  opts: { required: [GearOpt, Pressed] },
}) {
  private root = new Group();
  private pegGroup = new Group();
  private partsGroup = new Group();
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private level = 0;
  private unlocked = 0;
  private solved = false;
  private placement: number[] = [];
  private items: Item[] = [];
  private fixed = new Map<string, Mesh>();
  private fixedGroup = new Group();
  private pegMeshes: Mesh[] = [];
  private ring!: Mesh;
  private lamp!: Mesh;
  private lampGlow!: Mesh;
  private ev!: Evaluation;
  private time = 0;
  private tickT = 0;
  private lastMode = '';
  private fontWasReady = false;
  private hudDirty = true;
  private optCooldown = 0;
  private msg = '';
  private msgT = 0;
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'right', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, held: null },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private ndc = new Vector3();
  private cam = new Vector3();
  private phi: number[] = [];
  private wp = new Vector3();

  private get lv(): Level {
    return LEVELS[this.level];
  }

  init(): void {
    const world = this.world;
    this.root.add(this.pegGroup, this.fixedGroup, this.partsGroup);
    world.createTransformEntity(this.root);

    // bench: walnut frame, blueprint board, a shelf for the rack
    const wood = new MeshStandardMaterial({ map: woodTexture(24, 2, 1), roughness: 0.45 });
    const frame = (w: number, h: number, x: number, y: number): void => {
      const m = new Mesh(roundedBox(w, h, 0.05, 0.006), wood);
      m.position.set(x, BY + y, BZ - 0.02);
      m.receiveShadow = true;
      this.root.add(m);
    };
    frame(BW + 0.12, 0.06, 0, BH / 2 + 0.03);
    frame(BW + 0.12, 0.06, 0, -BH / 2 - 0.03);
    frame(0.06, BH, -BW / 2 - 0.03, 0);
    frame(0.06, BH, BW / 2 + 0.03, 0);
    const board = new Mesh(new PlaneGeometry(BW, BH), new MeshStandardMaterial({ map: blueprintTexture(), roughness: 0.85 }));
    board.position.set(0, BY, BZ);
    board.receiveShadow = true;
    this.root.add(board);
    const legM = new MeshStandardMaterial({ color: 0x3a2b20, roughness: 0.6 });
    for (const x of [-0.5, 0.5]) {
      const leg = new Mesh(new BoxGeometry(0.05, BY - 0.35, 0.05), legM);
      leg.position.set(x, (BY - 0.35) / 2, BZ - 0.12);
      this.root.add(leg);
    }

    // output lamp ring (lights when the goal is met)
    this.ring = new Mesh(new TorusGeometry(0.1, 0.004, 8, 48), new MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false }));
    this.lamp = new Mesh(new RingGeometry(0.0, 0.1, 40), new MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false }));
    this.lampGlow = this.lamp;
    this.root.add(this.ring, this.lamp);

    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, BY + BH / 2 + 0.11, BZ + 0.03);
    this.hud.mesh.rotation.x = -0.15;
    this.world.createTransformEntity(this.hud.mesh);
    this.root.userData.hud = true;
    for (let i = 0; i < 3; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.22 + i * 0.22, 0.64, -0.5);
      panel.mesh.rotation.x = -0.9;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(GearOpt, { id: i });
      this.btns.push(panel);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'gears' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(GearOpt, 'id') as number);
      }),
    );
    try {
      this.unlocked = Math.min(LEVELS.length - 1, Number(localStorage.getItem('pw-gear-level') ?? '0') || 0);
    } catch {
      this.unlocked = 0;
    }
    this.setVisible(false);

    const w = window as unknown as Record<string, unknown>;
    w.__gears = () => ({ mode: modeState.mode, level: this.level, solved: this.solved, placement: this.placement.slice(), win: this.ev?.win, ratio: this.ev?.ratio, unlocked: this.unlocked });
    w.__gearScreen = (x: number, y: number) => {
      const v = new Vector3(x, BY + y, BZ + 0.03).project(this.world.camera);
      return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
    };
    w.__gearLevel = (i: number) => this.loadLevel(i);
    w.__gearPlace = (peg: number, item: number) => this.place(item, peg);
    w.__gearSolve = () => {
      this.lv.solution.forEach((it, p) => {
        if (it >= 0) this.place(it, p);
      });
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

  private setVisible(v: boolean): void {
    this.root.visible = v;
    this.hud.mesh.visible = v;
    for (const b of this.btns) b.mesh.visible = v;
  }

  // ---------------------------------------------------------------- levels
  private loadLevel(i: number): void {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, i));
    const lv = this.lv;
    this.solved = false;
    this.placement = lv.pegs.map(() => -1);
    for (const o of [...this.pegGroup.children]) this.pegGroup.remove(o);
    for (const o of [...this.partsGroup.children]) this.partsGroup.remove(o);
    for (const o of [...this.fixedGroup.children]) this.fixedGroup.remove(o);
    this.fixed.clear();
    this.pegMeshes = [];
    this.items = [];
    const brass = new MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.7, roughness: 0.3 });
    lv.pegs.forEach((p, k) => {
      const peg = new Mesh(new CylinderGeometry(0.0075, 0.0075, 0.05, 14), brass);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(p.x, BY + p.y, BZ + 0.025);
      peg.castShadow = true;
      this.pegGroup.add(peg);
      this.pegMeshes.push(peg);
      const base = new Mesh(new CylinderGeometry(0.013, 0.013, 0.004, 20), brass);
      base.rotation.x = Math.PI / 2;
      base.position.set(p.x, BY + p.y, BZ + 0.002);
      this.pegGroup.add(base);
      void k;
    });
    // motor and output wheel
    const mp = lv.pegs[lv.motor.peg];
    const tp = lv.pegs[lv.target.peg];
    const motor = new Mesh(gearGeometry(lv.motor.n), new MeshStandardMaterial({ color: 0xd24b4b, metalness: 0.55, roughness: 0.32 }));
    motor.position.set(mp.x, BY + mp.y, BZ + Z0);
    motor.castShadow = motor.receiveShadow = true;
    this.fixedGroup.add(motor);
    this.fixed.set(lv.motor.peg + ':0', motor);
    const box = new Mesh(roundedBox(0.07, 0.07, 0.03, 0.005), new MeshStandardMaterial({ color: 0x3b3f4a, metalness: 0.5, roughness: 0.4 }));
    box.position.set(mp.x, BY + mp.y, BZ + Z0 + 0.026);
    box.castShadow = true;
    this.fixedGroup.add(box);
    const led = new Mesh(new CylinderGeometry(0.006, 0.006, 0.004, 12), new MeshBasicMaterial({ color: 0xff5a5a }));
    led.rotation.x = Math.PI / 2;
    led.position.set(mp.x, BY + mp.y + 0.026, BZ + Z0 + 0.043);
    this.fixedGroup.add(led);
    const out = new Mesh(gearGeometry(lv.target.n), new MeshStandardMaterial({ color: 0x3f8fe0, metalness: 0.55, roughness: 0.32 }));
    out.position.set(tp.x, BY + tp.y, BZ + (lv.target.layer === 0 ? Z0 : Z1));
    out.castShadow = out.receiveShadow = true;
    this.fixedGroup.add(out);
    this.fixed.set(lv.target.peg + ':' + lv.target.layer, out);
    this.ring.position.set(tp.x, BY + tp.y, BZ + 0.04);
    this.ring.scale.setScalar(outerRadius(lv.target.n) / 0.1 + 0.18);
    this.lamp.position.set(tp.x, BY + tp.y, BZ + 0.004);
    this.lamp.scale.setScalar(outerRadius(lv.target.n) / 0.1 + 0.55);
    // the rack
    const n = lv.inventory.length;
    const span = 0.16;
    lv.inventory.forEach((def, k) => {
      const g = new Group();
      const meshes: Mesh[] = def.parts.map((p) => {
        const m = new Mesh(gearGeometry(p.n), gearMaterial(p.n));
        m.position.z = p.layer === 0 ? Z0 : Z1;
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        return m;
      });
      if (def.parts.length > 1) {
        const ax = new Mesh(new CylinderGeometry(0.009, 0.009, 0.03, 12), new MeshStandardMaterial({ color: 0xcfd3dc, metalness: 0.8, roughness: 0.25 }));
        ax.rotation.x = Math.PI / 2;
        ax.position.z = (Z0 + Z1) / 2;
        g.add(ax);
      }
      const hx = (k - (n - 1) / 2) * span;
      const item: Item = { def, g, meshes, peg: -1, x: hx, y: TRAY_Y, home: { x: hx, y: TRAY_Y }, held: false, lift: 0 };
      this.items.push(item);
      this.partsGroup.add(g);
      this.syncItem(item);
    });
    this.evaluateNow();
    this.msg = '';
    this.msgT = 0;
    this.hudDirty = true;
    this.drawBtns();
  }

  private syncItem(it: Item): void {
    it.g.position.set(it.x, BY + it.y, BZ + it.lift);
  }

  private place(itemIdx: number, peg: number): boolean {
    const it = this.items[itemIdx];
    if (!it || peg < 0 || peg >= this.lv.pegs.length) return false;
    if (peg === this.lv.motor.peg || peg === this.lv.target.peg || this.placement[peg] >= 0) return false;
    if (!fits(this.lv, this.placement, peg, itemIdx)) return false;
    if (it.peg >= 0) this.placement[it.peg] = -1;
    this.placement[peg] = itemIdx;
    it.peg = peg;
    const p = this.lv.pegs[peg];
    it.x = p.x;
    it.y = p.y;
    it.lift = 0;
    this.syncItem(it);
    this.evaluateNow();
    return true;
  }

  private evaluateNow(): void {
    this.ev = evaluate(this.lv, this.placement);
    this.phi = new Array(this.ev.parts.length).fill(0);
    const win = this.ev.win;
    if (win && !this.solved) {
      this.solved = true;
      this.unlocked = Math.max(this.unlocked, Math.min(LEVELS.length - 1, this.level + 1));
      try {
        localStorage.setItem('pw-gear-level', String(this.unlocked));
      } catch {
        /* ignore */
      }
      const tp = this.lv.pegs[this.lv.target.peg];
      celebrate(tp.x, BY + tp.y, BZ + 0.1, 3);
      sfx.win();
      this.msg = this.level === LEVELS.length - 1 ? 'Machine complete!  All levels solved' : 'Machine online!  Press NEXT';
      this.msgT = 12;
      askMentor('gears', 'a gear train that solves the puzzle "' + this.lv.name + '" with an output ratio of ' + this.ev.ratio.toFixed(1) + 'x', (t) => {
        this.msg = t;
        this.msgT = 12;
        this.hudDirty = true;
      });
      this.drawBtns();
    }
    this.hudDirty = true;
  }

  private press(id: number): void {
    if (id === 0) this.loadLevel(this.level - 1);
    else if (id === 1) this.loadLevel(this.level);
    else if (this.level < this.unlocked || this.solved) this.loadLevel(this.level + 1);
    else {
      this.msg = 'Solve this level first';
      this.msgT = 3;
      this.hudDirty = true;
    }
  }

  // ---------------------------------------------------------------- hud
  private drawBtns(): void {
    const labels = [
      ['BACK', 'Previous level'],
      ['RETRY', 'Reset gears'],
      ['NEXT', this.solved || this.level < this.unlocked ? 'Next level' : 'Locked'],
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.btns[i];
      p.card('rgba(16,34,58,0.92)', i === 2 && (this.solved || this.level < this.unlocked) ? '#8dff9d' : '#8ec5ff');
      p.text(labels[i][0], p.h * 0.3, 22, '#9cc4ee');
      p.text(labels[i][1], p.h * 0.7, 32, '#e6f2ff');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    const lv = this.lv;
    h.card('rgba(12,28,50,0.88)', '#8ec5ff');
    h.text('GEARSHIFT   Level ' + (this.level + 1) + ' / ' + LEVELS.length + '  -  ' + lv.name, 52, 30, '#e6f2ff');
    h.text(lv.goal, 104, 28, this.solved ? '#8dff9d' : '#ffd9a0');
    if (this.msgT > 0) h.text(this.msg, 152, 28, '#8dff9d');
    else h.text('Hint: ' + lv.hint, 152, 24, '#b9d6f5');
    const r = this.ev && this.ev.ratio > 0 ? 'Output ' + this.ev.ratio.toFixed(2) + 'x  ' + (this.ev.dir === lv.target.dir ? 'right way' : 'wrong way') : 'Output not connected yet';
    h.text(r, 198, 24, '#7fd0ff');
    h.commit();
  }

  // ---------------------------------------------------------------- input
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
    const t = (BZ + 0.03 - this.cam.z) / this.ndc.z;
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
    const bx = pt.pos.x;
    const by = pt.pos.y - BY;
    if (pt.down && !pt.was) {
      let best: Item | null = null;
      let bd = 1e9;
      for (const it of this.items) {
        if (it.held) continue;
        const rr = Math.max(...it.def.parts.map((p) => outerRadius(p.n)));
        const d = Math.hypot(it.x - bx, it.y - by);
        if (d < Math.max(PICK_R, rr) && d / rr < bd) {
          bd = d / rr;
          best = it;
        }
      }
      if (best) {
        if (best.peg >= 0) {
          this.placement[best.peg] = -1;
          best.peg = -1;
          this.evaluateNow();
        }
        best.held = true;
        best.lift = 0.05;
        pt.held = best;
        sfx.grab();
      }
    }
    if (pt.down && pt.held) {
      pt.held.x = bx;
      pt.held.y = by;
      this.syncItem(pt.held);
    }
    if (!pt.down && pt.was && pt.held) {
      const it = pt.held;
      pt.held = null;
      it.held = false;
      it.lift = 0;
      let bestPeg = -1;
      let bd = SNAP_R;
      this.lv.pegs.forEach((p, k) => {
        if (k === this.lv.motor.peg || k === this.lv.target.peg || this.placement[k] >= 0) return;
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d < bd) {
          bd = d;
          bestPeg = k;
        }
      });
      const idx = this.items.indexOf(it);
      if (bestPeg >= 0 && this.place(idx, bestPeg)) {
        sfx.wood(0.5);
        const p = this.lv.pegs[bestPeg];
        emitBurst(p.x, BY + p.y, BZ + 0.05, 0.9, 0.85, 0.6, 8, 0.25);
      } else {
        if (bestPeg >= 0) {
          sfx.thud(0.4);
          this.msg = 'Those teeth do not fit there';
          this.msgT = 2.5;
          this.hudDirty = true;
        }
        it.x = it.home.x;
        it.y = it.home.y;
        this.syncItem(it);
      }
    }
    pt.was = pt.down;
  }

  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'gears';
      this.setVisible(on);
      if (on) this.loadLevel(Math.min(this.unlocked, this.level));
    }
    if (modeState.mode !== 'gears') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    this.time += dt;
    for (const pt of this.pointers) this.updatePointer(pt);

    // spin the powered wheels
    const parts = this.ev.parts;
    const powered = parts.length > 1 && !this.ev.jam;
    if (powered || parts.length === 1) {
      for (let i = 0; i < parts.length; i++) {
        const s = parts[i];
        if (s.parent < 0) this.phi[i] = OMEGA * this.time * (this.ev.jam ? 0 : 1);
        else if (s.sibling) this.phi[i] = this.phi[s.parent];
        else this.phi[i] = -(s.parentN / s.n) * this.phi[s.parent] + s.c;
        const m = this.meshFor(s.peg, s.layer);
        if (m) m.rotation.z = this.phi[i];
      }
    }
    if (powered) {
      this.tickT -= dt;
      if (this.tickT <= 0) {
        this.tickT = 0.28;
        sfx.tick();
      }
    }
    // output lamp
    const glow = this.solved ? 0.55 + 0.25 * Math.sin(this.time * 6) : 0;
    (this.ring.material as MeshBasicMaterial).opacity += (glow - (this.ring.material as MeshBasicMaterial).opacity) * Math.min(1, dt * 6);
    (this.lamp.material as MeshBasicMaterial).opacity = (this.ring.material as MeshBasicMaterial).opacity * 0.5;

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.hudDirty = true;
    }
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
    void this.wp;
    void this.lampGlow;
  }

  private meshFor(peg: number, layer: number): Mesh | null {
    const f = this.fixed.get(peg + ':' + layer);
    if (f) return f;
    const idx = this.placement[peg];
    if (idx < 0) return null;
    const it = this.items[idx];
    const k = it.def.parts.findIndex((p) => p.layer === layer);
    return k >= 0 ? it.meshes[k] : null;
  }
}
