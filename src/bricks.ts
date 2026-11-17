import {
  BoxGeometry,
  CylinderGeometry,
  Entity,
  Group,
  Mesh,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  SphereGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { celebrate, emitBurst } from './fx.js';
import { askMentor } from './mentor.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { BrickOpt } from './ui-components.js';

// ---- Brick Builder: snap studded bricks together on a baseplate, then smash it with a wrecking ball.
const CX = 0;
const CZ = -0.55;
const TOP = 0.74;
const C = 0.032; // stud pitch
const N = 10; // baseplate cells per side
const H = 0.0192; // brick height
const PLATE_Y = TOP + 0.012;
const OX = CX - (N * C) / 2;
const OZ = CZ - 0.07 - (N * C) / 2;
const MAXL = 18;
const MAXB = 60;
const PINCH_START = 0.85;
const PINCH_HOLD = 0.5;
const HAND_PLANE_Y = 0.85;

type HandName = 'left' | 'right';
interface Def {
  w: number;
  d: number;
  color: number;
}
const DEFS: Def[] = [
  { w: 2, d: 2, color: 0xe3342f },
  { w: 2, d: 4, color: 0x2f7de3 },
  { w: 4, d: 2, color: 0x2fb36a },
  { w: 1, d: 4, color: 0xf4c430 },
  { w: 4, d: 1, color: 0xf08a24 },
  { w: 3, d: 2, color: 0x9b59d6 },
];
const SLOT: [number, number][] = [
  [-0.19, -0.3],
  [0, -0.3],
  [0.19, -0.3],
  [-0.19, -0.2],
  [0, -0.2],
  [0.19, -0.2],
];
const SLOT_R = 0.095;

interface Brick {
  g: Group;
  type: number;
  inUse: boolean;
  placed: boolean;
  held: boolean;
  ix: number;
  iz: number;
  lv: number;
  st: 0 | 1 | 2; // 0 stuck, 1 flying, 2 landed
  v: Vector3;
  wx: number;
  wz: number;
  t: number;
  c: boolean;
}
interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  held: Brick | null;
}

const stud = new CylinderGeometry(0.0095, 0.0095, 0.005, 12);
const mats = DEFS.map((d) => new MeshStandardMaterial({ color: d.color, roughness: 0.3, metalness: 0.02 }));

function makeBrickGroup(type: number): Group {
  const { w, d } = DEFS[type];
  const g = new Group();
  const body = new Mesh(new BoxGeometry(w * C - 0.0008, H, d * C - 0.0008), mats[type]);
  body.position.set((w * C) / 2, H / 2, (d * C) / 2);
  g.add(body);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const s = new Mesh(stud, mats[type]);
      s.position.set((i + 0.5) * C, H + 0.0025, (j + 0.5) * C);
      g.add(s);
    }
  }
  return g;
}

