import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  InstancedMesh,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Material,
  MeshStandardMaterial,
  Matrix4,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
} from '@iwsdk/core';

/**
 * Procedural Bangladeshi countryside: painted sky, paddy ground, palms, bamboo,
 * banana plants, tin-roof huts, haystacks. Shared geometry and materials keep
 * draw calls low for the Quest.
 */

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * Merge every mesh under `root` into one mesh per material (transforms baked in).
 * Cuts draw calls a lot on Quest; use it for anything static.
 */
export function bake(root: Object3D): Group {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<Material, { pos: number[]; nor: number[]; uv: number[]; idx: number[] }>();
  const m4 = new Matrix4();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry.clone();
    m4.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(m4);
    const mat = m.material as Material;
    let b = buckets.get(mat);
    if (!b) {
      b = { pos: [], nor: [], uv: [], idx: [] };
      buckets.set(mat, b);
    }
    const base = b.pos.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      b.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) b.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      else b.nor.push(0, 1, 0);
      if (u) b.uv.push(u.getX(i), u.getY(i));
      else b.uv.push(0, 0);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) b.idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) b.idx.push(base + i);
    g.dispose();
  });
  const out = new Group();
  buckets.forEach((b, mat) => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
    geo.setIndex(new BufferAttribute(new Uint32Array(b.idx), 1));
    out.add(new Mesh(geo, mat));
  });
  return out;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function tex(c: HTMLCanvasElement, rx = 1, ry = 1): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ sky
export interface SkyOpts {
  top: string;
  mid: string;
  horizon: string;
  /** sun position on the dome texture, 0..1 */
  sunU?: number;
  sunV?: number;
  sunColor?: string;
  cloudColor?: string;
  cloudAlpha?: number;
  clouds?: number;
  stars?: number;
}

