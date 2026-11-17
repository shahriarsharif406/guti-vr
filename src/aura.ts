import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Entity,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Pressed,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { getMasterVolume, setMasterVolume, sfx, musicState } from './audio.js';
import {
  CHAPTER_NAMES,
  CYAN,
  GOLD,
  MAGENTA,
  MIRROR_STEPS,
  PRISM_STEPS,
  angleOf,
  makeLevels,
  solve,
  stepsOf,
  trace,
} from './auralogic.js';
import type { Elem, Level, Trace } from './auralogic.js';
import { MASK_HEX, MASK_LETTER, MASK_NAME, RippleFx, floatingStone, makeBeams, makeCrystalMaterial, makeFractal, makeLotus, makeNebula, runeRingTexture, setBeam, softDotTexture } from './aurafx.js';
import type { Lotus } from './aurafx.js';
import { defaultSave, loadSave, writeSave } from './aurasave.js';
import type { AuraSave } from './aurasave.js';
import { celebrate } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { quality } from './quality.js';
import { AuraOpt } from './ui-components.js';

// ---- Aura Weaver: compose light. Turn mirrors and prisms (pinch and swing, or tap) to wake the monoliths.
const BZ = -0.85;
const BY = 0.92;
const BW = 1.16;
const BH = 0.74;
const PICK_R = 0.085;
const PINCH_START = 0.85;
const PINCH_HOLD = 0.5;
const MAX_SEG = 96;
const HOLD_T = 0.8; // seconds of exact light needed to wake a gate
const SERIF = 'Georgia, "Times New Roman", serif';

type HandName = 'left' | 'right';
interface Pointer {
  src: HandName | 'mouse';
  pos: Vector3;
  down: boolean;
  was: boolean;
  grab: number; // element index or -1
  t0: number;
  sx: number;
  sy: number;
  moved: boolean;
}
interface ElemVis {
  g: Group;
  ring: Mesh;
  mark: Mesh | null;
  visAng: number;
  body: Mesh;
}
interface GateVis {
  g: Group;
  crystal: Mesh;
  mat: ReturnType<typeof makeCrystalMaterial>;
  runes: Mesh;
  disc: Mesh;
  discMat: MeshBasicMaterial;
  label: TextPanel;
  fill: number;
  awake: boolean;
  impure: boolean;
  lastGot: number;
}

/** Tiny typed event bus: puzzle logic emits, visuals / audio / save listen. */
type AuraEvent = { t: 'awaken'; i: number } | { t: 'complete' } | { t: 'finale' } | { t: 'rotate'; step: number } | { t: 'impure'; i: number };
class Bus {
  private hs: ((e: AuraEvent) => void)[] = [];
  on(h: (e: AuraEvent) => void): void {
    this.hs.push(h);
  }
  emit(e: AuraEvent): void {
    for (const h of this.hs) h(e);
  }
}

const shared = (() => {
  let s: {
    mirrorG: BoxGeometry;
    mirrorM: MeshPhysicalMaterial;
    splitM: MeshPhysicalMaterial;
    prismG: CylinderGeometry;
    prismM: MeshPhysicalMaterial;
    ringG: TorusGeometry;
    ringM: MeshBasicMaterial;
    wallG: BoxGeometry;
    wallM: MeshStandardMaterial;
    coneG: ConeGeometry;
    orbG: SphereGeometry;
    haloG: PlaneGeometry;
    dot: ReturnType<typeof softDotTexture>;
  } | null = null;
  return (): NonNullable<typeof s> => {
    s ??= {
      mirrorG: new BoxGeometry(1, 0.007, 0.014),
      mirrorM: new MeshPhysicalMaterial({ color: 0xdfe8f2, metalness: 1, roughness: 0.08, emissive: 0x16283a, emissiveIntensity: 0.6, clearcoat: 1 }),
      splitM: new MeshPhysicalMaterial({ color: 0x7fd8ff, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.7, emissive: 0x0a3a66, emissiveIntensity: 0.8, clearcoat: 1 }),
      prismG: new CylinderGeometry(0.04, 0.04, 0.024, 3),
      prismM: new MeshPhysicalMaterial({ color: 0xcdeaff, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.62, iridescence: 1, iridescenceIOR: 1.8, emissive: 0x1a2f66, emissiveIntensity: 0.7, clearcoat: 1 }),
      ringG: new TorusGeometry(0.056, 0.0022, 8, 48),
      ringM: new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false }),
      wallG: new BoxGeometry(0.018, 1, 0.022),
      wallM: new MeshStandardMaterial({ color: 0x15131f, roughness: 0.55, metalness: 0.5, emissive: 0x2a1a55, emissiveIntensity: 0.5 }),
      coneG: new ConeGeometry(0.008, 0.02, 10),
      orbG: new SphereGeometry(0.016, 18, 12),
      haloG: new PlaneGeometry(0.12, 0.12),
      dot: softDotTexture(),
    };
    return s;
  };
})();

