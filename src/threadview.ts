/**
 * Aura Weaver: the THREAD board renderer. Draws one ThreadPlay (src/threadplay.ts) on the loom: energy nodes,
 * woven threads (liquid-light beams), the stretched thread being pulled, walls, celestial rings, constellation
 * sockets, echo ghosts, the era tint and hint highlights.
 *
 * Everything is pooled and built once in the constructor; bind() only re-targets the pool for a new puzzle and
 * sync() (called every frame) only writes transforms, colours and opacities: no per-frame allocation, no geometry
 * growth across puzzle loads. Board coordinates are the aura root's local x/y (metres).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import type { CanvasTexture } from '@iwsdk/core';
import { MASK_HEX, makeBeams, setBeam } from './aurafx.js';
import { reach, nodePos } from './threadlogic.js';
import type { NodeKind, Thread } from './threadlogic.js';
import type { PlayHint, ThreadPlay } from './threadplay.js';

const MAX_NODES = 14;
const MAX_THREADS = 24;
const MAX_WALLS = 6;
const MAX_RINGS = 4;
const MAX_SOCKETS = 3;
const MAX_ECHOES = 2;
const Z_THREAD = 0.022;
const Z_NODE = 0.034;
const EMBER = 6; // MASK_HEX index used for an over-stretched thread
const WHITE = 7;

type Beams = ReturnType<typeof makeBeams>;
interface NodeVis {
  g: Group;
  body: Mesh;
  bodyMat: MeshBasicMaterial;
  halo: Mesh;
  haloMat: MeshBasicMaterial;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
}

export interface ThreadViewOpts {
  reducedMotion: boolean;
  reducedFlash: boolean;
  highContrast: boolean;
  /** show the current hint highlight */
  hintOn: boolean;
}

export class ThreadView {
  readonly group = new Group();
  private play: ThreadPlay | null = null;
  private readonly geo: Record<NodeKind, BufferGeometry>;
  private readonly nodes: NodeVis[] = [];
  private readonly live: Beams;
  private readonly dim: Beams;
  private readonly drag: Beams;
  private readonly hintB: Beams;
  private readonly allBeams: Beams[];
  private readonly walls: Mesh[] = [];
  private readonly wallMats: MeshBasicMaterial[] = [];
  private readonly rings: Mesh[] = [];
  private readonly ringMats: MeshBasicMaterial[] = [];
  private readonly sockets: Mesh[] = [];
  private readonly socketMats: MeshBasicMaterial[] = [];
  private readonly ghosts: Mesh[] = [];
  private readonly eraTint: Mesh;
  private readonly eraMat: MeshBasicMaterial;
  private readonly p = { x: 0, y: 0 };
  private readonly q = { x: 0, y: 0 };
  private readonly col = new Color();
  private hint: PlayHint | null = null;
  // per-frame scratch used by the drag callback (bound once: forEach without allocation)
  private dragN = 0;
  private frameTime = 0;
  private readonly onDrag = (d: { kind: string; node: number; x: number; y: number }): void => this.drawDrag(d);

