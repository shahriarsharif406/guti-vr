/**
 * DEV-ONLY autoplay demo ("?demo=all", or ?demo=menu|gear|race|aura|spell for one station).
 *
 * Purpose: record a clean two-hand walkthrough on a laptop without driving the IWER emulator by hand.
 * It enters the (emulated) XR session, switches IWER to hand input and animates BOTH emulated hands with
 * eased motion and real pinch values. The games read those hands through the normal input path
 * (GearShift/Aura read pinch + index/thumb tips, Spellforge reads the full joint frames).
 *
 * What is real and what is assisted is listed in DOCUMENTATION/DEMO_MODE.md and reported in window.__demoLog.
 * This file is imported only behind `import.meta.env.DEV`, so production builds contain none of it.
 */
import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from '@iwsdk/core';
import { readPinchPoint } from './hand.js';

type V3 = [number, number, number];
type Side = 'left' | 'right';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const W = window as unknown as Any;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const log = (msg: string): void => {
  (W.__demoLog ??= []).push(((performance.now() / 1000) | 0) + 's ' + msg);
  console.log('[demo] ' + msg);
};

// wrist rotations (quaternion x,y,z,w). Wrist frame: -Z along the fingers, +Y out of the back of the hand.
const Q_PALM_DOWN: [number, number, number, number] = [0, 0, 0, 1];
const S2 = Math.SQRT1_2;
const Q_PALM_IN_LEFT: [number, number, number, number] = [0, 0, S2, S2]; // palm faces +x
const Q_PALM_IN_RIGHT: [number, number, number, number] = [0, 0, -S2, S2]; // palm faces -x


// ------------------------------------------------------------------ visible hands
// The emulator does not reliably draw hand meshes (they come from a remote model), so the demo draws its own
// glass skeleton hands from the same joint data the games read. Dev-only, recording aid.
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const JOINTS = (f: string): string[] =>
  f === 'thumb' ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'] : [f + '-metacarpal', f + '-phalanx-proximal', f + '-phalanx-intermediate', f + '-phalanx-distal', f + '-tip'];

class HandViz {
  readonly group = new Group();
  private names: string[] = [];
  private spheres: Mesh[] = [];
  private bones: { a: number; b: number; m: Mesh }[] = [];
  private pts: Vector3[] = [];
  private idx: Record<string, number> = {};
  private built = false;
  private readonly up = new Vector3(0, 1, 0);
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly mat = new MeshBasicMaterial({ color: 0xffe3cf, transparent: true, opacity: 0.92 });
  private readonly tipMat = new MeshBasicMaterial({ color: 0xfff2e6, transparent: true, opacity: 0.95 });
  private readonly glowMat = new MeshBasicMaterial({ color: 0x7dffb2, transparent: true, opacity: 0.98 });
  private tips: Mesh[] = [];
  constructor(private readonly side: Side) {}

  private build(ad: Any): void {
    const joints: { jointName?: string }[] = ad.jointSpaces;
    joints.forEach((j, i) => {
      if (j.jointName) this.idx[j.jointName] = i;
    });
    const wrist = this.idx['wrist'];
    const sg = new SphereGeometry(1, 10, 8);
    const cg = new CylinderGeometry(1, 1, 1, 8, 1);
    const addPt = (name: string): number => {
      const i = this.names.length;
      this.names.push(name);
      this.pts.push(new Vector3());
      const tip = name.endsWith('-tip');
      const m = new Mesh(sg, tip ? this.tipMat : this.mat);
      m.scale.setScalar(tip ? 0.0115 : 0.0085);
      this.group.add(m);
      this.spheres.push(m);
      if (tip) this.tips.push(m);
      return i;
    };
    const w = addPt('wrist');
    void wrist;
    for (const f of FINGERS) {
      let prev = w;
      for (const jn of JOINTS(f)) {
        if (this.idx[jn] === undefined) continue;
        const k = addPt(jn);
        const bm = new Mesh(cg, this.mat);
        this.group.add(bm);
        this.bones.push({ a: prev, b: k, m: bm });
        prev = k;
      }
    }
    // palm: bones across the knuckles
    const knuckles = FINGERS.map((f) => f + '-metacarpal').filter((n) => this.names.includes(n));
    for (let i = 0; i + 1 < knuckles.length; i++) {
      const bm = new Mesh(cg, this.mat);
      this.group.add(bm);
      this.bones.push({ a: this.names.indexOf(knuckles[i]), b: this.names.indexOf(knuckles[i + 1]), m: bm });
    }
    this.built = true;
  }

