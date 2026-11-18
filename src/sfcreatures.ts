/**
 * SPELLFORGE creature models (the seven regular enemies). Procedural, built from layered primitives: articulated
 * limbs with knees, jaws, hoods, antlers, orbiting armour, emissive eyes and cores. Each builder fills the group
 * it is given and returns a per-frame tick (no allocation inside). Visual only: hit volumes and logic live elsewhere.
 * Models face +Z (toward the player).
 */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Object3D,
  SphereGeometry,
  Sprite,
  TorusGeometry,
} from '@iwsdk/core';
import type { RigState } from './sfboss';

export interface CreatureCtx {
  g: Group;
  M: (hex: number, em: number, emI: number, rough?: number, metal?: number) => MeshStandardMaterial;
  /** register an already built material so hit flashes affect it */
  reg: (m: MeshStandardMaterial) => MeshStandardMaterial;
  glow: (hex: number, o?: number) => MeshBasicMaterial;
  spr: (hex: number, size: number, op: number) => Sprite;
}
export type Tick = (dt: number, t: number, st: RigState) => void;

const sphereGeo = new SphereGeometry(1, 18, 14);
const boxGeo = new BoxGeometry(1, 1, 1);
const coneGeo = new ConeGeometry(1, 1, 7);
const unitCyl = (r0: number, r1: number, len: number, seg = 8): CylinderGeometry => {
  const geo = new CylinderGeometry(r1, r0, len, seg);
  geo.translate(0, -len / 2, 0); // pivot at the top so limbs swing from the joint
  return geo;
};
/** ellipsoid */
function ell(mat: MeshStandardMaterial | MeshBasicMaterial, rx: number, ry: number, rz: number): Mesh {
  const m = new Mesh(sphereGeo, mat);
  m.scale.set(rx, ry, rz);
  return m;
}
function box(mat: MeshStandardMaterial | MeshBasicMaterial, x: number, y: number, z: number): Mesh {
  const m = new Mesh(boxGeo, mat);
  m.scale.set(x, y, z);
  return m;
}
/** cone with base radius r and height h, tip along +Y */
function cone(mat: MeshStandardMaterial | MeshBasicMaterial, r: number, h: number): Mesh {
  const m = new Mesh(coneGeo, mat);
  m.scale.set(r, h, r);
  return m;
}
/** limb hanging from its top pivot */
function limb(mat: MeshStandardMaterial, r0: number, r1: number, len: number, seg = 8): Mesh {
  return new Mesh(unitCyl(r0, r1, len, seg), mat);
}
/** scale relative to the scale the mesh was built with (ticks must never overwrite the base size) */
function sk(m: Object3D, kx: number, ky = kx, kz = kx): void {
  const b = (m.userData.b ??= m.scale.clone()) as { x: number; y: number; z: number };
  m.scale.set(b.x * kx, b.y * ky, b.z * kz);
}
function at<T extends Object3D>(o: T, parent: Object3D, x = 0, y = 0, z = 0): T {
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ------------------------------------------------------------------------------------------------ voidling
function voidling(c: CreatureCtx): Tick {
  const { g, M, glow, spr } = c;
  const dark = M(0x160a2c, 0x5a20b0, 0.35, 0.35, 0.3);
  const crack = M(0x2a1050, 0xb070ff, 1.7, 0.4);
  const plate = M(0x0e0620, 0x3a1580, 0.3, 0.3, 0.6);
  const root = new Group();
  at(root, g, 0, 0.62, 0);
  const body = at(ell(dark, 0.3, 0.34, 0.3), root);
  // glowing fissures wrapped around the body
  for (let i = 0; i < 6; i++) {
    const arc = new Mesh(new TorusGeometry(0.305, 0.011, 6, 24, Math.PI * 0.75), crack);
    arc.rotation.set(i * 1.1, i * 0.9 + 0.4, i * 0.7);
    root.add(arc);
  }
  // single large eye with a slit pupil
  const eye = at(ell(glow(0xf0e0ff, 0.95), 0.12, 0.13, 0.05), root, 0, 0.04, 0.27);
  const pupil = at(box(M(0x08020f, 0x000000, 0), 0.022, 0.12, 0.02), root, 0, 0.04, 0.325);
  // broken shell plates that orbit and open when it winds up
  const shell = new Group();
  root.add(shell);
  const plates: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const p = ell(plate, 0.13, 0.2, 0.05);
    const a = (i / 4) * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.45, Math.sin(a * 1.7) * 0.1, Math.sin(a) * 0.45);
    p.lookAt(0, 0, 0);
    shell.add(p);
    plates.push(p);
  }
  // spines
  for (let i = 0; i < 9; i++) {
    const s = cone(plate, 0.045, 0.3);
    const a = (i / 9) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.2, 0.25 + (i % 3) * 0.04, -0.18 + Math.sin(a) * 0.16);
    s.rotation.set(-0.7 - (i % 3) * 0.2, 0, -Math.cos(a) * 0.5);
    root.add(s);
  }
  // trailing tendrils
  const tend: Mesh[][] = [];
  for (let k = 0; k < 4; k++) {
    const chain: Mesh[] = [];
    for (let j = 0; j < 6; j++) {
      const s = ell(dark, 0.07 - j * 0.009, 0.07 - j * 0.009, 0.07 - j * 0.009);
      root.add(s);
      chain.push(s);
    }
    tend.push(chain);
  }
  at(spr(0x8a40ff, 1.5, 0.5), root);
  return (dt, t, st) => {
    root.position.y = 0.62 + Math.sin(t * 2.2) * 0.07;
    shell.rotation.y += dt * (st.frozen ? 0.05 : 0.9);
    const open = st.tele > 0 ? 1.45 : 1;
    shell.scale.setScalar(open);
    sk(pupil, 1, 1 + (st.tele > 0 ? 0.6 : Math.sin(t * 3) * 0.12), 1);
    sk(eye, 1 + Math.sin(t * 5) * 0.06);
    body.rotation.y += dt * 0.5;
    for (let k = 0; k < tend.length; k++) {
      const ang = (k / tend.length) * Math.PI * 2 + 0.6;
      for (let j = 0; j < tend[k].length; j++) {
        const f = (j + 1) / tend[k].length;
        tend[k][j].position.set(
          Math.cos(ang) * 0.22 * (1 - f * 0.3) + Math.sin(t * 2 + k + j * 0.6) * 0.07 * f,
          -0.12 - f * 0.45 + Math.sin(t * 1.7 + k) * 0.03,
          -0.2 - f * 0.4 + Math.sin(ang) * 0.12,
        );
      }
    }
  };
}

