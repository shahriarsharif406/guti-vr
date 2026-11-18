import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CapsuleGeometry,
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
import { getMasterVolume, setMasterVolume, setMuted, setMusicVolume, setSfxVolume, musicState } from './audio.js';
import { aa } from './auraaudio.js';
import {
  CYAN,
  GOLD,
  MAGENTA,
  MIRROR_STEPS,
  PRISM_STEPS,
  angleOf,
  solve,
  stepsOf,
  trace,
} from './auralogic.js';
import type { Elem, Level, Trace } from './auralogic.js';
import { MASK_HEX, MASK_LETTER, MASK_NAME, RippleFx, floatingStone, makeBeams, makeCrystalMaterial, makeFractal, makeLotus, makeNebula, runeRingTexture, setBeam, softDotTexture } from './aurafx.js';
import type { Lotus } from './aurafx.js';
import { WORLDS, makePuzzles } from './auralevels.js';
import type { Puzzle } from './auralevels.js';
import { defaultSave, loadSave, writeSave } from './aurasave.js';
import { nodePos } from './threadlogic.js';
import { ThreadPlay } from './threadplay.js';
import type { PlayEvent } from './threadplay.js';
import { ThreadView } from './threadview.js';
import type { ThreadViewOpts } from './threadview.js';
import type { AuraSave } from './aurasave.js';
import { celebrate } from './fx.js';
import { readPinchPoint } from './hand.js';
import { modeState } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { quality } from './quality.js';
import { AuraOpt } from './ui-components.js';

