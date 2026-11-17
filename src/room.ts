import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

/**
 * The cinematic atelier: dark wainscoted walls, varnished plank floor, Persian rug, a tall dusk window
 * with curtains and slanting light shafts, filled bookcases, framed paintings, brass sconces and a
 * three-bulb Edison pendant. Everything is procedural (canvas textures, primitives): no asset files.
 */
let seed = 1;
const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function tex(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function plankTexture(): CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  const rows = 24;
  const h = 1024 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 400;
    while (x < 1024) {
      const len = 300 + rnd() * 420;
      const l = 17 + rnd() * 9;
      g.fillStyle = `hsl(${20 + rnd() * 6},${34 + rnd() * 10}%,${l}%)`;
      g.fillRect(x, r * h, len, h - 1.5);
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = `rgba(${rnd() < 0.5 ? '20,10,4' : '90,55,28'},${0.15 + rnd() * 0.2})`;
        g.lineWidth = 0.6 + rnd();
        g.beginPath();
        const y = r * h + rnd() * h;
        g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 5, x + len * 0.7, y + (rnd() - 0.5) * 5, x + len, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(8,4,2,0.8)';
      g.fillRect(x, r * h + h - 1.5, len, 1.5);
      g.fillRect(x, r * h, 1.5, h);
      x += len;
    }
  }
  return tex(c, 2, 2);
}

function plasterTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#9aa8a0';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,240' : '20,30,25'},${(rnd() * 0.06).toFixed(3)})`;
    const s = 2 + rnd() * 18;
    g.fillRect(rnd() * 512, rnd() * 512, s, s * (0.3 + rnd() * 0.7));
  }
  return tex(c, 3, 1);
}

function wainscotTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#2b1a10';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '10,5,2' : '120,75,40'},${0.1 + rnd() * 0.15})`;
    g.beginPath();
    const y = rnd() * 512;
    g.moveTo(0, y);
    g.bezierCurveTo(150, y + (rnd() - 0.5) * 10, 350, y + (rnd() - 0.5) * 10, 512, y);
    g.stroke();
  }
  // raised panel: bevelled inner rectangle
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(36, 44, 440, 424);
  g.fillStyle = 'rgba(80,50,28,0.55)';
  g.fillRect(48, 56, 416, 400);
  g.strokeStyle = 'rgba(255,200,140,0.22)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(36, 468);
  g.lineTo(36, 44);
  g.lineTo(476, 44);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.beginPath();
  g.moveTo(476, 44);
  g.lineTo(476, 468);
  g.lineTo(36, 468);
  g.stroke();
  return tex(c, 6, 1);
}

function rugTexture(): CanvasTexture {
  const [c, g] = canvas(768, 512);
  g.fillStyle = '#6e1a20';
  g.fillRect(0, 0, 768, 512);
  const band = (inset: number, col: string, w: number): void => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.strokeRect(inset, inset, 768 - inset * 2, 512 - inset * 2);
  };
  band(16, '#d9b36b', 6);
  band(36, '#1c2a4a', 28);
  band(62, '#d9b36b', 4);
  for (let x = 90; x < 700; x += 36) {
    for (const y of [48, 464]) {
      g.fillStyle = '#d9b36b';
      g.beginPath();
      g.moveTo(x, y - 9);
      g.lineTo(x + 9, y);
      g.lineTo(x, y + 9);
      g.lineTo(x - 9, y);
      g.fill();
    }
  }
  // central medallion
  const cx = 384;
  const cy = 256;
  for (const [r, col] of [[170, '#1c2a4a'], [140, '#d9b36b'], [118, '#8a2a2e'], [84, '#1c2a4a'], [60, '#d9b36b'], [38, '#6e1a20']] as [number, string][]) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(cx - r * 1.5, cy);
    g.lineTo(cx, cy - r);
    g.lineTo(cx + r * 1.5, cy);
    g.lineTo(cx, cy + r);
    g.closePath();
    g.fill();
  }
  // scattered motifs
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '217,179,107' : '28,42,74'},${0.1 + rnd() * 0.1})`;
    const x = 90 + rnd() * 590;
    const y = 90 + rnd() * 330;
    g.fillRect(x, y, 3 + rnd() * 4, 3 + rnd() * 4);
  }
  // wear
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,235,210' : '0,0,0'},${(rnd() * 0.08).toFixed(3)})`;
    g.fillRect(rnd() * 768, rnd() * 512, 1 + rnd() * 2, 1);
  }
  return tex(c, 1, 1);
}

function skyTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#16224a');
  gr.addColorStop(0.35, '#5b3f7a');
  gr.addColorStop(0.62, '#e0763c');
  gr.addColorStop(0.8, '#ffb25c');
  gr.addColorStop(1, '#ffd89a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 512);
  const sun = g.createRadialGradient(300, 380, 4, 300, 380, 170);
  sun.addColorStop(0, 'rgba(255,248,220,1)');
  sun.addColorStop(0.2, 'rgba(255,214,140,0.8)');
  sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun;
  g.fillRect(0, 160, 512, 352);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(255,${150 + Math.floor(rnd() * 60)},${110 + Math.floor(rnd() * 40)},${0.12 + rnd() * 0.18})`;
    g.fillRect(rnd() * 400, 200 + rnd() * 170, 80 + rnd() * 180, 6 + rnd() * 12);
  }
  // distant ridges and rooftops in silhouette
  g.fillStyle = '#1a1020';
  g.beginPath();
  g.moveTo(0, 512);
  g.lineTo(0, 440);
  for (let x = 0; x <= 512; x += 16) g.lineTo(x, 430 + Math.sin(x * 0.03) * 14 + rnd() * 6);
  g.lineTo(512, 512);
  g.fill();
  g.fillStyle = '#0f0a14';
  for (let i = 0; i < 12; i++) {
    const x = rnd() * 480;
    const w = 14 + rnd() * 26;
    const h = 20 + rnd() * 46;
    g.fillRect(x, 470 - h, w, h + 42);
    g.beginPath();
    g.moveTo(x - 3, 470 - h);
    g.lineTo(x + w / 2, 470 - h - 12);
    g.lineTo(x + w + 3, 470 - h);
    g.fill();
  }
  return tex(c, 1, 1);
}

function paintingTexture(kind: number): CanvasTexture {
  const [c, g] = canvas(256, 320);
  const gr = g.createLinearGradient(0, 0, 0, 320);
  const sets = [
    ['#20344a', '#c78a4a'],
    ['#3a2a20', '#d8b070'],
    ['#101830', '#6a5aa8'],
  ][kind % 3];
  gr.addColorStop(0, sets[0]);
  gr.addColorStop(1, sets[1]);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 320);
  g.strokeStyle = 'rgba(255,230,180,0.65)';
  g.fillStyle = 'rgba(255,230,180,0.6)';
  g.lineWidth = 2;
  if (kind % 3 === 0) {
    // blueprint of gears
    for (const [x, y, r] of [[96, 140, 56], [170, 100, 36], [160, 200, 44]]) {
      g.beginPath();
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const rr = k % 2 ? r * 0.82 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.stroke();
    }
  } else if (kind % 3 === 1) {
    // still life: vase and moon
    g.beginPath();
    g.ellipse(128, 120, 34, 70, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(98, 220, 60, 14);
    g.fillStyle = 'rgba(255,245,215,0.9)';
    g.beginPath();
    g.arc(190, 60, 20, 0, Math.PI * 2);
    g.fill();
  } else {
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.7})`;
      g.fillRect(rnd() * 256, rnd() * 200, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.fillStyle = '#05060f';
    g.beginPath();
    g.moveTo(0, 320);
    g.lineTo(0, 250);
    g.lineTo(80, 215);
    g.lineTo(150, 245);
    g.lineTo(256, 200);
    g.lineTo(256, 320);
    g.fill();
  }
  return tex(c, 1, 1);
}

