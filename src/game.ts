import {
  BoxGeometry,
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
import { Marble, MarbleKinds } from './marble-component.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';

// ---- Layout (meters). Everything sits within arm's reach of a seated player.
const TABLE_Y = 0.72;
const TABLE_CENTER_Z = -0.55;
const TABLE_RADIUS = 0.36;
const RING_RADIUS = 0.13; // the "গোল্লা" circle
const MARBLE_R = 0.02;
const SHOOTER_START_Z = TABLE_CENTER_Z + 0.27;
// ---- Slingshot tuning
const GRAB_RADIUS = 0.16;
const MAX_PULL = 0.18;
const MIN_PULL = 0.03;
const MAX_SPEED = 3.2;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const MOUSE_METERS_PER_PX = 0.0006;

type Phase = 'aim' | 'rolling' | 'message';
type HandName = 'left' | 'right';

interface LevelDef {
  targets: number;
  shots: number;
}

function levelDef(level: number): LevelDef {
  const targets = Math.min(2 + Math.ceil(level * 0.8), 10);
  return { targets, shots: targets + 2 };
}

const MAX_LEVEL = 10;

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
  private firedOnce = false;
  private noHands = false;
  private elapsed = 0;
  private prevSpeeds: number[] = [];
  private modeObjects: Mesh[] = [];
  private ringMesh!: Mesh;

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

    // earthen courtyard floor (visual only)
    const floor = new Mesh(
      new CylinderGeometry(6, 6, 0.02, 48),
      new MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 }),
    );
    floor.position.set(0, -0.01, TABLE_CENTER_Z);
    world.createTransformEntity(floor);

    // the playing ground: a round disc of packed clay at hand height
    const table = new Mesh(
      new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.04, 64),
      new MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.95 }),
    );
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
          color: c,
          roughness: 0.08,
          metalness: 0.1,
          emissive: c,
          emissiveIntensity: 0.12,
        }),
      );
    }
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
      linearDamping: 0.9,
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
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('GUTI  •  Level ' + this.level, 70, 52);
    if (this.phase === 'message') {
      h.text(this.messageText, 150, 44, this.won ? '#8dff9d' : '#ff9d8d');
    } else {
      h.text(
        'Out ' + this.outCount + ' / ' + this.totalTargets + '     Shots ' + this.shotsLeft,
        148,
        40,
      );
    }
    let hint = '';
    if (this.noHands) hint = 'Raise both hands in front of you';
    else if (this.phase === 'aim')
      hint = this.firedOnce
        ? 'Pinch • Pull back • Release'
        : 'Pinch the white marble, pull back, release';
    h.text(hint, 220, 30, '#cdb99a');
    h.commit();
  }

  private setModeVisible(on: boolean): void {
    for (const m of this.modeObjects) m.visible = on;
  }

  // ------------------------------------------------------------------ levels
  private startLevel(level: number): void {
    this.level = level;
    const def = levelDef(level);
    this.shotsLeft = def.shots;
    this.totalTargets = def.targets;
    this.outCount = 0;
    this.won = false;

    for (const t of this.targets) t.dispose();
    this.targets.length = 0;
    this.prevSpeeds.length = 0;

    // cluster targets inside the ring in a tight, slightly jittered spiral
    const n = def.targets;
    const spread = Math.min(RING_RADIUS * 0.72, 0.03 + n * 0.007);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963; // golden angle
      const r = n === 1 ? 0 : spread * Math.sqrt((i + 0.5) / n);
      this.tmp.set(
        Math.cos(a) * r,
        TABLE_Y + MARBLE_R + 0.001,
        TABLE_CENTER_Z + Math.sin(a) * r,
      );
      const mat = this.targetMats[i % this.targetMats.length];
      this.targets.push(
        this.spawnMarble(this.tmp, MarbleKinds.Target, mat, 1),
      );
    }
    this.prevSpeeds.length = n;
    this.prevSpeeds.fill(0);
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
      Math.sqrt(dx * dx + dz * dz) > RING_RADIUS + MARBLE_R * 0.5
    );
  }

  private speedOf(e: Entity): number {
    const v = e.getVectorView(PhysicsBody, '_linearVelocity');
    return Math.hypot(v[0], v[1], v[2]);
  }

  private updateRolling(delta: number): void {
    this.rollTimer += delta;
    let moving = false;
    if (this.speedOf(this.shooter) > 0.04) moving = true;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (!t.object3D) continue;
      const sp = this.speedOf(t);
      if (sp > 0.04) moving = true;
      if (sp - this.prevSpeeds[i] > 0.12) sfx.clack((sp - this.prevSpeeds[i]) / 1.5);
      this.prevSpeeds[i] = sp;
    }
    this.restTimer = moving ? 0 : this.restTimer + delta;
    const shooterFell =
      (this.shooter.object3D?.position.y ?? 0) < TABLE_Y - 0.1;
    if (this.restTimer > 0.5 || this.rollTimer > 9 || shooterFell) {
      this.resolveShot();
    }
  }

  private resolveShot(): void {
    let out = 0;
    for (const t of this.targets) if (this.isOut(t)) out++;
    if (out !== this.outCount) {
      this.outCount = out;
    }
    if (out >= this.totalTargets) {
      this.won = true;
      this.messageText =
        this.level >= MAX_LEVEL ? 'You are the champion!' : 'Level clear!';
      sfx.win();
      this.beginMessage(1.8);
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
        this.firedOnce = false;
        this.startLevel(1);
      } else if (wasGuti || this.lastMode !== 'guti') {
        this.setModeVisible(false);
        for (const t of this.targets) if (t.object3D) t.object3D.visible = false;
        this.arrowShaft.visible = false;
        this.arrowHead.visible = false;
        this.dragging = false;
        this.dragHand = null;
      }
    }
    if (modeState.mode !== 'guti') return;

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
      this.dragging = false;
    }

    // pulsing hint ring on the shooter for the very first shot
    const showHint =
      this.phase === 'aim' && !this.firedOnce && !this.dragging;
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

    if (this.phase === 'rolling') {
      let out = 0;
      for (const t of this.targets) if (this.isOut(t)) out++;
      if (out !== this.outCount) {
        this.outCount = out;
        this.hudDirty = true;
      }
    }

    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
