import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Entity,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Pressed,
  RayInteractable,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { musicState, sfx } from './audio.js';
import { quality, tickQuality } from './quality.js';
import { celebrate, emitBurst } from './fx.js';
import { CHAPTERS, M, LEVELS, chapterOf, evaluate, fits, needsClutch, outerRadius, radius } from './gearlogic.js';
import type { Evaluation, GearDef, Level } from './gearlogic.js';
import { roundedBox, woodTexture } from './geo.js';
import { SparkField } from './sparks.js';
import { readPinchPoint } from './hand.js';
import { askMentor } from './mentor.js';
import { modeState } from './mode.js';
import { gsStage } from './gsstage.js';
import { isFontReady, TextPanel } from './panel.js';
import { GearOpt } from './ui-components.js';

// ---- GearShift: pick gears from the rack, seat them on pegs, and make the machine do what the goal says.
const BZ = -0.85; // board front plane
const BY = 0.92; // board centre height
const BW = 1.8;
const BH = 0.74;
const Z0 = 0.024; // front layer offset from the board
const Z1 = 0.012; // back layer offset
const TRAY_Y = -0.29;
const RACK_SCALE = 0.7;
const PICK_R = 0.075;
const SNAP_R = 0.085;
const OMEGA = -1.5; // motor speed (negative = clockwise as seen by the player)
const PINCH_START = 0.85;
const PINCH_HOLD = 0.5;

type HandName = 'left' | 'right';

interface Item {
  def: GearDef;
  g: Group;
  meshes: Mesh[]; // one per part
  peg: number; // -1 in the rack
  x: number;
  y: number;
  home: { x: number; y: number };
  held: boolean;
  lift: number;
}
interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  held: Item | null;
  lever: Lever | null;
}
interface Lever {
  g: Group;
  knob: Mesh;
  x: number;
  top: number; // board-space y of the knob when up
  pos: number; // 0 up .. 1 down (engaged)
  target: number;
  drag: boolean;
  vel: number;
  slammed: boolean;
  tickPos: number;
  deco: Mesh[];
}
const TRAVEL = 0.16;

// brushed bronze, polished brass, oxidised copper, cast iron
const COLORS: Record<number, number> = { 8: 0xb8863b, 10: 0xd6a94a, 12: 0x9a6334, 14: 0x5d8a78, 15: 0x6c6a70, 16: 0xa97442, 20: 0xc79a46, 24: 0x7b5a3a };
const GAUGE_Y = BY + BH / 2 + 0.11;
let scratchTex: CanvasTexture | null = null;

/** Micro-scratches and brushed grain, used as roughness + bump map so metal catches the light unevenly. */
function scratchTexture(): CanvasTexture {
  if (scratchTex) return scratchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    const v = Math.floor(90 + rnd() * 120);
    g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.2 + rnd() * 0.5).toFixed(2) + ')';
    g.lineWidth = rnd() < 0.9 ? 0.6 : 1.4;
    const x = rnd() * 256;
    const y = rnd() * 256;
    const a = rnd() * Math.PI;
    const l = 6 + rnd() * 50;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 250; i++) {
    g.fillStyle = 'rgba(40,40,40,' + (0.15 + rnd() * 0.3).toFixed(2) + ')';
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  scratchTex = new CanvasTexture(c);
  scratchTex.wrapS = scratchTex.wrapT = 1000; // RepeatWrapping
  return scratchTex;
}

function metal(color: number, rough = 0.42, bump = 0.6): MeshStandardMaterial {
  const t = scratchTexture();
  return new MeshStandardMaterial({ color, metalness: 0.92, roughness: rough, roughnessMap: t, bumpMap: t, bumpScale: bump, envMapIntensity: 1.3 });
}

const wearCache = new Map<number, CanvasTexture>();
/** Aged brass/bronze colour map: patina blotches in the recesses and worn silver showing through on the edges. */
function wearTexture(hex: number): CanvasTexture {
  const hit = wearCache.get(hex);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 256, 256);
  let seed = hex % 9973;
  const rnd = (): number => ((seed = (seed * 16807 + 11) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 14 + rnd() * 30);
    gr.addColorStop(0, 'rgba(30,45,30,' + (0.12 + rnd() * 0.15).toFixed(2) + ')'); // green patina
    gr.addColorStop(1, 'rgba(30,45,30,0)');
    g.save();
    g.translate(rnd() * 256, rnd() * 256);
    g.fillStyle = gr;
    g.fillRect(-50, -50, 100, 100);
    g.restore();
  }
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = 'rgba(225,230,238,' + (0.25 + rnd() * 0.4).toFixed(2) + ')'; // worn silver
    g.lineWidth = 0.7 + rnd() * 1.6;
    const x = rnd() * 256;
    const y = rnd() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 22, y + (rnd() - 0.5) * 22);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = 1000;
  t.repeat.set(14, 14);
  wearCache.set(hex, t);
  return t;
}

/** Gear metal: brushed micro-roughness + bump + patina/worn-silver colour map. */
let grainTex: CanvasTexture | null = null;
/** Direction field of concentric circles around the gear centre: highlights stretch along the turned grain. */
function circularGrain(): CanvasTexture {
  if (grainTex) return grainTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S - 0.5;
      const v = 0.5 - y / S; // canvas y is flipped relative to uv
      const l = Math.hypot(u, v) || 1;
      const tx = -v / l; // tangent of the circle
      const ty = u / l;
      const o = (y * S + x) * 4;
      img.data[o] = Math.round((0.5 + 0.5 * tx) * 255);
      img.data[o + 1] = Math.round((0.5 + 0.5 * ty) * 255);
      img.data[o + 2] = 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  grainTex = new CanvasTexture(c);
  grainTex.repeat.set(5, 5); // gear uv spans about +-0.1 m around the axle
  grainTex.offset.set(0.5, 0.5);
  return grainTex;
}

function wornMetal(hex: number, rough = 0.42): MeshPhysicalMaterial {
  const t = scratchTexture();
  const m = new MeshPhysicalMaterial({ color: 0xffffff, map: wearTexture(hex), metalness: 0.92, roughness: rough, roughnessMap: t, bumpMap: t, bumpScale: 0.6, envMapIntensity: 1.0 });
  m.anisotropy = 0.45; // brushed look: specular stretched along the circular grain
  m.anisotropyMap = circularGrain();
  return m;
}

let ironMapTex: CanvasTexture | null = null;
let ironBumpTex: CanvasTexture | null = null;
/** Cast iron: pitting, oily sheen blotches (smooth/rough variation) and pale dust specks in the crevices. */
function ironMat(): MeshStandardMaterial {
  if (!ironMapTex || !ironBumpTex) {
    let seed = 5;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#3d3a38';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 20 + rnd() * 40);
      gr.addColorStop(0, rnd() < 0.5 ? 'rgba(120,125,140,0.22)' : 'rgba(0,0,0,0.3)'); // oil sheen vs grease dark
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.save();
      g.translate(rnd() * 256, rnd() * 256);
      g.fillStyle = gr;
      g.fillRect(-70, -70, 140, 140);
      g.restore();
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(190,180,165,' + (rnd() * 0.22).toFixed(2) + ')'; // dust
      g.fillRect(rnd() * 256, rnd() * 256, 1, 1 + rnd() * 2);
    }
    ironMapTex = new CanvasTexture(c);
    ironMapTex.colorSpace = SRGBColorSpace;
    ironMapTex.wrapS = ironMapTex.wrapT = 1000;
    ironMapTex.repeat.set(7, 7);
    const b = document.createElement('canvas');
    b.width = b.height = 256;
    const bg = b.getContext('2d') as CanvasRenderingContext2D;
    bg.fillStyle = '#9a9a9a';
    bg.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(30 + rnd() * 90); // pits
      bg.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      bg.beginPath();
      bg.arc(rnd() * 256, rnd() * 256, 0.6 + rnd() * 2.2, 0, Math.PI * 2);
      bg.fill();
    }
    ironBumpTex = new CanvasTexture(b);
    ironBumpTex.wrapS = ironBumpTex.wrapT = 1000;
    ironBumpTex.repeat.set(7, 7);
  }
  return new MeshStandardMaterial({ color: 0xffffff, map: ironMapTex, metalness: 0.8, roughness: 0.55, roughnessMap: scratchTexture(), bumpMap: ironBumpTex, bumpScale: 1.4, envMapIntensity: 1.1 });
}

function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,230,170,1)');
  gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}
/** which metal a gear sounds like: chapter I horology brass, chapter II cast iron, chapter III aether bronze-glass */
const kindOf = (n: number): 'brass' | 'bronze' | 'copper' | 'iron' => (curStyle === 0 ? 'brass' : curStyle === 1 ? (n === 14 ? 'copper' : 'iron') : 'bronze');
const DUST = 110;
function buzz(ms: number | number[]): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
const gearGeo = new Map<string, BufferGeometry>();
/** Chapter look: 0 = skeleton horology, 1 = cast iron, 2 = aether glass. Set when a level loads. */
let curStyle = 0;

