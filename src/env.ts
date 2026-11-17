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
  CircleGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  SRGBColorSpace,
  createSystem,
} from '@iwsdk/core';
import { modeState } from './mode.js';
import { kiteCfg } from './kitecfg.js';
import {
  bake,
  bambooClump,
  bananaPlant,
  boat,
  cementTexture,
  grassField,
  mistBank,
  sunShaft,
  harvestTexture,
  sandTexture,
  winterTexture,
  kashClump,
  lilyPads,
  haystack,
  hazeDisc,
  hut,
  mudTexture,
  moonTexture,
  marsTexture,
  metalTexture,
  planet,
  boulder,
  paddyTexture,
  paintedSky,
  palm,
  shadeTree,
  water,
} from './scenery.js';
import { WorldId, worldState } from './worlds.js';

const RAIN = 260;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
type SkyKey = 'sky_golden' | 'sky_morning' | 'sky_noon' | 'sky_cloudy' | 'sky_storm';
type SceneKey = WorldId | 'field' | 'bil' | 'winter' | 'char' | SkyKey;
const birdGeo = (() => {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.5, 0, 0, 0, 0, -0.18, 0, 0, 0.08, 0.5, 0, 0, 0, 0, -0.18, 0, 0, 0.08]), 3),
  );
  return g;
})();
const birdMat = new MeshBasicMaterial({ color: 0x2a2a2a, side: DoubleSide });

const FIREFLIES = 60;

/** The village courtyard around the play table: ground, hut, mango tree, jars, sun, fireflies. */
export class EnvSystem extends createSystem({}) {
  private ffPos = new Float32Array(FIREFLIES * 3);
  private ffBase = new Float32Array(FIREFLIES * 3);
  private ffPhase = new Float32Array(FIREFLIES);
  private ffGeo!: BufferGeometry;
  private t = 0;
  private clouds: Mesh[] = [];
  private groups: Record<SceneKey, { visible: boolean }[]> = {
    earth: [],
    moon: [],
    mars: [],
    station: [],
    luna: [],
    ares: [],
    orbit: [],
    field: [],
    bil: [],
    winter: [],
    char: [],
    sky_golden: [],
    sky_morning: [],
    sky_noon: [],
    sky_cloudy: [],
    sky_storm: [],
  };
  private shownSky: SkyKey | '' = '';
  private shownWorld: SceneKey | '' = '';
  private sway: { o: Object3D; phase: number }[] = [];
  private farKites: { m: Mesh; x: number; y: number; phase: number }[] = [];
  private farBirds: { m: Mesh; a: number; r: number; h: number; s: number }[] = [];
  private rainPos = new Float32Array(RAIN * 6);
  private rainBase = new Float32Array(RAIN * 3);
  private rainGeo!: BufferGeometry;
  private rain: Object3D | null = null;
  private spinners: Mesh[] = [];
  private mists: { m: Mesh; x: number; s: number }[] = [];
  private egrets: { m: Mesh; a: number; r: number; h: number; s: number }[] = [];
  private building: SceneKey = 'earth';