  constructor(dot: CanvasTexture) {
    this.geo = {
      source: new IcosahedronGeometry(0.024, 0),
      receiver: new OctahedronGeometry(0.028, 0),
      relay: new SphereGeometry(0.014, 14, 10),
      splitter: new ConeGeometry(0.018, 0.04, 3),
      rotator: new TorusGeometry(0.02, 0.006, 8, 20),
      locked: new BoxGeometry(0.026, 0.026, 0.026),
      memory: new DodecahedronGeometry(0.024, 0),
      key: new TetrahedronGeometry(0.024, 0),
      seed: new SphereGeometry(0.012, 12, 8),
      bloom: new IcosahedronGeometry(0.022, 1),
      star: new OctahedronGeometry(0.016, 0),
    };
    const haloG = new PlaneGeometry(0.11, 0.11);
    const ringG = new RingGeometry(0.036, 0.042, 32);
    for (let i = 0; i < MAX_NODES; i++) {
      const g = new Group();
      const bodyMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
      const body = new Mesh(this.geo.relay, bodyMat);
      const haloMat = new MeshBasicMaterial({ map: dot, color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      const halo = new Mesh(haloG, haloMat);
      halo.position.z = -0.006;
      const ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
      const ring = new Mesh(ringG, ringMat);
      g.add(halo, ring, body);
      g.visible = false;
      this.group.add(g);
      this.nodes.push({ g, body, bodyMat, halo, haloMat, ring, ringMat });
    }
    // threads: powered (full liquid light), dormant / other era (faint), the one being pulled, and hint guides
    this.dim = makeBeams(MAX_THREADS);
    this.dim.mat.uniforms.uAlpha.value = 0.28;
    this.live = makeBeams(MAX_THREADS);
    this.drag = makeBeams(4);
    this.hintB = makeBeams(2);
    this.hintB.mat.uniforms.uAlpha.value = 0;
    this.allBeams = [this.dim, this.live, this.drag, this.hintB];
    for (const b of this.allBeams) b.mesh.position.z = Z_THREAD;
    this.group.add(this.dim.mesh, this.hintB.mesh, this.live.mesh, this.drag.mesh);
    // walls (broken pillars)
    const wallG = new BoxGeometry(1, 1, 0.02);
    for (let i = 0; i < MAX_WALLS; i++) {
      const m = new MeshBasicMaterial({ color: 0x3a2d6a, transparent: true, opacity: 0.95 });
      const w = new Mesh(wallG, m);
      w.visible = false;
      this.walls.push(w);
      this.wallMats.push(m);
      this.group.add(w);
    }
    // celestial rings: unit ring scaled to the orbit radius
    const orbitG = new RingGeometry(0.985, 1.015, 96);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
      const r = new Mesh(orbitG, m);
      r.position.z = Z_THREAD - 0.004;
      r.visible = false;
      this.rings.push(r);
      this.ringMats.push(m);
      this.group.add(r);
    }
    // constellation sockets: where a star must come to rest
    const sockG = new RingGeometry(0.02, 0.026, 6);
    for (let i = 0; i < MAX_SOCKETS; i++) {
      const m = new MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false });
      const s = new Mesh(sockG, m);
      s.position.z = Z_NODE - 0.006;
      s.visible = false;
      this.sockets.push(s);
      this.socketMats.push(m);
      this.group.add(s);
    }
    // echo ghosts: the replayed hand of each memory echo
    const ghostG = new CircleGeometry(0.016, 20);
    for (let i = 0; i < MAX_ECHOES; i++) {
      const g = new Mesh(ghostG, new MeshBasicMaterial({ color: 0xc9b6ff, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
      g.position.z = Z_NODE + 0.01;
      g.visible = false;
      this.ghosts.push(g);
      this.group.add(g);
    }
    // era tint: the past is washed in amber, the present stays clear
    this.eraMat = new MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    this.eraTint = new Mesh(new PlaneGeometry(1.16, 0.74), this.eraMat);
    this.eraTint.position.z = 0.006;
    this.group.add(this.eraTint);
    this.group.visible = false;
  }

  /** Show a puzzle (or nothing). Only re-targets pooled objects. */
  bind(play: ThreadPlay | null): void {
    this.play = play;
    this.hint = null;
    this.group.visible = !!play;
    if (!play) return;
    const w = play.w;
    if (w.nodes.length > MAX_NODES) console.warn('ThreadView: puzzle has more nodes than the pool');
    this.nodes.forEach((v, i) => {
      const n = w.nodes[i];
      v.g.visible = !!n;
      if (!n) return;
      v.body.geometry = this.geo[n.kind];
      v.body.rotation.set(0, 0, 0);
    });
    this.walls.forEach((m, i) => {
      const wl = w.walls[i];
      m.visible = !!wl;
      if (!wl) return;
      const L = Math.hypot(wl.x2 - wl.x1, wl.y2 - wl.y1);
      m.position.set((wl.x1 + wl.x2) / 2, (wl.y1 + wl.y2) / 2, Z_NODE - 0.008);
      m.rotation.set(0, 0, Math.atan2(wl.y2 - wl.y1, wl.x2 - wl.x1));
      m.scale.set(Math.max(L, 0.01), 0.018, 1);
    });
    this.rings.forEach((m, i) => {
      const r = w.rings[i];
      m.visible = !!r;
      if (!r) return;
      m.position.set(r.cx, r.cy, Z_THREAD - 0.004);
      m.scale.set(r.r, r.r, 1);
    });
    this.sockets.forEach((m, i) => {
      const s = w.sockets[i];
      m.visible = !!s;
      if (s) m.position.set(s.x, s.y, Z_NODE - 0.006);
    });
    for (const g of this.ghosts) g.visible = false;
    this.live.mesh.count = 0;
    this.dim.mesh.count = 0;
    this.drag.mesh.count = 0;
    this.hintB.mesh.count = 0;
  }

  /** Cached hint to highlight (computed by the caller only when the board changes or HINT is pressed). */
  setHint(h: PlayHint | null): void {
    this.hint = h && h.kind !== 'none' ? h : null;
  }

  /** Per-frame update. Allocation-free. */
  sync(time: number, dt: number, o: ThreadViewOpts): void {
    const pl = this.play;
    if (!pl) return;
    const w = pl.w;
    const ev = pl.ev;
    const era = pl.s.era;
    const ei = era - 1;
    const other = era === 2 ? 0 : 1;
    const calm = o.reducedMotion ? 0 : 1;
    this.frameTime = time;
    for (const b of this.allBeams) {
      b.mat.uniforms.uTime.value = time;
      b.mat.uniforms.uCalm.value = calm;
    }
    // ---- nodes
    const live = pl.liveKey;
    for (let i = 0; i < w.nodes.length && i < MAX_NODES; i++) {
      const n = w.nodes[i];
      const v = this.nodes[i];
      const here = ev.exists[ei][i];
      const there = w.eras === 2 && ev.exists[other][i];
      v.g.visible = here || there;
      if (!v.g.visible) continue;
      nodePos(w, i, this.p);
      v.g.position.set(this.p.x, this.p.y, Z_NODE);
      const m = ev.mask[ei][i];
      const want = n.kind === 'receiver' ? n.mask : n.mask || (n.kind === 'bloom' && n.seed >= 0 ? ev.mask[0][n.seed] : 0);
      const lit = m !== 0;
      const hex = MASK_HEX[(lit ? m : want || WHITE) & 7];
      this.col.setHex(hex);
      // dormant nodes keep their own colour but dark; powered ones glow
      const k = lit ? 1 : o.highContrast ? 0.6 : 0.32;
      v.bodyMat.color.setRGB(this.col.r * k + (lit ? 0.15 : 0.05), this.col.g * k + (lit ? 0.15 : 0.05), this.col.b * k + (lit ? 0.15 : 0.08));
      v.bodyMat.opacity = here ? 1 : 0.18;
      const pulse = o.reducedFlash ? 0 : 0.12 * Math.sin(time * 3 + i);
      v.haloMat.color.setHex(hex);
      v.haloMat.opacity = here ? (lit ? 0.75 + pulse : n.kind === 'source' ? 0.12 : 0.05) : 0;
      // the ring tells what a node needs or is doing: receivers show their wanted colour, held keys glow white
      let ringOp = 0;
      let ringHex = hex;
      if (n.kind === 'receiver') {
        ringHex = MASK_HEX[n.mask & 7];
        ringOp = ev.receiverOk[i] ? 0.95 : 0.4;
      } else if (n.kind === 'key') {
        const held = pl.s.held.includes(i);
        ringHex = i === live ? 0xffffff : 0xc9b6ff;
        ringOp = held ? 0.9 : 0.2;
      } else if (n.kind === 'memory') {
        ringHex = 0xc9b6ff;
        ringOp = pl.s.latched[i] ? (pl.recording ? 0.6 + 0.4 * Math.sin(time * 10 * calm) : 0.7) : 0.15;
      } else if (n.kind === 'locked') {
        ringHex = n.lockBy >= 0 && ev.mask[ei][n.lockBy] !== 0 ? 0x8dffc2 : 0xff6a6a;
        ringOp = 0.5;
      } else if (n.kind === 'rotator') {
        ringHex = ev.motorOn[i] ? 0x8dffc2 : 0x5a6488;
        ringOp = 0.5;
      }
      if (this.hint && (this.hint.a === i || this.hint.b === i) && o.hintOn && this.hint.kind !== 'ring' && this.hint.kind !== 'era') {
        ringHex = 0xffe08a;
        ringOp = 0.55 + 0.4 * Math.sin(time * 5);
      }
      v.ringMat.color.setHex(ringHex);
      v.ringMat.opacity = here ? ringOp : 0;
      const s = (n.kind === 'receiver' && ev.receiverOk[i] ? 1.25 : 1) * (lit && !o.reducedMotion ? 1 + 0.05 * Math.sin(time * 4 + i) : 1);
      v.body.scale.setScalar(s);
      if (!o.reducedMotion) v.body.rotation.y += dt * (lit ? 1.2 : 0.3);
      if (n.kind === 'splitter') v.body.rotation.z = -Math.PI / 2;
    }
    // ---- threads: current era bright if energy flows, otherwise faint; the other era always faint
    this.nl = 0;
    this.nd = 0;
    for (let i = 0; i < w.fixed.length; i++) this.drawThread(w.fixed[i]);
    for (let i = 0; i < pl.s.threads.length; i++) this.drawThread(pl.s.threads[i]);
    this.commit(this.live, this.nl);
    this.commit(this.dim, this.nd);
    // ---- the thread being pulled: thinner and hotter the more it stretches
    this.dragN = 0;
    pl.drags.forEach(this.onDrag);
    this.commit(this.drag, this.dragN);
    // ---- rings (locked ones are dim red until their orbit engine is powered)
    for (let i = 0; i < w.rings.length && i < MAX_RINGS; i++) {
      const free = pl.ringFree(i);
      this.ringMats[i].color.setHex(free ? 0x9fe8ff : 0xff6a6a);
      const hinted = o.hintOn && this.hint && this.hint.kind === 'ring' && this.hint.ring === i;
      this.ringMats[i].opacity = hinted ? 0.5 + 0.4 * Math.sin(time * 5) : free ? 0.35 : 0.18;
    }
    for (let i = 0; i < w.sockets.length && i < MAX_SOCKETS; i++) {
      const ok = ev.aligned[i];
      this.socketMats[i].color.setHex(ok ? 0x8dffc2 : 0xffd36b);
      this.socketMats[i].opacity = ok ? 0.95 : 0.45 + (o.reducedFlash ? 0 : 0.15 * Math.sin(time * 2));
      this.sockets[i].rotation.z += dt * 0.4 * calm;
    }
    // ---- echo ghosts
    for (let i = 0; i < MAX_ECHOES; i++) {
      const pose = pl.echoPose[i];
      const g = this.ghosts[i];
      g.visible = !!pose && i < pl.echoes.length;
      if (!g.visible) continue;
      g.position.x = pose.x;
      g.position.y = pose.y;
      g.scale.setScalar(pose.down ? 1.3 : 0.8);
    }
    // ---- era tint and hint guide
    const eraWanted = o.hintOn && this.hint && this.hint.kind === 'era';
    this.eraMat.opacity = (era === 1 ? 0.07 : 0) + (eraWanted ? 0.05 + 0.04 * Math.sin(time * 4) : 0);
    let nh = 0;
    if (o.hintOn && this.hint && (this.hint.kind === 'thread' || this.hint.kind === 'cut') && this.hint.a >= 0 && this.hint.b >= 0) {
      nodePos(w, this.hint.a, this.p);
      nodePos(w, this.hint.b, this.q);
      setBeam(this.hintB, nh++, this.p.x, this.p.y, this.q.x, this.q.y, 0.004, 0.02, this.hint.kind === 'cut' ? EMBER : 4);
    }
    this.hintB.mat.uniforms.uAlpha.value = nh ? 0.35 + 0.25 * Math.sin(time * 4) : 0;
    this.commit(this.hintB, nh);
  }

  private nl = 0;
  private nd = 0;
  private drawThread(t: Thread): void {
    const pl = this.play as ThreadPlay;
    const w = pl.w;
    const ev = pl.ev;
    const era = pl.s.era;
    const ei = era - 1;
    nodePos(w, t.a, this.p);
    nodePos(w, t.b, this.q);
    const flows = t.era === era && ev.live[ei][t.a] && ev.mask[ei][t.a] !== 0;
    if (flows && this.nl < MAX_THREADS) setBeam(this.live, this.nl++, this.p.x, this.p.y, this.q.x, this.q.y, 0, t.fixed ? 0.026 : 0.034, ev.mask[ei][t.a]);
    else if (this.nd < MAX_THREADS) setBeam(this.dim, this.nd++, this.p.x, this.p.y, this.q.x, this.q.y, 0, t.era === era ? 0.03 : 0.016, t.era === era ? WHITE : 4);
  }

  private drawDrag(d: { kind: string; node: number; x: number; y: number }): void {
    const pl = this.play;
    if (!pl || d.kind !== 'thread' || d.node < 0 || this.dragN >= 4) return;
    nodePos(pl.w, d.node, this.p);
    // snap the free end onto a node under the pointer so the player sees where it will land
    const b = pl.nearestNode(d.x, d.y, pl.pickR, d.node);
    let x = d.x;
    let y = d.y;
    if (b >= 0) {
      nodePos(pl.w, b, this.q);
      x = this.q.x;
      y = this.q.y;
    }
    const L = Math.hypot(x - this.p.x, y - this.p.y);
    const tension = L / reach(pl.w, pl.s);
    const m = pl.ev.mask[pl.s.era - 1][d.node];
    const width = 0.032 * (1 - 0.55 * Math.min(1, tension)) + 0.004 * Math.sin(this.frameTime * 30) * (tension > 0.85 ? 1 : 0);
    setBeam(this.drag, this.dragN++, this.p.x, this.p.y, x, y, 0.006, Math.max(0.008, width), tension > 1 ? EMBER : m || WHITE);
  }

  private commit(b: Beams, n: number): void {
    b.mesh.count = n;
    if (!n) return;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.col.needsUpdate = true;
    b.len.needsUpdate = true;
  }
}