  update(ad: Any, pinch: number): void {
    if (!ad.connected || !ad.gripSpace || !ad.jointTransforms || !ad.jointSpaces || ad.jointSpaces.length === 0) {
      this.group.visible = false;
      return;
    }
    if (!this.built) this.build(ad);
    const m: Float32Array = ad.jointTransforms;
    ad.gripSpace.updateWorldMatrix(true, false);
    for (let i = 0; i < this.names.length; i++) {
      const ji = this.idx[this.names[i]];
      if (ji === undefined || m.length < (ji + 1) * 16) continue;
      this.tmpV.set(m[ji * 16 + 12], m[ji * 16 + 13], m[ji * 16 + 14]);
      ad.gripSpace.localToWorld(this.tmpV);
      this.pts[i].copy(this.tmpV);
      this.spheres[i].position.copy(this.tmpV);
    }
    for (const b of this.bones) {
      const a = this.pts[b.a];
      const c = this.pts[b.b];
      this.tmpV.copy(c).sub(a);
      const len = this.tmpV.length();
      if (len < 1e-5) continue;
      b.m.position.copy(a).addScaledVector(this.tmpV, 0.5);
      this.tmpQ.setFromUnitVectors(this.up, this.tmpV.multiplyScalar(1 / len));
      b.m.quaternion.copy(this.tmpQ);
      b.m.scale.set(0.0052, len, 0.0052);
    }
    const tipMat = pinch > 0.85 ? this.glowMat : this.tipMat;
    for (const t of this.tips) t.material = tipMat;
    this.group.visible = true;
  }
}

class Hand {
  pos: V3;
  private from: V3;
  private to: V3;
  private t0 = 0;
  private dur = 0;
  private done: (() => void) | null = null;
  pinch = 0;
  private pFrom = 0;
  private pTo = 0;
  private pT0 = 0;
  private pDur = 0;
  private pDone: (() => void) | null = null;
  anchor: 'grasp' | 'wrist' = 'grasp';
  rot: [number, number, number, number] = Q_PALM_DOWN;
  sway = 0.004;
  seeded = false;
  constructor(
    readonly side: Side,
    start: V3,
  ) {
    this.pos = [...start];
    this.from = [...start];
    this.to = [...start];
  }
  move(to: V3, secs: number): Promise<void> {
    this.from = [...this.pos];
    this.to = to;
    this.t0 = performance.now();
    this.dur = Math.max(1, secs * 1000);
    return new Promise((r) => {
      this.done?.();
      this.done = r;
    });
  }
  setPinch(v: number, secs: number): Promise<void> {
    this.pFrom = this.pinch;
    this.pTo = v;
    this.pT0 = performance.now();
    this.pDur = Math.max(1, secs * 1000);
    return new Promise((r) => {
      this.pDone?.();
      this.pDone = r;
    });
  }
  tick(now: number): void {
    if (this.done) {
      const k = Math.min(1, (now - this.t0) / this.dur);
      const e = ease(k);
      for (let i = 0; i < 3; i++) this.pos[i] = this.from[i] + (this.to[i] - this.from[i]) * e;
      if (k >= 1) {
        const d = this.done;
        this.done = null;
        d();
      }
    }
    if (this.pDone) {
      const k = Math.min(1, (now - this.pT0) / this.pDur);
      this.pinch = this.pFrom + (this.pTo - this.pFrom) * ease(k);
      if (k >= 1) {
        const d = this.pDone;
        this.pDone = null;
        d();
      }
    }
  }
}

