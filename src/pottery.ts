import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Entity,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { PotOpt } from './ui-components.js';

// ---- Layout (metres, in front of the seated player)
const TABLE_Y = 0.72;
const TABLE_TOP = 0.74;
const CX = 0;
const CZ = -0.55;
const WHEEL_TOP = 0.79;
const WHEEL_R = 0.14;
const N = 26; // rings up the wall
const S = 40; // segments around
const FLOOR_RING = 2;
const WALL = 0.012;
const R_MIN = 0.022;
const R_MAX = 0.13;
const H_MIN = 0.06;
const H_MAX = 0.27;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const BAND = 0.032;
const SPIN = 4.2;

type HandName = 'left' | 'right';

interface Target {
  name: string;
  bn: string;
  h: number;
  r: (t: number) => number;
}

const TARGETS: Target[] = [
  { name: 'Kolshi (water pot)', bn: 'কলসি', h: 0.19, r: (t) => 0.046 + 0.046 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.12)) - 0.012 * t },
  { name: 'Bowl', bn: 'বাটি', h: 0.09, r: (t) => 0.045 + 0.055 * Math.pow(t, 0.8) },
  { name: 'Tall vase', bn: 'ফুলদানি', h: 0.24, r: (t) => 0.052 + 0.028 * Math.sin(t * Math.PI * 1.6) - 0.01 * t },
];

const GLAZES: { name: string; color: number }[] = [
  { name: 'Terracotta', color: 0xc0653a },
  { name: 'River blue', color: 0x2f6fb0 },
  { name: 'Paddy green', color: 0x3f9a5c },
  { name: 'Rice white', color: 0xece4d2 },
  { name: 'Alta red', color: 0xb23a2e },
  { name: 'Mustard', color: 0xdba92c },
];

interface Saved {
  h: number;
  r: number[];
  c: number;
}

/** A lathe-style hollow pot built from per-ring radii. Rewritten in place when sculpted. */
class Pot {
  readonly mesh: Mesh;
  readonly r = new Float32Array(N);
  h = 0.13;
  private readonly rows = N + (N - FLOOR_RING);
  private readonly pos: Float32Array;
  private readonly geo = new BufferGeometry();