/** A real toothed wheel: trapezoid teeth, a hub hole and chapter-specific cutouts, with bevelled edges. */
function gearGeometry(n: number, style = curStyle): BufferGeometry {
  const key = style + ':' + n;
  const hit = gearGeo.get(key);
  if (hit) return hit;
  const r = radius(n);
  const root = r - M * 1.05;
  const tip = r + M * 0.85;
  const pa = (Math.PI * 2) / n;
  const s = new Shape();
  for (let k = 0; k < n; k++) {
    const a = k * pa;
    const pts: [number, number][] = [
      [root, a - pa * 0.32],
      [tip, a - pa * 0.14],
      [tip, a + pa * 0.14],
      [root, a + pa * 0.32],
    ];
    pts.forEach(([rad, ang], i) => {
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      if (k === 0 && i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
  }
  s.closePath();
  const hub = new Path();
  hub.absarc(0, 0, Math.max(0.006, root * (style === 0 ? 0.2 : 0.16)), 0, Math.PI * 2, true);
  s.holes.push(hub);
  const holes = style === 1 ? (n >= 14 ? 4 : 0) : n >= 10 ? (style === 0 ? 6 : 3) : 0;
  const hr = style === 1 ? 0.16 : style === 0 ? 0.19 : 0.33;
  const hd = style === 1 ? 0.6 : style === 0 ? 0.55 : 0.52;
  for (let k = 0; k < holes; k++) {
    const a = (k / holes) * Math.PI * 2 + 0.3;
    const h = new Path();
    h.absarc(Math.cos(a) * root * hd, Math.sin(a) * root * hd, root * hr, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const depth = style === 1 ? 0.012 : style === 0 ? 0.006 : 0.007;
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0014, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  gearGeo.set(key, g);
  return g;
}

function gearMaterial(n: number): MeshStandardMaterial {
  return wornMetal(COLORS[n] ?? 0x9a6a35, n === 10 || n === 20 ? 0.28 : 0.45);
}

// ---- chapter gear families (all shared: geometry and materials are created once and never per gear)
const n0 = (m: unknown): boolean => !!m && 'emissive' in (m as object);
const IDLER = 8; // the smallest gear is the neutral grey idler
const shared: Record<string, any> = {};
function sh<T>(k: string, f: () => T): T {
  return (shared[k] ??= f()) as T;
}
function romanTexture(): CanvasTexture {
  return sh('roman', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = 'rgba(40,20,8,0.85)';
    g.font = '700 26px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    R.forEach((t, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.save();
      g.translate(256 + Math.cos(a) * 232, 256 + Math.sin(a) * 232);
      g.rotate(a + Math.PI / 2);
      g.fillText(t, 0, 0);
      g.restore();
    });
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  });
}
const orbitals: Mesh[] = [];
/** Build one gear for the current chapter style, with its decorative children. */
function makeGear(n: number, style = curStyle, mat?: MeshStandardMaterial): Mesh {
  const geo = gearGeometry(n, style);
  const idler = n === IDLER && !mat;
  let material: MeshStandardMaterial | MeshStandardMaterial[];
  if (mat) material = mat;
  else if (idler) material = sh('idler', () => wornMetal(0x8c9296, 0.6));
  else if (style === 0) material = sh('rose' + (n % 2), () => wornMetal(n % 2 ? 0xc98f6b : 0xb58a45, 0.3));
  else if (style === 1) material = sh('cast', () => wornMetal(0x46423f, 0.62));
  else material = [sh('glass', () => new MeshPhysicalMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.05, clearcoat: 1, emissive: 0x0a4a66, emissiveIntensity: 0.7, depthWrite: false })), sh('meteor', () => wornMetal(0x2b2c33, 0.4))] as unknown as MeshStandardMaterial[];
  const m = new Mesh(geo, material as MeshStandardMaterial);
  if (idler) return m;
  const root = radius(n) - M * 1.05;
  const top = style === 1 ? 0.0075 : 0.0045;
  if (style === 0 && n >= 10) {
    const ruby = new Mesh(sh('rubyG', () => new SphereGeometry(0.0042, 12, 8)), sh('rubyM', () => new MeshStandardMaterial({ color: 0xc01030, emissive: 0x600010, emissiveIntensity: 0.8, roughness: 0.15, metalness: 0.2 })));
    ruby.position.z = top;
    const ring = new Mesh(sh('roman' + n, () => new RingGeometry(root * 0.8, root * 0.97, 48)), sh('romanM', () => new MeshBasicMaterial({ map: romanTexture(), transparent: true, depthWrite: false })));
    ring.position.z = top - 0.0004;
    m.add(ruby, ring);
  } else if (style === 1 && n >= 12) {
    const bolts = Math.min(8, Math.floor(n / 2));
    const bg = sh('boltG', () => new CylinderGeometry(0.0034, 0.0034, 0.003, 6));
    const bm = sh('boltM', () => metal(0x6a655f, 0.5, 0.4));
    for (let k = 0; k < bolts; k++) {
      const b = new Mesh(bg, bm);
      const a = (k / bolts) * Math.PI * 2;
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(a) * root * 0.8, Math.sin(a) * root * 0.8, top);
      m.add(b);
    }
    const coil = new Mesh(sh('coilG' + n, () => new TorusGeometry(root * 0.42, 0.0026, 6, 28)), sh('coilM', () => new MeshStandardMaterial({ color: 0xb8662e, metalness: 0.9, roughness: 0.3, emissive: 0xff7a22, emissiveIntensity: 0 })));
    coil.position.z = top;
    m.add(coil);
  } else if (style === 2 && n >= 10) {
    const fil = new Mesh(sh('filG' + n, () => new TorusGeometry(root * 0.92, 0.0016, 6, 40)), sh('filM', () => new MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false })));
    fil.position.z = 0.0001;
    const orb = new Mesh(sh('orbG' + n, () => new TorusGeometry(radius(n) * 1.18, 0.0013, 6, 48)), sh('orbM', () => metal(0xd6a94a, 0.25, 0.3)));
    orb.rotation.x = 1.05;
    orbitals.push(orb);
    m.add(fil, orb);
  }
  return m;
}

function blueprintTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1160;
  c.height = 740;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 740);
  grad.addColorStop(0, '#2a2522');
  grad.addColorStop(1, '#161312');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1160, 740);
  let seed = 11;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '255,235,210' : '0,0,0') + ',' + (rnd() * 0.07).toFixed(3) + ')';
    g.fillRect(rnd() * 1160, rnd() * 740, 1 + rnd() * 30, 1);
  }
  const step = 50;
  for (let x = 0; x <= 1160; x += step) {
    g.strokeStyle = x % 100 === 0 ? 'rgba(200,150,70,0.42)' : 'rgba(200,150,70,0.16)';
    g.lineWidth = x % 100 === 0 ? 1.8 : 1;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 740);
    g.stroke();
  }
  for (let y = 0; y <= 740; y += step) {
    g.strokeStyle = y % 100 === 0 ? 'rgba(200,150,70,0.42)' : 'rgba(200,150,70,0.16)';
    g.lineWidth = y % 100 === 0 ? 1.8 : 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1160, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(214,169,74,0.85)';
  g.lineWidth = 4;
  g.strokeRect(26, 26, 1108, 688);
  // rivets
  const rivet = (x: number, y: number): void => {
    const rg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
    rg.addColorStop(0, '#f0cf8a');
    rg.addColorStop(1, '#5a4120');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, 6.5, 0, Math.PI * 2);
    g.fill();
  };
  for (let x = 60; x < 1160; x += 100) {
    rivet(x, 44);
    rivet(x, 696);
  }
  for (const y of [120, 220, 320, 420, 520, 620]) {
    rivet(44, y);
    rivet(1116, y);
  }
  g.fillStyle = 'rgba(224,180,100,0.9)';
  g.font = '600 22px sans-serif';
  g.fillText('GEARSHIFT  -  ASSEMBLY BENCH', 68, 84);
  g.font = '16px sans-serif';
  g.fillStyle = 'rgba(224,180,100,0.55)';
  g.fillText('module ' + (M * 1000).toFixed(1) + ' mm   |   front layer / back layer', 68, 108);
  const ry = 740 / 2 - TRAY_Y * 1000 - 100;
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(60, ry, 1040, 200);
  g.strokeStyle = 'rgba(214,169,74,0.5)';
  g.setLineDash([10, 8]);
  g.strokeRect(60, ry, 1040, 200);
  g.setLineDash([]);
  g.fillStyle = 'rgba(224,180,100,0.6)';
  g.fillText('PARTS RACK', 76, ry + 26);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function gaugeTexture(label: string, zone?: [number, number]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const bg = g.createRadialGradient(128, 128, 10, 128, 128, 120);
  bg.addColorStop(0, '#f4e7c4');
  bg.addColorStop(1, '#b89a64');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.fill();
  if (zone) {
    g.strokeStyle = '#2f9a4a';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(128, 128, 84, Math.PI * 0.75 + zone[0] * Math.PI * 1.5, Math.PI * 0.75 + zone[1] * Math.PI * 1.5);
    g.stroke();
  }
  g.strokeStyle = '#3a2a18';
  g.lineWidth = 3;
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
    g.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
    g.stroke();
  }
  g.fillStyle = '#3a2a18';
  g.font = '600 26px serif';
  g.textAlign = 'center';
  g.fillText(label, 128, 190);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class GearShiftSystem extends createSystem({
  opts: { required: [GearOpt, Pressed] },
}) {
  private root = new Group();
  private pegGroup = new Group();
  private partsGroup = new Group();
  private hud!: TextPanel;
  private done!: TextPanel;
  private btns: TextPanel[] = [];
  private level = 0;
  private unlocked = 0;
  private solved = false;
  private placement: number[] = [];
  private items: Item[] = [];
  private fixed = new Map<string, Mesh>();
  private fixedGroup = new Group();
  private pegMeshes: Mesh[] = [];
  private ring!: Mesh;
  private lamp!: Mesh;
  private lampGlow!: Mesh;
  private ev!: Evaluation;
  private time = 0;
  private tickT = 0;
  private lastMode = '';
  private fontWasReady = false;
  private hudDirty = true;
  private optCooldown = 0;
  private msg = '';
  private msgT = 0;
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, held: null, lever: null },
    { src: 'right', pos: new Vector3(), down: false, was: false, held: null, lever: null },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, held: null, lever: null },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private ndc = new Vector3();
  private cam = new Vector3();
  private phi: number[] = [];
  private wp = new Vector3();
  private lights: PointLight[] = [];
  private key!: SpotLight;
  private fill!: PointLight;
  private rim!: PointLight;
  private sparks = new SparkField();
  private shake = 0;
  private hazeMat!: ShaderMaterial;
  private hazeGroup = new Group();
  private tubeMat!: ShaderMaterial;
  private ghost!: Mesh;
  private ripples: Mesh[] = [];
  private guideRing!: Mesh;
  private guideLabel!: Mesh;
  private guideCtx!: CanvasRenderingContext2D;
  private guideTex!: CanvasTexture;
  private guidePeg = -2;
  private mouseSeen = false;
  private hoverPos = new Vector3();
  private bulbGlow: Mesh[] = [];
  private dust!: Points;
  private dustPos = new Float32Array(DUST * 3);
  private dustSeed = new Float32Array(DUST * 3);
  private conduits = new Group();
  private conduitMats: MeshBasicMaterial[] = [];
  private needles: Mesh[] = [];
  private needleVal = [0, 0];
  private crank = new Group();
  private sparkT = 0;
  private progress = 0;
  private efficiency = 0;
  private master!: Lever;
  private clutch!: Lever;
  private power = 0;
  private angle = 0;
  private runWin = 0;
  private jamT = 0;
  private grindT = 0;
  private lastPlaced = -1;
  /** per-level scoring: seconds on the bench and jams (ejected parts) */
  private levelT = 0;
  private mistakes = 0;
  private gradeLine = '';
  private finaleT = -1;
  private stars!: Group;
  private piston = new Group();
  private rod!: Mesh;
  private tubeGlow!: Mesh;
  private rpmFace!: Mesh;
  private tockFlip = false;
  private ringMats: LineBasicMaterial[] = [];
  private wasPowered = false;
  private wasOver = false;
  private overHissT = 0;
  private prevDir = 0;
  private doors: Group[] = [];
  private core!: Mesh;
  private lastP = -1;
  private lastE = -1;
  private outPhi = 0;

  private get lv(): Level {
    return LEVELS[this.level];
  }

  init(): void {
    const world = this.world;
    this.root.add(this.pegGroup, this.fixedGroup, this.partsGroup, this.conduits);
    world.createTransformEntity(this.root);

    // bench: walnut frame, blueprint board, a shelf for the rack
    const wood = new MeshStandardMaterial({ map: woodTexture(18, 2, 1), color: 0x7a5a48, roughness: 0.5 });
    // the chassis is two "doors" hinged at the outer edges so the finale can split it open
    const tex = blueprintTexture();
    const boardMat = new MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.35, roughnessMap: scratchTexture(), bumpMap: scratchTexture(), bumpScale: 0.5 });
    [-1, 1].forEach((side, di) => {
      const door = new Group();
      door.position.set(side * (BW / 2 + 0.06), BY, BZ);
      const bar = (y: number): void => {
        const m = new Mesh(roundedBox((BW + 0.12) / 2, 0.06, 0.05, 0.006), wood);
        m.position.set(-side * ((BW + 0.12) / 4), y, -0.02);
        m.receiveShadow = true;
        door.add(m);
      };
      bar(BH / 2 + 0.03);
      bar(-BH / 2 - 0.03);
      const edge = new Mesh(roundedBox(0.06, BH, 0.05, 0.006), wood);
      edge.position.set(-side * 0.03, 0, -0.02);
      door.add(edge);
      const geo = new PlaneGeometry(BW / 2, BH);
      const uv = geo.getAttribute('uv') as BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, di === 0 ? uv.getX(k) * 0.5 : 0.5 + uv.getX(k) * 0.5);
      const half = new Mesh(geo, boardMat);
      half.position.set(-side * (BW / 4 + 0.06), 0, 0);
      half.receiveShadow = true;
      door.add(half);
      this.root.add(door);
      this.doors.push(door);
    });
    // glowing core revealed behind the doors in the finale
    this.core = new Mesh(new PlaneGeometry(BW, BH), new MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.core.position.set(0, BY, BZ - 0.035);
    this.root.add(this.core);
    const legM = ironMat();
    for (const x of [-0.5, 0.5]) {
      const leg = new Mesh(new BoxGeometry(0.05, BY - 0.35, 0.05), legM);
      leg.position.set(x, (BY - 0.35) / 2, BZ - 0.12);
      this.root.add(leg);
    }

    // riveted iron back panel, brass pipes, Edison lamps, gauges
    const iron = ironMat();
    const brassM = metal(0xc79a46, 0.3, 0.4);
    const panel = new Mesh(roundedBox(BW + 0.5, BH + 0.4, 0.02, 0.01), iron);
    panel.position.set(0, BY + 0.05, BZ - 0.06);
    panel.receiveShadow = true;
    this.root.add(panel);
    for (const sx of [-1, 1]) {
      const pipe = new Mesh(new CylinderGeometry(0.014, 0.014, BH + 0.3, 14), brassM);
      pipe.position.set(sx * (BW / 2 + 0.2), BY + 0.1, BZ - 0.035);
      pipe.castShadow = true;
      this.root.add(pipe);
      for (const py of [-0.25, 0.0, 0.25]) {
        const band = new Mesh(new CylinderGeometry(0.02, 0.02, 0.012, 14), brassM);
        band.position.set(sx * (BW / 2 + 0.2), BY + 0.1 + py, BZ - 0.035);
        this.root.add(band);
      }
      const arm = new Mesh(new CylinderGeometry(0.005, 0.005, 0.2, 8), brassM);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(sx * (BW / 2 + 0.06), GAUGE_Y - 0.05, BZ + 0.05);
      this.root.add(arm);
      const bulb = new Mesh(new SphereGeometry(0.026, 16, 12), new MeshBasicMaterial({ color: 0xffe0a8 }));
      bulb.position.set(sx * (BW / 2 + 0.06), GAUGE_Y - 0.05, BZ + 0.16);
      this.root.add(bulb);
      const halo = new Mesh(new SphereGeometry(0.06, 16, 12), new MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }));
      halo.position.copy(bulb.position);
      this.root.add(halo);
      this.bulbGlow.push(halo);
      const cap = new Mesh(new CylinderGeometry(0.014, 0.018, 0.03, 12), brassM);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(bulb.position.x, bulb.position.y, bulb.position.z - 0.035);
      this.root.add(cap);
      const light = new PointLight(0xffa850, 1.2, 3, 2);
      light.position.set(bulb.position.x * 0.8, bulb.position.y - 0.05, bulb.position.z + 0.12);
      this.root.add(light);
      this.lights.push(light);
    }
    [['PROGRESS', -0.4], ['RPM', 0.4]].forEach(([label, gx], gi) => {
      const rim = new Mesh(new CylinderGeometry(0.06, 0.06, 0.016, 28), brassM);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(gx as number, GAUGE_Y, BZ + 0.0);
      this.root.add(rim);
      const face = new Mesh(new PlaneGeometry(0.1, 0.1), new MeshBasicMaterial({ map: gaugeTexture(label as string), transparent: true }));
      face.position.set(gx as number, GAUGE_Y, BZ + 0.0095);
      this.root.add(face);
      if (gi === 1) this.rpmFace = face;
      const needle = new Mesh(new PlaneGeometry(0.004, 0.042), new MeshBasicMaterial({ color: 0x8a1f12 }));
      needle.geometry.translate(0, 0.016, 0);
      needle.position.set(gx as number, GAUGE_Y, BZ + 0.0105);
      this.root.add(needle);
      this.needles[gi] = needle;
    });
    // drifting dust motes in the lamp light
    for (let i = 0; i < DUST * 3; i++) this.dustSeed[i] = Math.random();
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(this.dustPos, 3));
    this.dust = new Points(dg, new PointsMaterial({ size: 0.011, map: dotTexture(), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);

    // three-point lighting: warm key from the overhead Edison lamp (soft shadows), cyan fill from the aether tube, gold rim
    this.key = new SpotLight(0xffb866, 9, 4, 0.75, 0.7, 2);
    this.key.position.set(0.05, BY + 0.95, BZ + 0.75);
    this.key.target.position.set(0, BY - 0.05, BZ);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.radius = 4;
    this.key.shadow.camera.near = 0.4;
    this.key.shadow.camera.far = 3;
    this.root.add(this.key, this.key.target);
    this.fill = new PointLight(0x4fd0ff, 0.5, 1.6, 2);
    this.fill.position.set(BW / 2 + 0.1, BY + 0.2, BZ + 0.3);
    this.root.add(this.fill);
    this.rim = new PointLight(0xffc860, 1.6, 2, 2);
    this.rim.position.set(-0.75, BY + 0.45, BZ + 0.18);
    this.root.add(this.rim);

    // physical levers (right: master ignition, left: clutch), aether tube, piston, constellation
    const labelTex = (t: string): CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = '#e0b46a';
      g.font = '600 30px serif';
      g.textAlign = 'center';
      g.fillText(t, 128, 42);
      return new CanvasTexture(c);
    };
    const makeLever = (x: number, top: number, label: string, red: boolean): Lever => {
      const slot = new Mesh(roundedBox(0.034, TRAVEL + 0.06, 0.02, 0.008), iron);
      slot.position.set(x, BY + top - TRAVEL / 2, BZ + 0.035);
      slot.receiveShadow = true;
      this.root.add(slot);
      const groove = new Mesh(new PlaneGeometry(0.008, TRAVEL + 0.02), new MeshBasicMaterial({ color: 0x050403 }));
      groove.position.set(x, BY + top - TRAVEL / 2, BZ + 0.0455);
      this.root.add(groove);
      const g = new Group();
      const stem = new Mesh(new CylinderGeometry(0.004, 0.004, 0.05, 8), brassM);
      stem.rotation.x = Math.PI / 2;
      stem.position.z = -0.025;
      const knob = new Mesh(new SphereGeometry(0.02, 18, 14), new MeshStandardMaterial({ color: red ? 0xa22a1a : 0x2f6f86, roughness: 0.3, metalness: 0.35 }));
      knob.castShadow = true;
      g.add(stem, knob);
      g.position.set(x, BY + top, BZ + 0.078);
      this.root.add(g);
      const lab = new Mesh(new PlaneGeometry(0.1, 0.025), new MeshBasicMaterial({ map: labelTex(label), transparent: true }));
      lab.position.set(x, BY + top - TRAVEL - 0.05, BZ + 0.046);
      this.root.add(lab);
      return { g, knob, x, top, pos: 0, target: 0, drag: false, vel: 0, slammed: false, tickPos: 0, deco: [slot, groove, lab] };
    };
    this.master = makeLever(BW / 2 + 0.1, 0.12, 'IGNITION', true);
    this.clutch = makeLever(-(BW / 2 + 0.1), 0.0, 'CLUTCH', false);
    // aether glass tube above the ignition lever
    const tubeX = BW / 2 + 0.1;
    const glass = new Mesh(new CylinderGeometry(0.022, 0.022, 0.2, 16, 1, true), new MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, side: 2 }));
    glass.position.set(tubeX, BY + 0.33, BZ + 0.03);
    this.root.add(glass);
    for (const dy of [-0.105, 0.105]) {
      const cap = new Mesh(new CylinderGeometry(0.026, 0.026, 0.014, 16), brassM);
      cap.position.set(tubeX, BY + 0.33 + dy, BZ + 0.03);
      this.root.add(cap);
    }
    this.tubeMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: 2,
      uniforms: { uTime: { value: 0 }, uCalm: { value: 0 }, uPower: { value: 0.3 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // swirling plasma ribbons: azure when calm, erratic red when over-revving or jammed
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uCalm; uniform float uPower;
        void main(){
          float sp = mix(1.2, 7.0, uCalm);
          float w = sin(vUv.y*18.0 + uTime*sp + sin(vUv.x*12.566 + uTime*0.7)*mix(1.2,3.5,uCalm));
          float w2 = sin(vUv.y*29.0 - uTime*sp*1.3 + vUv.x*18.8 + sin(uTime*mix(1.0,9.0,uCalm))*uCalm*2.0);
          float band = smoothstep(0.55,1.0,w)*0.9 + smoothstep(0.7,1.0,w2)*0.6;
          vec3 col = mix(vec3(0.15,0.62,1.0), vec3(1.0,0.14,0.08), uCalm);
          float edge = 1.0 - abs(vUv.x*2.0-1.0)*0.0;
          float a = (band*0.9 + 0.18) * uPower * edge;
          gl_FragColor = vec4(col*a*1.6, a);
        }`,
    });
    this.tubeGlow = new Mesh(new CylinderGeometry(0.016, 0.016, 0.18, 20, 1, true), this.tubeMat);
    this.tubeGlow.position.set(tubeX, BY + 0.33, BZ + 0.03);
    this.root.add(this.tubeGlow);
    // heat haze rising from the piston chamber at high rpm
    this.hazeMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: 2,
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uStrength;
        void main(){
          float x = vUv.x + sin(vUv.y*14.0 - uTime*3.0)*0.12 + sin(vUv.y*31.0 - uTime*5.0)*0.05;
          float stripe = pow(max(0.0, sin(x*9.0 + uTime*1.3)), 3.0);
          float fade = smoothstep(0.0,0.2,vUv.y) * (1.0 - smoothstep(0.55,1.0,vUv.y)) * (1.0 - abs(vUv.x*2.0-1.0));
          float a = stripe * fade * uStrength * 0.22;
          gl_FragColor = vec4(1.0,0.78,0.5,a);
        }`,
    });
    for (let i = 0; i < 3; i++) {
      const hz = new Mesh(new PlaneGeometry(0.1, 0.22), this.hazeMat);
      hz.position.set(-(BW / 2 + 0.1) + (i - 1) * 0.015, BY + 0.43, BZ + 0.03 + i * 0.012);
      this.hazeGroup.add(hz);
    }
    this.root.add(this.hazeGroup);
    // blueprint guide: a floating hologram ring + label above an empty axle, and a ghost of the held gear
    this.guideRing = new Mesh(new TorusGeometry(0.03, 0.0012, 8, 40), new MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false }));
    this.root.add(this.guideRing);
    const gc = document.createElement('canvas');
    gc.width = 512;
    gc.height = 128;
    this.guideCtx = gc.getContext('2d') as CanvasRenderingContext2D;
    this.guideTex = new CanvasTexture(gc);
    this.guideLabel = new Mesh(new PlaneGeometry(0.3, 0.075), new MeshBasicMaterial({ map: this.guideTex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.root.add(this.guideLabel);
    this.ghost = new Mesh(gearGeometry(10), new MeshBasicMaterial({ color: 0x66d8ff, wireframe: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.root.add(this.ghost);
    // light ripples at each tooth contact (gold when healthy, fiery red on over-rev or jam)
    const rg = new PlaneGeometry(0.05, 0.05);
    const rt = dotTexture();
    for (let k = 0; k < 4; k++) {
      const r = new Mesh(rg, new MeshBasicMaterial({ map: rt, color: 0xffd27a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      r.visible = false;
      this.ripples.push(r);
      this.root.add(r);
    }
    this.root.add(this.sparks.group);
    // reciprocating piston on the left (pumps with the output wheel)
    const px = -(BW / 2 + 0.1);
    const sleeve = new Mesh(new CylinderGeometry(0.02, 0.02, 0.13, 16), iron);
    sleeve.position.set(px, BY + 0.24, BZ + 0.03);
    sleeve.castShadow = true;
    this.piston.add(sleeve);
    this.rod = new Mesh(new CylinderGeometry(0.009, 0.009, 0.12, 12), brassM);
    this.rod.position.set(px, BY + 0.27, BZ + 0.03);
    this.rod.castShadow = true;
    this.piston.add(this.rod);
    this.root.add(this.piston);
    // holographic orrery for the finale: orbit rings with turning planets and a few linked stars
    this.stars = new Group();
    const sp = new Float32Array(70 * 3);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.12 + Math.random() * 0.3;
      sp[i * 3] = Math.cos(a) * r;
      sp[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
      sp[i * 3 + 2] = Math.sin(a) * r;
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(sp, 3));
    this.stars.add(new Points(sg, new PointsMaterial({ size: 0.014, map: dotTexture(), color: 0xa8e4ff, transparent: true, blending: AdditiveBlending, depthWrite: false })));
    const lp: number[] = [];
    for (let i = 0; i < 70; i++) {
      for (let j = i + 1; j < 70; j++) {
        if (Math.hypot(sp[i * 3] - sp[j * 3], sp[i * 3 + 1] - sp[j * 3 + 1], sp[i * 3 + 2] - sp[j * 3 + 2]) < 0.075) lp.push(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2], sp[j * 3], sp[j * 3 + 1], sp[j * 3 + 2]);
      }
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(lp), 3));
    this.stars.add(new LineSegments(lg, new LineBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false })));
    const sun = new Mesh(new SphereGeometry(0.02, 16, 12), new MeshBasicMaterial({ color: 0xffd98a }));
    this.stars.add(sun);
    [0.07, 0.12, 0.18, 0.25].forEach((r, k) => {
      const ring = new Group();
      const pts: number[] = [];
      for (let q = 0; q < 64; q++) {
        const a0 = (q / 64) * Math.PI * 2;
        const a1 = ((q + 1) / 64) * Math.PI * 2;
        pts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
      const rg = new BufferGeometry();
      rg.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
      const ringMat = new LineBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false });
      ring.add(new LineSegments(rg, ringMat));
      const planet = new Mesh(new SphereGeometry(0.009 + k * 0.002, 12, 10), new MeshBasicMaterial({ color: [0xffb04a, 0x6fc8ff, 0xff7a5a, 0xc4a0ff][k] }));
      planet.position.set(r, 0, 0);
      ring.add(planet);
      ring.userData.speed = 0.9 / (k + 1);
      this.stars.add(ring);
      this.ringMats.push(ringMat);
    });
    this.stars.position.set(0, BY + 0.12, BZ + 0.42);
    this.stars.rotation.x = 0.55;
    this.stars.visible = false;
    this.root.add(this.stars);

    // output lamp ring (lights when the goal is met)
    this.ring = new Mesh(new TorusGeometry(0.1, 0.004, 8, 48), new MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false }));
    this.lamp = new Mesh(new RingGeometry(0.0, 0.1, 40), new MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false }));
    this.lampGlow = this.lamp;
    this.root.add(this.ring, this.lamp);

    this.done = new TextPanel(0.5, 0.22);
    this.done.card('rgba(16,19,22,0.88)', '#B58A45');
    this.done.text('MASTER CLOCKMAKER', 80, 46, '#E8DCC1');
    this.done.text('All 6 machines run. The Orrery is awake.', 140, 24, '#AEB7BC');
    this.done.text('RETRY to replay  -  BACK to revisit a level', 190, 22, '#38BDF8');
    this.done.commit();
    this.done.mesh.position.set(0, BY + 0.36, BZ + 0.34);
    this.done.mesh.visible = false;
    this.root.add(this.done.mesh);

    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, BY + BH / 2 + 0.11, BZ + 0.03);
    this.hud.mesh.rotation.x = -0.15;
    this.world.createTransformEntity(this.hud.mesh);
    this.root.userData.hud = true;
    for (let i = 0; i < 3; i++) {
      const panel = new TextPanel(0.32, 0.11, 640);
      panel.mesh.position.set(-0.36 + i * 0.36, 0.66, -0.5);
      panel.mesh.rotation.x = -0.9;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(GearOpt, { id: i });
      this.btns.push(panel);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'gears' || this.optCooldown > 0) return;
        this.optCooldown = 0.35;
        sfx.select();
        this.press(entity.getValue(GearOpt, 'id') as number);
      }),
    );
    try {
      this.unlocked = Math.min(LEVELS.length - 1, Number(localStorage.getItem('pw-gear-level') ?? '0') || 0);
    } catch {
      this.unlocked = 0;
    }
    this.setVisible(false);

    const w = window as unknown as Record<string, unknown>;
    w.__gears = () => ({ stars: this.mistakes, levelT: this.levelT, mode: modeState.mode, level: this.level, solved: this.solved, placement: this.placement.slice(), win: this.ev?.win, ratio: this.ev?.ratio, unlocked: this.unlocked, power: this.power, jam: this.ev?.jam, finale: this.finaleT });
    w.__gearScreen = (x: number, y: number) => {
      const v = new Vector3(x, BY + y, BZ + 0.03).project(this.world.camera);
      return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
    };
    w.__gearLevel = (i: number) => this.loadLevel(i);
    w.__gearWin = () => this.finishWin();
    w.__gearGrade = () => ({ line: this.gradeLine, mistakes: this.mistakes });
    w.__gearPegs = () => this.lv.pegs;
    w.__gearJam = () => {
      this.ev = { ...this.ev, jam: true, win: false };
    };
    w.__gearFinale = (t: number) => {
      this.finaleT = t;
      this.stars.visible = true;
    };
    w.__gearPull = (on: boolean) => {
      this.master.target = this.master.pos = on ? 1 : 0;
      this.clutch.target = this.clutch.pos = on ? 1 : 0;
    };
    w.__gearPlace = (peg: number, item: number) => this.place(item, peg);
    w.__gearSolve = () => {
      this.lv.solution.forEach((it, p) => {
        if (it >= 0) this.place(it, p);
      });
    };

    const down = (e: PointerEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      this.mouseSeen = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const up = () => {
      this.mouseDown = false;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
  }

  private setVisible(v: boolean): void {
    this.root.visible = v;
    this.hud.mesh.visible = v;
    for (const b of this.btns) b.mesh.visible = v;
  }

  // ---------------------------------------------------------------- levels
  private loadLevel(i: number): void {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, i));
    curStyle = chapterOf(this.level) % 3;
    orbitals.length = 0;
    const lv = this.lv;
    this.solved = false;
    this.levelT = 0;
    this.mistakes = 0;
    this.gradeLine = '';
    this.power = 0;
    this.angle = 0;
    this.runWin = 0;
    this.jamT = 0;
    this.lastPlaced = -1;
    this.finaleT = -1;
    this.done.mesh.visible = false;
    for (const l of [this.master, this.clutch]) {
      l.pos = l.target = 0;
      l.drag = false;
    }
    this.clutch.g.visible = needsClutch(this.level);
    for (const d of this.clutch.deco) d.visible = this.clutch.g.visible;
    this.piston.visible = this.level >= 2;
    this.stars.visible = false;
    for (const d of this.doors) d.rotation.y = 0;
    (this.core.material as MeshBasicMaterial).opacity = 0;
    for (const grp of [this.partsGroup, this.fixedGroup, this.conduits, this.pegGroup]) grp.position.set(0, 0, 0);
    {
      const top = lv.target.maxRatio * 1.5;
      const m = this.rpmFace.material as MeshBasicMaterial;
      m.map = gaugeTexture('RPM', [lv.target.minRatio / top, lv.target.maxRatio / top]);
      m.needsUpdate = true;
    }
    this.placement = lv.pegs.map(() => -1);
    for (const o of [...this.pegGroup.children]) this.pegGroup.remove(o);
    for (const o of [...this.partsGroup.children]) this.partsGroup.remove(o);
    for (const o of [...this.fixedGroup.children]) this.fixedGroup.remove(o);
    for (const o of [...this.conduits.children]) this.conduits.remove(o);
    this.conduitMats = [];
    this.fixed.clear();
    this.pegMeshes = [];
    this.items = [];
    const brass = metal(0xd6a94a, 0.28, 0.4);
    lv.pegs.forEach((p, k) => {
      const peg = new Mesh(new CylinderGeometry(0.0075, 0.0075, 0.05, 14), brass);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(p.x, BY + p.y, BZ + 0.025);
      peg.castShadow = true;
      this.pegGroup.add(peg);
      this.pegMeshes.push(peg);
      const base = new Mesh(new CylinderGeometry(0.013, 0.013, 0.004, 20), brass);
      base.rotation.x = Math.PI / 2;
      base.position.set(p.x, BY + p.y, BZ + 0.002);
      this.pegGroup.add(base);
      void k;
    });
    // motor and output wheel
    const mp = lv.pegs[lv.motor.peg];
    const tp = lv.pegs[lv.target.peg];
    const motor = makeGear(lv.motor.n, curStyle, wornMetal(0x8a3a2a, 0.35));
    motor.position.set(mp.x, BY + mp.y, BZ + Z0);
    motor.castShadow = motor.receiveShadow = true;
    this.fixedGroup.add(motor);
    this.fixed.set(lv.motor.peg + ':0', motor);
    const box = new Mesh(roundedBox(0.07, 0.07, 0.03, 0.005), ironMat());
    box.position.set(mp.x, BY + mp.y, BZ + Z0 + 0.026);
    box.castShadow = true;
    this.fixedGroup.add(box);
    const led = new Mesh(new CylinderGeometry(0.006, 0.006, 0.004, 12), new MeshBasicMaterial({ color: 0xff7a3a }));
    led.rotation.x = Math.PI / 2;
    led.position.set(mp.x, BY + mp.y + 0.026, BZ + Z0 + 0.043);
    this.fixedGroup.add(led);
    this.crank = new Group();
    const brassC = metal(0xd6a94a, 0.28, 0.3);
    const arm = new Mesh(roundedBox(0.012, 0.09, 0.008, 0.003), brassC);
    arm.position.set(0, 0.045, 0);
    const knob = new Mesh(new CylinderGeometry(0.011, 0.011, 0.03, 14), metal(0x2c2a2a, 0.4, 0.5));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0, 0.09, 0.012);
    const hubC = new Mesh(new CylinderGeometry(0.013, 0.013, 0.01, 14), brassC);
    hubC.rotation.x = Math.PI / 2;
    this.crank.add(arm, knob, hubC);
    this.crank.position.set(mp.x, BY + mp.y, BZ + Z0 + 0.05);
    arm.castShadow = knob.castShadow = true;
    this.fixedGroup.add(this.crank);
    const out = makeGear(lv.target.n, curStyle, wornMetal(0x2f6f86, 0.32));
    out.position.set(tp.x, BY + tp.y, BZ + (lv.target.layer === 0 ? Z0 : Z1));
    out.castShadow = out.receiveShadow = true;
    this.fixedGroup.add(out);
    this.fixed.set(lv.target.peg + ':' + lv.target.layer, out);
    this.ring.position.set(tp.x, BY + tp.y, BZ + 0.04);
    this.ring.scale.setScalar(outerRadius(lv.target.n) / 0.1 + 0.18);
    this.lamp.position.set(tp.x, BY + tp.y, BZ + 0.004);
    this.lamp.scale.setScalar(outerRadius(lv.target.n) / 0.1 + 0.55);
    // the rack
    const n = lv.inventory.length;
    let maxR = 0;
    for (const d of lv.inventory) for (const p of d.parts) maxR = Math.max(maxR, outerRadius(p.n));
    const span = Math.min(maxR * 2 * RACK_SCALE + 0.03, 1.62 / Math.max(1, n));
    lv.inventory.forEach((def, k) => {
      const g = new Group();
      const meshes: Mesh[] = def.parts.map((p) => {
        const m = makeGear(p.n);
        m.position.z = p.layer === 0 ? Z0 : Z1;
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        return m;
      });
      if (def.parts.length > 1) {
        const ax = new Mesh(new CylinderGeometry(0.009, 0.009, 0.03, 12), metal(0xc9c2b4, 0.25, 0.3));
        ax.rotation.x = Math.PI / 2;
        ax.position.z = (Z0 + Z1) / 2;
        g.add(ax);
      }
      const hx = (k - (n - 1) / 2) * span;
      const item: Item = { def, g, meshes, peg: -1, x: hx, y: TRAY_Y, home: { x: hx, y: TRAY_Y }, held: false, lift: 0 };
      this.items.push(item);
      this.partsGroup.add(g);
      this.syncItem(item);
    });
    this.evaluateNow();
    this.msg = '';
    this.msgT = 0;
    this.hudDirty = true;
    this.drawBtns();
  }

  private syncItem(it: Item): void {
    it.g.position.set(it.x, BY + it.y, BZ + it.lift);
    it.g.scale.setScalar(it.peg >= 0 || it.held ? 1 : RACK_SCALE); // parts in the rack are shown smaller so a big rack stays tidy
  }

  private place(itemIdx: number, peg: number): boolean {
    const it = this.items[itemIdx];
    if (!it || peg < 0 || peg >= this.lv.pegs.length) return false;
    if (peg === this.lv.motor.peg || peg === this.lv.target.peg || this.placement[peg] >= 0) return false;
    if (!fits(this.lv, this.placement, peg, itemIdx)) return false;
    if (it.peg >= 0) this.placement[it.peg] = -1;
    this.placement[peg] = itemIdx;
    this.lastPlaced = itemIdx;
    it.peg = peg;
    const p = this.lv.pegs[peg];
    it.x = p.x;
    it.y = p.y;
    it.lift = 0;
    this.syncItem(it);
    this.evaluateNow();
    return true;
  }

  /** Blue energy conduits run along every meshed link; they light up when the machine solves the goal. */
  private rebuildConduits(): void {
    for (const o of [...this.conduits.children]) this.conduits.remove(o);
    this.conduitMats = [];
    const parts = this.ev.parts;
    for (const s of parts) {
      if (s.parent < 0) continue;
      const a = this.lv.pegs[parts[s.parent].peg];
      const b = this.lv.pegs[s.peg];
      if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
      const mat = new MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      this.conduitMats.push(mat);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const m = new Mesh(new PlaneGeometry(len, 0.012), mat);
      m.position.set((a.x + b.x) / 2, BY + (a.y + b.y) / 2, BZ + 0.037);
      m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      this.conduits.add(m);
    }
  }

  private measure(): void {
    const lv = this.lv;
    const need = lv.solution.filter((x) => x >= 0).length || 1;
    const have = this.placement.filter((x) => x >= 0).length;
    this.progress = this.solved ? 1 : Math.min(1, have / need) * 0.9;
    if (this.solved || (this.ev.win && this.power > 0.9)) this.efficiency = 1;
    else if (this.ev.jam) this.efficiency = 0.04;
    else if (this.ev.ratio <= 0) this.efficiency = 0;
    else {
      const goal = Math.sqrt(lv.target.minRatio * lv.target.maxRatio);
      const c = Math.min(this.ev.ratio, goal) / Math.max(this.ev.ratio, goal);
      this.efficiency = Math.min(0.9, c * (this.ev.dir === lv.target.dir ? 1 : 0.5)) * (this.power > 0.3 ? 1 : 0.7);
    }
  }

  private evaluateNow(): void {
    this.ev = evaluate(this.lv, this.placement);
    this.phi = new Array(this.ev.parts.length).fill(0);
    this.rebuildConduits();
    this.measure();
    if (this.prevDir !== 0 && this.ev.dir !== 0 && this.ev.dir !== this.prevDir && this.power > 0.2) sfx.crunch('bronze', 0);
    this.prevDir = this.ev.dir;
    this.runWin = 0;
    this.jamT = 0;
    this.hudDirty = true;
  }

  /** Called once the machine has run the right way long enough. */
  private finishWin(): void {
    this.solved = true;
    this.unlocked = Math.max(this.unlocked, Math.min(LEVELS.length - 1, this.level + 1));
    try {
      localStorage.setItem('pw-gear-level', String(this.unlocked));
    } catch {
      /* ignore */
    }
    const tp = this.lv.pegs[this.lv.target.peg];
    celebrate(tp.x, BY + tp.y, BZ + 0.1, 3);
    this.sparks.spray(tp.x, BY + tp.y, BZ + 0.06, 0, 1, 40, 1, 0.8, 0.35, 0.9);
    this.shake = 1;
    const last = this.level === LEVELS.length - 1;
    if (last) sfx.finale();
    else sfx.chime();
    sfx.hiss(0.8);
    buzz(last ? 220 : 90);
    this.sparks.steam(0.5, BY + 0.2, BZ + 0.08, 26);
    if (last) {
      this.finaleT = 0;
      this.stars.visible = true;
    }
    const stars = this.mistakes === 0 ? 3 : this.mistakes <= 2 ? 2 : 1;
    let bestNote = '';
    try {
      const raw = JSON.parse(localStorage.getItem('pw-gear-best') ?? '{}') as Record<string, { stars: number; time: number }>;
      const prev = raw[this.level];
      const newBest = !prev || stars > prev.stars || (stars === prev.stars && this.levelT < prev.time);
      bestNote = prev ? (newBest ? '  NEW BEST' : '  best ' + Math.round(prev.time) + 's') : '  first clear';
      if (newBest) {
        raw[this.level] = { stars, time: Math.round(this.levelT * 10) / 10 };
        localStorage.setItem('pw-gear-best', JSON.stringify(raw));
      }
    } catch {
      /* ignore */
    }
    const grade = stars === 3 ? 'FLAWLESS BUILD' : stars === 2 ? 'CLEAN BUILD' : 'SOLVED';
    this.gradeLine = grade + '  ' + stars + '/3 stars  ' + Math.round(this.levelT) + 's  ' + (this.mistakes ? this.mistakes + ' jam' + (this.mistakes > 1 ? 's' : '') : 'no jams') + bestNote;
    this.msg = (last ? 'The Orrery awakens!  ' : '') + grade + '  ' + stars + '/3 stars  ' + Math.round(this.levelT) + 's  ' + (this.mistakes ? this.mistakes + ' jam' + (this.mistakes > 1 ? 's' : '') : 'no jams') + bestNote + (last ? '' : '  -  press NEXT');
    if (stars === 3) {
      celebrate(tp.x, BY + tp.y, BZ + 0.14, 4);
      sfx.chime();
    }
    this.msgT = 12;
    askMentor('gears', 'a gear train that solves the puzzle "' + this.lv.name + '" with an output ratio of ' + this.ev.ratio.toFixed(1) + 'x', (t) => {
      this.msg = t;
      this.msgT = 12;
      this.hudDirty = true;
    });
    this.drawBtns();
    this.hudDirty = true;
  }

  private ejectLast(): void {
    this.mistakes += 1;
    const idx = this.lastPlaced;
    const it = this.items[idx];
    if (!it || it.peg < 0) return;
    const p = this.lv.pegs[it.peg];
    this.sparks.spray(p.x, BY + p.y, BZ + 0.06, 0, 1, 40, 1, 0.3, 0.12, 1.0);
    buzz([60, 40, 90]);
    this.shake = 1;
    this.placement[it.peg] = -1;
    it.peg = -1;
    it.x = it.home.x;
    it.y = it.home.y;
    this.syncItem(it);
    this.lastPlaced = -1;
    this.master.target = 0;
    this.master.pos = Math.min(this.master.pos, 0.6);
    sfx.thud(0.8);
    sfx.lever();
    this.evaluateNow();
    this.msg = 'JAM!  The gear was ejected back to the rack';
    this.msgT = 4;
    this.hudDirty = true;
  }

  private press(id: number): void {
    if (id === 0) this.loadLevel(this.level - 1);
    else if (id === 1) this.loadLevel(this.level);
    else if (this.level < this.unlocked || this.solved) this.loadLevel(this.level + 1);
    else {
      this.msg = 'Solve this level first';
      this.msgT = 3;
      this.hudDirty = true;
    }
  }

  // ---------------------------------------------------------------- hud
  private drawBtns(): void {
    const nextOpen = this.solved || this.level < this.unlocked;
    const spec: [string, string, string, boolean][] = [
      ['\u25C0', 'PREVIOUS LEVEL', '#5fe0ff', this.level > 0],
      ['\u21BA', 'RESET GEARS', '#ffc857', true],
      ['\u25B6', nextOpen ? 'NEXT LEVEL' : 'LOCKED', '#7dff9b', nextOpen],
    ];
    for (let i = 0; i < 3; i++) {
      const p = this.btns[i];
      const c = p.ctx;
      const [icon, label, accent, on] = spec[i];
      const W = p.w;
      const H = p.h;
      c.clearRect(0, 0, W, H);
      const g = c.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, on ? '#141b33' : '#15151b');
      g.addColorStop(1, on ? '#07091a' : '#0a0a0e');
      c.fillStyle = g;
      c.beginPath();
      c.roundRect(5, 5, W - 10, H - 10, H / 2.4);
      c.fill();
      c.shadowColor = on ? accent : '#444';
      c.shadowBlur = on ? 18 : 0;
      c.strokeStyle = on ? accent : '#4a4a55';
      c.lineWidth = 6;
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = on ? accent : '#5a5a66';
      c.beginPath();
      c.arc(H * 0.5, H / 2, H * 0.27, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#060814';
      c.textAlign = 'center';
      c.font = '800 ' + H * 0.3 + 'px "Segoe UI", Arial, sans-serif';
      c.fillText(icon, H * 0.5, H * 0.62);
      c.fillStyle = on ? '#ffffff' : '#7a7a86';
      c.textAlign = 'left';
      c.font = '800 ' + H * 0.27 + 'px "Segoe UI", Arial, sans-serif';
      const max = W - H * 0.95 - 20;
      const m = c.measureText(label).width;
      if (m > max) c.font = '800 ' + Math.floor((H * 0.27 * max) / m) + 'px "Segoe UI", Arial, sans-serif';
      c.fillText(label, H * 0.95, H * 0.6);
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    const lv = this.lv;
    h.card('rgba(26,18,12,0.9)', '#d6a94a');
    h.text(CHAPTERS[chapterOf(this.level)] + '   -   ' + lv.name, 52, 28, '#fff1d6');
    h.text(this.solved && this.gradeLine ? this.gradeLine : lv.goal, 104, 28, this.solved ? '#8dff9d' : '#ffd9a0');
    if (this.msgT > 0) h.text(this.msg, 152, 28, '#8dff9d');
    else h.text(this.placement.filter((x) => x >= 0).length >= lv.solution.filter((x) => x >= 0).length ? (needsClutch(this.level) ? 'Pull CLUTCH (left) and IGNITION (right) to test' : 'Pull the IGNITION lever (right) to test') : 'Hint: ' + lv.hint, 152, 24, '#e8d3a8');
    const r = this.ev && this.ev.ratio > 0 ? 'Output ' + this.ev.ratio.toFixed(2) + 'x  ' + (this.ev.dir === lv.target.dir ? 'right way' : 'wrong way') : 'Output not connected yet';
    h.text(r + '    Assembly ' + Math.round(this.progress * 100) + '%   Torque ' + Math.round(this.efficiency * 100) + '%', 198, 22, '#e0b46a');
    h.commit();
  }

  // ---------------------------------------------------------------- input
  private readPinch(hand: HandName): boolean {
    const adapter = this.input.xr.visualAdapters.hand[hand];
    if (adapter.connected) {
      const s = adapter.getPinchStrength();
      return this.pinching[hand] ? s >= PINCH_HOLD : s >= PINCH_START;
    }
    const pad = this.input.xr.gamepads[hand];
    return pad ? pad.getButtonPressed('xr-standard-trigger') : false;
  }

  private readHandPos(hand: HandName, out: Vector3): boolean {
    const ad = this.input.xr.visualAdapters.hand[hand];
    if (readPinchPoint(ad as never, out)) return true;
    const space = (ad.connected ? ad.gripSpace : undefined) ?? this.player.gripSpaces[hand];
    if (!space) return false;
    space.getWorldPosition(out);
    return true;
  }

  private mousePoint(out: Vector3): boolean {
    const cam = this.world.camera;
    this.ndc.set((this.mouseX / window.innerWidth) * 2 - 1, -(this.mouseY / window.innerHeight) * 2 + 1, 0.5);
    this.ndc.unproject(cam);
    cam.getWorldPosition(this.cam);
    this.ndc.sub(this.cam);
    if (Math.abs(this.ndc.z) < 1e-5) return false;
    const t = (BZ + 0.03 - this.cam.z) / this.ndc.z;
    if (t <= 0) return false;
    out.copy(this.cam).addScaledVector(this.ndc, t);
    return true;
  }

  private updatePointer(pt: Pointer): void {
    let have = false;
    if (pt.src === 'mouse') {
      pt.down = this.mouseDown;
      have = pt.down && this.mousePoint(pt.pos);
    } else {
      const p = this.readPinch(pt.src);
      this.pinching[pt.src] = p;
      pt.down = p;
      have = p && this.readHandPos(pt.src, pt.pos);
    }
    if (!have) pt.down = false;
    const bx = pt.pos.x;
    const by = pt.pos.y - BY;
    if (pt.down && !pt.was) {
      for (const l of [this.master, this.clutch]) {
        if (!l.g.visible || Math.hypot(l.x - bx, BY + l.top - l.pos * TRAVEL - (by + BY)) > 0.05) continue;
        l.drag = true;
        pt.lever = l;
        sfx.grab();
      }
    }
    if (pt.down && pt.lever) {
      const l = pt.lever;
      l.pos = Math.max(0, Math.min(1, (l.top - by) / TRAVEL));
      l.target = l.pos;
    }
    if (!pt.down && pt.lever) {
      pt.lever.drag = false;
      pt.lever.target = pt.lever.pos > 0.5 ? 1 : 0;
      pt.lever.vel = 0;
      pt.lever = null;
    }
    if (pt.down && !pt.was && !pt.lever) {
      let best: Item | null = null;
      let bd = 1e9;
      for (const it of this.items) {
        if (it.held) continue;
        const rr = Math.max(...it.def.parts.map((p) => outerRadius(p.n)));
        const d = Math.hypot(it.x - bx, it.y - by);
        if (d < Math.max(PICK_R, rr) && d / rr < bd) {
          bd = d / rr;
          best = it;
        }
      }
      if (best) {
        if (best.peg >= 0) {
          this.placement[best.peg] = -1;
          best.peg = -1;
          this.evaluateNow();
        }
        best.held = true;
        best.lift = 0.05;
        pt.held = best;
        sfx.grab();
      }
    }
    if (pt.down && pt.held) {
      pt.held.x = bx;
      pt.held.y = by;
      this.syncItem(pt.held);
    }
    if (!pt.down && pt.was && pt.held) {
      const it = pt.held;
      pt.held = null;
      it.held = false;
      it.lift = 0;
      let bestPeg = -1;
      let bd = SNAP_R;
      this.lv.pegs.forEach((p, k) => {
        if (k === this.lv.motor.peg || k === this.lv.target.peg || this.placement[k] >= 0) return;
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d < bd) {
          bd = d;
          bestPeg = k;
        }
      });
      const idx = this.items.indexOf(it);
      if (bestPeg >= 0 && this.place(idx, bestPeg)) {
        const p = this.lv.pegs[bestPeg];
        sfx.seat(kindOf(it.def.parts[0].n), p.x / 0.6);
        buzz(25);
        this.sparks.spray(p.x, BY + p.y, BZ + 0.05, 0, 1, 18, 1, 0.78, 0.35, 0.55);
        this.shake = Math.max(this.shake, 0.25);
      } else {
        if (bestPeg >= 0) {
          sfx.thud(0.4);
          this.msg = 'Those teeth do not fit there';
          this.msgT = 2.5;
          this.hudDirty = true;
        }
        it.x = it.home.x;
        it.y = it.home.y;
        this.syncItem(it);
      }
    }
    pt.was = pt.down;
  }

  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    if (this.optCooldown > 0) this.optCooldown -= delta;
    const benchKey = modeState.mode + (gsStage.stage === 'bench' ? '' : '|race');
    if (benchKey !== this.lastMode) {
      this.lastMode = benchKey as typeof this.lastMode;
      const on = modeState.mode === 'gears' && gsStage.stage === 'bench';
      this.setVisible(on);
      if (!on) {
        sfx.whirr(0);
        for (let i = 0; i < 3; i++) sfx.mesh(i, 0, 'bronze', 0);
      }
      if (on) this.loadLevel(Math.min(this.unlocked, this.level));
    }
    if (modeState.mode !== 'gears' || gsStage.stage !== 'bench') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    this.time += dt;
    if (!this.solved && modeState.mode === 'gears') this.levelT += dt;
    for (const pt of this.pointers) this.updatePointer(pt);
    this.updateGuide(dt);

    // levers ease toward their target; the ignition spins the motor up
    for (const l of [this.master, this.clutch]) {
      if (!l.drag) {
        // spring-damper: snaps to its stop with a little elastic overshoot
        l.vel += ((l.target - l.pos) * 160 - l.vel * 13) * dt;
        l.pos += l.vel * dt;
        if (l.pos > 1.07) {
          l.pos = 1.07;
          l.vel = 0;
        } else if (l.pos < -0.07) {
          l.pos = -0.07;
          l.vel = 0;
        }
      } else l.vel = 0;
      if (l.g.visible && Math.floor(l.pos * 8) !== Math.floor(l.tickPos * 8) && Math.abs(l.pos - l.tickPos) < 0.5) sfx.leverTick(l.pos < l.tickPos);
      l.tickPos = l.pos;
      if (l.pos > 0.92 && !l.slammed) {
        l.slammed = true;
        this.shake = Math.max(this.shake, 0.7);
        sfx.lever();
        if (l === this.master) sfx.ignite();
        buzz(40);
      } else if (l.pos < 0.5) l.slammed = false;
      l.g.position.y = BY + l.top - l.pos * TRAVEL;
    }
    const masterOn = this.master.pos > 0.85;
    const clutchOk = !needsClutch(this.level) || this.clutch.pos > 0.85;
    this.power += ((masterOn ? 1 : 0) - this.power) * Math.min(1, dt * (masterOn ? 1.6 : 2.5));
    const parts = this.ev.parts;
    const jamming = this.ev.jam && this.power > 0.3 && clutchOk && parts.length > 1;
    const driven = parts.length > 1 && clutchOk && !this.ev.jam;
    const powered = driven && this.power > 0.04;
    const over0 = powered && this.ev.ratio > this.lv.target.maxRatio;
    if (!jamming) this.angle += OMEGA * this.power * dt;
    let outPhi = this.outPhi;
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i];
      if (s.parent < 0) this.phi[i] = this.angle;
      else if (!driven) continue;
      else if (s.sibling) this.phi[i] = this.phi[s.parent];
      else this.phi[i] = -(s.parentN / s.n) * this.phi[s.parent] + s.c;
      const m = this.meshFor(s.peg, s.layer);
      if (m) m.rotation.z = this.phi[i];
      if (s.peg === this.lv.target.peg && s.layer === this.lv.target.layer) outPhi = this.phi[i];
    }
    this.outPhi = outPhi;
    if (jamming) {
      this.jamT += dt;
      this.grindT -= dt;
      if (this.grindT <= 0) {
        this.grindT = 0.38;
        sfx.grind(0);
      }
      for (const s of parts) {
        const m = this.meshFor(s.peg, s.layer);
        if (m) m.rotation.z += (Math.random() - 0.5) * 0.09;
      }
      this.fixedGroup.position.x = this.partsGroup.position.x = (Math.random() - 0.5) * 0.004;
      if (this.jamT > 1.4) this.ejectLast();
    } else {
      this.jamT = 0;
      this.fixedGroup.position.x = this.partsGroup.position.x = 0;
    }
    if (powered && this.power > 0.9 && this.ev.win && !this.solved) {
      this.runWin += dt;
      if (this.runWin > 1.2) this.finishWin();
    } else if (!this.solved) this.runWin = 0;
    if (powered && this.ev.ratio > this.lv.target.maxRatio && this.ev.dir === this.lv.target.dir && this.msgT <= 0.1) {
      this.msg = 'Over-revving!  Too fast for the regulator';
      this.msgT = 1.2;
      this.hudDirty = true;
    }
    if (powered) {
      this.tickT -= dt * (0.5 + this.power * 1.5);
      if (this.tickT <= 0) {
        this.tickT = 0.35;
        this.tockFlip = !this.tockFlip;
        sfx.tickTock(this.tockFlip, this.power * Math.min(1, this.ev.ratio / 2), this.lv.pegs[this.lv.target.peg].x / 0.6);
      }
    }
    // tooth-mesh sound: clicks per second = rpm x teeth / 60 for each meshing pair (three loudest voices)
    let slot = 0;
    for (let i = 1; i < parts.length && slot < 3; i++) {
      const s = parts[i];
      if (s.parent < 0 || s.sibling) continue;
      const pa = parts[s.parent];
      const rate = powered ? s.n * Math.abs(s.omega) * this.power : 0;
      const kind = kindOf(s.n) === 'iron' && kindOf(pa.n) === 'iron' ? 'iron' : kindOf(s.n) === 'iron' ? kindOf(pa.n) : kindOf(s.n);
      sfx.mesh(slot, rate, kind, 0.5, (s.x + pa.x) / 1.2);
      slot++;
    }
    for (; slot < 3; slot++) sfx.mesh(slot, 0, 'bronze', 0);
    // visual feedback on meshing: a pulse of light at every contact, red + gravity sparks when stressed
    const stress = jamming || over0;
    let ri = 0;
    for (let i = 1; i < parts.length && ri < 4; i++) {
      const s = parts[i];
      if (s.parent < 0 || s.sibling) continue;
      const pa = parts[s.parent];
      const rp = this.ripples[ri++];
      const on = (powered || jamming) && this.power > 0.1;
      rp.visible = on;
      if (!on) continue;
      const d = Math.hypot(s.x - pa.x, s.y - pa.y) || 1;
      const f = radius(pa.n) / (radius(pa.n) + radius(s.n));
      rp.position.set(pa.x + (s.x - pa.x) * f, BY + pa.y + (s.y - pa.y) * f, BZ + (s.layer === 0 ? Z0 : Z1) + 0.012);
      const rate = Math.min(7, s.n * Math.abs(s.omega) * this.power * 0.3);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * rate * Math.PI * 2);
      const m = rp.material as MeshBasicMaterial;
      m.color.setHex(stress ? 0xff4a1c : 0xffd27a);
      m.opacity = (stress ? 0.75 : 0.18 + 0.4 * pulse) * Math.min(1, this.power * 1.5);
      rp.scale.setScalar(stress ? 1.5 + Math.random() * 0.6 : 0.8 + pulse * 0.5);
      void d;
      if (stress && Math.random() < dt * 14) this.sparks.spray(rp.position.x, rp.position.y, rp.position.z, (Math.random() - 0.5) * 2, 1, 3, 1, 0.45, 0.1, 0.8);
    }
    for (; ri < 4; ri++) this.ripples[ri].visible = false;
    // chapter ornaments: independent orbital rings, copper coils that spark, plasma filaments that breathe
    for (const o of orbitals) {
      o.rotation.y += dt * 0.9;
      o.rotation.z += dt * 0.4;
    }
    const coil = shared.coilM as MeshStandardMaterial | undefined;
    if (coil) coil.emissiveIntensity = powered ? (0.25 + 0.75 * Math.random()) * this.power : 0;
    const fil = shared.filM as MeshBasicMaterial | undefined;
    if (fil) {
      fil.opacity = 0.45 + 0.4 * Math.sin(this.time * 3) * this.power + (powered ? 0.2 : 0);
      fil.color.setHex(stress ? 0xff5a2a : 0x38bdf8);
    }
    if (powered && !this.wasPowered && parts.length > 1) sfx.crunch(kindOf(parts[1].n), parts[1].x / 0.6);
    this.wasPowered = powered;
    const overNow = powered && this.ev.ratio > this.lv.target.maxRatio;
    this.overHissT -= dt;
    if (overNow && (!this.wasOver || this.overHissT <= 0)) {
      sfx.hiss(0.85);
      this.overHissT = 2.5;
    }
    this.wasOver = overNow;
    sfx.whirr(this.power > 0.02 && !jamming ? 0.15 + 0.6 * this.power * (powered ? Math.min(1, 0.4 + this.ev.ratio * 0.3) : 0.5) : 0);
    // piston pumps with the output wheel; aether tube shows the machine's state
    this.rod.position.y = BY + 0.27 + 0.035 * Math.sin(this.outPhi);
    const over = powered && this.ev.ratio > this.lv.target.maxRatio;
    const calmT = jamming ? 1 : over ? 0.85 : 0;
    this.tubeMat.uniforms.uTime.value = this.time;
    this.tubeMat.uniforms.uCalm.value += (calmT - this.tubeMat.uniforms.uCalm.value) * Math.min(1, dt * 5);
    this.tubeMat.uniforms.uPower.value = 0.35 + this.power * 0.65;
    this.fill.color.setHex(jamming || over ? 0xff4a30 : 0x4fd0ff);
    this.fill.intensity = 0.4 + this.power * 1.6 + (jamming ? Math.random() * 0.8 : 0);
    const hz = powered ? Math.max(0, Math.min(1, (this.ev.ratio * this.power) / this.lv.target.maxRatio - 0.45) * 1.8) : 0;
    this.hazeMat.uniforms.uTime.value = this.time;
    this.hazeMat.uniforms.uStrength.value += (hz - this.hazeMat.uniforms.uStrength.value) * Math.min(1, dt * 3);
    this.hazeGroup.visible = this.piston.visible;
    const mt = musicState;
    const tTen = powered ? 0.4 + 0.6 * this.power : 0;
    mt.tension += (tTen - mt.tension) * Math.min(1, dt * 1.5);
    mt.jam += ((jamming ? 1 : 0) - mt.jam) * Math.min(1, dt * 3);
    mt.swell += ((this.solved ? 1 : 0) - mt.swell) * Math.min(1, dt * 0.8);
    if (over && Math.random() < dt * 5) this.sparks.steam(0.5, BY + 0.2, BZ + 0.08, 2);
    tickQuality(dt);
    const qt = quality.tier;
    this.key.castShadow = qt >= 2;
    this.dust.geometry.setDrawRange(0, qt >= 3 ? DUST : qt === 2 ? 70 : qt === 1 ? 35 : 0);
    this.hazeGroup.visible = this.piston.visible && qt >= 1;
    // juice: bench micro-shake (never the player's camera, which would be uncomfortable in VR)
    this.shake = jamming ? Math.max(this.shake, 0.45) : this.shake * Math.exp(-dt * 6);
    this.root.position.set((Math.random() - 0.5) * 0.006 * this.shake, (Math.random() - 0.5) * 0.006 * this.shake + Math.sin(this.time * 1.3) * 0.0014, 0);
    this.root.rotation.z = Math.sin(this.time * 0.8) * 0.0018 + (Math.random() - 0.5) * 0.004 * this.shake;
    this.sparks.update(dt);
    // crank follows the motor wheel
    const mm = this.fixed.get(this.lv.motor.peg + ':0');
    if (mm) this.crank.rotation.z = mm.rotation.z;
    // sparks: golden at meshing teeth while running, red where the train is jammed
    this.sparkT -= dt;
    if (this.sparkT <= 0 && parts.length > 1) {
      this.sparkT = this.ev.jam ? 0.09 : 0.45;
      const s = parts[1 + Math.floor(Math.random() * (parts.length - 1))];
      const a = s.parent >= 0 ? parts[s.parent] : null;
      const pa = this.lv.pegs[s.peg];
      const pb = a ? this.lv.pegs[a.peg] : pa;
      if (this.ev.jam) this.sparks.spray((pa.x + pb.x) / 2, BY + (pa.y + pb.y) / 2, BZ + 0.045, (Math.random() - 0.5) * 2, 1, 9, 1, 0.35, 0.12, 0.9);
      else if (powered && a && !s.sibling) this.sparks.spray((pa.x + pb.x) / 2, BY + (pa.y + pb.y) / 2, BZ + 0.045, 0, 1, 3, 1, 0.8, 0.35, 0.35);
    }
    // gauges
    this.measure();
    const rpm01 = powered ? Math.min(1, (this.ev.ratio * this.power) / (this.lv.target.maxRatio * 1.5)) : 0;
    const target = [this.progress, rpm01];
    const pp = Math.round(this.progress * 100);
    const ee = Math.round(this.efficiency * 100);
    if (pp !== this.lastP || ee !== this.lastE) {
      this.lastP = pp;
      this.lastE = ee;
      this.hudDirty = true;
    }
    for (let gi = 0; gi < 2; gi++) {
      this.needleVal[gi] += (target[gi] - this.needleVal[gi]) * Math.min(1, dt * 4);
      if (this.needles[gi]) this.needles[gi].rotation.z = Math.PI * 0.75 - this.needleVal[gi] * Math.PI * 1.5;
    }
    // Edison flicker and dust
    const fl = 1 + Math.sin(this.time * 17) * 0.03 + Math.sin(this.time * 5.3) * 0.04;
    this.lights.forEach((l, i) => (l.intensity = 1.2 * fl * (i ? 0.95 : 1)));
    this.key.intensity = 9 * fl;
    this.bulbGlow.forEach((b) => ((b.material as MeshBasicMaterial).opacity = 0.16 * fl));
    for (let i = 0; i < DUST; i++) {
      const a = this.dustSeed[i * 3];
      const b = this.dustSeed[i * 3 + 1];
      const c = this.dustSeed[i * 3 + 2];
      this.dustPos[i * 3] = (a - 0.5) * 1.3 + Math.sin(this.time * 0.15 + b * 20) * 0.05;
      this.dustPos[i * 3 + 1] = BY - 0.35 + ((b * 0.9 + this.time * 0.012 * (0.5 + c)) % 0.9);
      this.dustPos[i * 3 + 2] = BZ + 0.04 + c * 0.5 + Math.cos(this.time * 0.12 + a * 20) * 0.03;
    }
    (this.dust.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    // glowing conduits + emissive gears when the machine works
    const pulse = this.solved ? 0.55 + 0.35 * Math.sin(this.time * 7) : 0;
    this.conduitMats.forEach((m) => (m.opacity = this.ev.win ? pulse : 0));
    const em = this.solved ? 0.12 + 0.1 * Math.sin(this.time * 7) : 0;
    for (const it of this.items) for (const m of it.meshes) if (!Array.isArray(m.material) && n0(m.material)) (m.material as MeshStandardMaterial).emissive.setRGB(0, em * 0.7, em);
    if (this.finaleT >= 0) {
      this.finaleT += dt;
      if (this.finaleT > 5) this.done.mesh.visible = true;
      const e = Math.min(1, this.finaleT / 3);
      const k = e * e * (3 - 2 * e);
      this.doors[0].rotation.y = k * 1.25;
      this.doors[1].rotation.y = -k * 1.25;
      (this.core.material as MeshBasicMaterial).opacity = k * (0.5 + 0.12 * Math.sin(this.time * 3));
      for (const grp of [this.partsGroup, this.fixedGroup, this.conduits, this.pegGroup]) {
        grp.position.y = k * 0.05 + Math.sin(this.time * 1.5) * 0.004 * k;
        grp.position.z = k * 0.18;
      }
      this.stars.rotation.y = this.time * 0.25;
      for (let i = 3; i < this.stars.children.length; i++) {
        const rg = this.stars.children[i];
        rg.rotation.y = this.time * (rg.userData.speed as number);
      }
      for (const m of this.ringMats) m.opacity = 0.45 * k;
      ((this.stars.children[0] as Points).material as PointsMaterial).opacity = k;
      ((this.stars.children[1] as LineSegments).material as LineBasicMaterial).opacity = 0.4 * k;
      if (Math.random() < dt * 2) emitBurst((Math.random() - 0.5) * 0.7, BY + 0.1 + Math.random() * 0.3, BZ + 0.5, 0.4 + Math.random() * 0.6, 0.7, 1, 14, 0.5);
    }
    // output lamp
    const glow = this.solved ? 0.55 + 0.25 * Math.sin(this.time * 6) : 0;
    (this.ring.material as MeshBasicMaterial).opacity += (glow - (this.ring.material as MeshBasicMaterial).opacity) * Math.min(1, dt * 6);
    (this.lamp.material as MeshBasicMaterial).opacity = (this.ring.material as MeshBasicMaterial).opacity * 0.5;

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.hudDirty = true;
    }
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
    void this.wp;
    void this.lampGlow;
  }

  /** Holographic blueprint guide: hovering (or carrying a gear over) an empty axle projects a ring, a fit list and a ghost gear. */
  private updateGuide(dt: number): void {
    let held: Item | null = null;
    for (const pt of this.pointers) if (pt.held) held = pt.held;
    let have = false;
    let hx = 0;
    let hy = 0;
    if (held) {
      hx = held.x;
      hy = held.y;
      have = true;
    } else if (this.mouseSeen && !this.mouseDown && this.mousePoint(this.hoverPos)) {
      hx = this.hoverPos.x;
      hy = this.hoverPos.y - BY;
      have = true;
    }
    let peg = -1;
    let bd = 0.075;
    if (have) {
      this.lv.pegs.forEach((p, k) => {
        if (k === this.lv.motor.peg || k === this.lv.target.peg || this.placement[k] >= 0) return;
        const d = Math.hypot(p.x - hx, p.y - hy);
        if (d < bd) {
          bd = d;
          peg = k;
        }
      });
    }
    const heldIdx = held ? this.items.indexOf(held) : -1;
    const key = peg * 100 + heldIdx + 1;
    if (key !== this.guidePeg) {
      this.guidePeg = key;
      if (peg >= 0) {
        const fit: string[] = [];
        this.items.forEach((it, idx) => {
          if ((it.peg < 0 || idx === heldIdx) && fits(this.lv, this.placement, peg, idx)) fit.push(it.def.parts.map((q) => q.n).join('/') + 'T');
        });
        const g = this.guideCtx;
        g.clearRect(0, 0, 512, 128);
        g.fillStyle = 'rgba(6,28,40,0.72)';
        g.fillRect(4, 4, 504, 120);
        g.strokeStyle = 'rgba(110,220,255,0.9)';
        g.lineWidth = 3;
        g.strokeRect(4, 4, 504, 120);
        g.fillStyle = '#9fe6ff';
        g.font = '600 28px monospace';
        g.fillText('AXLE ' + (peg + 1) + (heldIdx >= 0 ? (fits(this.lv, this.placement, peg, heldIdx) ? '  - release to seat' : '  - teeth clash') : ''), 18, 36);
        g.fillStyle = '#e6fbff';
        g.font = '26px monospace';
        let spin = '';
        if (heldIdx >= 0 && fits(this.lv, this.placement, peg, heldIdx)) {
          const pl = this.placement.slice();
          pl[peg] = heldIdx;
          const part = evaluate(this.lv, pl).parts.find((q) => q.peg === peg);
          const dn = this.items[heldIdx].def.parts;
          spin = dn.map((q) => q.n).join('/') + 'T ' + (dn.length > 1 ? 'Compound' : 'Spur') + (part && part.parent >= 0 ? (part.omega > 0 ? '  \u21bb same as motor' : '  \u21ba opposite') : '');
        }
        if (spin) {
          g.fillStyle = '#ffe9a8';
          g.font = '26px monospace';
          g.fillText(spin, 18, 76);
          g.fillStyle = '#e6fbff';
        }
        g.fillText(fit.length ? 'fits: ' + fit.join('  ') : 'no free gear fits here', 18, 114);
        this.guideTex.needsUpdate = true;
      }
    }
    const ringM = this.guideRing.material as MeshBasicMaterial;
    const labM = this.guideLabel.material as MeshBasicMaterial;
    const ghM = this.ghost.material as MeshBasicMaterial;
    const on = peg >= 0;
    ringM.opacity += ((on ? 0.8 : 0) - ringM.opacity) * Math.min(1, dt * 10);
    labM.opacity += ((on ? 0.95 : 0) - labM.opacity) * Math.min(1, dt * 10);
    if (on) {
      const p = this.lv.pegs[peg];
      const bob = Math.sin(this.time * 3) * 0.004;
      this.guideRing.position.set(p.x, BY + p.y, BZ + 0.05);
      this.guideRing.rotation.z = this.time;
      this.guideRing.scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
      this.guideLabel.position.set(p.x, BY + p.y + 0.09 + bob, BZ + 0.11);
    }
    const showGhost = on && held !== null;
    if (showGhost && held) {
      const ok = fits(this.lv, this.placement, peg, heldIdx);
      const p = this.lv.pegs[peg];
      this.ghost.geometry = gearGeometry(held.def.parts[0].n);
      this.ghost.position.set(p.x, BY + p.y, BZ + 0.03);
      this.ghost.rotation.z = this.time * 0.5;
      ghM.color.setHex(ok ? 0x66d8ff : 0xff5a44);
    }
    ghM.opacity += ((showGhost ? 0.6 : 0) - ghM.opacity) * Math.min(1, dt * 10);
  }

  private meshFor(peg: number, layer: number): Mesh | null {
    const f = this.fixed.get(peg + ':' + layer);
    if (f) return f;
    const idx = this.placement[peg];
    if (idx < 0) return null;
    const it = this.items[idx];
    const k = it.def.parts.findIndex((p) => p.layer === layer);
    return k >= 0 ? it.meshes[k] : null;
  }
}