// ------------------------------------------------------------------------------------------------ ember beast
function emberBeast(c: CreatureCtx): Tick {
  const { g, M, glow, spr } = c;
  const rock = M(0x1e0c08, 0xff4a10, 0.22, 0.88, 0.1);
  const lava = M(0x3a1008, 0xff7a20, 1.9, 0.5);
  const flame = glow(0xff8a2a, 0.85);
  const root = new Group();
  at(root, g, 0, 0, 0);
  at(ell(rock, 0.36, 0.3, 0.62), root, 0, 0.8, 0); // torso
  at(ell(rock, 0.3, 0.27, 0.34), root, 0, 0.84, -0.4); // haunch
  for (let i = 0; i < 9; i++) {
    const cr = box(lava, 0.03, 0.02, 0.22);
    cr.position.set(((i % 3) - 1) * 0.15, 1.08 - Math.abs((i % 3) - 1) * 0.06, -0.3 + Math.floor(i / 3) * 0.3);
    cr.rotation.set(0, (i % 2 ? 1 : -1) * 0.5, (i % 3 - 1) * 0.3);
    root.add(cr);
  }
  at(ell(lava, 0.22, 0.14, 0.2), root, 0, 0.72, 0.3); // glowing chest
  // neck + head
  at(ell(rock, 0.17, 0.2, 0.3), root, 0, 0.98, 0.52).rotation.x = -0.6;
  const head = new Group();
  at(head, root, 0, 1.0, 0.8);
  at(ell(rock, 0.2, 0.17, 0.25), head);
  at(box(rock, 0.2, 0.11, 0.26), head, 0, -0.03, 0.23); // snout
  at(ell(M(0x050202, 0, 0), 0.035, 0.03, 0.02), head, -0.05, 0.0, 0.36); // nostrils
  at(ell(M(0x050202, 0, 0), 0.035, 0.03, 0.02), head, 0.05, 0.0, 0.36);
  const jaw = new Group();
  at(jaw, head, 0, -0.1, 0.1);
  at(box(rock, 0.18, 0.045, 0.28), jaw, 0, 0, 0.13);
  at(box(lava, 0.14, 0.02, 0.22), jaw, 0, 0.03, 0.13);
  for (let i = 0; i < 5; i++) {
    at(cone(M(0xf0e0c0, 0x8a4a20, 0.2), 0.012, 0.06), jaw, -0.07 + i * 0.035, 0.05, 0.2);
    const tUp = at(cone(M(0xf0e0c0, 0x8a4a20, 0.2), 0.012, 0.06), head, -0.07 + i * 0.035, -0.08, 0.3);
    tUp.rotation.x = Math.PI;
  }
  for (const sx of [-1, 1]) {
    at(ell(glow(0xffe08a, 1), 0.04, 0.03, 0.03), head, sx * 0.1, 0.06, 0.15);
    // horns: three curved segments
    for (let j = 0; j < 3; j++) {
      const h = cone(M(0x120604, 0xff4010, 0.5), 0.05 - j * 0.012, 0.2);
      h.position.set(sx * (0.11 + j * 0.05), 0.17 + j * 0.13, -0.05 - j * 0.07);
      h.rotation.set(-0.4 - j * 0.4, 0, -sx * (0.5 + j * 0.2));
      head.add(h);
    }
  }
  // flaming mane along the spine
  const mane: Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const f = cone(flame, 0.07, 0.3 + (i % 3) * 0.06);
    f.position.set(0, 1.12 + (i < 3 ? i * 0.03 : 0), 0.45 - i * 0.18);
    root.add(f);
    mane.push(f);
  }
  // tail
  const tail: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const s = ell(rock, 0.09 - i * 0.012, 0.09 - i * 0.012, 0.12);
    root.add(s);
    tail.push(s);
  }
  const tailFire = at(spr(0xff7a20, 0.9, 0.6), root, 0, 0.9, -1.15);
  // legs: hip -> upper -> knee -> lower -> paw
  const hips: Group[] = [];
  const knees: Group[] = [];
  for (const [x, z] of [[-0.24, 0.38], [0.24, 0.38], [-0.24, -0.4], [0.24, -0.4]] as [number, number][]) {
    const hip = new Group();
    at(hip, root, x, 0.68, z);
    at(limb(rock, 0.11, 0.07, 0.36), hip);
    const knee = new Group();
    at(knee, hip, 0, -0.36, 0);
    at(limb(rock, 0.07, 0.05, 0.34), knee).rotation.x = 0;
    at(box(lava, 0.13, 0.04, 0.2), knee, 0, -0.34, 0.04);
    hips.push(hip);
    knees.push(knee);
  }
  at(spr(0xff6a20, 1.4, 0.45), root, 0, 0.95, -0.35);
  return (_dt, t, st) => {
    const run = st.frozen ? 0 : 1;
    for (let i = 0; i < 4; i++) {
      const ph = t * 7 + (i === 1 || i === 2 ? Math.PI : 0);
      hips[i].rotation.x = Math.sin(ph) * 0.6 * run;
      knees[i].rotation.x = Math.max(0, -Math.sin(ph + 0.6)) * 0.9 * run;
    }
    root.position.y = Math.abs(Math.sin(t * 7)) * 0.05 * run;
    jaw.rotation.x = st.tele > 0 ? 0.7 : 0.08 + Math.sin(t * 3) * 0.04;
    head.rotation.x = st.tele > 0 ? -0.35 : Math.sin(t * 2) * 0.05;
    root.rotation.x = st.tele > 0 ? -0.22 : 0;
    for (let i = 0; i < mane.length; i++) sk(mane[i], 1, (0.8 + Math.sin(t * 9 + i * 1.3) * 0.25) * (i % 3 ? 1 : 1.2), 1);
    for (let i = 0; i < tail.length; i++) tail[i].position.set(Math.sin(t * 3 + i * 0.7) * 0.07 * (i + 1) * 0.4, 0.88 + i * 0.015, -0.68 - i * 0.12);
    tailFire.position.set(Math.sin(t * 3 + 3.5) * 0.07, 0.92, -1.3);
  };
}

