/**
 * SPELLFORGE boss rigs: three original, multi-part, procedurally animated boss models.
 *
 * Every boss is built from primitives plus small canvas textures (no external assets) and animated by a
 * pose blender: idle + wind-up (anticipation, readable telegraph) + strike (follow-through) + stagger spring
 * + phase-transition roar + death. Damage states change the model as health falls.
 * Units: the model is about 1.3 local units tall with its centre near y = 0.55; the battle scales it.
 * Nothing is allocated in tick(): every object, vector and buffer is created once in the builder.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  BoxGeometry,
} from '@iwsdk/core';
import type { BossDef } from './sfdata';
import { glowSprite } from './sfvfx';

/** what the simulation tells a rig every frame */
export interface RigState {
  tele: number;
  frozen: boolean;
  burning: boolean;
  rooted: boolean;
  hpFrac: number;
  armor: boolean;
  phase?: number;
  /** attack being wound up (boss) */
  kind?: string;
  teleDur?: number;
  /** > 0 during a phase-change roar */
  trans?: number;
  dead?: boolean;
  /** 0..1 death progress */
  deathK?: number;
  vuln?: boolean;
  barrier?: boolean;
  /** element colour of an element burst being wound up */
  elHex?: number;
  /** 0..1 stagger amount (enemies) */
  stagger?: number;
  /** horizontal speed in m/s, for gait */
  moving?: number;
}
/** a socket that sprays particles in world space; the system reads these each frame */
export interface Emitter {
  obj: Object3D;
  hex: number;
  /** particles per second */
  rate: number;
  vel: [number, number, number];
  spread: number;
  size: number;
  life: number;
  grav: number;
  on: boolean;
  acc: number;
}
export interface BossRig {
  group: Group;
  tick(dt: number, t: number, st: RigState): void;
  /** a hit landed: amount 0..1 drives the stagger spring and the flash */
  flash(amount?: number): void;
  mats: MeshStandardMaterial[];
  emitters: Emitter[];
  /** one-shot cues for the system to turn into particles and sound: 'slam', 'land', 'roar', 'shatter', 'seal', 'implode' */
  cues: string[];
  /** world anchor for cue effects */
  cueAt: Object3D;
}

// ------------------------------------------------------------------ shared helpers
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

let rng = 1;
const rnd = (): number => {
  rng = (rng * 16807) % 2147483647;
  return (rng - 1) / 2147483646;
};

/** cracked-stone colour map plus an emissive map where only the cracks glow */
function crackTextures(seed: number, base: string, dark: string, glow: string, density = 22): { map: CanvasTexture; em: CanvasTexture } {
  rng = seed;
  const S = 256;
  const a = document.createElement('canvas');
  const b = document.createElement('canvas');
  a.width = a.height = b.width = b.height = S;
  const g = a.getContext('2d') as CanvasRenderingContext2D;
  const e = b.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() < 0.5 ? dark : 'rgba(255,255,255,0.05)';
    g.globalAlpha = 0.15 + rnd() * 0.25;
    const r = 1 + rnd() * 5;
    g.fillRect(rnd() * S, rnd() * S, r, r);
  }
  g.globalAlpha = 1;
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  for (let k = 0; k < density; k++) {
    let x = rnd() * S;
    let y = rnd() * S;
    let ang = rnd() * Math.PI * 2;
    const steps = 6 + Math.floor(rnd() * 10);
    const w = 0.8 + rnd() * 2.6;
    for (const [ctx, col, lw, blur] of [[g, dark, w + 1.5, 0], [e, glow, w, 8]] as [CanvasRenderingContext2D, string, number, number][]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.shadowColor = col;
      ctx.shadowBlur = blur;
    }
    for (let s = 0; s < steps; s++) {
      const nx = x + Math.cos(ang) * (8 + rnd() * 14);
      const ny = y + Math.sin(ang) * (8 + rnd() * 14);
      for (const ctx of [g, e]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
      x = nx;
      y = ny;
      ang += (rnd() - 0.5) * 1.3;
    }
  }
  const map = new CanvasTexture(a);
  const em = new CanvasTexture(b);
  for (const t of [map, em]) {
    t.wrapS = t.wrapT = RepeatWrapping;
  }
  return { map, em };
}

