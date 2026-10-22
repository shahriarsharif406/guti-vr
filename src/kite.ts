import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { modeState, setMode } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';

// ---- Sky layout (meters, in front of the seated player)
const TABLE_Y = 0.72;
const TABLE_CENTER_Z = -0.55;
const SKY_Z = -1.4;
const BOX_X = 0.75;
const BOX_Y_MIN = 1.0;
const BOX_Y_MAX = 1.95;
const PLAYER_ANCHOR = new Vector3(0, TABLE_Y + 0.05, -0.5);
const HAND_GAIN = 2.6;
const MOUSE_M_PER_PX = 0.003;
const CUT_SPEED = 0.45; // player kite must be this fast to slice a string
const HIT_RADIUS = 0.13;
const ROUND_SECONDS = 60;
const START_LIVES = 3;
const STRING_PTS = 10;
const TAIL_PTS = 7;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;

type HandName = 'left' | 'right';

class Kite {
  readonly group = new Group();
  readonly body: Mesh;
  readonly tail: Line;
  readonly string: Line;
  readonly tailPos = new Float32Array(TAIL_PTS * 3);
  readonly strPos = new Float32Array(STRING_PTS * 3);
  readonly pos = new Vector3();
  readonly anchor = new Vector3();
  readonly mat: MeshBasicMaterial;

  constructor(color: number, readonly size: number) {
    const geo = new CircleGeometry(size * 0.5, 4);
    geo.scale(0.8, 1.15, 1);
    this.mat = new MeshBasicMaterial({ color, side: DoubleSide });
    this.body = new Mesh(geo, this.mat);
    this.group.add(this.body);

    const tailGeo = new BufferGeometry();
    tailGeo.setAttribute('position', new BufferAttribute(this.tailPos, 3));
    this.tail = new Line(
      tailGeo,
      new LineBasicMaterial({ color: 0xffffff }),
    );
    this.tail.frustumCulled = false;

    const strGeo = new BufferGeometry();
    strGeo.setAttribute('position', new BufferAttribute(this.strPos, 3));
    this.string = new Line(
      strGeo,
      new LineBasicMaterial({ color: 0xf2f2f2 }),
    );
    this.string.frustumCulled = false;
  }

