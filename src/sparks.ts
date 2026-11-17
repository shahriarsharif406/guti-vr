import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Group, Points, PointsMaterial } from '@iwsdk/core';

/**
 * Physical spark sprays for GearShift: hot particles fly out on a ballistic arc (gravity),
 * shed puffs of smoke as they go, and cool from white-yellow to red before dying.
 * One pre-allocated pool per kind, no allocation per frame.
 */
const NS = 220; // sparks
const NM = 200; // smoke puffs
const GRAVITY = 1.6;

function softDot(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

export class SparkField {
  readonly group = new Group();
  private sp = new Float32Array(NS * 3);
  private sv = new Float32Array(NS * 3);
  private sc = new Float32Array(NS * 3);
  private sBase = new Float32Array(NS * 3);
  private sLife = new Float32Array(NS);
  private sMax = new Float32Array(NS);
  private mp = new Float32Array(NM * 3);
  private mv = new Float32Array(NM * 3);
  private mc = new Float32Array(NM * 3);
  private mLife = new Float32Array(NM);
  private mMax = new Float32Array(NM);
  private sNext = 0;
  private mNext = 0;
  private sGeo = new BufferGeometry();
  private mGeo = new BufferGeometry();

  constructor() {
    for (let i = 0; i < NS; i++) this.sp[i * 3 + 1] = -100;
    for (let i = 0; i < NM; i++) this.mp[i * 3 + 1] = -100;
    this.sGeo.setAttribute('position', new BufferAttribute(this.sp, 3));
    this.sGeo.setAttribute('color', new BufferAttribute(this.sc, 3));
    this.mGeo.setAttribute('position', new BufferAttribute(this.mp, 3));
    this.mGeo.setAttribute('color', new BufferAttribute(this.mc, 3));
    const tex = softDot();
    const smoke = new Points(this.mGeo, new PointsMaterial({ size: 0.04, map: tex, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    const sparks = new Points(this.sGeo, new PointsMaterial({ size: 0.012, map: tex, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    smoke.frustumCulled = sparks.frustumCulled = false;
    this.group.add(smoke, sparks);
  }

  /** A spray of sparks leaving (x,y,z) around direction (dx,dy), with the given colour and speed (m/s). */
  spray(x: number, y: number, z: number, dx: number, dy: number, count: number, r: number, g: number, b: number, speed = 0.7): void {
    const len = Math.hypot(dx, dy) || 1;
    for (let n = 0; n < count; n++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % NS;
      const spread = (Math.random() - 0.5) * 1.6;
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const ux = (dx / len) * ca - (dy / len) * sa;
      const uy = (dx / len) * sa + (dy / len) * ca;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.sp[i * 3] = x;
      this.sp[i * 3 + 1] = y;
      this.sp[i * 3 + 2] = z;
      this.sv[i * 3] = ux * s;
      this.sv[i * 3 + 1] = uy * s;
      this.sv[i * 3 + 2] = (Math.random() - 0.3) * s * 0.6;
      this.sBase[i * 3] = r;
      this.sBase[i * 3 + 1] = g;
      this.sBase[i * 3 + 2] = b;
      this.sMax[i] = this.sLife[i] = 0.5 + Math.random() * 0.6;
    }
  }

  private puff(x: number, y: number, z: number): void {
    const i = this.mNext;
    this.mNext = (this.mNext + 1) % NM;
    this.mp[i * 3] = x;
    this.mp[i * 3 + 1] = y;
    this.mp[i * 3 + 2] = z;
    this.mv[i * 3] = (Math.random() - 0.5) * 0.02;
    this.mv[i * 3 + 1] = 0.03 + Math.random() * 0.03;
    this.mv[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    this.mMax[i] = this.mLife[i] = 0.9 + Math.random() * 0.8;
  }

  update(dt: number): void {
    for (let i = 0; i < NS; i++) {
      if (this.sLife[i] <= 0) continue;
      this.sLife[i] -= dt;
      if (this.sLife[i] <= 0) {
        this.sp[i * 3 + 1] = -100;
        this.sc[i * 3] = this.sc[i * 3 + 1] = this.sc[i * 3 + 2] = 0;
        continue;
      }
      this.sv[i * 3 + 1] -= GRAVITY * dt;
      this.sp[i * 3] += this.sv[i * 3] * dt;
      this.sp[i * 3 + 1] += this.sv[i * 3 + 1] * dt;
      this.sp[i * 3 + 2] += this.sv[i * 3 + 2] * dt;
      const f = this.sLife[i] / this.sMax[i];
      // cooling: bright base colour first, then deepening to red as it dies
      this.sc[i * 3] = this.sBase[i * 3] * (0.3 + f);
      this.sc[i * 3 + 1] = this.sBase[i * 3 + 1] * f * f;
      this.sc[i * 3 + 2] = this.sBase[i * 3 + 2] * f * f * f;
      if (Math.random() < dt * 14) this.puff(this.sp[i * 3], this.sp[i * 3 + 1], this.sp[i * 3 + 2]);
    }
    for (let i = 0; i < NM; i++) {
      if (this.mLife[i] <= 0) continue;
      this.mLife[i] -= dt;
      if (this.mLife[i] <= 0) {
        this.mp[i * 3 + 1] = -100;
        this.mc[i * 3] = this.mc[i * 3 + 1] = this.mc[i * 3 + 2] = 0;
        continue;
      }
      this.mp[i * 3] += this.mv[i * 3] * dt;
      this.mp[i * 3 + 1] += this.mv[i * 3 + 1] * dt;
      this.mp[i * 3 + 2] += this.mv[i * 3 + 2] * dt;
      const f = this.mLife[i] / this.mMax[i];
      const v = 0.16 * f * f;
      this.mc[i * 3] = v;
      this.mc[i * 3 + 1] = v * 0.92;
      this.mc[i * 3 + 2] = v * 0.85;
    }
    (this.sGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.sGeo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    (this.mGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.mGeo.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }
}