// ------------------------------------------------------------------------------------------------ frost wraith
function frostWraith(c: CreatureCtx): Tick {
  const { g, M, glow, spr, reg } = c;
  const cloth = reg(new MeshStandardMaterial({ color: 0x7cc0f0, emissive: 0x2a70c0, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, roughness: 0.25, metalness: 0.2, side: DoubleSide }));
  const inner = reg(new MeshStandardMaterial({ color: 0x1a3258, emissive: 0x1a5aa0, emissiveIntensity: 0.4, transparent: true, opacity: 0.9, roughness: 0.4, side: DoubleSide }));
  const ice = M(0xdff6ff, 0x7fd8ff, 1.3, 0.1, 0.2);
  const root = new Group();
  at(root, g, 0, 1.05, 0);
  const robe = new Group();
  at(robe, root);
  at(new Mesh(new ConeGeometry(0.5, 1.3, 12, 1, true), cloth), robe, 0, -0.1, 0);
  at(new Mesh(new ConeGeometry(0.36, 1.2, 10, 1, true), inner), robe, 0, -0.05, 0);
  const tatters: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tt = cone(cloth, 0.07, 0.42 + (i % 3) * 0.1);
    tt.position.set(Math.cos(a) * 0.47, -0.72, Math.sin(a) * 0.47);
    tt.rotation.x = Math.PI;
    robe.add(tt);
    tatters.push(tt);
  }
  at(ell(cloth, 0.3, 0.12, 0.2), root, 0, 0.5, 0); // shoulders
  // hood and hollow face
  at(ell(inner, 0.22, 0.27, 0.23), root, 0, 0.72, 0);
  at(ell(M(0x030a14, 0, 0), 0.14, 0.18, 0.1), root, 0, 0.72, 0.13);
  for (const sx of [-1, 1]) at(ell(glow(0xaaf0ff, 1), 0.03, 0.03, 0.02), root, sx * 0.06, 0.74, 0.22);
  // frost crown
  const crown: Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const cr = cone(ice, 0.035, 0.28 + (i % 2) * 0.1);
    cr.position.set(Math.cos(a) * 0.19, 0.98, Math.sin(a) * 0.17 - 0.03);
    cr.rotation.set(Math.sin(a) * 0.4 - 0.15, 0, -Math.cos(a) * 0.4);
    root.add(cr);
    crown.push(cr);
  }
  // arms: left holds a charging orb, right holds a crystal staff
  const armL = new Group();
  at(armL, root, -0.3, 0.5, 0.05);
  at(limb(cloth, 0.08, 0.05, 0.42), armL);
  const foreL = new Group();
  at(foreL, armL, 0, -0.42, 0);
  at(limb(cloth, 0.05, 0.035, 0.38), foreL);
  at(ell(ice, 0.05, 0.06, 0.05), foreL, 0, -0.4, 0);
  const orb = at(ell(glow(0x9fe8ff, 0.85), 0.12, 0.12, 0.12), foreL, 0, -0.55, 0.12);
  const armR = new Group();
  at(armR, root, 0.3, 0.5, 0.05);
  at(limb(cloth, 0.08, 0.05, 0.42), armR);
  const foreR = new Group();
  at(foreR, armR, 0, -0.42, 0);
  at(limb(cloth, 0.05, 0.035, 0.34), foreR);
  at(ell(ice, 0.05, 0.06, 0.05), foreR, 0, -0.36, 0);
  const staff = new Group();
  at(staff, foreR, 0, -0.36, 0.06);
  at(new Mesh(new CylinderGeometry(0.018, 0.018, 1.5, 6), M(0x6a8aa8, 0x3a7ac0, 0.5, 0.3, 0.5)), staff, 0, 0.2, 0);
  const gem = at(new Mesh(new OctahedronGeometry(0.1, 0), ice), staff, 0, 1.0, 0);
  gem.scale.y = 1.6;
  // drifting ice shards
  const shards: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const s = new Mesh(new OctahedronGeometry(0.06, 0), ice);
    s.scale.y = 1.8;
    root.add(s);
    shards.push(s);
  }
  at(spr(0x7fd8ff, 1.6, 0.4), root, 0, 0.3, 0);
  return (dt, t, st) => {
    root.position.y = 1.05 + Math.sin(t * 1.6) * 0.1;
    robe.rotation.z = Math.sin(t * 1.3) * 0.04;
    for (let i = 0; i < tatters.length; i++) sk(tatters[i], 1, 1 + Math.sin(t * 2.4 + i * 0.9) * 0.12, 1);
    const wind = st.tele > 0;
    armL.rotation.x = wind ? -2.1 : -0.5 + Math.sin(t * 1.5) * 0.08;
    foreL.rotation.x = wind ? -0.3 : -0.7;
    armR.rotation.x = wind ? -1.2 : -0.2;
    sk(orb, wind ? 1.9 + Math.sin(t * 24) * 0.2 : 1 + Math.sin(t * 3) * 0.1);
    gem.rotation.y += dt * (st.frozen ? 0 : 1.4);
    for (let i = 0; i < crown.length; i++) sk(crown[i], 1, 1 + Math.sin(t * 3 + i) * 0.12, 1);
    for (let i = 0; i < shards.length; i++) {
      const a = t * 0.8 + (i / shards.length) * Math.PI * 2;
      shards[i].position.set(Math.cos(a) * 0.65, 0.2 + Math.sin(a * 2 + i) * 0.35, Math.sin(a) * 0.65);
      shards[i].rotation.y += dt * 2;
    }
  };
}

