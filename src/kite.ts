import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  BufferAttribute as BA,
  CanvasTexture,
  CylinderGeometry,
  MeshStandardMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { readPinchPoint } from './hand.js';
import { emitBurst } from './fx.js';
import { SphereGeometry } from '@iwsdk/core';
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
const CUT_SPEED_SHARP = 0.18;
const SHARP_SECONDS = 7;
const ENEMY_SLOTS = 5;
const COMBO_WINDOW = 3;
const HIT_RADIUS = 0.13;
const START_LIVES = 3;
const MAX_LIVES = 5;
const BIRDS = 3;
const STRING_PTS = 10;
const TAIL_PTS = 7;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;

type HandName = 'left' | 'right';

let kiteTex: CanvasTexture | null = null;
/** Grey-scale paper pattern (tinted per kite): quarter panels, bamboo spars, paper border. */
function kiteTexture(): CanvasTexture {
  if (kiteTex) return kiteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  const shade = ['#ffffff', '#cfcfcf', '#bdbdbd', '#f2f2f2'];
  g.fillStyle = shade[0];
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = shade[1];
  g.fillRect(128, 0, 128, 128);
  g.fillStyle = shade[2];
  g.fillRect(0, 128, 128, 128);
  g.fillStyle = shade[3];
  g.fillRect(128, 128, 128, 128);
  // paper grain
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = 'rgba(0,0,0,' + Math.random() * 0.05 + ')';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // spars
  g.strokeStyle = 'rgba(70,45,20,0.9)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
  // paper-folded rim
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(128, 4);
  g.lineTo(252, 128);
  g.lineTo(128, 252);
  g.lineTo(4, 128);
  g.closePath();
  g.stroke();
  kiteTex = new CanvasTexture(c);
  kiteTex.colorSpace = SRGBColorSpace;
  return kiteTex;
}
const bowGeo = new PlaneGeometry(0.05, 0.028);

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
  readonly bows: Mesh[] = [];

  constructor(color: number, readonly size: number) {
    const geo = new CircleGeometry(size * 0.5, 4);
    geo.scale(0.8, 1.15, 1);
    this.mat = new MeshBasicMaterial({ color, side: DoubleSide, map: kiteTexture() });
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
    // paper bows along the tail
    for (let i = 0; i < TAIL_PTS - 1; i++) {
      const b = new Mesh(bowGeo, new MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0xffd23f, side: DoubleSide }));
      this.group.add(b);
      this.bows.push(b);
    }
  }

  setSharp(on: boolean): void {
    (this.string.material as LineBasicMaterial).color.set(on ? 0xff5050 : 0xf2f2f2);
    (this.tail.material as LineBasicMaterial).color.set(on ? 0xff5050 : 0xffffff);
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
    for (let i = 0; i < this.bows.length; i++) {
      const t = (i + 1) / (TAIL_PTS - 1);
      const b = this.bows[i];
      b.position.set(Math.sin(time * 6 + (i + 1) * 0.9) * 0.025 * t * 2, -this.size * 0.6 - t * 0.25, 0.002);
      b.rotation.z = Math.sin(time * 7 + i) * 0.7;
    }
  }
}

/** A crow that crosses the sky; touching it costs a life. */
class Bird {
  readonly group = new Group();
  private readonly wl: Mesh;
  private readonly wr: Mesh;
  active = false;
  dir = 1;
  speed = 0.6;
  constructor() {
    const wing = new BufferGeometry();
    wing.setAttribute('position', new BA(new Float32Array([0, 0, 0, 0.16, 0.02, 0.05, 0.1, 0, -0.05]), 3));
    const mat = new MeshBasicMaterial({ color: 0x1b1b1f, side: DoubleSide });
    this.wl = new Mesh(wing, mat);
    this.wr = new Mesh(wing, mat);
    this.wr.scale.x = -1;
    const body = new Mesh(new SphereGeometry(0.03, 8, 6), mat);
    body.scale.set(1, 0.8, 1.6);
    this.group.add(body, this.wl, this.wr);
    this.group.visible = false;
  }
  flap(t: number): void {
    const a = Math.sin(t * 14) * 0.6;
    this.wl.rotation.z = a;
    this.wr.rotation.z = -a;
  }
}


type EnemyType = 'normal' | 'fast' | 'armored' | 'golden';

