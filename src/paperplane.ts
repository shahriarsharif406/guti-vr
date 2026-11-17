import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Entity,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  Quaternion,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { PlaneOpt } from './ui-components.js';

// ---- Paper Plane: fold a sheet with three pinch-drags, then throw it through the hoops.
const CX = 0;
const CZ = -0.55;
const TOP = 0.74;
const SY = TOP + 0.004; // sheet height
const W = 0.2;
const L = 0.28;
const PINCH_START = 0.85;
const PINCH_HOLD = 0.5;
const HAND_PLANE_Y = 0.85;
const GRAB_R = 0.095;
const FLAP_Y = 0.0016;
const WING = 0.5;

type HandName = 'left' | 'right';
type Phase = 'fold' | 'ready' | 'held' | 'fly' | 'landed';

interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  grab: number; // fold step being dragged, 10 = plane held, -1 none
  sx: number;
  sz: number;
}

function polyGeo(pts: [number, number][]): BufferGeometry {
  const g = new BufferGeometry();
  const v: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    for (const k of [0, i, i + 1]) v.push(pts[k][0], 0, -pts[k][1]);
  }
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const HW = W / 2;
const HL = L / 2;
// left half polygons in (u, v): full rect, and with the nose corner removed
const LEFT_FULL: [number, number][] = [[0, -HL], [-HW, -HL], [-HW, HL], [0, HL]];
const LEFT_CUT: [number, number][] = [[0, -HL], [-HW, -HL], [-HW, HL - HW], [0, HL]];
const mirror = (a: [number, number][]): [number, number][] => a.map(([u, v]) => [-u, v]);