function beamTexture(): CanvasTexture {
  const [c, g] = canvas(32, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,214,150,0.9)');
  gr.addColorStop(0.6, 'rgba(255,200,130,0.35)');
  gr.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 256);
  const side = g.createLinearGradient(0, 0, 32, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 32, 256);
  return tex(c, 1, 1);
}

function dustTexture(): CanvasTexture {
  const [c, g] = canvas(32, 32);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,230,170,1)');
  gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return tex(c, 1, 1);
}

export interface RoomFx {
  update(t: number): void;
}

/** Fills `room` with the atelier and returns a per-frame animator (light shafts, dust, flicker). */
export function buildCinematicRoom(room: Group): RoomFx {
  seed = 42;
  const std = (opts: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => new MeshStandardMaterial(opts);
  const put = <T extends Object3D>(o: T, x: number, y: number, z: number): T => {
    o.position.set(x, y, z);
    room.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number): Mesh => put(new Mesh(new BoxGeometry(w, h, d), mat), x, y, z);
  const walnut = std({ color: 0x4a2c18, roughness: 0.55, metalness: 0.0 });
  const darkWood = std({ color: 0x2a190e, roughness: 0.6 });
  const brass = std({ color: 0xc79a46, roughness: 0.28, metalness: 0.95 });
  const iron = std({ color: 0x2a2826, roughness: 0.5, metalness: 0.85 });

  // floor + rug
  const floor = new Mesh(new PlaneGeometry(8, 8), std({ map: plankTexture(), roughness: 0.36, metalness: 0.05, envMapIntensity: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  put(floor, 0, 0.02, 0);
  const rug = new Mesh(new PlaneGeometry(3.6, 2.5), std({ map: rugTexture(), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  put(rug, 0, 0.04, -0.5);

  // walls: plaster above, panelled wainscot below, chair rail and crown moulding
  const plaster = plasterTexture();
  const wains = wainscotTexture();
  const wallDefs: [number, number, number, number][] = [
    [0, -3.4, 0, 8], // back
    [-3.4, 0, Math.PI / 2, 8],
    [3.4, 0, -Math.PI / 2, 8],
    [0, 3.4, Math.PI, 8],
  ];
  for (const [x, z, ry, w] of wallDefs) {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const up = new Mesh(new PlaneGeometry(w, 1.9), std({ map: plaster, color: 0x56756c, roughness: 0.95 }));
    up.position.y = 1.1 + 0.95;
    g.add(up);
    const lo = new Mesh(new PlaneGeometry(w, 1.1), std({ map: wains, roughness: 0.55 }));
    lo.position.y = 0.55;
    g.add(lo);
    const rail = new Mesh(new BoxGeometry(w, 0.07, 0.06), walnut);
    rail.position.set(0, 1.1, 0.03);
    g.add(rail);
    const base = new Mesh(new BoxGeometry(w, 0.16, 0.05), walnut);
    base.position.set(0, 0.08, 0.025);
    g.add(base);
    const crown = new Mesh(new BoxGeometry(w, 0.14, 0.08), walnut);
    crown.position.set(0, 2.94, 0.04);
    g.add(crown);
    room.add(g);
  }
  // ceiling with beams
  const ceil = new Mesh(new PlaneGeometry(8, 8), std({ color: 0x24160d, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  put(ceil, 0, 3, 0);
  for (let i = -3; i <= 3; i += 1.5) box(0.2, 0.2, 7.2, darkWood, i, 2.88, 0);

  // tall dusk window on the back wall
  const WZ = -3.37;
  const sky = new Mesh(new PlaneGeometry(2.3, 1.75), new MeshBasicMaterial({ map: skyTexture() }));
  put(sky, 0, 1.85, WZ - 0.02);
  box(2.5, 0.12, 0.14, darkWood, 0, 2.77, WZ + 0.02);
  box(2.5, 0.12, 0.14, darkWood, 0, 0.93, WZ + 0.02);
  box(0.12, 1.96, 0.14, darkWood, -1.19, 1.85, WZ + 0.02);
  box(0.12, 1.96, 0.14, darkWood, 1.19, 1.85, WZ + 0.02);
  box(0.05, 1.75, 0.1, darkWood, -0.4, 1.85, WZ + 0.02);
  box(0.05, 1.75, 0.1, darkWood, 0.4, 1.85, WZ + 0.02);
  box(2.3, 0.05, 0.1, darkWood, 0, 1.85, WZ + 0.02);
  box(2.8, 0.06, 0.34, walnut, 0, 0.9, WZ + 0.12); // sill
  // curtains with folds, on a brass rod
  const curtainMat = std({ color: 0x6d1a22, roughness: 0.92, side: DoubleSide });
  for (const sx of [-1, 1]) {
    const geo = new PlaneGeometry(0.7, 2.25, 30, 1);
    const pos = geo.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 22) * 0.045 + (pos.getY(i) + 1.1) * 0.01);
    geo.computeVertexNormals();
    const cu = new Mesh(geo, curtainMat);
    put(cu, sx * 1.62, 1.72, WZ + 0.12);
  }
  const rod = new Mesh(new CylinderGeometry(0.018, 0.018, 3.8, 10), brass);
  rod.rotation.z = Math.PI / 2;
  put(rod, 0, 2.86, WZ + 0.14);
  for (const sx of [-1, 1]) put(new Mesh(new SphereGeometry(0.035, 12, 10), brass), sx * 1.9, 2.86, WZ + 0.14);

  // slanting light shafts from the window + a warm window patch on the rug
  const beamMat = new MeshBasicMaterial({ map: beamTexture(), transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const dir = new Vector3(0.12, -0.42, 1).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().negate());
  const beams: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    for (const rotAxis of [0, Math.PI / 2]) {
      const len = 4.6;
      const holder = new Group();
      const m = new Mesh(new PlaneGeometry(0.3 + (i % 2) * 0.12, len), beamMat);
      m.rotation.y = rotAxis;
      holder.add(m);
      holder.quaternion.copy(q);
      const start = new Vector3(-0.9 + i * 0.45, 2.2 - (i % 2) * 0.25, WZ + 0.1);
      holder.position.copy(start).addScaledVector(dir, len / 2);
      room.add(holder);
      beams.push(m);
    }
  }
  const patch = new Mesh(new PlaneGeometry(1.8, 2.4), new MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false }));
  patch.rotation.x = -Math.PI / 2;
  put(patch, 0.3, 0.06, -1.9);

  // bookcases with instanced books
  const bookGeo = new BoxGeometry(1, 1, 1);
  const bookMat = std({ roughness: 0.8 });
  const palette = [0x5a1a1e, 0x1c2a4a, 0x2a4a34, 0x7a5a24, 0x3a2418, 0xd8c8a0, 0x4a2a4a, 0x2a3a3e, 0x8a3a24];
  const bookcase = (cx: number, cz: number, ry: number, w: number, h: number, rows: number): void => {
    const g = new Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = ry;
    const d = 0.32;
    const side = (x: number): void => {
      const m = new Mesh(new BoxGeometry(0.05, h, d), walnut);
      m.position.set(x, h / 2, 0);
      g.add(m);
    };
    side(-w / 2);
    side(w / 2);
    const back = new Mesh(new BoxGeometry(w, h, 0.03), darkWood);
    back.position.set(0, h / 2, -d / 2 + 0.015);
    g.add(back);
    const per = Math.floor(w / 0.05);
    const books = new InstancedMesh(bookGeo, bookMat, rows * per);
    const m4 = new Matrix4();
    const col = new Color();
    let n = 0;
    for (let r = 0; r <= rows; r++) {
      const y = 0.12 + (r * (h - 0.2)) / rows;
      const sh = new Mesh(new BoxGeometry(w, 0.035, d), walnut);
      sh.position.set(0, y, 0);
      g.add(sh);
      if (r === rows) break;
      const room2 = (h - 0.2) / rows - 0.05;
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.08 && n < rows * per) {
        const bw = 0.025 + rnd() * 0.03;
        const bh = room2 * (0.62 + rnd() * 0.36);
        m4.makeScale(bw, bh, d * 0.78);
        m4.setPosition(x + bw / 2, y + 0.0175 + bh / 2, 0.01);
        books.setMatrixAt(n, m4);
        books.setColorAt(n, col.setHex(palette[Math.floor(rnd() * palette.length)]));
        n++;
        x += bw + 0.004;
      }
    }
    books.count = n;
    g.add(books);
    room.add(g);
  };
  bookcase(-2.5, -3.2, 0, 1.0, 2.4, 6);
  bookcase(2.5, -3.2, 0, 1.0, 2.4, 6);
  bookcase(-3.22, -0.6, Math.PI / 2, 2.2, 2.0, 5);

  // framed paintings
  const frameMat = std({ color: 0xb8893a, roughness: 0.35, metalness: 0.8 });
  const painting = (x: number, y: number, z: number, ry: number, kind: number): void => {
    const g = new Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    const fr = new Mesh(new BoxGeometry(0.62, 0.78, 0.05), frameMat);
    g.add(fr);
    const pic = new Mesh(new PlaneGeometry(0.5, 0.66), new MeshBasicMaterial({ map: paintingTexture(kind), color: 0xcfc2b0 }));
    pic.position.z = 0.03;
    g.add(pic);
    room.add(g);
  };
  painting(3.36, 1.85, -2.2, -Math.PI / 2, 0);
  painting(3.36, 1.85, 1.4, -Math.PI / 2, 1);
  painting(-3.36, 1.9, 1.7, Math.PI / 2, 2);
  painting(-3.36, 1.9, 2.5, Math.PI / 2, 0);

  // brass sconces; the two front ones carry real lights
  const lights: PointLight[] = [];
  const sconce = (x: number, y: number, z: number, ry: number, lit: boolean): void => {
    const g = new Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    const plate = new Mesh(new CylinderGeometry(0.05, 0.05, 0.02, 14), brass);
    plate.rotation.x = Math.PI / 2;
    g.add(plate);
    const arm = new Mesh(new CylinderGeometry(0.008, 0.008, 0.18, 8), brass);
    arm.rotation.x = Math.PI / 2;
    arm.position.z = 0.09;
    g.add(arm);
    const shade = new Mesh(new CylinderGeometry(0.03, 0.065, 0.1, 16, 1, true), std({ color: 0xffe2b0, emissive: 0xffa850, emissiveIntensity: 0.6, roughness: 0.6, side: DoubleSide }));
    shade.position.set(0, 0.03, 0.2);
    g.add(shade);
    const bulb = new Mesh(new SphereGeometry(0.022, 10, 8), new MeshBasicMaterial({ color: 0xfff0c0 }));
    bulb.position.set(0, 0.03, 0.2);
    g.add(bulb);
    const halo = new Mesh(new SphereGeometry(0.12, 12, 10), new MeshBasicMaterial({ color: 0xffa850, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }));
    halo.position.copy(bulb.position);
    g.add(halo);
    if (lit) {
      const l = new PointLight(0xffa850, 2.2, 5, 2);
      l.position.set(0, 0.05, 0.3);
      g.add(l);
      lights.push(l);
    }
    room.add(g);
  };
  sconce(3.36, 1.9, -0.9, -Math.PI / 2, true);
  sconce(-3.36, 1.9, 1.0, Math.PI / 2, true);
  sconce(3.36, 1.9, 2.2, -Math.PI / 2, false);
  sconce(-3.36, 1.9, -2.3, Math.PI / 2, false);

  // pegboard of tools on the right wall (kept, darker and warmer)
  box(0.03, 1.0, 1.8, std({ color: 0x6e5236, roughness: 0.9 }), 3.37, 1.62, 0.6);
  for (let i = 0; i < 6; i++) {
    const z = -0.2 + i * 0.3 + 0.6 - 0.6;
    box(0.04, 0.34 + (i % 3) * 0.1, 0.035, iron, 3.33, 1.62, z + 0.0);
    box(0.05, 0.1, 0.05, i % 2 ? brass : walnut, 3.31, 1.4 - (i % 3) * 0.04, z);
  }

  // Edison pendant with three bulbs over the table
  const px = 0;
  const pz = -0.55;
  const canopy = new Mesh(new CylinderGeometry(0.05, 0.08, 0.05, 14), iron);
  put(canopy, px, 2.97, pz);
  const bulbs: Mesh[] = [];
  [[-0.14, 0.1], [0.14, 0.05], [0, -0.14]].forEach(([dx, dz], i) => {
    const drop = 0.9 + i * 0.12;
    const cord = new Mesh(new CylinderGeometry(0.004, 0.004, drop, 6), new MeshBasicMaterial({ color: 0x111111 }));
    put(cord, px + dx, 2.97 - drop / 2, pz + dz);
    const cap = new Mesh(new CylinderGeometry(0.018, 0.022, 0.05, 10), brass);
    put(cap, px + dx, 2.97 - drop - 0.01, pz + dz);
    const b = new Mesh(new SphereGeometry(0.04, 14, 12), new MeshBasicMaterial({ color: 0xfff0c0 }));
    b.scale.y = 1.35;
    put(b, px + dx, 2.97 - drop - 0.07, pz + dz);
    const halo = new Mesh(new SphereGeometry(0.17, 12, 10), new MeshBasicMaterial({ color: 0xffa850, transparent: true, opacity: 0.14, blending: AdditiveBlending, depthWrite: false }));
    put(halo, px + dx, 2.97 - drop - 0.07, pz + dz);
    bulbs.push(halo);
  });
  const pendant = new PointLight(0xffb468, 3.2, 6, 2);
  put(pendant, px, 1.85, pz);
  lights.push(pendant);

  // floating dust motes in the light shafts
  const N = 110;
  const dp = new Float32Array(N * 3);
  const dseed = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) dseed[i] = rnd();
  const dg = new BufferGeometry();
  dg.setAttribute('position', new BufferAttribute(dp, 3));
  const dust = new Points(dg, new PointsMaterial({ size: 0.02, map: dustTexture(), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
  dust.frustumCulled = false;
  room.add(dust);

  return {
    update(t: number): void {
      beamMat.opacity = 0.085 + Math.sin(t * 0.35) * 0.02;
      const f = 1 + Math.sin(t * 13) * 0.02 + Math.sin(t * 4.1) * 0.03;
      pendant.intensity = 3.2 * f;
      for (const b of bulbs) (b.material as MeshBasicMaterial).opacity = 0.14 * f;
      for (let i = 0; i < N; i++) {
        const a = dseed[i * 3];
        const b = dseed[i * 3 + 1];
        const c = dseed[i * 3 + 2];
        const k = ((b + t * 0.006 * (0.5 + c)) % 1) * 4.2; // distance along the shaft
        dp[i * 3] = -0.9 + a * 1.9 + 0.12 * k + Math.sin(t * 0.2 + c * 9) * 0.06;
        dp[i * 3 + 1] = 2.2 - 0.42 * k + Math.sin(t * 0.3 + a * 9) * 0.05;
        dp[i * 3 + 2] = -3.3 + k;
      }
      (dg.getAttribute('position') as BufferAttribute).needsUpdate = true;
    },
  };
}