interface Enemy {
  kite: Kite;
  slot: number;
  type: EnemyType;
  hp: number;
  base: Vector3;
  phase: number;
  freq: number;
  amp: number;
  state: 'off' | 'fly' | 'fall';
  fallT: number;
  lungeT: number;
  nextLunge: number;
  vy: number;
  spawnDelay: number;
  life: number;
  hitCooldown: number;
}

type Phase = 'play' | 'over';

const TYPE_INFO: Record<EnemyType, { points: number; hp: number; scale: number; freq: number; amp: number; color: number }> = {
  normal: { points: 100, hp: 1, scale: 1, freq: 0.6, amp: 0.4, color: 0x4dd2ff },
  fast: { points: 150, hp: 1, scale: 0.8, freq: 1.3, amp: 0.55, color: 0xc77dff },
  armored: { points: 250, hp: 2, scale: 1.35, freq: 0.45, amp: 0.3, color: 0x7cf29a },
  golden: { points: 500, hp: 1, scale: 0.9, freq: 1.6, amp: 0.6, color: 0xffd23f },
};

export class KiteSystem extends createSystem({}) {
  private mine!: Kite;
  private enemies: Enemy[] = [];
  private hud!: TextPanel;
  private root: { visible: boolean }[] = [];
  private orb!: Mesh;
  private orbX = 0;
  private orbActive = false;
  private nextOrb = 12;

  private phase: Phase = 'play';
  private lastMode = '';
  private fontWasReady = false;
  private time = 0; // seconds survived
  private birds: Bird[] = [];
  private nextBird = 8;
  private leaves!: Points;
  private leafPos = new Float32Array(24 * 3);
  private bestTime = 0;
  private lives = START_LIVES;
  private score = 0;
  private cuts = 0;
  private best = 0;
  private combo = 0;
  private comboTimer = 0;
  private sharpT = 0;
  private gustT = 0;
  private nextGust = 14;
  private gustDir = 1;
  private flashText = '';
  private flashTimer = 0;
  private overTimer = 0;
  private hurtCooldown = 0;
  private hudDirty = true;
  private elapsed = 0;
  private roundT = 0;
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
    const bases: [number, number][] = [
      [-0.5, 1.55],
      [0.5, 1.35],
      [0, 1.8],
      [-0.3, 1.2],
      [0.35, 1.7],
    ];
    const anchors: [number, number][] = [
      [-0.55, -0.9],
      [0.55, -0.9],
      [0, -0.8],
      [-0.3, -0.85],
      [0.3, -0.85],
    ];
    for (let i = 0; i < ENEMY_SLOTS; i++) {
      const k = new Kite(0x4dd2ff, 0.15);
      k.anchor.set(anchors[i][0] * 5, 0.1, -5 + anchors[i][1] * 1.5);
      this.enemies.push({
        kite: k,
        slot: i,
        type: 'normal',
        hp: 1,
        base: new Vector3(bases[i][0], bases[i][1], SKY_Z),
        phase: i * 2.1,
        freq: 0.6,
        amp: 0.4,
        state: 'off',
        fallT: 0,
        lungeT: 0,
        nextLunge: 4 + i,
        vy: 0,
        spawnDelay: 0,
        life: 0,
        hitCooldown: 0,
      });
    }
    const all = [this.mine, ...this.enemies.map((e) => e.kite)];
    for (const k of all) {
      this.world.createTransformEntity(k.group);
      this.world.createTransformEntity(k.tail);
      this.world.createTransformEntity(k.string);
      this.root.push(k.group, k.tail, k.string);
    }

    // glowing "manjha" orb: collect it for a sharper string
    this.orb = new Mesh(
      new SphereGeometry(0.045, 14, 10),
      new MeshBasicMaterial({ color: 0xff5a5a }),
    );
    this.world.createTransformEntity(this.orb);
    this.root.push(this.orb);

