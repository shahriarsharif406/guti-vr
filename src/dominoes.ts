import {
  BoxGeometry,
  CylinderGeometry,
  Entity,
  Group,
  Mesh,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { DomOpt } from './ui-components.js';

// ---- Domino Run: stand dominoes on the table with your fingers, push the first one, watch the chain.
const CX = 0;
const CZ = -0.55;
const TOP = 0.74; // table surface
const ZONE = 0.4; // placement radius around the table centre
const DW = 0.03; // width
const DH = 0.06; // height
const DT = 0.012; // thickness
const MAX = 40;
const TRAY = new Vector3(-0.3, TOP, -0.27);
const PICK_R = 0.045;
const TRAY_R = 0.1;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const LINK = 0.11; // max distance for auto-orienting a chain
const HAND_PLANE_Y = 0.8;

type HandName = 'left' | 'right';
interface Dom {
  g: Group;
  mesh: Mesh;
  mat: MeshStandardMaterial;
  active: boolean;
  held: boolean;
  x: number;
  z: number;
  yaw: number;
  state: 0 | 1 | 2; // upright, falling, down
  th: number;
  om: number;
  hue: number;
}
interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  held: Dom | null;
}

export class DominoSystem extends createSystem({
  opts: { required: [DomOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private doms: Dom[] = [];
  private order: Dom[] = [];
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'right', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, held: null },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private phase: 'build' | 'run' | 'done' = 'build';
  private fell = 0;
  private total = 0;
  private best = 0;
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
  private clickT = 0;

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
    const felt = new Mesh(new CylinderGeometry(0.42, 0.42, 0.004, 56), new MeshStandardMaterial({ color: 0x2f6b55, roughness: 1 }));
    felt.position.set(CX, TOP + 0.002, CZ);
    add(felt);
    // supply tray with a visible stack
    const tray = new Mesh(new BoxGeometry(0.14, 0.012, 0.1), new MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 }));
    tray.position.set(TRAY.x, TOP + 0.008, TRAY.z);
    tray.rotation.y = 0.5;
    add(tray);
    const geo = new BoxGeometry(DW, DH, DT);
    const lineGeo = new BoxGeometry(DW * 0.94, 0.0025, DT + 0.0006);
    const dotGeo = new BoxGeometry(0.004, 0.004, DT + 0.0008);
    const dark = new MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.6 });
    for (let i = 0; i < MAX; i++) {
      const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 });
      const m = new Mesh(geo, mat);
      m.position.set(0, DH / 2, -DT / 2);
      const line = new Mesh(lineGeo, dark);
      m.add(line);
      for (const [dx, dy] of [[-0.007, 0.015], [0.007, 0.015], [-0.007, -0.015], [0.007, -0.015]]) {
        const dot = new Mesh(dotGeo, dark);
        dot.position.set(dx, dy, 0);
        m.add(dot);
      }
      const g = new Group();
      g.rotation.order = 'YXZ';
      g.add(m);
      add(g);
      g.visible = false;
      this.doms.push({ g, mesh: m, mat, active: false, held: false, x: 0, z: 0, yaw: Math.PI / 2, state: 0, th: 0, om: 0, hue: 0 });
    }

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
      entity.addComponent(DomOpt, { id: i });
      this.btns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'dominoes' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(DomOpt, 'id') as number);
      }),
    );
    for (const o of this.root) o.visible = false;
    try {
      this.best = Number(localStorage.getItem('pw-domino-best') ?? '0') || 0;
    } catch {
      this.best = 0;
    }

    const w = window as unknown as Record<string, unknown>;
    w.__dom = () => ({ mode: modeState.mode, phase: this.phase, placed: this.order.length, fell: this.fell, total: this.total, best: this.best });
    w.__domPlace = (pts: [number, number][]) => {
      for (const p of pts) this.dropAt(this.spawn(), p[0], p[1]);
    };
    w.__domTopple = () => this.press(0);

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

  // ---------------------------------------------------------------- actions
  private press(id: number): void {
    if (id === 0) {
      // topple: push the first domino
      if (this.phase !== 'build' || this.order.length === 0) return;
      this.phase = 'run';
      this.total = this.order.length;
      this.fell = 0;
      const d = this.order[0];
      d.state = 1;
      d.th = 0.03;
      d.om = 1.6;
      this.fell = 1;
      sfx.clack(0.6);
    } else if (id === 1) {
      // stand them back up
      this.phase = 'build';
      for (const d of this.order) {
        d.state = 0;
        d.th = 0;
        d.om = 0;
        this.apply(d);
      }
      this.fell = 0;
    } else {
      for (const d of this.doms) {
        d.active = false;
        d.held = false;
        d.g.visible = false;
      }
      for (const p of this.pointers) p.held = null;
      this.order.length = 0;
      this.phase = 'build';
      this.fell = 0;
      this.total = 0;
    }
    this.hudDirty = true;
    this.drawBtns();
  }

  private spawn(): Dom | null {
    for (const d of this.doms) {
      if (!d.active && !d.held) {
        d.held = true;
        d.g.visible = true;
        d.state = 0;
        d.th = 0;
        d.hue = (this.order.length * 0.037) % 1;
        d.mat.color.setHSL(d.hue, 0.72, 0.58);
        return d;
      }
    }
    return null;
  }

  private dropAt(d: Dom | null, x: number, z: number): boolean {
    if (!d) return false;
    d.held = false;
    if (Math.hypot(x - CX, z - CZ) > ZONE || Math.hypot(x - TRAY.x, z - TRAY.z) < 0.07) {
      d.active = false;
      d.g.visible = false;
      return false;
    }
    d.x = x;
    d.z = z;
    const last = this.order[this.order.length - 1];
    if (last && last !== d) {
      const dx = x - last.x;
      const dz = z - last.z;
      if (Math.hypot(dx, dz) < LINK) {
        const yaw = Math.atan2(dx, dz);
        last.yaw = yaw;
        d.yaw = yaw;
        this.apply(last);
      } else d.yaw = last.yaw;
    }
    d.active = true;
    d.state = 0;
    d.th = 0;
    this.order.push(d);
    this.apply(d);
    sfx.wood(0.35);
    this.hudDirty = true;
    return true;
  }

  private apply(d: Dom): void {
    d.g.position.set(d.x, TOP + 0.004, d.z);
    d.g.rotation.set(d.th, d.yaw, 0);
  }

  // ---------------------------------------------------------------- hud
  private drawBtns(): void {
    const labels = [
      ['GO', 'Topple them'],
      ['AGAIN', 'Stand them up'],
      ['CLEAR', 'Clear table'],
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.btns[i];
      p.card('rgba(40,24,12,0.9)', i === 0 ? '#8dff9d' : '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 32, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('Domino run', 56, 32);
    h.text('Placed ' + this.order.length + ' / ' + MAX + '    Fell ' + this.fell + '    Best ' + this.best, 100, 26, '#ffd9a0');
    if (this.msgT > 0) h.text(this.msg, 150, 30, '#8dff9d');
    else
      h.text(
        this.phase === 'build' ? 'Stand them in a line, then press Topple' : this.phase === 'run' ? 'Falling...' : 'Press Stand them up to go again',
        150,
        26,
        '#ffe9c4',
      );
    h.text('Pinch a domino from the tray. Keep them close together!', 195, 22, '#cdb99a');
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
    if (this.phase !== 'build') {
      pt.was = pt.down;
      return;
    }
    if (pt.down && !pt.was) {
      let best: Dom | null = null;
      let bd = PICK_R;
      for (const d of this.order) {
        const dist = Math.hypot(d.x - pt.pos.x, d.z - pt.pos.z);
        if (dist < bd) {
          bd = dist;
          best = d;
        }
      }
      if (best) {
        const i = this.order.indexOf(best);
        this.order.splice(i, 1);
        best.active = false;
        best.held = true;
        pt.held = best;
        sfx.grab();
      } else if (Math.hypot(pt.pos.x - TRAY.x, pt.pos.z - TRAY.z) < TRAY_R) {
        const d = this.spawn();
        if (d) {
          pt.held = d;
          sfx.grab();
        }
      }
      this.hudDirty = true;
    }
    if (pt.down && pt.held) {
      const d = pt.held;
      d.x = pt.pos.x;
      d.z = pt.pos.z;
      d.g.position.set(pt.pos.x, Math.max(TOP + 0.03, pt.pos.y - 0.02), pt.pos.z);
      d.g.rotation.set(0, d.yaw, 0);
    }
    if (!pt.down && pt.was && pt.held) {
      const d = pt.held;
      pt.held = null;
      this.dropAt(d, d.x, d.z);
    }
    pt.was = pt.down;
  }

  // ---------------------------------------------------------------- sim
  private simulate(dt: number): void {
    let falling = 0;
    for (const d of this.order) {
      if (d.state !== 1) continue;
      falling++;
      // gravity torque about the front bottom edge
      d.om += (30 * Math.sin(d.th) + 6) * dt;
      d.th += d.om * dt;
      if (d.th >= 1.45) {
        d.th = 1.45;
        d.state = 2;
        d.om = 0;
        sfx.wood(0.25);
      }
      this.apply(d);
      if (d.th < 0.12) continue;
      const dx0 = Math.sin(d.yaw);
      const dz0 = Math.cos(d.yaw);
      const reach = DH * Math.sin(d.th) + 0.002;
      for (const o of this.order) {
        if (o.state !== 0) continue;
        const dx = o.x - d.x;
        const dz = o.z - d.z;
        const along = dx * dx0 + dz * dz0;
        const perp = Math.abs(-dx * dz0 + dz * dx0);
        if (along > 0 && along - DT < reach && perp < DW * 1.15) {
          o.state = 1;
          o.th = 0.06;
          o.om = Math.max(1.4, d.om * 0.85);
          const dot = Math.sin(o.yaw) * dx0 + Math.cos(o.yaw) * dz0;
          if (dot < 0.2) o.yaw = d.yaw;
          this.fell++;
          this.hudDirty = true;
          const sp = 0.4 + Math.min(1, this.fell / 40) * 0.5;
          sfx.clack(sp);
          emitBurst(o.x, TOP + 0.06, o.z, 1, 0.9, 0.5, 4, 0.2);
        }
      }
    }
    if (falling === 0 && this.phase === 'run') {
      this.phase = 'done';
      const all = this.fell >= this.total;
      if (this.fell > this.best) {
        this.best = this.fell;
        try {
          localStorage.setItem('pw-domino-best', String(this.best));
        } catch {
          /* ignore */
        }
      }
      if (all) {
        sfx.win();
        this.msg = 'All ' + this.total + ' fell!  ' + (this.total >= 30 ? '★★★' : this.total >= 20 ? '★★' : '★');
        for (const d of this.order) emitBurst(d.x, TOP + 0.05, d.z, 1, 0.85, 0.35, 3, 0.4);
      } else {
        sfx.lose();
        this.msg = 'The chain broke at ' + this.fell + ' of ' + this.total + '. Close the gap!';
      }
      this.msgT = 6;
      this.hudDirty = true;
    }
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'dominoes';
      for (const o of this.root) o.visible = on;
      for (const d of this.doms) d.g.visible = on && (d.active || d.held);
      if (on) {
        this.hudDirty = true;
        this.drawBtns();
      }
    }
    if (modeState.mode !== 'dominoes') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    for (const pt of this.pointers) this.updatePointer(pt);
    if (this.phase === 'run') {
      let t = dt;
      while (t > 0) {
        const s = Math.min(t, 1 / 240);
        this.simulate(s);
        t -= s;
      }
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