export function startDemo(world: Any): void {
  const which = new URLSearchParams(location.search).get('demo') || 'all';
  const want = (k: string): boolean => which === 'all' || which === k;
  const hands: Record<Side, Hand> = { left: new Hand('left', [-0.22, 0.72, -0.1]), right: new Hand('right', [0.22, 0.72, -0.1]) };
  const L = hands.left;
  const R = hands.right;
  const started = performance.now();

  const dev = (): Any => W.IWER_DEVICE;
  let loopOn = false;
  let pinErr = 0;
  const sense = new Vector3();

  const viz: Record<Side, HandViz> = { left: new HandViz('left'), right: new HandViz('right') };
  world.scene.add(viz.left.group, viz.right.group);
  const sensedOf = (side: Side): number[] | null => {
    const ad = world.input.xr.visualAdapters.hand[side];
    return readPinchPoint(ad, sense) ? [+sense.x.toFixed(3), +sense.y.toFixed(3), +sense.z.toFixed(3)] : null;
  };
  const frame = (): void => {
    const d = dev();
    const now = performance.now();
    if (d && d.activeSession) {
      // the emulator's own panels stop overriding the hand/head poses while it is in programmatic control
      if (d.controlMode !== 'programmatic') d.controlMode = 'programmatic';
      for (const side of ['left', 'right'] as Side[]) {
        const h = hands[side];
        h.tick(now);
        const input = d.hands?.[side];
        if (!input) continue;
        const sw = h.sway;
        const t = now / 1000;
        const p: V3 = [h.pos[0] + Math.sin(t * 1.3 + (side === 'left' ? 0 : 2)) * sw, h.pos[1] + Math.sin(t * 1.7 + (side === 'left' ? 1 : 3)) * sw, h.pos[2]];
        try {
          // this emulator build has no hand pinning, so close the loop on the point the games read:
          // the pinch point (thumb/index tip midpoint) for 'grasp', the grip/wrist for 'wrist'
          const ad = world.input.xr.visualAdapters.hand[side];
          let have = false;
          if (h.anchor === 'grasp') have = readPinchPoint(ad, sense);
          else if (ad.connected && ad.gripSpace) {
            ad.gripSpace.getWorldPosition(sense);
            have = true;
          }
          const q = input.quaternion;
          if (!h.seeded || !have) {
            input.position.set(p[0], p[1], p[2]);
            h.seeded = true;
          } else {
            const g = 0.8;
            input.position.set(input.position.x + (p[0] - sense.x) * g, input.position.y + (p[1] - sense.y) * g, input.position.z + (p[2] - sense.z) * g);
          }
          q.set(h.rot[0], h.rot[1], h.rot[2], h.rot[3]);
          input.updatePinchValue(h.pinch);
        } catch (e) {
          if (!pinErr++) log('hand drive error ' + (e as Error).message);
        }
      }
      for (const side of ['left', 'right'] as Side[]) viz[side].update(world.input.xr.visualAdapters.hand[side], hands[side].pinch);
      W.__demoHands = { left: [...L.pos], right: [...R.pos], pinchL: L.pinch, pinchR: R.pinch, sensed: { left: sensedOf('left'), right: sensedOf('right') } };
    } else {
      // keep promises moving even before the session exists
      L.tick(now);
      R.tick(now);
    }
    requestAnimationFrame(frame);
  };

  const headPose = (): void => {
    const d = dev();
    if (!d) return;
    try {
      d.position.set(0, 1.35, 0.45);
      const a = -0.3217 / 2; // look down ~18 degrees at the table, same as the app's flat camera
      d.quaternion.set(Math.sin(a), 0, 0, Math.cos(a));
    } catch {
      /* ignore */
    }
  };

  const enterXR = async (): Promise<void> => {
    for (let i = 0; i < 400 && !dev(); i++) await sleep(250);
    const d = dev();
    if (!d) {
      log('no IWER device: demo needs the dev server');
      return;
    }
    try {
      d.primaryInputMode = 'hand';
    } catch {
      /* ignore */
    }
    headPose();
    for (let i = 0; i < 160 && !d.activeSession; i++) {
      if (i % 8 === 0) {
        const btn = [...document.querySelectorAll('button, a, div')].find((e) => (e.textContent || '').trim() === 'Enter XR') as HTMLElement | undefined;
        if (btn) btn.click();
        else if (world.launchXR) {
          try {
            world.launchXR();
          } catch {
            /* ignore */
          }
        }
      }
      await sleep(250);
    }
    if (!d.activeSession) {
      log('could not start the XR session');
      return;
    }
    try {
      d.primaryInputMode = 'hand';
    } catch {
      /* ignore */
    }
    headPose();
    log('XR session active, hand input on');
  };

  // wait until the sensed pinch point is within ~2 cm of the target (the emulator reports poses one frame late)
  const settle = async (h: Hand, target: V3, maxMs = 2500): Promise<void> => {
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs) {
      const s = sensedOf(h.side);
      if (s && Math.hypot(s[0] - target[0], s[1] - target[1]) < 0.02) return;
      await sleep(60);
    }
  };
  // close the fingers most of the way on the approach (closing moves the tip midpoint), settle on the target, then pinch
  const engage = async (h: Hand, p: V3, secs = 0.3): Promise<void> => {
    await both(h.move(p, secs), h.setPinch(0.75, secs));
    await settle(h, p);
    await h.setPinch(1, 0.15);
  };
  const both = (a: Promise<unknown>, b: Promise<unknown>): Promise<unknown> => Promise.all([a, b]);
  const near = (p: V3, dx = 0, dy = 0, dz = 0): V3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  const open = (h: Hand): void => {
    const inp = dev()?.hands?.[h.side];
    try {
      if (inp && inp.poseId !== 'default') inp.poseId = 'default';
    } catch {
      /* ignore */
    }
  };
  const pose = (h: Hand, id: string): void => {
    const inp = dev()?.hands?.[h.side];
    try {
      if (inp) inp.poseId = id;
    } catch {
      /* ignore */
    }
  };

  // ------------------------------------------------------------------ menu
  const CARD: Record<string, V3> = { gears: [-0.3, 0.94, -0.5], aura: [0, 0.94, -0.5], spell: [0.3, 0.94, -0.5] };
  const pressCard = async (mode: string, h: Hand): Promise<void> => {
    const p = CARD[mode];
    await h.move(near(p, 0, 0.02, 0.12), 0.9);
    await h.move(near(p, 0, 0, 0.02), 0.45);
    await settle(h, near(p, 0, 0, 0.02));
    await h.setPinch(1, 0.3);
    await sleep(350);
    if (W.__demoMode?.() === mode) log('menu card pressed by the hand ray/poke: ' + mode);
    else {
      W.__setMode(mode);
      log('menu card: gesture shown, mode switched by hook: ' + mode);
    }
    await h.setPinch(0, 0.3);
    await h.move(near(h.pos, 0, 0.1, 0.12), 0.5);
  };
  W.__demoMode = (): string | undefined => W.__gears?.().mode;

  const toMenu = async (): Promise<void> => {
    W.__setMode?.('menu');
    await both(L.move([-0.22, 0.98, -0.2], 0.9), R.move([0.22, 0.98, -0.2], 0.9));
    await sleep(500);
  };

  const intro = async (): Promise<void> => {
    await both(L.move([-0.22, 1.0, -0.2], 1.8), R.move([0.22, 1.0, -0.2], 1.8));
    await sleep(600);
    // sweep over the three cards, then press GearShift
    W.__setMode?.('menu');
    await R.move(near(CARD.spell, 0, 0.12, 0.25), 0.9);
    await R.move(near(CARD.aura, 0, 0.12, 0.25), 0.7);
    await R.move(near(CARD.gears, 0, 0.12, 0.25), 0.7);
    W.__setMode?.('menu');
    await sleep(200);
  };

  // ------------------------------------------------------------------ GearShift
  const gearLevel = async (idx: number): Promise<void> => {
    W.__gearLevel(idx);
    await sleep(1800);
    const demo = W.__gearDemo();
    const jobs: { item: number; peg: number }[] = [];
    demo.solution.forEach((it: number, peg: number) => {
      if (it >= 0 && demo.placement[peg] !== it) jobs.push({ item: it, peg });
    });
    log('gear level ' + idx + ': ' + jobs.length + ' gears to place');
    // two hands, each taking every other gear in parallel
    const lane = async (h: Hand, list: { item: number; peg: number }[]): Promise<void> => {
      h.rot = Q_PALM_DOWN;
      for (const j of list) {
        const d = W.__gearDemo();
        const it = d.items[j.item] as V3;
        const pg = d.pegs[j.peg] as V3;
        await h.move(near(it, 0, 0.1, 0.1), 0.55);
        await h.move(it, 0.3);
        await settle(h, it);
        await h.setPinch(1, 0.22);
        await sleep(120);
        await h.move(near(it, 0, 0.1, 0.05), 0.35);
        await h.move(near(pg, 0, 0.08, 0.05), 0.7);
        await h.move(pg, 0.3);
        await settle(h, pg);
        await h.setPinch(0, 0.2);
        await sleep(120);
        await h.move(near(pg, 0, 0.12, 0.12), 0.4);
      }
    };
    const a = jobs.filter((_, i) => i % 2 === 0);
    const b = jobs.filter((_, i) => i % 2 === 1);
    await both(lane(L, a), lane(R, b));
    await sleep(600);
    let d = W.__gearDemo();
    // anything that failed to snap (a pick missed) is placed by the hook so the level can still be shown
    const miss = d.solution.filter((it: number, peg: number) => it >= 0 && d.placement[peg] !== it).length;
    if (miss > 0) {
      W.__gearSolve();
      log('gear level ' + idx + ': ' + miss + ' placement(s) completed by hook (hand pick missed)');
    } else log('gear level ' + idx + ': all gears placed by the hands');
    await sleep(500);
    d = W.__gearDemo();
    // levers: clutch (left) if needed, then ignition (right)
    const pull = async (h: Hand, key: 'master' | 'clutch'): Promise<void> => {
      const k = W.__gearDemo()[key] as V3;
      await h.move(near(k, 0, 0.08, 0.08), 0.6);
      await engage(h, k);
      await sleep(300);
      const dn = near(k, 0, -W.__gearDemo().travel - 0.02, 0);
      await h.move(dn, 0.8);
      await settle(h, dn);
      log('lever ' + key + ' pulled to y ' + W.__gearDemo()[key][1].toFixed(3) + ' (rest ' + k[1].toFixed(3) + ')');
      await h.setPinch(0, 0.2);
      await sleep(100);
      await h.move(near(k, 0, -0.1, 0.12), 0.4);
    };
    if (d.clutchNeeded) await both(pull(L, 'clutch'), pull(R, 'master'));
    else await pull(R, 'master');
    for (let i = 0; i < 60 && !W.__gears().solved; i++) await sleep(300);
    if (W.__gears().solved) log('gear level ' + idx + ': solved with the hand-pulled lever');
    else {
      W.__gearWin();
      log('gear level ' + idx + ': win triggered by hook');
    }
    await sleep(2500);
  };

  const gear = async (): Promise<void> => {
    await pressCard('gears', R);
    await sleep(2500);
    const gl = (new URLSearchParams(location.search).get('gl') || '0,3').split(',').map(Number);
    for (const l of gl) await gearLevel(l);
  };

  const race = async (): Promise<void> => {
    W.__raceOpen();
    await sleep(2500);
    // hands up as if on a wheel
    await both(L.move([-0.14, 1.05, -0.32], 0.9), R.move([0.14, 1.05, -0.32], 0.9));
    await both(L.setPinch(0.6, 0.4), R.setPinch(0.6, 0.4));
    W.__raceStart(0);
    log('racer started (via hook; the menu button press itself is hook-assisted)');
    const t0 = performance.now();
    let shifts = 0;
    while (performance.now() - t0 < 24000) {
      const r = W.__race();
      if (r?.screen === 'race' && r.phase === 'race' && r.win && r.rpm >= r.win.center) {
        W.__raceShift();
        shifts++;
        // flick the right hand up as the gear is shifted
        R.move([0.14, 1.14, -0.34], 0.12).then(() => R.move([0.14, 1.05, -0.32], 0.25));
        await sleep(600);
      } else await sleep(120);
      if (r?.screen === 'results') break;
    }
    log('racer: ' + shifts + ' shifts');
    await both(L.setPinch(0, 0.3), R.setPinch(0, 0.3));
    W.__racePress(16);
    await sleep(1200);
  };

  // ------------------------------------------------------------------ Aura Weaver
  const aura = async (): Promise<void> => {
    await toMenu();
    await pressCard('aura', L);
    await sleep(2500);
    let done = 0;
    for (const lvl of [2, 3, 4, 5, 6]) {
      if (done >= 2) break;
      W.__auraPlay(lvl);
      await sleep(1600);
      let d = W.__auraDemo();
      if (!d.light || !d.sol || d.rot.length === 0) {
        log('aura level ' + lvl + ' is not a light puzzle, skipped');
        continue;
      }
      log('aura level ' + lvl + ': ' + d.rot.length + ' elements to turn');
      const turn = async (h: Hand, list: number[]): Promise<void> => {
        for (const k of list) {
          const ei = d.rot[k];
          const el = W.__auraDemo().elems[ei];
          const c = el.pos as V3;
          const th = (d.sol[k] * el.span) / el.n;
          const r = 0.07 * (W.__auraDemo().scale / 0.9 || 1);
          await h.move(near(c, 0.0, 0.1, 0.1), 0.6);
          await engage(h, c);
          await sleep(120);
          const tg: V3 = [c[0] + Math.cos(th) * r, c[1] + Math.sin(th) * r, c[2]];
          await h.move(tg, 0.6);
          await settle(h, tg);
          await sleep(200);
          await h.setPinch(0, 0.2);
          await h.move(near(c, 0, 0.14, 0.12), 0.4);
        }
      };
      const idx = d.rot.map((_: number, k: number) => k);
      await both(turn(L, idx.filter((k: number) => k % 2 === 0)), turn(R, idx.filter((k: number) => k % 2 === 1)));
      await sleep(900);
      d = W.__auraDemo();
      if (!d.solved) {
        W.__auraSolve();
        log('aura level ' + lvl + ': remaining angles set by hook (hand grab missed)');
        await sleep(900);
      } else log('aura level ' + lvl + ': solved by the hands');
      await sleep(3500);
      done++;
    }
  };

  // ------------------------------------------------------------------ Spellforge
  const spell = async (): Promise<void> => {
    await toMenu();
    await pressCard('spell', R);
    await sleep(3000);
    pose(L, 'open');
    pose(R, 'open');
    L.anchor = 'wrist';
    R.anchor = 'wrist';
    L.rot = Q_PALM_IN_LEFT;
    R.rot = Q_PALM_IN_RIGHT;
    L.sway = 0.006;
    R.sway = 0.006;
    W.__sfStart('training');
    await sleep(2500);
    const enemyOf = (): Any => W.__sfBattle?.()?.enemies?.[0];
    const castOnce = async (): Promise<void> => {
      const b = W.__sfBattle();
      const e = enemyOf();
      const hp0 = e ? e.hp : 0;
      const boss = b?.boss;
      const hpB = boss ? boss.hp : 0;
      const hits0 = b?.stats?.hits ?? 0;
      const casts0 = b?.stats?.casts ?? 0;
      // palms facing, form the orb, spread, push forward with both hands
      await both(L.move([-0.1, 1.1, -0.3], 0.6), R.move([0.1, 1.1, -0.3], 0.6));
      await sleep(550);
      await both(L.move([-0.2, 1.12, -0.3], 0.5), R.move([0.2, 1.12, -0.3], 0.5));
      await sleep(300);
      await both(L.move([-0.14, 1.12, -0.75], 0.26), R.move([0.14, 1.12, -0.75], 0.26));
      await sleep(900);
      const e2 = enemyOf();
      const b2 = W.__sfBattle();
      const hit = (e2 && e && e2.hp < hp0) || (b2?.boss && b2.boss.hp < hpB) || (b2?.stats?.hits ?? 0) > hits0 || (b2?.stats?.casts ?? 0) > casts0;
      if (!hit) {
        // assist: fire the current spell through the real battle code from the hand position
        const caster = W.__sfCaster();
        const target = b2?.boss ? b2.bossCenter() : e2 ? b2.center(e2) : [0, 1, -3];
        const o: V3 = [0, 1.15, -0.6];
        const dir: V3 = [target[0] - o[0], target[1] - o[1], target[2] - o[2]];
        const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        b2.cast(caster.currentSpell(false), 1, o, [dir[0] / l, dir[1] / l, dir[2] / l]);
        log('spell: gesture shown, cast fired by hook (the gesture engine did not register it in time)');
      } else log('spell: cast by the hand gesture');
      await both(L.move([-0.22, 1.0, -0.2], 0.6), R.move([0.22, 1.0, -0.2], 0.6));
      await sleep(500);
    };
    W.__sfSpawn('ember_beast', 0, undefined);
    W.__sfAttune('both', 'fire');
    for (let i = 0; i < 2; i++) await castOnce();
    W.__sfAttune('left', 'fire');
    W.__sfAttune('right', 'lightning');
    W.__sfSpawn('frost_wraith', 0, undefined);
    await castOnce();
    // boss
    W.__sfStart('campaign', 'ignar');
    await sleep(4500);
    W.__sfAttune('left', 'ice');
    W.__sfAttune('right', 'ice');
    for (let i = 0; i < 3; i++) await castOnce();
  };

  // ------------------------------------------------------------------ run
  void (async () => {
    requestAnimationFrame(frame);
    loopOn = true;
    // hide the emulator's "Remote Control Active" pill so it does not appear in the recording
    const hidePill = (root: Document | ShadowRoot): void => {
      for (const e of root.querySelectorAll('*')) {
        const sh = (e as HTMLElement).shadowRoot;
        if (sh) hidePill(sh);
        if (e.children.length <= 2 && /Remote Control Active\s*$/.test(e.textContent || '') && (e.textContent || '').length < 40) {
          let n = e as HTMLElement;
          while (n.parentElement && n.parentElement.children.length === 1 && n.parentElement !== document.body) n = n.parentElement;
          n.style.display = 'none';
        }
      }
    };
    setInterval(() => hidePill(document), 500);
    await enterXR();
    if (!dev()?.activeSession) return;
    await sleep(2500);
    try {
      if (which === 'all' || which === 'menu') await intro();
      if (want('gear')) {
        if (which !== 'all') await intro();
        await gear();
        if (want('race')) await race();
      } else if (which === 'race') {
        await pressCard('gears', R);
        await sleep(2500);
        await race();
      }
      if (want('aura')) await aura();
      if (want('spell')) await spell();
      await toMenu();
      await both(L.move([-0.22, 0.75, -0.1], 1.5), R.move([0.22, 0.75, -0.1], 1.5));
    } catch (e) {
      log('demo error ' + (e as Error).message);
    }
    log('DEMO_DONE after ' + (((performance.now() - started) / 1000) | 0) + 's');
    W.__demoDone = true;
    void loopOn;
  })();
}
