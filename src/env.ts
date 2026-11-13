import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  BackSide,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SphereGeometry,
  createSystem,
} from '@iwsdk/core';
import { WorldId, worldState } from './worlds.js';

const FIREFLIES = 60;

/** The village courtyard around the play table: ground, hut, mango tree, jars, sun, fireflies. */
export class EnvSystem extends createSystem({}) {
  private ffPos = new Float32Array(FIREFLIES * 3);
  private ffBase = new Float32Array(FIREFLIES * 3);
  private ffPhase = new Float32Array(FIREFLIES);
  private ffGeo!: BufferGeometry;
  private t = 0;
  private clouds: Mesh[] = [];
  private groups: Record<WorldId, { visible: boolean }[]> = {
    earth: [],
    moon: [],
    mars: [],
    station: [],
  };
  private shownWorld: WorldId | '' = '';
  private spinners: Mesh[] = [];
  private building: WorldId = 'earth';

  private add(m: Mesh, x: number, y: number, z: number): Mesh {
    m.position.set(x, y, z);
    this.world.createTransformEntity(m);
    this.groups[this.building].push(m);
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
    this.groups.earth.push(pts);

    this.building = 'moon';
    this.buildMoon();
    this.building = 'mars';
    this.buildMars();
    this.building = 'station';
    this.buildStation();
    this.building = 'earth';
    this.showWorld('earth');
  }

  // ------------------------------------------------------------ other worlds
  private showWorld(id: WorldId): void {
    this.shownWorld = id;
    for (const k of Object.keys(this.groups) as WorldId[]) {
      for (const m of this.groups[k]) m.visible = k === id;
    }
  }