/** Big gradient dome with soft, layered painted clouds and a sun glow. */
export function paintedSky(o: SkyOpts): Mesh {
  const W = 2048;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H * 0.52);
  grad.addColorStop(0, o.top);
  grad.addColorStop(0.55, o.mid);
  grad.addColorStop(0.84, o.mid);
  grad.addColorStop(1, o.horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // below the horizon: keep the haze colour so the ground fades into it
  g.fillStyle = o.horizon;
  g.fillRect(0, H * 0.5, W, H * 0.5);
  if (o.sunU !== undefined && o.sunV !== undefined) {
    const sx = o.sunU * W;
    const sy = o.sunV * H;
    const glow = g.createRadialGradient(sx, sy, 4, sx, sy, 210);
    glow.addColorStop(0, (o.sunColor ?? '#fff3c4') + 'ff');
    glow.addColorStop(0.08, (o.sunColor ?? '#fff3c4') + 'cc');
    glow.addColorStop(0.35, (o.sunColor ?? '#fff3c4') + '30');
    glow.addColorStop(1, (o.sunColor ?? '#fff3c4') + '00');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  }
  const cc = o.cloudColor ?? '255,255,255';
  const n = o.clouds ?? 26;
  for (let i = 0; i < n; i++) {
    const cx = Math.random() * W;
    // cumulus band: bigger and brighter near the horizon, wispy higher up
    const cy = H * (0.2 + Math.random() * 0.27);
    const size = rnd(60, 190) * (0.7 + (cy / H) * 1.1);
    for (let j = 0; j < 14; j++) {
      const bx = cx + rnd(-1, 1) * size * 1.2;
      const by = cy + rnd(-0.35, 0.25) * size * 0.5;
      const br = rnd(0.35, 0.8) * size;
      const rg = g.createRadialGradient(bx, by, 0, bx, by, br);
      const a = (o.cloudAlpha ?? 0.55) * rnd(0.5, 1);
      rg.addColorStop(0, 'rgba(' + cc + ',' + a + ')');
      rg.addColorStop(0.6, 'rgba(' + cc + ',' + a * 0.4 + ')');
      rg.addColorStop(1, 'rgba(' + cc + ',0)');
      g.fillStyle = rg;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
  }
  for (let i = 0; i < (o.stars ?? 0); i++) {
    g.fillStyle = 'rgba(255,255,255,' + rnd(0.3, 0.9) + ')';
    g.fillRect(Math.random() * W, Math.random() * H * 0.45, 1.5, 1.5);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const dome = new Mesh(
    new SphereGeometry(70, 48, 24),
    new MeshBasicMaterial({ map: t, side: BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

// ------------------------------------------------------------------ ground
/** A disc whose outer ring fades into the horizon haze colour. */
export function hazeDisc(radius: number, texture: CanvasTexture, haze: number, rough = 1): Mesh {
  const geo = new CircleGeometry(radius, 64, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const hr = ((haze >> 16) & 255) / 255;
  const hg = ((haze >> 8) & 255) / 255;
  const hb = (haze & 255) / 255;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getZ(i)) / radius;
    const f = Math.min(1, Math.max(0, (d - 0.35) / 0.6));
    const k = f * f;
    col[i * 3] = 1 + (hr - 1) * k;
    col[i * 3 + 1] = 1 + (hg - 1) * k;
    col[i * 3 + 2] = 1 + (hb - 1) * k;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4 + 0.37, pos.getZ(i) / 4 + 0.43);
  return new Mesh(
    geo,
    new MeshStandardMaterial({ map: texture, vertexColors: true, roughness: rough }),
  );
}

export function paddyTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#5f9a3a';
  g.fillRect(0, 0, 512, 512);
  // transplanted rice rows
  for (let y = 0; y < 512; y += 12) {
    g.fillStyle = y % 24 === 0 ? 'rgba(40,100,30,0.35)' : 'rgba(150,200,80,0.25)';
    g.fillRect(0, y, 512, 6);
  }
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle =
      v < 0.5
        ? 'rgba(' + (70 + v * 90) + ',' + (140 + v * 80) + ',50,0.5)'
        : 'rgba(30,' + (80 + v * 60) + ',30,0.4)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 4 + Math.random() * 6);
  }
  // muddy bunds (aal) crossing the field
  g.fillStyle = 'rgba(120,92,58,0.9)';
  g.fillRect(0, 0, 512, 10);
  g.fillRect(0, 0, 10, 512);
  return tex(c, 1, 1);
}

export function harvestTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#c9a85a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 12000; i++) {
    const v = Math.random();
    g.fillStyle =
      v < 0.5
        ? 'rgba(' + (200 + v * 50) + ',' + (160 + v * 60) + ',80,0.55)'
        : 'rgba(' + (140 + v * 40) + ',' + (105 + v * 30) + ',55,0.5)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 3 + Math.random() * 7);
  }
  for (let y = 0; y < 512; y += 16) {
    g.fillStyle = 'rgba(90,60,30,0.12)';
    g.fillRect(0, y, 512, 3);
  }
  return tex(c, 1, 1);
}

export function mudTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#4b3a2a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = 'rgba(' + v + ',' + v * 0.78 + ',' + v * 0.55 + ',0.5)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 7, 2 + Math.random() * 7);
  }
  // puddles reflecting the grey sky
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const rg = g.createRadialGradient(x, y, 2, x, y, rnd(18, 48));
    rg.addColorStop(0, 'rgba(150,170,185,0.85)');
    rg.addColorStop(0.8, 'rgba(110,125,135,0.55)');
    rg.addColorStop(1, 'rgba(80,80,70,0)');
    g.fillStyle = rg;
    g.fillRect(x - 60, y - 60, 120, 120);
  }
  return tex(c, 1, 1);
}

export function cementTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#8f8c86';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 110 + Math.random() * 60;
    g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v - 4) + ',0.35)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  // stains and hairline cracks
  g.strokeStyle = 'rgba(40,40,40,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    g.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += rnd(-24, 24);
      y += rnd(-24, 24);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(40,40,40,0.28)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 512, 512);
  return tex(c, 1, 1);
}

// ------------------------------------------------------------------ plants
const trunkMat = new MeshStandardMaterial({ color: 0x7c6a52, roughness: 1 });
const frondMat = new MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.75, side: DoubleSide });
const frondMat2 = new MeshStandardMaterial({ color: 0x57a043, roughness: 0.75, side: DoubleSide });
const bambooMat = new MeshStandardMaterial({ color: 0x9fae4a, roughness: 0.7 });
const bambooLeaf = new MeshStandardMaterial({ color: 0x6d9a2c, roughness: 0.8, side: DoubleSide });
const bananaMat = new MeshStandardMaterial({ color: 0x5fa83a, roughness: 0.6, side: DoubleSide });

