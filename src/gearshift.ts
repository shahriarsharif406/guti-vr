import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
  PointLight,
  Points,
  PointsMaterial,
  Pressed,
  RayInteractable,
  RingGeometry,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
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

// brushed bronze, polished brass, oxidised copper, cast iron
const COLORS: Record<number, number> = { 8: 0xb8863b, 10: 0xd6a94a, 12: 0x9a6334, 14: 0x5d8a78, 15: 0x6c6a70, 16: 0xa97442, 20: 0xc79a46, 24: 0x7b5a3a };
const GAUGE_Y = BY + BH / 2 + 0.11;
let scratchTex: CanvasTexture | null = null;

/** Micro-scratches and brushed grain, used as roughness + bump map so metal catches the light unevenly. */
function scratchTexture(): CanvasTexture {
  if (scratchTex) return scratchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    const v = Math.floor(90 + rnd() * 120);
    g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.2 + rnd() * 0.5).toFixed(2) + ')';
    g.lineWidth = rnd() < 0.9 ? 0.6 : 1.4;
    const x = rnd() * 256;
    const y = rnd() * 256;
    const a = rnd() * Math.PI;
    const l = 6 + rnd() * 50;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 250; i++) {
    g.fillStyle = 'rgba(40,40,40,' + (0.15 + rnd() * 0.3).toFixed(2) + ')';
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  scratchTex = new CanvasTexture(c);
  scratchTex.wrapS = scratchTex.wrapT = 1000; // RepeatWrapping
  return scratchTex;
}

function metal(color: number, rough = 0.42, bump = 0.6): MeshStandardMaterial {
  const t = scratchTexture();
  return new MeshStandardMaterial({ color, metalness: 0.92, roughness: rough, roughnessMap: t, bumpMap: t, bumpScale: bump, envMapIntensity: 1.3 });
}

function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,230,170,1)');
  gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}
const gearGeo = new Map<number, BufferGeometry>();
const DUST = 110;

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
  const g = new ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0014, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -0.004);
  gearGeo.set(n, g);
  return g;
}

function gearMaterial(n: number): MeshStandardMaterial {
  return metal(COLORS[n] ?? 0x9a6a35, n === 10 || n === 20 ? 0.28 : 0.45);
}

function blueprintTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1160;
  c.height = 740;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 740);
  grad.addColorStop(0, '#2a2522');
  grad.addColorStop(1, '#161312');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1160, 740);
  let seed = 11;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '255,235,210' : '0,0,0') + ',' + (rnd() * 0.07).toFixed(3) + ')';
    g.fillRect(rnd() * 1160, rnd() * 740, 1 + rnd() * 30, 1);
  }
  const step = 50;
  for (let x = 0; x <= 1160; x += step) {
    g.strokeStyle = x % 100 === 0 ? 'rgba(200,150,70,0.42)' : 'rgba(200,150,70,0.16)';
    g.lineWidth = x % 100 === 0 ? 1.8 : 1;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 740);
    g.stroke();
  }
  for (let y = 0; y <= 740; y += step) {
    g.strokeStyle = y % 100 === 0 ? 'rgba(200,150,70,0.42)' : 'rgba(200,150,70,0.16)';
    g.lineWidth = y % 100 === 0 ? 1.8 : 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1160, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(214,169,74,0.85)';
  g.lineWidth = 4;
  g.strokeRect(26, 26, 1108, 688);
  // rivets
  const rivet = (x: number, y: number): void => {
    const rg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
    rg.addColorStop(0, '#f0cf8a');
    rg.addColorStop(1, '#5a4120');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, 6.5, 0, Math.PI * 2);
    g.fill();
  };
  for (let x = 60; x < 1160; x += 100) {
    rivet(x, 44);
    rivet(x, 696);
  }
  for (const y of [120, 220, 320, 420, 520, 620]) {
    rivet(44, y);
    rivet(1116, y);
  }
  g.fillStyle = 'rgba(224,180,100,0.9)';
  g.font = '600 22px sans-serif';
  g.fillText('GEARSHIFT  -  ASSEMBLY BENCH', 68, 84);
  g.font = '16px sans-serif';
  g.fillStyle = 'rgba(224,180,100,0.55)';
  g.fillText('module 7.5 mm   |   front layer / back layer', 68, 108);
  const ry = 740 / 2 - TRAY_Y * 1000 - 100;
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(60, ry, 1040, 200);
  g.strokeStyle = 'rgba(214,169,74,0.5)';
  g.setLineDash([10, 8]);
  g.strokeRect(60, ry, 1040, 200);
  g.setLineDash([]);
  g.fillStyle = 'rgba(224,180,100,0.6)';
  g.fillText('PARTS RACK', 76, ry + 26);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function gaugeTexture(label: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const bg = g.createRadialGradient(128, 128, 10, 128, 128, 120);
  bg.addColorStop(0, '#f4e7c4');
  bg.addColorStop(1, '#b89a64');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3a2a18';
  g.lineWidth = 3;
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
    g.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
    g.stroke();
  }
  g.fillStyle = '#3a2a18';
  g.font = '600 26px serif';
  g.textAlign = 'center';
  g.fillText(label, 128, 190);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
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
  private lights: PointLight[] = [];
  private bulbGlow: Mesh[] = [];
  private dust!: Points;
  private dustPos = new Float32Array(DUST * 3);
  private dustSeed = new Float32Array(DUST * 3);
  private conduits = new Group();
  private conduitMats: MeshBasicMaterial[] = [];
  private needles: Mesh[] = [];
  private needleVal = [0, 0];
  private crank = new Group();
  private sparkT = 0;
  private progress = 0;
  private efficiency = 0;

  private get lv(): Level {
    return LEVELS[this.level];
  }

  init(): void {
    const world = this.world;
    this.root.add(this.pegGroup, this.fixedGroup, this.partsGroup, this.conduits);
    world.createTransformEntity(this.root);

    // bench: walnut frame, blueprint board, a shelf for the rack
    const wood = new MeshStandardMaterial({ map: woodTexture(18, 2, 1), color: 0x7a5a48, roughness: 0.5 });
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
    const board = new Mesh(new PlaneGeometry(BW, BH), new MeshStandardMaterial({ map: blueprintTexture(), roughness: 0.6, metalness: 0.35, roughnessMap: scratchTexture(), bumpMap: scratchTexture(), bumpScale: 0.5 }));
    board.position.set(0, BY, BZ);
    board.receiveShadow = true;
    this.root.add(board);
    const legM = metal(0x2c2a2a, 0.5, 0.4);
    for (const x of [-0.5, 0.5]) {
      const leg = new Mesh(new BoxGeometry(0.05, BY - 0.35, 0.05), legM);
      leg.position.set(x, (BY - 0.35) / 2, BZ - 0.12);
      this.root.add(leg);
    }

    // riveted iron back panel, brass pipes, Edison lamps, gauges
    const iron = metal(0x3a3837, 0.55, 0.9);
    const brassM = metal(0xc79a46, 0.3, 0.4);
    const panel = new Mesh(roundedBox(BW + 0.5, BH + 0.4, 0.02, 0.01), iron);
    panel.position.set(0, BY + 0.05, BZ - 0.06);
    panel.receiveShadow = true;
    this.root.add(panel);
    for (const sx of [-1, 1]) {
      const pipe = new Mesh(new CylinderGeometry(0.014, 0.014, BH + 0.3, 14), brassM);
      pipe.position.set(sx * (BW / 2 + 0.2), BY + 0.1, BZ - 0.035);
      pipe.castShadow = true;
      this.root.add(pipe);
      for (const py of [-0.25, 0.0, 0.25]) {
        const band = new Mesh(new CylinderGeometry(0.02, 0.02, 0.012, 14), brassM);
        band.position.set(sx * (BW / 2 + 0.2), BY + 0.1 + py, BZ - 0.035);
        this.root.add(band);
      }
      const arm = new Mesh(new CylinderGeometry(0.005, 0.005, 0.2, 8), brassM);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(sx * (BW / 2 + 0.06), GAUGE_Y - 0.05, BZ + 0.05);
      this.root.add(arm);
      const bulb = new Mesh(new SphereGeometry(0.026, 16, 12), new MeshBasicMaterial({ color: 0xffe0a8 }));
      bulb.position.set(sx * (BW / 2 + 0.06), GAUGE_Y - 0.05, BZ + 0.16);
      this.root.add(bulb);
      const halo = new Mesh(new SphereGeometry(0.06, 16, 12), new MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }));
      halo.position.copy(bulb.position);
      this.root.add(halo);
      this.bulbGlow.push(halo);
      const cap = new Mesh(new CylinderGeometry(0.014, 0.018, 0.03, 12), brassM);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(bulb.position.x, bulb.position.y, bulb.position.z - 0.035);
      this.root.add(cap);
      const light = new PointLight(0xffa850, 2.6, 3, 2);
      light.position.set(bulb.position.x * 0.8, bulb.position.y - 0.05, bulb.position.z + 0.12);
      this.root.add(light);
      this.lights.push(light);
    }
    [['PROGRESS', -0.4], ['TORQUE', 0.4]].forEach(([label, gx], gi) => {
      const rim = new Mesh(new CylinderGeometry(0.06, 0.06, 0.016, 28), brassM);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(gx as number, GAUGE_Y, BZ + 0.0);
      this.root.add(rim);
      const face = new Mesh(new PlaneGeometry(0.1, 0.1), new MeshBasicMaterial({ map: gaugeTexture(label as string), transparent: true }));
      face.position.set(gx as number, GAUGE_Y, BZ + 0.0095);
      this.root.add(face);
      const needle = new Mesh(new PlaneGeometry(0.004, 0.042), new MeshBasicMaterial({ color: 0x8a1f12 }));
      needle.geometry.translate(0, 0.016, 0);
      needle.position.set(gx as number, GAUGE_Y, BZ + 0.0105);
      this.root.add(needle);
      this.needles[gi] = needle;
    });
    // drifting dust motes in the lamp light
    for (let i = 0; i < DUST * 3; i++) this.dustSeed[i] = Math.random();
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(this.dustPos, 3));
    this.dust = new Points(dg, new PointsMaterial({ size: 0.011, map: dotTexture(), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);

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
    for (const o of [...this.conduits.children]) this.conduits.remove(o);
    this.conduitMats = [];
    this.fixed.clear();
    this.pegMeshes = [];
    this.items = [];
    const brass = metal(0xd6a94a, 0.28, 0.4);
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
    const motor = new Mesh(gearGeometry(lv.motor.n), metal(0x8a3a2a, 0.35, 0.8));
    motor.position.set(mp.x, BY + mp.y, BZ + Z0);
    motor.castShadow = motor.receiveShadow = true;
    this.fixedGroup.add(motor);
    this.fixed.set(lv.motor.peg + ':0', motor);
    const box = new Mesh(roundedBox(0.07, 0.07, 0.03, 0.005), metal(0x2e2c2c, 0.5, 0.9));
    box.position.set(mp.x, BY + mp.y, BZ + Z0 + 0.026);
    box.castShadow = true;
    this.fixedGroup.add(box);
    const led = new Mesh(new CylinderGeometry(0.006, 0.006, 0.004, 12), new MeshBasicMaterial({ color: 0xff7a3a }));
    led.rotation.x = Math.PI / 2;
    led.position.set(mp.x, BY + mp.y + 0.026, BZ + Z0 + 0.043);
    this.fixedGroup.add(led);
    this.crank = new Group();
    const brassC = metal(0xd6a94a, 0.28, 0.3);
    const arm = new Mesh(roundedBox(0.012, 0.09, 0.008, 0.003), brassC);
    arm.position.set(0, 0.045, 0);
    const knob = new Mesh(new CylinderGeometry(0.011, 0.011, 0.03, 14), metal(0x2c2a2a, 0.4, 0.5));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0, 0.09, 0.012);
    const hubC = new Mesh(new CylinderGeometry(0.013, 0.013, 0.01, 14), brassC);
    hubC.rotation.x = Math.PI / 2;
    this.crank.add(arm, knob, hubC);
    this.crank.position.set(mp.x, BY + mp.y, BZ + Z0 + 0.05);
    arm.castShadow = knob.castShadow = true;
    this.fixedGroup.add(this.crank);
    const out = new Mesh(gearGeometry(lv.target.n), metal(0x2f6f86, 0.32, 0.6));
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
        const ax = new Mesh(new CylinderGeometry(0.009, 0.009, 0.03, 12), metal(0xc9c2b4, 0.25, 0.3));
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

  /** Blue energy conduits run along every meshed link; they light up when the machine solves the goal. */
  private rebuildConduits(): void {
    for (const o of [...this.conduits.children]) this.conduits.remove(o);
    this.conduitMats = [];
    const parts = this.ev.parts;
    for (const s of parts) {
      if (s.parent < 0) continue;
      const a = this.lv.pegs[parts[s.parent].peg];
      const b = this.lv.pegs[s.peg];
      if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
      const mat = new MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      this.conduitMats.push(mat);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const m = new Mesh(new PlaneGeometry(len, 0.012), mat);
      m.position.set((a.x + b.x) / 2, BY + (a.y + b.y) / 2, BZ + 0.037);
      m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      this.conduits.add(m);
    }
  }

  private measure(): void {
    const lv = this.lv;
    const need = lv.solution.filter((x) => x >= 0).length || 1;
    const have = this.placement.filter((x) => x >= 0).length;
    this.progress = this.ev.win ? 1 : Math.min(0.95, have / need) * 0.95;
    if (this.ev.win) this.efficiency = 1;
    else if (this.ev.jam) this.efficiency = 0.04;
    else if (this.ev.ratio <= 0) this.efficiency = 0;
    else {
      const goal = Math.sqrt(lv.target.minRatio * lv.target.maxRatio);
      const c = Math.min(this.ev.ratio, goal) / Math.max(this.ev.ratio, goal);
      this.efficiency = Math.min(0.9, c * (this.ev.dir === lv.target.dir ? 1 : 0.5));
    }
  }

  private evaluateNow(): void {
    this.ev = evaluate(this.lv, this.placement);
    this.phi = new Array(this.ev.parts.length).fill(0);
    this.rebuildConduits();
    this.measure();
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
      emitBurst(tp.x, BY + tp.y, BZ + 0.06, 1, 0.8, 0.35, 34, 0.9);
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
      p.card('rgba(34,24,16,0.94)', i === 2 && (this.solved || this.level < this.unlocked) ? '#8dff9d' : '#d6a94a');
      p.text(labels[i][0], p.h * 0.3, 22, '#d6a94a');
      p.text(labels[i][1], p.h * 0.7, 32, '#fff1d6');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    const lv = this.lv;
    h.card('rgba(26,18,12,0.9)', '#d6a94a');
    h.text('GEARSHIFT   Level ' + (this.level + 1) + ' / ' + LEVELS.length + '  -  ' + lv.name, 52, 30, '#e6f2ff');
    h.text(lv.goal, 104, 28, this.solved ? '#8dff9d' : '#ffd9a0');
    if (this.msgT > 0) h.text(this.msg, 152, 28, '#8dff9d');
    else h.text('Hint: ' + lv.hint, 152, 24, '#b9d6f5');
    const r = this.ev && this.ev.ratio > 0 ? 'Output ' + this.ev.ratio.toFixed(2) + 'x  ' + (this.ev.dir === lv.target.dir ? 'right way' : 'wrong way') : 'Output not connected yet';
    h.text(r + '    Assembly ' + Math.round(this.progress * 100) + '%   Torque ' + Math.round(this.efficiency * 100) + '%', 198, 22, '#e0b46a');
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
        emitBurst(p.x, BY + p.y, BZ + 0.05, 1, 0.78, 0.35, 16, 0.4);
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
    // crank follows the motor wheel
    const mm = this.fixed.get(this.lv.motor.peg + ':0');
    if (mm) this.crank.rotation.z = mm.rotation.z;
    // sparks: golden at meshing teeth while running, red where the train is jammed
    this.sparkT -= dt;
    if (this.sparkT <= 0 && parts.length > 1) {
      this.sparkT = this.ev.jam ? 0.09 : 0.45;
      const s = parts[1 + Math.floor(Math.random() * (parts.length - 1))];
      const a = s.parent >= 0 ? parts[s.parent] : null;
      const pa = this.lv.pegs[s.peg];
      const pb = a ? this.lv.pegs[a.peg] : pa;
      if (this.ev.jam) emitBurst((pa.x + pb.x) / 2, BY + (pa.y + pb.y) / 2, BZ + 0.045, 1, 0.2, 0.12, 6, 0.5);
      else if (powered && a && !s.sibling) emitBurst((pa.x + pb.x) / 2, BY + (pa.y + pb.y) / 2, BZ + 0.045, 1, 0.75, 0.3, 2, 0.22);
    }
    // gauges
    const target = [this.progress, this.efficiency];
    for (let gi = 0; gi < 2; gi++) {
      this.needleVal[gi] += (target[gi] - this.needleVal[gi]) * Math.min(1, dt * 4);
      if (this.needles[gi]) this.needles[gi].rotation.z = Math.PI * 0.75 - this.needleVal[gi] * Math.PI * 1.5;
    }
    // Edison flicker and dust
    const fl = 1 + Math.sin(this.time * 17) * 0.03 + Math.sin(this.time * 5.3) * 0.04;
    this.lights.forEach((l, i) => (l.intensity = 2.6 * fl * (i ? 0.95 : 1)));
    this.bulbGlow.forEach((b) => ((b.material as MeshBasicMaterial).opacity = 0.16 * fl));
    for (let i = 0; i < DUST; i++) {
      const a = this.dustSeed[i * 3];
      const b = this.dustSeed[i * 3 + 1];
      const c = this.dustSeed[i * 3 + 2];
      this.dustPos[i * 3] = (a - 0.5) * 1.3 + Math.sin(this.time * 0.15 + b * 20) * 0.05;
      this.dustPos[i * 3 + 1] = BY - 0.35 + ((b * 0.9 + this.time * 0.012 * (0.5 + c)) % 0.9);
      this.dustPos[i * 3 + 2] = BZ + 0.04 + c * 0.5 + Math.cos(this.time * 0.12 + a * 20) * 0.03;
    }
    (this.dust.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    // glowing conduits + emissive gears when the machine works
    const pulse = this.solved ? 0.55 + 0.35 * Math.sin(this.time * 7) : 0;
    this.conduitMats.forEach((m) => (m.opacity = this.ev.win ? pulse : 0));
    const em = this.ev.win ? 0.12 + 0.1 * Math.sin(this.time * 7) : 0;
    for (const it of this.items) for (const m of it.meshes) (m.material as MeshStandardMaterial).emissive.setRGB(0, em * 0.7, em);
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
