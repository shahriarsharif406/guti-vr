import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SphereGeometry,
  createSystem,
} from '@iwsdk/core';

const FIREFLIES = 60;

/** The village courtyard around the play table: ground, hut, mango tree, jars, sun, fireflies. */
export class EnvSystem extends createSystem({}) {
  private ffPos = new Float32Array(FIREFLIES * 3);
  private ffBase = new Float32Array(FIREFLIES * 3);
  private ffPhase = new Float32Array(FIREFLIES);
  private ffGeo!: BufferGeometry;
  private t = 0;
  private clouds: Mesh[] = [];

  private add(m: Mesh, x: number, y: number, z: number): Mesh {
    m.position.set(x, y, z);
    this.world.createTransformEntity(m);
    return m;
  }

  private groundTexture(): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#5a3e2b';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      const v = 60 + Math.random() * 40;
      g.fillStyle = 'rgba(' + v + ',' + (v * 0.7) + ',' + (v * 0.45) + ',0.35)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(10, 10);
    return t;
  }

  init(): void {
    // packed-earth courtyard
    const ground = new Mesh(
      new CylinderGeometry(9, 9, 0.02, 48),
      new MeshStandardMaterial({ map: this.groundTexture(), roughness: 1 }),
    );
    this.add(ground, 0, 0.001, -1);

    // mango tree
    const bark = new MeshStandardMaterial({ color: 0x4b3326, roughness: 1 });
    this.add(new Mesh(new CylinderGeometry(0.18, 0.26, 2.6, 12), bark), -2.8, 1.3, -3.4);
    const leaf = new MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.9 });
    const blobs: [number, number, number, number][] = [
      [-2.8, 3.2, -3.4, 1.2],
      [-3.6, 2.9, -3.2, 0.9],
      [-2.1, 3.0, -3.7, 1.0],
      [-2.9, 3.8, -3.6, 0.9],
    ];
    for (const [x, y, z, r] of blobs) {
      this.add(new Mesh(new SphereGeometry(r, 14, 10), leaf), x, y, z);
    }
    // a few mangoes
    const mango = new MeshStandardMaterial({ color: 0xf2b134, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      this.add(
        new Mesh(new SphereGeometry(0.07, 10, 8), mango),
        -2.8 + Math.cos(i * 1.7) * 0.9,
        2.7 + (i % 3) * 0.12,
        -3.4 + Math.sin(i * 1.7) * 0.9,
      );
    }

    // mud hut with thatched roof
    this.add(
      new Mesh(new BoxGeometry(2.6, 1.7, 2.2), new MeshStandardMaterial({ color: 0xb98a63, roughness: 1 })),
      3.2, 0.85, -4.2,
    );
    const roof = new Mesh(
      new ConeGeometry(2.3, 1.2, 4),
      new MeshStandardMaterial({ color: 0xc9a24a, roughness: 1 }),
    );
    roof.rotation.y = Math.PI / 4;
    this.add(roof, 3.2, 2.3, -4.2);
    this.add(
      new Mesh(new BoxGeometry(0.6, 1.1, 0.06), new MeshStandardMaterial({ color: 0x3a2417 })),
      3.2, 0.55, -3.08,
    );
    // warm window glow
    this.add(
      new Mesh(new BoxGeometry(0.4, 0.4, 0.05), new MeshBasicMaterial({ color: 0xffc766 })),
      2.3, 1.0, -3.08,
    );

    // clay jars (matka) near the player
    const clay = new MeshStandardMaterial({ color: 0xb4532a, roughness: 0.85 });
    for (const [x, z, s] of [[-0.9, -0.2, 1], [-1.15, -0.45, 0.8], [1.0, -0.3, 0.9]] as [number, number, number][]) {
      const jar = new Mesh(new SphereGeometry(0.2 * s, 16, 12), clay);
      jar.scale.y = 1.15;
      this.add(jar, x, 0.23 * s, z);
      this.add(new Mesh(new CylinderGeometry(0.09 * s, 0.12 * s, 0.14 * s, 12), clay), x, 0.5 * s, z);
    }

    // bamboo fence
    const bamboo = new MeshStandardMaterial({ color: 0xa8a05a, roughness: 0.9 });
    for (let i = -8; i <= 8; i++) {
      this.add(new Mesh(new CylinderGeometry(0.035, 0.035, 1.3, 6), bamboo), i * 0.5, 0.65, -6.5);
    }

    // low sun
    this.add(
      new Mesh(new SphereGeometry(2.2, 24, 16), new MeshBasicMaterial({ color: 0xffa55a })),
      -4, 3.2, -28,
    );

    // slow drifting clouds
    const cloudMat = new MeshBasicMaterial({ color: 0xffd9c0, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 7; i++) {
      const c = new Mesh(new SphereGeometry(1, 12, 8), cloudMat);
      c.scale.set(2.5 + Math.random() * 2, 0.45, 0.9);
      this.add(c, -14 + i * 4.5, 4.5 + Math.random() * 3, -22 - Math.random() * 6);
      this.clouds.push(c);
    }

    // fireflies
    for (let i = 0; i < FIREFLIES; i++) {
      this.ffBase[i * 3] = (Math.random() - 0.5) * 7;
      this.ffBase[i * 3 + 1] = 0.5 + Math.random() * 2.2;
      this.ffBase[i * 3 + 2] = -0.5 - Math.random() * 5;
      this.ffPhase[i] = Math.random() * 6.28;
    }
    this.ffGeo = new BufferGeometry();
    this.ffGeo.setAttribute('position', new BufferAttribute(this.ffPos, 3));
    const pts = new Points(
      this.ffGeo,
      new PointsMaterial({
        color: 0xeaff8a,
        size: 0.03,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    pts.frustumCulled = false;
    this.world.createTransformEntity(pts);
  }

  update(dt: number): void {
    this.t += dt;
    for (const c of this.clouds) {
      c.position.x += dt * 0.15;
      if (c.position.x > 18) c.position.x = -18;
    }
    for (let i = 0; i < FIREFLIES; i++) {
      const p = this.ffPhase[i];
      this.ffPos[i * 3] = this.ffBase[i * 3] + Math.sin(this.t * 0.4 + p) * 0.4;
      this.ffPos[i * 3 + 1] = this.ffBase[i * 3 + 1] + Math.sin(this.t * 0.7 + p * 2) * 0.25;
      this.ffPos[i * 3 + 2] = this.ffBase[i * 3 + 2] + Math.cos(this.t * 0.3 + p) * 0.4;
    }
    (this.ffGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
