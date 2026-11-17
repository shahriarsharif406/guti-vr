import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Entity,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  RingGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { emitBurst } from './fx.js';
import { readPinchPoint } from './hand.js';
import { K_COLORS, kiteCfg, saveKiteCfg } from './kitecfg.js';
import { modeState, setMode } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { CraftOpt } from './ui-components.js';

// ---- Workboard: a wooden board standing on the table, all work happens on its face.
const BX = 0;
const BY = 1.08;
const BZ = -0.68;
const FRAME_BOTTOM = 0.93;
const FRAME_TOP = 1.28;
const CROSS_Y = 1.2;
const SPINE_LEN = FRAME_TOP - FRAME_BOTTOM;
const CROSS_LEN = 0.3;
const PINCH_START = 0.92;
const PINCH_HOLD = 0.6;
const GRAB_R = 0.11;
const SNAP_R = 0.12;
const Z_PIECE = BZ + 0.035;

type HandName = 'left' | 'right';
type Kind = 'cross' | 'paper' | 'tail' | 'spool';

interface Piece {
  g: Group;
  kind: Kind;
  idx: number;
  home: Vector3;
  held: boolean;
  returning: boolean;
  step: number;
}

interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  held: Piece | null;
}

const STEPS = [
  'Pick up the cross stick. Lay it over the long stick',
  'Choose a paper colour. Put it on the frame',
  'Choose a tail. Hang it at the bottom',
  'Take the string spool. Tie it to the middle',
];
const PAPER_COLORS = [0, 1, 2, 5]; // indices into K_COLORS