// ---- Aura Weaver: compose light. Turn mirrors and prisms (pinch and swing, or tap) to wake the monoliths.
const BZ = -0.85;
const BY = 0.9;
/** The whole loom is drawn this much larger than its puzzle coordinates (puzzles keep their own metre units). */
const S = 1.3;
const BW = 1.16;
const BH = 0.74;
const PICK_R = 0.085;
const BTN_W = 0.235;
const BTN_H = 0.095;
const BTN_STEP = 0.25;
const ROW_X = -0.12; // the button rows sit a little left so the global MENU button stays clear
const PINCH_START = 0.85;
const PINCH_HOLD = 0.5;
const MAX_SEG = 96;
const HOLD_T = 0.8; // seconds of exact light needed to wake a gate
/** thread pick radius per aim setting (precise, normal, generous) */
const AIM_R = [0.042, 0.055, 0.075];
/** button ids of the thread-only game buttons (after the 4 game buttons and 12 menu slots) */
const ID_ERA = 16;
const ID_HINT = 17;
const REFUSE_TEXT: Record<string, string> = {
  'no-node': 'Let go on a crystal to tie the thread',
  self: 'A thread needs two different crystals',
  era: 'That crystal does not exist in this era',
  'capacity-out': 'That crystal has no thread left to give',
  'capacity-in': 'That crystal cannot take another thread',
  duplicate: 'Those crystals are already woven together',
  'too-long': 'Too far: the thread would tear. Find a crystal in between',
  wall: 'A pillar is in the way',
  crossing: 'Threads may not cross: they would short the energy',
};
let rayTex: CanvasTexture | null = null;
/** Radial god-ray burst (cheap screen-space-style approximation: one additive quad per awake gate). */
function rayTexture(): CanvasTexture {
  if (rayTex) return rayTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.translate(128, 128);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + ((i * 37) % 7) * 0.05;
    const w = 0.05 + ((i * 13) % 5) * 0.02;
    const gr = g.createRadialGradient(0, 0, 4, 0, 0, 126);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 126, a - w, a + w);
    g.closePath();
    g.fill();
  }
  rayTex = new CanvasTexture(c);
  return rayTex;
}
type Screen = 'title' | 'chapters' | 'game' | 'settings';
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
  rays: Mesh;
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
  /** the journey: every puzzle (light board, thread board or both); `level` indexes this list */
  private puzzles: Puzzle[] = makePuzzles();
  private pz!: Puzzle;
  private save: AuraSave = defaultSave(this.puzzles.length);
  /** thread board of the current puzzle (null for pure light puzzles) */
  private tp: ThreadPlay | null = null;
  private tview!: ThreadView;
  private tviewOpts: ThreadViewOpts = { reducedMotion: false, reducedFlash: false, highContrast: false, hintOn: false };
  /** invisible ray target over the loom: mouse, controller rays and hand pointers all arrive here */
  private board!: Mesh;
  private boardPids = new Set<number>();
  private boardV = new Vector3();
  private uiMeshes: Mesh[] = [];
  private hintT = 0;
  private hintsUsed = 0;
  private puzzleT = 0;
  private threadLv = [0, 0, 0];
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
  private screen: Screen = 'title';
  private confirmNew = false;
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
  private threadBtns: TextPanel[] = [];
  private setBtns: TextPanel[] = [];
  private card!: TextPanel;
  private beamLv = [0, 0, 0];
  private bend = 0;
  private activeBeamMs = 0;
  private flash = 0;
  private fired = false;

  // ================================================================ init
  init(): void {
    this.save = loadSave(this.puzzles.length);
    setMasterVolume(this.save.settings.volume);
    setMusicVolume(this.save.settings.music);
    setSfxVolume(this.save.settings.sfx);
    setMuted(this.save.settings.muted);
    this.root.position.set(0, BY, BZ);
    this.root.scale.setScalar(S);
    const rootEnt = this.world.createTransformEntity(this.root);

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
    // thread board: renderer + one ray-interactable plane covering the loom
    this.tview = new ThreadView(shared().dot);
    this.root.add(this.tview.group);
    const boardMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    boardMat.colorWrite = false;
    this.board = new Mesh(new PlaneGeometry(BW + 0.06, BH + 0.06), boardMat);
    this.board.position.set(0, 0, 0.03);
    const boardEnt = this.world.createTransformEntity(this.board, { parent: rootEnt });
    boardEnt.addComponent(RayInteractable);
    this.initBoardInput();

    // gates (monoliths): pool of 3
    for (let i = 0; i < 3; i++) this.gates.push(this.makeGate());
    this.buildSanctuary();
    this.buildWisps();

    // HUD, compass and buttons
    this.hud = new TextPanel(0.92, 0.17, 1280);
    this.hud.mesh.position.set(0, BY + (BH * S) / 2 + 0.018, BZ + 0.05);
    this.hud.mesh.rotation.x = -0.15;
    this.world.createTransformEntity(this.hud.mesh);
    this.compass = new TextPanel(0.24, 0.24, 512);
    this.compass.mesh.position.set(-0.7, BY + (BH * S) / 2 - 0.02, BZ + 0.06);
    this.compass.mesh.rotation.y = 0.35;
    this.world.createTransformEntity(this.compass.mesh);
    this.card = new TextPanel(0.96, 0.62, 1280);
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
      this.uiMeshes.push(panel.mesh);
    };
    for (let i = 0; i < 4; i++) mkBtn(i, BTN_W, BTN_H, ROW_X + (i - 1.5) * BTN_STEP, 0.64, -0.5, -0.9, this.btns);
    for (let i = 0; i < 12; i++) mkBtn(4 + i, BTN_W, BTN_H, i % 2 ? 0.15 : -0.15, 1.4 - Math.floor(i / 2) * 0.115, -0.5, -0.2, this.setBtns);
    // thread puzzles only: ERA (switch past / present) and HINT, at both ends of the game row
    mkBtn(ID_ERA, BTN_W, BTN_H, ROW_X - 2.5 * BTN_STEP, 0.64, -0.5, -0.9, this.threadBtns);
    mkBtn(ID_HINT, BTN_W, BTN_H, ROW_X + 2.5 * BTN_STEP, 0.64, -0.5, -0.9, this.threadBtns);

    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'aura' || this.optCooldown > 0) return;
        this.optCooldown = 0.3;
        aa.click();
        this.press(entity.getValue(AuraOpt, 'id') as number);
      }),
    );

    // event wiring: gameplay events drive visuals, audio, save and world state
    this.bus.on((e) => {
      if (e.t === 'rotate') {
        aa.tick(e.step);
        this.buzz(12);
        this.idle = 0;
      } else if (e.t === 'awaken') {
        const g = this.gates[e.i];
        const t = this.lv.targets[e.i];
        g.awake = true;
        this.ripple.fire(t.x, t.y, 0, 0.5, MASK_HEX[t.mask & 7]);
        celebrate(t.x * S, BY + t.y * S, BZ + 0.08, 1);
        aa.awaken(e.i, this.chapterIdx());
        this.buzz(40);
        this.save.stats.connections++;
        this.save.stats.hues[t.mask & 7]++;
        this.flash = this.save.settings.reducedFlash ? 0.3 : 1;
      } else if (e.t === 'impure') {
        aa.impure();
        const t = this.lv.targets[e.i];
        this.msg = 'The ' + MASK_NAME[t.mask & 7] + ' gate needs exactly ' + MASK_NAME[t.mask & 7] + ' light';
        this.msgT = 4;
        this.hudDirty = true;
      } else if (e.t === 'complete') {
        const mv = this.totalMoves();
        this.save.solved[this.level] = true;
        this.save.unlocked = Math.min(this.puzzles.length - 1, Math.max(this.save.unlocked, this.level + 1));
        const best = this.save.best[this.level];
        if (best === 0 || mv < best) {
          this.save.best[this.level] = mv;
          this.save.hints[this.level] = this.hintsUsed;
        }
        const bt = this.save.time[this.level];
        if (bt === 0 || this.puzzleT < bt) this.save.time[this.level] = Math.max(0.1, Math.round(this.puzzleT * 10) / 10);
        if (this.puzzleT <= this.pz.swift) this.save.swift[this.level] = true;
        this.save.stats.moves += mv;
        if (this.tp) this.tp.cancel();
        this.boardPids.clear();
        this.lotus[this.level].target = 1;
        this.ferns[this.level].lines.visible = true;
        this.pulseAge = 0;
        aa.pulse();
        this.buzz([60, 40, 120]);
        this.restore = this.save.solved.filter(Boolean).length / this.puzzles.length;
        this.msg = 'Sanctuary ' + Math.round(this.restore * 100) + '% restored';
        this.msgT = 6;
        this.persist();
        this.hudDirty = true;
        if (this.save.solved.every(Boolean) && !this.save.finished) this.bus.emit({ t: 'finale' });
        this.drawBtns();
      } else if (e.t === 'finale') {
        this.save.finished = true;
        this.finaleT = 0;
        aa.finale();
        this.persist();
      }
    });

    // keyboard accessibility (only while Aura Weaver is on screen)
    const kd = (e: KeyboardEvent): void => {
      if (modeState.mode !== 'aura') return;
      if (this.screen !== 'game') {
        if (e.key === 'Enter' && this.screen === 'title') this.press(4);
        else if (e.key === 'Escape' && this.screen !== 'title') this.press(this.screen === 'chapters' ? 9 : 15);
        return;
      }
      const rots = this.rotIdx();
      if (e.key === 'Tab') {
        e.preventDefault();
        if (rots.length) {
          const k = rots.indexOf(this.sel);
          this.sel = rots[(k + (e.shiftKey ? rots.length - 1 : 1)) % rots.length];
          aa.tick(this.sel);
        }
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && this.sel >= 0 && !this.paused) {
        this.stepElem(this.sel, e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'e' || e.key === 'E') this.press(ID_ERA);
      else if (e.key === 'h' || e.key === 'H') this.press(ID_HINT);
      else if (e.key === 'r' || e.key === 'R') this.press(1);
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
    w.__aura = () => ({ screen: this.screen, puzzle: this.pz?.id, stats: this.save.stats, msg: this.msgT > 0 ? this.msg : '', hints: this.save.hints, count: this.puzzles.length, unlocked: this.save.unlocked, time: this.save.time, settings: this.save.settings, mode: modeState.mode, level: this.level, solved: this.tr?.solved, ok: this.tr?.ok, got: this.tr?.got, awake: this.gates.map((g) => g.awake), saved: this.save.solved, restore: this.restore, moves: this.moves, paused: this.paused, finaleT: this.finaleT, sol: this.sol, ang: this.lv?.elems.map((e) => e.a) });
    w.__auraLevel = (i: number) => this.loadLevel(i);
    w.__auraAudio = () => ({ ...aa.state(), peak: aa.peak() });
    w.__auraInfo = () => ({ geometries: this.world.renderer.info.memory.geometries, textures: this.world.renderer.info.memory.textures, programs: this.world.renderer.info.programs?.length ?? 0, children: this.elemGroup.children.length + this.srcGroup.children.length, listeners: this.cleanupFuncs.length });
    w.__auraSolve = () => {
      if (!this.sol) return;
      const r = this.rotIdx();
      r.forEach((ei, k) => (this.lv.elems[ei].a = (this.sol as number[])[k]));
      this.dirty = true;
    };
    w.__auraScreen = (x: number, y: number) => {
      const v = new Vector3(x * S, BY + y * S, BZ + 0.03).project(this.world.camera);
      return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
    };
    w.__auraElems = () => this.lv.elems.map((e) => ({ k: e.kind, x: e.x, y: e.y, a: e.a, rot: e.rot }));
    w.__auraPress = (id: number) => this.press(id);
    // thread board hooks (tests): state, node screen positions, fixed-step simulation, assisted weaving
    w.__auraThread = () => {
      const pl = this.tp;
      if (!pl) return null;
      return { era: pl.s.era, eras: pl.w.eras, threads: pl.s.threads.map((t) => [t.a, t.b, t.era]), held: pl.s.held.slice(), solved: pl.ev.solved, receivers: pl.ev.receiverOk.filter((ok, i) => pl.w.nodes[i].kind === 'receiver' && ok).length, recording: pl.recording, echoes: pl.echoes.length, moves: pl.moves, hint: pl.hint(), board: this.board.pointerEvents };
    };
    w.__auraNodeScreen = (i: number) => {
      if (!this.tp) return null;
      const p = nodePos(this.tp.w, i);
      const v = new Vector3(p.x, p.y, 0.034);
      this.root.localToWorld(v).project(this.world.camera);
      return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
    };
    w.__auraStep = (n: number, dt = 1 / 30) => {
      for (let k = 0; k < n; k++) this.simStep(dt);
    };
    w.__auraWeave = (max = 40) => {
      const pl = this.tp;
      if (!pl) return false;
      for (let k = 0; k < max && !pl.ev.solved; k++) {
        if (!pl.autoStep()) break;
        this.simStep(0.1);
      }
      this.simStep(0);
      return pl.ev.solved;
    };
    w.__auraWipe = () => {
      this.save = defaultSave(this.puzzles.length);
      this.persist();
    };

    this.setVisible(false);
    this.restore = this.save.solved.filter(Boolean).length / this.puzzles.length;
  }

  private chapterIdx(): number {
    return this.pz ? this.pz.world : 0;
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
    const rays = new Mesh(new PlaneGeometry(0.34, 0.34), new MeshBasicMaterial({ map: rayTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    rays.position.z = -0.008;
    g.add(rays, runes, disc, crystal, label.mesh);
    g.visible = false;
    this.root.add(g);
    return { g, crystal, mat, runes, disc, discMat, label, rays, fill: 0, awake: false, impure: false, lastGot: 0 };
  }

  private buildSanctuary(): void {
    // ledge + lotus garden, fractal ferns and crystal spires below the board: the world that wakes up
    const ledge = new Mesh(new BoxGeometry(1.24, 0.03, 0.22), new MeshStandardMaterial({ color: 0x0b0a14, roughness: 0.3, metalness: 0.85, emissive: 0x15103a, emissiveIntensity: 0.6 }));
    ledge.position.set(0, -BH / 2 - 0.06, 0.12);
    this.root.add(ledge);
    // gold trim and a soft glow strip along the ledge front: a jewel-box finish
    const gold = new MeshStandardMaterial({ color: 0xe8b84a, roughness: 0.25, metalness: 1, emissive: 0x5a3d08, emissiveIntensity: 0.35 });
    const rail = new Mesh(new BoxGeometry(1.24, 0.006, 0.01), gold);
    rail.position.set(0, -BH / 2 - 0.043, 0.232);
    this.root.add(rail);
    const rail2 = new Mesh(new BoxGeometry(1.24, 0.004, 0.01), gold);
    rail2.position.set(0, -BH / 2 - 0.077, 0.232);
    this.root.add(rail2);
    const strip = new Mesh(new BoxGeometry(1.2, 0.012, 0.004), new MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    strip.position.set(0, -BH / 2 - 0.06, 0.2325);
    this.root.add(strip);
    const n = this.puzzles.length;
    for (let i = 0; i < n; i++) {
      const x = -0.5 + (i / (n - 1)) * 1.0;
      const lo = makeLotus(0.5 + i * 0.035, 3);
      lo.group.position.set(x, -BH / 2 - 0.035, 0.16);
      lo.group.scale.setScalar(0.7);
      this.root.add(lo.group);
      this.lotus.push(lo);
      const fr = makeFractal(0.3 + i * 0.025, 11 + i * 7);
      fr.lines.position.set(x + 0.03, -BH / 2 - 0.045, 0.09);
      fr.lines.scale.setScalar(0.6);
      fr.lines.visible = false;
      fr.setGrow(1);
      this.root.add(fr.lines);
      this.ferns.push(fr);
    }
    // crystal spires: one instanced mesh, per-instance glow
    const NC = 16;
    // smooth crystal capsules (lanterns) instead of spiky cones, each on a small gold base
    const cg = new CapsuleGeometry(0.012, 0.04, 4, 14);
    const baseGeo = new CylinderGeometry(0.02, 0.026, 0.008, 18);
    const glow = new InstancedBufferAttribute(new Float32Array(NC), 1);
    cg.setAttribute('aGlow', glow);
    const cm = makeCrystalMaterial(0x5a54c8, 0xa8ecff, 0.7);
    this.crystals = new InstancedMesh(cg, cm, NC);
    const m4 = new Matrix4();
    const p = new Vector3();
    const s = new Vector3();
    const q = new Mesh().quaternion;
    for (let i = 0; i < NC; i++) {
      const x = -0.56 + (i / (NC - 1)) * 1.12;
      s.set(1, 0.85 + ((i * 7) % 5) * 0.14, 1);
      p.set(x, -BH / 2 - 0.044 + (s.y * 0.064) / 2 + 0.01, 0.19);
      const base = new Mesh(baseGeo, gold);
      base.position.set(x, -BH / 2 - 0.041, 0.19);
      this.root.add(base);
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
    this.level = Math.max(0, Math.min(this.puzzles.length - 1, i));
    if (this.finaleT >= 0) {
      this.finaleT = -1;
      this.applyComposition();
    }
    this.puzzles = makePuzzles(); // fresh angles and ring positions every load
    this.pz = this.puzzles[this.level];
    const pz = this.pz;
    this.lv = pz.light ?? { name: pz.name, chapter: WORLDS[pz.world].name, goal: pz.goal, hint: pz.hint, sources: [], elems: [], targets: [] };
    this.startAng = this.lv.elems.map((e) => e.a);
    this.sol = pz.light ? (solve(this.lv, 1)[0] ?? null) : null;
    // thread board (if this puzzle has one): relaxed difficulty lets threads stretch further
    if (this.tp) this.tp.cancel();
    const st = this.save.settings;
    this.tp = pz.weave ? new ThreadPlay(pz.weave, AIM_R[st.aim] ?? AIM_R[1], st.difficulty === 0 ? 0.15 : 0) : null;
    this.tview.bind(this.tp);
    this.boardPids.clear();
    this.hintT = 0;
    this.hintsUsed = 0;
    this.puzzleT = 0;
    this.threadLevels();
    this.refreshHint();
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
    this.restore = this.save.solved.filter(Boolean).length / this.puzzles.length;
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
    if (!v && this.tp) {
      this.tp.cancel();
      this.boardPids.clear();
    }
    this.hud.mesh.visible = v;
    this.compass.mesh.visible = v;
    for (const b of this.btns) b.mesh.visible = v;
    this.syncPanels();
  }
  private menuSlots(): number {
    return this.screen === 'title' ? 4 : this.screen === 'chapters' ? 6 : this.screen === 'settings' || this.paused ? 12 : 0;
  }
  private syncPanels(): void {
    const on = modeState.mode === 'aura';
    const game = this.screen === 'game';
    this.hud.mesh.visible = on && game && !this.photo && !this.paused;
    this.compass.mesh.visible = on && !this.photo;
    this.card.mesh.visible = on && !this.photo && (this.screen === 'title' || this.screen === 'chapters' || (game && (this.completeT > 2.2 || this.finaleT > 6)));
    const n = on && !this.photo ? this.menuSlots() : 0;
    const row = this.screen === 'title' || this.screen === 'chapters';
    this.setBtns.forEach((b, i) => {
      b.mesh.visible = i < n;
      if (row) b.mesh.position.set(ROW_X + (i - (n - 1) / 2) * BTN_STEP, 0.64, -0.5);
      else b.mesh.position.set(i % 2 ? 0.15 : -0.15, 1.4 - Math.floor(i / 2) * 0.115, -0.5);
      b.mesh.rotation.x = row ? -0.9 : -0.2;
    });
    this.btns.forEach((b, i) => (b.mesh.visible = on && game && (!this.photo || i < 3)));
    this.threadBtns.forEach((b, i) => (b.mesh.visible = on && game && !this.photo && !!this.tp && (i === 1 || this.tp.w.eras === 2)));
  }

  // ================================================================ actions
  private cycle(v: number): number {
    const k = Math.round(v * 4);
    return ((k + 1) % 5) / 4;
  }
  private press(id: number): void {
    if (this.photo) {
      if (id === 0) this.shotPending = true;
      else if (id === 1) {
        this.comp = (this.comp + 1) % 3;
        this.applyComposition();
      } else if (id === 2) this.setPhoto(false);
      return;
    }
    if (id === ID_ERA || id === ID_HINT) {
      if (this.screen !== 'game' || this.paused || !this.tp) return;
      if (id === ID_ERA) {
        if (this.tp.w.eras !== 2) return;
        this.boardPids.clear();
        this.tp.toggleEra();
      } else {
        this.hintT = 8;
        this.hintsUsed++;
        this.refreshHint();
        const h = this.tp.hint();
        this.msg = h.kind === 'era' ? 'Hint: weave in the ' + (h.era === 1 ? 'past' : 'present') : h.kind === 'ring' ? 'Hint: turn the glowing ring' : h.kind === 'record' ? 'Hint: tap the memory crystal, hold the keystone, let go' : h.kind === 'hold' ? 'Hint: hold the glowing keystone' : h.kind === 'cut' ? 'Hint: tap the ember-guided thread to cut it' : h.kind === 'charge' ? 'Hint: bring energy to the glowing crystal' : h.kind === 'none' ? 'Nothing left to weave' : 'Hint: follow the golden guide';
        this.msgT = 5;
      }
      this.idle = 0;
      this.drainPlay();
      this.drawBtns();
      this.hudDirty = true;
      return;
    }
    if (id >= 4) {
      const slot = id - 4;
      if (slot >= this.menuSlots()) return;
      if (this.screen === 'title') this.pressTitle(slot);
      else if (this.screen === 'chapters') this.pressChapter(slot);
      else this.pressSetting(slot);
      this.persist();
      this.drawBtns();
      this.drawMenu();
      this.syncPanels();
      return;
    }
    if (this.screen !== 'game') return;
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
      if (this.paused && this.tp) {
        this.tp.cancel();
        this.boardPids.clear();
      }
    }
    this.persist();
    this.drawBtns();
    this.syncPanels();
  }
  private startLevel(i: number): void {
    this.screen = 'game';
    this.paused = false;
    this.loadLevel(i);
    this.hudDirty = true;
  }
  private pressTitle(slot: number): void {
    if (slot === 0) {
      let start = this.save.solved.findIndex((s) => !s);
      if (start < 0) start = this.puzzles.length - 1;
      this.startLevel(Math.min(start, this.save.unlocked));
    } else if (slot === 1) this.screen = 'chapters';
    else if (slot === 2) this.screen = 'settings';
    else if (slot === 3) {
      if (!this.confirmNew) {
        this.confirmNew = true;
        return;
      }
      this.confirmNew = false;
      const keep = this.save.settings;
      this.save = defaultSave(this.puzzles.length);
      this.save.settings = keep;
      this.restore = 0;
      this.restoreShown = 0;
      this.loadLevel(0);
    }
    if (slot !== 3) this.confirmNew = false;
  }
  private firstLevelOf(c: number): number {
    return Math.max(0, this.puzzles.findIndex((p) => p.world === c));
  }
  private pressChapter(slot: number): void {
    if (slot === 5) {
      this.screen = 'title';
      return;
    }
    const li = this.firstLevelOf(slot);
    if (li > this.save.unlocked) {
      aa.impure();
      return;
    }
    this.startLevel(li);
  }
  private pressSetting(slot: number): void {
    const st = this.save.settings;
    if (slot === 0) this.setVol(this.cycle(getMasterVolume()));
    else if (slot === 1) {
      st.music = this.cycle(st.music);
      setMusicVolume(st.music);
    } else if (slot === 2) {
      st.sfx = this.cycle(st.sfx);
      setSfxVolume(st.sfx);
    } else if (slot === 3) {
      st.muted = !st.muted;
      setMuted(st.muted);
    } else if (slot === 4) {
      quality.manual = true;
      quality.tier = (quality.tier + 3) % 4;
    } else if (slot === 5) st.reducedMotion = !st.reducedMotion;
    else if (slot === 6) st.reducedFlash = !st.reducedFlash;
    else if (slot === 7) {
      st.labels = !st.labels;
      this.gates.forEach((gv, k) => this.lv.targets[k] && this.drawLabel(gv.label, MASK_LETTER[this.lv.targets[k].mask & 7], MASK_HEX[this.lv.targets[k].mask & 7]));
    } else if (slot === 8) st.wisps = !st.wisps;
    else if (slot === 9) st.tutorial = !st.tutorial;
    else if (slot === 10) {
      if (this.screen === 'game') {
        this.paused = false;
        this.setPhoto(true);
      }
    } else if (slot === 11) {
      if (this.screen === 'settings') this.screen = 'title';
      else this.paused = false;
    }
    this.hudDirty = true;
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
      this.root.scale.setScalar(S);
      this.root.position.set(0, BY, BZ);
      this.root.rotation.y = 0;
    } else if (c === 1) {
      this.root.scale.setScalar(S * 1.2);
      this.root.position.set(0, BY - 0.05, BZ + 0.15);
      this.root.rotation.y = 0;
    } else {
      this.root.scale.setScalar(S);
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
        aa.click();
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
    const bx = (pt.pos.x - this.root.position.x) / this.root.scale.x;
    const by = (pt.pos.y - this.root.position.y) / this.root.scale.x;
    if (pt.down && !pt.was && !this.paused && !this.photo) {
      const g = this.nearest(bx, by, PICK_R);
      if (g >= 0 && this.lightTakes(bx, by)) {
        pt.grab = g;
        pt.t0 = this.time;
        pt.sx = bx;
        pt.sy = by;
        pt.moved = false;
        this.sel = g;
        aa.grab();
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
        this.screen = 'title';
        this.confirmNew = false;
        this.finaleT = -1;
        this.applyComposition();
        this.save.stats.plays++;
        let start = this.save.solved.findIndex((s) => !s);
        if (start < 0) start = this.puzzles.length - 1;
        this.loadLevel(Math.min(start, this.save.unlocked));
        this.drawMenu();
      } else {
        aa.beams(0, 0, 0, 0);
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
    if (this.screen === 'game') {
      for (const pt of this.pointers) this.updatePointer(pt);
      this.updateHover();
    }

    this.simStep(dt);
    this.syncPointerTargets();
    if (this.tp) {
      const o = this.tviewOpts;
      o.reducedMotion = reduced;
      o.reducedFlash = this.save.settings.reducedFlash;
      o.highContrast = this.save.settings.highContrast;
      if (this.hintT > 0) this.hintT -= dt;
      // automatic hints follow the wisp rules: never in challenge mode, sooner in the tutorial
      const auto = this.save.settings.wisps && this.save.settings.difficulty < 2 && this.idle > (this.save.settings.tutorial && this.level === 0 ? 6 : this.save.settings.difficulty === 0 ? 10 : 18);
      o.hintOn = !this.paused && (this.hintT > 0 || auto) && !this.tp.ev.solved;
      this.tview.sync(this.time, dt, o);
    }
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

  // ================================================================ thread board
  /** Simulation step shared by the frame loop and the fixed-step test hook. */
  private simStep(dt: number): void {
    if (this.tp) {
      if (dt > 0) this.tp.tick(dt);
      this.drainPlay();
    }
    if (this.dirty) this.retrace();
    this.updateGates(dt);
    if (this.screen === 'game' && this.completeT < 0) this.puzzleT += dt;
  }
  private totalMoves(): number {
    return this.moves + (this.tp ? this.tp.moves : 0);
  }
  /** Is a light element (mirror/prism) the better target for a press at this board point than a thread crystal? */
  private lightTakes(bx: number, by: number): boolean {
    const e = this.nearest(bx, by, PICK_R);
    if (e < 0) return false;
    if (!this.tp) return true;
    const n = this.tp.nearestNode(bx, by);
    if (n < 0) return true;
    const el = this.lv.elems[e];
    const p = nodePos(this.tp.w, n, this.nodeP);
    return Math.hypot(el.x - bx, el.y - by) < Math.hypot(p.x - bx, p.y - by);
  }
  private nodeP = { x: 0, y: 0 };
  private boardActive(): boolean {
    return modeState.mode === 'aura' && this.screen === 'game' && !!this.tp && !this.paused && !this.photo && this.finaleT < 0;
  }
  /**
   * Hidden menu panels must not swallow rays meant for the loom (pointer hits ignore visibility), and the loom must not
   * catch rays outside a thread puzzle. Writes only when a value changes; no allocation.
   */
  private syncPointerTargets(): void {
    for (let i = 0; i < this.uiMeshes.length; i++) {
      const m = this.uiMeshes[i];
      const want = m.visible ? 'auto' : 'none';
      if (m.pointerEvents !== want) m.pointerEvents = want;
    }
    const want = this.boardActive() ? 'auto' : 'none';
    if (this.board.pointerEvents !== want) this.board.pointerEvents = want;
  }
  /** Pointer events on the loom plane (mouse, XR controller rays, hand pointers) drive the thread controller. */
  private initBoardInput(): void {
    type PE = { point: Vector3; pointerId: number };
    const toBoard = (e: PE): void => {
      this.boardV.copy(e.point);
      this.root.worldToLocal(this.boardV);
    };
    const down = (ev: unknown): void => {
      const e = ev as PE;
      if (!this.boardActive() || !this.tp) return;
      toBoard(e);
      const x = this.boardV.x;
      const y = this.boardV.y;
      if (this.lightTakes(x, y)) return;
      this.tp.trackPointer(e.pointerId, x, y, true);
      if (this.tp.down(e.pointerId, x, y)) {
        this.boardPids.add(e.pointerId);
        try {
          this.board.setPointerCapture(e.pointerId);
        } catch {
          /* capture is optional: the plane is larger than the loom */
        }
        this.idle = 0;
        this.drainPlay();
      }
    };
    const move = (ev: unknown): void => {
      const e = ev as PE;
      if (!this.tp) return;
      toBoard(e);
      const held = this.boardPids.has(e.pointerId);
      this.tp.trackPointer(e.pointerId, this.boardV.x, this.boardV.y, held);
      if (!held) return;
      this.tp.move(e.pointerId, this.boardV.x, this.boardV.y);
      this.drainPlay();
    };
    const up = (ev: unknown): void => {
      const e = ev as PE;
      if (!this.tp || !this.boardPids.has(e.pointerId)) return;
      toBoard(e);
      this.boardPids.delete(e.pointerId);
      this.tp.trackPointer(e.pointerId, this.boardV.x, this.boardV.y, false);
      this.tp.up(e.pointerId, this.boardV.x, this.boardV.y);
      try {
        this.board.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.idle = 0;
      this.drainPlay();
    };
    const b = this.board as unknown as { addEventListener(t: string, f: (e: unknown) => void): void; removeEventListener(t: string, f: (e: unknown) => void): void };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    this.cleanupFuncs.push(() => {
      b.removeEventListener('pointerdown', down);
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
    });
  }
  /** Route queued controller events to audio, haptics, save stats and HUD. Event-driven: allocates only on events. */
  private drainPlay(): void {
    const pl = this.tp;
    if (!pl || pl.events.length === 0) return;
    for (let i = 0; i < pl.events.length; i++) this.onPlayEvent(pl.events[i], pl);
    pl.events.length = 0;
    this.threadLevels();
    this.refreshHint();
    this.drawBtns();
    this.hudDirty = true;
  }
  private panOf(pl: ThreadPlay, node: number): number {
    if (node < 0) return 0;
    return nodePos(pl.w, node, this.nodeP).x / 0.6;
  }
  private onPlayEvent(e: PlayEvent, pl: ThreadPlay): void {
    const st = this.save.stats;
    const say = (m: string, t = 3.5): void => {
      this.msg = m;
      this.msgT = t;
    };
    switch (e.t) {
      case 'grab':
        aa.pan(this.panOf(pl, e.node), () => aa.grab());
        this.buzz(10);
        break;
      case 'connect': {
        const p = nodePos(pl.w, e.b, this.nodeP);
        const m = pl.ev.mask[pl.s.era - 1][e.a] || 7;
        // pitch rises with tension: a taut thread rings higher
        aa.pan(p.x / 0.6, () => aa.tick(Math.round(e.len * 8)));
        this.ripple.fire(p.x, p.y, 0, 0.25, MASK_HEX[m & 7]);
        this.buzz(18);
        st.threads++;
        break;
      }
      case 'refuse':
        aa.pan(this.panOf(pl, e.a), () => aa.impure());
        say(REFUSE_TEXT[e.reason] ?? 'That thread cannot be woven');
        break;
      case 'cut':
        aa.pan(this.panOf(pl, e.a), () => aa.cut());
        this.buzz(14);
        break;
      case 'snap':
        aa.pan(this.panOf(pl, e.a), () => aa.impure());
        say('A thread snapped: the ring carried a crystal out of reach');
        break;
      case 'hold':
      case 'echoHold':
        aa.pan(this.panOf(pl, e.node), () => aa.tick(e.node));
        break;
      case 'ring':
        aa.tick(e.step);
        this.buzz(12);
        break;
      case 'ringLocked':
        aa.impure();
        say('This ring is locked: power its orbit engine first');
        break;
      case 'era':
        aa.whoosh();
        st.eraShifts++;
        say(e.era === 1 ? 'The past. Threads woven here shape the present' : 'The present', 2.5);
        break;
      case 'recStart':
        aa.chime();
        say('Recording an echo: hold a keystone, then let go', 4);
        break;
      case 'recStop':
        if (e.ok) {
          aa.pulse();
          st.echoes++;
          say('The echo remembers your hand', 3);
        } else aa.impure();
        break;
      case 'latch':
        aa.chime();
        say('The memory crystal remembers. Tap it to record an echo', 4);
        break;
      case 'receiver':
        if (e.on) {
          const p = nodePos(pl.w, e.node, this.nodeP);
          const m = pl.w.nodes[e.node].mask & 7;
          aa.pan(p.x / 0.6, () => aa.awaken(e.node % 3, this.chapterIdx()));
          this.ripple.fire(p.x, p.y, 0, 0.5, MASK_HEX[m]);
          celebrate(p.x * S, BY + p.y * S, BZ + 0.08, 1);
          this.buzz(40);
          st.connections++;
          st.hues[m]++;
          this.flash = this.save.settings.reducedFlash ? 0.3 : 1;
        }
        break;
      case 'align':
        if (e.on) aa.awaken(0, this.chapterIdx());
        break;
      case 'power':
      case 'release':
        break;
    }
  }
  /** Thread energy per colour feeds the same adaptive beam hum as the light puzzles. */
  private threadLevels(): void {
    const tl = this.threadLv;
    tl[0] = tl[1] = tl[2] = 0;
    const pl = this.tp;
    if (!pl) return;
    const ei = pl.s.era - 1;
    const all = pl.w.fixed.concat(pl.s.threads);
    for (const t of all) {
      if (t.era !== pl.s.era || !pl.ev.live[ei][t.a]) continue;
      const m = pl.ev.mask[ei][t.a];
      const p = nodePos(pl.w, t.a);
      const q = nodePos(pl.w, t.b);
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      if (m & CYAN) tl[0] += L;
      if (m & MAGENTA) tl[1] += L;
      if (m & GOLD) tl[2] += L;
    }
    for (let i = 0; i < 3; i++) tl[i] = Math.min(1, tl[i] / 1.1);
  }
  private refreshHint(): void {
    this.tview.setHint(this.tp ? this.tp.hint() : null);
  }

  private updateHover(): void {
    if (this.mouseSeen && !this.mouseDown && this.mousePoint(this.hoverPos)) {
      this.hover = this.nearest((this.hoverPos.x - this.root.position.x) / this.root.scale.x, (this.hoverPos.y - this.root.position.y) / this.root.scale.x, 0.09);
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
      // combined puzzles: an awake light gate feeds the thread source bound to it
      if (this.tp) this.tp.setLight(i, gv.awake);
    });
    // a puzzle is restored when every light gate is awake and every thread receiver / constellation is satisfied
    const done = all && (!this.tp || this.tp.ev.solved) && (this.lv.targets.length > 0 || !!this.tp);
    if (done && this.completeT < 0 && !this.paused) {
      this.completeT = 0;
    }
    if (this.completeT >= 0) {
      if (!done) this.completeT = -1;
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
      gv.mat.uniforms.uGlow.value = gv.awake ? 1.1 + 0.2 * Math.sin(this.time * 3 + i) : 0.28 + f * 0.9 + (gv.impure && !this.save.settings.reducedFlash ? 0.2 * Math.sin(this.time * 18) : 0);
      const c = gv.impure ? 0xffa040 : MASK_HEX[(gv.awake ? t.mask : gv.lastGot) & 7] || MASK_HEX[t.mask & 7];
      gv.discMat.color.setHex(c);
      gv.discMat.opacity = gv.awake ? 0.5 + 0.2 * Math.sin(this.time * 4) : f * 0.4 + (gv.lastGot ? 0.08 : 0);
      gv.runes.rotation.z += dt * (gv.awake ? 0.6 : 0.12) * (reduced ? 0.3 : 1);
      (gv.runes.material as MeshBasicMaterial).opacity = 0.32 + (gv.awake ? 0.5 : f * 0.35);
      const rm = gv.rays.material as MeshBasicMaterial;
      rm.opacity = tier === 0 ? 0 : (gv.awake ? 0.5 + (this.save.settings.reducedFlash ? 0 : 0.12 * Math.sin(this.time * 2 + i)) : f * 0.25) * (this.save.settings.reducedFlash ? 0.7 : 1);
      rm.color.setHex(MASK_HEX[t.mask & 7]);
      gv.rays.rotation.z += dt * (reduced ? 0.02 : 0.12);
      gv.rays.scale.setScalar(1 + (gv.awake ? 0.25 : 0));
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
      const target = i < lit ? 1 : 0.65;
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
    const wisp = this.save.settings.wisps && this.idle > (this.save.settings.tutorial && this.level === 0 ? 5 : 14) && !this.tr.solved;
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
          celebrate((-0.5 + (k / 5) * 1.0) * S, BY - (BH * S) / 2, BZ + 0.12, 2);
        }
      }
      for (const l of this.lotus) l.target = 1;
      this.restore = 1;
      if (before < 6 && this.finaleT >= 6) {
        this.drawCard();
        this.syncPanels();
      }
    }
    if (this.finaleT >= 0 && !this.photo) {
      const k = Math.min(1, this.finaleT / 9);
      const e = k * k * (3 - 2 * k);
      const amt = reduced ? 0.03 : 0.12;
      this.root.scale.setScalar(S * (1 + amt * e));
      this.root.position.z = BZ + amt * 1.2 * e;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2);
  }

  private updateAudio(): void {
    const flowNow = Math.min(1, this.beamLv[0] + this.beamLv[1] + this.beamLv[2] + this.threadLv[0] + this.threadLv[1] + this.threadLv[2]);
    aa.update(flowNow);
    if (this.paused) return;
    this.bend += ((this.sel >= 0 ? this.lv.elems[this.sel].a / stepsOf(this.lv.elems[this.sel]) : 0) - this.bend) * 0.1;
    const awakeN = this.gates.filter((g) => g.awake).length;
    const tl = this.threadLv;
    aa.beams(Math.min(1, this.beamLv[0] * (0.6 + 0.4 * (awakeN > 0 ? 1 : 0)) + tl[0]), Math.min(1, this.beamLv[1] + tl[1]), Math.min(1, this.beamLv[2] + tl[2]), this.bend);
  }

  // ================================================================ drawing (canvas panels)
  /** Aura button: dark glass pill, glowing accent rim, round icon badge on the left, big title and a short caption. */
  private pill(p: TextPanel, accent: string, glyph: string, title: string, sub: string, lit = true): void {
    const g = p.ctx;
    const W = p.w;
    const H = p.h;
    g.clearRect(0, 0, W, H);
    const r = H * 0.28;
    const path = (x: number, y: number, w: number, h: number): void => {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    };
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, lit ? 'rgba(46,34,104,0.96)' : 'rgba(26,24,50,0.94)');
    grad.addColorStop(1, lit ? 'rgba(14,12,46,0.96)' : 'rgba(14,14,32,0.94)');
    path(5, 5, W - 10, H - 10);
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = lit ? accent : 'rgba(150,160,200,0.45)';
    g.stroke();
    const cx = H * 0.5;
    const cy = H / 2;
    const cr = H * 0.31;
    g.beginPath();
    g.arc(cx + 4, cy, cr, 0, Math.PI * 2);
    g.fillStyle = lit ? accent : 'rgba(150,160,200,0.5)';
    g.globalAlpha = 0.28;
    g.fill();
    g.globalAlpha = 1;
    g.lineWidth = 4;
    g.strokeStyle = lit ? accent : 'rgba(150,160,200,0.6)';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = lit ? '#ffffff' : '#9aa4c4';
    g.font = '700 ' + Math.round(H * 0.34) + 'px ' + SERIF;
    g.fillText(glyph, cx + 4, cy + 2);
    const tx = H * 0.98;
    const maxW = W - tx - 26;
    g.textAlign = 'left';
    const fit = (txt: string, size: number, wt: string): void => {
      g.font = wt + ' ' + size + 'px ' + SERIF;
      const m = g.measureText(txt).width;
      if (m > maxW) g.font = wt + ' ' + Math.floor((size * maxW) / m) + 'px ' + SERIF;
    };
    fit(title, Math.round(H * 0.27), '700');
    g.fillStyle = lit ? '#fff3d0' : '#aab2d0';
    g.fillText(title, tx, H * 0.38);
    fit(sub, Math.round(H * 0.2), '600');
    g.fillStyle = lit ? accent : '#8a93b8';
    g.fillText(sub, tx, H * 0.7);
    g.textBaseline = 'alphabetic';
  }

  private drawBtns(): void {
    const solved = this.save.solved[this.level] || this.level < this.save.unlocked;
    const labels: [string, string, string, string][] = this.photo
      ? [['SHOT', 'Save photo', '\u25cf', '#ff9bd0'], ['FRAME', 'View ' + (this.comp + 1) + ' of 3', '\u25a3', '#ffd36b'], ['EXIT', 'Leave photo mode', '\u2715', '#9fc2ff'], ['', '', '', '#9fc2ff']]
      : [
          ['BACK', 'Previous puzzle', '\u25c0', '#6fe8ff'],
          ['RETRY', 'Reset puzzle', '\u21ba', '#ffd36b'],
          ['NEXT', solved ? 'Next puzzle' : 'Locked', '\u25b6', solved ? '#8dffc2' : '#8a93b8'],
          [this.paused ? 'RESUME' : 'PAUSE', 'Settings', this.paused ? '\u25b6' : '\u275a\u275a', '#c9a8ff'],
        ];
    this.btns.forEach((p, i) => {
      const [t, sub, gl, ac] = labels[i];
      this.pill(p, ac, gl, t, sub, !(i === 2 && !solved && !this.photo));
      p.commit();
      p.mesh.visible = modeState.mode === 'aura' && this.screen === 'game' && !(this.photo && i === 3);
    });
    this.threadBtns.forEach((p, i) => {
      const past = !!this.tp && this.tp.s.era === 1;
      if (i === 0) this.pill(p, past ? '#ffb060' : '#6fe8ff', past ? '\u25d1' : '\u25d0', 'ERA', past ? 'Past' : 'Present');
      else this.pill(p, '#ffe08a', '\u2726', 'HINT', 'Show a step');
      p.commit();
    });
    this.setBtns.forEach((p, i) => {
      const [a, b] = this.slotText(i);
      const menuRow = this.screen === 'chapters' || this.screen === 'title';
      const locked = this.screen === 'chapters' && b === 'Locked';
      const accent = menuRow ? (this.screen === 'chapters' ? (b === 'Restored' ? '#8dffc2' : '#6fe8ff') : ['#ffd36b', '#6fe8ff', '#c9a8ff', '#ff8aa8'][i] ?? '#6fe8ff') : '#c9a8ff';
      const glyph = this.screen === 'title' ? ['\u25b6', '\u2756', '\u2699', '\u21ba'][i] : this.screen === 'chapters' ? (i < 5 ? String(i + 1) : '\u25c0') : ['\u266a', '\u266b', '\u2726', '\u2715', '\u25c8', '\u223f', '\u26a1', '\u25cf', '\u2735', '\u2139', '\u25a3', '\u25c0'][i] ?? '\u2726';
      this.pill(p, accent, glyph, a, b, !locked);
      p.commit();
    });
  }

  private slotText(i: number): [string, string] {
    const st = this.save.settings;
    const pct = (v: number): string => Math.round(v * 100) + '%';
    if (this.screen === 'title') {
      const started = this.save.solved.some(Boolean);
      return ([
        [started ? 'CONTINUE' : 'START', started ? 'Resume weaving' : 'Begin weaving'],
        ['CHAPTERS', 'Choose a world'],
        ['SETTINGS', 'Sound and comfort'],
        ['NEW GAME', this.confirmNew ? 'Press again to erase' : 'Erase progress'],
      ] as [string, string][])[i] ?? ['', ''];
    }
    if (this.screen === 'chapters') {
      if (i === 5) return ['BACK', 'Title'];
      if (i > 4) return ['', ''];
      const li = this.firstLevelOf(i);
      const locked = li > this.save.unlocked;
      const done = this.puzzles.every((p, k) => p.world !== i || this.save.solved[k]);
      return ['CHAPTER ' + (i + 1), locked ? 'Locked' : done ? 'Restored' : 'Open'];
    }
    return ([
      ['MASTER', st.muted ? 'Muted' : pct(getMasterVolume())],
      ['MUSIC', pct(st.music)],
      ['EFFECTS', pct(st.sfx)],
      ['MUTE', st.muted ? 'On' : 'Off'],
      ['QUALITY', ['Low', 'Medium', 'High', 'Ultra'][quality.tier]],
      ['MOTION', st.reducedMotion ? 'Reduced' : 'Full'],
      ['FLASHES', st.reducedFlash ? 'Reduced' : 'Normal'],
      ['COLOUR LABELS', st.labels ? 'On' : 'Off'],
      ['GUIDING WISPS', st.wisps ? 'On' : 'Off'],
      ['TUTORIAL', st.tutorial ? 'On' : 'Off'],
      ['PHOTO MODE', this.screen === 'game' ? 'Hide HUD' : 'In puzzle only'],
      [this.screen === 'settings' ? 'BACK' : 'RESUME', this.screen === 'settings' ? 'Title' : 'Back to puzzle'],
    ] as [string, string][])[i] ?? ['', ''];
  }

  /** Frosted glass card with a gradient rim: the base of the title, chapter and completion panels. */
  private glass(c: TextPanel, rim: string): void {
    const g = c.ctx;
    g.clearRect(0, 0, c.w, c.h);
    const r = 46;
    g.beginPath();
    g.moveTo(r, 4);
    g.arcTo(c.w - 4, 4, c.w - 4, c.h - 4, r);
    g.arcTo(c.w - 4, c.h - 4, 4, c.h - 4, r);
    g.arcTo(4, c.h - 4, 4, 4, r);
    g.arcTo(4, 4, c.w - 4, 4, r);
    g.closePath();
    const bg = g.createLinearGradient(0, 0, 0, c.h);
    bg.addColorStop(0, 'rgba(30,22,84,0.95)');
    bg.addColorStop(1, 'rgba(6,5,26,0.96)');
    g.fillStyle = bg;
    g.fill();
    const edge = g.createLinearGradient(0, 0, c.w, c.h);
    edge.addColorStop(0, rim);
    edge.addColorStop(0.5, '#b48cff');
    edge.addColorStop(1, '#6fe8ff');
    g.lineWidth = 8;
    g.strokeStyle = edge;
    g.stroke();
  }

  /** Title and chapter-select card (the same panel the completion card uses). */
  private drawMenu(): void {
    if (this.screen === 'game') return;
    const c = this.card;
    const g = c.ctx;
    this.glass(c, '#ffd36b');
    g.textAlign = 'center';
    if (this.screen === 'title') {
      g.fillStyle = '#ffe9b0';
      g.font = '700 118px ' + SERIF;
      g.fillText('AURA WEAVER', c.w / 2, 190);
      g.fillStyle = '#8fd8ff';
      g.font = '600 40px ' + SERIF;
      g.fillText('T H E   L I G H T   S A N C T U A R Y', c.w / 2, 262);
      g.strokeStyle = 'rgba(180,140,255,0.6)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(c.w * 0.25, 305);
      g.lineTo(c.w * 0.75, 305);
      g.stroke();
      g.fillStyle = '#e6f0ff';
      g.font = 'italic 46px ' + SERIF;
      g.fillText('A sanctuary has lost its light.', c.w / 2, 400);
      g.fillText('Weave threads. Turn mirrors and prisms.', c.w / 2, 468);
      g.fillText('Wake the monoliths and bring it back to life.', c.w / 2, 536);
      const n = this.save.solved.filter(Boolean).length;
      g.font = '700 38px ' + SERIF;
      g.fillStyle = '#ffd36b';
      g.fillText(n ? 'Sanctuary ' + Math.round((n / this.puzzles.length) * 100) + '% restored' : 'Pinch or point and pull  -  ' + this.puzzles.length + ' puzzles, 5 worlds', c.w / 2, 660);
    } else {
      g.fillStyle = '#ffe9b0';
      g.font = '700 92px ' + SERIF;
      g.fillText('CHAPTERS', c.w / 2, 140);
      g.font = '700 46px ' + SERIF;
      WORLDS.forEach(({ name: nm }, i) => {
        const locked = this.firstLevelOf(i) > this.save.unlocked;
        const y = 250 + i * 100;
        g.fillStyle = locked ? 'rgba(40,44,80,0.6)' : 'rgba(60,50,130,0.55)';
        g.fillRect(110, y - 54, c.w - 220, 80);
        g.fillStyle = locked ? '#6b7499' : '#ffd36b';
        g.textAlign = 'left';
        g.fillText(String(i + 1), 150, y);
        g.fillStyle = locked ? '#6b7499' : '#eaf2ff';
        g.fillText(nm, 230, y);
        g.textAlign = 'right';
        g.font = '600 36px ' + SERIF;
        g.fillText(locked ? 'locked' : '', c.w - 150, y);
        g.font = '700 46px ' + SERIF;
        g.textAlign = 'center';
      });
    }
    c.commit();
  }

  private drawHud(): void {
    const h = this.hud;
    const lv = this.lv;
    if (!lv) return;
    this.glass(h, '#6fe8ff');
    const pz = this.pz;
    const pl = this.tp;
    const done = (this.tr?.solved ?? true) && (!pl || pl.ev.solved);
    h.text(WORLDS[pz.world].short.toUpperCase() + '   -   ' + pz.name, 46, 34, '#8fd8ff');
    h.text(pz.goal, 102, 44, done ? '#8dffc2' : '#ffe6a8');
    let tip = 'Hint: ' + pz.hint;
    if (this.save.settings.tutorial && !this.save.solved[this.level]) {
      if (pl && pl.recording) tip = 'Recording an echo (' + pl.recordLeft.toFixed(1) + 's): hold a keystone, then let go';
      else if (pl && this.level === 0) tip = pl.moves === 0 ? 'Pinch or click the bright crystal, pull to the dark one, let go' : 'Tap a thread to cut it. Threads have a maximum reach';
      else if (!pl && this.moves === 0 && this.lv.elems.some((e) => e.rot)) tip = 'Pinch the ringed mirror and swing it (mouse: drag; keys: Tab, arrows)';
    }
    const hint = this.msgT > 0 ? this.msg : this.save.solved[this.level] ? 'Sanctuary ' + Math.round(this.restore * 100) + '% restored - NEXT continues' : tip;
    h.text(hint, 156, 30, this.msgT > 0 ? '#8dffc2' : '#c8d6f8');
    let info = '';
    if (lv.targets.length) info += 'Gates: ' + lv.targets.map((t) => MASK_NAME[t.mask & 7]).join('  ') + '     ';
    if (pl) {
      const rc = pl.w.nodes.filter((n) => n.kind === 'receiver').length;
      const ok = pl.ev.receiverOk.filter((v, i) => v && pl.w.nodes[i].kind === 'receiver').length;
      info += 'Crystals ' + ok + '/' + rc + '     ';
      if (pl.w.eras === 2) info += (pl.s.era === 1 ? 'PAST' : 'PRESENT') + ' (E)     ';
      if (pl.echoes.length) info += 'Echoes ' + pl.echoes.length + '     ';
    }
    h.text(info + 'Moves ' + this.totalMoves(), 210, 28, '#9fc2ff');
    h.commit();
  }

  private drawCompass(): void {
    const c = this.compass;
    const g = c.ctx;
    const W = c.w;
    const cx = W / 2;
    const f = W / 384;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(6,5,20,0.7)';
    g.beginPath();
    g.arc(cx, cx, cx - 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(180,140,255,0.7)';
    g.stroke();
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
    ring(cx - 16 * f, this.restore, '#ffd36b', 10 * f);
    ring(cx - 38 * f, pure, '#6fe8ff', 8 * f);
    ring(cx - 58 * f, awake / gates, '#b48cff', 8 * f);
    g.fillStyle = '#eef4ff';
    g.textAlign = 'center';
    g.font = '700 ' + Math.round(54 * f) + 'px ' + SERIF;
    g.fillText(String(Math.round(this.restore * 100)) + '%', cx, cx + 4 * f);
    g.font = '700 ' + Math.round(22 * f) + 'px ' + SERIF;
    g.fillStyle = '#9fc2ff';
    g.fillText('CHAPTER ' + (this.chapterIdx() + 1), cx, cx + 38 * f);
    g.fillText('PURITY ' + Math.round(pure * 100) + '%', cx, cx + 64 * f);
    c.commit();
  }

  private drawCard(): void {
    const c = this.card;
    const g = c.ctx;
    const finished = this.save.solved.every(Boolean);
    this.glass(c, finished ? '#ffd36b' : '#6fe8ff');
    g.textAlign = 'center';
    g.fillStyle = '#ffe9b0';
    g.font = '700 ' + (finished ? 118 : 96) + 'px ' + SERIF;
    g.fillText(finished ? 'AURA WEAVER' : 'AWAKENED', c.w / 2, 150);
    g.font = 'italic 50px ' + SERIF;
    g.fillStyle = '#e6f0ff';
    g.fillText(finished ? 'I did not just play this world. I brought it to life.' : this.pz.name + '  -  ' + this.totalMoves() + ' moves', c.w / 2, 232);
    // the living signature: a rose curve built from how you played
    const hs = this.save.stats.hues;
    const tot = Math.max(1, hs.reduce((a, b) => a + b, 0));
    const cx = c.w / 2;
    const cy = c.h * 0.6;
    const k = 3 + (this.save.stats.connections % 5);
    for (let m = 1; m < 8; m++) {
      if (!hs[m] && finished === false && m !== 1) continue;
      const share = (hs[m] || 1) / tot;
      g.strokeStyle = '#' + MASK_HEX[m].toString(16).padStart(6, '0');
      g.globalAlpha = 0.4 + share * 1.6;
      g.lineWidth = 4;
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.03) {
        const r = (70 + 40 * Math.sin(k * a + m)) * (0.5 + share * 2) * (0.7 + 0.05 * m);
        const x = cx + Math.cos(a + m * 0.4) * Math.min(200, r * 1.6);
        const y = cy + Math.sin(a + m * 0.4) * Math.min(200, r * 1.6) * 0.85;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.font = '700 42px ' + SERIF;
    g.fillStyle = '#8fd8ff';
    g.fillText('Connections ' + this.save.stats.connections + '     Turns ' + this.save.stats.moves, c.w / 2, c.h - 56);
    c.commit();
  }
}

void PRISM_STEPS;
void MIRROR_STEPS;
