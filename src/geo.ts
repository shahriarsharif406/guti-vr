import { CanvasTexture, ExtrudeGeometry, RepeatWrapping, SRGBColorSpace, Shape } from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';

const cache = new Map<string, BufferGeometry>();

/** Box with softly rounded edges (real objects never have razor-sharp corners). Shared by size. */
export function roundedBox(w: number, h: number, d: number, r: number): BufferGeometry {
  const key = [w, h, d, r].map((v) => v.toFixed(5)).join('/');
  const hit = cache.get(key);
  if (hit) return hit;
  const rr = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
  const sw = w - 2 * rr;
  const sh = h - 2 * rr;
  const s = new Shape();
  s.moveTo(-sw / 2, -sh / 2);
  s.lineTo(sw / 2, -sh / 2);
  s.lineTo(sw / 2, sh / 2);
  s.lineTo(-sw / 2, sh / 2);
  s.closePath();
  const g = new ExtrudeGeometry(s, {
    depth: d - 2 * rr,
    bevelEnabled: true,
    bevelThickness: rr,
    bevelSize: rr,
    bevelSegments: 2,
    curveSegments: 1,
  });
  g.center();
  cache.set(key, g);
  return g;
}

const woods = new Map<string, CanvasTexture>();

/** Varnished wood grain (planks, rings, knots) painted once; tint picks the species. */
export function woodTexture(hue = 28, rx = 1, ry = 1): CanvasTexture {
  const key = hue + '/' + rx + '/' + ry;
  const hit = woods.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = `hsl(${hue},48%,46%)`;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 700; i++) {
    const y = Math.random() * 512;
    const l = 30 + Math.random() * 28;
    g.strokeStyle = `hsla(${hue + Math.random() * 6},${40 + Math.random() * 20}%,${l}%,${0.1 + Math.random() * 0.18})`;
    g.lineWidth = 0.6 + Math.random() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    const a = (Math.random() - 0.5) * 14;
    g.bezierCurveTo(170, y + a, 340, y - a, 512, y + (Math.random() - 0.5) * 8);
    g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    for (let r = 4; r < 28; r += 3) {
      g.strokeStyle = `hsla(${hue},45%,${24 + r * 0.4}%,0.22)`;
      g.beginPath();
      g.ellipse(x, y, r * 1.8, r * 0.8, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  woods.set(key, t);
  return t;
}
