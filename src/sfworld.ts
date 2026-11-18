/**
 * SPELLFORGE world art: the arena, enemy and boss models. Everything is built from primitives and
 * canvas textures (no external assets), then recoloured per realm. Models face +Z (toward the player).
 */
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Sprite,
  RingGeometry,
} from '@iwsdk/core';
import type { BossDef, EnemyDef } from './sfdata';
import { glowSprite, glowTexture } from './sfvfx';
import { buildBossRig } from './sfboss';
import type { BossRig, RigState } from './sfboss';

export type RealmId = 'sanctum' | 'ignar' | 'vyra' | 'voidking';
interface Theme {
  top: number;
  mid: number;
  bottom: number;
  accent: number;
  css: string;
  fog: number;
  fogD: number;
  floor: number;
  name: string;
}
export const THEMES: Record<RealmId, Theme> = {
  sanctum: { top: 0x080618, mid: 0x1b1650, bottom: 0x3a2a6a, accent: 0xb08cff, css: '#c4a8ff', fog: 0x0d0a22, fogD: 0.04, floor: 0x1a1430, name: 'The First Awakening' },
  ignar: { top: 0x1a0402, mid: 0x5a1406, bottom: 0xb03a0a, accent: 0xff7a1a, css: '#ff9a40', fog: 0x240804, fogD: 0.05, floor: 0x2a1410, name: 'The Ember Forge' },
  vyra: { top: 0x04061c, mid: 0x14225e, bottom: 0x3a5ac0, accent: 0xa9b8ff, css: '#c3ceff', fog: 0x060a26, fogD: 0.045, floor: 0x141a34, name: 'The Storm Citadel' },
  voidking: { top: 0x030008, mid: 0x1a0733, bottom: 0x4a1a80, accent: 0x9a5aff, css: '#b48cff', fog: 0x08010f, fogD: 0.055, floor: 0x150a22, name: 'The Void Throne' },
};

const std = (hex: number, em = 0, emI = 0, rough = 0.6, metal = 0.1): MeshStandardMaterial => new MeshStandardMaterial({ color: hex, emissive: em, emissiveIntensity: emI, roughness: rough, metalness: metal });
const glow = (hex: number, o = 0.9): MeshBasicMaterial => new MeshBasicMaterial({ color: hex, transparent: true, opacity: o, blending: AdditiveBlending, depthWrite: false });

function floorTexture(css: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#0a0812';
  g.fillRect(0, 0, 1024, 1024);
  g.translate(512, 512);
  g.strokeStyle = css;
  g.shadowColor = css;
  g.shadowBlur = 16;
  for (const [r, w] of [[490, 6], [440, 2], [330, 4], [210, 3], [90, 5]] as [number, number][]) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r1 = i % 2 ? 440 : 330;
    g.beginPath();
    g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.lineTo(Math.cos(a) * (r1 + (i % 4 === 0 ? 50 : 28)), Math.sin(a) * (r1 + (i % 4 === 0 ? 50 : 28)));
    g.stroke();
  }
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 * 3 + k * 0.4;
      const r = 210;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
  }
  g.shadowBlur = 0;
  g.font = '700 38px serif';
  g.fillStyle = css;
  g.textAlign = 'center';
  const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.save();
    g.translate(Math.cos(a) * 385, Math.sin(a) * 385);
    g.rotate(a + Math.PI / 2);
    g.fillText(glyphs[i % glyphs.length], 0, 12);
    g.restore();
  }
  return new CanvasTexture(c);
}

export class Arena {
  readonly group = new Group();
  private domeMat: ShaderMaterial;
  private floorMat: MeshStandardMaterial;
  private crystals: MeshStandardMaterial[] = [];
  private stars: Points;
  private key: PointLight;
  private fill: PointLight;
  private amb: AmbientLight;
  private sun: DirectionalLight;
  readonly pylonMeshes: { group: Group; orb: Mesh; mat: MeshStandardMaterial; halo: Sprite }[] = [];
  private floorTex: Record<string, CanvasTexture> = {};
  theme: RealmId = 'sanctum';
  private tt = 0;
  private columns: Group[] = [];
  private rift: Mesh;

