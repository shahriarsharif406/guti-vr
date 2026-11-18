import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  CanvasTexture,
  Quaternion,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

/** Display colours of every light mix (mask bits: cyan 1, magenta 2, gold 4). Documented in auralogic.ts. */
export const MASK_HEX = [0x000000, 0x33f0ff, 0xff3bd6, 0x8a5cff, 0xffc233, 0x3dffa0, 0xff7a3a, 0xffffff];
export const MASK_NAME = ['none', 'Cyan', 'Magenta', 'Violet', 'Gold', 'Emerald', 'Ember', 'White'];
export const MASK_LETTER = ['-', 'C', 'M', 'V', 'G', 'E', 'A', 'W'];
const tmpC = new Color();
export const maskColor = (m: number, out: Color = tmpC): Color => out.setHex(MASK_HEX[m & 7]);

// ---------------------------------------------------------------- liquid light beams (instanced quads)
const BEAM_V = `
attribute vec3 aCol;
attribute float aLen;
varying vec2 vUv;
varying vec3 vCol;
varying float vLen;
void main(){
  vUv = uv; vCol = aCol; vLen = aLen;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const BEAM_F = `
uniform float uTime;
uniform float uAlpha;
uniform float uCalm;
varying vec2 vUv;
varying vec3 vCol;
varying float vLen;
void main(){
  float d = abs(vUv.y - 0.5) * 2.0;
  float core = exp(-d * d * 30.0);
  float halo = exp(-d * d * 4.2) * 0.42;
  float x = vUv.x * vLen;
  float flow = 0.72 + 0.28 * sin(x * 42.0 - uTime * 7.0 + sin(x * 9.0 + uTime * 2.0) * 1.6) * uCalm;
  float interf = 0.82 + 0.18 * sin(d * 16.0 - uTime * 3.0) * uCalm;
  float a = (core * flow * 1.15 + halo * interf) * uAlpha;
  vec3 c = mix(vCol, vec3(1.0), core * 0.55);
  gl_FragColor = vec4(c * a, a);
}`;
export function makeBeams(max: number): { mesh: InstancedMesh; mat: ShaderMaterial; col: InstancedBufferAttribute; len: InstancedBufferAttribute } {
  const g = new PlaneGeometry(1, 1);
  const col = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const len = new InstancedBufferAttribute(new Float32Array(max), 1);
  g.setAttribute('aCol', col);
  g.setAttribute('aLen', len);
  const mat = new ShaderMaterial({
    vertexShader: BEAM_V,
    fragmentShader: BEAM_F,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uCalm: { value: 1 } },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(g, mat, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, mat, col, len };
}
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _z = new Vector3(0, 0, 1);
export function setBeam(b: { mesh: InstancedMesh; col: InstancedBufferAttribute; len: InstancedBufferAttribute }, i: number, x1: number, y1: number, x2: number, y2: number, z: number, width: number, mask: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  _q.setFromAxisAngle(_z, Math.atan2(dy, dx));
  _p.set((x1 + x2) / 2, (y1 + y2) / 2, z);
  _s.set(Math.max(L, 1e-4), width, 1);
  _m.compose(_p, _q, _s);
  b.mesh.setMatrixAt(i, _m);
  maskColor(mask);
  b.col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
  b.len.setX(i, L);
}

// ---------------------------------------------------------------- cosmic atmosphere
const NEB_F = `
uniform float uTime; uniform float uRestore; uniform float uPulseAge; uniform vec2 uPulseC; uniform float uOct; uniform float uMotion;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ if (float(i) >= uOct) break; v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
void main(){
  vec2 p = (vUv - 0.5) * vec2(1.6, 1.0);
  float t = uTime * 0.03 * uMotion;
  vec2 q = vec2(fbm(p * 2.2 + t), fbm(p * 2.2 - t + 5.2));
  float n = fbm(p * 2.4 + q * 1.8 + t * 2.0);
  vec3 deep = vec3(0.012, 0.012, 0.03);
  vec3 indigo = vec3(0.07, 0.05, 0.30);
  vec3 violet = vec3(0.34, 0.12, 0.62);
  vec3 cyan = vec3(0.05, 0.55, 0.75);
  vec3 gold = vec3(0.95, 0.65, 0.2);
  vec3 emer = vec3(0.1, 0.75, 0.5);
  vec3 col = mix(deep, indigo, smoothstep(0.25, 0.7, n));
  col = mix(col, violet, smoothstep(0.55, 0.9, n) * (0.5 + 0.5 * uRestore));
  col += cyan * pow(max(n - 0.5, 0.0), 2.0) * 1.6 * (0.2 + uRestore);
  col += (gold * 0.7 + emer * 0.5) * pow(fbm(p * 3.5 + q + 3.0), 3.0) * uRestore * 1.1;
  // stars
  vec2 sg = floor(vUv * vec2(240.0, 150.0));
  float sr = hash(sg);
  float star = step(0.985, sr) * (0.5 + 0.5 * sin(uTime * (0.6 + sr * 3.0) * uMotion + sr * 40.0));
  col += vec3(0.8, 0.9, 1.0) * star * 0.8;
  // world pulse: an expanding ring across the whole sanctuary
  float r = length((vUv - uPulseC) * vec2(1.6, 1.0));
  float ring = exp(-pow((r - uPulseAge * 1.4) * 7.0, 2.0)) * smoothstep(1.6, 0.0, uPulseAge) * step(0.0, uPulseAge);
  col += (vec3(0.6, 0.9, 1.0) * 0.9 + gold * 0.3) * ring;
  // vignette so the board edge falls into the void
  float vg = smoothstep(0.95, 0.35, length(p * vec2(0.85, 1.25)));
  gl_FragColor = vec4(col * (0.35 + 0.65 * vg), 1.0);
}`;
export function makeNebula(w: number, h: number): { mesh: Mesh; mat: ShaderMaterial } {
  const mat = new ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: NEB_F,
    uniforms: { uTime: { value: 0 }, uRestore: { value: 0 }, uPulseAge: { value: -1 }, uPulseC: { value: { x: 0.5, y: 0.5 } }, uOct: { value: 4 }, uMotion: { value: 1 } },
  });
  return { mesh: new Mesh(new PlaneGeometry(w, h), mat), mat };
}

// ---------------------------------------------------------------- crystal shader (monoliths, spires)
const CRY_V = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
#ifdef USE_INSTANCING
attribute float aGlow;
varying float vGlow;
#endif
void main(){
  vec4 mv = modelViewMatrix *
#ifdef USE_INSTANCING
    instanceMatrix *
#endif
    vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(
#ifdef USE_INSTANCING
    instanceMatrix
#else
    1.0,0.0,0.0, 0.0,1.0,0.0, 0.0,0.0,1.0
#endif
  ) * normal);
  vV = -mv.xyz; vP = position;
#ifdef USE_INSTANCING
  vGlow = aGlow;
#endif
  gl_Position = projectionMatrix * mv;
}`;
const CRY_F = `
uniform float uTime; uniform float uGlow; uniform vec3 uBase; uniform vec3 uGlowCol; uniform float uHue;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
#ifdef USE_INSTANCING
varying float vGlow;
#endif
void main(){
  float glow = uGlow;
#ifdef USE_INSTANCING
  glow += vGlow;
#endif
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float fres = pow(1.0 - abs(dot(n, v)), 2.4);
  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (fres * 1.1 + uHue + vec3(0.0, 0.33, 0.67)));
  float caust = pow(0.5 + 0.5 * sin(vP.x * 70.0 + uTime * 2.1) * sin(vP.y * 55.0 - uTime * 1.6 + vP.z * 40.0), 4.0);
  vec3 col = mix(uBase, iri, fres * 0.85) + uGlowCol * glow * (0.35 + caust * 0.8);
  float a = clamp(0.4 + fres * 0.55 + glow * 0.25, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;
export function makeCrystalMaterial(base: number, glowCol: number, hue: number): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: CRY_V,
    fragmentShader: CRY_F,
    uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uBase: { value: new Color(base) }, uGlowCol: { value: new Color(glowCol) }, uHue: { value: hue } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return m;
}

// ---------------------------------------------------------------- energy ripple (expanding chromatic rings)
const RIP_F = `
uniform float uT; uniform vec3 uCol;
varying vec2 vUv;
void main(){
  vec2 p = vUv - 0.5; float r = length(p) * 2.0;
  float a = 0.0; vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++){
    float off = float(i) * 0.045;
    float ring = exp(-pow((r - (uT * 1.05 - off)) * 16.0, 2.0));
    vec3 tint = i == 0 ? vec3(1.0, 0.35, 0.5) : (i == 1 ? vec3(0.4, 1.0, 0.8) : vec3(0.4, 0.6, 1.0));
    c += mix(uCol, tint, 0.5) * ring; a += ring;
  }
  float fade = (1.0 - uT) * smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(c * fade, a * fade);
}`;
export class RippleFx {
  readonly group = new Group();
  private m: { mesh: Mesh; mat: ShaderMaterial; t: number }[] = [];
  constructor(n = 5) {
    const g = new PlaneGeometry(1, 1);
    for (let i = 0; i < n; i++) {
      const mat = new ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: RIP_F, uniforms: { uT: { value: 1 }, uCol: { value: new Color(1, 1, 1) } }, transparent: true, blending: AdditiveBlending, depthWrite: false });
      const mesh = new Mesh(g, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.m.push({ mesh, mat, t: 1 });
    }
  }
  fire(x: number, y: number, z: number, size: number, color: number): void {
    const r = this.m.reduce((a, b) => (a.t > b.t ? a : b));
    r.t = 0;
    r.mesh.position.set(x, y, z);
    r.mesh.scale.setScalar(size);
    (r.mat.uniforms.uCol.value as Color).setHex(color);
    r.mesh.visible = true;
  }
  update(dt: number, speed = 0.55): void {
    for (const r of this.m) {
      if (r.t >= 1) continue;
      r.t += dt * speed;
      if (r.t >= 1) r.mesh.visible = false;
      else r.mat.uniforms.uT.value = r.t;
    }
  }
}

// ---------------------------------------------------------------- flora
let petalGeo: BufferGeometry | null = null;
function petalGeometry(): BufferGeometry {
  if (petalGeo) return petalGeo;
  const s = new Shape();
  s.moveTo(0, 0);
  // soft teardrop petal: a full belly and a rounded tip (the old needle shape read as spiky stars)
  s.bezierCurveTo(0.024, 0.01, 0.024, 0.036, 0.004, 0.048);
  s.quadraticCurveTo(0, 0.052, -0.004, 0.048);
  s.bezierCurveTo(-0.024, 0.036, -0.024, 0.01, 0, 0);
  petalGeo = new ShapeGeometry(s, 10);
  return petalGeo;
}
export interface Lotus {
  group: Group;
  grow: number;
  target: number;
  update(dt: number, time: number, pollenCount: number): void;
}
/** A layered geometric lotus. grow 0 = closed bud, 1 = open; pollen orbits the core. */
export function makeLotus(hue: number, layers = 3): Lotus {
  const group = new Group();
  const col = new Color().setHSL(hue, 0.85, 0.6);
  const pivots: { p: Group; layer: number }[] = [];
  const mat = new MeshPhysicalMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, transparent: true, opacity: 0.78, roughness: 0.25, side: DoubleSide, depthWrite: false });
  const geo = petalGeometry();
  for (let l = 0; l < layers; l++) {
    const n = 6 + l * 2;
    for (let k = 0; k < n; k++) {
      const p = new Group();
      p.rotation.order = 'YXZ';
      p.rotation.y = (k / n) * Math.PI * 2 + l * 0.35;
      const m = new Mesh(geo, mat);
      m.scale.setScalar(1 + l * 0.28);
      p.add(m);
      group.add(p);
      pivots.push({ p, layer: l });
    }
  }
  const core = new Mesh(new SphereGeometry(0.009, 12, 8), new MeshBasicMaterial({ color: new Color().setHSL(hue + 0.08, 0.9, 0.75), blending: AdditiveBlending, transparent: true }));
  core.position.y = 0.012;
  group.add(core);
  const PN = 28;
  const pp = new Float32Array(PN * 3);
  const pg = new BufferGeometry();
  pg.setAttribute('position', new BufferAttribute(pp, 3));
  const pts = new Points(pg, new PointsMaterial({ size: 0.004, color: 0xffe9a8, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  pts.frustumCulled = false;
  group.add(pts);
  const lotus: Lotus = {
    group,
    grow: 0,
    target: 0,
    update(dt, time, pollenCount) {
      lotus.grow += (lotus.target - lotus.grow) * Math.min(1, dt * 1.6);
      const g = lotus.grow;
      for (const { p, layer } of pivots) {
        const gg = Math.max(0, Math.min(1, (g - layer * 0.12) / 0.7));
        const e = gg * gg * (3 - 2 * gg);
        p.rotation.x = 1.45 * (1 - e) + (0.25 + layer * 0.22) * e;
      }
      group.scale.setScalar(0.35 + 0.65 * g);
      group.rotation.y = time * 0.15;
      core.scale.setScalar(0.6 + 0.8 * g + Math.sin(time * 3) * 0.1 * g);
      const nShow = Math.min(PN, Math.floor(pollenCount * g));
      for (let i = 0; i < PN; i++) {
        if (i >= nShow) {
          pp[i * 3 + 1] = -10;
          continue;
        }
        const a = time * (0.4 + (i % 5) * 0.12) + i * 2.399;
        const r = 0.03 + (i % 7) * 0.006;
        pp[i * 3] = Math.cos(a) * r;
        pp[i * 3 + 1] = 0.02 + ((time * 0.04 + i * 0.13) % 0.09);
        pp[i * 3 + 2] = Math.sin(a) * r;
      }
      (pg.getAttribute('position') as BufferAttribute).needsUpdate = true;
    },
  };
  return lotus;
}

/** A fractal fern: recursive branching drawn as glowing line segments; grow reveals it depth by depth. */
export function makeFractal(hue: number, seed: number): { lines: LineSegments; setGrow(g: number): void } {
  const depthMax = 6;
  const pos: number[] = [];
  const colr: number[] = [];
  const c = new Color();
  let s = seed;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  type B = { x: number; y: number; a: number; len: number };
  let level: B[] = [{ x: 0, y: 0, a: Math.PI / 2, len: 0.05 }];
  const counts: number[] = [];
  for (let d = 0; d < depthMax; d++) {
    const next: B[] = [];
    for (const b of level) {
      const x2 = b.x + Math.cos(b.a) * b.len;
      const y2 = b.y + Math.sin(b.a) * b.len;
      pos.push(b.x, b.y, 0, x2, y2, 0);
      c.setHSL(hue + d * 0.025, 0.85, 0.45 + d * 0.06);
      colr.push(c.r, c.g, c.b, c.r, c.g, c.b);
      const sp = 0.45 + rnd() * 0.3;
      next.push({ x: x2, y: y2, a: b.a + sp, len: b.len * (0.7 + rnd() * 0.08) }, { x: x2, y: y2, a: b.a - sp, len: b.len * (0.7 + rnd() * 0.08) });
    }
    counts.push(pos.length / 6);
    level = next;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colr), 3));
  const lines = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
  g.setDrawRange(0, 0);
  return {
    lines,
    setGrow(v: number) {
      const f = Math.max(0, Math.min(1, v)) * depthMax;
      const d = Math.min(depthMax - 1, Math.floor(f));
      const base = d === 0 ? 0 : counts[d - 1];
      const part = (counts[d] - base) * (f - d);
      g.setDrawRange(0, (base + Math.floor(part)) * 2);
    },
  };
}

export function floatingStone(): Mesh {
  return new Mesh(new OctahedronGeometry(0.02, 0), new MeshPhysicalMaterial({ color: 0x1b1a2e, roughness: 0.35, metalness: 0.6, emissive: 0x201040, emissiveIntensity: 0.4 }));
}

// ---------------------------------------------------------------- canvas textures
export function runeRingTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(128, 128, 96, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.cos(a) * 107, 128 + Math.sin(a) * 107);
    g.rotate(a);
    g.fillRect(-1.5, -7 - (i % 3) * 2, 3, 14 + (i % 3) * 4);
    g.restore();
  }
  return new CanvasTexture(c);
}
export function softDotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