/** One drooping palm leaf: a bent, tapered strip. */
function frondGeo(len: number, width: number, droop: number): BufferGeometry {
  const seg = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (1 - t * 0.45);
    const x = t * len;
    const y = Math.sin(t * 1.4) * len * 0.22 - droop * t * t * len;
    pos.push(x, y, -w, x, y, w);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const palmFrond = frondGeo(1.5, 0.16, 0.55);
const bananaLeaf = frondGeo(1.3, 0.3, 0.35);
const palmTrunkGeo = new CylinderGeometry(0.06, 0.1, 1, 8, 5);

/** Coconut or betel-nut palm. Height in metres. */
export function palm(h: number, lean = 0.12): Group {
  const grp = new Group();
  const trunk = new Mesh(palmTrunkGeo, trunkMat);
  trunk.scale.y = h;
  trunk.position.y = h / 2;
  grp.add(trunk);
  const crown = new Group();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const f = new Mesh(palmFrond, i % 2 ? frondMat : frondMat2);
    f.rotation.y = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
    f.rotation.z = rnd(0.15, 0.55);
    f.scale.setScalar(rnd(0.85, 1.15) * (h / 5));
    crown.add(f);
  }
  const baked = bake(crown);
  baked.position.set(0, h, 0);
  grp.add(baked);
  grp.rotation.z = lean;
  grp.userData.crown = baked;
  return grp;
}

/** A clump of bamboo culms with leafy tops. */
export function bambooClump(n = 7, h = 5): Group {
  const grp = new Group();
  const culm = new CylinderGeometry(0.025, 0.04, 1, 6, 4);
  const leafGeo = frondGeo(0.8, 0.07, 0.4);
  for (let i = 0; i < n; i++) {
    const hh = h * rnd(0.75, 1.1);
    const a = rnd(0, Math.PI * 2);
    const r = rnd(0.05, 0.35);
    const g2 = new Group();
    const m = new Mesh(culm, bambooMat);
    m.scale.y = hh;
    m.position.y = hh / 2;
    g2.add(m);
    for (let k = 0; k < 7; k++) {
      const l = new Mesh(leafGeo, bambooLeaf);
      l.position.y = hh - rnd(0, 0.9);
      l.rotation.y = rnd(0, 6.28);
      l.rotation.z = rnd(0.3, 0.9);
      g2.add(l);
    }
    g2.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g2.rotation.set(Math.cos(a) * 0.14, 0, -Math.sin(a) * 0.14);
    grp.add(g2);
  }
  return bake(grp);
}

export function bananaPlant(h = 2.2): Group {
  const grp = new Group();
  const stem = new Mesh(new CylinderGeometry(0.06, 0.1, h, 8), bananaMat);
  stem.position.y = h / 2;
  grp.add(stem);
  for (let i = 0; i < 7; i++) {
    const l = new Mesh(bananaLeaf, bananaMat);
    l.position.y = h * rnd(0.85, 1);
    l.rotation.y = (i / 7) * Math.PI * 2 + rnd(-0.2, 0.2);
    l.rotation.z = rnd(0.25, 0.6);
    grp.add(l);
  }
  return bake(grp);
}

/** A round-leaf shade tree (mango / jackfruit): trunk plus layered canopy blobs. */
export function shadeTree(h = 3.4, r = 1.5): Group {
  const grp = new Group();
  const bark = new MeshStandardMaterial({ color: 0x4b3a2a, roughness: 1 });
  const t = new Mesh(new CylinderGeometry(0.14, 0.24, h, 8), bark);
  t.position.y = h / 2;
  grp.add(t);
  const mats = [
    new MeshStandardMaterial({ color: 0x2d6a31, roughness: 0.9, flatShading: true }),
    new MeshStandardMaterial({ color: 0x3a7d37, roughness: 0.9, flatShading: true }),
    new MeshStandardMaterial({ color: 0x255a2b, roughness: 0.9, flatShading: true }),
  ];
  const geo = new SphereGeometry(1, 9, 7);
  for (let i = 0; i < 7; i++) {
    const b = new Mesh(geo, mats[i % 3]);
    const a = (i / 7) * Math.PI * 2;
    const rr = i === 0 ? 0 : r * 0.55;
    b.position.set(Math.cos(a) * rr, h + rnd(-0.2, 0.5) + (i === 0 ? 0.5 : 0), Math.sin(a) * rr);
    b.scale.set(r * rnd(0.55, 0.8), r * rnd(0.45, 0.6), r * rnd(0.55, 0.8));
    grp.add(b);
  }
  return bake(grp);
}

// ------------------------------------------------------------------ buildings
let tinTex: CanvasTexture | null = null;
function tinTexture(): CanvasTexture {
  if (tinTex) return tinTex;
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#9aa7ad';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.45)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 8, 128);
  }
  // rust streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(140,70,30,' + rnd(0.05, 0.25) + ')';
    g.fillRect(Math.random() * 128, Math.random() * 60, rnd(1, 4), rnd(20, 70));
  }
  tinTex = tex(c, 2, 1);
  return tinTex;
}