  constructor() {
    this.domeMat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: new Color() }, uMid: { value: new Color() }, uBot: { value: new Color() }, uT: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform float uT;
        void main(){ float h = clamp(vP.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(uBot, uMid, smoothstep(0.35, 0.62, h)); c = mix(c, uTop, smoothstep(0.62, 1.0, h));
          float n = sin(vP.x * 9.0 + uT * 0.05) * sin(vP.z * 7.0 - uT * 0.04) * 0.04;
          gl_FragColor = vec4(c + n * uMid, 1.0); }`,
    });
    const dome = new Mesh(new SphereGeometry(60, 32, 20), this.domeMat);
    dome.renderOrder = -10;
    this.group.add(dome);

    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.95 + 0.05);
      sp[i * 3] = Math.sin(ph) * Math.cos(th) * 55;
      sp[i * 3 + 1] = Math.cos(ph) * 55;
      sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 55;
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(sp, 3));
    this.stars = new Points(sg, new PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
    this.group.add(this.stars);

    this.floorMat = std(0xffffff, 0xffffff, 0.8, 0.5, 0.3);
    const floor = new Mesh(new CircleGeometry(10, 72), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    // a dark apron beyond the sigil
    const apron = new Mesh(new CircleGeometry(60, 32), std(0x07060c, 0, 0, 0.9, 0));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    this.group.add(apron);

    // pillar ring with glowing crystals
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const col = new Group();
      const base = new Mesh(new CylinderGeometry(0.42, 0.55, 0.5, 8), std(0x1c1a26, 0, 0, 0.8, 0.2));
      base.position.y = 0.25;
      const shaft = new Mesh(new CylinderGeometry(0.28, 0.36, 3.6 + (i % 3) * 0.7, 8), std(0x26232f, 0, 0, 0.7, 0.2));
      shaft.position.y = 2.3 + (i % 3) * 0.35;
      const m = std(0xffffff, 0xffffff, 1.4, 0.2, 0.1);
      this.crystals.push(m);
      const cr = new Mesh(new OctahedronGeometry(0.34, 0), m);
      cr.scale.y = 1.8;
      cr.position.y = 4.6 + (i % 3) * 0.7;
      col.add(base, shaft, cr);
      col.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9);
      col.userData.cr = cr;
      this.columns.push(col);
      this.group.add(col);
    }
    // a rift ring behind the boss
    this.rift = new Mesh(new TorusGeometry(3.2, 0.08, 10, 80), glow(0xffffff, 0.55));
    this.rift.position.set(0, 3.4, -9.4);
    this.group.add(this.rift);

    // Vyra's three pylons (visible only in the Storm Citadel)
    for (let i = 0; i < 3; i++) {
      const g = new Group();
      // short conductive pylons: the orb sits at the height the lightning has to hit (1 m), below the line of sight to Vyra
      const shaft = new Mesh(new CylinderGeometry(0.1, 0.22, 0.75, 6), std(0x20243a, 0, 0, 0.4, 0.8));
      shaft.position.y = 0.375;
      const mat = std(0x8aa0ff, 0x6a80ff, 1.2, 0.2, 0);
      const orb = new Mesh(new IcosahedronGeometry(0.22, 1), mat);
      orb.position.y = 1.0;
      for (let k = 0; k < 3; k++) {
        const fin = new Mesh(new ConeGeometry(0.035, 0.42, 4), std(0x6a74a8, 0x3a4ad0, 0.6, 0.3, 0.8));
        const a = (k / 3) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 0.2, 0.95, Math.sin(a) * 0.2);
        fin.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
        g.add(fin);
      }
      const halo = glowSprite(0x8aa0ff, 1.0, 0.6);
      halo.position.y = 1.0;
      g.add(shaft, orb, halo);
      g.visible = false;
      this.group.add(g);
      this.pylonMeshes.push({ group: g, orb, mat, halo });
    }

    this.amb = new AmbientLight(0x6a6aa0, 1.1);
    this.sun = new DirectionalLight(0xffffff, 0.7);
    this.sun.position.set(2, 8, 4);
    this.key = new PointLight(0xffffff, 40, 18, 1.6);
    this.key.position.set(0, 4.5, -5);
    this.fill = new PointLight(0xffffff, 12, 10, 1.6);
    this.fill.position.set(0, 2.2, 1);
    this.group.add(this.amb, this.sun, this.key, this.fill);
    this.setTheme('sanctum');
  }

  setTheme(id: RealmId): void {
    this.theme = id;
    const t = THEMES[id];
    const u = this.domeMat.uniforms;
    (u.uTop.value as Color).setHex(t.top);
    (u.uMid.value as Color).setHex(t.mid);
    (u.uBot.value as Color).setHex(t.bottom);
    this.floorTex[id] ??= floorTexture(t.css);
    this.floorMat.map = this.floorTex[id];
    this.floorMat.emissiveMap = this.floorTex[id];
    this.floorMat.emissive.setHex(t.accent);
    this.floorMat.color.setHex(t.floor);
    this.floorMat.needsUpdate = true;
    for (const m of this.crystals) {
      m.color.setHex(t.accent);
      m.emissive.setHex(t.accent);
    }
    this.key.color.setHex(t.accent);
    this.fill.color.setHex(t.accent);
    this.amb.color.setHex(t.mid).lerp(new Color(0x8080b0), 0.5);
    (this.rift.material as MeshBasicMaterial).color.setHex(t.accent);
    for (const p of this.pylonMeshes) p.group.visible = id === 'vyra';
    this.pylonMeshes.forEach((p, i) => p.group.position.set([-3, 0, 3][i], 0, [-5.5, -3.5, -5.5][i]));
  }
  /** light follows the boss / fight intensity */
  update(dt: number, t: number, intensity: number): void {
    this.tt += dt;
    (this.domeMat.uniforms.uT as { value: number }).value = t;
    this.stars.rotation.y += dt * 0.004;
    this.rift.rotation.z += dt * 0.15;
    this.key.intensity = 34 + intensity * 26 + Math.sin(t * 2.4) * 3;
    this.columns.forEach((c, i) => {
      (c.userData.cr as Object3D).rotation.y += dt * (0.5 + (i % 3) * 0.2);
      (c.userData.cr as Object3D).position.y += Math.sin(t * 1.4 + i) * 0.0015;
    });
  }
  setPylon(i: number, overload: number, barrierOn: boolean): void {
    const p = this.pylonMeshes[i];
    if (!p) return;
    const on = overload > 0;
    p.mat.emissiveIntensity = on ? 3 : barrierOn ? 1.2 : 0.4;
    p.mat.color.setHex(on ? 0xffffff : 0x6a80d8);
    p.halo.material.opacity = on ? 1 : 0.4;
    p.halo.scale.setScalar(on ? 1.9 : 1.0);
  }
}

// ----------------------------------------------------------------------------- creatures
export interface Rig {
  group: Group;
  /** st: telegraph seconds left, frozen / burning / rooted flags, hp fraction, armour left */
  tick(dt: number, t: number, st: RigState): void;
  flash(amount?: number): void;
  mats: MeshStandardMaterial[];
}

function finish(group: Group, mats: MeshStandardMaterial[], tick: Rig['tick']): Rig {
  let flash = 0;
  const base = mats.map((m) => m.emissiveIntensity);
  return {
    group,
    mats,
    flash: () => {
      flash = 0.18;
    },
    tick: (dt, t, st) => {
      flash = Math.max(0, flash - dt);
      mats.forEach((m, i) => {
        m.emissiveIntensity = base[i] + (flash > 0 ? 2.4 : 0) + (st.tele > 0 ? 0.8 + Math.sin(t * 22) * 0.5 : 0);
      });
      tick(dt, t, st);
    },
  };
}

export function buildEnemy(def: EnemyDef): Rig {
  const g = new Group();
  const mats: MeshStandardMaterial[] = [];
  const M = (hex: number, em: number, emI: number, rough = 0.55, metal = 0.1): MeshStandardMaterial => {
    const m = std(hex, em, emI, rough, metal);
    mats.push(m);
    return m;
  };
  const add = (o: Object3D, x = 0, y = 0, z = 0): Object3D => {
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const col = new Color(def.hex);
  const accent = col.clone().lerp(new Color(0xffffff), 0.45).getHex();
  switch (def.id) {
    case 'voidling': {
      const body = add(new Mesh(new IcosahedronGeometry(0.32, 1), M(0x2a1348, 0x8a40ff, 0.6, 0.4)), 0, 0.55, 0);
      for (let i = 0; i < 7; i++) {
        const sp = new Mesh(new ConeGeometry(0.06, 0.28, 5), M(0x1a0b30, 0x6a2ad0, 0.5));
        const a = (i / 7) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 0.55 + Math.sin(i * 2.1) * 0.15, Math.sin(a) * 0.3 - 0.05);
        sp.lookAt(sp.position.clone().multiplyScalar(4));
        sp.rotateX(Math.PI / 2);
        g.add(sp);
      }
      add(new Mesh(new SphereGeometry(0.1, 12, 10), glow(0xe6d0ff, 1)), 0, 0.58, 0.28);
      add(glowSprite(0x8a40ff, 1.3, 0.5), 0, 0.55, 0);
      return finish(g, mats, (dt, t, st) => {
        body.position.y = 0.55 + Math.sin(t * 2.2 + def.hex) * 0.07;
        body.rotation.y += dt * (st.frozen ? 0 : 0.8);
      });
    }
    case 'ember_beast': {
      const lava = M(0x3a1208, 0xff5a1a, 1.2, 0.5);
      const body = add(new Mesh(new BoxGeometry(0.62, 0.46, 0.95), lava), 0, 0.62, 0);
      add(new Mesh(new SphereGeometry(0.26, 12, 10), M(0x2a0e06, 0xff7a1a, 0.9)), 0, 0.82, 0.55);
      for (const sx of [-1, 1]) {
        const h = new Mesh(new ConeGeometry(0.06, 0.3, 6), M(0x1c0a06, 0xff4010, 0.8));
        h.position.set(sx * 0.14, 1.05, 0.55);
        h.rotation.z = -sx * 0.5;
        g.add(h);
        add(new Mesh(new SphereGeometry(0.05, 8, 6), glow(0xffe0a0, 1)), sx * 0.1, 0.88, 0.78);
      }
      const legs: Mesh[] = [];
      for (const [x, z] of [[-0.22, 0.32], [0.22, 0.32], [-0.22, -0.32], [0.22, -0.32]]) {
        const l = new Mesh(new CylinderGeometry(0.07, 0.09, 0.45, 6), M(0x2a0e06, 0xff5a1a, 0.5));
        l.position.set(x, 0.22, z);
        g.add(l);
        legs.push(l);
      }
      add(glowSprite(0xff6a20, 1.3, 0.55), 0, 0.9, -0.5);
      return finish(g, mats, (dt, t, st) => {
        legs.forEach((l, i) => (l.rotation.x = st.frozen ? 0 : Math.sin(t * 6 + i * 1.6) * 0.5));
        body.position.y = 0.62 + (st.tele > 0 ? Math.sin(t * 30) * 0.015 : 0);
        g.rotation.x = st.tele > 0 ? -0.25 : 0;
      });
    }
    case 'frost_wraith': {
      const cloak = add(new Mesh(new ConeGeometry(0.42, 1.25, 8, 1, true), new MeshStandardMaterial({ color: 0x9ad8ff, emissive: 0x3a90d0, emissiveIntensity: 0.7, transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.2, side: DoubleSide })), 0, 0.85, 0);
      mats.push(cloak instanceof Mesh ? (cloak.material as MeshStandardMaterial) : M(0, 0, 0));
      const head = add(new Mesh(new OctahedronGeometry(0.2, 0), M(0xdff6ff, 0x7fd8ff, 1.2, 0.1)), 0, 1.6, 0);
      const crown: Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const c = new Mesh(new ConeGeometry(0.04, 0.26, 5), M(0xbfeaff, 0x7fd8ff, 1));
        const a = (i / 5) * Math.PI * 2;
        c.position.set(Math.cos(a) * 0.2, 1.85, Math.sin(a) * 0.2);
        c.rotation.z = -Math.cos(a) * 0.4;
        c.rotation.x = Math.sin(a) * 0.4;
        g.add(c);
        crown.push(c);
      }
      add(glowSprite(0x7fd8ff, 1.5, 0.45), 0, 1.4, 0);
      return finish(g, mats, (dt, t, st) => {
        g.position.y = 1.2 + Math.sin(t * 1.6) * 0.1;
        head.rotation.y += dt * (st.frozen ? 0 : 1.4);
        crown.forEach((c, i) => (c.scale.y = 1 + Math.sin(t * 3 + i) * 0.15));
      });
    }
    case 'storm_stalker': {
      const body = add(new Mesh(new CylinderGeometry(0.1, 0.17, 1.15, 6), M(0x2a3050, 0xa9b8ff, 0.6, 0.3, 0.5)), 0, 0.85, 0);
      add(new Mesh(new OctahedronGeometry(0.15, 0), M(0xe8ecff, 0xc3ceff, 1.4, 0.2)), 0, 1.55, 0);
      const arms: Mesh[] = [];
      for (const sx of [-1, 1]) {
        const a = new Mesh(new CylinderGeometry(0.03, 0.05, 0.7, 5), M(0x2a3050, 0xa9b8ff, 0.9));
        a.position.set(sx * 0.2, 0.95, 0.12);
        a.rotation.z = sx * 0.4;
        a.rotation.x = -0.5;
        g.add(a);
        arms.push(a);
      }
      add(glowSprite(0xa9b8ff, 1.4, 0.4), 0, 1.0, 0);
      return finish(g, mats, (_dt, t, st) => {
        body.position.x = st.frozen ? 0 : Math.sin(t * 40) * 0.01;
        arms.forEach((a, i) => (a.rotation.x = -0.5 + (st.tele > 0 ? -0.9 : Math.sin(t * 5 + i) * 0.2)));
      });
    }
    case 'root_colossus': {
      const bark = M(0x2c4a22, 0x1a3a14, 0.3, 0.9, 0);
      add(new Mesh(new BoxGeometry(0.9, 1.0, 0.65), bark), 0, 0.95, 0);
      add(new Mesh(new BoxGeometry(1.5, 0.35, 0.6), M(0x34552a, 0x1a3a14, 0.3, 0.9, 0)), 0, 1.55, 0);
      add(new Mesh(new SphereGeometry(0.22, 12, 10), M(0xb8ffb8, 0x58e07a, 2.2, 0.1)), 0, 1.0, 0.3);
      const arms: Mesh[] = [];
      for (const sx of [-1, 1]) {
        const a = new Mesh(new CylinderGeometry(0.16, 0.22, 1.1, 7), bark);
        a.position.set(sx * 0.85, 1.0, 0.1);
        g.add(a);
        arms.push(a);
        const leg = new Mesh(new CylinderGeometry(0.2, 0.26, 0.6, 7), bark);
        leg.position.set(sx * 0.3, 0.3, 0);
        g.add(leg);
      }
      add(new Mesh(new SphereGeometry(0.28, 10, 8), M(0x3a5c2e, 0x58e07a, 0.4, 0.8, 0)), 0, 1.95, 0.05);
      const plates: Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const p = new Mesh(new DodecahedronGeometry(0.28, 0), M(0x6a7a6a, 0x335533, 0.3, 0.5, 0.5));
        const a = (i / 5) * Math.PI * 2;
        p.position.set(Math.cos(a) * 0.7, 1.2 + Math.sin(i * 1.7) * 0.4, Math.sin(a) * 0.45 + 0.1);
        g.add(p);
        plates.push(p);
      }
      return finish(g, mats, (_dt, t, st) => {
        arms.forEach((a, i) => (a.rotation.x = st.tele > 0 ? -1.6 : Math.sin(t * 1.5 + i) * 0.15));
        plates.forEach((p) => (p.visible = st.armor));
      });
    }
    case 'shadow_reaper': {
      add(new Mesh(new ConeGeometry(0.4, 1.4, 7, 1, true), new MeshStandardMaterial({ color: 0x120a22, emissive: 0x3a1a6a, emissiveIntensity: 0.5, side: DoubleSide, roughness: 0.9 })), 0, 0.75, 0);
      mats.push(g.children[0] instanceof Mesh ? ((g.children[0] as Mesh).material as MeshStandardMaterial) : M(0, 0, 0));
      add(new Mesh(new SphereGeometry(0.2, 10, 8), M(0x0a0612, 0x2a1050, 0.5)), 0, 1.55, 0);
      for (const sx of [-1, 1]) add(new Mesh(new SphereGeometry(0.035, 6, 6), glow(0xff3050, 1)), sx * 0.07, 1.57, 0.17);
      const scythe = new Group();
      const shaft = new Mesh(new CylinderGeometry(0.02, 0.02, 1.5, 5), M(0x2a2036, 0x6a3aa8, 0.4));
      const blade = new Mesh(new TorusGeometry(0.3, 0.025, 6, 16, Math.PI * 0.9), M(0xc8b0ff, 0x9a5aff, 1.8));
      blade.position.set(0.3, 0.7, 0);
      scythe.add(shaft, blade);
      scythe.position.set(0.5, 0.95, 0.2);
      scythe.rotation.z = -0.2;
      g.add(scythe);
      return finish(g, mats, (_dt, t, st) => {
        scythe.rotation.x = st.tele > 0 ? -1 : Math.sin(t * 1.2) * 0.1;
        g.position.y = Math.sin(t * 1.4) * 0.06;
      });
    }
    case 'arcane_sentinel': {
      const core = add(new Mesh(new OctahedronGeometry(0.34, 0), M(0x7a2a9a, 0xd07cff, 1.4, 0.2, 0.3)), 0, 1.5, 0);
      const r1 = add(new Mesh(new TorusGeometry(0.55, 0.03, 8, 40), M(0xd8a8ff, 0xd07cff, 1.6))) as Mesh;
      const r2 = add(new Mesh(new TorusGeometry(0.7, 0.025, 8, 40), M(0xd8a8ff, 0xd07cff, 1.2))) as Mesh;
      r1.position.y = r2.position.y = 1.5;
      const shell = add(new Mesh(new SphereGeometry(0.62, 14, 10), new MeshStandardMaterial({ color: 0xb8a8d8, emissive: 0x6a4a9a, emissiveIntensity: 0.4, transparent: true, opacity: 0.35, roughness: 0.2, metalness: 0.7 })), 0, 1.5, 0) as Mesh;
      add(glowSprite(0xd07cff, 1.8, 0.45), 0, 1.5, 0);
      return finish(g, mats, (dt, t, st) => {
        core.rotation.y += dt * 1.2;
        r1.rotation.x += dt * 1.1;
        r2.rotation.y += dt * 0.9;
        shell.visible = st.armor;
        g.position.y = Math.sin(t * 1.3) * 0.08;
      });
    }
    default: {
      // training dummy: a wooden post with straw and a target
      add(new Mesh(new CylinderGeometry(0.12, 0.16, 1.5, 8), M(0x7a5a38, 0, 0, 0.9, 0)), 0, 0.75, 0);
      add(new Mesh(new BoxGeometry(0.9, 0.14, 0.14), M(0x6a4a2c, 0, 0, 0.9, 0)), 0, 1.15, 0);
      const ball = add(new Mesh(new SphereGeometry(0.3, 12, 10), M(0xc8a85a, 0x6a5020, 0.2, 0.9, 0)), 0, 1.65, 0) as Mesh;
      const ringM = new MeshBasicMaterial({ color: 0xff5a4a });
      for (let i = 0; i < 3; i++) {
        const r = new Mesh(new TorusGeometry(0.1 + i * 0.1, 0.018, 6, 24), i % 2 ? new MeshBasicMaterial({ color: 0xffffff }) : ringM);
        r.position.set(0, 1.0, 0.1);
        g.add(r);
      }
      return finish(g, mats, () => {
        ball.rotation.y += 0.002;
      });
    }
  }
  void accent;
}

/**
 * Boss presence layer wrapped around every boss model: orbiting aura motes, a burning ground ring,
 * rage glow as health drops, an anticipation squash before attacks, a phase-change shockwave and a rise-from-below entrance.
 * Pure visuals: no gameplay state is read except what the rig tick already receives.
 */
export function buildBoss(def: BossDef): BossRig {
  const base = buildBossRig(def);
  const g = base.group;
  const outer = new Group();
  outer.add(g);
  const col = new Color(def.hex);
  const N = 54;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    seed[i * 3] = Math.random() * Math.PI * 2;
    seed[i * 3 + 1] = 0.25 + Math.random() * 0.55;
    seed[i * 3 + 2] = Math.random();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const motes = new Points(geo, new PointsMaterial({ size: 0.07, map: glowTexture(), color: col.clone().lerp(new Color(0xffffff), 0.35), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
  motes.frustumCulled = false;
  const ringMat = new MeshBasicMaterial({ color: def.hex, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const ground = new Mesh(new RingGeometry(0.55, 0.62, 56), ringMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.02;
  const ground2 = new Mesh(new RingGeometry(0.8, 0.83, 56), ringMat.clone());
  ground2.rotation.x = -Math.PI / 2;
  ground2.position.y = 0.025;
  const shock = new Mesh(new RingGeometry(0.9, 1.0, 64), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  shock.rotation.x = -Math.PI / 2;
  shock.position.y = 0.05;
  outer.add(motes, ground, ground2, shock);
  let age = 0;
  let lastPhase = -1;
  let shockT = 0;
  let squash = 0;
  const tickBase = base.tick;
  const baseEm = base.mats.map((m) => m.emissiveIntensity);
  void baseEm;
  const rig: BossRig = {
    ...base,
    group: outer,
    tick: (dt, t, st) => {
      age += dt;
      tickBase(dt, t, st);
      const ease = 1 - Math.pow(1 - Math.min(1, age / 1.6), 3);
      const rage = (1 - Math.max(0, Math.min(1, st.hpFrac))) * 0.9;
      // a light whole-body anticipation squash on top of the rig's own wind-up pose
      const target = st.tele > 0 ? 1 : 0;
      squash += (target - squash) * Math.min(1, dt * (target ? 6 : 14));
      g.scale.set(1 + 0.03 * squash, 1 - 0.05 * squash, 1);
      if (st.phase !== undefined && st.phase !== lastPhase) {
        if (lastPhase >= 0) shockT = 1;
        lastPhase = st.phase;
      }
      shockT = Math.max(0, shockT - dt * 0.9);
      (shock.material as MeshBasicMaterial).opacity = shockT * 0.8;
      shock.scale.setScalar(1 + (1 - shockT) * 5);
      const dead = st.dead ? 1 - Math.min(1, (st.deathK ?? 0) * 2) : 1;
      const pulse = (0.35 + 0.15 * Math.sin(t * 2.4) + (st.tele > 0 ? 0.4 : 0)) * dead;
      (ground.material as MeshBasicMaterial).opacity = pulse * ease;
      (ground2.material as MeshBasicMaterial).opacity = pulse * 0.6 * ease;
      ground.rotation.z += dt * (0.5 + squash * 3);
      ground2.rotation.z -= dt * 0.4;
      ground.scale.setScalar(1 + squash * 0.25);
      const sp = 0.5 + rage * 1.2;
      for (let i = 0; i < N; i++) {
        const a = seed[i * 3] + t * sp * (0.6 + seed[i * 3 + 2]);
        const rise = (t * 0.18 * (0.5 + seed[i * 3 + 2]) + seed[i * 3 + 2]) % 1;
        const r = 0.25 + seed[i * 3 + 1] * 0.55;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = 0.05 + rise * 1.3;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
      (motes.material as PointsMaterial).opacity = 0.85 * ease * dead;
    },
  };
  return rig;
}