/** a jagged lightning polyline buffer that is rewritten in place each frame */
class ArcLines {
  readonly obj: LineSegments;
  private pos: Float32Array;
  private segs: number;
  constructor(pairs: number, segs: number, hex: number) {
    this.segs = segs;
    this.pos = new Float32Array(pairs * segs * 2 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    this.obj = new LineSegments(geo, new LineBasicMaterial({ color: hex, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
    this.obj.frustumCulled = false;
  }
  /** pair i from a to b, jitter j */
  set(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, j: number): void {
    const n = this.segs;
    let px = ax;
    let py = ay;
    let pz = az;
    for (let s = 1; s <= n; s++) {
      const k = s / n;
      const amp = s === n ? 0 : j * Math.sin(k * Math.PI);
      const qx = ax + (bx - ax) * k + (Math.random() - 0.5) * amp;
      const qy = ay + (by - ay) * k + (Math.random() - 0.5) * amp;
      const qz = az + (bz - az) * k + (Math.random() - 0.5) * amp;
      const o = (i * n + s - 1) * 6;
      this.pos[o] = px;
      this.pos[o + 1] = py;
      this.pos[o + 2] = pz;
      this.pos[o + 3] = qx;
      this.pos[o + 4] = qy;
      this.pos[o + 5] = qz;
      px = qx;
      py = qy;
      pz = qz;
    }
  }
  commit(): void {
    (this.obj.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}

interface Ctx {
  g: Group;
  mats: MeshStandardMaterial[];
  emitters: Emitter[];
  /** materials that pulse during wind-ups (glowing limbs) */
  teleMats: MeshStandardMaterial[];
}
function emitter(obj: Object3D, hex: number, rate: number, vel: [number, number, number], spread: number, size: number, life: number, grav = 0): Emitter {
  return { obj, hex, rate, vel, spread, size, life, grav, on: true, acc: 0 };
}
function mesh(parent: Object3D, geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial | ShaderMaterial, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function pivot(parent: Object3D, x = 0, y = 0, z = 0): Group {
  const p = new Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}
/** common timing envelopes shared by all three bosses */
class Envelope {
  windW = 0; // 0..1 anticipation weight
  strike = 0; // 1 -> 0 follow-through after release
  strikeKind = '';
  kind = '';
  roar = 0;
  rec = 0; // stagger spring angle
  recV = 0;
  flashT = 0;
  age = 0;
  private prevTele = 0;
  /** returns true on the frame an attack is released */
  step(dt: number, st: RigState): boolean {
    this.age += dt;
    let released = false;
    if (st.tele > 0) {
      this.kind = st.kind ?? this.kind;
      const dur = Math.max(0.2, st.teleDur ?? 1);
      const target = ease(1 - st.tele / dur);
      this.windW += (target - this.windW) * Math.min(1, dt * 14);
    } else {
      if (this.prevTele > 0 && !st.dead) {
        this.strike = 1;
        this.strikeKind = this.kind;
        released = true;
      }
      this.windW += (0 - this.windW) * Math.min(1, dt * 16);
    }
    this.prevTele = st.tele;
    this.strike = Math.max(0, this.strike - dt * 2.2);
    const rt = (st.trans ?? 0) > 0 ? 1 : 0;
    this.roar += (rt - this.roar) * Math.min(1, dt * (rt ? 5 : 2.5));
    this.recV += (-this.rec * 70 - this.recV * 10) * dt;
    this.rec += this.recV * dt;
    this.flashT = Math.max(0, this.flashT - dt);
    return released;
  }
  hit(a: number): void {
    this.recV += 2.2 * Math.max(0.15, Math.min(1, a));
    this.flashT = 0.16;
  }
}

function finishBoss(c: Ctx, env: Envelope, cueAt: Object3D, cues: string[], tick: (dt: number, t: number, st: RigState, released: boolean) => void): BossRig {
  const base = c.mats.map((m) => m.emissiveIntensity);
  const tm = new Set(c.teleMats);
  return {
    group: c.g,
    mats: c.mats,
    emitters: c.emitters,
    cues,
    cueAt,
    flash: (a = 0.4) => env.hit(a),
    tick: (dt, t, st) => {
      const rel = env.step(dt, st);
      const fl = env.flashT > 0 ? 1.6 * (env.flashT / 0.16) : 0;
      const tele = env.windW;
      for (let i = 0; i < c.mats.length; i++) {
        const m = c.mats[i];
        m.emissiveIntensity = base[i] + fl + (tm.has(m) ? tele * (1.6 + Math.sin(t * 24) * 0.6) : 0);
      }
      tick(dt, t, st, rel);
    },
  };
}

// ================================================================== IGNAR, the Ashen Titan
// A hunched forge-golem: chimney shoulders, caged molten heart, anvil fists on chains he broke.
function buildIgnar(def: BossDef): BossRig {
  const g = new Group();
  const c: Ctx = { g, mats: [], emitters: [], teleMats: [] };
  const M = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], tele = false): MeshStandardMaterial => {
    const m = new MeshStandardMaterial(o);
    c.mats.push(m);
    if (tele) c.teleMats.push(m);
    return m;
  };
  const rt = crackTextures(7, '#2a1c18', '#0e0806', '#ff7a1a', 26);
  rt.map.repeat.set(2, 2);
  rt.em.repeat.set(2, 2);
  const rock = M({ color: 0x8a6a5c, map: rt.map, emissive: 0xff5a10, emissiveMap: rt.em, emissiveIntensity: 0.9, roughness: 0.92, metalness: 0.05, flatShading: true });
  const rockArm = M({ color: 0x8a6a5c, map: rt.map, emissive: 0xff6a18, emissiveMap: rt.em, emissiveIntensity: 0.7, roughness: 0.9, metalness: 0.05, flatShading: true }, true);
  const obsidian = M({ color: 0x14121a, emissive: 0x3a1a10, emissiveIntensity: 0.2, roughness: 0.22, metalness: 0.55, flatShading: true });
  const iron = M({ color: 0x3a3436, emissive: 0x200800, emissiveIntensity: 0.15, roughness: 0.55, metalness: 0.85 });
  const heartM = M({ color: 0xffe0a0, emissive: 0xff8a20, emissiveIntensity: 3.2, roughness: 0.3, metalness: 0 });
  const visor = M({ color: 0xffd080, emissive: 0xffa040, emissiveIntensity: 3, roughness: 0.2 }, true);

  const lavaM = M({ color: 0xff9a40, emissive: 0xff6a10, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 });
  const hornM = M({ color: 0x1a0e0c, emissive: 0xff4a10, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.3, flatShading: true });

  const body = pivot(g, 0, 0, 0);
  // legs: short thick columns with splayed feet
  const legs: Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = pivot(body, sx * 0.17, 0.34, -0.02);
    mesh(hip, new CylinderGeometry(0.1, 0.13, 0.3, 7), rock, 0, -0.15, 0);
    mesh(hip, new BoxGeometry(0.2, 0.08, 0.26), obsidian, 0, -0.3, 0.04);
    mesh(hip, new BoxGeometry(0.16, 0.08, 0.14), obsidian, 0, -0.06, 0.1);
    for (let k = 0; k < 3; k++) mesh(hip, new ConeGeometry(0.02, 0.09, 4), lavaM, (k - 1) * 0.06, -0.3, 0.17).rotation.x = Math.PI / 2;
    legs.push(hip);
  }
  mesh(body, new DodecahedronGeometry(0.2, 0), rock, 0, 0.38, 0).scale.set(1.4, 0.7, 1);
  // torso hunched forward
  const chest = pivot(body, 0, 0.46, 0);
  chest.rotation.x = 0.28;
  const torso = mesh(chest, new DodecahedronGeometry(0.34, 1), rock, 0, 0.24, 0);
  torso.scale.set(1.25, 1.0, 0.86);
  // the caged heart: a molten core behind iron ribs that break away when the core is exposed
  const heart = mesh(chest, new IcosahedronGeometry(0.11, 2), heartM, 0, 0.24, 0.24);
  const heartGlow = glowSprite(0xff8a20, 0.7, 0.75);
  heartGlow.position.set(0, 0.24, 0.3);
  chest.add(heartGlow);
  const ribs: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const r = mesh(chest, new BoxGeometry(0.34 - Math.abs(i - 1.5) * 0.05, 0.028, 0.05), iron, 0, 0.12 + i * 0.075, 0.31 - Math.abs(i - 1.5) * 0.015);
    ribs.push(r);
  }
  // obsidian armour slabs (phase 3, breaks only to ice)
  const plates: Mesh[] = [];
  for (const [x, y, z, ry, s] of [[-0.22, 0.32, 0.22, 0.5, 1], [0.22, 0.32, 0.22, -0.5, 1], [0, 0.44, 0.26, 0, 1.2], [-0.3, 0.16, 0.16, 0.8, 0.8], [0.3, 0.16, 0.16, -0.8, 0.8]] as number[][]) {
    const p = mesh(chest, new BoxGeometry(0.2 * s, 0.17 * s, 0.05), obsidian, x, y, z);
    p.rotation.y = ry;
    p.userData.home = [x, y, z];
    plates.push(p);
  }
  // head sunk between the shoulders, visor slit, swept obsidian crest
  const head = pivot(chest, 0, 0.5, 0.1);
  mesh(head, new DodecahedronGeometry(0.12, 0), rock, 0, 0, 0).scale.set(1.15, 0.9, 1);
  mesh(head, new BoxGeometry(0.17, 0.022, 0.03), visor, 0, 0.0, 0.11);
  const jaw = mesh(head, new BoxGeometry(0.15, 0.05, 0.1), obsidian, 0, -0.08, 0.04);
  for (let i = 0; i < 3; i++) {
    const s = mesh(head, new ConeGeometry(0.035, 0.26 - i * 0.04, 5), obsidian, (i - 1) * 0.06, 0.1, -0.04);
    s.rotation.x = -1.0;
    s.rotation.z = (i - 1) * -0.35;
  }
  // menacing face: glowing eyes, curved horns with hot tips, a lava-lit maw of teeth
  for (const sx of [-1, 1]) {
    mesh(head, new SphereGeometry(0.022, 8, 6), visor, sx * 0.055, 0.03, 0.105);
    for (let j = 0; j < 3; j++) {
      const h = mesh(head, new ConeGeometry(0.04 - j * 0.009, 0.16, 6), j === 2 ? lavaM : hornM, sx * (0.1 + j * 0.05), 0.07 + j * 0.1, -0.02 - j * 0.05);
      h.rotation.set(-0.3 - j * 0.35, 0, -sx * (0.7 + j * 0.3));
    }
  }
  mesh(head, new BoxGeometry(0.12, 0.02, 0.07), lavaM, 0, -0.065, 0.07);
  for (let i = 0; i < 5; i++) {
    const tu = mesh(head, new ConeGeometry(0.012, 0.05, 4), obsidian, -0.05 + i * 0.025, -0.045, 0.1);
    tu.rotation.x = Math.PI;
    const td = mesh(jaw, new ConeGeometry(0.012, 0.045, 4), obsidian, -0.05 + i * 0.025, 0.04, 0.04);
    void td;
  }
  // spine ridge and molten veins wrapped around the torso
  for (let i = 0; i < 7; i++) {
    const sp = mesh(chest, new ConeGeometry(0.05 - i * 0.004, 0.2 - i * 0.012, 5), obsidian, 0, 0.5 - i * 0.07, -0.24 - i * 0.005);
    sp.rotation.x = -0.9;
  }
  for (let i = 0; i < 6; i++) {
    const vein = mesh(chest, new TorusGeometry(0.29 + (i % 2) * 0.02, 0.008, 5, 20, Math.PI * 0.6), lavaM, 0, 0.14 + i * 0.07, 0.02);
    vein.rotation.set(0.1, i * 0.55 - 1.4, 0.15);
  }
  // broken forge-wheel on the back: a half ring of spikes that frames the silhouette
  const wheel = pivot(chest, 0, 0.36, -0.22);
  mesh(wheel, new TorusGeometry(0.46, 0.035, 6, 24, Math.PI * 1.25), iron, 0, 0, 0).rotation.z = -Math.PI * 0.12;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.12 + (i / 8) * Math.PI * 1.25;
    const s = mesh(wheel, new ConeGeometry(0.035, 0.18 + (i % 2) * 0.08, 5), obsidian, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
    s.rotation.z = a - Math.PI / 2;
  }
  // shoulders with chimney stacks venting embers
  const shoulders: Group[] = [];
  const arms: { sh: Group; el: Group; fist: Mesh; fistGlow: ReturnType<typeof glowSprite> }[] = [];
  for (const sx of [-1, 1]) {
    const sh = pivot(chest, sx * 0.42, 0.42, 0);
    mesh(sh, new DodecahedronGeometry(0.2, 0), rock, 0, 0.04, 0).scale.set(1, 0.85, 1);
    const chim = mesh(sh, new CylinderGeometry(0.05, 0.07, 0.3, 7, 1, true), iron, sx * 0.04, 0.24, -0.06);
    chim.rotation.z = -sx * 0.25;
    chim.rotation.x = -0.25;
    (chim.material as MeshStandardMaterial).side = DoubleSide;
    for (let k = 0; k < 3; k++) {
      const pl = mesh(sh, new DodecahedronGeometry(0.16 - k * 0.03, 0), obsidian, sx * (0.05 + k * 0.03), 0.1 + k * 0.05, 0.02);
      pl.scale.set(1.2, 0.35, 1);
      pl.rotation.z = -sx * (0.25 + k * 0.1);
    }
    for (let k = 0; k < 3; k++) {
      const sp = mesh(sh, new ConeGeometry(0.03, 0.16, 5), hornM, sx * (0.18 + k * 0.02), 0.06 + k * 0.05, 0.06 - k * 0.06);
      sp.rotation.z = -sx * 1.2;
    }
    const tip = pivot(sh, sx * 0.08, 0.4, -0.1);
    const flame = glowSprite(0xff7a20, 0.32, 0.8);
    tip.add(flame);
    c.emitters.push(emitter(tip, 0xff8a30, 18, [0, 1.6, -0.2], 0.25, 0.08, 0.9, -0.3));
    shoulders.push(sh);
    // arm chain: shoulder pivot -> upper arm -> elbow pivot -> forearm -> anvil fist
    const arm = pivot(sh, sx * 0.04, -0.02, 0.02);
    mesh(arm, new CylinderGeometry(0.075, 0.09, 0.3, 7), rockArm, 0, -0.17, 0);
    const el = pivot(arm, 0, -0.33, 0);
    mesh(el, new CylinderGeometry(0.1, 0.125, 0.28, 7), rockArm, 0, -0.14, 0);
    const fist = mesh(el, new DodecahedronGeometry(0.135, 0), rockArm, 0, -0.32, 0.02);
    fist.scale.set(1.15, 0.85, 1.05);
    mesh(el, new BoxGeometry(0.22, 0.04, 0.2), obsidian, 0, -0.24, 0.02);
    mesh(el, new BoxGeometry(0.17, 0.12, 0.17), obsidian, 0, -0.1, 0.02).rotation.y = 0.4;
    for (let k = 0; k < 4; k++) {
      const kn = mesh(el, new ConeGeometry(0.025, 0.09, 5), lavaM, -0.09 + k * 0.06, -0.38, 0.1);
      kn.rotation.x = Math.PI * 0.6;
    }
    mesh(arm, new TorusGeometry(0.1, 0.012, 5, 14), lavaM, 0, -0.08, 0).rotation.x = Math.PI / 2;
    // broken chain hanging from the wrist
    for (let k = 0; k < 4; k++) {
      const link = mesh(el, new TorusGeometry(0.03, 0.009, 5, 10), iron, sx * 0.1, -0.2 - k * 0.045, 0.05);
      link.rotation.y = k % 2 ? Math.PI / 2 : 0;
    }
    const fistGlow = glowSprite(0xff6a10, 0.5, 0);
    fistGlow.position.set(0, -0.32, 0.05);
    el.add(fistGlow);
    c.emitters.push(emitter(fist, 0xffa040, 0, [0, 0.6, 0], 0.3, 0.06, 0.5, -0.5));
    arm.rotation.set(0.35, 0, sx * 0.12);
    el.rotation.x = -0.4;
    arms.push({ sh: arm, el, fist, fistGlow });
  }
  const heartEm = emitter(heart, 0xffd080, 0, [0, 0.8, 0.6], 0.4, 0.06, 0.6, 0);
  c.emitters.push(heartEm);
  const cues: string[] = [];
  const env = new Envelope();
  let lastPhase = -1;
  let slamDone = false;
  return finishBoss(c, env, heart, cues, (dt, t, st, released) => {
    const ph = st.phase ?? 0;
    const hp = clamp01(st.hpFrac);
    const dk = st.dead ? ease((st.deathK ?? 0) * 1.1) : 0;
    if (ph !== lastPhase) {
      if (lastPhase >= 0) cues.push('roar');
      lastPhase = ph;
    }
    // entrance: bursts up out of the lava over 1.8 s, then a landing slam
    const ent = ease(env.age / 1.8);
    body.position.y = -0.9 * (1 - ent) - 0.45 * dk;
    if (env.age > 1.8 && env.age - dt <= 1.8) cues.push('slam');
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;
    torso.scale.set(1.25 + breath * 0.03, 1.0 + breath * 0.04, 0.86);
    chest.rotation.x = 0.28 + breath * 0.03 - env.rec * 0.5 - env.roar * 0.35 + dk * 0.6;
    // the heart pulses faster as he is hurt; exposed core phases (3+) make it huge
    const exposed = ph >= 3;
    const hs = (1 + Math.sin(t * (3 + (1 - hp) * 6)) * 0.08) * (exposed ? 1.35 : 1) * (1 - dk);
    heart.scale.setScalar(Math.max(0.01, hs));
    heartGlow.scale.setScalar((0.45 + (exposed ? 0.25 : 0) + env.windW * 0.25) * (1 - dk));
    heartM.emissiveIntensity += exposed ? 1.5 : 0;
    ribs.forEach((r, i) => (r.visible = !(exposed && (i === 1 || i === 2)) && !(ph >= 4 && i === 0)));
    heartEm.rate = exposed ? 14 : 0;
    // damage state: cracks widen and glow hotter as health falls, then cool to black in death
    const crackGlow = (0.7 + (1 - hp) * 2.2) * (dk > 0 ? Math.max(0, 1 - dk * 1.4) + (dk < 0.3 ? 2 : 0) : 1);
    rock.emissiveIntensity += crackGlow - 0.9;
    rockArm.emissiveIntensity += crackGlow * 0.8 - 0.7;
    // armour slabs: on while the phase has armour; when it breaks they drop away
    for (const p of plates) {
      const home = p.userData.home as number[];
      if (st.armor) {
        p.visible = true;
        p.position.set(home[0], home[1], home[2]);
        p.userData.fall = 0;
      } else if (p.visible) {
        const f = (p.userData.fall = (p.userData.fall as number) + dt);
        p.position.y = home[1] - f * f * 2.2;
        p.position.z = home[2] + f * 0.4;
        p.rotation.x += dt * 3;
        if (f > 0.9) p.visible = false;
      }
    }
    // arms: rest = gorilla stance with fists near the ground
    const sway = Math.sin(t * 1.1) * 0.06;
    const kind = env.kind;
    const w = env.windW;
    const s = env.strike;
    let rx0 = 0.35 + sway;
    let rx1 = 0.35 - sway;
    let rz = 0.12 + env.roar * 0.9;
    let elb = -0.4;
    if (kind === 'fireball' || env.strikeKind === 'fireball') {
      rx1 = lerp(rx1, -2.0, w) + s * 1.9;
      elb = lerp(-0.4, -1.4, w);
    } else if (kind === 'shockwave' || env.strikeKind === 'shockwave') {
      const up = lerp(0, -2.9, w);
      rx0 += up + s * 0.5;
      rx1 += up + s * 0.5;
      chest.rotation.x += -w * 0.35 + s * 0.4;
      if (s > 0.85 && !slamDone) {
        slamDone = true;
        cues.push('slam');
      }
    }
    if (s <= 0) slamDone = false;
    rz -= dk * 0.3;
    arms[0].sh.rotation.set(rx0 + dk * 0.8, 0, -rz);
    arms[1].sh.rotation.set(rx1 + dk * 0.8, 0, rz);
    arms[0].el.rotation.x = elb * (kind === 'fireball' ? 0.5 : 1);
    arms[1].el.rotation.x = elb;
    const fireHand = kind === 'fireball' ? 1 : kind === 'shockwave' ? 2 : 0;
    arms.forEach((a, i) => {
      const lit = fireHand === 2 || (fireHand === 1 && i === 1) ? w : 0;
      a.fistGlow.material.opacity = lit * 0.9 + s * 0.3;
      a.fistGlow.scale.setScalar(0.4 + lit * 0.5);
      c.emitters[1 + i * 2].rate = lit * 40;
    });
    // head tracks slowly, roars back during a phase change, jaw drops when winding up
    head.rotation.y = Math.sin(t * 0.45) * 0.25;
    head.rotation.x = -env.roar * 0.6 + w * 0.15 - dk * 0.4;
    jaw.position.y = -0.08 - (env.roar + w) * 0.035;
    legs[0].rotation.x = Math.sin(t * 0.8) * 0.03;
    legs[1].rotation.x = -Math.sin(t * 0.8) * 0.03;
    // chimneys roar hotter by phase
    c.emitters[0].rate = c.emitters[2].rate = (12 + ph * 8 + env.roar * 40) * (1 - dk);
    wheel.rotation.z = Math.sin(t * 0.3) * 0.05;
    if (released) cues.push(kind === 'shockwave' ? 'release-slam' : 'release');
    void def;
  });
}

// ================================================================== VYRA, the Storm Empress
// A floating empress whose legs are a storm funnel, with a fan of crystal-blade wings and a crown of spires.
function buildVyra(def: BossDef): BossRig {
  const g = new Group();
  const c: Ctx = { g, mats: [], emitters: [], teleMats: [] };
  const M = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], tele = false): MeshStandardMaterial => {
    const m = new MeshStandardMaterial(o);
    c.mats.push(m);
    if (tele) c.teleMats.push(m);
    return m;
  };
  const silk = M({ color: 0x1a2050, emissive: 0x3a4ac0, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.3, side: DoubleSide });
  const plate = M({ color: 0x5a6698, emissive: 0x2a3a90, emissiveIntensity: 0.35, roughness: 0.32, metalness: 0.75 });
  const crystal = M({ color: 0xaabaff, emissive: 0x5a78ff, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.88, flatShading: true }, true);
  const spireM = M({ color: 0xe8ecff, emissive: 0xa9b8ff, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.5 }, true);
  const maskM = M({ color: 0xb8c4f0, emissive: 0x8a9cff, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.5 });

  const body = pivot(g, 0, 0.12, 0);
  // the storm funnel: a lathe that narrows to a point, wrapped in spinning ribbons
  const fpts: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const k = i / 12;
    fpts.push(new Vector2(0.015 + Math.pow(k, 1.6) * 0.2, k * 0.6));
  }
  const funnel = mesh(body, new LatheGeometry(fpts, 18), silk, 0, 0, 0);
  const ribbons: Mesh[] = [];
  const ribMat = new MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  for (let r = 0; r < 3; r++) {
    const geo = new PlaneGeometry(0.05, 0.75, 1, 24);
    const p = geo.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.375;
      const k = y / 0.75;
      const rad = 0.03 + Math.pow(k, 1.4) * 0.24;
      const a = k * Math.PI * 3 + (r / 3) * Math.PI * 2;
      const off = p.getX(i);
      p.setXYZ(i, Math.cos(a) * (rad + off), y - 0.05, Math.sin(a) * (rad + off));
    }
    geo.computeVertexNormals();
    const m = mesh(body, geo, ribMat, 0, 0, 0);
    ribbons.push(m);
  }
  // torso and pauldrons
  const tpts = [new Vector2(0.2, 0), new Vector2(0.14, 0.08), new Vector2(0.1, 0.18), new Vector2(0.13, 0.28), new Vector2(0.11, 0.34), new Vector2(0.05, 0.38)];
  const torso = pivot(body, 0, 0.58, 0);
  mesh(torso, new LatheGeometry(tpts, 14), plate, 0, 0, 0);
  for (const sx of [-1, 1]) {
    const pa = mesh(torso, new SphereGeometry(0.075, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), plate, sx * 0.13, 0.3, 0);
    pa.rotation.z = -sx * 0.6;
  }
  // head: a smooth mask with two burning eyes, a halo and a fan crown of seven spires
  const head = pivot(torso, 0, 0.45, 0);
  mesh(head, new SphereGeometry(0.075, 14, 12), plate, 0, 0, 0).scale.set(0.9, 1.15, 0.95);
  mesh(head, new SphereGeometry(0.068, 14, 12, -Math.PI / 2, Math.PI, 0.3, 2.2), maskM, 0, -0.005, 0.012).scale.set(0.95, 1.12, 1);
  for (const sx of [-1, 1]) mesh(head, new SphereGeometry(0.012, 6, 6), new MeshBasicMaterial({ color: 0xffffff }), sx * 0.026, 0.012, 0.072);
  const halo = mesh(head, new TorusGeometry(0.17, 0.008, 6, 48), new MeshBasicMaterial({ color: 0xc3ceff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }), 0, 0.06, -0.08);
  const spires: Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) / 3) * 1.25;
    const len = 0.22 + (3 - Math.abs(i - 3)) * 0.05;
    const s = mesh(head, new ConeGeometry(0.014, len, 5), spireM, Math.sin(a) * 0.09, 0.05 + Math.cos(a) * 0.09, -0.05);
    s.rotation.z = -a;
    s.rotation.x = -0.3;
    s.translateY(len * 0.5);
    s.userData.len = len;
    spires.push(s);
  }
  const arcs = new ArcLines(8, 6, 0xe8ecff);
  g.add(arcs.obj);
  // wings: two fans of six crystal blades each; spread is animated
  const wings: { pv: Group; blades: Mesh[] }[] = [];
  for (const sx of [-1, 1]) {
    const pv = pivot(torso, sx * 0.08, 0.26, -0.08);
    const blades: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const bl = new Mesh(new OctahedronGeometry(0.05, 0), crystal);
      bl.scale.set(0.5, 0.42 - i * 0.03 + (i === 0 ? 0.1 : 0), 4.2 - i * 0.35);
      const holder = pivot(pv, 0, 0, 0);
      holder.add(bl);
      bl.position.set(0, 0, -0.16 - (4.2 - i * 0.35) * 0.035);
      bl.userData.holder = holder;
      blades.push(bl);
    }
    wings.push({ pv, blades });
  }
  // arms: the right hand carries a storm sceptre with a floating trident head
  const arms: Group[] = [];
  for (const sx of [-1, 1]) {
    const sh = pivot(torso, sx * 0.15, 0.28, 0.01);
    mesh(sh, new CylinderGeometry(0.02, 0.025, 0.22, 6), plate, 0, -0.11, 0);
    const el = pivot(sh, 0, -0.22, 0);
    el.name = 'el';
    mesh(el, new CylinderGeometry(0.016, 0.02, 0.2, 6), plate, 0, -0.1, 0);
    mesh(el, new SphereGeometry(0.026, 8, 6), maskM, 0, -0.21, 0);
    sh.rotation.set(0.1, 0, sx * 0.35);
    el.rotation.x = -0.6;
    arms.push(sh);
  }
  const sceptre = pivot(arms[1].getObjectByName('el') as Object3D, 0, -0.21, 0.02);
  mesh(sceptre, new CylinderGeometry(0.008, 0.008, 0.62, 6), plate, 0, 0.12, 0);
  const tri = pivot(sceptre, 0, 0.47, 0);
  for (let i = 0; i < 3; i++) {
    const p = mesh(tri, new ConeGeometry(0.014, 0.12 - Math.abs(i - 1) * 0.03, 5), spireM, (i - 1) * 0.035, 0.03, 0);
    p.rotation.z = -(i - 1) * 0.35;
  }
  const tipGlow = glowSprite(0xc3ceff, 0.3, 0.7);
  tri.add(tipGlow);
  c.emitters.push(emitter(tri, 0xe8ecff, 6, [0, 0.4, 0], 0.4, 0.04, 0.3, 0));
  c.emitters.push(emitter(funnel, 0x9fb4ff, 22, [0, -0.6, 0], 0.5, 0.05, 0.9, 0));
  // three storm orbs orbit her
  const orbs: Mesh[] = [];
  for (let i = 0; i < 3; i++) orbs.push(mesh(g, new SphereGeometry(0.04, 8, 8), new MeshBasicMaterial({ color: 0xe8ecff }), 0, 0, 0));
  const orbGlows = orbs.map((o) => {
    const s = glowSprite(0xa9b8ff, 0.22, 0.8);
    o.add(s);
    return s;
  });
  const cues: string[] = [];
  const env = new Envelope();
  let lostBlades = 0;
  let lastPhase = -1;
  const tmp = new Float32Array(6);
  const tipWorld = (m: Mesh, out: Float32Array, o: number): void => {
    // spire tip in the rig's local space (rig root has identity scale inside the holder)
    m.updateWorldMatrix(true, false);
    const e = m.matrixWorld.elements;
    const len = m.userData.len as number;
    // the cone's local +Y tip at len/2
    const x = e[12] + e[4] * len * 0.5;
    const y = e[13] + e[5] * len * 0.5;
    const z = e[14] + e[6] * len * 0.5;
    g.updateWorldMatrix(true, false);
    const gi = g.matrixWorld.elements;
    // inverse of a uniform scale + rotation about Y + translation
    const sx = Math.hypot(gi[0], gi[1], gi[2]) || 1;
    const dx = x - gi[12];
    const dy = y - gi[13];
    const dz = z - gi[14];
    out[o] = (dx * gi[0] + dy * gi[1] + dz * gi[2]) / (sx * sx);
    out[o + 1] = (dx * gi[4] + dy * gi[5] + dz * gi[6]) / (sx * sx);
    out[o + 2] = (dx * gi[8] + dy * gi[9] + dz * gi[10]) / (sx * sx);
  };
  return finishBoss(c, env, torso, cues, (dt, t, st, released) => {
    const ph = st.phase ?? 0;
    const hp = clamp01(st.hpFrac);
    const dk = st.dead ? ease((st.deathK ?? 0) * 1.15) : 0;
    if (ph !== lastPhase) {
      if (lastPhase >= 0) cues.push('roar');
      lastPhase = ph;
    }
    // entrance: she descends from the storm over 2 s and lands with a strike of lightning
    const ent = ease(env.age / 2);
    body.position.y = 0.12 + 1.6 * (1 - ent) + Math.sin(t * 1.4) * 0.03 - dk * 0.55;
    if (env.age > 2 && env.age - dt <= 2) cues.push('land');
    ribbons.forEach((r, i) => (r.rotation.y += dt * (2.2 + i * 0.6 + (1 - hp) * 2)));
    funnel.rotation.y -= dt * 1.5;
    halo.rotation.z += dt * 0.9;
    const w = env.windW;
    const s = env.strike;
    const k = env.kind;
    // wing spread: breathing at rest, snap wide for the fan, fold forward to guard the barrier
    let spread = 0.55 + Math.sin(t * 1.3) * 0.08;
    if (k === 'fan') spread = lerp(spread, 1.35, w) + s * 0.2;
    if (k === 'rain') spread = lerp(spread, 1.0, w);
    if (st.barrier) spread = 0.15;
    spread += env.roar * 0.7;
    // lost blades: one per side breaks away at 60 %, 38 % and 18 % health
    const lose = hp < 0.18 ? 3 : hp < 0.38 ? 2 : hp < 0.6 ? 1 : 0;
    if (lose > lostBlades) {
      lostBlades = lose;
      cues.push('shatter');
    }
    wings.forEach((wg, wi) => {
      const sx = wi ? 1 : -1;
      wg.pv.rotation.y = sx * (0.25 + spread * 0.2) - env.rec * 0.4 * sx;
      wg.blades.forEach((b, i) => {
        const h = b.userData.holder as Group;
        const gone = i >= 6 - lostBlades;
        if (dk > 0 || gone) {
          // falling shards
          b.position.y -= dt * (gone ? 1.6 : 2.4);
          b.rotation.x += dt * 4;
          b.visible = b.position.y > -2.5;
          return;
        }
        h.rotation.z = sx * (0.45 + i * spread * 0.32);
        h.rotation.x = -0.25 + Math.sin(t * 2 + i * 0.4) * 0.04;
      });
    });
    // arms and sceptre: raise for a bolt, thrust on release; both arms up for rain; crossed for the barrier
    let rxR = 0.1;
    let rzR = 0.35;
    let rxL = 0.1;
    let rzL = -0.35;
    if (k === 'bolt' || env.strikeKind === 'bolt') {
      rxR = lerp(rxR, -2.6, w) + s * 1.8;
    }
    if (k === 'rain') {
      rxR = rxL = lerp(0.1, -2.8, w);
    }
    if (k === 'fan') {
      rzR = lerp(rzR, 1.3, w);
      rzL = lerp(rzL, -1.3, w);
    }
    if (st.barrier) {
      rzR = -0.5;
      rzL = 0.5;
      rxR = rxL = -0.6;
    }
    arms[1].rotation.set(rxR + dk, 0, rzR + env.roar * 0.8);
    arms[0].rotation.set(rxL + dk, 0, rzL - env.roar * 0.8);
    torso.rotation.x = -env.rec * 0.6 - env.roar * 0.25 + dk * 0.9;
    head.rotation.x = -env.roar * 0.4 + dk * 0.4;
    tipGlow.scale.setScalar(0.25 + w * 0.7 + s * 0.4);
    c.emitters[0].rate = 6 + w * 60;
    c.emitters[1].rate = (22 + ph * 6) * (1 - dk);
    // crown lightning: arcs crackle between spires while winding up, constantly in late phases
    const crackle = Math.max(w, ph >= 3 ? 0.35 : 0, env.roar);
    arcs.obj.visible = crackle > 0.05 && dk === 0;
    if (arcs.obj.visible) {
      for (let i = 0; i < 6; i++) {
        tipWorld(spires[i], tmp, 0);
        tipWorld(spires[i + 1], tmp, 3);
        arcs.set(i, tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], tmp[5], 0.05);
      }
      // a bolt from the crown into the sceptre tip during a bolt wind-up
      tipWorld(spires[3], tmp, 0);
      tri.updateWorldMatrix(true, false);
      const te = tri.matrixWorld.elements;
      g.updateWorldMatrix(true, false);
      const gi = g.matrixWorld.elements;
      const ss = gi[0] * gi[0] + gi[1] * gi[1] + gi[2] * gi[2] || 1;
      const dx = te[12] - gi[12];
      const dy = te[13] - gi[13];
      const dz = te[14] - gi[14];
      arcs.set(6, tmp[0], tmp[1], tmp[2], (dx * gi[0] + dy * gi[1] + dz * gi[2]) / ss, (dx * gi[4] + dy * gi[5] + dz * gi[6]) / ss, (dx * gi[8] + dy * gi[9] + dz * gi[10]) / ss, k === 'bolt' ? 0.12 * w : 0);
      arcs.set(7, tmp[0], tmp[1], tmp[2], tmp[0], tmp[1] + 0.3 * crackle, tmp[2], 0.06);
      arcs.commit();
      (arcs.obj.material as LineBasicMaterial).opacity = 0.4 + crackle * 0.6;
    }
    orbs.forEach((o, i) => {
      const a = t * 1.6 + i * 2.1;
      const rr2 = 0.42 + (k === 'rain' ? w * 0.1 : 0);
      o.position.set(Math.cos(a) * rr2, 0.7 + Math.sin(t * 2 + i) * 0.08 + (k === 'rain' ? w * 0.6 : 0) + body.position.y - 0.12, Math.sin(a) * rr2);
      o.visible = dk < 0.5;
      orbGlows[i].scale.setScalar(0.18 + w * 0.15);
    });
    funnel.scale.setScalar(Math.max(0.01, 1 - dk));
    if (released) cues.push('release');
    void def;
  });
}