    this.hud = new TextPanel(0.5, 0.2);
    this.hud.mesh.position.set(0, TABLE_Y + 0.27, TABLE_CENTER_Z - 0.3);
    this.hud.mesh.rotation.x = -0.45;
    this.world.createTransformEntity(this.hud.mesh);
    this.root.push(this.hud.mesh);
    for (let i = 0; i < BIRDS; i++) {
      const b = new Bird();
      this.birds.push(b);
      this.world.createTransformEntity(b.group);
      this.root.push(b.group);
    }
    for (let i = 0; i < 24; i++) this.leafPos[i * 3 + 1] = -50;
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BA(this.leafPos, 3));
    this.leaves = new Points(lg, new PointsMaterial({ color: 0xcde58a, size: 0.035, transparent: true, opacity: 0.9, depthWrite: false }));
    this.leaves.frustumCulled = false;
    this.world.createTransformEntity(this.leaves);
    this.root.push(this.leaves);
    // wooden spool (latai) in the player's hand, the string winds off it
    const wood = new MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.8 });
    const spool = new Group();
    const rod = new Mesh(new CylinderGeometry(0.012, 0.012, 0.2, 8), wood);
    rod.rotation.z = Math.PI / 2;
    spool.add(rod);
    for (const x of [-0.09, 0.09]) {
      const d = new Mesh(new CylinderGeometry(0.05, 0.05, 0.012, 16), wood);
      d.rotation.z = Math.PI / 2;
      d.position.x = x;
      spool.add(d);
    }
    const wound = new Mesh(new CylinderGeometry(0.034, 0.034, 0.16, 14), new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 1 }));
    wound.rotation.z = Math.PI / 2;
    spool.add(wound);
    spool.position.set(PLAYER_ANCHOR.x, PLAYER_ANCHOR.y - 0.03, PLAYER_ANCHOR.z + 0.05);
    this.world.createTransformEntity(spool);
    this.root.push(spool);
    this.setVisible(false);

    try {
      this.best = Number(localStorage.getItem('guti-kite-best') ?? '0') || 0;
      this.bestTime = Number(localStorage.getItem('guti-kite-time') ?? '0') || 0;
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

  private flash(text: string, seconds = 1.3): void {
    this.flashText = text;
    this.flashTimer = seconds;
    this.hudDirty = true;
  }

  private startRound(): void {
    this.phase = 'play';
    this.time = 0;
    this.nextBird = 8;
    for (const b of this.birds) {
      b.active = false;
      b.group.visible = false;
    }
    this.roundT = 0;
    this.lives = START_LIVES;
    this.score = 0;
    this.cuts = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.sharpT = 0;
    this.gustT = 0;
    this.nextGust = 12 + Math.random() * 4;
    this.orbActive = false;
    this.nextOrb = 10;
    this.orb.visible = false;
    this.hurtCooldown = 0;
    this.target.set(0, 1.4, SKY_Z);
    this.mine.pos.copy(this.target);
    this.prevPos.copy(this.target);
    this.dragHand = null;
    for (const e of this.enemies) {
      e.state = 'off';
      e.spawnDelay = e.slot * 0.4;
      e.kite.group.visible = false;
    }
    this.flash('Pinch and move your hand. Touch kites fast to cut!', 4);
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
    if (readPinchPoint(ad as never, out)) return true;
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

  // ------------------------------------------------------------------ enemies
  private activeTarget(): number {
    return this.roundT < 18 ? 3 : this.roundT < 38 ? 4 : 5;
  }

  private spawnEnemy(e: Enemy): void {
    const r = Math.random();
    const goldenOk = this.roundT > 8 && !this.enemies.some((o) => o.type === 'golden' && o.state === 'fly');
    let type: EnemyType = 'normal';
    if (goldenOk && r < 0.1) type = 'golden';
    else if (r < 0.35) type = 'fast';
    else if (r < 0.6 && this.roundT > 10) type = 'armored';
    const info = TYPE_INFO[type];
    e.type = type;
    e.hp = info.hp;
    e.freq = info.freq;
    e.amp = info.amp;
    e.life = type === 'golden' ? 9 : 0;
    e.kite.mat.color.set(info.color);
    e.kite.group.scale.set(info.scale, info.scale, info.scale);
    e.state = 'fly';
    e.vy = 0;
    e.lungeT = 0;
    // no dives during the first seconds so new players can learn the controls
    e.nextLunge = Math.max(0, 12 - this.roundT) + 3 + Math.random() * 3;
    e.hitCooldown = 0;
    e.kite.group.rotation.z = 0;
    e.kite.group.visible = true;
    e.kite.pos.set(e.base.x, BOX_Y_MAX + 0.3, SKY_Z);
  }

  private enemyUpdate(e: Enemy, delta: number, wind: number): void {
    const k = e.kite;
    if (e.state === 'off') {
      e.spawnDelay -= delta;
      const active = this.enemies.filter((o) => o.state === 'fly').length;
      if (e.spawnDelay <= 0 && active < this.activeTarget()) this.spawnEnemy(e);
      return;
    }
    const ramp = 1 + Math.min(this.cuts, 12) * 0.06 + Math.min(this.roundT / 90, 1) * 0.35;
    if (e.state === 'fall') {
      e.fallT += delta;
      e.vy += 1.6 * delta;
      k.pos.y -= e.vy * delta;
      k.group.rotation.z += delta * 6;
      if (e.fallT > 1.6) {
        e.state = 'off';
        e.spawnDelay = 1 + Math.random() * 1.5;
        k.group.visible = false;
      }
      return;
    }
    e.hitCooldown = Math.max(0, e.hitCooldown - delta);
    if (e.type === 'golden') {
      e.life -= delta;
      if (e.life <= 0) {
        // the golden kite flies away
        k.pos.y += delta * 1.5;
        if (k.pos.y > BOX_Y_MAX + 0.6) {
          e.state = 'off';
          e.spawnDelay = 3;
          k.group.visible = false;
        }
        return;
      }
    }
    e.nextLunge -= delta;
    if (e.nextLunge <= 0 && e.lungeT <= 0 && e.type !== 'golden') {
      e.lungeT = 1.0;
      e.nextLunge = (3.5 + Math.random() * 3) / ramp;
      sfx.whoosh();
    }
    const t = this.elapsed * e.freq * ramp + e.phase;
    this.tmp.set(
      e.base.x + Math.sin(t) * e.amp + wind,
      e.base.y + Math.sin(t * 1.3) * 0.15,
      SKY_Z,
    );
    if (e.lungeT > 0) {
      e.lungeT -= delta;
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
    const sharp = this.sharpT > 0;
    const cutSpeed = sharp ? CUT_SPEED_SHARP : CUT_SPEED;
    const radius = sharp ? HIT_RADIUS * 1.5 : HIT_RADIUS;
    const px = this.mine.pos.x;
    const py = this.mine.pos.y;
    for (const e of this.enemies) {
      if (e.state !== 'fly') continue;
      const dx = e.kite.pos.x - px;
      const dy = e.kite.pos.y - py;
      const rr = radius * (e.type === 'armored' ? 1.2 : 1);
      if (dx * dx + dy * dy > rr * rr) continue;
      if (this.speed >= cutSpeed) {
        if (e.hitCooldown > 0) continue;
        e.hp -= 1;
        e.hitCooldown = 0.45;
        const col = e.kite.mat.color;
        if (e.hp > 0) {
          // armored kite: knocked back, still flying
          sfx.clack(0.8);
          emitBurst(e.kite.pos.x, e.kite.pos.y, e.kite.pos.z, 1, 1, 1, 12, 0.5);
          e.kite.pos.y += 0.12;
          this.flash('Armored! Hit again', 1);
          continue;
        }
        e.state = 'fall';
        e.fallT = 0;
        e.vy = 0;
        this.cuts += 1;
        this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
        this.comboTimer = COMBO_WINDOW;
        const mult = Math.min(this.combo, 5);
        this.score += TYPE_INFO[e.type].points * mult;
        sfx.cut();
        emitBurst(e.kite.pos.x, e.kite.pos.y, e.kite.pos.z, col.r, col.g, col.b, 30, 0.8);
        if (e.type === 'golden') {
          this.lives = Math.min(MAX_LIVES, this.lives + 1);
          this.flash('Golden kite! +1 life', 1.5);
          emitBurst(e.kite.pos.x, e.kite.pos.y, e.kite.pos.z, 1, 0.85, 0.3, 40, 0.9);
        } else if (mult >= 2) {
          this.flash('Combo x' + mult + '!', 1.2);
        }
        this.hudDirty = true;
      } else if (e.lungeT > 0 && this.hurtCooldown <= 0) {
        this.lives -= 1;
        this.hurtCooldown = 2;
        this.combo = 0;
        this.comboTimer = 0;
        sfx.hurt();
        this.flash('Cut! Move faster', 1.2);
        if (this.lives <= 0) this.endRound();
      }
    }
  }

  private updateOrb(delta: number): void {
    if (!this.orbActive) {
      this.nextOrb -= delta;
      if (this.nextOrb <= 0) {
        this.orbActive = true;
        this.orbX = Math.random() < 0.5 ? -BOX_X - 0.1 : BOX_X + 0.1;
        this.orb.position.set(this.orbX, 1.25 + Math.random() * 0.55, SKY_Z);
        this.orb.visible = true;
      }
      return;
    }
    const dir = this.orbX < 0 ? 1 : -1;
    this.orb.position.x += dir * 0.28 * delta;
    this.orb.position.y += Math.sin(this.elapsed * 4) * 0.12 * delta;
    const s = 1 + 0.2 * Math.sin(this.elapsed * 8);
    this.orb.scale.set(s, s, s);
    const dx = this.orb.position.x - this.mine.pos.x;
    const dy = this.orb.position.y - this.mine.pos.y;
    if (dx * dx + dy * dy < 0.012) {
      this.sharpT = SHARP_SECONDS;
      this.orbActive = false;
      this.orb.visible = false;
      this.nextOrb = 14 + Math.random() * 6;
      sfx.win();
      emitBurst(this.orb.position.x, this.orb.position.y, SKY_Z, 1, 0.3, 0.3, 30, 0.7);
      this.flash('Sharp string! Cut with a light touch', 1.8);
    } else if (Math.abs(this.orb.position.x) > BOX_X + 0.25) {
      this.orbActive = false;
      this.orb.visible = false;
      this.nextOrb = 8;
    }
  }

  private updateBirds(delta: number): void {
    if (this.phase !== 'play') {
      for (const b of this.birds) {
        b.active = false;
        b.group.visible = false;
      }
      return;
    }
    this.nextBird -= delta;
    if (this.nextBird <= 0) {
      const b = this.birds.find((o) => !o.active);
      if (b) {
        b.active = true;
        b.dir = Math.random() < 0.5 ? 1 : -1;
        b.speed = 0.55 + Math.random() * 0.35 + Math.min(this.roundT / 120, 0.3);
        b.group.position.set(-b.dir * (BOX_X + 0.3), BOX_Y_MIN + 0.1 + Math.random() * (BOX_Y_MAX - BOX_Y_MIN - 0.2), SKY_Z);
        b.group.scale.x = b.dir;
        b.group.visible = true;
        sfx.whoosh();
        this.flash('Crow! Dodge it', 1.2);
      }
      this.nextBird = Math.max(4, 10 - this.roundT / 15) + Math.random() * 3;
    }
    for (const b of this.birds) {
      if (!b.active) continue;
      const p = b.group.position;
      p.x += b.dir * b.speed * delta;
      p.y += Math.sin(this.elapsed * 3 + p.x * 4) * 0.12 * delta;
      b.flap(this.elapsed + p.x);
      if (Math.abs(p.x) > BOX_X + 0.4) {
        b.active = false;
        b.group.visible = false;
        continue;
      }
      const dx = p.x - this.mine.pos.x;
      const dy = p.y - this.mine.pos.y;
      if (dx * dx + dy * dy < 0.011 && this.hurtCooldown <= 0) {
        this.lives -= 1;
        this.hurtCooldown = 2;
        this.combo = 0;
        this.comboTimer = 0;
        sfx.hurt();
        emitBurst(p.x, p.y, p.z, 0.15, 0.15, 0.18, 24, 0.6);
        b.active = false;
        b.group.visible = false;
        this.flash('Crow hit your kite!', 1.2);
        if (this.lives <= 0) this.endRound();
        this.hudDirty = true;
      }
    }
  }

  private updateLeaves(delta: number, wind: number): void {
    const on = this.gustT > 0 && this.phase === 'play';
    const attr = this.leaves.geometry.getAttribute('position') as BA;
    for (let i = 0; i < 24; i++) {
      if (!on) {
        this.leafPos[i * 3 + 1] = -50;
        continue;
      }
      if (this.leafPos[i * 3 + 1] < -40 || Math.abs(this.leafPos[i * 3]) > 1.6) {
        this.leafPos[i * 3] = -this.gustDir * 1.4;
        this.leafPos[i * 3 + 1] = 0.9 + Math.random() * 1.2;
        this.leafPos[i * 3 + 2] = SKY_Z + 0.35 + Math.random() * 0.5;
      }
      this.leafPos[i * 3] += this.gustDir * (0.9 + Math.abs(wind) * 2) * delta * (0.7 + (i % 5) * 0.12);
      this.leafPos[i * 3 + 1] += Math.sin(this.elapsed * 5 + i) * 0.25 * delta;
    }
    attr.needsUpdate = true;
  }

  private endRound(): void {
    this.phase = 'over';
    this.overTimer = 5;
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem('guti-kite-best', String(this.best));
      } catch {
        /* ignore */
      }
    }
    if (this.time > this.bestTime) {
      this.bestTime = this.time;
      try {
        localStorage.setItem('guti-kite-time', String(Math.floor(this.bestTime)));
      } catch {
        /* ignore */
      }
    }
    sfx.lose();
    this.hudDirty = true;
  }

  private fmt(t: number): string {
    const m = Math.floor(t / 60);
    const sec = Math.floor(t % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('Kite Alive', 62, 48);
    if (this.phase === 'over') {
      h.text('Survived ' + this.fmt(this.time) + '   Score ' + this.score, 140, 36, '#8dff9d');
      h.text('Best ' + this.fmt(this.bestTime) + ' / ' + this.best + '  •  back to menu...', 215, 26, '#cdb99a');
    } else {
      const mult = this.comboTimer > 0 ? '  x' + Math.min(this.combo, 5) : '';
      h.text(
        this.fmt(this.time) + '   Score ' + this.score + mult + '   ' + '♥'.repeat(this.lives),
        140,
        36,
      );
      let line = 'Keep your kite alive: dodge birds, cut fast';
      let color = '#cdb99a';
      if (this.flashTimer > 0) {
        line = this.flashText;
        color = '#ffe27a';
      } else if (this.sharpT > 0) {
        line = 'SHARP STRING ' + Math.ceil(this.sharpT) + 's';
        color = '#ff8a8a';
      } else if (this.gustT > 0) {
        line = 'Wind gust!';
        color = '#9fd8ff';
      }
      h.text(line, 215, 28, color);
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
    if (this.comboTimer > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.hudDirty = true;
      }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0) this.hudDirty = true;
    }
    if (this.sharpT > 0) {
      this.sharpT -= delta;
      if (this.sharpT <= 0) this.hudDirty = true;
    }

    // wind gusts push every kite sideways for a few seconds
    let wind = 0;
    if (this.phase === 'play') {
      this.nextGust -= delta;
      if (this.nextGust <= 0 && this.gustT <= 0) {
        this.gustT = 3;
        this.gustDir = Math.random() < 0.5 ? -1 : 1;
        this.nextGust = 13 + Math.random() * 5;
        sfx.whoosh();
        this.hudDirty = true;
      }
      if (this.gustT > 0) {
        this.gustT -= delta;
        wind = this.gustDir * 0.35 * Math.sin((1 - this.gustT / 3) * Math.PI);
        if (this.gustT <= 0) this.hudDirty = true;
      }
    }

    if (this.phase === 'play') {
      this.updateInput();
      this.roundT += delta;
      this.time += delta;
      const sec = Math.floor(this.time);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.hudDirty = true;
      }
      this.updateOrb(delta);
    } else {
      this.overTimer -= delta;
      if (this.overTimer <= 0) setMode('menu');
    }

    // player kite follows the hand with a little lag, like a real one
    const k = this.mine;
    const f = 1 - Math.exp(-7 * delta);
    this.prevPos.copy(k.pos);
    k.pos.x += (this.target.x + wind * 0.9 - k.pos.x) * f;
    k.pos.y += (this.target.y - k.pos.y) * f;
    k.pos.z = SKY_Z;
    const inst = delta > 0 ? this.prevPos.distanceTo(k.pos) / delta : 0;
    this.speed += (inst - this.speed) * Math.min(1, delta * 12);
    k.group.rotation.z = Math.max(-0.5, Math.min(0.5, (this.target.x - k.pos.x) * -1.2));

    this.updateBirds(delta);
    this.updateLeaves(delta, wind);
    for (const e of this.enemies) this.enemyUpdate(e, delta, wind);
    if (this.phase === 'play') this.checkContacts();

    this.mine.body.visible =
      this.hurtCooldown <= 0 || Math.floor(this.elapsed * 12) % 2 === 0;
    // the string glows red whenever a touch would cut
    const ready = this.speed >= (this.sharpT > 0 ? CUT_SPEED_SHARP : CUT_SPEED);
    k.setSharp(ready || this.sharpT > 0);

    k.group.position.copy(k.pos);
    k.updateLines(this.elapsed, true);
    for (const e of this.enemies) {
      e.kite.group.position.copy(e.kite.pos);
      e.kite.updateLines(this.elapsed, e.state === 'fly');
      e.kite.tail.visible = e.state !== 'off';
    }

    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
