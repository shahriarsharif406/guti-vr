/**
 * SPELLFORGE visual effects: one pooled additive particle system (a single draw call) plus small mesh helpers.
 * Nothing here is allocated per frame: pools are created once and recycled.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
} from '@iwsdk/core';

export const SPARK_MAX = 2400;

export class Sparks {
  readonly points: Points;
  private pos = new Float32Array(SPARK_MAX * 3);
  private col = new Float32Array(SPARK_MAX * 4);
  private size = new Float32Array(SPARK_MAX);
  private vel = new Float32Array(SPARK_MAX * 3);
  private life = new Float32Array(SPARK_MAX);
  private maxLife = new Float32Array(SPARK_MAX);
  private base = new Float32Array(SPARK_MAX * 4); // r,g,b,size
  private grav = new Float32Array(SPARK_MAX);
  private drag = new Float32Array(SPARK_MAX);
  private cursor = 0;
  /** 1 normally, lower in reduced-intensity mode */
  density = 1;
  private geo = new BufferGeometry();
  readonly mat: ShaderMaterial;

  constructor() {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    this.geo.setAttribute('aCol', new BufferAttribute(this.col, 4).setUsage(35048));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(35048));
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uScale: { value: 620 } },
      vertexShader: `
        attribute vec4 aCol; attribute float aSize; varying vec4 vC; uniform float uScale;
        void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * uScale * projectionMatrix[1][1] / max(0.2, -mv.z), 0.0, 90.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec4 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;
          float a = pow(1.0 - r, 1.6); gl_FragColor = vec4(vC.rgb * (0.6 + 0.8 * a), vC.a * a); }`,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    for (let i = 0; i < SPARK_MAX; i++) this.pos[i * 3 + 1] = -999;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, hex: number, size: number, life: number, grav = 0, drag = 0.8): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SPARK_MAX;
    const c = tmpColor.setHex(hex);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.base[i * 4] = c.r;
    this.base[i * 4 + 1] = c.g;
    this.base[i * 4 + 2] = c.b;
    this.base[i * 4 + 3] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  /** a burst of n sparks flying outward */
  burst(x: number, y: number, z: number, hex: number, n: number, speed: number, size = 0.05, life = 0.7, grav = 0, up = 0): void {
    const k = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < k; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.emit(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp + up, Math.sin(ph) * Math.sin(th) * sp, hex, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7), grav);
    }
  }
  /** a flat ring of sparks on a horizontal plane */
  ring(x: number, y: number, z: number, r: number, hex: number, n: number, size = 0.06, life = 0.9): void {
    const k = Math.max(4, Math.round(n * this.density));
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      this.emit(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * 0.8, 0.2, Math.sin(a) * 0.8, hex, size, life, 0, 1.4);
    }
  }
  update(dt: number): void {
    for (let i = 0; i < SPARK_MAX; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        this.col[i * 4 + 3] = 0;
        this.pos[i * 3 + 1] = -999;
        this.size[i] = 0;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = nl / this.maxLife[i];
      this.col[i * 4] = this.base[i * 4];
      this.col[i * 4 + 1] = this.base[i * 4 + 1];
      this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = Math.min(1, k * 2);
      this.size[i] = this.base[i * 4 + 3] * (0.4 + 0.6 * k);
    }
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aCol') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
  }
}
const tmpColor = new Color();

let glowTex: CanvasTexture | null = null;
export function glowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = new CanvasTexture(c);
  return glowTex;
}
/** a soft additive billboard glow */
export function glowSprite(hex: number, size: number, opacity = 0.9): Sprite {
  const m = new SpriteMaterial({ map: glowTexture(), color: hex, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending });
  const s = new Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 18;
  return s;
}

let runeTex: Record<string, CanvasTexture> = {};
/** a glowing circular sigil: concentric rings with ticks and a letter, drawn once per colour */
export function sigilTexture(css: string, letter: string): CanvasTexture {
  const key = css + letter;
  if (runeTex[key]) return runeTex[key];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = css;
  g.fillStyle = css;
  g.shadowColor = css;
  g.shadowBlur = 14;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(128, 128, 92, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98);
    g.lineTo(128 + Math.cos(a) * (i % 3 === 0 ? 112 : 104), 128 + Math.sin(a) * (i % 3 === 0 ? 112 : 104));
    g.stroke();
  }
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const x = 128 + Math.cos(a) * 80;
    const y = 128 + Math.sin(a) * 80;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.stroke();
  g.shadowBlur = 8;
  g.font = '700 80px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 134);
  const t = new CanvasTexture(c);
  runeTex[key] = t;
  return t;
}
export function disposeFxCaches(): void {
  glowTex = null;
  runeTex = {};
}