// ------------------------------------------------------------------------------------------------ storm stalker
function stormStalker(c: CreatureCtx): Tick {
  const { g, M, glow, spr } = c;
  const armor = M(0x232a48, 0x8a9cff, 0.35, 0.3, 0.7);
  const plate = M(0x3a4470, 0xb7c4ff, 0.5, 0.25, 0.8);
  const arcMat = glow(0xe8ecff, 0.9);
  const root = new Group();
  at(root, g, 0, 0.88, 0);
  const torso = new Group();
  at(torso, root);
  torso.rotation.x = 0.3;
  at(ell(armor, 0.2, 0.24, 0.5), torso);
  for (let i = 0; i < 4; i++) at(box(plate, 0.34 - i * 0.03, 0.03, 0.14), torso, 0, 0.2 - i * 0.015, 0.3 - i * 0.2);
  at(ell(glow(0xdfe6ff, 0.9), 0.09, 0.09, 0.09), torso, 0, 0.04, 0.12); // chest coil
  // neck and head: wedge with a visor slit
  const neck = new Group();
  at(neck, torso, 0, 0.1, 0.42);
  neck.rotation.x = -0.9;
  at(limb(armor, 0.09, 0.07, 0.4), neck).rotation.x = Math.PI; // limb hangs down; flipped to point up/forward
  const head = new Group();
  at(head, neck, 0, 0.4, 0);
  head.rotation.x = 0.9;
  const wedge = at(cone(plate, 0.13, 0.46), head, 0, 0, 0.12);
  wedge.rotation.x = Math.PI / 2;
  wedge.scale.set(0.13, 0.46, 0.09);
  at(box(glow(0xcfe0ff, 1), 0.16, 0.03, 0.02), head, 0, 0.03, 0.3);
  for (const sx of [-1, 1]) {
    const an = at(cone(plate, 0.02, 0.28), head, sx * 0.08, 0.06, -0.08);
    an.rotation.set(-1.2, 0, -sx * 0.3);
  }
  // legs (digitigrade): hip -> thigh -> knee -> shin -> foot
  const hips: Group[] = [];
  const knees: Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new Group();
    at(hip, root, sx * 0.2, -0.05, -0.15);
    at(limb(armor, 0.11, 0.07, 0.5), hip).rotation.x = 0;
    const knee = new Group();
    at(knee, hip, 0, -0.5, 0);
    at(limb(armor, 0.07, 0.045, 0.5), knee);
    for (let j = -1; j <= 1; j++) {
      const toe = at(cone(plate, 0.02, 0.18), knee, j * 0.04, -0.5, 0.06);
      toe.rotation.x = Math.PI / 2;
    }
    hips.push(hip);
    knees.push(knee);
  }
  // arms ending in blades
  const arms: Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = new Group();
    at(arm, torso, sx * 0.22, 0.08, 0.3);
    at(limb(armor, 0.05, 0.035, 0.35), arm);
    const blade = at(cone(glow(0xdfe6ff, 0.9), 0.035, 0.5), arm, 0, -0.35, 0.05);
    blade.rotation.x = -Math.PI * 0.85;
    arms.push(arm);
  }
  // tail
  const tail: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const s = box(armor, 0.1 - i * 0.012, 0.1 - i * 0.012, 0.18);
    root.add(s);
    tail.push(s);
  }
  const spark = at(spr(0xe0e8ff, 0.7, 0.8), root, 0, 0, -1.25);
  // crackling arcs
  const arcs: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = box(arcMat, 0.012, 0.012, 0.5);
    root.add(a);
    arcs.push(a);
  }
  at(spr(0xa9b8ff, 1.6, 0.4), root, 0, 0.15, 0);
  const col = new Color();
  void col;
  return (_dt, t, st) => {
    const run = st.frozen ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const ph = t * 9 + i * Math.PI;
      hips[i].rotation.x = Math.sin(ph) * 0.7 * run - 0.3;
      knees[i].rotation.x = Math.max(0, Math.sin(ph + 1.3)) * 1.0 * run + 0.5;
    }
    root.position.y = 0.88 + Math.abs(Math.sin(t * 9)) * 0.05 * run;
    torso.rotation.x = st.tele > 0 ? 0.65 : 0.3;
    for (let i = 0; i < 2; i++) arms[i].rotation.x = st.tele > 0 ? -1.6 : -0.3 + Math.sin(t * 5 + i * 2) * 0.25;
    for (let i = 0; i < tail.length; i++) tail[i].position.set(Math.sin(t * 5 + i * 0.6) * 0.06 * i * 0.3, 0.05 - i * 0.02, -0.55 - i * 0.12);
    spark.position.set(0, -0.05, -1.35);
    const on = Math.sin(t * 37) > -0.25 || st.tele > 0;
    for (let i = 0; i < arcs.length; i++) {
      arcs[i].visible = on;
      arcs[i].position.set(Math.sin(t * 13 + i * 2) * 0.3, Math.cos(t * 17 + i) * 0.4, Math.sin(t * 11 + i * 3) * 0.3);
      arcs[i].rotation.set(Math.sin(t * 29 + i) * 1.5, Math.cos(t * 23 + i) * 1.5, Math.sin(t * 19 + i * 2) * 1.5);
    }
  };
}