let wallTex: CanvasTexture | null = null;
function wallTexture(): CanvasTexture {
  if (wallTex) return wallTex;
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b08a5e';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = 120 + Math.random() * 60;
    g.fillStyle = 'rgba(' + v + ',' + v * 0.76 + ',' + v * 0.52 + ',0.4)';
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.fillStyle = 'rgba(70,45,25,0.25)';
  g.fillRect(0, 100, 128, 28); // damp, darker base
  wallTex = tex(c, 1, 1);
  return wallTex;
}

const wallMat = new MeshStandardMaterial({ map: wallTexture(), roughness: 1 });
const tinMat = new MeshStandardMaterial({ map: tinTexture(), roughness: 0.45, metalness: 0.55, side: DoubleSide });
const woodDark = new MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.9 });
const thatchMat = new MeshStandardMaterial({ color: 0xb59a52, roughness: 1, flatShading: true });

/** Classic tin-roofed village ghor with a veranda and a bamboo-post porch. About 4 x 3 m. */
export function hut(): Group {
  const grp = new Group();
  const w = 3.6;
  const d = 2.6;
  const wh = 1.9;
  const walls = new Mesh(new BoxGeometry(w, wh, d), wallMat);
  walls.position.y = wh / 2;
  grp.add(walls);
  // gable roof: two slopes with a visible overhang
  const slope = 0.62;
  const roofW = d / 2 / Math.cos(slope) + 0.45;
  for (const s of [-1, 1]) {
    const r = new Mesh(new BoxGeometry(w + 0.7, 0.05, roofW), tinMat);
    r.position.set(0, wh + Math.sin(slope) * (roofW / 2) - 0.02, s * (d / 4 + 0.1));
    r.rotation.x = s * slope;
    grp.add(r);
  }
  // gable ends (mud triangles)
  const gable = new Mesh(new ConeGeometry(d / 2 + 0.05, 1.25, 4), wallMat);
  gable.rotation.y = Math.PI / 4;
  gable.scale.set(0.001 + w / d, 1, 1);
  gable.position.set(0, wh + 0.62, 0);
  gable.scale.set(1, 1, 1);
  gable.visible = false; // the roof alone reads better from afar
  grp.add(gable);
  // door, window, veranda posts
  const door = new Mesh(new BoxGeometry(0.75, 1.5, 0.06), woodDark);
  door.position.set(-0.5, 0.75, d / 2 + 0.03);
  grp.add(door);
  const win = new Mesh(new BoxGeometry(0.55, 0.5, 0.06), woodDark);
  win.position.set(0.9, 1.15, d / 2 + 0.03);
  grp.add(win);
  const post = new CylinderGeometry(0.05, 0.06, wh, 6);
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    const p = new Mesh(post, bambooMat);
    p.position.set(x, wh / 2, d / 2 + 0.55);
    grp.add(p);
  }
  const veranda = new Mesh(new BoxGeometry(w + 0.5, 0.04, 0.85), tinMat);
  veranda.position.set(0, wh - 0.05, d / 2 + 0.5);
  veranda.rotation.x = 0.12;
  grp.add(veranda);
  const plinth = new Mesh(new BoxGeometry(w + 0.4, 0.2, d + 0.4), wallMat);
  plinth.position.y = 0.1;
  grp.add(plinth);
  return bake(grp);
}

export function haystack(r = 0.9, h = 1.7): Group {
  const grp = new Group();
  const base = new Mesh(new CylinderGeometry(r, r * 1.05, h * 0.55, 10), thatchMat);
  base.position.y = h * 0.275;
  grp.add(base);
  const top = new Mesh(new ConeGeometry(r * 1.0, h * 0.6, 10), thatchMat);
  top.position.y = h * 0.55 + h * 0.3;
  grp.add(top);
  return bake(grp);
}

/** Small country boat (nouka) for the beel. */
export function boat(): Group {
  const grp = new Group();
  const wood = new MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 });
  const hull = new Mesh(new CylinderGeometry(0.5, 0.35, 3.2, 10, 1, false, 0, Math.PI), wood);
  hull.rotation.z = Math.PI / 2;
  hull.rotation.x = Math.PI;
  hull.scale.set(1, 1, 0.55);
  hull.position.y = 0.18;
  grp.add(hull);
  const canopy = new Mesh(
    new CylinderGeometry(0.42, 0.42, 1.3, 10, 1, true, 0, Math.PI),
    new MeshStandardMaterial({ color: 0xc9b27a, roughness: 1, side: DoubleSide }),
  );
  canopy.rotation.z = Math.PI / 2;
  canopy.position.y = 0.55;
  grp.add(canopy);
  return bake(grp);
}

