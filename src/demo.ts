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
import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, Quaternion, ShaderMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
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
// hands from the same joint data the games read. Dev-only, recording aid.
// Look: tapered tube fingers with rounded joints, a thickened palm, a wrist/forearm stub, a soft translucent
// skin shader (lambert + rim light) and tips that glow on pinch. Joint positions are low-pass filtered so the
// drawing never snaps. Geometry/materials are created once; update() allocates nothing.
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const JOINTS = (f: string): string[] =>
  f === 'thumb' ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'] : [f + '-metacarpal', f + '-phalanx-proximal', f + '-phalanx-intermediate', f + '-phalanx-distal', f + '-tip'];
/** tube radius (metres) at each joint, so fingers taper and the thumb is a little fuller */
const RADIUS = (name: string): number => {
  const th = name.startsWith('thumb') ? 0.0012 : 0;
  if (name === 'wrist') return 0.0245;
  if (name.endsWith('metacarpal')) return 0.0088 + th;
  if (name.endsWith('proximal')) return 0.0085 + th;
  if (name.endsWith('intermediate')) return 0.0074;
  if (name.endsWith('distal')) return 0.0066 + th * 0.5;
  return 0.0058 + th * 0.5; // tip
};

const SKIN_VERT = `
varying vec3 vN; varying vec3 vV;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SKIN_FRAG = `
uniform vec3 uSkin; uniform vec3 uRim; uniform vec3 uGlow; uniform float uGlowAmt; uniform float uAlpha;
varying vec3 vN; varying vec3 vV;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float nv = abs(dot(n, v));
  float fres = pow(1.0 - nv, 2.4);
  float lam = 0.58 + 0.42 * clamp(dot(n, normalize(vec3(0.35, 0.65, 0.7))), -0.2, 1.0);
  vec3 col = uSkin * lam + uRim * fres * 0.9 + uGlow * uGlowAmt;
  gl_FragColor = vec4(col, uAlpha + (1.0 - uAlpha) * fres);
}`;

class HandViz {
  readonly group = new Group();
  private names: string[] = [];
  private spheres: Mesh[] = [];
  private bones: { a: number; b: number; m: Mesh }[] = [];
  private pts: Vector3[] = [];
  private shown: Vector3[] = [];
  private idx: Record<string, number> = {};
  private built = false;
  private seeded = false;
  private readonly up = new Vector3(0, 1, 0);
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly dirV = new Vector3();
  private readonly nrmV = new Vector3();
  private readonly cenV = new Vector3();
  private readonly skin = new ShaderMaterial({ vertexShader: SKIN_VERT, fragmentShader: SKIN_FRAG, transparent: true, side: DoubleSide, uniforms: { uSkin: { value: new Color(0xe7b595) }, uRim: { value: new Color(0xffe6d2) }, uGlow: { value: new Color(0x5dff9c) }, uGlowAmt: { value: 0 }, uAlpha: { value: 0.8 } } });
  private readonly tipSkin = new ShaderMaterial({ vertexShader: SKIN_VERT, fragmentShader: SKIN_FRAG, transparent: true, side: DoubleSide, uniforms: { uSkin: { value: new Color(0xf0c3a6) }, uRim: { value: new Color(0xfff0e2) }, uGlow: { value: new Color(0x5dff9c) }, uGlowAmt: { value: 0 }, uAlpha: { value: 0.85 } } });
  private glow = 0;
  private palm!: Mesh;
  private palmPos!: Float32Array;
  private palmNrm!: Float32Array;
  private palmIdx: number[] = [];
  private fore!: Mesh;
  private tips: Mesh[] = [];
  constructor(private readonly side: Side) {}

  private build(ad: Any): void {
    const joints: { jointName?: string }[] = ad.jointSpaces;
    joints.forEach((j, i) => {
      if (j.jointName) this.idx[j.jointName] = i;
    });
    const sg = new SphereGeometry(1, 14, 10);
    const cg = new CylinderGeometry(0.74, 1, 1, 12, 1, true); // tapers toward +Y (the bone end)
    const addPt = (name: string): number => {
      const i = this.names.length;
      this.names.push(name);
      this.pts.push(new Vector3());
      this.shown.push(new Vector3());
      const tip = name.endsWith('-tip');
      const m = new Mesh(sg, tip ? this.tipSkin : this.skin);
      m.scale.setScalar(RADIUS(name));
      m.frustumCulled = false;
      this.group.add(m);
      this.spheres.push(m);
      if (tip) this.tips.push(m);
      return i;
    };
    const addBone = (a: number, b: number): void => {
      const m = new Mesh(cg, this.skin);
      m.frustumCulled = false;
      this.group.add(m);
      this.bones.push({ a, b, m });
    };
    const w = addPt('wrist');
    for (const f of FINGERS) {
      let prev = w;
      for (const jn of JOINTS(f)) {
        if (this.idx[jn] === undefined) continue;
        const k = addPt(jn);
        addBone(prev, k);
        prev = k;
      }
    }
    // palm outline: bones along the knuckle line and the two sides give the hand its width
    const at = (n: string): number => this.names.indexOf(n);
    const ring = ['thumb-metacarpal', 'index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal'].map(at);
    for (let i = 0; i + 1 < ring.length; i++) if (ring[i] >= 0 && ring[i + 1] >= 0) addBone(ring[i], ring[i + 1]);
    const pm = at('pinky-finger-metacarpal');
    if (pm >= 0 && ring[4] >= 0) addBone(pm, ring[4]);
    // palm surface: a thickened fan (front and back layer) between wrist, thumb base, knuckles and pinky base
    const poly = [w, ring[0], ring[1], ring[2], ring[3], ring[4], pm].filter((v) => v >= 0);
    this.palmIdx = poly;
    const nv = poly.length + 1; // + centre
    this.palmPos = new Float32Array(nv * 2 * 3);
    this.palmNrm = new Float32Array(nv * 2 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.palmPos, 3));
    geo.setAttribute('normal', new BufferAttribute(this.palmNrm, 3));
    const tri: number[] = [];
    for (let layer = 0; layer < 2; layer++) {
      const o = layer * nv;
      for (let i = 0; i < poly.length; i++) tri.push(o + poly.length, o + i, o + ((i + 1) % poly.length));
    }
    geo.setIndex(tri);
    this.palm = new Mesh(geo, this.skin);
    this.palm.frustumCulled = false;
    this.group.add(this.palm);
    // forearm stub, narrower at the wrist
    this.fore = new Mesh(cg, this.skin);
    this.fore.frustumCulled = false;
    this.group.add(this.fore);
    this.built = true;
  }

  update(ad: Any, pinch: number): void {
    if (!ad.connected || !ad.gripSpace || !ad.jointTransforms || !ad.jointSpaces || ad.jointSpaces.length === 0) {
      this.group.visible = false;
      this.seeded = false;
      return;
    }
    if (!this.built) this.build(ad);
    const m: Float32Array = ad.jointTransforms;
    ad.gripSpace.updateWorldMatrix(true, false);
    // eased drawing: the shown point follows the sensed joint with a short lag, so tiny pose steps never pop
    const k = this.seeded ? 0.55 : 1;
    for (let i = 0; i < this.names.length; i++) {
      const ji = this.idx[this.names[i]];
      if (ji === undefined || m.length < (ji + 1) * 16) continue;
      this.tmpV.set(m[ji * 16 + 12], m[ji * 16 + 13], m[ji * 16 + 14]);
      ad.gripSpace.localToWorld(this.tmpV);
      this.pts[i].copy(this.tmpV);
      this.shown[i].lerp(this.tmpV, k);
      this.spheres[i].position.copy(this.shown[i]);
    }
    this.seeded = true;
    for (const b of this.bones) {
      const a = this.shown[b.a];
      const c = this.shown[b.b];
      this.tmpV.copy(c).sub(a);
      const len = this.tmpV.length();
      if (len < 1e-5) continue;
      b.m.position.copy(a).addScaledVector(this.tmpV, 0.5);
      this.tmpQ.setFromUnitVectors(this.up, this.tmpV.multiplyScalar(1 / len));
      b.m.quaternion.copy(this.tmpQ);
      const r = RADIUS(this.names[b.a]);
      b.m.scale.set(r, len, r);
    }
    // palm surface
    const poly = this.palmIdx;
    const nv = poly.length + 1;
    const pa = this.shown[poly[0]];
    const p1 = this.shown[poly[2] ?? poly[1]];
    const p2 = this.shown[poly[poly.length - 2] ?? poly[poly.length - 1]];
    this.dirV.copy(p1).sub(pa);
    this.tmpV.copy(p2).sub(pa);
    this.nrmV.crossVectors(this.dirV, this.tmpV);
    if (this.nrmV.lengthSq() > 1e-12) this.nrmV.normalize();
    this.cenV.set(0, 0, 0);
    for (let i = 0; i < poly.length; i++) this.cenV.add(this.shown[poly[i]]);
    this.cenV.multiplyScalar(1 / poly.length);
    const th = 0.0072;
    for (let layer = 0; layer < 2; layer++) {
      const sgn = layer === 0 ? 1 : -1;
      const o = layer * nv * 3;
      for (let i = 0; i < nv; i++) {
        const src = i < poly.length ? this.shown[poly[i]] : this.cenV;
        const f = i < poly.length ? 0.55 : 1;
        this.palmPos[o + i * 3] = src.x + this.nrmV.x * th * sgn * f;
        this.palmPos[o + i * 3 + 1] = src.y + this.nrmV.y * th * sgn * f;
        this.palmPos[o + i * 3 + 2] = src.z + this.nrmV.z * th * sgn * f;
        this.palmNrm[o + i * 3] = this.nrmV.x * sgn;
        this.palmNrm[o + i * 3 + 1] = this.nrmV.y * sgn;
        this.palmNrm[o + i * 3 + 2] = this.nrmV.z * sgn;
      }
    }
    (this.palm.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (this.palm.geometry.attributes.normal as BufferAttribute).needsUpdate = true;
    // forearm: from a point behind the wrist, along the line from the middle knuckle through the wrist
    const mid = this.shown[this.names.indexOf('middle-finger-metacarpal')] ?? p1;
    this.dirV.copy(pa).sub(mid);
    const dl = this.dirV.length();
    if (dl > 1e-5) {
      this.dirV.multiplyScalar(1 / dl);
      this.tmpV.copy(pa).addScaledVector(this.dirV, 0.12); // far end
      this.fore.position.copy(pa).addScaledVector(this.dirV, 0.06);
      this.tmpQ.setFromUnitVectors(this.up, this.nrmV.copy(this.dirV).negate()); // narrow end (+Y) at the wrist
      this.fore.quaternion.copy(this.tmpQ);
      this.fore.scale.set(0.034, 0.12, 0.034);
    }
    // pinch: tips glow softly as the pinch closes
    this.glow += (Math.max(0, (pinch - 0.6) / 0.4) - this.glow) * 0.35;
    this.tipSkin.uniforms.uGlowAmt.value = this.glow * 0.55;
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
  const settle = async (h: Hand, target: V3, maxMs = 1500): Promise<void> => {
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
    await both(L.move([-0.22, 1.0, -0.2], 1.0), R.move([0.22, 1.0, -0.2], 1.0));
    await sleep(300);
    // sweep over the three cards, then press GearShift
    W.__setMode?.('menu');
    await R.move(near(CARD.spell, 0, 0.12, 0.25), 0.6);
    await R.move(near(CARD.aura, 0, 0.12, 0.25), 0.5);
    await R.move(near(CARD.gears, 0, 0.12, 0.25), 0.5);
    W.__setMode?.('menu');
    await sleep(200);
  };

  // ------------------------------------------------------------------ GearShift
  const params = new URLSearchParams(location.search);
  // time budget of one segment in seconds (a single-game segment is ~55-60 s; ?t=NN changes it)
  const budget = Number(params.get('t')) || 56;
  let segStart = performance.now();
  const segLeft = (): number => budget - (performance.now() - segStart) / 1000;

  const gearLevel = async (idx: number): Promise<void> => {
    W.__gearLevel(idx);
    await sleep(1300);
    const demo = W.__gearDemo();
    const jobs: { item: number; peg: number }[] = [];
    demo.solution.forEach((it: number, peg: number) => {
      if (it >= 0 && demo.placement[peg] !== it) jobs.push({ item: it, peg });
    });
    log('gear level ' + idx + ': ' + jobs.length + ' gears to place');
    // hard stop for the hand part of this level: after it, anything missing is completed by the hook, so the script never idles
    const hardStop = performance.now() + 20000;
    // two hands, each taking every other gear in parallel
    const lane = async (h: Hand, list: { item: number; peg: number }[]): Promise<void> => {
      h.rot = Q_PALM_DOWN;
      for (const j of list) {
        if (performance.now() > hardStop) return;
        const d = W.__gearDemo();
        if (d.placement[j.peg] === j.item) continue;
        const it = d.items[j.item] as V3;
        const pg = d.pegs[j.peg] as V3;
        await h.move(near(it, 0, 0.1, 0.1), 0.4);
        await h.move(it, 0.2);
        await settle(h, it, 900);
        await h.setPinch(1, 0.15);
        await sleep(80);
        await h.move(near(it, 0, 0.1, 0.05), 0.25);
        await h.move(near(pg, 0, 0.08, 0.05), 0.45);
        await h.move(pg, 0.2);
        await settle(h, pg, 900);
        await h.setPinch(0, 0.15);
        await sleep(80);
        await h.move(near(pg, 0, 0.12, 0.12), 0.25);
      }
    };
    const a = jobs.filter((_, i) => i % 2 === 0);
    const b = jobs.filter((_, i) => i % 2 === 1);
    await both(lane(L, a), lane(R, b));
    await h0(L, R);
    await sleep(350);
    let d = W.__gearDemo();
    // anything that failed to snap (a pick missed) is placed by the hook so the level can still be shown
    const miss = d.solution.filter((it: number, peg: number) => it >= 0 && d.placement[peg] !== it).length;
    if (miss > 0) {
      W.__gearSolve();
      log('gear level ' + idx + ': ' + miss + ' placement(s) completed by hook (hand pick missed or out of time)');
    } else log('gear level ' + idx + ': all gears placed by the hands');
    await sleep(350);
    d = W.__gearDemo();
    // levers: clutch (left) if needed, then ignition (right); one retry if the first pull did not register
    const pull = async (h: Hand, key: 'master' | 'clutch'): Promise<void> => {
      const k = W.__gearDemo()[key] as V3;
      await h.move(near(k, 0, 0.08, 0.08), 0.4);
      await engage(h, k, 0.25);
      await sleep(200);
      const dn = near(k, 0, -W.__gearDemo().travel - 0.02, 0);
      await h.move(dn, 0.6);
      await settle(h, dn, 900);
      log('lever ' + key + ' pulled to y ' + W.__gearDemo()[key][1].toFixed(3) + ' (rest ' + k[1].toFixed(3) + ')');
      await h.setPinch(0, 0.15);
      await sleep(80);
      await h.move(near(k, 0, -0.1, 0.12), 0.3);
    };
    for (let attempt = 0; attempt < 2 && !W.__gears().solved; attempt++) {
      if (attempt) log('gear level ' + idx + ': lever did not register, pulling again');
      if (d.clutchNeeded) await both(pull(L, 'clutch'), pull(R, 'master'));
      else await pull(R, 'master');
      for (let i = 0; i < 10 && !W.__gears().solved; i++) await sleep(250);
      d = W.__gearDemo();
    }
    if (W.__gears().solved) log('gear level ' + idx + ': solved with the hand-pulled lever');
    else {
      W.__gearWin();
      log('gear level ' + idx + ': win triggered by hook');
    }
    await sleep(1800);
  };
  // lift both hands out of the way
  const h0 = async (a: Hand, b: Hand): Promise<void> => {
    await both(a.move(near(a.pos, 0, 0.08, 0.1), 0.25), b.move(near(b.pos, 0, 0.08, 0.1), 0.25));
  };

  const gear = async (): Promise<void> => {
    segStart = performance.now();
    await pressCard('gears', R);
    await sleep(1800);
    const gl = (params.get('gl') || '0,1,3,5,7,11').split(',').map(Number);
    let played = 0;
    for (const l of gl) {
      // a new level only starts if about a level's worth of time is left (a level takes ~12-16 s)
      if (played > 0 && segLeft() < 13) break;
      await gearLevel(l);
      played++;
    }
    log('gear segment: ' + played + ' levels in ' + (((performance.now() - segStart) / 1000) | 0) + 's');
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
    segStart = performance.now();
    await toMenu();
    await pressCard('aura', L);
    await sleep(1600);
    let done = 0;
    for (const lvl of [2, 3, 4, 5, 6]) {
      // a new level only starts if about a level's worth of time is left (a level takes ~9-12 s)
      if (done > 0 && segLeft() < 10) break;
      W.__auraPlay(lvl);
      await sleep(1200);
      let d = W.__auraDemo();
      if (!d.light || !d.sol || d.rot.length === 0) {
        log('aura level ' + lvl + ' is not a light puzzle, skipped');
        continue;
      }
      log('aura level ' + lvl + ': ' + d.rot.length + ' elements to turn');
      const hardStop = performance.now() + 14000;
      const turn = async (h: Hand, list: number[]): Promise<void> => {
        for (const k of list) {
          if (performance.now() > hardStop) return;
          const ei = d.rot[k];
          const el = W.__auraDemo().elems[ei];
          const c = el.pos as V3;
          const th = (d.sol[k] * el.span) / el.n;
          const r = 0.07 * (W.__auraDemo().scale / 0.9 || 1);
          await h.move(near(c, 0.0, 0.1, 0.1), 0.4);
          await engage(h, c, 0.22);
          await sleep(80);
          const tg: V3 = [c[0] + Math.cos(th) * r, c[1] + Math.sin(th) * r, c[2]];
          await h.move(tg, 0.45);
          await settle(h, tg, 900);
          await sleep(120);
          await h.setPinch(0, 0.15);
          await h.move(near(c, 0, 0.14, 0.12), 0.3);
        }
      };
      const idx = d.rot.map((_: number, k: number) => k);
      await both(turn(L, idx.filter((k: number) => k % 2 === 0)), turn(R, idx.filter((k: number) => k % 2 === 1)));
      await sleep(500);
      d = W.__auraDemo();
      if (!d.solved) {
        W.__auraSolve();
        log('aura level ' + lvl + ': remaining angles set by hook (hand grab missed or out of time)');
        await sleep(600);
      } else log('aura level ' + lvl + ': solved by the hands');
      await sleep(1800);
      done++;
    }
    log('aura segment: ' + done + ' levels in ' + (((performance.now() - segStart) / 1000) | 0) + 's');
  };

  // ------------------------------------------------------------------ Spellforge
  const spell = async (): Promise<void> => {
    segStart = performance.now();
    await toMenu();
    await pressCard('spell', R);
    await sleep(2200);
    pose(L, 'open');
    pose(R, 'open');
    L.anchor = 'wrist';
    R.anchor = 'wrist';
    L.rot = Q_PALM_IN_LEFT;
    R.rot = Q_PALM_IN_RIGHT;
    L.sway = 0.006;
    R.sway = 0.006;
    W.__sfStart('training');
    await sleep(1800);
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
      await both(L.move([-0.1, 1.1, -0.3], 0.45), R.move([0.1, 1.1, -0.3], 0.45));
      await sleep(380);
      await both(L.move([-0.2, 1.12, -0.3], 0.35), R.move([0.2, 1.12, -0.3], 0.35));
      await sleep(200);
      await both(L.move([-0.14, 1.12, -0.75], 0.22), R.move([0.14, 1.12, -0.75], 0.22));
      await sleep(650);
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
      await both(L.move([-0.22, 1.0, -0.2], 0.4), R.move([0.22, 1.0, -0.2], 0.4));
      await sleep(250);
    };
    // two quick enemy fights with different attunements
    W.__sfSpawn('ember_beast', 0, undefined);
    W.__sfAttune('both', 'fire');
    await castOnce();
    W.__sfAttune('left', 'ice');
    W.__sfAttune('right', 'lightning');
    W.__sfSpawn('frost_wraith', 0, undefined);
    await castOnce();
    // the three bosses. Each: two casts in the opening phase, then the boss health is moved to the last phase
    // (assisted, logged) so the late phases and the kill fit into the time, then one cast and the finishing blow.
    const bosses: { id: string; a: [string, string]; need: number }[] = [
      { id: 'ignar', a: ['ice', 'ice'], need: 17 },
      { id: 'vyra', a: ['nature', 'nature'], need: 17 },
      { id: 'voidking', a: ['fire', 'aether'], need: 17 },
    ];
    let shown = 0;
    for (const bs of bosses) {
      if (shown > 0 && segLeft() < bs.need - 4) break;
      W.__sfStart('campaign', bs.id);
      await sleep(2400);
      W.__sfAttune('left', bs.a[0]);
      W.__sfAttune('right', bs.a[1]);
      await castOnce();
      await castOnce();
      const bt = W.__sfBattle();
      if (bt?.boss && !bt.boss.dead) {
        bt.boss.hp = Math.max(2, bt.boss.maxHp * 0.14);
        log('boss ' + bs.id + ': health moved to the final phase by hook (assist, to fit the time)');
        await sleep(700);
        await castOnce();
        const b3 = W.__sfBattle();
        if (b3?.boss && !b3.boss.dead) {
          b3.boss.hp = 0;
          b3.killBoss?.();
          log('boss ' + bs.id + ': final blow by hook (killBoss)');
        }
        await sleep(2200);
      }
      shown++;
    }
    log('spell segment: ' + shown + ' bosses in ' + (((performance.now() - segStart) / 1000) | 0) + 's');
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
      if (want('gear') && which !== 'race') {
        if (which !== 'all') await intro();
        await gear();
      } else if (which === 'race') {
        await pressCard('gears', R);
        await sleep(2500);
        await race();
      }
      if (want('aura')) await aura();
      if (want('spell')) await spell();
      if (which === 'all') {
        await toMenu();
        await both(L.move([-0.22, 0.75, -0.1], 1.5), R.move([0.22, 0.75, -0.1], 1.5));
      } else {
        // single segment: hold the final frame so the cut has a clean tail
        await sleep(2500);
      }
    } catch (e) {
      log('demo error ' + (e as Error).message);
    }
    log('DONE ' + which + ' after ' + (((performance.now() - started) / 1000) | 0) + 's');
    W.__demoDone = true;
    void loopOn;
  })();
}