// ------------------------------------------------------------------------------------------------ root colossus
function rootColossus(c: CreatureCtx): Tick {
  const { g, M, glow, spr } = c;
  const bark = M(0x2a1f14, 0x0e2a0e, 0.22, 0.95, 0);
  const bark2 = M(0x3a2a1a, 0x143a12, 0.22, 0.95, 0);
  const moss = M(0x3f6a2c, 0x1a4a14, 0.3, 0.9, 0);
  const coreMat = M(0xb8ffb8, 0x58e07a, 2.4, 0.1);
  const root = new Group();
  at(root, g, 0, 0, 0);
  const torso = new Group();
  at(torso, root, 0, 1.2, 0);
  at(ell(bark, 0.55, 0.68, 0.42), torso);
  at(ell(bark2, 0.4, 0.3, 0.36), torso, 0, -0.5, 0);
  // exposed rib cage with a glowing heart
  at(ell(coreMat, 0.17, 0.22, 0.12), torso, 0, 0.02, 0.3);
  for (let i = 0; i < 4; i++) {
    const rib = new Mesh(new TorusGeometry(0.32, 0.035, 6, 14, Math.PI * 0.7), bark2);
    rib.position.set(0, 0.28 - i * 0.14, 0.12);
    rib.rotation.set(0, -Math.PI * 0.15, Math.PI * 0.15);
    torso.add(rib);
  }
  at(ell(moss, 0.5, 0.14, 0.4), torso, 0, 0.62, 0); // mossy back
  // shoulders, arms, fists
  const arms: Group[] = [];
  for (const sx of [-1, 1]) {
    at(ell(moss, 0.3, 0.2, 0.28), torso, sx * 0.62, 0.5, 0);
    const arm = new Group();
    at(arm, torso, sx * 0.66, 0.45, 0.02);
    at(limb(bark, 0.17, 0.13, 0.75), arm);
    const fore = new Group();
    at(fore, arm, 0, -0.75, 0);
    at(limb(bark2, 0.14, 0.2, 0.62), fore);
    at(ell(bark, 0.26, 0.24, 0.26), fore, 0, -0.72, 0);
    for (let j = 0; j < 4; j++) {
      const rt = at(cone(bark2, 0.05, 0.3), fore, -0.15 + j * 0.1, -0.88, 0.1);
      rt.rotation.x = Math.PI;
    }
    arms.push(arm);
    arm.userData.fore = fore;
    // legs with root feet
    const leg = at(limb(bark, 0.22, 0.17, 0.72), root, sx * 0.3, 0.75, 0);
    void leg;
    for (let j = 0; j < 5; j++) {
      const a = -0.8 + j * 0.4;
      const toe = at(cone(bark2, 0.07, 0.4), root, sx * 0.3 + Math.sin(a) * 0.16, 0.08, Math.cos(a) * 0.2);
      toe.rotation.set(Math.PI / 2 + 0.2, 0, -Math.sin(a) * 0.8);
    }
  }
  // head with hollow glowing face and antlers
  const head = new Group();
  at(head, torso, 0, 0.98, 0.06);
  at(ell(bark, 0.25, 0.27, 0.24), head);
  at(ell(M(0x050a04, 0, 0), 0.17, 0.2, 0.1), head, 0, -0.01, 0.17);
  for (const sx of [-1, 1]) at(ell(glow(0x9affb0, 1), 0.04, 0.03, 0.02), head, sx * 0.08, 0.04, 0.26);
  at(box(glow(0x58e07a, 0.7), 0.14, 0.025, 0.02), head, 0, -0.1, 0.26);
  const antlers: Group[] = [];
  for (const sx of [-1, 1]) {
    const an = new Group();
    at(an, head, sx * 0.14, 0.18, -0.02);
    for (let j = 0; j < 4; j++) {
      const br = at(cone(bark2, 0.04 - j * 0.006, 0.3), an, sx * j * 0.07, j * 0.22, -j * 0.03);
      br.rotation.z = -sx * (0.4 + j * 0.15);
      at(ell(moss, 0.07, 0.025, 0.05), an, sx * (j * 0.07 + 0.08), j * 0.22 + 0.12, 0);
    }
    antlers.push(an);
  }
  // stone armour plates (shown while armour remains)
  const plates: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const p = new Mesh(new OctahedronGeometry(0.3, 0), M(0x6a7a6a, 0x335533, 0.3, 0.5, 0.5));
    const a = (i / 5) * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.72, 1.4 + Math.sin(i * 1.7) * 0.4, Math.sin(a) * 0.45 + 0.12);
    p.scale.set(1, 1.2, 0.7);
    root.add(p);
    plates.push(p);
  }
  const heart = at(spr(0x58e07a, 1.1, 0.5), torso, 0, 0.02, 0.35);
  return (_dt, t, st) => {
    const wind = st.tele > 0;
    for (let i = 0; i < 2; i++) {
      arms[i].rotation.x = wind ? -2.1 : Math.sin(t * 1.4 + i * 2) * 0.12;
      (arms[i].userData.fore as Group).rotation.x = wind ? -0.5 : -0.2 + Math.sin(t * 1.4 + i) * 0.06;
    }
    torso.rotation.y = Math.sin(t * 0.8) * 0.06;
    torso.position.y = 1.2 + Math.sin(t * 1.1) * 0.025;
    head.rotation.x = wind ? 0.3 : 0;
    for (let i = 0; i < antlers.length; i++) antlers[i].rotation.z = Math.sin(t * 1.2 + i) * 0.04;
    sk(heart, 1 + Math.sin(t * (wind ? 14 : 2.6)) * 0.18);
    for (let i = 0; i < plates.length; i++) plates[i].visible = st.armor;
  };
}