export class PaperPlaneSystem extends createSystem({
  opts: { required: [PlaneOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private plane = new Group(); // the paper plane; nose points to -z
  private half: Group[] = [new Group(), new Group()]; // [left, right]
  private baseMesh: Mesh[] = [];
  private flapPivot: Group[] = [new Group(), new Group()];
  private hoops: { m: Mesh; x: number; y: number; z: number; hit: boolean }[] = [];
  private marker!: Mesh;
  private hintDot!: Mesh;
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, grab: -1, sx: 0, sz: 0 },
    { src: 'right', pos: new Vector3(), down: false, was: false, grab: -1, sx: 0, sz: 0 },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, grab: -1, sx: 0, sz: 0 },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private phase: Phase = 'fold';
  private step = 0; // 0 left flap, 1 right flap, 2 fold in half, 3 done
  private cur = [0, 0, 0]; // animated angle for flapL, flapR, fold
  private tgt = [0, 0, 0];
  private wing = 0; // wing opening 0..1
  private wingT = 0;
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
  private best = 0;
  private dist = 0;
  private rings = 0;
  // flight
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private hx = 0;
  private hz = 0;
  private sp = 0;
  private vy = 0;
  private turn = 0;
  private startX = 0;
  private startZ = 0;
  private flyT = 0;
  // hand velocity tracking
  private hist: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private histT: number[] = [0, 0, 0, 0, 0, 0];
  private histN = 0;
  private qa = new Quaternion();
  private ax = new Vector3();

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
    const mat = new MeshStandardMaterial({ color: 0x59b8ff, roughness: 0.7, side: DoubleSide });
    const matFlap = new MeshStandardMaterial({ color: 0xfafcff, roughness: 0.7, side: DoubleSide });
    for (let i = 0; i < 2; i++) {
      const hg = this.half[i];
      const m = new Mesh(polyGeo(i === 0 ? LEFT_FULL : mirror(LEFT_FULL)), mat);
      this.baseMesh.push(m);
      hg.add(m);
      const sgn = i === 0 ? -1 : 1;
      const pv = this.flapPivot[i];
      pv.position.set(0, FLAP_Y, -HL);
      // flap triangle relative to the nose point
      const fg = new BufferGeometry();
      fg.setAttribute('position', new Float32BufferAttribute([0, 0, 0, sgn * HW, 0, 0, sgn * HW, 0, HW], 3));
      fg.computeVertexNormals();
      pv.add(new Mesh(fg, matFlap));
      hg.add(pv);
      this.plane.add(hg);
    }
    this.plane.position.set(CX, SY, CZ);
    add(this.plane);

    this.marker = new Mesh(new RingGeometry(0.02, 0.028, 24), new MeshBasicMaterial({ color: 0xffe27a, side: DoubleSide, transparent: true, opacity: 0.9 }));
    this.marker.rotation.x = -Math.PI / 2;
    add(this.marker);
    this.hintDot = new Mesh(new SphereGeometry(0.006, 10, 8), new MeshBasicMaterial({ color: 0xffe27a }));
    add(this.hintDot);

    // hoops
    const hoopGeo = new TorusGeometry(0.45, 0.03, 10, 36);
    const spots: [number, number, number][] = [
      [-0.8, 1.15, -3.2],
      [0.8, 1.5, -5.2],
      [-0.5, 1.1, -7.4],
    ];
    for (const [x, y, z] of spots) {
      const m = new Mesh(hoopGeo, new MeshStandardMaterial({ color: 0xffc83d, emissive: 0x553300, roughness: 0.4 }));
      m.position.set(x, y, z);
      add(m);
      this.hoops.push({ m, x, y, z, hit: false });
    }

    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, 1.35, -0.72);
    this.hud.mesh.rotation.x = -0.25;
    add(this.hud.mesh);
    for (let i = 0; i < 2; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.56, 1.0 - i * 0.085, -0.45);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(PlaneOpt, { id: i });
      this.btns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'paperplane' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(PlaneOpt, 'id') as number);
      }),
    );
    for (const o of this.root) o.visible = false;
    try {
      this.best = Number(localStorage.getItem('pw-plane-best') ?? '0') || 0;
    } catch {
      this.best = 0;
    }
    this.reset();

    const w = window as unknown as Record<string, unknown>;
    w.__plane = () => ({ mode: modeState.mode, phase: this.phase, step: this.step, dist: this.dist, rings: this.rings, best: this.best, y: this.fy });
    w.__planeFold = () => {
      this.tgt[0] = this.tgt[1] = Math.PI;
      this.cur[0] = this.cur[1] = Math.PI;
      this.baseMesh[0].geometry = polyGeo(LEFT_CUT);
      this.baseMesh[1].geometry = polyGeo(mirror(LEFT_CUT));
      this.tgt[2] = Math.PI;
      this.cur[2] = Math.PI;
      this.finishFold();
    };
    w.__planeScreen = (x: number, z: number) => {
      const v = new Vector3(x, HAND_PLANE_Y, z).project(this.world.camera);
      return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
    };
    w.__planeFp = (k: number) => this.foldPts(k);
    w.__planeThrow = (vx: number, vy: number, vz: number) => this.launch(vx, vy, vz);

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

  // ------------------------------------------------------------- state
  private reset(): void {
    this.phase = 'fold';
    this.step = 0;
    this.cur = [0, 0, 0];
    this.tgt = [0, 0, 0];
    this.wing = 0;
    this.wingT = 0;
    this.baseMesh[0].geometry = polyGeo(LEFT_FULL);
    this.baseMesh[1].geometry = polyGeo(mirror(LEFT_FULL));
    this.plane.position.set(CX, SY, CZ);
    this.plane.rotation.set(0, 0, 0);
    this.plane.scale.setScalar(1);
    for (const h of this.hoops) {
      h.hit = false;
      (h.m.material as MeshStandardMaterial).color.set(0xffc83d);
    }
    this.rings = 0;
    this.dist = 0;
    this.applyFold();
    this.hudDirty = true;
  }

  private press(id: number): void {
    if (id === 0) this.reset();
    else if (this.phase === 'landed' || this.phase === 'fly' || this.phase === 'held') {
      this.phase = 'ready';
      this.plane.position.set(CX, SY, CZ);
      this.plane.rotation.set(0, 0, 0);
      this.plane.scale.setScalar(1);
      for (const h of this.hoops) {
        h.hit = false;
        (h.m.material as MeshStandardMaterial).color.set(0xffc83d);
      }
      this.rings = 0;
      this.hudDirty = true;
    }
  }

  private applyFold(): void {
    const [l, r, f] = this.cur;
    this.flapPivot[0].quaternion.setFromAxisAngle(this.ax.set(-1, 0, 1).normalize(), -l);
    this.flapPivot[1].quaternion.setFromAxisAngle(this.ax.set(1, 0, 1).normalize(), r);
    // fold in half, then wings open to a V
    const fold = Math.min(f, Math.PI);
    const open = this.wing;
    this.half[0].rotation.z = -(fold * (1 - open) + WING * open) * (f > 0 ? 1 : 0);
    this.half[1].rotation.z = WING * open;
    this.half[0].rotation.z = f > 0 ? -(Math.PI * (1 - open) + WING * open) * (f / Math.PI) : 0;
    if (open === 0 && f > 0) this.half[0].rotation.z = -f;
  }

  private finishFold(): void {
    this.step = 3;
    this.wingT = 1;
    this.phase = 'ready';
    sfx.win();
    emitBurst(CX, SY + 0.05, CZ, 0.6, 0.8, 1, 18, 0.5);
    this.msg = 'Your plane is ready!';
    this.msgT = 5;
    this.hudDirty = true;
  }

  // ------------------------------------------------------------- hud
  private drawBtns(): void {
    const labels = [
      ['AGAIN', 'Fold new paper'],
      ['RETRY', 'Fetch the plane'],
    ];
    for (let i = 0; i < 2; i++) {
      const p = this.btns[i];
      p.card('rgba(40,24,12,0.9)', '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 32, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('Paper plane', 56, 32);
    h.text('Distance ' + this.dist.toFixed(1) + ' m    Rings ' + this.rings + '/3    Best ' + this.best.toFixed(1) + ' m', 100, 26, '#ffd9a0');
    let line = '';
    if (this.msgT > 0) line = this.msg;
    else if (this.phase === 'fold')
      line = this.step === 0 ? 'Pinch the glowing corner, fold it to the middle' : this.step === 1 ? 'Now the other corner' : 'Pinch the edge, fold the paper in half';
    else if (this.phase === 'ready') line = 'Pinch the plane, swing your hand, let go!';
    else if (this.phase === 'held') line = 'Throw it!';
    else if (this.phase === 'fly') line = 'Flying...';
    else line = 'Landed. Fetch the plane and try again';
    h.text(line, 150, 28, this.msgT > 0 ? '#8dff9d' : '#ffe9c4');
    h.text('Fly through the gold rings for bonus', 195, 22, '#cdb99a');
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

  /** where to grab / drop for the current fold step, in world xz */
  private foldPts(step: number): [number, number, number, number] {
    if (step === 0) return [CX - HW, CZ - HL, CX, CZ - (HL - HW)];
    if (step === 1) return [CX + HW, CZ - HL, CX, CZ - (HL - HW)];
    return [CX - HW + 0.01, CZ + 0.02, CX + HW, CZ + 0.02];
  }

  private pushHist(p: Vector3, dt: number): void {
    for (let i = this.hist.length - 1; i > 0; i--) {
      this.hist[i].copy(this.hist[i - 1]);
      this.histT[i] = this.histT[i - 1];
    }
    this.hist[0].copy(p);
    this.histT[0] = dt;
    this.histN = Math.min(this.hist.length, this.histN + 1);
  }

  private updatePointer(pt: Pointer, dt: number): void {
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
    if (this.phase === 'fly' || this.phase === 'landed') {
      pt.was = pt.down;
      return;
    }
    if (pt.down && !pt.was) {
      if (this.phase === 'fold') {
        const [sx, sz] = this.foldPts(this.step);
        if (Math.hypot(pt.pos.x - sx, pt.pos.z - sz) < GRAB_R + (this.step === 2 ? 0.02 : 0)) {
          pt.grab = this.step;
          pt.sx = pt.pos.x;
          pt.sz = pt.pos.z;
          if (this.step < 2) this.baseMesh[this.step].geometry = polyGeo(this.step === 0 ? LEFT_CUT : mirror(LEFT_CUT));
          sfx.grab();
        }
      } else if (this.phase === 'ready') {
        if (Math.hypot(pt.pos.x - this.plane.position.x, pt.pos.z - this.plane.position.z) < 0.11) {
          pt.grab = 10;
          this.phase = 'held';
          this.histN = 0;
          sfx.grab();
          this.hudDirty = true;
        }
      }
    }
    if (pt.down && pt.grab >= 0 && pt.grab < 3) {
      const [sx, sz, tx, tz] = this.foldPts(pt.grab);
      const dx = tx - sx;
      const dz = tz - sz;
      const pr = Math.max(0, Math.min(1, ((pt.pos.x - sx) * dx + (pt.pos.z - sz) * dz) / (dx * dx + dz * dz)));
      this.tgt[pt.grab] = pr * Math.PI;
    }
    if (pt.down && pt.grab === 10) {
      this.plane.position.set(pt.pos.x, Math.max(SY + 0.02, pt.pos.y), pt.pos.z);
      this.plane.rotation.set(0, 0, 0);
      this.pushHist(pt.pos, dt);
    }
    if (!pt.down && pt.was && pt.grab >= 0) {
      if (pt.grab < 3) {
        const k = pt.grab;
        if (this.tgt[k] > Math.PI * 0.68) {
          this.tgt[k] = Math.PI;
          sfx.wood(0.4);
          if (k < 2) {
            this.step = k + 1;
          } else {
            this.finishFold();
          }
          this.hudDirty = true;
        } else this.tgt[k] = 0;
      } else if (pt.grab === 10) {
        // throw velocity from recent samples
        let tv = 0;
        for (let i = 0; i < this.histN - 1; i++) tv += this.histT[i];
        const vel = new Vector3();
        if (this.histN > 2 && tv > 0.001) vel.copy(this.hist[0]).sub(this.hist[this.histN - 1]).multiplyScalar(1 / tv);
        const spd = vel.length();
        if (spd < 0.8) {
          this.plane.position.set(CX, SY, CZ);
          this.phase = 'ready';
        } else {
          vel.multiplyScalar(Math.min(9, Math.max(2.5, spd * 1.4)) / spd);
          this.launch(vel.x, vel.y, vel.z);
        }
        this.hudDirty = true;
      }
      pt.grab = -1;
    }
    pt.was = pt.down;
  }

  private launch(vx: number, vy: number, vz: number): void {
    this.phase = 'fly';
    this.plane.scale.setScalar(2.4);
    this.fx = this.plane.position.x;
    this.fy = Math.max(0.6, this.plane.position.y);
    this.fz = this.plane.position.z;
    if (this.phase === 'fly' && (this.fy < 0.7 || Math.abs(this.fx) > 5)) this.fy = 1.0;
    this.startX = this.fx;
    this.startZ = this.fz;
    const sp = Math.hypot(vx, vz);
    this.hx = sp > 0.01 ? vx / sp : 0;
    this.hz = sp > 0.01 ? vz / sp : -1;
    this.sp = Math.max(2.5, sp);
    this.vy = Math.max(-0.5, Math.min(3, vy + 0.6));
    this.turn = (Math.random() - 0.5) * 0.15;
    this.flyT = 0;
    this.dist = 0;
    this.rings = 0;
    sfx.shot?.(0.5);
    this.hudDirty = true;
  }

  private fly(dt: number): void {
    this.flyT += dt;
    const px = this.fx;
    const py = this.fy;
    const pz = this.fz;
    // heading drift
    const c = Math.cos(this.turn * dt);
    const s = Math.sin(this.turn * dt);
    const nx = this.hx * c - this.hz * s;
    const nz = this.hx * s + this.hz * c;
    this.hx = nx;
    this.hz = nz;
    this.sp *= 1 - 0.1 * dt;
    const target = -(0.65 + Math.max(0, 3.2 - this.sp) * 1.1);
    this.vy += (target - this.vy) * Math.min(1, dt * 1.8);
    this.fx += this.hx * this.sp * dt;
    this.fz += this.hz * this.sp * dt;
    this.fy += this.vy * dt;
    // rings
    for (const h of this.hoops) {
      if (h.hit) continue;
      if ((pz - h.z) * (this.fz - h.z) <= 0 && pz !== this.fz) {
        const t = (h.z - pz) / (this.fz - pz);
        const ix = px + (this.fx - px) * t;
        const iy = py + (this.fy - py) * t;
        if (Math.hypot(ix - h.x, iy - h.y) < 0.5) {
          h.hit = true;
          this.rings++;
          (h.m.material as MeshStandardMaterial).color.set(0x4cff7a);
          sfx.win();
          emitBurst(h.x, h.y, h.z, 0.3, 1, 0.5, 16, 0.6);
          this.hudDirty = true;
        }
      }
    }
    this.plane.position.set(this.fx, this.fy, this.fz);
    this.ax.set(this.hx * this.sp, this.vy, this.hz * this.sp);
    this.plane.lookAt(this.fx - this.ax.x, this.fy - this.ax.y, this.fz - this.ax.z);
    this.dist = Math.hypot(this.fx - this.startX, this.fz - this.startZ);
    if (this.fy <= 0.03 || this.flyT > 25) {
      this.fy = 0.03;
      this.plane.position.y = 0.03;
      this.phase = 'landed';
      if (this.dist + this.rings * 3 > this.best) {
        this.best = this.dist + this.rings * 3;
        try {
          localStorage.setItem('pw-plane-best', String(this.best));
        } catch {
          /* ignore */
        }
      }
      this.msg = this.dist.toFixed(1) + ' m' + (this.rings ? '  +' + this.rings + ' rings' : '');
      this.msgT = 5;
      sfx.plop();
      this.hudDirty = true;
    }
    this.hudDirty = true;
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'paperplane';
      for (const o of this.root) o.visible = on;
      if (on) {
        this.reset();
        this.drawBtns();
      }
    }
    if (modeState.mode !== 'paperplane') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    for (const pt of this.pointers) this.updatePointer(pt, dt);
    // animate folds
    const k = Math.min(1, dt * 12);
    for (let i = 0; i < 3; i++) this.cur[i] += (this.tgt[i] - this.cur[i]) * k;
    this.wing += (this.wingT - this.wing) * Math.min(1, dt * 4);
    if (this.phase === 'fold' || this.phase === 'ready' || this.phase === 'held') this.applyFold();
    else this.applyFold();
    if (this.phase === 'fly') this.fly(dt);
    // guide marker
    const showGuide = this.phase === 'fold';
    this.marker.visible = showGuide;
    this.hintDot.visible = showGuide;
    if (showGuide) {
      const [sx, sz, tx, tz] = this.foldPts(this.step);
      const pulse = 1 + Math.sin(this.elapsed * 5) * 0.2;
      this.marker.position.set(sx, SY + 0.01, sz);
      this.marker.scale.set(pulse, pulse, 1);
      const u = (this.elapsed * 0.7) % 1;
      this.hintDot.position.set(sx + (tx - sx) * u, SY + 0.02 + Math.sin(u * Math.PI) * 0.03, sz + (tz - sz) * u);
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
