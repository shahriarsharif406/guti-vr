import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  createSystem,
} from '@iwsdk/core';

const N = 400;

export const fxRef: { current: FxSystem | null } = { current: null };

/** Burst of glowing sparks, e.g. when a marble leaves the ring or a kite is cut. */
export function emitBurst(
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number,
  count = 16,
  speed = 0.5,
): void {
  fxRef.current?.emit(x, y, z, r, g, b, count, speed);
}

export class FxSystem extends createSystem({}) {
  private pos = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private base = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private maxLife = new Float32Array(N);
  private next = 0;
  private geo!: BufferGeometry;

  init(): void {
    for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -100;
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    const pts = new Points(
      this.geo,
      new PointsMaterial({
        size: 0.014,
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    pts.frustumCulled = false;
    this.world.createTransformEntity(pts);
    fxRef.current = this;
    this.cleanupFuncs.push(() => {
      fxRef.current = null;
    });
  }

  emit(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    count: number,
    speed: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = up * s;
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      this.base[i * 3] = r;
      this.base[i * 3 + 1] = g;
      this.base[i * 3 + 2] = b;
      this.maxLife[i] = this.life[i] = 0.6 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -100;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= 1.2 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }
}