// ------------------------------------------------------------------------------------------------ shadow reaper
function shadowReaper(c: CreatureCtx): Tick {
  const { g, M, glow, spr, reg } = c;
  const robeMat = reg(new MeshStandardMaterial({ color: 0x0d0716, emissive: 0x3a1a6a, emissiveIntensity: 0.45, side: DoubleSide, roughness: 0.9 }));
  const robeMat2 = reg(new MeshStandardMaterial({ color: 0x170c2a, emissive: 0x4a2090, emissiveIntensity: 0.4, side: DoubleSide, roughness: 0.9 }));
  const bone = M(0xcfc8d8, 0x4a3a6a, 0.25, 0.6, 0.05);
  const dark = M(0x050308, 0x2a1050, 0.4, 0.6, 0.2);
  const root = new Group();
  at(root, g, 0, 0.1, 0);
  const robe = new Group();
  at(robe, root);
  at(new Mesh(new CylinderGeometry(0.2, 0.46, 1.25, 12, 1, true), robeMat), robe, 0, 0.7, 0);
  at(new Mesh(new CylinderGeometry(0.28, 0.58, 0.9, 12, 1, true), robeMat2), robe, 0, 0.45, 0);
  const rags: Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = cone(robeMat2, 0.09, 0.45 + (i % 3) * 0.12);
    r.position.set(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55);
    r.rotation.x = Math.PI;
    robe.add(r);
    rags.push(r);
  }
  // spiked pauldrons + hood + bone mask
  for (const sx of [-1, 1]) {
    at(ell(dark, 0.17, 0.1, 0.17), root, sx * 0.3, 1.32, 0);
    for (let j = 0; j < 3; j++) {
      const sp = at(cone(dark, 0.035, 0.28 - j * 0.05), root, sx * (0.34 + j * 0.05), 1.42 + j * 0.05, -0.03);
      sp.rotation.z = -sx * (0.7 + j * 0.25);
    }
  }
  const head = new Group();
  at(head, root, 0, 1.55, 0);
  at(ell(dark, 0.22, 0.27, 0.23), head);
  const mask = at(ell(bone, 0.15, 0.19, 0.09), head, 0, -0.01, 0.15);
  at(ell(M(0x000000, 0, 0), 0.04, 0.055, 0.02), mask, -0.35, 0.15, 0.85);
  at(ell(M(0x000000, 0, 0), 0.04, 0.055, 0.02), mask, 0.35, 0.15, 0.85);
  const eyes: Mesh[] = [];
  for (const sx of [-1, 1]) eyes.push(at(ell(glow(0xff2a50, 1), 0.022, 0.03, 0.02), head, sx * 0.055, 0.02, 0.235));
  at(box(M(0x000000, 0, 0), 0.07, 0.02, 0.01), mask, 0, -0.5, 0.95);
  for (const sx of [-1, 1]) for (let j = 0; j < 3; j++) {
    const h = at(cone(dark, 0.04 - j * 0.01, 0.2), head, sx * (0.14 + j * 0.06), 0.2 + j * 0.12, -0.04 - j * 0.06);
    h.rotation.set(-0.3 - j * 0.3, 0, -sx * (0.6 + j * 0.25));
  }
  // casting hand (left) and scythe hand (right)
  const handL = new Group();
  at(handL, root, -0.42, 1.0, 0.25);
  at(ell(bone, 0.05, 0.07, 0.03), handL);
  const palm = at(ell(glow(0xb070ff, 0.8), 0.08, 0.08, 0.08), handL, 0, 0.08, 0.05);
  const scythe = new Group();
  at(scythe, root, 0.5, 1.0, 0.2);
  at(new Mesh(new CylinderGeometry(0.02, 0.02, 1.8, 6), M(0x2a2036, 0x6a3aa8, 0.5, 0.4, 0.4)), scythe, 0, 0.4, 0);
  const blade = new Mesh(new TorusGeometry(0.42, 0.03, 8, 28, Math.PI * 0.85), M(0xc8b0ff, 0x9a5aff, 1.9, 0.2, 0.7));
  blade.position.set(0.4, 1.3, 0);
  blade.rotation.z = Math.PI * 0.08;
  scythe.add(blade);
  const edge = new Mesh(new TorusGeometry(0.42, 0.012, 6, 28, Math.PI * 0.85), glow(0xf0e0ff, 0.95));
  edge.position.copy(blade.position);
  edge.rotation.copy(blade.rotation);
  scythe.add(edge);
  at(ell(bone, 0.05, 0.07, 0.04), root, 0.5, 1.0, 0.2); // gripping hand
  // trailing wisps
  const wisps: Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const w = ell(glow(0x7a3ad0, 0.5 - i * 0.04), 0.07 - i * 0.006, 0.07 - i * 0.006, 0.07 - i * 0.006);
    root.add(w);
    wisps.push(w);
  }
  at(spr(0x6a2aa8, 1.8, 0.35), root, 0, 0.9, 0);
  return (_dt, t, st) => {
    root.position.y = 0.1 + Math.sin(t * 1.4) * 0.07;
    robe.rotation.z = Math.sin(t * 1.1) * 0.05;
    robe.rotation.x = Math.sin(t * 0.9) * 0.03;
    for (let i = 0; i < rags.length; i++) sk(rags[i], 1, 1 + Math.sin(t * 2.6 + i) * 0.14, 1);
    const wind = st.tele > 0;
    scythe.rotation.x = wind ? -1.6 : Math.sin(t * 1.2) * 0.1;
    scythe.rotation.z = wind ? 0.5 : -0.12;
    handL.rotation.x = wind ? -1.0 : 0;
    sk(palm, wind ? 2 + Math.sin(t * 20) * 0.3 : 1 + Math.sin(t * 3) * 0.1);
    for (let i = 0; i < eyes.length; i++) sk(eyes[i], 1 + Math.sin(t * 6 + i) * 0.15 + (wind ? 0.5 : 0));
    for (let i = 0; i < wisps.length; i++) {
      const f = i / wisps.length;
      wisps[i].position.set(Math.sin(t * 2 + i * 0.8) * 0.18 * f + 0.2, 0.3 + Math.sin(t * 1.5 + i) * 0.1, -0.5 - f * 0.7);
    }
  };
}