  constructor(material: MeshStandardMaterial) {
    const verts = this.rows * (S + 1) + 1;
    this.pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const idx: number[] = [];
    for (let j = 0; j < this.rows; j++) {
      for (let s = 0; s <= S; s++) {
        const v = j * (S + 1) + s;
        uv[v * 2] = (s / S) * 3;
        uv[v * 2 + 1] = j / (this.rows - 1);
      }
    }
    for (let j = 0; j < this.rows - 1; j++) {
      for (let s = 0; s < S; s++) {
        const a = j * (S + 1) + s;
        const b = a + 1;
        const c = a + S + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const centre = verts - 1;
    const last = (this.rows - 1) * (S + 1);
    for (let s = 0; s < S; s++) idx.push(centre, last + s + 1, last + s);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new Mesh(this.geo, material);
    this.reset();
  }

  reset(): void {
    this.h = 0.13;
    for (let i = 0; i < N; i++) this.r[i] = 0.07;
    this.rebuild();
  }

  loadFrom(h: number, r: number[]): void {
    this.h = h;
    for (let i = 0; i < N; i++) this.r[i] = r[i];
    this.rebuild();
  }

  radiusAt(t: number): number {
    const f = Math.min(N - 1, Math.max(0, t * (N - 1)));
    const i = Math.floor(f);
    const k = f - i;
    return this.r[i] * (1 - k) + this.r[Math.min(N - 1, i + 1)] * k;
  }

  smooth(): void {
    for (let i = 1; i < N - 1; i++) {
      const avg = (this.r[i - 1] + this.r[i + 1]) * 0.5;
      this.r[i] += (avg - this.r[i]) * 0.18;
    }
  }

  rebuild(): void {
    const p = this.pos;
    for (let j = 0; j < this.rows; j++) {
      let i: number;
      let rad: number;
      if (j < N) {
        i = j;
        rad = this.r[i];
      } else {
        i = N - 1 - (j - N);
        rad = Math.max(0.004, this.r[i] - WALL);
      }
      const y = (this.h * i) / (N - 1);
      for (let s = 0; s <= S; s++) {
        const a = (s / S) * Math.PI * 2;
        const v = (j * (S + 1) + s) * 3;
        p[v] = Math.cos(a) * rad;
        p[v + 1] = y;
        p[v + 2] = Math.sin(a) * rad;
      }
    }
    const c = (this.rows * (S + 1)) * 3;
    p[c] = 0;
    p[c + 1] = (this.h * FLOOR_RING) / (N - 1);
    p[c + 2] = 0;
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}

function clayTexture(base: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,230,200,0.07)' : 'rgba(60,30,15,0.09)';
    g.fillRect(Math.random() * 256, 0, 1 + Math.random() * 3, 256);
  }
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = 'rgba(70,40,25,0.1)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

function woodTex(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#9a6b3f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(60,35,15,0.25)' : 'rgba(200,150,90,0.2)';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * 256;
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + Math.random() * 8 - 4, 170, y + Math.random() * 8 - 4, 256, y + Math.random() * 6 - 3);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

const SHELF_SLOTS = 4;

export class PotterySystem extends createSystem({
  opts: { required: [PotOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private clayMat!: MeshStandardMaterial;
  private pot!: Pot;
  private spinGroup = new Group();
  private targetPot!: Pot;
  private targetMat!: MeshStandardMaterial;
  private shelfPots: Pot[] = [];
  private shelfMats: MeshStandardMaterial[] = [];
  private saved: Saved[] = [];
  private lastMode = '';
  private fontWasReady = false;
  private elapsed = 0;
  private hudDirty = true;
  private optCooldown = 0;
  private targetIdx = 0;
  private glaze = 0;
  private fired = false;
  private firedT = 0;
  private msg = '';
  private msgT = 0;
  private match = 0;
  private matchTick = 0;
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private handPos = new Vector3();
  private soundT = 0;
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private ndc = new Vector3();
  private dir = new Vector3();
  private sculpted = false;
  private dirty = false;

  init(): void {
    const wood = new MeshStandardMaterial({ map: woodTex(), roughness: 0.85 });
    const dark = new MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.7 });
    this.clayMat = new MeshStandardMaterial({
      color: 0xffffff,
      map: clayTexture('#9b5b3a'),
      roughness: 0.75,
      side: DoubleSide,
    });
    const add = (o: Mesh | Group): void => {
      this.world.createTransformEntity(o);
      this.root.push(o);
    };

    // wooden table
    const top = new Mesh(new CylinderGeometry(0.46, 0.46, 0.04, 56), wood);
    top.position.set(CX, TABLE_Y, CZ);
    add(top);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 0.72, 8), wood);
      leg.position.set(CX + Math.cos(a) * 0.3, TABLE_Y * 0.5 - 0.02, CZ + Math.sin(a) * 0.3);
      add(leg);
    }

    // the wheel: a fat disc on a short post
    const post = new Mesh(new CylinderGeometry(0.03, 0.045, WHEEL_TOP - TABLE_TOP - 0.012, 14), dark);
    post.position.set(CX, (TABLE_TOP + WHEEL_TOP - 0.012) / 2, CZ);
    add(post);
    const disc = new Mesh(new CylinderGeometry(WHEEL_R, WHEEL_R * 1.05, 0.016, 48), new MeshStandardMaterial({ color: 0x6a5a4c, roughness: 0.6, metalness: 0.2 }));
    disc.position.set(CX, WHEEL_TOP - 0.008, CZ);
    add(disc);

    // clay
    this.pot = new Pot(this.clayMat);
    this.spinGroup.position.set(CX, WHEEL_TOP, CZ);
    this.spinGroup.add(this.pot.mesh);
    add(this.spinGroup);

    // target display stand (left): a small copy of the pot to match
    const stand = new Mesh(new CylinderGeometry(0.06, 0.07, 0.015, 24), wood);
    stand.position.set(-0.34, TABLE_TOP + 0.01, CZ - 0.04);
    add(stand);
    this.targetMat = new MeshStandardMaterial({ color: 0x7ec8ff, roughness: 0.3, transparent: true, opacity: 0.55, side: DoubleSide });
    this.targetPot = new Pot(this.targetMat);
    this.targetPot.mesh.position.set(-0.34, TABLE_TOP + 0.018, CZ - 0.04);
    this.targetPot.mesh.scale.setScalar(0.7);
    add(this.targetPot.mesh);

    // kiln: a mud dome with a dark mouth, on the right
    const kilnMat = new MeshStandardMaterial({ color: 0x9c6a4a, roughness: 1, map: clayTexture('#a06a48') });
    const dome = new Mesh(new LatheGeometry([...Array(14)].map((_, i) => new Vector2(Math.cos((i / 13) * Math.PI * 0.5) * 0.09, Math.sin((i / 13) * Math.PI * 0.5) * 0.09)), 18), kilnMat);
    dome.position.set(0.34, TABLE_TOP + 0.02, CZ - 0.05);
    add(dome);
    const mouth = new Mesh(new CylinderGeometry(0.028, 0.028, 0.02, 16), new MeshBasicMaterial({ color: 0x140a06 }));
    mouth.rotation.x = Math.PI / 2;
    mouth.position.set(0.34, TABLE_TOP + 0.045, CZ - 0.05 + 0.085);
    add(mouth);

    // shelf for finished pots (back)
    const board = new Mesh(new BoxGeometry(0.58, 0.014, 0.1), wood);
    board.position.set(0, TABLE_TOP + 0.012, CZ - 0.34);
    add(board);
    for (let i = 0; i < SHELF_SLOTS; i++) {
      const mat = new MeshStandardMaterial({ color: 0xc0653a, roughness: 0.3, metalness: 0.05, side: DoubleSide });
      const p = new Pot(mat);
      p.mesh.scale.setScalar(0.5);
      p.mesh.position.set(-0.19 + i * 0.127, TABLE_TOP + 0.022, CZ - 0.34);
      p.mesh.visible = false;
      this.shelfPots.push(p);
      this.shelfMats.push(mat);
      add(p.mesh);
    }

    // HUD + option buttons
    this.hud = new TextPanel(0.5, 0.2);
    this.hud.mesh.position.set(0, TABLE_TOP + 0.42, CZ - 0.2);
    this.hud.mesh.rotation.x = -0.35;
    add(this.hud.mesh);
    for (let i = 0; i < 3; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.52, 0.98 - i * 0.085, -0.42);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(PotOpt, { id: i });
      this.btns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'pottery' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(PotOpt, 'id') as number);
      }),
    );

    for (const o of this.root) o.visible = false;
    try {
      const raw = localStorage.getItem('guti-pots');
      if (raw) this.saved = (JSON.parse(raw) as Saved[]).filter((s) => s.r && s.r.length === N).slice(-SHELF_SLOTS);
    } catch {
      this.saved = [];
    }
    this.refreshShelf();
    this.setTarget(0);
    this.drawBtns();

    (window as unknown as { __pottery?: () => unknown }).__pottery = () => ({
      mode: modeState.mode,
      h: this.pot.h,
      r: Array.from(this.pot.r).map((v) => Math.round(v * 1000) / 1000),
      match: Math.round(this.match),
      fired: this.fired,
      shelf: this.saved.length,
      target: this.targetIdx,
    });
    // test hook: sculpt with a virtual pinch at a world position
    (window as unknown as { __potSculpt?: (x: number, y: number, z: number, dt: number) => void }).__potSculpt = (x, y, z, dt) => {
      this.sculptAt(x, y, z, dt);
    };
    (window as unknown as { __potPress?: (id: number) => void }).__potPress = (id) => {
      this.press(id);
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

  // ------------------------------------------------------------------ helpers
  private say(text: string, seconds: number): void {
    this.msg = text;
    this.msgT = seconds;
    this.hudDirty = true;
  }

  private setTarget(i: number): void {
    this.targetIdx = i % TARGETS.length;
    const t = TARGETS[this.targetIdx];
    this.targetPot.h = t.h;
    for (let k = 0; k < N; k++) this.targetPot.r[k] = t.r(k / (N - 1));
    this.targetPot.rebuild();
    this.hudDirty = true;
  }

  private refreshShelf(): void {
    for (let i = 0; i < SHELF_SLOTS; i++) {
      const s = this.saved[i];
      const p = this.shelfPots[i];
      if (!s) {
        p.mesh.visible = false;
        continue;
      }
      p.loadFrom(s.h, s.r);
      this.shelfMats[i].color.setHex(s.c);
      p.mesh.visible = modeState.mode === 'pottery';
    }
  }

  private computeMatch(): void {
    const t = TARGETS[this.targetIdx];
    let err = 0;
    for (let i = 0; i < N; i += 1) {
      const tt = i / (N - 1);
      err += Math.abs(this.pot.radiusAt(tt) - t.r(tt));
    }
    err /= N;
    const he = Math.abs(this.pot.h - t.h);
    this.match = Math.max(0, Math.min(100, 100 * (1 - err / 0.035 - he / 0.18)));
  }

  private press(id: number): void {
    if (id === 0) {
      this.glaze = (this.glaze + 1) % GLAZES.length;
      if (this.fired) this.clayMat.color.setHex(GLAZES[this.glaze].color);
    } else if (id === 1) {
      if (!this.fired) this.fire();
      else this.newClay();
    } else {
      this.setTarget(this.targetIdx + 1);
      this.newClay();
    }
    this.drawBtns();
    this.hudDirty = true;
  }

  private fire(): void {
    this.fired = true;
    this.firedT = 0;
    const g = GLAZES[this.glaze];
    this.clayMat.map = null;
    this.clayMat.color.setHex(g.color);
    this.clayMat.roughness = 0.22;
    this.clayMat.metalness = 0.08;
    this.clayMat.needsUpdate = true;
    sfx.kiln();
    emitBurst(CX, WHEEL_TOP + this.pot.h, CZ, 1, 0.75, 0.35, 70, 0.8);
    this.saved.push({ h: this.pot.h, r: Array.from(this.pot.r), c: g.color });
    this.saved = this.saved.slice(-SHELF_SLOTS);
    try {
      localStorage.setItem('guti-pots', JSON.stringify(this.saved));
    } catch {
      /* ignore */
    }
    this.refreshShelf();
    this.say(this.match >= 80 ? 'Beautiful! On your shelf' : 'Fired! On your shelf', 4);
    this.drawBtns();
  }

  private newClay(): void {
    this.fired = false;
    this.clayMat.map = clayTexture('#9b5b3a');
    this.clayMat.color.setHex(0xffffff);
    this.clayMat.roughness = 0.75;
    this.clayMat.metalness = 0;
    this.clayMat.needsUpdate = true;
    this.pot.reset();
    this.sculpted = false;
    this.computeMatch();
    this.drawBtns();
    this.hudDirty = true;
  }

  private drawBtns(): void {
    const labels = [
      ['GLAZE', GLAZES[this.glaze].name],
      [this.fired ? 'NEXT' : 'KILN', this.fired ? 'New clay' : 'Fire it'],
      ['TARGET', TARGETS[(this.targetIdx + 1) % TARGETS.length].name.split(' ')[0] + ' next'],
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.btns[i];
      p.card('rgba(40,24,12,0.9)', i === 0 ? '#' + GLAZES[this.glaze].color.toString(16).padStart(6, '0') : '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 32, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    const t = TARGETS[this.targetIdx];
    h.card();
    h.text('Pottery wheel  •  কুমোরের চাকা', 62, 34);
    if (this.msgT > 0) {
      h.text(this.msg, 130, 38, '#8dff9d');
    } else if (!this.sculpted) {
      h.text('Pinch inside the clay and push out', 120, 30);
    } else {
      h.text('Make a ' + t.name + '   match ' + Math.round(this.match) + '%', 125, 30, this.match >= 80 ? '#8dff9d' : '#ffe9c4');
    }
    h.text(
      this.sculpted ? 'Pinch outside to press in, pinch the rim and lift to grow it' : 'Inside = widen, outside = squeeze, rim = lift',
      190,
      24,
      '#cdb99a',
    );
    h.commit();
  }

  // ------------------------------------------------------------------ sculpting
  /** Pinch point in world space: shape the wall near it. */
  private sculptAt(wx: number, wy: number, wz: number, dt: number): void {
    if (this.fired) return;
    const lx = wx - CX;
    const lz = wz - CZ;
    const ly = wy - WHEEL_TOP;
    const d = Math.hypot(lx, lz);
    const pot = this.pot;
    let changed = false;
    // rim: pinch near the lip and lift or lower it
    const rTop = pot.r[N - 1];
    if (Math.abs(ly - pot.h) < 0.04 && Math.abs(d - rTop) < 0.04) {
      const target = Math.max(H_MIN, Math.min(H_MAX, ly));
      const nh = pot.h + (target - pot.h) * Math.min(1, 9 * dt);
      if (Math.abs(nh - pot.h) > 1e-5) {
        pot.h = nh;
        changed = true;
      }
    } else {
      for (let i = FLOOR_RING; i < N; i++) {
        const yi = (pot.h * i) / (N - 1);
        const dy = Math.abs(ly - yi);
        if (dy > BAND) continue;
        const ri = pot.r[i];
        const gap = d - (ri - WALL * 0.5);
        const rate = 0.12 * (1 - dy / BAND) * dt;
        if (gap < 0 && gap > -0.045) {
          // hand inside the hollow: push the wall outward
          if (ri < R_MAX) {
            pot.r[i] = Math.min(R_MAX, ri + rate);
            changed = true;
          }
        } else if (gap >= 0 && gap < 0.045) {
          // hand outside: squeeze the wall inward
          if (ri > R_MIN) {
            pot.r[i] = Math.max(R_MIN, ri - rate);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      pot.smooth();
      this.dirty = true;
      if (!this.sculpted) {
        this.sculpted = true;
        this.hudDirty = true;
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

  /** Mouse fallback: a point on the plane through the wheel axis, facing the viewer. */
  private mousePoint(out: Vector3): boolean {
    const cam = this.world.camera;
    this.ndc.set((this.mouseX / window.innerWidth) * 2 - 1, -(this.mouseY / window.innerHeight) * 2 + 1, 0.5);
    this.ndc.unproject(cam);
    cam.getWorldPosition(this.dir);
    this.ndc.sub(this.dir);
    if (Math.abs(this.ndc.z) < 1e-5) return false;
    const t = (CZ - this.dir.z) / this.ndc.z;
    if (t <= 0) return false;
    out.copy(this.dir).addScaledVector(this.ndc, t);
    return true;
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'pottery';
      for (const o of this.root) o.visible = on;
      if (on) {
        this.refreshShelf();
        this.newClay();
        this.say('Shape the clay with your hands', 4);
      }
    }
    if (modeState.mode !== 'pottery') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);

    let pressing = false;
    for (const hand of ['left', 'right'] as HandName[]) {
      const p = this.readPinch(hand);
      this.pinching[hand] = p;
      if (p && this.readHandPos(hand, this.handPos)) {
        this.sculptAt(this.handPos.x, this.handPos.y, this.handPos.z, dt);
        pressing = true;
      }
    }
    if (this.mouseDown && this.mousePoint(this.handPos)) {
      this.sculptAt(this.handPos.x, this.handPos.y, this.handPos.z, dt);
      pressing = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.pot.rebuild();
      this.soundT -= dt;
      if (pressing && this.soundT <= 0) {
        this.soundT = 0.12;
        sfx.clay();
      }
    }

    // spinning wheel
    this.spinGroup.rotation.y += dt * SPIN * (this.fired ? 0.4 : 1);
    if (this.fired) {
      this.firedT += dt;
    }

    this.matchTick -= dt;
    if (this.matchTick <= 0) {
      this.matchTick = 0.25;
      const before = Math.round(this.match);
      this.computeMatch();
      if (Math.round(this.match) !== before) this.hudDirty = true;
    }
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