  private skyDome(top: string, mid: string, bottom: string, stars: number): void {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 1024;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const grad = g.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, top);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2048, 1024);
    for (let i = 0; i < stars; i++) {
      const y = Math.random() * 800;
      const a = 0.3 + Math.random() * 0.6;
      g.fillStyle = 'rgba(255,255,255,' + a + ')';
      const r = Math.random() < 0.06 ? 2 : 1;
      g.fillRect(Math.random() * 2048, y, r, r);
    }
    const dome = new Mesh(
      new SphereGeometry(60, 32, 16),
      new MeshBasicMaterial({ map: new CanvasTexture(c), side: BackSide, depthWrite: false }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.add(dome, 0, 1.3, -0.5);
  }

  private craterTexture(base: string, dark: string, light: string, craters: number): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
      g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 4, 1 + Math.random() * 4);
    }
    for (let i = 0; i < craters; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 6 + Math.random() * 34;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = dark;
      g.fill();
      g.beginPath();
      g.arc(x - r * 0.12, y - r * 0.12, r * 0.82, 0, Math.PI * 2);
      g.strokeStyle = light;
      g.lineWidth = 2;
      g.stroke();
    }
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(5, 5);
    return t;
  }

  private earthTexture(): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const og = g.createLinearGradient(0, 0, 0, 256);
    og.addColorStop(0, '#2a6fc4');
    og.addColorStop(0.5, '#1b4f9e');
    og.addColorStop(1, '#2a6fc4');
    g.fillStyle = og;
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = Math.random() < 0.7 ? '#3f8f4a' : '#b79b64';
      g.beginPath();
      const x = Math.random() * 512;
      const y = 40 + Math.random() * 176;
      g.ellipse(x, y, 14 + Math.random() * 44, 8 + Math.random() * 24, Math.random() * 3, 0, 6.3);
      g.fill();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(255,255,255,' + (0.25 + Math.random() * 0.4) + ')';
      g.beginPath();
      g.ellipse(Math.random() * 512, Math.random() * 256, 12 + Math.random() * 50, 3 + Math.random() * 8, Math.random() * 3, 0, 6.3);
      g.fill();
    }
    g.fillStyle = '#f4f8ff';
    g.fillRect(0, 0, 512, 14);
    g.fillRect(0, 242, 512, 14);
    return new CanvasTexture(c);
  }

  private rocks(mat: MeshStandardMaterial, n: number, spread: number, minR: number, maxR: number): void {
    const geo = new IcosahedronGeometry(1, 0);
    for (let i = 0; i < n; i++) {
      const r = minR + Math.random() * (maxR - minR);
      const m = new Mesh(geo, mat);
      m.scale.set(r, r * (0.55 + Math.random() * 0.35), r);
      m.rotation.y = Math.random() * 6;
      const a = Math.random() * Math.PI * 2;
      const d = 2.2 + Math.random() * spread;
      this.add(m, Math.cos(a) * d, r * 0.3, -1 + Math.sin(a) * d);
    }
  }

  private buildMoon(): void {
    this.skyDome('#000004', '#03040a', '#0a0c14', 900);
    const ground = new Mesh(
      new CylinderGeometry(9, 9, 0.02, 48),
      new MeshStandardMaterial({ map: this.craterTexture('#8d8d93', '#6d6d74', '#b4b4bb', 40), roughness: 1 }),
    );
    this.add(ground, 0, 0.001, -1);
    this.rocks(new MeshStandardMaterial({ color: 0x77777e, roughness: 1, flatShading: true }), 16, 6, 0.15, 0.7);
    // Earth hanging in the black sky
    const earth = new Mesh(new SphereGeometry(2.6, 32, 20), new MeshBasicMaterial({ map: this.earthTexture() }));
    this.add(earth, -7, 8, -30);
    this.spinners.push(earth);
    // small lander
    const foil = new MeshStandardMaterial({ color: 0xd9b34a, roughness: 0.4, metalness: 0.7 });
    const leg = new MeshStandardMaterial({ color: 0xbfc3c9, roughness: 0.6 });
    this.add(new Mesh(new BoxGeometry(1.0, 0.7, 1.0), foil), 3.4, 0.95, -4.6);
    this.add(new Mesh(new ConeGeometry(0.55, 0.5, 8), foil), 3.4, 1.55, -4.6);
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as [number, number][]) {
      const l = new Mesh(new CylinderGeometry(0.04, 0.04, 0.95, 6), leg);
      l.rotation.z = -dx * 0.5;
      l.rotation.x = dz * 0.5;
      this.add(l, 3.4 + dx * 0.9, 0.45, -4.6 + dz * 0.9);
      this.add(new Mesh(new CylinderGeometry(0.16, 0.16, 0.03, 10), leg), 3.4 + dx * 1.1, 0.02, -4.6 + dz * 1.1);
    }
  }

  private buildMars(): void {
    this.skyDome('#5b3b43', '#b8825f', '#d9a57a', 150);
    const ground = new Mesh(
      new CylinderGeometry(9, 9, 0.02, 48),
      new MeshStandardMaterial({ map: this.craterTexture('#a4522f', '#8a4125', '#c8744a', 22), roughness: 1 }),
    );
    this.add(ground, 0, 0.001, -1);
    this.rocks(new MeshStandardMaterial({ color: 0x8b4a2c, roughness: 1, flatShading: true }), 20, 6, 0.15, 0.8);
    // distant mesas
    const mesa = new MeshStandardMaterial({ color: 0x8e5136, roughness: 1, flatShading: true });
    for (const [x, z, h, r] of [[-9, -22, 3, 4], [4, -26, 4.5, 5], [14, -20, 2.4, 3.5], [-18, -18, 2, 3]] as number[][]) {
      this.add(new Mesh(new CylinderGeometry(r * 0.6, r, h, 8), mesa), x, h / 2, z);
    }
    // small pale sun
    this.add(new Mesh(new SphereGeometry(0.9, 20, 14), new MeshBasicMaterial({ color: 0xfff1da })), 6, 6, -30);
    // rover
    const body = new MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.6 });
    const dark = new MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.9 });
    this.add(new Mesh(new BoxGeometry(1.2, 0.35, 0.7), body), -3.0, 0.55, -4.2);
    this.add(new Mesh(new CylinderGeometry(0.04, 0.04, 0.8, 6), dark), -2.6, 1.0, -4.2);
    this.add(new Mesh(new BoxGeometry(0.28, 0.18, 0.18), dark), -2.6, 1.45, -4.2);
    for (const dx of [-0.45, 0, 0.45]) {
      for (const dz of [-0.45, 0.45]) {
        const w = new Mesh(new CylinderGeometry(0.2, 0.2, 0.12, 14), dark);
        w.rotation.x = Math.PI / 2;
        this.add(w, -3.0 + dx, 0.2, -4.2 + dz);
      }
    }
  }

  private buildStation(): void {
    this.skyDome('#000003', '#02030a', '#05070e', 1100);
    // metal deck
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#4a5260';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    const tex = new CanvasTexture(c);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(9, 9);
    this.add(
      new Mesh(new CylinderGeometry(9, 9, 0.02, 48), new MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.5 })),
      0, 0.001, -1,
    );
    // huge Earth below the horizon
    const earth = new Mesh(new SphereGeometry(26, 48, 28), new MeshBasicMaterial({ map: this.earthTexture() }));
    this.add(earth, 0, -22, -45);
    this.spinners.push(earth);
    // main module and solar arrays
    const hull = new MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.5, metalness: 0.3 });
    const module = new Mesh(new CylinderGeometry(1.2, 1.2, 9, 20), hull);
    module.rotation.z = Math.PI / 2;
    this.add(module, 0, 3.4, -14);
    const truss = new Mesh(new CylinderGeometry(0.06, 0.06, 16, 6), hull);
    truss.rotation.z = Math.PI / 2;
    this.add(truss, 0, 3.4, -14);
    const panelCanvas = document.createElement('canvas');
    panelCanvas.width = 128;
    panelCanvas.height = 64;
    const pg = panelCanvas.getContext('2d') as CanvasRenderingContext2D;
    pg.fillStyle = '#16327a';
    pg.fillRect(0, 0, 128, 64);
    pg.strokeStyle = '#6f93e0';
    pg.lineWidth = 1.5;
    for (let i = 0; i <= 128; i += 16) {
      pg.beginPath();
      pg.moveTo(i, 0);
      pg.lineTo(i, 64);
      pg.stroke();
    }
    for (let j = 0; j <= 64; j += 16) {
      pg.beginPath();
      pg.moveTo(0, j);
      pg.lineTo(128, j);
      pg.stroke();
    }
    const panelMat = new MeshStandardMaterial({
      map: new CanvasTexture(panelCanvas),
      roughness: 0.3,
      metalness: 0.6,
      emissive: 0x0a1a44,
    });
    for (const x of [-6.5, 6.5]) {
      this.add(new Mesh(new BoxGeometry(4.4, 0.05, 2.2), panelMat), x, 3.4, -14);
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (worldState.id !== this.shownWorld) this.showWorld(worldState.id);
    for (const sp of this.spinners) sp.rotation.y += dt * 0.02;
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