export class AuraSystem extends createSystem({
  opts: { required: [AuraOpt, Pressed] },
}) {
  private bus = new Bus();
  private levels: Level[] = makeLevels();
  private save: AuraSave = defaultSave(7);
  private level = 0;
  private lv!: Level;
  private startAng: number[] = [];
  private sol: number[] | null = null;
  private tr!: Trace;
  private dirty = true;
  private root = new Group();
  private lastMode = '';
  private optCooldown = 0;
  private time = 0;
  private paused = false;
  private photo = false;
  private comp = 0;
  private shotPending = false;
  private fontWasReady = false;
  private hudDirty = true;
  private msg = '';
  private msgT = 0;
  private idle = 0;
  private moves = 0;
  private completeT = -1;
  private finaleT = -1;
  private sel = -1;
  private hover = -1;
  private hoverSeen = false;
  private pointers: Pointer[] = [
    { src: 'left', pos: new Vector3(), down: false, was: false, grab: -1, t0: 0, sx: 0, sy: 0, moved: false },
    { src: 'right', pos: new Vector3(), down: false, was: false, grab: -1, t0: 0, sx: 0, sy: 0, moved: false },
    { src: 'mouse', pos: new Vector3(), down: false, was: false, grab: -1, t0: 0, sx: 0, sy: 0, moved: false },
  ];
  private pinching: Record<HandName, boolean> = { left: false, right: false };
  private mouseDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private mouseSeen = false;
  private ndc = new Vector3();
  private cam = new Vector3();
  private hoverPos = new Vector3();

  private nebula!: ReturnType<typeof makeNebula>;
  private beams!: ReturnType<typeof makeBeams>;
  private ghost!: ReturnType<typeof makeBeams>;
  private ghostT = 0;
  private ghostN = 0;
  private ripple = new RippleFx(6);
  private elemGroup = new Group();
  private evs: ElemVis[] = [];
  private gates: GateVis[] = [];
  private srcGroup = new Group();
  private lotus: Lotus[] = [];
  private ferns: ReturnType<typeof makeFractal>[] = [];
  private crystals!: InstancedMesh;
  private crystalGlow!: InstancedBufferAttribute;
  private crystalVal: number[] = [];
  private stones: { m: Mesh; ph: number; x: number; y: number }[] = [];
  private wisps!: Points;
  private wispPos = new Float32Array(10 * 3);
  private restore = 0;
  private restoreShown = 0;
  private pulseAge = -1;
  private hud!: TextPanel;
  private compass!: TextPanel;
  private btns: TextPanel[] = [];
  private setBtns: TextPanel[] = [];
  private card!: TextPanel;
  private beamLv = [0, 0, 0];
  private bend = 0;
  private activeBeamMs = 0;
  private flash = 0;
  private fired = false;

  // ================================================================ init
  init(): void {
    this.save = loadSave(this.levels.length);
    setMasterVolume(this.save.settings.volume);
    this.root.position.set(0, BY, BZ);
    this.world.createTransformEntity(this.root);

    // cosmic void behind the board + frame
    this.nebula = makeNebula(BW, BH);
    this.nebula.mesh.position.z = -0.004;
    this.root.add(this.nebula.mesh);
    const frameM = new MeshStandardMaterial({ color: 0x0c0b16, roughness: 0.4, metalness: 0.8, emissive: 0x1a1550, emissiveIntensity: 0.5 });
    for (const [w, h, x, y] of [
      [BW + 0.05, 0.025, 0, BH / 2 + 0.0125],
      [BW + 0.05, 0.025, 0, -BH / 2 - 0.0125],
      [0.025, BH, -BW / 2 - 0.0125, 0],
      [0.025, BH, BW / 2 + 0.0125, 0],
    ] as [number, number, number, number][]) {
      const f = new Mesh(new BoxGeometry(w, h, 0.05), frameM);
      f.position.set(x, y, 0.012);
      this.root.add(f);
    }
    // light: beams (liquid light), ghost traces (light memory)
    this.beams = makeBeams(MAX_SEG);
    this.beams.mesh.position.z = 0.02;
    this.ghost = makeBeams(MAX_SEG);
    this.ghost.mesh.position.z = 0.012;
    this.ghost.mat.uniforms.uAlpha.value = 0;
    this.root.add(this.ghost.mesh, this.beams.mesh, this.srcGroup, this.elemGroup, this.ripple.group);
    this.ripple.group.position.z = 0.035;

    // gates (monoliths): pool of 3
    for (let i = 0; i < 3; i++) this.gates.push(this.makeGate());
    this.buildSanctuary();
    this.buildWisps();

    // HUD, compass and buttons
    this.hud = new TextPanel(0.56, 0.2);
    this.hud.mesh.position.set(0, BY + BH / 2 + 0.11, BZ + 0.03);
    this.hud.mesh.rotation.x = -0.15;
    this.world.createTransformEntity(this.hud.mesh);
    this.compass = new TextPanel(0.2, 0.2, 384);
    this.compass.mesh.position.set(-BW / 2 - 0.2, BY + 0.2, BZ + 0.06);
    this.compass.mesh.rotation.y = 0.35;
    this.world.createTransformEntity(this.compass.mesh);
    this.card = new TextPanel(0.52, 0.34, 768);
    this.card.mesh.position.set(0, BY + 0.02, BZ + 0.22);
    this.world.createTransformEntity(this.card.mesh);
    const mkBtn = (id: number, w: number, h: number, x: number, y: number, z: number, tilt: number, list: TextPanel[]): void => {
      const panel = new TextPanel(w, h, 512);
      panel.mesh.position.set(x, y, z);
      panel.mesh.rotation.x = tilt;
      const entity = this.world.createTransformEntity(panel.mesh);
      entity.addComponent(RayInteractable);
      entity.addComponent(AuraOpt, { id });
      list.push(panel);
    };
    for (let i = 0; i < 4; i++) mkBtn(i, 0.2, 0.07, -0.33 + i * 0.22, 0.64, -0.5, -0.9, this.btns);
    for (let i = 0; i < 8; i++) mkBtn(4 + i, 0.2, 0.055, i % 2 ? 0.115 : -0.115, 1.2 - Math.floor(i / 2) * 0.062, -0.5, -0.2, this.setBtns);

    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'aura' || this.optCooldown > 0) return;
        this.optCooldown = 0.3;
        sfx.select();
        this.press(entity.getValue(AuraOpt, 'id') as number);
      }),
    );

    // event wiring: gameplay events drive visuals, audio, save and world state
    this.bus.on((e) => {
      if (e.t === 'rotate') {
        sfx.auraTick(e.step);
        this.buzz(12);
        this.idle = 0;
      } else if (e.t === 'awaken') {
        const g = this.gates[e.i];
        const t = this.lv.targets[e.i];
        g.awake = true;
        this.ripple.fire(t.x, t.y, 0, 0.5, MASK_HEX[t.mask & 7]);
        celebrate(t.x, BY + t.y, BZ + 0.08, 1);
        sfx.auraAwaken(e.i, this.chapterIdx());
        this.buzz(40);
        this.save.stats.connections++;
        this.save.stats.hues[t.mask & 7]++;
        this.flash = 1;
      } else if (e.t === 'impure') {
        sfx.auraImpure();
        const t = this.lv.targets[e.i];
        this.msg = 'The ' + MASK_NAME[t.mask & 7] + ' gate needs exactly ' + MASK_NAME[t.mask & 7] + ' light';
        this.msgT = 4;
        this.hudDirty = true;
      } else if (e.t === 'complete') {
        this.save.solved[this.level] = true;
        this.save.unlocked = Math.min(this.levels.length - 1, Math.max(this.save.unlocked, this.level + 1));
        const best = this.save.best[this.level];
        if (best === 0 || this.moves < best) this.save.best[this.level] = this.moves;
        this.save.stats.moves += this.moves;
        this.lotus[this.level].target = 1;
        this.ferns[this.level].lines.visible = true;
        this.pulseAge = 0;
        sfx.auraPulse();
        this.buzz([60, 40, 120]);
        this.restore = this.save.solved.filter(Boolean).length / this.levels.length;
        this.msg = 'Sanctuary ' + Math.round(this.restore * 100) + '% restored';
        this.msgT = 6;
        this.persist();
        this.hudDirty = true;
        if (this.save.solved.every(Boolean) && !this.save.finished) this.bus.emit({ t: 'finale' });
        this.drawBtns();
      } else if (e.t === 'finale') {
        this.save.finished = true;
        this.finaleT = 0;
        sfx.auraFinale();
        this.persist();
      }
    });

    // keyboard accessibility (only while Aura Weaver is on screen)
    const kd = (e: KeyboardEvent): void => {
      if (modeState.mode !== 'aura') return;
      const rots = this.rotIdx();
      if (e.key === 'Tab') {
        e.preventDefault();
        if (rots.length) {
          const k = rots.indexOf(this.sel);
          this.sel = rots[(k + (e.shiftKey ? rots.length - 1 : 1)) % rots.length];
          sfx.auraTick(this.sel);
        }
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && this.sel >= 0 && !this.paused) {
        this.stepElem(this.sel, e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'r' || e.key === 'R') this.press(1);
      else if (e.key === 'Enter') this.press(2);
      else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') this.press(3);
    };
    window.addEventListener('keydown', kd);
    const down = (e: PointerEvent): void => {
      this.mouseDown = true;
      this.mouseSeen = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const move = (e: PointerEvent): void => {
      this.mouseSeen = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const up = (): void => {
      this.mouseDown = false;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    });

    // hooks for automated tests
    const w = window as unknown as Record<string, unknown>;
    w.__aura = () => ({ mode: modeState.mode, level: this.level, solved: this.tr?.solved, ok: this.tr?.ok, got: this.tr?.got, awake: this.gates.map((g) => g.awake), saved: this.save.solved, restore: this.restore, moves: this.moves, paused: this.paused, finaleT: this.finaleT, sol: this.sol, ang: this.lv?.elems.map((e) => e.a) });
    w.__auraLevel = (i: number) => this.loadLevel(i);
    w.__auraSolve = () => {
      if (!this.sol) return;
      const r = this.rotIdx();
      r.forEach((ei, k) => (this.lv.elems[ei].a = (this.sol as number[])[k]));
      this.dirty = true;
    };
    w.__auraScreen = (x: number, y: number) => {
      const v = new Vector3(x, BY + y, BZ + 0.03).project(this.world.camera);
      return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
    };
    w.__auraElems = () => this.lv.elems.map((e) => ({ k: e.kind, x: e.x, y: e.y, a: e.a, rot: e.rot }));
    w.__auraPress = (id: number) => this.press(id);
    w.__auraWipe = () => {
      this.save = defaultSave(this.levels.length);
      this.persist();
    };

    this.setVisible(false);
    this.restore = this.save.solved.filter(Boolean).length / this.levels.length;
  }

  private chapterIdx(): number {
    return Math.max(0, CHAPTER_NAMES.indexOf(this.lv.chapter));
  }
  private rotIdx(): number[] {
    const r: number[] = [];
    this.lv.elems.forEach((e, i) => e.rot && r.push(i));
    return r;
  }
  private persist(): void {
    this.save.settings.volume = getMasterVolume();
    writeSave(this.save);
  }
  private buzz(p: number | number[]): void {
    if (this.save.settings.reducedMotion) return;
    try {
      navigator.vibrate?.(p);
    } catch {
      /* ignore */
    }
  }

  // ================================================================ building
  private makeGate(): GateVis {
    const g = new Group();
    const mat = makeCrystalMaterial(0x2a2468, 0xffffff, 0.1);
    const crystal = new Mesh(new CylinderGeometry(0.012, 0.026, 0.11, 4, 1), mat);
    crystal.position.y = 0.0;
    crystal.rotation.y = Math.PI / 4;
    crystal.scale.set(1, 1, 0.55);
    const runes = new Mesh(new PlaneGeometry(0.2, 0.2), new MeshBasicMaterial({ map: runeRingTexture(), color: 0x8888ff, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }));
    runes.position.z = -0.006;
    const discMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    const disc = new Mesh(new CircleGeometry(0.075, 32), discMat);
    disc.position.z = -0.004;
    const label = new TextPanel(0.05, 0.04, 128);
    label.mesh.position.set(0, -0.082, 0.02);
    g.add(runes, disc, crystal, label.mesh);
    g.visible = false;
    this.root.add(g);
    return { g, crystal, mat, runes, disc, discMat, label, fill: 0, awake: false, impure: false, lastGot: 0 };
  }

  private buildSanctuary(): void {
    // ledge + lotus garden, fractal ferns and crystal spires below the board: the world that wakes up
    const ledge = new Mesh(new BoxGeometry(1.2, 0.03, 0.22), new MeshStandardMaterial({ color: 0x0b0a14, roughness: 0.3, metalness: 0.85, emissive: 0x15103a, emissiveIntensity: 0.6 }));
    ledge.position.set(0, -BH / 2 - 0.06, 0.12);
    this.root.add(ledge);
    const n = this.levels.length;
    for (let i = 0; i < n; i++) {
      const x = -0.5 + (i / (n - 1)) * 1.0;
      const lo = makeLotus(0.5 + i * 0.07, 3);
      lo.group.position.set(x, -BH / 2 - 0.035, 0.16);
      this.root.add(lo.group);
      this.lotus.push(lo);
      const fr = makeFractal(0.3 + i * 0.05, 11 + i * 7);
      fr.lines.position.set(x + 0.05, -BH / 2 - 0.045, 0.09);
      fr.lines.scale.setScalar(0.9);
      fr.lines.visible = false;
      fr.setGrow(1);
      this.root.add(fr.lines);
      this.ferns.push(fr);
    }
    // crystal spires: one instanced mesh, per-instance glow
    const NC = 16;
    const cg = new ConeGeometry(0.014, 0.12, 5);
    const glow = new InstancedBufferAttribute(new Float32Array(NC), 1);
    cg.setAttribute('aGlow', glow);
    const cm = makeCrystalMaterial(0x24206a, 0x7fe0ff, 0.55);
    this.crystals = new InstancedMesh(cg, cm, NC);
    const m4 = new Matrix4();
    const p = new Vector3();
    const s = new Vector3();
    const q = new Mesh().quaternion;
    for (let i = 0; i < NC; i++) {
      const x = -0.56 + (i / (NC - 1)) * 1.12;
      s.set(1, 0.6 + ((i * 7) % 5) * 0.2, 1);
      p.set(x, -BH / 2 - 0.02 + (s.y * 0.12) / 2, 0.02 + ((i * 3) % 4) * 0.012);
      m4.compose(p, q, s);
      this.crystals.setMatrixAt(i, m4);
      this.crystalVal.push(0);
    }
    this.crystalGlow = glow;
    this.crystals.frustumCulled = false;
    this.root.add(this.crystals);
    // floating stone fragments drifting in the void
    for (let i = 0; i < 6; i++) {
      const m = floatingStone();
      const x = i % 2 ? 0.74 : -0.74;
      const y = -0.28 + i * 0.1;
      m.position.set(x, y, 0.05 + (i % 3) * 0.04);
      this.root.add(m);
      this.stones.push({ m, ph: i * 1.3, x, y });
    }
  }

  private buildWisps(): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.wispPos, 3));
    this.wisps = new Points(g, new PointsMaterial({ size: 0.022, map: shared().dot, color: 0xbff4ff, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    this.wisps.frustumCulled = false;
    this.wisps.visible = false;
    this.root.add(this.wisps);
  }

  private clearLevelObjects(): void {
    while (this.elemGroup.children.length) this.elemGroup.remove(this.elemGroup.children[0]);
    while (this.srcGroup.children.length) this.srcGroup.remove(this.srcGroup.children[0]);
    this.evs.length = 0;
  }

  private loadLevel(i: number): void {
    this.level = Math.max(0, Math.min(this.levels.length - 1, i));
    this.levels = makeLevels(); // fresh angles every load
    this.lv = this.levels[this.level];
    this.startAng = this.lv.elems.map((e) => e.a);
    this.sol = solve(this.lv, 1)[0] ?? null;
    this.clearLevelObjects();
    const sh = shared();
    this.lv.elems.forEach((e) => {
      const g = new Group();
      g.position.set(e.x, e.y, 0.028);
      let body: Mesh;
      let mark: Mesh | null = null;
      if (e.kind === 'prism') {
        body = new Mesh(sh.prismG, sh.prismM);
        body.rotation.x = Math.PI / 2;
        mark = new Mesh(sh.coneG, sh.ringM);
        g.add(body, mark);
      } else if (e.kind === 'wall') {
        body = new Mesh(sh.wallG, sh.wallM);
        body.scale.y = e.len * 2;
        g.add(body);
      } else if (e.kind === 'filter') {
        const col = new Color().setHex(MASK_HEX[e.mask & 7]);
        body = new Mesh(sh.wallG, new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
        body.scale.set(0.35, e.len * 2, 0.6);
        g.add(body);
      } else {
        body = new Mesh(sh.mirrorG, e.kind === 'splitter' ? sh.splitM : sh.mirrorM);
        body.scale.x = e.len * 2;
        g.add(body);
      }
      const ring = new Mesh(sh.ringG, sh.ringM.clone());
      ring.visible = e.rot;
      g.add(ring);
      this.elemGroup.add(g);
      this.evs.push({ g, ring, mark, visAng: this.visAngle(e), body });
    });
    // sources
    for (const s of this.lv.sources) {
      const g = new Group();
      g.position.set(s.x, s.y, 0.028);
      const orb = new Mesh(sh.orbG, new MeshBasicMaterial({ color: this.maskMix(s.mask), transparent: true, opacity: 0.95 }));
      const halo = new Mesh(sh.haloG, new MeshBasicMaterial({ map: sh.dot, color: this.maskMix(s.mask), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
      halo.position.z = -0.004;
      const cone = new Mesh(sh.coneG, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
      cone.rotation.z = s.ang - Math.PI / 2;
      cone.position.set(Math.cos(s.ang) * 0.03, Math.sin(s.ang) * 0.03, 0);
      g.add(halo, orb, cone);
      this.srcGroup.add(g);
    }
    // gates
    this.gates.forEach((gv, k) => {
      const t = this.lv.targets[k];
      gv.g.visible = !!t;
      gv.fill = 0;
      gv.awake = false;
      gv.impure = false;
      gv.lastGot = 0;
      if (!t) return;
      gv.g.position.set(t.x, t.y, 0.03);
      const need = this.maskMix(t.mask);
      (gv.mat.uniforms.uGlowCol.value as Color).copy(need);
      gv.mat.uniforms.uGlow.value = 0;
      (gv.runes.material as MeshBasicMaterial).color.copy(need);
      gv.discMat.color.copy(need);
      this.drawLabel(gv.label, MASK_LETTER[t.mask & 7], MASK_HEX[t.mask & 7]);
    });
    this.moves = 0;
    this.completeT = -1;
    this.fired = false;
    this.idle = 0;
    this.sel = this.rotIdx()[0] ?? -1;
    this.msg = '';
    this.msgT = 0;
    this.dirty = true;
    this.hudDirty = true;
    // the sanctuary remembers: earlier levels are already in bloom
    this.lotus.forEach((l, k) => {
      const done = this.save.solved[k];
      l.target = done ? 1 : 0;
      if (done) l.grow = 1;
      else l.grow = 0;
      this.ferns[k].lines.visible = done;
    });
    this.restore = this.save.solved.filter(Boolean).length / this.levels.length;
    this.drawBtns();
    this.syncPanels();
  }

  private maskMix(m: number): Color {
    return new Color().setHex(MASK_HEX[m & 7]);
  }
  private drawLabel(p: TextPanel, s: string, hex: number): void {
    p.ctx.clearRect(0, 0, p.w, p.h);
    if (this.save.settings.labels) {
      p.ctx.fillStyle = 'rgba(8,6,20,0.8)';
      p.ctx.fillRect(0, 0, p.w, p.h);
      p.text(s, p.h * 0.78, 64, '#' + hex.toString(16).padStart(6, '0'));
    }
    p.commit();
  }

  private visAngle(e: Elem): number {
    return angleOf(e);
  }

  private setVisible(v: boolean): void {
    this.root.visible = v;
    this.hud.mesh.visible = v;
    this.compass.mesh.visible = v;
    for (const b of this.btns) b.mesh.visible = v;
    this.syncPanels();
  }
  private syncPanels(): void {
    const on = modeState.mode === 'aura';
    this.hud.mesh.visible = on && !this.photo;
    this.compass.mesh.visible = on && !this.photo;
    this.card.mesh.visible = on && !this.photo && (this.completeT > 2.2 || this.finaleT > 6);
    for (const b of this.setBtns) b.mesh.visible = on && this.paused && !this.photo;
    this.btns.forEach((b, i) => (b.mesh.visible = on && (!this.photo || i < 3)));
  }

  // ================================================================ actions
  private press(id: number): void {
    if (this.photo) {
      if (id === 0) this.shotPending = true;
      else if (id === 1) {
        this.comp = (this.comp + 1) % 3;
        this.applyComposition();
      } else if (id === 2) this.setPhoto(false);
      return;
    }
    if (id === 0) this.loadLevel(this.level - 1);
    else if (id === 1) this.loadLevel(this.level);
    else if (id === 2) {
      if (this.save.solved[this.level] || this.level < this.save.unlocked) this.loadLevel(this.level + 1);
      else {
        this.msg = 'Wake every gate first';
        this.msgT = 3;
        this.hudDirty = true;
      }
    } else if (id === 3) {
      this.paused = !this.paused;
      this.syncPanels();
      this.drawBtns();
    } else if (id === 4) this.setVol(getMasterVolume() - 0.15);
    else if (id === 5) this.setVol(getMasterVolume() + 0.15);
    else if (id === 6) {
      quality.manual = true;
      quality.tier = (quality.tier + 3) % 4;
    } else if (id === 7) this.save.settings.reducedMotion = !this.save.settings.reducedMotion;
    else if (id === 8) {
      this.save.settings.labels = !this.save.settings.labels;
      this.gates.forEach((gv, k) => this.lv.targets[k] && this.drawLabel(gv.label, MASK_LETTER[this.lv.targets[k].mask & 7], MASK_HEX[this.lv.targets[k].mask & 7]));
    } else if (id === 9) this.save.settings.wisps = !this.save.settings.wisps;
    else if (id === 10) {
      this.paused = false;
      this.setPhoto(true);
    } else if (id === 11) this.paused = false;
    this.persist();
    this.drawBtns();
    this.syncPanels();
  }
  private setVol(v: number): void {
    setMasterVolume(v);
    this.save.settings.volume = getMasterVolume();
  }
  private setPhoto(on: boolean): void {
    this.photo = on;
    this.comp = 0;
    this.applyComposition();
    this.syncPanels();
    this.drawBtns();
  }
  private applyComposition(): void {
    const c = this.photo ? this.comp : 0;
    if (c === 0) {
      this.root.scale.setScalar(1);
      this.root.position.set(0, BY, BZ);
      this.root.rotation.y = 0;
    } else if (c === 1) {
      this.root.scale.setScalar(1.25);
      this.root.position.set(0, BY - 0.05, BZ + 0.15);
      this.root.rotation.y = 0;
    } else {
      this.root.scale.setScalar(1);
      this.root.position.set(0.1, BY, BZ + 0.05);
      this.root.rotation.y = -0.3;
    }
  }

  private capture(): void {
    this.shotPending = false;
    try {
      const r = this.world.renderer;
      r.render(this.world.scene, this.world.camera);
      r.domElement.toBlob((blob) => {
        if (!blob) {
          this.msg = 'Photo failed on this browser';
          this.msgT = 4;
          this.hudDirty = true;
          return;
        }
        const file = new File([blob], 'aura-weaver.png', { type: 'image/png' });
        const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
        if (nav.canShare && nav.canShare({ files: [file] })) {
          nav.share({ files: [file], title: 'Aura Weaver' }).catch(() => undefined);
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'aura-weaver.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
        sfx.select();
      }, 'image/png');
    } catch {
      this.msg = 'Photo failed on this browser';
      this.msgT = 4;
    }
  }

  private stepElem(i: number, d: number): void {
    const e = this.lv.elems[i];
    const n = stepsOf(e);
    e.a = (e.a + d + n) % n;
    this.afterRotate(e);
  }
  private afterRotate(e: Elem): void {
    this.moves++;
    this.dirty = true;
    this.bend = (e.a / stepsOf(e)) as number;
    this.bus.emit({ t: 'rotate', step: e.a });
  }

  // ================================================================ input
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
  private nearest(bx: number, by: number, maxD: number): number {
    let best = -1;
    let bd = maxD;
    this.lv.elems.forEach((e, i) => {
      if (!e.rot) return;
      const d = Math.hypot(e.x - bx, e.y - by);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
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
    const bx = pt.pos.x - this.root.position.x;
    const by = pt.pos.y - this.root.position.y;
    if (pt.down && !pt.was && !this.paused && !this.photo) {
      const g = this.nearest(bx, by, PICK_R);
      if (g >= 0) {
        pt.grab = g;
        pt.t0 = this.time;
        pt.sx = bx;
        pt.sy = by;
        pt.moved = false;
        this.sel = g;
        sfx.grab();
      }
    }
    if (pt.down && pt.grab >= 0) {
      const e = this.lv.elems[pt.grab];
      if (Math.hypot(bx - pt.sx, by - pt.sy) > 0.02) pt.moved = true;
      const dx = bx - e.x;
      const dy = by - e.y;
      if (Math.hypot(dx, dy) > 0.03) {
        const ang = Math.atan2(dy, dx);
        const n = stepsOf(e);
        const span = e.kind === 'prism' ? Math.PI * 2 : Math.PI;
        const a = ((Math.round((ang / span) * n) % n) + n) % n;
        if (a !== e.a) {
          e.a = a;
          this.afterRotate(e);
        }
      }
    }
    if (!pt.down && pt.was && pt.grab >= 0) {
      if (!pt.moved && this.time - pt.t0 < 0.45) this.stepElem(pt.grab, 1); // a tap turns one step
      pt.grab = -1;
    }
    pt.was = pt.down;
  }

  // ================================================================ per-frame
  update(delta: number): void {
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const on = modeState.mode === 'aura';
      this.setVisible(on);
      if (on) {
        this.paused = false;
        this.photo = false;
        this.applyComposition();
        this.save.stats.plays++;
        let start = this.save.solved.findIndex((s) => !s);
        if (start < 0) start = this.levels.length - 1;
        this.loadLevel(Math.min(start, this.save.unlocked));
      } else {
        sfx.auraBeams(0, 0, 0, 0);
        this.persist();
      }
    }
    if (modeState.mode !== 'aura') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.hudDirty = true;
      this.drawBtns();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const reduced = this.save.settings.reducedMotion;
    const dt = this.paused ? 0 : Math.min(delta, 0.05);
    this.time += Math.min(delta, 0.05);
    for (const pt of this.pointers) this.updatePointer(pt);
    this.updateHover();

    if (this.dirty) this.retrace();
    this.updateGates(dt);
    this.updateVisuals(dt, reduced);
    this.updateWorld(dt, reduced);
    this.updateAudio();

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.hudDirty = true;
    }
    this.idle += dt;
    if (this.hudDirty) {
      this.hudDirty = false;
      this.drawHud();
      this.drawCompass();
    }
    if (this.shotPending) this.capture();
  }

  private updateHover(): void {
    if (this.mouseSeen && !this.mouseDown && this.mousePoint(this.hoverPos)) {
      this.hover = this.nearest(this.hoverPos.x - this.root.position.x, this.hoverPos.y - this.root.position.y, 0.09);
    } else if (!this.mouseSeen) this.hover = -1;
  }

  private retrace(): void {
    this.dirty = false;
    // light memory: the previous paths linger as a faint ghost
    if (this.tr) {
      const n = Math.min(MAX_SEG, this.tr.segs.length);
      for (let i = 0; i < n; i++) {
        const s = this.tr.segs[i];
        setBeam(this.ghost, i, s.x1, s.y1, s.x2, s.y2, 0, 0.02, 7);
      }
      this.ghost.mesh.count = n;
      this.ghost.mesh.instanceMatrix.needsUpdate = true;
      this.ghost.col.needsUpdate = true;
      this.ghost.len.needsUpdate = true;
      this.ghostT = 1.6;
    }
    this.tr = trace(this.lv);
    const n = Math.min(MAX_SEG, this.tr.segs.length);
    const lv = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const s = this.tr.segs[i];
      setBeam(this.beams, i, s.x1, s.y1, s.x2, s.y2, 0, 0.07, s.mask);
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (s.mask & CYAN) lv[0] += L;
      if (s.mask & MAGENTA) lv[1] += L;
      if (s.mask & GOLD) lv[2] += L;
    }
    this.beamLv = lv.map((v) => Math.min(1, v / 1.1));
    this.beams.mesh.count = n;
    this.beams.mesh.instanceMatrix.needsUpdate = true;
    this.beams.col.needsUpdate = true;
    this.beams.len.needsUpdate = true;
    this.hudDirty = true;
  }

  private updateGates(dt: number): void {
    let all = true;
    this.lv.targets.forEach((t, i) => {
      const gv = this.gates[i];
      const got = this.tr.got[i];
      const exact = got === t.mask;
      const impure = got !== 0 && !exact;
      if (impure && !gv.impure && got !== gv.lastGot && !gv.awake) this.bus.emit({ t: 'impure', i });
      gv.impure = impure;
      gv.lastGot = got;
      if (!gv.awake) {
        gv.fill += exact ? dt / HOLD_T : -dt / 0.5;
        gv.fill = Math.max(0, Math.min(1, gv.fill));
        if (gv.fill >= 1) this.bus.emit({ t: 'awaken', i });
      } else if (!exact) {
        // light was taken away: the gate drifts back to sleep, nothing is lost permanently
        gv.fill -= dt / 0.4;
        if (gv.fill <= 0.6) {
          gv.awake = false;
          gv.fill = Math.max(0, gv.fill);
        }
      }
      if (!gv.awake) all = false;
    });
    if (all && this.completeT < 0 && this.lv.targets.length > 0 && !this.paused) {
      this.completeT = 0;
    }
    if (this.completeT >= 0) {
      if (!all) this.completeT = -1;
      else {
        const before = this.completeT;
        this.completeT += dt;
        if (!this.fired && before < 0.6 && this.completeT >= 0.6) {
          this.fired = true;
          this.bus.emit({ t: 'complete' });
        }
        this.syncPanels();
        if (before < 2.2 && this.completeT >= 2.2) this.drawCard();
      }
    }
  }

  private updateVisuals(dt: number, reduced: boolean): void {
    const tier = quality.tier;
    // beams
    this.beams.mat.uniforms.uTime.value = this.time;
    this.beams.mat.uniforms.uCalm.value = tier === 0 || reduced ? 0 : 1;
    if (this.ghostT > 0) {
      this.ghostT -= dt;
      this.ghost.mat.uniforms.uAlpha.value = Math.max(0, this.ghostT / 1.6) * 0.22;
    }
    this.ghost.mat.uniforms.uTime.value = this.time;
    // elements follow their discrete angle smoothly
    this.lv.elems.forEach((e, i) => {
      const v = this.evs[i];
      if (!v) return;
      let target = this.visAngle(e);
      if (e.kind !== 'prism') {
        // mirrors are symmetric every half turn: take the shortest way round
        let d = target - v.visAng;
        d = ((d % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2;
        target = v.visAng + d;
      } else {
        let d = target - v.visAng;
        d = ((d % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        target = v.visAng + d;
      }
      v.visAng += (target - v.visAng) * Math.min(1, dt * 22 + (reduced ? 1 : 0));
      if (e.kind === 'mirror' || e.kind === 'splitter') v.g.rotation.z = v.visAng;
      else if (e.kind === 'filter' || e.kind === 'wall') v.g.rotation.z = v.visAng - Math.PI / 2;
      if (e.kind === 'prism') {
        v.body.rotation.set(Math.PI / 2, v.visAng + Math.PI / 2, 0);
        if (v.mark) {
          v.mark.position.set(Math.cos(v.visAng) * 0.062, Math.sin(v.visAng) * 0.062, 0);
          v.mark.rotation.z = v.visAng - Math.PI / 2;
        }
      }
      const sel = i === this.sel || i === this.hover;
      const hint = this.save.settings.wisps && this.idle > 14 && this.sol && this.wrongElem() === i;
      const rm = v.ring.material as MeshBasicMaterial;
      rm.opacity += ((sel ? 0.9 : hint ? 0.55 + 0.3 * Math.sin(this.time * 4) : e.rot ? 0.22 : 0) - rm.opacity) * Math.min(1, dt * 10);
      rm.color.setHex(hint ? 0xffe08a : 0x9fe8ff);
      v.ring.scale.setScalar(1 + (sel ? 0.12 : 0) + (reduced ? 0 : Math.sin(this.time * 2 + i) * 0.02));
    });
    // gates
    this.gates.forEach((gv, i) => {
      const t = this.lv.targets[i];
      if (!t) return;
      const f = gv.fill;
      gv.mat.uniforms.uTime.value = this.time;
      gv.mat.uniforms.uGlow.value = gv.awake ? 1.1 + 0.2 * Math.sin(this.time * 3 + i) : 0.28 + f * 0.9 + (gv.impure ? 0.2 * Math.sin(this.time * 18) : 0);
      const c = gv.impure ? 0xffa040 : MASK_HEX[(gv.awake ? t.mask : gv.lastGot) & 7] || MASK_HEX[t.mask & 7];
      gv.discMat.color.setHex(c);
      gv.discMat.opacity = gv.awake ? 0.5 + 0.2 * Math.sin(this.time * 4) : f * 0.4 + (gv.lastGot ? 0.08 : 0);
      gv.runes.rotation.z += dt * (gv.awake ? 0.6 : 0.12) * (reduced ? 0.3 : 1);
      (gv.runes.material as MeshBasicMaterial).opacity = 0.32 + (gv.awake ? 0.5 : f * 0.35);
      gv.crystal.scale.y = 1 + (gv.awake ? 0.12 : f * 0.06);
      gv.crystal.rotation.y += dt * (gv.awake ? 0.8 : 0.1) * (reduced ? 0.3 : 1);
    });
    this.ripple.update(dt);
  }

  private wrongElem(): number {
    if (!this.sol) return -1;
    const r = this.rotIdx();
    for (let k = 0; k < r.length; k++) if (this.lv.elems[r[k]].a !== this.sol[k]) return r[k];
    return -1;
  }

  private updateWorld(dt: number, reduced: boolean): void {
    const tier = quality.tier;
    this.restoreShown += (this.restore - this.restoreShown) * Math.min(1, dt * 1.2);
    const u = this.nebula.mat.uniforms;
    u.uTime.value = this.time;
    u.uRestore.value = this.restoreShown + (this.gates.filter((g) => g.awake).length / 6) * 0.15;
    u.uOct.value = tier >= 3 ? 5 : tier === 2 ? 4 : tier === 1 ? 3 : 2;
    u.uMotion.value = reduced ? 0.15 : 1;
    if (this.pulseAge >= 0) {
      this.pulseAge += dt * 0.9;
      u.uPulseAge.value = this.pulseAge;
      u.uPulseC.value = { x: 0.5, y: 0.5 };
      if (this.pulseAge > 1.8) {
        this.pulseAge = -1;
        u.uPulseAge.value = -1;
      }
    }
    musicState.swell = Math.min(1, this.restoreShown + (this.finaleT >= 0 ? 0.5 : 0));
    // flora
    const pollen = tier >= 3 ? 28 : tier === 2 ? 18 : tier === 1 ? 8 : 0;
    this.lotus.forEach((l) => l.update(dt, this.time, pollen));
    for (const m of this.crystals.material instanceof Array ? this.crystals.material : [this.crystals.material]) {
      const sm = m as ReturnType<typeof makeCrystalMaterial>;
      if (sm.uniforms?.uTime) sm.uniforms.uTime.value = this.time;
    }
    const lit = Math.round(this.restoreShown * this.crystalVal.length + (this.gates.filter((g) => g.awake).length / Math.max(1, this.lv.targets.length)) * 1.5);
    for (let i = 0; i < this.crystalVal.length; i++) {
      const target = i < lit ? 1 : 0.22;
      this.crystalVal[i] += (target - this.crystalVal[i]) * Math.min(1, dt * 2);
      this.crystalGlow.setX(i, this.crystalVal[i] * (0.8 + (reduced ? 0 : 0.2 * Math.sin(this.time * 2 + i))));
    }
    this.crystalGlow.needsUpdate = true;
    for (const s of this.stones) {
      s.m.position.y = s.y + (reduced ? 0 : Math.sin(this.time * 0.6 + s.ph) * 0.02);
      s.m.rotation.y += dt * 0.3 * (reduced ? 0.2 : 1);
      s.m.rotation.x += dt * 0.15 * (reduced ? 0.2 : 1);
    }
    // guiding wisps
    const wisp = this.save.settings.wisps && this.idle > 14 && !this.tr.solved;
    this.wisps.visible = wisp;
    if (wisp) {
      const wi = this.wrongElem();
      if (wi >= 0) {
        const e = this.lv.elems[wi];
        const s0 = this.lv.sources[0];
        for (let i = 0; i < 10; i++) {
          const ph = (this.time * 0.35 + i / 10) % 1;
          const bendY = Math.sin(ph * Math.PI) * 0.06;
          this.wispPos[i * 3] = s0.x + (e.x - s0.x) * ph + Math.sin(this.time * 3 + i) * 0.01;
          this.wispPos[i * 3 + 1] = s0.y + (e.y - s0.y) * ph + bendY;
          this.wispPos[i * 3 + 2] = 0.05;
        }
        (this.wisps.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      }
    }
    // finale choreography: waves ripple across every gate and flora while the title appears
    if (this.finaleT >= 0) {
      const before = this.finaleT;
      this.finaleT += dt;
      for (let k = 0; k < 6; k++) {
        const at = k * 1.1;
        if (before < at && this.finaleT >= at) {
          this.ripple.fire(-0.5 + (k / 5) * 1.0, -BH / 2, 0.1, 0.9, [0x33f0ff, 0xff3bd6, 0xffc233, 0x3dffa0, 0x8a5cff, 0xffffff][k]);
          this.pulseAge = 0;
          celebrate(-0.5 + (k / 5) * 1.0, BY - BH / 2, BZ + 0.12, 2);
        }
      }
      for (const l of this.lotus) l.target = 1;
      this.restore = 1;
      if (before < 6 && this.finaleT >= 6) {
        this.drawCard();
        this.syncPanels();
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2);
  }

  private updateAudio(): void {
    if (this.paused) return;
    this.bend += ((this.sel >= 0 ? this.lv.elems[this.sel].a / stepsOf(this.lv.elems[this.sel]) : 0) - this.bend) * 0.1;
    const awakeN = this.gates.filter((g) => g.awake).length;
    sfx.auraBeams(this.beamLv[0] * (0.6 + 0.4 * (awakeN > 0 ? 1 : 0)), this.beamLv[1], this.beamLv[2], this.bend);
  }

  // ================================================================ drawing (canvas panels)
  private drawBtns(): void {
    const solved = this.save.solved[this.level] || this.level < this.save.unlocked;
    const labels: [string, string][] = this.photo
      ? [['SHOT', 'Save photo'], ['FRAME', 'Composition ' + (this.comp + 1) + '/3'], ['EXIT', 'Leave photo mode'], ['', '']]
      : [['BACK', 'Previous'], ['RETRY', 'Reset puzzle'], ['NEXT', solved ? 'Next chapter' : 'Locked'], [this.paused ? 'RESUME' : 'PAUSE', 'Settings']];
    this.btns.forEach((p, i) => {
      p.card('rgba(10,8,26,0.9)', i === 2 && solved && !this.photo ? '#8dffc2' : '#7fb8ff');
      p.text(labels[i][0], p.h * 0.3, 22, '#9fc2ff');
      p.text(labels[i][1], p.h * 0.7, 30, '#eef4ff');
      p.commit();
      p.mesh.visible = modeState.mode === 'aura' && !(this.photo && i === 3);
    });
    const st = [
      ['VOLUME -', Math.round(getMasterVolume() * 100) + '%'],
      ['VOLUME +', Math.round(getMasterVolume() * 100) + '%'],
      ['QUALITY', ['Low', 'Medium', 'High', 'Ultra'][quality.tier]],
      ['MOTION', this.save.settings.reducedMotion ? 'Reduced' : 'Full'],
      ['COLOUR LABELS', this.save.settings.labels ? 'On' : 'Off'],
      ['GUIDING WISPS', this.save.settings.wisps ? 'On' : 'Off'],
      ['PHOTO MODE', 'Hide HUD'],
      ['RESUME', 'Back to puzzle'],
    ];
    this.setBtns.forEach((p, i) => {
      p.card('rgba(10,8,26,0.94)', '#b48cff');
      p.text(st[i][0], p.h * 0.32, 22, '#c9b6ff');
      p.text(st[i][1], p.h * 0.74, 28, '#eef4ff');
      p.commit();
    });
  }

  private drawHud(): void {
    const h = this.hud;
    const lv = this.lv;
    if (!lv) return;
    h.card('rgba(8,6,24,0.88)', '#7fb8ff');
    h.text(lv.chapter + '   -   ' + lv.name, 50, 26, '#cfe4ff');
    h.text(lv.goal, 100, 26, this.tr?.solved ? '#8dffc2' : '#ffe6a8');
    const hint = this.msgT > 0 ? this.msg : this.save.solved[this.level] ? 'Sanctuary ' + Math.round(this.restore * 100) + '% restored - NEXT continues' : 'Hint: ' + lv.hint;
    h.text(hint, 148, 23, this.msgT > 0 ? '#8dffc2' : '#b8c8ee');
    const need = lv.targets.map((t) => MASK_NAME[t.mask & 7]).join('  ');
    h.text('Gates: ' + need + '     Turns ' + this.moves, 196, 21, '#9fc2ff');
    h.commit();
  }

  private drawCompass(): void {
    const c = this.compass;
    const g = c.ctx;
    const W = c.w;
    const cx = W / 2;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(6,5,20,0.7)';
    g.beginPath();
    g.arc(cx, cx, cx - 6, 0, Math.PI * 2);
    g.fill();
    const ring = (r: number, frac: number, col: string, w: number): void => {
      g.lineWidth = w;
      g.strokeStyle = 'rgba(120,140,200,0.25)';
      g.beginPath();
      g.arc(cx, cx, r, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = col;
      g.beginPath();
      g.arc(cx, cx, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.stroke();
    };
    const awake = this.gates.filter((x, i) => this.lv && this.lv.targets[i] && x.awake).length;
    const gates = Math.max(1, this.lv ? this.lv.targets.length : 1);
    const pure = this.tr ? this.tr.ok.filter(Boolean).length / gates : 0;
    ring(cx - 14, this.restore, '#ffd36b', 9);
    ring(cx - 34, pure, '#6fe8ff', 7);
    ring(cx - 52, awake / gates, '#b48cff', 7);
    g.fillStyle = '#eef4ff';
    g.textAlign = 'center';
    g.font = '700 46px ' + SERIF;
    g.fillText(String(Math.round(this.restore * 100)) + '%', cx, cx + 6);
    g.font = '600 20px ' + SERIF;
    g.fillStyle = '#9fc2ff';
    g.fillText('CHAPTER ' + (this.chapterIdx() + 1), cx, cx + 34);
    g.fillText('PURITY ' + Math.round(pure * 100) + '%', cx, cx + 58);
    c.commit();
  }

  private drawCard(): void {
    const c = this.card;
    const g = c.ctx;
    const finished = this.save.solved.every(Boolean);
    c.card('rgba(6,5,22,0.92)', finished ? '#ffd36b' : '#7fb8ff');
    g.textAlign = 'center';
    g.fillStyle = '#ffe9b0';
    g.font = '700 ' + (finished ? 64 : 48) + 'px ' + SERIF;
    g.fillText(finished ? 'AURA WEAVER' : 'AWAKENED', c.w / 2, 90);
    g.font = 'italic 30px ' + SERIF;
    g.fillStyle = '#cfe4ff';
    g.fillText(finished ? 'I did not just play this world. I brought it to life.' : this.lv.name + ' - ' + this.moves + ' turns', c.w / 2, 140);
    // the living signature: a rose curve built from how you played
    const hs = this.save.stats.hues;
    const tot = Math.max(1, hs.reduce((a, b) => a + b, 0));
    const cx = c.w / 2;
    const cy = c.h * 0.66;
    const k = 3 + (this.save.stats.connections % 5);
    for (let m = 1; m < 8; m++) {
      if (!hs[m] && finished === false && m !== 1) continue;
      const share = (hs[m] || 1) / tot;
      g.strokeStyle = '#' + MASK_HEX[m].toString(16).padStart(6, '0');
      g.globalAlpha = 0.35 + share * 1.6;
      g.lineWidth = 2;
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.03) {
        const r = (70 + 40 * Math.sin(k * a + m)) * (0.5 + share * 2) * (0.7 + 0.05 * m);
        const x = cx + Math.cos(a + m * 0.4) * Math.min(120, r);
        const y = cy + Math.sin(a + m * 0.4) * Math.min(120, r) * 0.85;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.font = '600 24px ' + SERIF;
    g.fillStyle = '#9fc2ff';
    g.fillText('Connections ' + this.save.stats.connections + '   Turns ' + this.save.stats.moves, c.w / 2, c.h - 30);
    c.commit();
  }
}

void PRISM_STEPS;
void MIRROR_STEPS;
