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
  private time = ROUND_SECONDS;
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
      k.anchor.set(anchors[i][0], TABLE_Y + 0.1, anchors[i][1]);
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

  private flash(text: string, seconds = 1.3): void {
    this.flashText = text;
    this.flashTimer = seconds;
    this.hudDirty = true;
  }

  private startRound(): void {
    this.phase = 'play';
    this.time = ROUND_SECONDS;
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
    const ramp = 1 + Math.min(this.cuts, 12) * 0.06;
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
          this.time += 5;
          this.flash('Golden kite! +5 seconds', 1.5);
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
    sfx.lose();
    this.hudDirty = true;
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('Kite Fight', 62, 48);
    if (this.phase === 'over') {
      h.text('Score ' + this.score + '   Best ' + this.best, 140, 40, '#8dff9d');
      h.text('Cuts ' + this.cuts + '  •  returning to the menu...', 215, 28, '#cdb99a');
    } else {
      const mult = this.comboTimer > 0 ? '  x' + Math.min(this.combo, 5) : '';
      h.text(
        'Score ' + this.score + mult + '   Lives ' + this.lives + '   ' + Math.ceil(this.time) + 's',
        140,
        36,
      );
      let line = 'Hit fast to cut. Slow and they cut you';
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
      this.updateOrb(delta);
    } else {
      this.overTimer -= delta;
      if (this.overTimer <= 0) setMode('menu');
    }

    // player kite follows the hand with a little lag, like a real one
    const k = this.mine;
    const f = 1 - Math.exp(-7 * delta);
    this.prevPos.copy(k.pos);
    k.pos.x += (this.target.x + wind * 0.5 - k.pos.x) * f;
    k.pos.y += (this.target.y - k.pos.y) * f;
    k.pos.z = SKY_Z;
    const inst = delta > 0 ? this.prevPos.distanceTo(k.pos) / delta : 0;
    this.speed += (inst - this.speed) * Math.min(1, delta * 12);
    k.group.rotation.z = Math.max(-0.5, Math.min(0.5, (this.target.x - k.pos.x) * -1.2));

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