  /** Rewrite the string + tail vertex buffers for the current pose. */
  updateLines(time: number, visible: boolean): void {
    this.string.visible = visible;
    const a = this.anchor;
    const p = this.pos;
    for (let i = 0; i < STRING_PTS; i++) {
      const t = i / (STRING_PTS - 1);
      const sag = Math.sin(t * Math.PI) * 0.12;
      this.strPos[i * 3] = a.x + (p.x - a.x) * t;
      this.strPos[i * 3 + 1] = a.y + (p.y - a.y) * t - sag;
      this.strPos[i * 3 + 2] = a.z + (p.z - a.z) * t;
    }
    (this.string.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    for (let i = 0; i < TAIL_PTS; i++) {
      const t = i / (TAIL_PTS - 1);
      this.tailPos[i * 3] = p.x + Math.sin(time * 6 + i * 0.9) * 0.025 * t * 2;
      this.tailPos[i * 3 + 1] = p.y - this.size * 0.6 - t * 0.25;
      this.tailPos[i * 3 + 2] = p.z;
    }
    (this.tail.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}

interface Enemy {
  kite: Kite;
  base: Vector3;
  phase: number;
  freq: number;
  state: 'fly' | 'fall';
  fallT: number;
  lungeT: number;
  nextLunge: number;
  vy: number;
}

type Phase = 'play' | 'over';

export class KiteSystem extends createSystem({}) {
  private mine!: Kite;
  private enemies: Enemy[] = [];
  private hud!: TextPanel;
  private root: { visible: boolean }[] = [];

  private phase: Phase = 'play';
  private lastMode = '';
  private fontWasReady = false;
  private time = ROUND_SECONDS;
  private lives = START_LIVES;
  private score = 0;
  private best = 0;
  private overTimer = 0;
  private hurtCooldown = 0;
  private hudDirty = true;
  private elapsed = 0;
  private lastSecond = -1;

  // input
  private target = new Vector3();
  private targetStart = new Vector3();
  private handStart = new Vector3();
  private handPos = new Vector3();
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private dragHand: HandName | 'mouse' | null = null;
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private prevPos = new Vector3();
  private speed = 0;
  private tmp = new Vector3();

  init(): void {
    this.mine = new Kite(0xff4d6d, 0.17);
    this.mine.anchor.copy(PLAYER_ANCHOR);
    const colors = [0x4dd2ff, 0xffd23f, 0x7cf29a];
    const bases: [number, number][] = [
      [-0.45, 1.55],
      [0.45, 1.35],
      [0, 1.8],
    ];
    const anchors: [number, number][] = [
      [-0.55, -0.9],
      [0.55, -0.9],
      [0, -0.8],
    ];
    for (let i = 0; i < 3; i++) {
      const k = new Kite(colors[i], 0.15);
      k.anchor.set(anchors[i][0], TABLE_Y + 0.1, anchors[i][1]);
      this.enemies.push({
        kite: k,
        base: new Vector3(bases[i][0], bases[i][1], SKY_Z),
        phase: i * 2.1,
        freq: 0.5 + i * 0.13,
        state: 'fly',
        fallT: 0,
        lungeT: 0,
        nextLunge: 4 + i * 1.5,
        vy: 0,
      });
    }
    const all = [this.mine, ...this.enemies.map((e) => e.kite)];
    for (const k of all) {
      this.world.createTransformEntity(k.group);
      this.world.createTransformEntity(k.tail);
      this.world.createTransformEntity(k.string);
      this.root.push(k.group, k.tail, k.string);
    }

    this.hud = new TextPanel(0.5, 0.2);
    this.hud.mesh.position.set(0, TABLE_Y + 0.27, TABLE_CENTER_Z - 0.3);
    this.hud.mesh.rotation.x = -0.45;
    this.world.createTransformEntity(this.hud.mesh);
    this.root.push(this.hud.mesh);
    this.setVisible(false);

    try {
      this.best = Number(localStorage.getItem('guti-kite-best') ?? '0') || 0;
    } catch {
      this.best = 0;
    }

    const down = (e: PointerEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (this.mouseDown && modeState.mode === 'kite' && this.phase === 'play') {
        this.target.x += (e.clientX - this.mouseX) * MOUSE_M_PER_PX;
        this.target.y -= (e.clientY - this.mouseY) * MOUSE_M_PER_PX;
      }
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

  private setVisible(on: boolean): void {
    for (const o of this.root) o.visible = on;
  }

  private startRound(): void {
    this.phase = 'play';
    this.time = ROUND_SECONDS;
    this.lives = START_LIVES;
    this.score = 0;
    this.hurtCooldown = 0;
    this.target.set(0, 1.4, SKY_Z);
    this.mine.pos.copy(this.target);
    this.prevPos.copy(this.target);
    this.dragHand = null;
    for (const e of this.enemies) {
      e.state = 'fly';
      e.lungeT = 0;
      e.nextLunge = 4 + Math.random() * 3;
    }
    this.hudDirty = true;
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
    const space =
      (ad.connected ? ad.gripSpace : undefined) ?? this.player.gripSpaces[hand];
    if (!space) return false;
    space.getWorldPosition(out);
    return true;
  }

  private updateInput(): void {
    if (this.dragHand === null) {
      for (const hand of ['right', 'left'] as HandName[]) {
        const p = this.readPinch(hand);
        const was = this.pinching[hand];
        this.pinching[hand] = p;
        if (p && !was && this.readHandPos(hand, this.handPos)) {
          this.dragHand = hand;
          this.handStart.copy(this.handPos);
          this.targetStart.copy(this.target);
          sfx.grab();
          break;
        }
      }
    } else if (this.dragHand !== 'mouse') {
      const hand = this.dragHand;
      const p = this.readPinch(hand);
      this.pinching[hand] = p;
      if (!p) this.dragHand = null;
      else if (this.readHandPos(hand, this.handPos)) {
        this.target.x = this.targetStart.x + (this.handPos.x - this.handStart.x) * HAND_GAIN;
        this.target.y = this.targetStart.y + (this.handPos.y - this.handStart.y) * HAND_GAIN;
      }
    }
    this.target.x = Math.max(-BOX_X, Math.min(BOX_X, this.target.x));
    this.target.y = Math.max(BOX_Y_MIN, Math.min(BOX_Y_MAX, this.target.y));
    this.target.z = SKY_Z;
  }

  // ------------------------------------------------------------------ frame
  private enemyUpdate(e: Enemy, delta: number): void {
    const k = e.kite;
    const ramp = 1 + Math.min(this.score, 10) * 0.08;
    if (e.state === 'fall') {
      e.fallT += delta;
      e.vy += 1.6 * delta;
      k.pos.y -= e.vy * delta;
      k.group.rotation.z += delta * 6;
      if (e.fallT > 1.6) {
        e.state = 'fly';
        e.vy = 0;
        e.lungeT = 0;
        e.nextLunge = 3 + Math.random() * 3;
        k.group.rotation.z = 0;
        k.pos.set(e.base.x, BOX_Y_MAX + 0.3, SKY_Z);
      }
      return;
    }
    e.nextLunge -= delta;
    if (e.nextLunge <= 0 && e.lungeT <= 0) {
      e.lungeT = 1.0;
      e.nextLunge = (3.5 + Math.random() * 3) / ramp;
      sfx.whoosh();
    }
    const t = this.elapsed * e.freq * ramp + e.phase;
    this.tmp.set(
      e.base.x + Math.sin(t) * 0.4,
      e.base.y + Math.sin(t * 1.3) * 0.15,
      SKY_Z,
    );
    if (e.lungeT > 0) {
      e.lungeT -= delta;
      // dive toward the player's kite
      this.tmp.copy(k.pos);
      this.tmp.x += (this.mine.pos.x - k.pos.x) * Math.min(1, delta * 2.2);
      this.tmp.y += (this.mine.pos.y - k.pos.y) * Math.min(1, delta * 2.2);
    } else {
      this.tmp.x = k.pos.x + (this.tmp.x - k.pos.x) * Math.min(1, delta * 3);
      this.tmp.y = k.pos.y + (this.tmp.y - k.pos.y) * Math.min(1, delta * 3);
    }
    k.pos.copy(this.tmp);
    k.group.rotation.z = Math.sin(t * 2) * 0.15;
  }

  private checkContacts(): void {
    const px = this.mine.pos.x;
    const py = this.mine.pos.y;
    for (const e of this.enemies) {
      if (e.state !== 'fly') continue;
      const dx = e.kite.pos.x - px;
      const dy = e.kite.pos.y - py;
      if (dx * dx + dy * dy > HIT_RADIUS * HIT_RADIUS) continue;
      if (this.speed >= CUT_SPEED) {
        e.state = 'fall';
        e.fallT = 0;
        e.vy = 0;
        this.score += 1;
        sfx.cut();
        this.hudDirty = true;
      } else if (e.lungeT > 0 && this.hurtCooldown <= 0) {
        this.lives -= 1;
        this.hurtCooldown = 1.5;
        sfx.hurt();
        this.hudDirty = true;
        if (this.lives <= 0) this.endRound();
      }
    }
  }

  private endRound(): void {
    this.phase = 'over';
    this.overTimer = 4.5;
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem('guti-kite-best', String(this.best));
      } catch {
        /* ignore */
      }
    }
    sfx.lose();
    this.hudDirty = true;
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('ঘুড়ি কাটাকাটি', 62, 48);
    if (this.phase === 'over') {
      h.text('Cuts ' + this.score + '   Best ' + this.best, 140, 44, '#8dff9d');
      h.text('আবার খেলতে মেনুতে যাও', 215, 30, '#cdb99a');
    } else {
      h.text(
        'Cuts ' + this.score + '   Lives ' + this.lives + '   ' + Math.ceil(this.time) + 's',
        140,
        42,
      );
      h.text(
        this.score === 0 && this.time > ROUND_SECONDS - 12
          ? 'চিমটি দিয়ে হাত নাড়াও • জোরে ছুঁয়ে সুতো কাটো'
          : 'দ্রুত গিয়ে অন্য ঘুড়ি কাটো, ধীরে থাকলে ওরা কাটবে',
        215,
        28,
        '#cdb99a',
      );
    }
    h.commit();
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'kite';
      this.setVisible(on);
      if (on) this.startRound();
      this.dragHand = null;
    }
    if (modeState.mode !== 'kite') return;

    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
    }

    this.hurtCooldown = Math.max(0, this.hurtCooldown - delta);

    if (this.phase === 'play') {
      this.updateInput();
      this.time -= delta;
      const sec = Math.ceil(this.time);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.hudDirty = true;
      }
      if (this.time <= 0) {
        this.time = 0;
        this.endRound();
      }
    } else {
      this.overTimer -= delta;
      if (this.overTimer <= 0) setMode('menu');
    }

    // player kite follows the hand with a little lag, like a real one
    const k = this.mine;
    const f = 1 - Math.exp(-7 * delta);
    this.prevPos.copy(k.pos);
    k.pos.x += (this.target.x - k.pos.x) * f;
    k.pos.y += (this.target.y - k.pos.y) * f;
    k.pos.z = SKY_Z;
    const inst = delta > 0 ? this.prevPos.distanceTo(k.pos) / delta : 0;
    this.speed += (inst - this.speed) * Math.min(1, delta * 12);
    k.group.rotation.z = Math.max(-0.5, Math.min(0.5, (this.target.x - k.pos.x) * -1.2));

    for (const e of this.enemies) this.enemyUpdate(e, delta);
    if (this.phase === 'play') this.checkContacts();

    // blink the player's kite while it is invulnerable
    this.mine.body.visible =
      this.hurtCooldown <= 0 || Math.floor(this.elapsed * 12) % 2 === 0;

    k.group.position.copy(k.pos);
    k.updateLines(this.elapsed, true);
    for (const e of this.enemies) {
      e.kite.group.position.copy(e.kite.pos);
      e.kite.updateLines(this.elapsed, e.state === 'fly');
    }

    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