export class KiteCraftSystem extends createSystem({
  opts: { required: [CraftOpt, Pressed] },
}) {
  private root: { visible: boolean }[] = [];
  private hud!: TextPanel;
  private btns: TextPanel[] = [];
  private pieces: Piece[] = [];
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'right', pos: new Vector3(), down: false, was: false, held: null },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, held: null },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private step = 0; // 0..3 = current task, 4 = finished
  private lastMode = '';
  private fontWasReady = false;
  private elapsed = 0;
  private hudDirty = true;
  private optCooldown = 0;
  private msg = '';
  private msgT = 0;
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private ndc = new Vector3();
  private cam = new Vector3();
  // kite parts built so far
  private crossFixed!: Mesh;
  private paperMesh!: Mesh;
  private lash!: Group;
  private tailGroup = new Group();
  private stringLine!: Line;
  private spine!: Mesh;
  private ring!: Mesh;
  private ringTarget = new Vector3();

  init(): void {
    const add = (o: Mesh | Group | Line): void => {
      this.world.createTransformEntity(o);
      this.root.push(o);
    };
    const wood = new MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.85 });
    const bamboo = new MeshStandardMaterial({ color: 0xd8c57a, roughness: 0.6 });
    const dark = new MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.8 });

    // table + board
    const top = new Mesh(new CylinderGeometry(0.46, 0.46, 0.04, 56), wood);
    top.position.set(0, 0.72, -0.55);
    add(top);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 0.72, 8), wood);
      leg.position.set(Math.cos(a) * 0.3, 0.34, -0.55 + Math.sin(a) * 0.3);
      add(leg);
    }
    const board = new Mesh(new BoxGeometry(0.86, 0.5, 0.02), new MeshStandardMaterial({ color: 0xe6d3a8, roughness: 0.95 }));
    board.position.set(BX, BY, BZ);
    add(board);
    const frameEdge = new Mesh(new BoxGeometry(0.9, 0.54, 0.016), wood);
    frameEdge.position.set(BX, BY, BZ - 0.012);
    add(frameEdge);
    for (const sx of [-0.36, 0.36]) {
      const post = new Mesh(new CylinderGeometry(0.014, 0.014, 0.4, 8), dark);
      post.position.set(sx, 0.96, BZ - 0.02);
      add(post);
    }

    // long stick (fixed from the start)
    this.spine = new Mesh(new CylinderGeometry(0.006, 0.006, SPINE_LEN, 8), bamboo);
    this.spine.position.set(BX, (FRAME_TOP + FRAME_BOTTOM) / 2, BZ + 0.02);
    add(this.spine);

    // cross stick fixed on the frame (shown after step 1)
    this.crossFixed = new Mesh(new CylinderGeometry(0.006, 0.006, CROSS_LEN, 8), bamboo);
    this.crossFixed.rotation.z = Math.PI / 2;
    this.crossFixed.position.set(BX, CROSS_Y, BZ + 0.026);
    this.crossFixed.visible = false;
    add(this.crossFixed);
    this.lash = new Group();
    const lashMat = new MeshStandardMaterial({ color: 0x6b3a1e, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const w = new Mesh(new CylinderGeometry(0.0095, 0.0095, 0.004, 10), lashMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(0, 0, 0.002 + (i % 2) * 0.001);
      w.rotation.z = (i * Math.PI) / 4;
      this.lash.add(w);
    }
    this.lash.position.set(BX, CROSS_Y, BZ + 0.034);
    this.lash.visible = false;
    add(this.lash);

    // paper: a diamond behind the sticks
    const geo = new BufferGeometry();
    const t = FRAME_TOP;
    const b = FRAME_BOTTOM;
    const hw = CROSS_LEN / 2;
    geo.setAttribute(
      'position',
      new Float32BufferAttribute([0, t, 0, -hw, CROSS_Y, 0, hw, CROSS_Y, 0, -hw, CROSS_Y, 0, 0, b, 0, hw, CROSS_Y, 0], 3),
    );
    geo.computeVertexNormals();
    this.paperMesh = new Mesh(geo, new MeshStandardMaterial({ color: K_COLORS[kiteCfg.color], roughness: 0.7, side: 2 }));
    this.paperMesh.position.set(BX, 0, BZ + 0.014);
    this.paperMesh.visible = false;
    add(this.paperMesh);

    // tail (built when chosen)
    this.tailGroup.position.set(BX, FRAME_BOTTOM, BZ + 0.03);
    add(this.tailGroup);

    // string line from the bridle point to a spool at bottom-right
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute([BX, CROSS_Y, BZ + 0.04, 0.2, 0.86, BZ + 0.04], 3));
    this.stringLine = new Line(sg, new LineBasicMaterial({ color: 0xf5efe0 }));
    this.stringLine.visible = false;
    add(this.stringLine);

    // pulsing drop target
    this.ring = new Mesh(new RingGeometry(0.045, 0.055, 32), new MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9 }));
    add(this.ring);

    // ---- loose pieces
    const mkCross = (): Group => {
      const g = new Group();
      const m = new Mesh(new CylinderGeometry(0.007, 0.007, CROSS_LEN, 8), bamboo);
      m.rotation.z = Math.PI / 2;
      g.add(m);
      return g;
    };
    const cross = this.addPiece('cross', 0, mkCross(), new Vector3(-0.28, 0.96, Z_PIECE), 0);
    void cross;
    PAPER_COLORS.forEach((ci, i) => {
      const g = new Group();
      const sheet = new Mesh(new BoxGeometry(0.1, 0.1, 0.006), new MeshStandardMaterial({ color: K_COLORS[ci], roughness: 0.7 }));
      sheet.rotation.z = Math.PI / 4;
      g.add(sheet);
      this.addPiece('paper', ci, g, new Vector3(-0.3 + i * 0.2, 0.86, Z_PIECE), 1);
    });
    [1, 2].forEach((tl, i) => {
      const g = new Group();
      const len = tl === 1 ? 0.12 : 0.22;
      const rib = new Mesh(new BoxGeometry(0.018, len, 0.004), new MeshStandardMaterial({ color: 0xff6a4d, roughness: 0.8 }));
      rib.position.y = -len / 2;
      g.add(rib);
      this.addPiece('tail', tl, g, new Vector3(-0.3 + i * 0.6, 1.08, Z_PIECE), 2);
    });
    const spool = new Group();
    const sp = new Mesh(new CylinderGeometry(0.03, 0.03, 0.04, 16), new MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.6 }));
    sp.rotation.x = Math.PI / 2;
    spool.add(sp);
    for (const dz of [-0.022, 0.022]) {
      const flange = new Mesh(new CylinderGeometry(0.04, 0.04, 0.006, 16), wood);
      flange.rotation.x = Math.PI / 2;
      flange.position.z = dz;
      spool.add(flange);
    }
    this.addPiece('spool', 0, spool, new Vector3(0.3, 0.9, Z_PIECE), 3);

    // HUD + buttons
    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, 1.42, -0.7);
    this.hud.mesh.rotation.x = -0.25;
    add(this.hud.mesh);
    for (let i = 0; i < 2; i++) {
      const panel = new TextPanel(0.2, 0.07, 512);
      panel.mesh.position.set(-0.52, 0.98 - i * 0.085, -0.42);
      panel.mesh.rotation.y = 0.6;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(CraftOpt, { id: i });
      this.btns.push(panel);
      this.root.push(panel.mesh);
    }
    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'kitecraft' || this.optCooldown > 0) return;
        this.optCooldown = 0.4;
        sfx.select();
        const id = entity.getValue(CraftOpt, 'id') as number;
        if (id === 0) this.finish();
        else this.restart();
      }),
    );
    for (const o of this.root) o.visible = false;
    this.drawBtns();

    (window as unknown as { __craft?: () => unknown }).__craft = () => ({
      mode: modeState.mode,
      step: this.step,
      color: kiteCfg.color,
      tail: kiteCfg.tail,
    });
    // test hook: complete the next step as if the piece had been dropped on target
    (window as unknown as { __craftDo?: (kind: string, idx: number) => void }).__craftDo = (kind, idx) => {
      this.commit(kind as Kind, idx);
    };

    const down = (e: PointerEvent) => {
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const move = (e: PointerEvent) => {
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

  private addPiece(kind: Kind, idx: number, g: Group, home: Vector3, step: number): Piece {
    g.position.copy(home);
    this.world.createTransformEntity(g);
    this.root.push(g);
    const p: Piece = { g, kind, idx, home, held: false, returning: false, step };
    this.pieces.push(p);
    return p;
  }

  // ------------------------------------------------------------------ flow
  private restart(): void {
    this.step = 0;
    this.crossFixed.visible = false;
    this.lash.visible = false;
    this.paperMesh.visible = false;
    this.stringLine.visible = false;
    while (this.tailGroup.children.length) this.tailGroup.remove(this.tailGroup.children[0]);
    for (const p of this.pieces) {
      p.g.position.copy(p.home);
      p.held = false;
      p.returning = false;
    }
    this.updateStepState();
    this.say(STEPS[0], 5);
    this.drawBtns();
  }

  private finish(): void {
    saveKiteCfg();
    setMode('kite');
  }

  private updateStepState(): void {
    for (const p of this.pieces) p.g.visible = p.step === this.step;
    if (this.step === 0) this.ringTarget.set(BX, CROSS_Y, BZ + 0.04);
    else if (this.step === 1) this.ringTarget.set(BX, (FRAME_TOP + FRAME_BOTTOM) / 2 + 0.02, BZ + 0.04);
    else if (this.step === 2) this.ringTarget.set(BX, FRAME_BOTTOM - 0.02, BZ + 0.04);
    else if (this.step === 3) this.ringTarget.set(BX, CROSS_Y, BZ + 0.04);
    this.ring.visible = this.step < 4;
    this.ring.position.copy(this.ringTarget);
    this.hudDirty = true;
  }

  private commit(kind: Kind, idx: number): void {
    if (kind === 'cross') {
      this.crossFixed.visible = true;
      this.lash.visible = true;
      sfx.wood(0.6);
      emitBurst(BX, CROSS_Y, BZ + 0.05, 1, 0.9, 0.5, 20, 0.2);
      this.step = 1;
      this.say('Tied! Now the paper', 3);
    } else if (kind === 'paper') {
      kiteCfg.color = idx;
      (this.paperMesh.material as MeshStandardMaterial).color.setHex(K_COLORS[idx]);
      this.paperMesh.visible = true;
      sfx.select();
      emitBurst(BX, CROSS_Y, BZ + 0.05, 1, 0.9, 0.7, 24, 0.25);
      this.step = 2;
      this.say('Lovely colour. Now a tail', 3);
    } else if (kind === 'tail') {
      kiteCfg.tail = idx;
      const len = idx === 1 ? 0.12 : 0.22;
      const mat = new MeshStandardMaterial({ color: 0xff6a4d, roughness: 0.8 });
      const bows = idx === 1 ? 3 : 5;
      const line = new Mesh(new BoxGeometry(0.003, len, 0.003), new MeshStandardMaterial({ color: 0xf5efe0 }));
      line.position.y = -len / 2;
      this.tailGroup.add(line);
      for (let i = 0; i < bows; i++) {
        const bow = new Mesh(new BoxGeometry(0.04, 0.016, 0.003), mat);
        bow.position.y = -((i + 0.6) / bows) * len;
        bow.rotation.z = i % 2 ? 0.5 : -0.5;
        this.tailGroup.add(bow);
      }
      sfx.whoosh();
      this.step = 3;
      this.say('Almost there. Tie the string', 3);
    } else {
      this.stringLine.visible = true;
      sfx.win();
      emitBurst(BX, CROSS_Y, BZ + 0.08, 1, 0.85, 0.4, 60, 0.5);
      this.step = 4;
      this.say('Your kite is ready! Press Fly', 6);
    }
    this.updateStepState();
    this.drawBtns();
  }

  private say(text: string, seconds: number): void {
    this.msg = text;
    this.msgT = seconds;
    this.hudDirty = true;
  }

  private drawBtns(): void {
    const labels = [[this.step >= 4 ? 'READY' : 'SKIP', 'Fly the kite'], ['START', 'Over again']];
    for (let i = 0; i < 2; i++) {
      const p = this.btns[i];
      p.card('rgba(40,24,12,0.9)', i === 0 && this.step >= 4 ? '#8dff9d' : '#ffb56b');
      p.text(labels[i][0], p.h * 0.3, 22, '#cdb99a');
      p.text(labels[i][1], p.h * 0.7, 32, '#ffe9c4');
      p.commit();
    }
  }

  private drawHud(): void {
    const h = this.hud;
    h.card();
    h.text('Kite workshop  •  ঘুড়ির কারখানা', 56, 32);
    const dots = [0, 1, 2, 3].map((i) => (i < this.step ? '●' : i === this.step ? '◉' : '○')).join('  ');
    h.text(dots, 100, 30, '#ffd9a0');
    if (this.msgT > 0) h.text(this.msg, 150, 34, '#8dff9d');
    else h.text(this.step >= 4 ? 'Press Fly to take it up' : STEPS[this.step], 150, 28, '#ffe9c4');
    h.text(this.step >= 4 ? 'Or press Over again to make another' : 'Pinch a piece, move it to the glowing ring, let go', 195, 22, '#cdb99a');
    h.commit();
  }

  // ------------------------------------------------------------------ input
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
    const t = (BZ - this.cam.z) / this.ndc.z;
    if (t <= 0) return false;
    out.copy(this.cam).addScaledVector(this.ndc, t);
    return true;
  }

  private dist2(a: Vector3, b: Vector3): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
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
    if (pt.down && !pt.was) {
      // pick up the nearest active piece
      let best: Piece | null = null;
      let bd = GRAB_R;
      for (const pc of this.pieces) {
        if (pc.step !== this.step || pc.held) continue;
        const d = this.dist2(pc.g.position, pt.pos);
        if (d < bd) {
          bd = d;
          best = pc;
        }
      }
      if (best) {
        best.held = true;
        best.returning = false;
        pt.held = best;
        sfx.grab();
      }
    }
    if (pt.down && pt.held) {
      pt.held.g.position.set(pt.pos.x, pt.pos.y, Z_PIECE);
    }
    if (!pt.down && pt.was && pt.held) {
      const pc = pt.held;
      pt.held = null;
      pc.held = false;
      if (this.dist2(pc.g.position, this.ringTarget) < SNAP_R) {
        pc.g.visible = false;
        this.commit(pc.kind, pc.idx);
      } else {
        pc.returning = true;
      }
    }
    pt.was = pt.down;
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'kitecraft';
      for (const o of this.root) o.visible = on;
      if (on) this.restart();
    }
    if (modeState.mode !== 'kitecraft') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    for (const pt of this.pointers) this.updatePointer(pt);
    // pieces that were not dropped on the target glide home
    for (const p of this.pieces) {
      if (p.returning) {
        p.g.position.lerp(p.home, Math.min(1, dt * 10));
        if (p.g.position.distanceTo(p.home) < 0.003) p.returning = false;
      } else if (!p.held && p.step === this.step) {
        // gentle hover so pieces read as grabbable
        p.g.position.y = p.home.y + Math.sin(this.elapsed * 2 + p.idx) * 0.004;
      }
    }
    // pulsing target ring
    const s = 1 + Math.sin(this.elapsed * 4) * 0.12;
    this.ring.scale.set(s, s, 1);
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.hudDirty = true;
    }
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
    }
  }
}
