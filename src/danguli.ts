import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
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

export class DanguliSystem extends createSystem({}) {
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
  private best = 0;
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

    // guli: a short stick pointed at both ends
    const gm = new MeshStandardMaterial({ color: 0xe8c27a, roughness: 0.6 });
    const body = new Mesh(new CylinderGeometry(GULI_R, GULI_R, GULI_LEN * 0.8, 10), gm);
    body.rotation.z = Math.PI / 2;
    this.guli.add(body);
    for (const s of [-1, 1]) {
      const cone = new Mesh(new ConeGeometry(GULI_R, GULI_LEN * 0.12, 10), gm);
      cone.rotation.z = (-s * Math.PI) / 2;
      cone.position.x = s * GULI_LEN * 0.46;
      this.guli.add(cone);
    }
    const band = new Mesh(new CylinderGeometry(GULI_R * 1.2, GULI_R * 1.2, 0.012, 10), new MeshStandardMaterial({ color: 0xc0392b }));
    band.rotation.z = Math.PI / 2;
    this.guli.add(band);
    this.addGroup(this.guli);

    // danda: the long stick, pinched at one end
    const dm = new MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.8 });
    const stick = new Mesh(new CylinderGeometry(0.011, 0.014, DANDA_LEN, 10), dm);
    stick.rotation.x = Math.PI / 2;
    stick.position.z = -DANDA_LEN / 2 + 0.02;
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

    try {
      this.best = Number(localStorage.getItem('guti-danguli-best') ?? '0') || 0;
      this.bestDist = Number(localStorage.getItem('guti-danguli-dist') ?? '0') || 0;
    } catch {
      this.best = 0;
    }

    (window as unknown as { __danguli?: () => unknown }).__danguli = () => ({
      phase: this.phase,
      attempt: this.attempt,
      score: this.score,
      dist: this.lastDist,
      best: this.best,
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
    this.say('Pinch the stick. Flick the guli tip to pop it up', 4);
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
      if (speed > STRIKE1_SPEED && this.tipVel.y < 0.9 && segDist(this.prevTip, this.tip, tmpA) < 0.055) {
        this.vel.set(this.tipVel.x * 0.12, 2.9 + Math.min(speed, 4) * 0.25, this.tipVel.z * 0.12);
        this.spin = 16;
        this.lifted = true;
        this.phase = 'air';
        this.airT = 0;
        this.score += 10;
        sfx.clack(0.6);
        emitBurst(this.pos.x, this.pos.y, this.pos.z, 1, 0.85, 0.5, 14, 0.5);
        this.say('Up it goes! Swing again, now!', 1.4);
      }
    } else if (this.phase === 'air' && this.airT > 0.12) {
      if (speed > STRIKE2_SPEED && segDist(this.prevTip, this.tip, this.pos) < 0.075) {
        this.vel.copy(this.tipVel).multiplyScalar(2.4);
        this.vel.y += 1.2 + (this.pos.y - this.tip.y) * 8;
        if (this.vel.length() > MAX_V) this.vel.setLength(MAX_V);
        this.spin = 26;
        this.hitAir = true;
        this.phase = 'flight';
        this.restT = 0;
        this.trailN = 0;
        this.trailT = 0;
        this.trail.visible = true;
        this.score += 20;
        sfx.clack(1);
        sfx.whoosh();
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
        sfx.plop();
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
    const d = this.hitAir ? Math.hypot(this.pos.x - GULI_START.x, this.pos.z - GULI_START.z) * DIST_SCALE : 0;
    this.lastDist = Math.round(d * 10) / 10;
    this.phase = 'message';
    this.trail.visible = false;
    let bonus = 0;
    if (d > 30) bonus = 30;
    else if (d > 20) bonus = 20;
    else if (d > 10) bonus = 10;
    const pts = this.hitAir ? Math.floor(d) + bonus : 0;
    this.score += pts;
    if (this.lastDist > this.roundBestDist) this.roundBestDist = this.lastDist;
    const flag = this.markers[this.attempt - 1];
    if (flag && this.hitAir) {
      flag.position.set(this.pos.x, 0, this.pos.z);
      flag.scale.setScalar(1 + d * 0.05);
      flag.visible = true;
    }
    if (this.hitAir) {
      sfx.win();
      this.say('Landed ' + this.lastDist + ' m  +' + (pts + 30), 3);
    } else {
      sfx.lose();
      this.say(this.lifted ? 'Missed in the air! Swing sooner' : 'Missed', 2.5);
    }
    this.hudDirty = true;
  }

  private nextAttempt(): void {
    if (this.attempt >= ATTEMPTS) {
      if (!this.finalShown) {
        this.finalShown = true;
        if (this.score > this.best) {
          this.best = this.score;
          try {
            localStorage.setItem('guti-danguli-best', String(this.best));
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
        this.say('Round over: ' + this.score + ' pts, best throw ' + this.roundBestDist + ' m', 6);
        return;
      }
      this.startRound();
      return;
    }
    this.attempt++;
    this.prepare();
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('Danguli  ডাংগুলি', 52, 40);
    h.text('Try ' + this.attempt + '/' + ATTEMPTS + '   Score ' + this.score, 112, 34);
    if (this.msgT > 0) h.text(this.msg, 172, 28, this.msg.startsWith('Missed') ? '#ff9d8d' : '#8dff9d');
    else h.text('Best ' + this.best + ' pts / ' + this.bestDist + ' m', 172, 26, '#cdb99a');
    h.text(this.phase === 'air' ? 'Swing at it in the air!' : 'Flick the tip, then hit it far', 215, 24, '#cdb99a');
    h.commit();
  }

  update(delta: number): void {
    this.elapsed += delta;
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