// ------------------------------------------------------------------------------------------------ arcane sentinel
function arcaneSentinel(c: CreatureCtx): Tick {
  const { g, M, glow, spr, reg } = c;
  const metal = M(0xb8a8d8, 0x6a4a9a, 0.35, 0.25, 0.85);
  const dark = M(0x2a1f3a, 0x4a2a7a, 0.3, 0.4, 0.7);
  const rune = M(0xd8a8ff, 0xd07cff, 1.7, 0.3);
  const root = new Group();
  at(root, g, 0, 1.4, 0);
  const core = at(new Mesh(new OctahedronGeometry(0.3, 0), M(0x7a2a9a, 0xd07cff, 1.5, 0.2, 0.3)), root);
  core.scale.y = 1.5;
  // a vertical eye lens on the front
  at(new Mesh(new TorusGeometry(0.2, 0.03, 8, 32), metal), root, 0, 0, 0.38);
  const pupil = at(ell(glow(0xf6e6ff, 0.95), 0.07, 0.17, 0.05), root, 0, 0, 0.4);
  // armour petals that flare outward when it winds up
  const petals: Group[] = [];
  const cage = new Group();
  root.add(cage);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pg = new Group();
    pg.rotation.y = a;
    cage.add(pg);
    const pl = at(box(metal, 0.07, 0.8, 0.34), pg, 0, 0, 0.62);
    pl.rotation.x = 0.0;
    at(box(rune, 0.02, 0.5, 0.02), pg, 0, 0, 0.8);
    at(cone(dark, 0.05, 0.22), pg, 0, 0.5, 0.62);
    at(cone(dark, 0.05, 0.22), pg, 0, -0.5, 0.62).rotation.x = Math.PI;
    petals.push(pg);
  }
  const r1 = at(new Mesh(new TorusGeometry(0.55, 0.028, 8, 44), rune), root) as Mesh;
  const r2 = at(new Mesh(new TorusGeometry(0.72, 0.022, 8, 44), rune), root) as Mesh;
  // floating base spire and satellites
  const spire = at(cone(dark, 0.22, 0.9), root, 0, -1.0, 0);
  spire.rotation.x = Math.PI;
  const sats: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new Mesh(new OctahedronGeometry(0.1, 0), rune);
    s.scale.y = 1.5;
    root.add(s);
    sats.push(s);
  }
  const shell = reg(new MeshStandardMaterial({ color: 0xb8a8d8, emissive: 0x6a4a9a, emissiveIntensity: 0.4, transparent: true, opacity: 0.3, roughness: 0.2, metalness: 0.7 }));
  const bubble = at(ell(shell, 0.95, 1.1, 0.95), root) as Mesh;
  at(spr(0xd07cff, 1.9, 0.45), root);
  return (dt, t, st) => {
    root.position.y = 1.4 + Math.sin(t * 1.3) * 0.08;
    core.rotation.y += dt * 1.3;
    cage.rotation.y += dt * (st.frozen ? 0.05 : 0.5);
    const flare = st.tele > 0 ? 1.45 : 1;
    for (let i = 0; i < petals.length; i++) petals[i].scale.set(1, 1, flare);
    r1.rotation.x += dt * 1.1;
    r2.rotation.y += dt * 0.9;
    sk(pupil, 1 + (st.tele > 0 ? 0.5 : 0), 1, 1);
    for (let i = 0; i < sats.length; i++) {
      const a = t * 1.1 + (i / sats.length) * Math.PI * 2;
      sats[i].position.set(Math.cos(a) * 0.95, Math.sin(a * 2) * 0.3, Math.sin(a) * 0.95);
      sats[i].rotation.y += dt * 2;
    }
    bubble.visible = st.armor;
  };
}

export function buildCreature(id: string, c: CreatureCtx): Tick | null {
  switch (id) {
    case 'voidling':
      return voidling(c);
    case 'ember_beast':
      return emberBeast(c);
    case 'frost_wraith':
      return frostWraith(c);
    case 'storm_stalker':
      return stormStalker(c);
    case 'root_colossus':
      return rootColossus(c);
    case 'shadow_reaper':
      return shadowReaper(c);
    case 'arcane_sentinel':
      return arcaneSentinel(c);
    default:
      return null;
  }
}