// ================================================================== THE VOID KING
// A robed colossus with a starfield where his face should be, detached clawed hands,
// a broken crown of floating shards and seven seal rings that break one by one.
function buildVoidKing(def: BossDef): BossRig {
  const g = new Group();
  const c: Ctx = { g, mats: [], emitters: [], teleMats: [] };
  const M = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], tele = false): MeshStandardMaterial => {
    const m = new MeshStandardMaterial(o);
    c.mats.push(m);
    if (tele) c.teleMats.push(m);
    return m;
  };
  // tattered robe: lathe with a jagged alpha hem and a slow wave in the lower cloth
  const hc = document.createElement('canvas');
  hc.width = 256;
  hc.height = 128;
  const hg = hc.getContext('2d') as CanvasRenderingContext2D;
  hg.fillStyle = '#fff';
  hg.fillRect(0, 0, 256, 128);
  hg.fillStyle = '#000';
  hg.beginPath();
  hg.moveTo(0, 128);
  rng = 3;
  for (let x = 0; x <= 256; x += 8) hg.lineTo(x, 128 - (6 + rnd() * 26 + (x % 32 === 0 ? 14 : 0)));
  hg.lineTo(256, 128);
  hg.closePath();
  hg.fill();
  const hem = new CanvasTexture(hc);
  hem.wrapS = RepeatWrapping;
  hem.repeat.set(3, 1);
  const robeM = M({ color: 0x120a1c, emissive: 0x2a0a4a, emissiveIntensity: 0.35, roughness: 0.95, metalness: 0, side: DoubleSide, alphaMap: hem, alphaTest: 0.5 });
  const uT = { value: 0 };
  robeM.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float lowW = 1.0 - smoothstep(0.0, 0.45, position.y);\n transformed.x += sin(uT * 1.7 + position.y * 9.0 + atan(position.z, position.x) * 5.0) * 0.035 * lowW;\n transformed.z += cos(uT * 1.3 + position.y * 7.0 + atan(position.z, position.x) * 4.0) * 0.03 * lowW;');
  };
  const trim = M({ color: 0x2a1a3a, emissive: 0x9a5aff, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.7 }, true);
  const claw = M({ color: 0x0c0812, emissive: 0x6a2ad0, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.6, flatShading: true }, true);
  const shard = M({ color: 0x0a0610, emissive: 0x7a3acb, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.7, flatShading: true });

  const body = pivot(g, 0, 0, 0);
  const rpts: Vector2[] = [];
  const prof: [number, number][] = [[0.37, 0], [0.33, 0.1], [0.26, 0.3], [0.2, 0.5], [0.185, 0.64], [0.22, 0.76], [0.2, 0.84], [0.1, 0.9]];
  for (const [r, y] of prof) rpts.push(new Vector2(r, y));
  const robe = mesh(body, new LatheGeometry(rpts, 28), robeM, 0, 0, 0);
  // gilded trim bands and a shoulder mantle of spikes
  mesh(body, new TorusGeometry(0.235, 0.012, 6, 32), trim, 0, 0.74, 0).rotation.x = Math.PI / 2;
  mesh(body, new TorusGeometry(0.32, 0.01, 6, 36), trim, 0, 0.3, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (Math.sin(a) > 0.6) continue; // keep the front open
    const s = mesh(body, new ConeGeometry(0.03, 0.2, 5), shard, Math.cos(a) * 0.25, 0.82, Math.sin(a) * 0.25);
    s.rotation.z = -Math.cos(a) * 0.9;
    s.rotation.x = Math.sin(a) * 0.9;
  }
  // hood with a peak, and the void face: a starfield shader that cracks with aether light in the finale
  const head = pivot(body, 0, 0.98, 0.02);
  const hood = mesh(head, new SphereGeometry(0.16, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), robeM, 0, 0, 0);
  hood.rotation.x = 0.35;
  mesh(head, new ConeGeometry(0.1, 0.18, 10), robeM, 0, 0.17, -0.06).rotation.x = -0.4;
  const faceU = { uT: { value: 0 }, uCrack: { value: 0 }, uHot: { value: 0 }, uCol: { value: new Color(0x9a5aff) } };
  const face = mesh(head, new SphereGeometry(0.125, 20, 14, -Math.PI / 2, Math.PI, 0.25, 2.4), new ShaderMaterial({
    uniforms: faceU,
    vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; varying vec3 vN; uniform float uT; uniform float uCrack; uniform float uHot; uniform vec3 uCol;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main(){
        vec2 q = vP.xy * 60.0 + vec2(uT * 0.6, uT * 0.25);
        vec2 i = floor(q); vec2 f = fract(q) - 0.5;
        float star = step(0.93, h(i)) * smoothstep(0.35, 0.0, length(f)) * (0.6 + 0.4 * sin(uT * 3.0 + h(i) * 40.0));
        float swirl = sin(atan(vP.y, vP.x) * 3.0 + length(vP.xy) * 40.0 - uT * 1.5) * 0.5 + 0.5;
        float rim = pow(1.0 - abs(vN.z), 2.0);
        vec3 col = vec3(0.01, 0.0, 0.03) + uCol * (rim * 0.9 + swirl * 0.06) + vec3(star);
        float cr = abs(sin(vP.x * 70.0 + sin(vP.y * 50.0) * 2.0)) ;
        float crack = smoothstep(0.08, 0.0, cr) * smoothstep(0.12, 0.02, abs(vP.y + vP.x * 0.4));
        col += vec3(1.0, 0.95, 1.0) * crack * uCrack * 2.0;
        col = mix(col, vec3(1.0, 0.92, 1.0), uHot);
        gl_FragColor = vec4(col, 1.0); }`,
  }), 0, -0.01, 0.02);
  face.rotation.x = 0.35;
  const eyes: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const e = mesh(head, new SphereGeometry(0.014, 8, 6), new MeshBasicMaterial({ color: 0xf2e6ff }), sx * 0.04, 0.0, 0.12);
    const eg = glowSprite(0xd0a8ff, 0.12, 0.9);
    e.add(eg);
    eyes.push(e);
  }
  // the broken crown: shards floating in a ring with one gap
  const crown = pivot(head, 0, 0.24, -0.02);
  const shards: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = mesh(crown, new OctahedronGeometry(0.035, 0), shard, Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15);
    s.scale.set(0.6, 2.6 + (i % 3) * 0.6, 0.6);
    s.userData.a = a;
    shards.push(s);
  }
  // detached clawed hands: palm, four long fingers and a thumb, a void wisp at the wrist
  const hands: { g: Group; fingers: Group[]; glow: ReturnType<typeof glowSprite> }[] = [];
  for (const sx of [-1, 1]) {
    const hg2 = pivot(g, sx * 0.58, 0.62, 0.12);
    const palm = mesh(hg2, new BoxGeometry(0.13, 0.04, 0.15), claw, 0, 0, 0);
    palm.rotation.x = 0.1;
    const fingers: Group[] = [];
    for (let f = 0; f < 4; f++) {
      const fp = pivot(hg2, (f - 1.5) * 0.034, 0, 0.075);
      const seg1 = mesh(fp, new CylinderGeometry(0.011, 0.014, 0.08, 5), claw, 0, 0, 0.04);
      seg1.rotation.x = Math.PI / 2;
      const tip = mesh(fp, new ConeGeometry(0.011, 0.09, 5), claw, 0, -0.02, 0.12);
      tip.rotation.x = Math.PI / 2 + 0.6;
      fingers.push(fp);
    }
    const th = pivot(hg2, -sx * 0.07, 0, 0.02);
    mesh(th, new ConeGeometry(0.012, 0.1, 5), claw, -sx * 0.03, 0, 0.04).rotation.set(Math.PI / 2, 0, sx * 0.9);
    const glow = glowSprite(0x9a5aff, 0.32, 0.5);
    glow.position.set(0, 0.06, 0.03);
    hg2.add(glow);
    c.emitters.push(emitter(hg2, 0x7a3acb, 10, [0, 0.15, -0.3], 0.25, 0.05, 0.8, 0));
    hands.push({ g: hg2, fingers, glow });
  }
  // seven seal rings orbiting at different tilts; they break as the phases advance
  const rc = document.createElement('canvas');
  rc.width = 512;
  rc.height = 32;
  const rg = rc.getContext('2d') as CanvasRenderingContext2D;
  rg.fillStyle = 'rgba(0,0,0,0)';
  rg.clearRect(0, 0, 512, 32);
  rg.fillStyle = '#e0c8ff';
  rg.font = '700 24px serif';
  const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒ';
  for (let i = 0; i < 20; i++) rg.fillText(glyphs[i % glyphs.length], i * 25.6 + 3, 24);
  const runeTex = new CanvasTexture(rc);
  runeTex.wrapS = RepeatWrapping;
  runeTex.repeat.set(2, 1);
  const seals: { m: Mesh; ax: number; az: number; sp: number; gone: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const m = mesh(g, new TorusGeometry(0.62 + i * 0.045, 0.012, 4, 64), new MeshBasicMaterial({ map: runeTex, color: 0xb48cff, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }), 0, 0.62, 0);
    seals.push({ m, ax: 0.5 + i * 0.35, az: i * 0.7, sp: 0.15 + i * 0.05, gone: 0 });
  }
  const orb = glowSprite(0x7a3acb, 0.4, 0);
  g.add(orb);
  const cues: string[] = [];
  const env = new Envelope();
  let lastPhase = -1;
  return finishBoss(c, env, head, cues, (dt, t, st, released) => {
    const ph = st.phase ?? 0;
    const hp = clamp01(st.hpFrac);
    const dk = st.dead ? ease((st.deathK ?? 0) * 1.2) : 0;
    uT.value = t;
    faceU.uT.value = t;
    if (ph !== lastPhase) {
      if (lastPhase >= 0) cues.push('seal');
      lastPhase = ph;
    }
    // entrance: he condenses out of the rift over 2.4 s
    const ent = env.age / 2.4;
    const grow = ent >= 1 ? 1 : ease(ent) * (1 + Math.sin(ent * Math.PI) * 0.12);
    body.scale.setScalar(Math.max(0.01, grow * (1 - dk * 0.95)));
    if (env.age > 2.4 && env.age - dt <= 2.4) cues.push('land');
    body.position.y = Math.sin(t * 0.7) * 0.025 + 0.02;
    body.rotation.x = -env.rec * 0.4 - env.roar * 0.15;
    head.rotation.x = -env.roar * 0.3 + Math.sin(t * 0.5) * 0.04;
    head.rotation.y = Math.sin(t * 0.33) * 0.15;
    // crown shards spin faster with rage; the face cracks with aether light in the last phase
    const rage = 1 - hp;
    crown.rotation.y += dt * (0.4 + rage * 1.6);
    shards.forEach((s, i) => (s.position.y = Math.sin(t * 2 + i) * 0.015));
    faceU.uCrack.value = ph >= 5 ? 0.6 + Math.sin(t * 6) * 0.3 : ph >= 4 ? 0.25 : 0;
    faceU.uHot.value = dk > 0.6 ? (dk - 0.6) / 0.4 : 0;
    eyes.forEach((e) => e.scale.setScalar(1 + env.windW * 0.8 + env.roar));
    // seals: one breaks per phase (7 at the start, 2 left in the finale)
    const keep = 7 - ph;
    seals.forEach((s, i) => {
      const alive = i < keep && dk === 0;
      if (!alive && s.m.visible) {
        s.gone += dt;
        s.m.scale.setScalar(1 + s.gone * 2.5);
        (s.m.material as MeshBasicMaterial).opacity = Math.max(0, 0.85 - s.gone * 1.4);
        if (s.gone > 0.65) s.m.visible = false;
        return;
      }
      if (!alive) return;
      const gs = ent < 1 ? 1 + (1 - ease(ent)) * 3 : 1;
      s.m.scale.setScalar(gs);
      s.m.rotation.set(s.ax + Math.sin(t * s.sp) * 0.3, t * s.sp, s.az + t * s.sp * 0.6);
      (s.m.material as MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 2 + i);
    });
    // hands: drift at rest, cup forward to form a shadow orb, sweep for a fan, rise for rain,
    // join in front glowing with the element for an element burst, open palms in the absorption phase
    const w = env.windW;
    const s = env.strike;
    const k = env.kind;
    const absorb = ph === 3;
    for (let i = 0; i < 2; i++) {
      const sx = i ? 1 : -1;
      const h = hands[i];
      let x = sx * 0.58;
      let y = 0.62 + Math.sin(t * 1.1 + i * 2) * 0.04;
      let z = 0.12;
      let rx = 0.3;
      let curl = 0.3 + Math.sin(t * 1.7 + i) * 0.1;
      if (k === 'shadowOrb' && i === 1) {
        x = lerp(x, 0.3, w);
        y = lerp(y, 0.55, w);
        z = lerp(z, 0.42, w) + s * 0.25;
        rx = lerp(rx, -0.6, w);
        curl = lerp(curl, 0.9, w);
      } else if (k === 'fan') {
        x = sx * lerp(0.58, 0.32, w) + sx * s * 0.45;
        z = lerp(0.12, 0.35, w);
        curl = 0.1;
      } else if (k === 'rain') {
        y = lerp(y, 1.2, w);
        rx = lerp(rx, -1.2, w);
        curl = 0.0;
      } else if (k === 'elementBurst') {
        x = lerp(x, sx * 0.1, w);
        y = lerp(y, 0.6, w);
        z = lerp(z, 0.45, w) + s * 0.2;
        rx = lerp(rx, -1.3, w);
        curl = lerp(curl, 0.6, w);
      }
      if (absorb && w < 0.2) {
        z = 0.3;
        rx = -1.4;
        curl = 0.05 + Math.sin(t * 3) * 0.05;
      }
      x *= 1 + env.roar * 0.4;
      y += env.roar * 0.25;
      h.g.position.set(x * (1 - dk), lerp(y, 0.62, dk), z * (1 - dk));
      h.g.rotation.set(rx, -sx * 0.3, sx * env.roar * 0.6);
      h.g.scale.setScalar(Math.max(0.01, 1 - dk));
      for (const f of h.fingers) f.rotation.x = curl * 1.3;
      h.glow.material.color.setHex(k === 'elementBurst' && st.elHex !== undefined ? st.elHex : 0x9a5aff);
      h.glow.scale.setScalar(0.3 + w * 0.5);
    }
    // the orb forming between his fingers during a wind-up
    const orbOn = (k === 'shadowOrb' || k === 'elementBurst') && w > 0.05;
    orb.material.opacity = orbOn ? w * 0.95 : 0;
    orb.material.color.setHex(k === 'elementBurst' && st.elHex !== undefined ? st.elHex : 0x7a3acb);
    if (orbOn) {
      if (k === 'shadowOrb') orb.position.copy(hands[1].g.position).add(orb.up.set(0, 0.08, 0.06));
      else orb.position.set(0, 0.62, 0.55);
      orb.scale.setScalar(0.1 + w * 0.45);
    }
    orb.up.set(0, 1, 0);
    robe.scale.set(1 + dk * 0.2, Math.max(0.05, 1 - dk * 0.9), 1 + dk * 0.2);
    c.emitters[0].rate = c.emitters[1].rate = (10 + ph * 4) * (1 - dk) + (absorb ? 25 : 0);
    if (dk > 0.95 && !cues.includes('implode')) cues.push('implode');
    if (released) cues.push('release');
    void def;
  });
}

export function buildBossRig(def: BossDef): BossRig {
  if (def.id === 'ignar') return buildIgnar(def);
  if (def.id === 'vyra') return buildVyra(def);
  return buildVoidKing(def);
}
