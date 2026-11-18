/**
 * Hand-built workshop furniture (pure Three objects, no systems): a modern arc floor lamp and a woven storage basket.
 * They replace the earlier stock models in the workshop corner. Everything is procedural and created once.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';

/** Arc floor lamp: marble plinth, slim brushed-brass stem sweeping into a glowing dome. About 2 m tall. */
export function buildArcLamp(): Group {
  const g = new Group();
  const marble = new MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.18, metalness: 0.05 });
  const brass = new MeshStandardMaterial({ color: 0xc9a25c, roughness: 0.28, metalness: 0.95 });
  const black = new MeshStandardMaterial({ color: 0x15151a, roughness: 0.45, metalness: 0.6 });
  const base = new Mesh(new CylinderGeometry(0.26, 0.3, 0.07, 40), marble);
  base.position.y = 0.035;
  g.add(base);
  const ring = new Mesh(new TorusGeometry(0.265, 0.008, 8, 48), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.072;
  g.add(ring);
  const collar = new Mesh(new CylinderGeometry(0.028, 0.04, 0.12, 20), black);
  collar.position.y = 0.13;
  g.add(collar);
  // the stem rises straight, then sweeps out over the room in one long arc
  const curve = new CatmullRomCurve3([
    new Vector3(0, 0.12, 0),
    new Vector3(0, 0.9, 0),
    new Vector3(0, 1.55, 0.02),
    new Vector3(0.1, 1.92, 0.2),
    new Vector3(0.34, 2.06, 0.52),
    new Vector3(0.62, 1.98, 0.72),
  ]);
  const stem = new Mesh(new TubeGeometry(curve, 64, 0.011, 10, false), brass);
  g.add(stem);
  // dome shade with a warm glowing inside
  const shadeOut = new Mesh(new SphereGeometry(0.2, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5, metalness: 0.1, side: DoubleSide }));
  shadeOut.position.set(0.62, 1.9, 0.72);
  g.add(shadeOut);
  const glow = new Mesh(new CircleGeometry(0.19, 32), new MeshBasicMaterial({ color: 0xffd79a }));
  glow.rotation.x = Math.PI / 2;
  glow.position.set(0.62, 1.9, 0.72);
  g.add(glow);
  const halo = new Mesh(new CircleGeometry(0.62, 32), new MeshBasicMaterial({ color: 0xffb867, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false }));
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0.62, 1.66, 0.72);
  g.add(halo);
  const cap = new Mesh(new SphereGeometry(0.03, 12, 10), brass);
  cap.position.set(0.62, 2.1, 0.72);
  g.add(cap);
  return g;
}

function stripeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = '#d9cdb8';
  x.fillRect(0, 0, 256, 256);
  // fine weave
  for (let y = 0; y < 256; y += 8) {
    x.fillStyle = y % 16 === 0 ? 'rgba(90,70,50,0.18)' : 'rgba(255,255,255,0.12)';
    x.fillRect(0, y, 256, 4);
  }
  for (let i = 0; i < 256; i += 8) {
    x.fillStyle = 'rgba(70,55,40,0.12)';
    x.fillRect(i, 0, 2, 256);
  }
  // two charcoal bands
  x.fillStyle = '#2b2a2f';
  x.fillRect(0, 70, 256, 22);
  x.fillRect(0, 168, 256, 22);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Woven storage basket: tapered body with charcoal bands, leather handles and a rolled throw blanket on top. */
export function buildBasket(): Group {
  const g = new Group();
  const body = new Mesh(new CylinderGeometry(0.3, 0.23, 0.5, 40, 1, true), new MeshStandardMaterial({ map: stripeTexture(), roughness: 0.9, side: DoubleSide }));
  body.position.y = 0.25;
  g.add(body);
  const floor = new Mesh(new CylinderGeometry(0.23, 0.23, 0.02, 32), new MeshStandardMaterial({ color: 0x2b2a2f, roughness: 0.9 }));
  floor.position.y = 0.02;
  g.add(floor);
  const leather = new MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.6 });
  const rim = new Mesh(new TorusGeometry(0.3, 0.014, 10, 48), leather);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.5;
  g.add(rim);
  for (const s of [-1, 1]) {
    const h = new Mesh(new TorusGeometry(0.06, 0.011, 8, 20, Math.PI), leather);
    h.position.set(s * 0.285, 0.43, 0);
    h.rotation.set(0, Math.PI / 2, Math.PI);
    g.add(h);
  }
  // a rolled blanket and a folded cushion peek out of the top
  const wool = new MeshStandardMaterial({ color: 0xb85c4a, roughness: 1 });
  const roll = new Mesh(new CylinderGeometry(0.09, 0.09, 0.42, 20), wool);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 0.56, 0.05);
  g.add(roll);
  const roll2 = new Mesh(new CylinderGeometry(0.075, 0.075, 0.38, 20), new MeshStandardMaterial({ color: 0x3f5a6b, roughness: 1 }));
  roll2.rotation.set(0.15, 0, Math.PI / 2);
  roll2.position.set(0.02, 0.6, -0.1);
  g.add(roll2);
  return g;
}