/** Calm beel (wetland) water with a sheen. */
export function water(w: number, d: number, color = 0x3f7f8c): Mesh {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = 'rgba(255,255,255,' + rnd(0.04, 0.16) + ')';
    g.lineWidth = rnd(1, 2.5);
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rnd(10, 36), y + rnd(-2, 2));
    g.stroke();
  }
  const m = new Mesh(
    new PlaneGeometry(w, d),
    new MeshStandardMaterial({ map: tex(c, 3, 3), roughness: 0.08, metalness: 0.3, envMapIntensity: 1.6 }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}


// ------------------------------------------------------------------ close-range detail
let grassTex: CanvasTexture | null = null;
function grassTexture(): CanvasTexture {
  if (grassTex) return grassTex;
  const [c, g] = canvas(128, 128);
  for (let i = 0; i < 16; i++) {
    const x = 10 + Math.random() * 108;
    const lean = rnd(-26, 26);
    const top = rnd(8, 60);
    const grad = g.createLinearGradient(0, 128, 0, top);
    grad.addColorStop(0, '#4a8a30');
    grad.addColorStop(0.6, '#8fce52');
    grad.addColorStop(1, '#d9e58a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - 3, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - (128 - top) * 0.6, x + lean, top);
    g.quadraticCurveTo(x + lean * 0.3 + 2, 128 - (128 - top) * 0.55, x + 3, 128);
    g.fill();
  }
  grassTex = new CanvasTexture(c);
  grassTex.colorSpace = SRGBColorSpace;
  return grassTex;
}

/** Thousands of paddy/grass tufts around the player as one draw call (crossed quads). */
export function grassField(count: number, rMin: number, rMax: number): InstancedMesh {
  const a = new PlaneGeometry(0.32, 0.32);
  a.translate(0, 0.16, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const parts = [a, b];
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const p of parts) {
    const pp = p.getAttribute('position');
    const uu = p.getAttribute('uv');
    for (let i = 0; i < pp.count; i++) {
      pos.push(pp.getX(i), pp.getY(i), pp.getZ(i));
      uv.push(uu.getX(i), uu.getY(i));
      nor.push(0, 1, 0);
    }
    const ii = p.getIndex();
    if (ii) for (let i = 0; i < ii.count; i++) idx.push(ii.getX(i) + base);
    base += pp.count;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setIndex(idx);
  const mesh = new InstancedMesh(
    geo,
    new MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.4, side: DoubleSide, roughness: 1 }),
    count,
  );
  const m = new Matrix4();
  const rot = new Matrix4();
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = rMin + Math.sqrt(Math.random()) * (rMax - rMin);
    const sc = rnd(0.7, 1.3);
    m.makeScale(sc, sc * rnd(0.7, 1.2), sc);
    rot.makeRotationY(Math.random() * 6.28);
    m.premultiply(rot);
    m.setPosition(Math.sin(ang) * r, 0, -Math.cos(ang) * r);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** A soft slanted sun shaft: bright near the sun, fading toward the ground. */
export function sunShaft(len: number, width: number, color = '255,236,180'): Mesh {
  const [c, g] = canvas(64, 256);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(' + color + ',0)');
  h.addColorStop(0.5, 'rgba(' + color + ',1)');
  h.addColorStop(1, 'rgba(' + color + ',0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(0,0,0,1)');
  v.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(width, len),
    new MeshBasicMaterial({ map: t, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide }),
  );
  mesh.renderOrder = -5;
  return mesh;
}

/** A low band of ground mist; drifts sideways for depth between the paddy and the trees. */
export function mistBank(w: number, h: number, color = '255,236,205', alpha = 0.4): Mesh {
  const [c, g] = canvas(256, 64);
  const grad = g.createRadialGradient(128, 40, 4, 128, 40, 128);
  grad.addColorStop(0, 'rgba(' + color + ',' + alpha + ')');
  grad.addColorStop(0.6, 'rgba(' + color + ',' + alpha * 0.4 + ')');
  grad.addColorStop(1, 'rgba(' + color + ',0)');
  g.save();
  g.scale(1, 0.5);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.restore();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false }),
  );
  mesh.renderOrder = -4;
  return mesh;
}