  private add<T extends Object3D>(m: T, x: number, y: number, z: number): T {
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

    const g1 = new Group();
    const put1 = (m: Mesh, x: number, y: number, z: number): void => {
      m.position.set(x, y, z);
      g1.add(m);
    };
    // mango tree
    const bark = new MeshStandardMaterial({ color: 0x4b3326, roughness: 1 });
    put1(new Mesh(new CylinderGeometry(0.18, 0.26, 2.6, 12), bark), -2.8, 1.3, -3.4);
    const leaf = new MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.9 });
    const blobs: [number, number, number, number][] = [
      [-2.8, 3.2, -3.4, 1.2],
      [-3.6, 2.9, -3.2, 0.9],
      [-2.1, 3.0, -3.7, 1.0],
      [-2.9, 3.8, -3.6, 0.9],
    ];
    for (const [x, y, z, r] of blobs) {
      put1(new Mesh(new SphereGeometry(r, 14, 10), leaf), x, y, z);
    }
    // a few mangoes
    const mango = new MeshStandardMaterial({ color: 0xf2b134, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      put1(
        new Mesh(new SphereGeometry(0.07, 10, 8), mango),
        -2.8 + Math.cos(i * 1.7) * 0.9,
        2.7 + (i % 3) * 0.12,
        -3.4 + Math.sin(i * 1.7) * 0.9,
      );
    }

    this.add(bake(g1), 0, 0, 0);

    this.buildVillageExtras();

    const g2 = new Group();
    const put2 = (m: Mesh, x: number, y: number, z: number): void => {
      m.position.set(x, y, z);
      g2.add(m);
    };
    // clay jars (matka) near the player
    const clay = new MeshStandardMaterial({ color: 0xb4532a, roughness: 0.85 });
    for (const [x, z, s] of [[-0.9, -0.2, 1], [-1.15, -0.45, 0.8], [1.0, -0.3, 0.9]] as [number, number, number][]) {
      const jar = new Mesh(new SphereGeometry(0.2 * s, 16, 12), clay);
      jar.scale.y = 1.15;
      put2(jar, x, 0.23 * s, z);
      put2(new Mesh(new CylinderGeometry(0.09 * s, 0.12 * s, 0.14 * s, 12), clay), x, 0.5 * s, z);
    }

    // bamboo fence
    const bamboo = new MeshStandardMaterial({ color: 0xa8a05a, roughness: 0.9 });
    for (let i = -8; i <= 8; i++) {
      put2(new Mesh(new CylinderGeometry(0.035, 0.035, 1.3, 6), bamboo), i * 0.5, 0.65, -6.5);
    }

    this.add(bake(g2), 0, 0, 0);

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
    this.buildHarvest();
    this.building = 'mars';
    this.buildMonsoon();
    this.building = 'station';
    this.buildRooftop();
    this.building = 'luna';
    this.buildLuna();
    this.building = 'ares';
    this.buildAres();
    this.building = 'orbit';
    this.buildOrbit();
    this.building = 'field';
    this.buildField();
    this.building = 'bil';
    this.buildBil();
    this.building = 'winter';
    this.buildWinter();
    this.building = 'char';
    this.buildChar();
    this.building = 'earth';
    this.showWorld('earth');
  }

  // ------------------------------------------------------------ other worlds
  private showWorld(id: SceneKey, sky: SkyKey | '' = ''): void {
    this.shownWorld = id;
    this.shownSky = sky;
    for (const k of Object.keys(this.groups) as SceneKey[]) {
      for (const m of this.groups[k]) m.visible = k === id || k === sky;
    }
  }

  // ------------------------------------------------------------ scenery helpers
  private put(o: Object3D, x: number, z: number, scale = 1, rotY = 0, y = 0): Object3D {
    o.position.set(x, y, z);
    o.scale.multiplyScalar(scale);
    o.rotation.y += rotY;
    this.world.createTransformEntity(o);
    this.groups[this.building].push(o);
    return o;
  }

  private ring(
    n: number,
    rMin: number,
    rMax: number,
    make: () => Object3D,
    scaleMin = 1,
    scaleMax = 1.4,
    arcFrom = 0,
    arcTo = Math.PI * 2,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = arcFrom + ((i + Math.random() * 0.8) / n) * (arcTo - arcFrom) - Math.PI;
      const r = rMin + Math.random() * (rMax - rMin);
      const o = this.put(make(), Math.sin(a) * r, -Math.cos(a) * r, scaleMin + Math.random() * (scaleMax - scaleMin), Math.random() * 6.28);
      if (o.userData.crown) this.sway.push({ o, phase: Math.random() * 6 });
    }
  }

  private distantKites(n: number, z: number): void {
    const cols = [0xff4d6d, 0xffd23f, 0x4dd2ff, 0x7cf29a, 0xc77dff, 0xff9a3c];
    for (let i = 0; i < n; i++) {
      const geo = new CircleGeometry(0.5, 4);
      geo.scale(0.8, 1.15, 1);
      const m = new Mesh(geo, new MeshBasicMaterial({ color: cols[i % cols.length], side: DoubleSide, fog: false }));
      const x = -26 + (i / n) * 52 + Math.random() * 3;
      const y = 7 + Math.random() * 14;
      this.put(m, x, z - Math.random() * 12, 1.2 + Math.random() * 0.8, 0, y);
      this.farKites.push({ m, x, y, phase: Math.random() * 6 });
    }
  }

  // ------------------------------------------------------------ the village (marbles 1-4)
  private buildVillageExtras(): void {
    this.put(paintedSky({ top: '#3d5f9e', mid: '#e0a06e', horizon: '#ffd6a0', sunU: 0.75, sunV: 0.42, sunColor: '#ffcf8a', cloudColor: '255,214,176', cloudAlpha: 0.5, clouds: 28 }), 0, -0.5, 1, 0, 1.3);
    const g = hazeDisc(70, paddyTexture(), 0xf2c898);
    this.put(g, 0, -1, 1, 0, -0.012);
    this.ring(10, 20, 34, () => palm(rnd(6, 8), rnd(-0.18, 0.18)), 1.0, 1.4, Math.PI * 0.55, Math.PI * 1.45);
    this.ring(5, 14, 24, () => bambooClump(8, rnd(4, 6)), 1, 1.4, Math.PI * 0.6, Math.PI * 1.4);
    this.ring(6, 7, 14, () => bananaPlant(rnd(1.8, 2.5)), 1, 1.3, Math.PI * 0.55, Math.PI * 1.45);
    this.put(hut(), 8.5, -11, 1.0, -0.5);
    this.put(hut(), -9.5, -12, 1.0, 0.6);
    this.put(hut(), 2.5, -19, 1.1, 0.1);
    this.put(haystack(), 4.5, -7, 0.8);
    this.put(water(26, 14, 0x53808a), -14, -18, 1, 0, -0.01);
    this.ring(12, 38, 56, () => shadeTree(rnd(4, 6), rnd(2, 3)), 1.2, 1.9, Math.PI * 0.3, Math.PI * 1.7);
  }

  // ------------------------------------------------------------ harvest field (levels 5-7)
  private buildHarvest(): void {
    this.put(paintedSky({ top: '#3f7fc4', mid: '#9cc7e6', horizon: '#f6e3b5', sunU: 0.7, sunV: 0.36, sunColor: '#fff0c0', clouds: 30, cloudAlpha: 0.6 }), 0, -0.5, 1, 0, 1.3);
    this.put(hazeDisc(70, harvestTexture(), 0xf1deb0), 0, -1, 1, 0, -0.012);
    for (const [x, z, r] of [[-5, -6, 1], [6, -7.5, 1.2], [-9.5, -12, 1.1], [10, -14, 1.2], [1, -18, 1.3]] as number[][]) {
      this.put(haystack(), x, z, r * 0.8);
    }
    this.ring(12, 22, 38, () => palm(rnd(6, 9), rnd(-0.15, 0.15)), 1.0, 1.5, Math.PI * 0.5, Math.PI * 1.5);
    this.ring(12, 38, 58, () => shadeTree(rnd(4.5, 6.5), rnd(2.2, 3.2)), 1.2, 1.9, Math.PI * 0.25, Math.PI * 1.75);
    this.put(hut(), -10, -13, 1.0, 0.7);
    this.put(hut(), 11, -16, 1.0, -0.7);
    this.distantKites(6, -35);
  }

  // ------------------------------------------------------------ monsoon (levels 8-10)
  private buildMonsoon(): void {
    this.put(paintedSky({ top: '#566471', mid: '#8b98a2', horizon: '#c0c8c9', cloudColor: '120,132,142', cloudAlpha: 0.75, clouds: 40 }), 0, -0.5, 1, 0, 1.3);
    this.put(hazeDisc(70, mudTexture(), 0xb6bfc0, 0.55), 0, -1, 1, 0, -0.012);
    this.put(water(60, 30, 0x5d7782), 0, -25, 1, 0, 0.0);
    this.ring(8, 10, 20, () => bananaPlant(rnd(2, 3)), 1, 1.5, Math.PI * 0.5, Math.PI * 1.5);
    this.ring(6, 12, 24, () => bambooClump(9, rnd(5, 7)), 1, 1.5, Math.PI * 0.55, Math.PI * 1.45);
    this.ring(8, 22, 36, () => palm(rnd(6, 8.5), rnd(-0.2, 0.2)), 1.0, 1.4, Math.PI * 0.5, Math.PI * 1.5);
    this.put(hut(), -9, -11, 1.0, 0.6);
    this.put(hut(), 9, -13, 1.0, -0.5);
    this.put(boat(), 4, -16, 1.4, 0.4, 0.02);
    // rain streaks that fall around the player
    for (let i = 0; i < RAIN; i++) {
      this.rainBase[i * 3] = (Math.random() - 0.5) * 16;
      this.rainBase[i * 3 + 1] = Math.random() * 7;
      this.rainBase[i * 3 + 2] = -Math.random() * 14 + 2;
    }
    this.rainGeo = new BufferGeometry();
    this.rainGeo.setAttribute('position', new BufferAttribute(this.rainPos, 3));
    const rain = new LineSegments(
      this.rainGeo,
      new LineBasicMaterial({ color: 0xcfe0ee, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    rain.frustumCulled = false;
    this.put(rain, 0, 0);
    this.rain = rain;
  }

  // ------------------------------------------------------------ Fantasy worlds (optional)
  private buildLuna(): void {
    this.put(paintedSky({ top: '#000004', mid: '#04050a', horizon: '#14151c', stars: 900, clouds: 0 }), 0, -0.5, 1, 0, 1.3);
    this.put(hazeDisc(70, moonTexture(), 0x14151c), 0, -1, 1, 0, -0.012);
    const earth = planet(3.2, 'earth');
    this.put(earth, -14, -40, 1, 0, 16);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 30;
      this.put(boulder(rnd(0.2, 1.1), 0x8a898f), Math.sin(a) * r, -Math.cos(a) * r - 2, 1, Math.random() * 6);
    }
    // a lander leg-and-body silhouette far away
    const lander = new Mesh(new CylinderGeometry(0.9, 1.3, 1.1, 8), new MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.6, roughness: 0.4 }));
    this.put(lander, 9, -16, 1, 0, 1.3);
    for (const dx of [-1.2, 1.2]) for (const dz of [-0.8, 0.8]) {
      const leg = new Mesh(new CylinderGeometry(0.06, 0.06, 1.4, 5), new MeshStandardMaterial({ color: 0xbfc3c8 }));
      leg.rotation.z = -dx * 0.35;
      this.put(leg, 9 + dx, -16 + dz, 1, 0, 0.7);
    }
  }

  private buildAres(): void {
    this.put(paintedSky({ top: '#7a4630', mid: '#c98a62', horizon: '#ecc49a', sunU: 0.7, sunV: 0.4, sunColor: '#fff1d8', clouds: 10, cloudColor: '255,220,190', cloudAlpha: 0.35 }), 0, -0.5, 1, 0, 1.3);
    this.put(hazeDisc(70, marsTexture(), 0xe0a67e), 0, -1, 1, 0, -0.012);
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 34;
      this.put(boulder(rnd(0.2, 1.3), 0x8a4a34), Math.sin(a) * r, -Math.cos(a) * r - 2, 1, Math.random() * 6);
    }
    // big mesa and a small moon in the sky
    this.put(new Mesh(new CylinderGeometry(5, 8, 5, 7), new MeshStandardMaterial({ color: 0x9a5a3c, roughness: 1, flatShading: true })), -22, -34, 1, 0, 2.5);
    this.put(planet(0.9, 'moon'), 20, -38, 1, 0, 14);
  }

  private buildOrbit(): void {
    this.put(paintedSky({ top: '#000006', mid: '#02030a', horizon: '#05060e', stars: 1100, clouds: 0 }), 0, -0.5, 1, 0, 1.3);
    this.put(hazeDisc(40, metalTexture(), 0x05060e), 0, -1, 1, 0, -0.012);
    // Earth hanging below the horizon
    this.put(planet(30, 'earth'), 10, -60, 1, 0, -34);
    // solar panel wings and truss
    const panel = new MeshStandardMaterial({ color: 0x1c3a78, metalness: 0.7, roughness: 0.3 });
    const truss = new MeshStandardMaterial({ color: 0xbfc3c8, metalness: 0.8, roughness: 0.4 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        this.put(new Mesh(new BoxGeometry(4, 0.08, 1.6), panel), side * (6 + i * 4.3), -9, 1, 0, 3 + i * 0.4);
      }
    }
    this.put(new Mesh(new CylinderGeometry(0.25, 0.25, 22, 8), truss), 0, -9, 1, 0, 3.3).rotation.z = Math.PI / 2;
    this.put(new Mesh(new CylinderGeometry(1.4, 1.4, 5, 14), truss), -2.5, -8, 1, 0, 3.3).rotation.z = Math.PI / 2;
  }

  // ------------------------------------------------------------ Dhaka rooftop (levels 11-13)
  private buildRooftop(): void {
    this.put(paintedSky({ top: '#1d2650', mid: '#7a4a78', horizon: '#ff9c62', sunU: 0.72, sunV: 0.47, sunColor: '#ffae70', cloudColor: '255,150,130', cloudAlpha: 0.4, clouds: 24, stars: 160 }), 0, -0.5, 1, 0, 1.3);
    // lit city windows
    const [wc, wg] = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      return [c, c.getContext('2d') as CanvasRenderingContext2D] as const;
    })();
    wg.fillStyle = '#2b2f40';
    wg.fillRect(0, 0, 128, 256);
    for (let y = 8; y < 250; y += 16) {
      for (let x = 6; x < 124; x += 14) {
        wg.fillStyle = Math.random() < 0.45 ? 'rgba(255,214,130,0.95)' : 'rgba(40,46,64,1)';
        wg.fillRect(x, y, 8, 9);
      }
    }
    const wt = new CanvasTexture(wc);
    wt.colorSpace = SRGBColorSpace;
    const bm = new MeshStandardMaterial({ map: wt, emissiveMap: wt, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.9 });
    const flat = new MeshStandardMaterial({ color: 0x5d5858, roughness: 1 });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      const r = 18 + Math.random() * 20;
      const w = 3 + Math.random() * 5;
      const h = 8 + Math.random() * 26;
      const geo = new BoxGeometry(w, h, w);
      const uv = geo.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 3), uv.getY(k) * (h / 8));
      this.put(new Mesh(geo, i % 5 === 0 ? flat : bm), Math.sin(a) * r, -Math.cos(a) * r, 1, a, h / 2 - 0.01);
    }
    // low parapet around the roof
    const wall = new MeshStandardMaterial({ map: cementTexture(), roughness: 1 });
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const seg = new Mesh(new BoxGeometry(1.2, 0.9, 0.25), wall);
      this.put(seg, Math.sin(a) * 5.6, -1 - Math.cos(a) * 5.6, 1, -a, 0.45);
    }
    // water tank and dish
    const tank = new Mesh(new CylinderGeometry(0.7, 0.7, 1.1, 18), new MeshStandardMaterial({ color: 0x2d5f86, roughness: 0.5 }));
    this.put(tank, -3.6, -3.6, 1, 0, 0.55);
    this.put(new Mesh(new CylinderGeometry(0.75, 0.75, 0.05, 18), new MeshStandardMaterial({ color: 0x244d70 })), -3.6, -3.6, 1, 0, 1.12);
    // warm string lights
    const n = 40;
    const lp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      lp[i * 3] = -4.8 + t * 9.6;
      lp[i * 3 + 1] = 2.2 - Math.sin(t * Math.PI) * 0.5;
      lp[i * 3 + 2] = -4.9;
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(lp, 3));
    const lights = new Points(lg, new PointsMaterial({ color: 0xffd9a0, size: 0.12, blending: AdditiveBlending, transparent: true, depthWrite: false }));
    lights.frustumCulled = false;
    this.put(lights, 0, 0);
    this.distantKites(12, -22);
  }


  // ------------------------------------------------------------ kite skies (time of day / weather)
  private skyBuilt = new Set<SkyKey>();
  private static readonly SKY_DEFS: Record<SkyKey, Parameters<typeof paintedSky>[0]> = {
    sky_golden: { top: '#2c5ea6', mid: '#eeb98c', horizon: '#ffe0b4', sunU: 0.68, sunV: 0.34, sunColor: '#ffe6ae', clouds: 42, cloudAlpha: 0.7, cloudColor: '255,226,196' },
    sky_morning: { top: '#6a9bd6', mid: '#f4d3b8', horizon: '#fdeed8', sunU: 0.6, sunV: 0.4, sunColor: '#fff4d6', clouds: 22, cloudAlpha: 0.5, cloudColor: '255,238,222' },
    sky_noon: { top: '#2a78cc', mid: '#86c0ec', horizon: '#e6f1f7', sunU: 0.7, sunV: 0.16, sunColor: '#ffffff', clouds: 34, cloudAlpha: 0.75 },
    sky_cloudy: { top: '#76869a', mid: '#a5b2bd', horizon: '#d4dadc', clouds: 60, cloudAlpha: 0.8, cloudColor: '170,180,190' },
    sky_storm: { top: '#262f3f', mid: '#515c6b', horizon: '#98a1a8', clouds: 70, cloudAlpha: 0.88, cloudColor: '62,70,84' },
  };

  /** Skies are painted on first use: each is a 2048x1024 texture, so building all five up front would waste GPU memory on Quest. */
  private ensureSky(key: SkyKey): void {
    if (this.skyBuilt.has(key)) return;
    this.skyBuilt.add(key);
    const prev = this.building;
    this.building = key;
    this.put(paintedSky(EnvSystem.SKY_DEFS[key]), 0, -0.5, 1, 0, 1.3);
    if (key === 'sky_storm') {
      const stormRain = new LineSegments(
        this.rainGeo,
        new LineBasicMaterial({ color: 0xd8e6f2, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      stormRain.frustumCulled = false;
      this.put(stormRain, 0, 0);
    }
    this.building = prev;
  }

  // ------------------------------------------------------------ monsoon beel: endless water, lilies, boats, stilt huts
  private buildBil(): void {
    this.put(hazeDisc(70, mudTexture(), 0xcfe0e6, 0.55), 0, -1, 1, 0, -0.03);
    this.put(water(140, 90, 0x4c8a98), 0, -32, 1, 0, 0.0);
    for (let i = 0; i < 7; i++) this.put(lilyPads(26, 5), rnd(-14, 14), -rnd(3, 22), 1, 0, 0.0);
    this.put(boat(), -4, -9, 1.5, 0.4, 0.02);
    this.put(boat(), 7, -14, 1.4, -0.5, 0.02);
    this.put(boat(), -12, -20, 1.3, 0.9, 0.02);
    // islands of palms, banana and huts rising from the water
    for (const [x, z] of [[-18, -26], [16, -30], [2, -42], [-30, -16]] as [number, number][]) {
      const isle = new Mesh(new CylinderGeometry(rnd(3, 5), rnd(4, 6), 0.3, 20), new MeshStandardMaterial({ color: 0x5f7a38, roughness: 1 }));
      this.put(isle, x, z, 1, 0, 0.05);
      this.put(hut(), x + rnd(-1, 1), z + rnd(-1, 1), 1.1, rnd(0, 6), 0.2);
      this.put(palm(rnd(6, 9), rnd(-0.2, 0.2)), x + 2, z, 1, 0, 0.2);
      this.put(palm(rnd(5, 8), rnd(-0.2, 0.2)), x - 2, z + 1, 1, 0, 0.2);
      this.put(bananaPlant(rnd(2, 2.6)), x + 1.2, z + 1.8, 1, 0, 0.2);
    }
    this.ring(10, 40, 60, () => palm(rnd(6, 9), rnd(-0.2, 0.2)), 1, 1.5, Math.PI * 0.4, Math.PI * 1.6);
    for (let i = 0; i < 4; i++) {
      const mb = mistBank(rnd(34, 48), rnd(3, 5), '230,240,244', 0.4);
      this.put(mb, rnd(-12, 12), -12 - i * 8, 1, 0, 1.0 + i * 0.3);
      this.mists.push({ m: mb, x: mb.position.x, s: rnd(0.04, 0.1) * (i % 2 ? 1 : -1) });
    }
    this.distantKites(8, -34);
    const egretMat = new MeshBasicMaterial({ color: 0xfafaf4, side: DoubleSide });
    for (let i = 0; i < 9; i++) {
      const b = new Mesh(birdGeo, egretMat);
      this.put(b, 0, -20, 1, 0, 3);
      b.scale.set(2.4, 2.4, 2.4);
      this.egrets.push({ m: b, a: Math.random() * 6.28, r: 8 + Math.random() * 12, h: 1.2 + Math.random() * 2.5, s: 0.08 + Math.random() * 0.06 });
    }
  }

  // ------------------------------------------------------------ winter field: stubble, mustard, haystacks, mist
  private buildWinter(): void {
    this.put(hazeDisc(70, winterTexture(), 0xe4dfcc), 0, -1, 1, 0, -0.012);
    this.put(grassField(700, 1.5, 9), 0, 0, 1, 0, 0);
    for (let i = 0; i < 6; i++) this.put(haystack(rnd(0.8, 1.1), rnd(1.5, 1.9)), rnd(-16, 16), -rnd(6, 26), 1);
    this.ring(7, 28, 46, () => shadeTree(rnd(4.5, 6), rnd(2, 3)), 1, 1.8);
    this.ring(8, 22, 40, () => palm(rnd(6, 9), rnd(-0.2, 0.2)), 1, 1.4, Math.PI * 0.45, Math.PI * 1.55);
    this.ring(4, 12, 24, () => bambooClump(8, rnd(5, 7)), 1, 1.4, Math.PI * 0.55, Math.PI * 1.45);
    this.put(hut(), 12, -14, 1.2, -0.8);
    this.put(hut(), -14, -18, 1.2, 0.7);
    for (let i = 0; i < 6; i++) {
      const mb = mistBank(rnd(36, 50), rnd(3, 5), '245,242,232', 0.55);
      this.put(mb, rnd(-12, 12), -8 - i * 6, 1, 0, 0.6 + i * 0.25);
      this.mists.push({ m: mb, x: mb.position.x, s: rnd(0.04, 0.1) * (i % 2 ? 1 : -1) });
    }
    this.distantKites(10, -28);
    for (let i = 0; i < 9; i++) {
      const b = new Mesh(birdGeo, birdMat);
      this.put(b, 0, -30, 1, 0, 9);
      this.farBirds.push({ m: b, a: Math.random() * 6.28, r: 22 + Math.random() * 10, h: 8 + Math.random() * 6, s: 0.12 + Math.random() * 0.08 });
    }
  }

  // ------------------------------------------------------------ river char: wide sand, kash flowers, river, strong wind
  private buildChar(): void {
    this.put(hazeDisc(70, sandTexture(), 0xe9dcc0), 0, -1, 1, 0, -0.012);
    this.put(water(140, 34, 0x5d8fa0), 0, -34, 1, 0, 0.006);
    this.put(water(40, 12, 0x5d8fa0), 22, -12, 1, 0.5, 0.004);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 22;
      const k = this.put(kashClump(rnd(10, 18), rnd(1.1, 1.9)), Math.sin(a) * r, -Math.cos(a) * r - 1, 1, Math.random() * 6);
      k.userData.crown = k.children[0] ?? k;
      this.sway.push({ o: k, phase: Math.random() * 6 });
    }
    this.put(boat(), -6, -28, 1.7, 0.2, 0.02);
    this.put(boat(), 10, -30, 1.5, -0.4, 0.02);
    this.put(hut(), -16, -8, 1.1, 0.6);
    this.put(haystack(0.9, 1.6), -13, -6, 1);
    this.ring(8, 50, 64, () => shadeTree(rnd(5, 7), rnd(2.4, 3.4)), 1.2, 2, Math.PI * 0.3, Math.PI * 1.7);
    this.ring(6, 40, 56, () => palm(rnd(6, 9), rnd(-0.2, 0.2)), 1, 1.5, Math.PI * 0.3, Math.PI * 1.7);
    for (let i = 0; i < 3; i++) {
      const mb = mistBank(rnd(34, 46), rnd(2, 4), '250,238,214', 0.3);
      this.put(mb, rnd(-12, 12), -10 - i * 10, 1, 0, 0.8 + i * 0.3);
      this.mists.push({ m: mb, x: mb.position.x, s: rnd(0.08, 0.16) * (i % 2 ? 1 : -1) });
    }
    this.distantKites(12, -26);
    const egretMat = new MeshBasicMaterial({ color: 0xfafaf4, side: DoubleSide });
    for (let i = 0; i < 8; i++) {
      const b = new Mesh(birdGeo, egretMat);
      this.put(b, 0, -20, 1, 0, 3);
      b.scale.set(2.4, 2.4, 2.4);
      this.egrets.push({ m: b, a: Math.random() * 6.28, r: 9 + Math.random() * 12, h: 1.5 + Math.random() * 2.5, s: 0.1 + Math.random() * 0.06 });
    }
  }

  // ------------------------------------------------------------ open countryside (kite + lattim)
  private buildField(): void {
    this.put(hazeDisc(70, paddyTexture(), 0xf2dcb4), 0, -1, 1, 0, -0.012);
    // close-range paddy tufts: gives the ground real depth next to the player
    this.put(grassField(1100, 1.5, 10), 0, 0, 1, 0, 0);
    // sun shafts fanning down from the low sun
    const sunX = 22;
    const sunY = 30;
    for (let i = 0; i < 6; i++) {
      const bx = sunX - rnd(6, 34);
      const dx = sunX - bx;
      const dy = sunY - 2;
      const len = Math.hypot(dx, dy);
      const sh = sunShaft(len, rnd(3, 7));
      sh.position.set((sunX + bx) / 2, (sunY + 2) / 2, -46);
      sh.rotation.z = Math.atan2(-dx, dy);
      this.put(sh, sh.position.x, -46, 1, 0, sh.position.y);
      sh.rotation.z = Math.atan2(-dx, dy);
    }
    // ground mist banks drifting between field and trees
    for (let i = 0; i < 4; i++) {
      const mb = mistBank(rnd(30, 44), rnd(3, 5));
      this.put(mb, rnd(-12, 12), -14 - i * 7, 1, 0, 1.0 + i * 0.3);
      this.mists.push({ m: mb, x: mb.position.x, s: rnd(0.05, 0.12) * (i % 2 ? 1 : -1) });
    }
    // beel (wetland) with boats
    this.put(water(44, 22, 0x4d8c98), -9, -22, 1, 0, -0.005);
    this.put(boat(), -6, -20, 1.5, 0.3, 0.01);
    this.put(boat(), -15, -26, 1.3, -0.6, 0.01);
    this.ring(14, 22, 38, () => palm(rnd(6, 9), rnd(-0.2, 0.2)), 1.0, 1.5, Math.PI * 0.45, Math.PI * 1.55);
    this.ring(5, 18, 30, () => bambooClump(9, rnd(5, 7)), 1, 1.5, Math.PI * 0.6, Math.PI * 1.4);
    this.ring(7, 8, 16, () => bananaPlant(rnd(2, 2.8)), 1, 1.4, Math.PI * 0.5, Math.PI * 1.5);
    this.ring(14, 40, 60, () => shadeTree(rnd(5, 7), rnd(2.4, 3.4)), 1.2, 2);
    this.put(hut(), 14, -20, 1.2, -0.7);
    this.put(hut(), 20, -12, 1.2, -1.1);
    this.put(hut(), -17, -18, 1.2, 0.6);
    this.put(haystack(), 7, -9, 0.9);
    this.put(haystack(), -7, -8, 0.8);
    // distant children's kites high over the paddy
    this.distantKites(9, -30);
    // egrets gliding low over the paddy
    const egretMat = new MeshBasicMaterial({ color: 0xfafaf4, side: DoubleSide });
    for (let i = 0; i < 7; i++) {
      const b = new Mesh(birdGeo, egretMat);
      this.put(b, 0, -20, 1, 0, 3);
      b.scale.set(2.4, 2.4, 2.4);
      this.egrets.push({ m: b, a: Math.random() * 6.28, r: 9 + Math.random() * 8, h: 2 + Math.random() * 2.5, s: 0.08 + Math.random() * 0.06 });
    }
    // a loose flock far away
    for (let i = 0; i < 9; i++) {
      const b = new Mesh(birdGeo, birdMat);
      b.rotation.y = 0;
      this.put(b, 0, -30, 1, 0, 9);
      this.farBirds.push({ m: b, a: Math.random() * 6.28, r: 22 + Math.random() * 10, h: 8 + Math.random() * 6, s: 0.12 + Math.random() * 0.08 });
    }
  }

  update(dt: number): void {
    this.t += dt;
    const inKite = modeState.mode === 'kite';
    const want: SceneKey = inKite
      ? kiteCfg.place === 'village'
        ? 'field'
        : kiteCfg.place
      : modeState.mode === 'lattim' || modeState.mode === 'danguli' || modeState.mode === 'pottery' || modeState.mode === 'kitecraft' || modeState.mode === 'marblerun'
        ? 'field'
        : worldState.id;
    const skyWant: SkyKey | '' =
      want === 'field' || want === 'bil' || want === 'winter' || want === 'char'
        ? ((inKite ? 'sky_' + kiteCfg.time : 'sky_golden') as SkyKey)
        : '';
    if (skyWant) this.ensureSky(skyWant);
    if (want !== this.shownWorld || skyWant !== this.shownSky) this.showWorld(want, skyWant);
    const open = want === 'field' || want === 'bil' || want === 'winter' || want === 'char';
    for (const sp of this.spinners) sp.rotation.y += dt * 0.02;
    for (const c of this.clouds) {
      c.position.x += dt * 0.15;
      if (c.position.x > 18) c.position.x = -18;
    }
    for (const s of this.sway) {
      const crown = s.o.userData.crown as Object3D;
      crown.rotation.z = Math.sin(this.t * 0.9 + s.phase) * 0.05;
      crown.rotation.x = Math.sin(this.t * 0.7 + s.phase * 1.7) * 0.04;
    }
    if (open || want === 'moon' || want === 'station') {
      for (const k of this.farKites) {
        k.m.position.x = k.x + Math.sin(this.t * 0.35 + k.phase) * 1.6;
        k.m.position.y = k.y + Math.sin(this.t * 0.5 + k.phase * 2) * 0.9;
        k.m.rotation.z = Math.sin(this.t * 0.6 + k.phase) * 0.25;
      }
    }
    if (open) {
      for (const b of this.farBirds) {
        const a = b.a + this.t * b.s;
        b.m.position.set(Math.sin(a) * b.r, b.h + Math.sin(this.t * 0.8 + b.a) * 0.6, -Math.cos(a) * b.r - 4);
        b.m.rotation.y = -a;
        b.m.scale.y = 1;
        b.m.rotation.z = Math.sin(this.t * 9 + b.a * 7) * 0.5;
      }
    }
    if (open) {
      for (const mi of this.mists) {
        mi.x += mi.s * dt;
        if (Math.abs(mi.x) > 22) mi.s = -mi.s;
        mi.m.position.x = mi.x;
      }
      for (const b of this.egrets) {
        const a = b.a + this.t * b.s;
        b.m.position.set(Math.sin(a) * b.r, b.h + Math.sin(this.t * 0.9 + b.a) * 0.3, -Math.cos(a) * b.r - 6);
        b.m.rotation.y = -a;
        b.m.rotation.z = Math.sin(this.t * 4 + b.a * 7) * 0.35;
      }
    }
    if ((want === 'mars' || skyWant === 'sky_storm') && this.rain) {
      for (let i = 0; i < RAIN; i++) {
        const fall = (this.rainBase[i * 3 + 1] - this.t * 7.5) % 7;
        const y = fall < 0 ? fall + 7 : fall;
        const x = this.rainBase[i * 3] + y * 0.12;
        const z = this.rainBase[i * 3 + 2];
        this.rainPos[i * 6] = x;
        this.rainPos[i * 6 + 1] = y;
        this.rainPos[i * 6 + 2] = z;
        this.rainPos[i * 6 + 3] = x + 0.015;
        this.rainPos[i * 6 + 4] = y + 0.25;
        this.rainPos[i * 6 + 5] = z;
      }
      (this.rainGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
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