export class BrickSystem extends createSystem({
  opts: { required: [BrickOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private pool: Brick[][] = DEFS.map(() => []);
  private all: Brick[] = [];
  private ghosts: Mesh[] = [];
  private occ = new Int16Array(N * N * MAXL).fill(-1);
  private heights = new Int8Array(N * N);
  private placedOrder: Brick[] = [];
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'right', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, held: null },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private lastMode = '';
  private fontWasReady = false;
  private elapsed = 0;
  private hudDirty = true;
  private optCooldown = 0;
  private msg = '';
  private msgT = 0;
  private best = 0;
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private ndc = new Vector3();
  private cam = new Vector3();
  private ball!: Group;
  private rope!: Mesh;
  private smashT = -1;
  private smashH = 0;
  private smashY = 0.8;
  private smashZ = CZ;
  private tmp = new Vector3();

  init(): void {
    const add = (o: Mesh | Group): void => {
      this.world.createTransformEntity(o);
      this.root.push(o);
    };
    const wood = new MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.85 });
    const top = new Mesh(new CylinderGeometry(0.46, 0.46, 0.04, 56), wood);
    top.position.set(CX, 0.72, CZ);
    add(top);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 0.72, 8), wood);
      leg.position.set(CX + Math.cos(a) * 0.3, 0.34, CZ + Math.sin(a) * 0.3);
      add(leg);
    }
    const plate = new Mesh(new BoxGeometry(N * C + 0.01, 0.012, N * C + 0.01), new MeshStandardMaterial({ color: 0x37c26b, roughness: 0.4 }));
    plate.position.set(OX + (N * C) / 2, TOP + 0.006, OZ + (N * C) / 2);
    add(plate);
    const plateMat = new MeshStandardMaterial({ color: 0x37c26b, roughness: 0.4 });
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const s = new Mesh(stud, plateMat);
        s.position.set(OX + (i + 0.5) * C, PLATE_Y + 0.0025, OZ + (j + 0.5) * C);
        add(s);
      }
    }
    // tray items
    const trayBase = new Mesh(new BoxGeometry(0.5, 0.008, 0.2), new MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.8 }));
    trayBase.position.set(0, TOP + 0.004, -0.25);
    add(trayBase);
    for (let i = 0; i < DEFS.length; i++) {
      const g = makeBrickGroup(i);
      g.position.set(SLOT[i][0] - (DEFS[i].w * C) / 2, TOP + 0.008, SLOT[i][1] - (DEFS[i].d * C) / 2);
      add(g);
      const gm = new Mesh(new BoxGeometry(DEFS[i].w * C, H, DEFS[i].d * C), new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
      gm.visible = false;
      add(gm);
      this.ghosts.push(gm);
    }
    // wrecking ball
    this.ball = new Group();
    this.ball.add(new Mesh(new SphereGeometry(0.05, 20, 14), new MeshStandardMaterial({ color: 0x555a66, roughness: 0.3, metalness: 0.7 })));
    add(this.ball);
    this.rope = new Mesh(new CylinderGeometry(0.003, 0.003, 1, 6), new MeshStandardMaterial({ color: 0x222222 }));
    add(this.rope);
    this.ball.visible = false;
    this.rope.visible = false;

    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, 1.35, -0.72);
    this.hud.mesh.rotation.x = -0.25;
    add(this.hud.mesh);
    for (let i = 0; i < 3; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.56, 1.0 - i * 0.085, -0.45);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(BrickOpt, { id: i });
      this.btns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'bricks' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(BrickOpt, 'id') as number);
      }),
    );
    for (const o of this.root) o.visible = false;
    try {
      this.best = Number(localStorage.getItem('pw-brick-best') ?? '0') || 0;
    } catch {
      this.best = 0;
    }
    const w = window as unknown as Record<string, unknown>;
    w.__bricks = () => ({ mode: modeState.mode, placed: this.placedOrder.length, height: this.maxH(), best: this.best, smash: this.smashT });
    w.__brickPlace = (type: number, x: number, z: number) => {
      const b = this.take(type);
      if (b) this.drop(b, x, z, true);
    };
    w.__brickSmash = () => this.press(0);

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

  // ------------------------------------------------------------- bricks
  private maxH(): number {
    let m = 0;
    for (let i = 0; i < N * N; i++) if (this.heights[i] > m) m = this.heights[i];
    return m;
  }

  private take(type: number): Brick | null {
    if (this.all.filter((b) => b.inUse).length >= MAXB) return null;
    let b = this.pool[type].find((x) => !x.inUse);
    if (!b) {
      const g = makeBrickGroup(type);
      this.world.createTransformEntity(g);
      this.root.push(g);
      b = { g, type, inUse: false, placed: false, held: false, ix: 0, iz: 0, lv: 0, st: 0, v: new Vector3(), wx: 0, wz: 0, t: 0, c: false };
      this.pool[type].push(b);
      this.all.push(b);
    }
    b.inUse = true;
    b.held = true;
    b.placed = false;
    b.st = 0;
    b.g.visible = true;
    b.g.scale.setScalar(1);
    b.g.rotation.set(0, 0, 0);
    return b;
  }

  private release(b: Brick): void {
    if (b.c) this.uncenter(b);
    b.inUse = false;
    b.held = false;
    b.placed = false;
    b.g.visible = false;
  }

  private uncenter(b: Brick): void {
    const { w, d } = DEFS[b.type];
    for (const c of b.g.children) {
      c.position.x += (w * C) / 2;
      c.position.z += (d * C) / 2;
    }
    b.c = false;
    b.st = 0;
  }

  private snap(type: number, x: number, z: number): { ix: number; iz: number; lv: number } | null {
    const { w, d } = DEFS[type];
    let ix = Math.round((x - OX) / C - w / 2);
    let iz = Math.round((z - OZ) / C - d / 2);
    if (x < OX - 0.05 || x > OX + N * C + 0.05 || z < OZ - 0.05 || z > OZ + N * C + 0.05) return null;
    ix = Math.max(0, Math.min(N - w, ix));
    iz = Math.max(0, Math.min(N - d, iz));
    let lv = 0;
    for (let i = ix; i < ix + w; i++) for (let j = iz; j < iz + d; j++) lv = Math.max(lv, this.heights[j * N + i]);
    if (lv >= MAXL) return null;
    return { ix, iz, lv };
  }

  private drop(b: Brick, x: number, z: number, _t = false): boolean {
    b.held = false;
    const s = this.snap(b.type, x, z);
    if (!s) {
      this.release(b);
      return false;
    }
    const { w, d } = DEFS[b.type];
    b.ix = s.ix;
    b.iz = s.iz;
    b.lv = s.lv;
    b.placed = true;
    for (let i = s.ix; i < s.ix + w; i++) {
      for (let j = s.iz; j < s.iz + d; j++) {
        this.occ[(j * N + i) * MAXL + s.lv] = this.all.indexOf(b);
        this.heights[j * N + i] = s.lv + 1;
      }
    }
    this.placedOrder.push(b);
    this.layout(b);
    sfx.wood(0.5);
    emitBurst(OX + (s.ix + w / 2) * C, PLATE_Y + (s.lv + 1) * H, OZ + (s.iz + d / 2) * C, 1, 1, 0.8, 4, 0.15);
    this.checkHeight();
    this.hudDirty = true;
    return true;
  }

  private layout(b: Brick): void {
    b.g.position.set(OX + b.ix * C, PLATE_Y + b.lv * H, OZ + b.iz * C);
    b.g.rotation.set(0, 0, 0);
  }

  private isTop(b: Brick): boolean {
    const { w, d } = DEFS[b.type];
    for (let i = b.ix; i < b.ix + w; i++) for (let j = b.iz; j < b.iz + d; j++) if (this.heights[j * N + i] !== b.lv + 1) return false;
    return true;
  }

  private unplace(b: Brick): void {
    const { w, d } = DEFS[b.type];
    for (let i = b.ix; i < b.ix + w; i++) {
      for (let j = b.iz; j < b.iz + d; j++) {
        this.occ[(j * N + i) * MAXL + b.lv] = -1;
        this.heights[j * N + i] = b.lv;
      }
    }
    const k = this.placedOrder.indexOf(b);
    if (k >= 0) this.placedOrder.splice(k, 1);
    b.placed = false;
  }

  private checkHeight(): void {
    const h = this.maxH();
    if (h > this.best) {
      this.best = h;
      try {
        localStorage.setItem('pw-brick-best', String(h));
      } catch {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------------- actions
  private press(id: number): void {
    if (id === 0) {
      if (this.smashT >= 0 || this.placedOrder.length === 0) return;
      this.smashT = 0;
      this.smashH = this.maxH();
      this.smashY = PLATE_Y + Math.max(1, this.maxH() * 0.55) * H;
      this.smashZ = OZ + (N * C) / 2 + (Math.random() - 0.5) * 0.06;
      this.ball.visible = true;
      this.rope.visible = true;
      sfx.warp?.();
    } else if (id === 1) {
      const b = this.placedOrder[this.placedOrder.length - 1];
      if (b && this.isTop(b)) {
        this.unplace(b);
        this.release(b);
        sfx.plop();
      }
    } else {
      for (const b of this.all) if (b.inUse) this.release(b);
      this.occ.fill(-1);
      this.heights.fill(0);
      this.placedOrder.length = 0;
      for (const p of this.pointers) p.held = null;
    }
    this.hudDirty = true;
  }

  private drawBtns(): void {
    const labels = [
      ['SMASH', 'Wrecking ball'],
      ['UNDO', 'Remove last brick'],
      ['CLEAR', 'Clear baseplate'],
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.btns[i];
      p.card('rgba(40,24,12,0.9)', i === 0 ? '#ff8f8f' : '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 30, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    const ht = this.maxH();
    h.card();
    h.text('Brick builder', 56, 32);
    h.text('Bricks ' + this.placedOrder.length + '    Height ' + ht + '    Best ' + this.best, 100, 26, '#ffd9a0');
    const stars = ht >= 14 ? '★★★' : ht >= 10 ? '★★' : ht >= 6 ? '★' : '';
    if (this.msgT > 0) h.text(this.msg, 150, 30, '#8dff9d');
    else h.text(stars ? 'Tower ' + stars + '  Now smash it!' : 'Build a tall tower: 6 high = ★', 150, 26, '#ffe9c4');
    h.text('Pinch a brick from the tray, drop it on the plate', 195, 22, '#cdb99a');
    h.commit();
  }

  // ------------------------------------------------------------- input
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
    if (Math.abs(this.ndc.y) < 1e-5) return false;
    const t = (HAND_PLANE_Y - this.cam.y) / this.ndc.y;
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
    if (this.smashT >= 0) {
      pt.was = pt.down;
      return;
    }
    if (pt.down && !pt.was) {
      // tray first
      let slot = -1;
      for (let i = 0; i < SLOT.length; i++) {
        if (Math.hypot(pt.pos.x - SLOT[i][0], pt.pos.z - SLOT[i][1]) < SLOT_R) slot = i;
      }
      if (slot >= 0) {
        const b = this.take(slot);
        if (b) {
          pt.held = b;
          sfx.grab();
        }
      } else {
        let best: Brick | null = null;
        let bd = 0.07;
        for (const b of this.placedOrder) {
          if (!this.isTop(b)) continue;
          const { w, d } = DEFS[b.type];
          const dist = Math.hypot(OX + (b.ix + w / 2) * C - pt.pos.x, OZ + (b.iz + d / 2) * C - pt.pos.z);
          if (dist < bd) {
            bd = dist;
            best = b;
          }
        }
        if (best) {
          this.unplace(best);
          best.held = true;
          pt.held = best;
          sfx.grab();
        }
      }
      this.hudDirty = true;
    }
    if (pt.down && pt.held) {
      const b = pt.held;
      const { w, d } = DEFS[b.type];
      b.g.position.set(pt.pos.x - (w * C) / 2, Math.max(PLATE_Y + 0.03, pt.pos.y - 0.02), pt.pos.z - (d * C) / 2);
      const s = this.snap(b.type, pt.pos.x, pt.pos.z);
      const gh = this.ghosts[b.type];
      for (const g of this.ghosts) g.visible = false;
      if (s) {
        gh.visible = true;
        gh.position.set(OX + (s.ix + w / 2) * C, PLATE_Y + s.lv * H + H / 2, OZ + (s.iz + d / 2) * C);
      }
    }
    if (!pt.down && pt.was && pt.held) {
      const b = pt.held;
      pt.held = null;
      for (const g of this.ghosts) g.visible = false;
      const { w, d } = DEFS[b.type];
      this.drop(b, b.g.position.x + (w * C) / 2, b.g.position.z + (d * C) / 2);
    }
    pt.was = pt.down;
  }

  // ------------------------------------------------------------- smash
  private updateSmash(dt: number): void {
    this.smashT += dt;
    const T = 1.6;
    const k = Math.min(1, this.smashT / T);
    const e = k * k * (3 - 2 * k);
    const bx = CX - 0.5 + e * 1.0;
    this.ball.position.set(bx, this.smashY, this.smashZ);
    this.rope.position.set(bx, (this.smashY + 1.6) / 2, this.smashZ);
    this.rope.scale.set(1, 1.6 - this.smashY, 1);
    // direct hits, then cascade upward
    const hit = new Set<Brick>();
    for (const b of this.placedOrder) {
      if (b.st !== 0) continue;
      const { w, d } = DEFS[b.type];
      const cx = OX + (b.ix + w / 2) * C;
      const cz = OZ + (b.iz + d / 2) * C;
      const cy = PLATE_Y + (b.lv + 0.5) * H;
      if (Math.abs(cx - bx) < 0.05 + (w * C) / 2 && Math.abs(cz - this.smashZ) < 0.05 + (d * C) / 2 && Math.abs(cy - this.smashY) < 0.055) hit.add(b);
    }
    if (hit.size) {
      for (let lv = 0; lv < MAXL; lv++) {
        for (const b of this.placedOrder) {
          if (b.lv !== lv || hit.has(b) || lv === 0) continue;
          const { w, d } = DEFS[b.type];
          let sup = false;
          for (let i = b.ix; i < b.ix + w && !sup; i++) {
            for (let j = b.iz; j < b.iz + d; j++) {
              const id = this.occ[(j * N + i) * MAXL + lv - 1];
              if (id >= 0 && hit.has(this.all[id])) {
                sup = true;
                break;
              }
            }
          }
          if (sup) hit.add(b);
        }
      }
      for (const b of hit) {
        const { w, d } = DEFS[b.type];
        b.st = 1;
        b.t = 0;
        b.v.set(1.3 + Math.random() * 1.4, 1.0 + Math.random() * 1.6, (Math.random() - 0.5) * 1.8);
        b.wx = (Math.random() - 0.5) * 12;
        b.wz = (Math.random() - 0.5) * 12;
        b.g.position.x += (w * C) / 2;
        b.g.position.z += (d * C) / 2;
        for (const c of b.g.children) {
          c.position.x -= (w * C) / 2;
          c.position.z -= (d * C) / 2;
        }
        b.c = true;
        this.unplace(b);
        b.placed = false;
        emitBurst(b.g.position.x, b.g.position.y, b.g.position.z, 1, 0.8, 0.4, 6, 0.4);
        sfx.thud?.(0.8);
      }
      this.hudDirty = true;
    }
    if (this.smashT > T + 0.4) {
      this.smashT = -1;
      celebrate(OX + (N * C) / 2, PLATE_Y + 0.1, OZ + (N * C) / 2, 2);
      askMentor('bricks', 'a toy-brick tower ' + this.smashH + ' bricks high was just smashed with a wrecking ball', (t) => {
        this.msg = t;
        this.msgT = 9;
        this.hudDirty = true;
      });
      this.ball.visible = false;
      this.rope.visible = false;
      this.msg = 'Boom!  Build again.';
      this.msgT = 4;
      this.hudDirty = true;
    }
  }

  private updateDebris(dt: number): void {
    for (const b of this.all) {
      if (!b.inUse || b.st === 0) continue;
      if (b.st === 1) {
        b.v.y -= 9.8 * dt;
        b.g.position.addScaledVector(b.v, dt);
        b.g.rotation.x += b.wx * dt;
        b.g.rotation.z += b.wz * dt;
        if (b.g.position.y < TOP + 0.012) {
          b.g.position.y = TOP + 0.012;
          b.st = 2;
          b.t = 0;
          sfx.wood(0.3);
        }
      } else {
        b.t += dt;
        if (b.t > 2) {
          const s = Math.max(0, 1 - (b.t - 2) * 2);
          b.g.scale.setScalar(s);
          if (s <= 0) {
            this.release(b);
          }
        }
      }
    }
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'bricks';
      for (const o of this.root) o.visible = on;
      for (const b of this.all) b.g.visible = on && b.inUse;
      for (const g of this.ghosts) g.visible = false;
      this.ball.visible = false;
      this.rope.visible = false;
      if (on) {
        this.hudDirty = true;
        this.drawBtns();
      }
    }
    if (modeState.mode !== 'bricks') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    for (const pt of this.pointers) this.updatePointer(pt);
    if (this.smashT >= 0) this.updateSmash(dt);
    this.updateDebris(dt);
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
