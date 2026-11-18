import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Entity,
  FogExp2,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Pressed,
  Quaternion,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { getMasterVolume, setMasterVolume, setMuted, setMusicVolume, setSfxVolume, sfx, musicState, isMuted } from './audio.js';
import { modeState, spellRoom } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { SfOpt } from './ui-components.js';
import { GestureEngine } from './sfgesture.js';
import type { GestureOut, HandFrame, Head, Side, V3 } from './sfgesture.js';
import { ADV_CASTS, SpellCaster } from './sfcast.js';
import type { CastEvent, CastView } from './sfcast.js';
import { ARENA_Z, Battle, PLAYER_HEAD, SHIELD_HP } from './sfbattle.js';
import type { Area, BEvent, BattleMode, Enemy, Proj, Ring } from './sfbattle.js';
import { BOSSES, BOSS_ORDER, ELEMENTS, ELEMENT_CSS, ELEMENT_HEX, ELEMENT_NAME, ENEMIES, FUSIONS, REALMS } from './sfdata.js';
import type { Element, SpellDef } from './sfdata.js';
import { defaultSfSave, loadSfSave, writeSfSave } from './sfsave.js';
import type { SfSave } from './sfsave.js';
import { CARD_H, CARD_PX, CARD_W, CREDITS, LETTER, LIB_PER_PAGE, BEST_PER_PAGE, bestiaryEntries, drawBestiary, drawButton, drawCard, drawLibrary, drawTitleArt, libraryEntries, libraryPages, line, para, pill, rr, elementDot } from './sfscreens.js';
import { Arena, THEMES, buildBoss, buildEnemy } from './sfworld.js';
import type { RealmId, Rig } from './sfworld.js';
import type { BossRig, Emitter } from './sfboss.js';
import { sfAudio } from './sfaudio.js';
import { Sparks, glowSprite, sigilTexture } from './sfvfx.js';

// ================================================================== constants
type Screen = 'title' | 'modes' | 'trials' | 'library' | 'bestiary' | 'settings' | 'settings2' | 'credits' | 'play' | 'pause' | 'result';
type RunKind = 'campaign' | 'training' | 'endless' | 'bossrush' | 'sandbox' | 'trial' | 'tutorial';
const CARD_POS = new Vector3(0, 1.5, -1.6);
const ROW_H = 0.105;
const BTN_W = 0.72;
const BTN_H = 0.095;
const BOT = 1.0; // y of the lowest button row
const ELIDX: Record<Element, number> = { fire: 0, ice: 1, lightning: 2, aether: 3, nature: 4, shadow: 5 };
const V = (a: V3): Vector3 => new Vector3(a[0], a[1], a[2]);
const ACCENT = '#b48cff';

interface Btn {
  panel: TextPanel;
  entity: Entity;
  label: string;
  sub: string;
  accent: string;
  disabled: boolean;
  act: (() => void) | null;
  shown: boolean;
}
interface Trial {
  id: string;
  name: string;
  desc: string;
  limit: number;
}
const TRIALS: Trial[] = [
  { id: 'embers', name: 'Trial of Embers', desc: 'Defeat 5 Ember Beasts. Fire barely scratches them; Ice shatters them.', limit: 0 },
  { id: 'storm', name: 'Trial of the Storm', desc: 'Survive 60 seconds of Storm Stalkers and Frost Wraiths. Shield when they dash.', limit: 60 },
  { id: 'mixing', name: 'Trial of Mixing', desc: 'Cast 3 different fusion spells before the time runs out (150 s).', limit: 150 },
  { id: 'sentinels', name: 'Trial of Sentinels', desc: 'Shatter 3 Arcane Sentinels. Their shell only breaks to Lightning or Shadow.', limit: 0 },
];
const TUTORIAL: { id: string; xr: string; desk: string }[] = [
  { id: 'raise', xr: 'Raise both hands in front of you, palms open.', desk: 'Move the mouse. Your hands follow it.' },
  { id: 'orb', xr: 'Bring your palms together, facing each other. Hold for a moment.', desk: 'Hold the LEFT mouse button to gather fire.' },
  { id: 'grow', xr: 'Spread your hands apart to grow the orb.', desk: 'Keep holding: the orb grows.' },
  { id: 'cast', xr: 'Push both palms forward fast to throw it at the dummy.', desk: 'Release the LEFT mouse button to throw it.' },
  { id: 'switch', xr: 'Touch the ICE sigil on the left rail with a fingertip to change your left hand.', desk: 'Press 2 to attune to Ice (Shift+2 for the right hand only).' },
  { id: 'shield', xr: 'Cross your wrists in front of your chest to raise the shield.', desk: 'Hold SPACE or the RIGHT mouse button to raise the shield.' },
  { id: 'fusion', xr: 'Attune your hands to two DIFFERENT elements, make the orb and push: a fusion.', desk: 'Press 1, then Shift+3, then hold and release the mouse: a fusion.' },
];

export class SpellforgeSystem extends createSystem({
  opts: { required: [SfOpt, Pressed] },
}) {
  // ---- state
  private save: SfSave = defaultSfSave();
  private screen: Screen = 'title';
  private lastMode = '';
  private time = 0;
  private lastShown = '';
  private root = new Group();
  private arena!: Arena;
  private sparks!: Sparks;
  private engine = new GestureEngine();
  private caster = new SpellCaster();
  private battle: Battle | null = null;
  private run: RunKind = 'training';
  private trial: Trial | null = null;
  private paused = false;
  private resultWin = false;
  private resultNote = '';
  private page = 0;
  private libPage = 0;
  private bestPage = 0;
  private confirmReset = false;
  private optCooldown = 0;
  private tutStep = -1;
  private tutT = 0;
  private bannerT = 0;
  private bannerText = '';
  private bannerSub = '';
  private subText = '';
  private subT = 0;
  private lastHint = '';
  private hurtFlash = 0;
  private bossHit = 0;
  private trialCount = 0;
  private trialSeen = new Set<string>();
  private trialClock = 0;
  private spawnT = 0;
  private statusAcc = 0;
  private bossAcc = 0;
  private fontWasReady = false;
  private sandboxPick = 0;
  private flashA = 0;
  private lostT = 0;
  private lostShown = false;
  // ---- input
  private head: Head = { pos: [0, 1.35, 0], fwd: [0, 0, -1], right: [1, 0, 0] };
  private handsXr = false;
  private presenting = false;
  private frames: [HandFrame | null, HandFrame | null] = [null, null];
  private injected: [HandFrame | null, HandFrame | null] | null = null;
  private gOut: GestureOut | null = null;
  private view: CastView | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private mouseL = false;
  private mouseR = false;
  private keyShield = false;
  private vh = { t: 0, rel: 0, relKind: '' as '' | 'push' | 'circle' | 'open' | 'pinch', prevHeld: false, mode: 'orb' as string };
  private aimDir: V3 = [0, 0, -1];
  private beamUntil = 0;
  private beamDir: V3 = [0, 0, -1];
  private beamOrigin: V3 = [0, 1.2, -0.4];
  private beamPower = 1;
  private beamEl: Element = 'aether';
  // ---- ui
  private card!: TextPanel;
  private btns: Btn[] = [];
  private hudBoss!: TextPanel;
  private hudStatus!: TextPanel;
  private hudHint!: TextPanel;
  private hudBanner!: TextPanel;
  private extra: Btn[] = []; // pause, skip, spawn, clear
  private sigils: { mesh: Mesh; entity: Entity; side: Side; el: Element }[] = [];
  private sigilHot = 0;
  // ---- visuals
  private handVis: { glow: ReturnType<typeof glowSprite>; ring: Mesh; ringMat: MeshBasicMaterial; letter: TextPanel }[] = [];
  private castGroup = new Group();
  private castCore!: Mesh;
  private castHalo!: ReturnType<typeof glowSprite>;
  private castRing!: Mesh;
  private castSpear!: Mesh;
  private castArc!: Mesh[];
  private castBeam!: Group;
  private castBeamCore!: Mesh;
  private castBeamOut!: Mesh;
  private castBeamHit!: ReturnType<typeof glowSprite>;
  private castGround!: Mesh;
  private shield!: Mesh;
  private shieldMat!: MeshBasicMaterial;
  private shieldFlash = 0;
  private vignette!: Mesh;
  private projVis = new Map<number, { g: Group; kind: string; el: Element; r: number }>();
  private enemyVis = new Map<number, { holder: Group; rig: Rig; ring: Mesh; shell: Mesh; id: string; lastHp: number }>();
  private bossVis: { holder: Group; rig: BossRig; id: string; barrier: Mesh; lastHp: number; tele: Mesh } | null = null;
  private areaVis = new Map<number, { g: Group; a: Area; parts: Mesh[]; seed: number }>();
  private ringVis: Mesh[] = [];
  private telegraphRing!: Mesh;
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private tmpQ = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private ndc = new Vector3();
  private camP = new Vector3();
  private lineGeo: Float32Array = new Float32Array(0);
  private jIdx: Record<Side, Record<string, number> | null> = { left: null, right: null };

  // ================================================================== init
  init(): void {
    this.save = loadSfSave();
    this.applyAudioSettings();
    this.world.createTransformEntity(this.root);
    this.root.visible = false;

    this.arena = new Arena();
    this.root.add(this.arena.group);
    this.sparks = new Sparks();
    this.root.add(this.sparks.points);
    this.sparks.density = this.save.settings.reducedIntensity ? 0.45 : 1;

    this.buildPanels();
    this.buildHands();
    this.buildCastVisuals();
    this.buildShieldAndVignette();

    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (entity: Entity) => {
        if (modeState.mode !== 'spell' || this.optCooldown > 0) return;
        const id = entity.getValue(SfOpt, 'id') as number;
        this.optCooldown = 0.3;
        this.press(id);
      }),
    );
    this.bindInput();
    this.bindHooks();
    this.setScreen('title');
  }

  private applyAudioSettings(): void {
    const s = this.save.settings;
    setMasterVolume(s.volume);
    setMusicVolume(s.music);
    setSfxVolume(s.sfx);
    setMuted(s.muted);
  }

  // ================================================================== building
  private mkButton(id: number, w: number, h: number, px: number, x: number, y: number, z: number, rotY = 0, rotX = 0): Btn {
    const panel = new TextPanel(w, h, px);
    panel.mesh.position.set(x, y, z);
    panel.mesh.rotation.set(rotX, rotY, 0, 'YXZ');
    panel.mesh.visible = false;
    const entity = this.world.createTransformEntity(panel.mesh);
    entity.addComponent(RayInteractable);
    entity.addComponent(SfOpt, { id });
    return { panel, entity, label: '', sub: '', accent: ACCENT, disabled: false, act: null, shown: false };
  }
  private buildPanels(): void {
    this.card = new TextPanel(CARD_W, CARD_H, CARD_PX);
    this.card.mesh.position.copy(CARD_POS);
    this.card.mesh.visible = false;
    this.world.createTransformEntity(this.card.mesh);
    for (let i = 0; i < 10; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this.btns.push(this.mkButton(i, BTN_W, BTN_H, 512, (col ? 1 : -1) * 0.37, BOT + (4 - row) * ROW_H, CARD_POS.z + 0.02));
    }
    // in-play panels
    this.hudBoss = new TextPanel(1.2, 0.26, 1024);
    this.hudBoss.mesh.position.set(0, 2.95, -3.4);
    this.hudBoss.mesh.scale.setScalar(1.15);
    this.hudStatus = new TextPanel(0.46, 0.5, 512);
    this.hudStatus.mesh.position.set(-0.66, 1.18, -0.78);
    this.hudStatus.mesh.rotation.y = 0.55;
    this.hudHint = new TextPanel(1.0, 0.2, 1024);
    this.hudHint.mesh.position.set(0, 0.62, -0.95);
    this.hudHint.mesh.rotation.x = -0.55;
    this.hudBanner = new TextPanel(1.3, 0.36, 1024);
    this.hudBanner.mesh.position.set(0, 2.0, -1.9);
    for (const p of [this.hudBoss, this.hudStatus, this.hudHint, this.hudBanner]) {
      p.mesh.visible = false;
      this.world.createTransformEntity(p.mesh);
    }
    // small in-play buttons: 40 pause, 41 skip tutorial, 42 spawn, 43 clear
    this.extra.push(this.mkButton(40, 0.17, 0.085, 256, -0.66, 1.58, -0.7, 0.55));
    this.extra.push(this.mkButton(41, 0.3, 0.085, 384, 0.7, 1.58, -0.75, -0.5));
    this.extra.push(this.mkButton(42, 0.22, 0.085, 256, 0.7, 1.46, -0.75, -0.5));
    this.extra.push(this.mkButton(43, 0.22, 0.085, 256, 0.7, 1.34, -0.75, -0.5));
    // element sigil rails: left hand on the left, right hand on the right
    ELEMENTS.forEach((e, i) => {
      for (const side of ['left', 'right'] as Side[]) {
        const mat = new MeshBasicMaterial({ map: sigilTexture(ELEMENT_CSS[e], LETTER[e]), transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
        const mesh = new Mesh(new PlaneGeometry(0.1, 0.1), mat);
        const x = side === 'left' ? -0.52 : 0.52;
        mesh.position.set(x, 1.4 - i * 0.115, -0.42);
        mesh.rotation.y = side === 'left' ? 0.5 : -0.5;
        mesh.visible = false;
        const entity = this.world.createTransformEntity(mesh);
        entity.addComponent(RayInteractable);
        entity.addComponent(SfOpt, { id: (side === 'left' ? 20 : 30) + i });
        this.sigils.push({ mesh, entity, side, el: e });
      }
    });
  }
  private buildHands(): void {
    for (let i = 0; i < 2; i++) {
      const glow = glowSprite(0xb48cff, 0.16, 0.7);
      const ringMat = new MeshBasicMaterial({ map: sigilTexture('#ffffff', ''), color: 0xb48cff, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
      const ring = new Mesh(new PlaneGeometry(0.17, 0.17), ringMat);
      const letter = new TextPanel(0.05, 0.05, 64);
      letter.mesh.visible = false;
      this.root.add(glow, ring, letter.mesh);
      this.handVis.push({ glow, ring, ringMat, letter });
    }
  }
  private buildCastVisuals(): void {
    this.castCore = new Mesh(new IcosahedronGeometry(1, 3), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }));
    this.castHalo = glowSprite(0xff7a1a, 1, 0.6);
    this.castRing = new Mesh(new TorusGeometry(1, 0.02, 6, 48), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }));
    this.castSpear = new Mesh(new ConeGeometry(0.05, 0.6, 6), new MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.95 }));
    this.castSpear.geometry.rotateX(Math.PI / 2); // tip points to -Z by default after the lookAt below
    this.castArc = [];
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(new CylinderGeometry(0.008, 0.008, 1, 4), new MeshBasicMaterial({ color: 0xe0e8ff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
      this.castArc.push(m);
      this.castGroup.add(m);
    }
    this.castGround = new Mesh(new RingGeometry(0.7, 1, 40), new MeshBasicMaterial({ color: 0x58e07a, transparent: true, opacity: 0.7, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }));
    this.castGround.rotation.x = -Math.PI / 2;
    this.castBeam = new Group();
    this.castBeamCore = new Mesh(new CylinderGeometry(0.012, 0.012, 1, 8), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }));
    this.castBeamOut = new Mesh(new CylinderGeometry(0.045, 0.045, 1, 10), new MeshBasicMaterial({ color: 0xd07cff, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }));
    this.castBeamHit = glowSprite(0xd07cff, 0.5, 0.9);
    this.castBeam.add(this.castBeamCore, this.castBeamOut);
    this.castGroup.add(this.castCore, this.castHalo, this.castRing, this.castSpear, this.castGround);
    this.root.add(this.castGroup, this.castBeam, this.castBeamHit);
    this.castBeam.visible = false;
    this.castBeamHit.visible = false;
    this.telegraphRing = new Mesh(new RingGeometry(0.9, 1, 40), new MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.0, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }));
    this.telegraphRing.rotation.x = -Math.PI / 2;
    this.root.add(this.telegraphRing);
    for (let i = 0; i < 2; i++) {
      const r = new Mesh(new TorusGeometry(1, 0.07, 8, 96), new MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
      r.rotation.x = Math.PI / 2;
      r.visible = false;
      this.root.add(r);
      this.ringVis.push(r);
    }
  }
  private buildShieldAndVignette(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = 'rgba(120,160,255,0.07)';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(170,205,255,0.85)';
    g.lineWidth = 3;
    const s = 46;
    for (let y = -s; y < 560; y += s * 0.866 * 2) {
      for (let x = -s; x < 560; x += s * 3) {
        for (const [ox, oy] of [[0, 0], [s * 1.5, s * 0.866]]) {
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const px = x + ox + Math.cos(a) * s;
            const py = y + oy + Math.sin(a) * s;
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      }
    }
    this.shieldMat = new MeshBasicMaterial({ map: new CanvasTexture(c), color: 0x8ab4ff, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, blending: AdditiveBlending });
    this.shield = new Mesh(new SphereGeometry(0.62, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), this.shieldMat);
    this.shield.rotation.x = -Math.PI / 2 + 0.25; // dome opens toward the player
    this.shield.visible = false;
    this.root.add(this.shield);
    // damage vignette fixed to the head so it can never swim in a headset
    const vc = document.createElement('canvas');
    vc.width = vc.height = 256;
    const vg = vc.getContext('2d') as CanvasRenderingContext2D;
    const gr = vg.createRadialGradient(128, 128, 60, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,0,0,0)');
    gr.addColorStop(1, 'rgba(255,30,30,0.85)');
    vg.fillStyle = gr;
    vg.fillRect(0, 0, 256, 256);
    this.vignette = new Mesh(new PlaneGeometry(0.9, 0.9), new MeshBasicMaterial({ map: new CanvasTexture(vc), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.vignette.position.set(0, 0, -0.35);
    this.vignette.renderOrder = 999;
    this.vignette.visible = false;
    this.world.camera.add(this.vignette);
  }

  // ================================================================== input binding
  private bindInput(): void {
    const kd = (e: KeyboardEvent): void => {
      if (modeState.mode !== 'spell') return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.screen === 'play') this.press(40);
        else if (this.screen === 'pause') this.resume();
        return;
      }
      if (this.screen !== 'play' || this.paused) return;
      if (e.code === 'Space') {
        this.keyShield = true;
        e.preventDefault();
      } else if (e.code === 'KeyF') this.battle?.stomp();
      else if (e.code === 'KeyN') this.press(42);
      else if (e.code === 'KeyC') this.press(43);
      else if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5)) - 1;
        if (n >= 0 && n < 6) this.attune(e.shiftKey ? 'right' : e.altKey ? 'left' : 'both', ELEMENTS[n]);
      }
    };
    const ku = (e: KeyboardEvent): void => {
      if (e.code === 'Space') this.keyShield = false;
    };
    const down = (e: PointerEvent): void => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (modeState.mode !== 'spell' || this.screen !== 'play' || this.paused) return;
      if (e.button === 2) this.mouseR = true;
      else this.mouseL = true;
    };
    const move = (e: PointerEvent): void => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      if (e.button === 2) this.mouseR = false;
      else this.mouseL = false;
    };
    const ctx = (e: Event): void => {
      if (modeState.mode === 'spell') e.preventDefault();
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('contextmenu', ctx);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('contextmenu', ctx);
    });
  }

  // ================================================================== screens
  private setScreen(s: Screen): void {
    this.screen = s;
    this.confirmReset = false;
    this.layout();
  }
  private slotBtn(slot: number, label: string, act: () => void, o: { sub?: string; accent?: string; disabled?: boolean; span2?: boolean } = {}): void {
    const b = this.btns[slot];
    b.label = label;
    b.sub = o.sub ?? '';
    b.accent = o.accent ?? ACCENT;
    b.disabled = o.disabled ?? false;
    b.act = o.disabled ? null : act;
    b.shown = true;
  }
  private clearBtns(): void {
    for (const b of this.btns) {
      b.shown = false;
      b.act = null;
    }
  }
  /** (re)compose the current screen: card art and button slots */
  private layout(): void {
    this.clearBtns();
    const s = this.screen;
    const menu = s !== 'play';
    this.card.mesh.visible = menu && modeState.mode === 'spell';
    if (!menu) {
      this.drawBtns();
      return;
    }
    const st = this.save.settings;
    const wide = (slot: number, label: string, act: () => void, o: { sub?: string; accent?: string; disabled?: boolean } = {}): void => {
      // a wide button spans a row: use the left slot and widen it
      this.slotBtn(slot, label, act, o);
      this.btns[slot + 1].shown = false;
      this.btns[slot].panel.mesh.position.x = 0;
      this.btns[slot].panel.mesh.scale.x = 2.04;
    };
    for (const b of this.btns) b.panel.mesh.scale.x = 1;
    this.btns.forEach((b, i) => (b.panel.mesh.position.x = (i % 2 ? 1 : -1) * 0.37));
    // button rows are anchored from the bottom: rows(n) places row r at BOT + (n-1-r)*ROW_H
    const place = (rows: number): void => {
      this.btns.forEach((b, i) => (b.panel.mesh.position.y = BOT + (rows - 1 - Math.floor(i / 2)) * ROW_H));
    };
    const drawBody = (fn: (p: TextPanel, top: number, bottom: number) => void, rows: number, accent = ACCENT): void => {
      drawCard(this.card, accent);
      const bottom = this.card.h - 58 - (rows * ROW_H * this.card.h) / CARD_H;
      fn(this.card, 40, bottom);
      this.card.commit();
    };
    const p = this.card;
    const save = this.save;
    if (s === 'title') {
      place(4);
      const next = save.campaign >= BOSS_ORDER.length ? 'NEW JOURNEY' : save.campaign > 0 || !st.tutorial ? 'CONTINUE JOURNEY' : 'BEGIN JOURNEY';
      const sub = save.campaign >= BOSS_ORDER.length ? 'Realms awakened: all' : 'Realm ' + (Math.min(save.campaign, 2) + 1) + ': ' + BOSSES[BOSS_ORDER[Math.min(save.campaign, 2)]].realm;
      wide(0, next, () => this.startJourney(), { sub, accent: '#ffd98c' });
      this.slotBtn(2, 'MODES', () => this.setScreen('modes'));
      this.slotBtn(3, 'SPELL LIBRARY', () => this.setScreen('library'));
      this.slotBtn(4, 'BESTIARY', () => this.setScreen('bestiary'));
      this.slotBtn(5, 'SETTINGS', () => this.setScreen('settings'));
      this.slotBtn(6, 'CREDITS', () => this.setScreen('credits'));
      this.slotBtn(7, 'POCKET WORKSHOP', () => this.leave());
      drawBody((c, top, bottom) => {
        drawTitleArt(c, top);
        line(c, 'Shape fire, ice, lightning, aether, nature and shadow with your bare hands.', top + 252, 29, '#d9ccf2', c.w / 2, 'center', 600);
        line(c, 'Discover fusions nobody told you about. Face three bosses.', top + 288, 29, '#d9ccf2', c.w / 2, 'center', 600);
        line(c, '6 ELEMENTS   -   15 FUSIONS   -   3 BOSSES', top + 352, 36, '#ffd98c', c.w / 2, 'center', 700);
        const known = save.discovered.length;
        line(c, 'Fusions discovered: ' + known + ' / ' + FUSIONS.length + '    Best wave: ' + save.bestWave + '    Bosses defeated: ' + save.campaign + ' / ' + BOSS_ORDER.length, bottom - 6, 26, '#a894d6', c.w / 2, 'center', 600);
      }, 4);
    } else if (s === 'modes') {
      place(4);
      this.slotBtn(0, 'TRAINING', () => this.startRun('training'), { sub: 'Dummy, no damage, free energy' });
      this.slotBtn(1, 'SANDBOX', () => this.startRun('sandbox'), { sub: 'Spawn any enemy' });
      this.slotBtn(2, 'ENDLESS RIFT', () => this.startRun('endless'), { sub: 'Best wave ' + save.bestWave });
      this.slotBtn(3, 'BOSS RUSH', () => this.startRun('bossrush'), { sub: 'All three bosses in a row' });
      this.slotBtn(4, 'TRIALS', () => this.setScreen('trials'), { sub: 'Four timed challenges' });
      this.slotBtn(5, 'TUTORIAL', () => this.startRun('tutorial'), { sub: 'Learn the gestures' });
      this.slotBtn(6, 'BOSS: IGNAR', () => this.startRun('campaign', 'ignar'), { sub: BOSSES.ignar.realm });
      this.slotBtn(7, 'BOSS: VYRA', () => this.startRun('campaign', 'vyra'), { sub: BOSSES.vyra.realm });
      this.btns[7].act = () => this.startRun('campaign', 'vyra');
      this.slotBtn(8, 'BOSS: VOID KING', () => this.startRun('campaign', 'voidking'), { sub: BOSSES.voidking.realm });
      this.slotBtn(9, 'BACK', () => this.setScreen('title'), { accent: '#8a7ab0' });
      place(5);
      drawBody((c, top) => {
        line(c, 'MODES', top + 56, 60, '#f4eaff');
        line(c, 'Pick how you want to play.', top + 100, 30, '#b8a4e0', c.w / 2, 'center', 600);
        drawBossLine(c, top + 150, save);
      }, 5);
    } else if (s === 'trials') {
      place(3);
      TRIALS.forEach((t, i) => {
        const best = save.trials[t.id];
        this.slotBtn(i, t.name.toUpperCase(), () => this.startRun('trial', t.id), { sub: best ? 'Best ' + best.toFixed(0) + ' s' : 'Not completed' });
      });
      this.slotBtn(4, 'BACK', () => this.setScreen('modes'), { accent: '#8a7ab0' });
      this.btns[4].panel.mesh.position.x = 0;
      this.btns[5].shown = false;
      place(3);
      drawBody((c, top) => {
        line(c, 'TRIALS', top + 56, 60, '#f4eaff');
        let y = top + 120;
        for (const t of TRIALS) {
          line(c, t.name, y, 32, '#ffd98c', 70, 'left');
          y = para(c, t.desc, 70, y + 32, c.w - 160, 26, '#d9ccf2');
          y += 12;
        }
      }, 3);
    } else if (s === 'library') {
      place(1);
      const entries = libraryEntries(this.caster.discovered, this.caster.counts, ADV_CASTS);
      const pages = libraryPages(entries.length);
      this.slotBtn(0, '< PREVIOUS', () => {
        this.libPage = (this.libPage + pages - 1) % pages;
        this.layout();
      });
      this.slotBtn(1, 'NEXT >', () => {
        this.libPage = (this.libPage + 1) % pages;
        this.layout();
      });
      this.slotBtn(2, 'BACK', () => this.setScreen('title'), { accent: '#8a7ab0' });
      this.btns[2].panel.mesh.position.x = 0;
      this.btns[2].panel.mesh.scale.x = 2.04;
      this.btns[3].shown = false;
      this.btns.forEach((b, i) => (b.panel.mesh.position.y = BOT + (i < 2 ? 1 : 0) * ROW_H));
      drawBody((c, top) => drawLibrary(c, top - 8, this.libPage, entries, st.colourCues), 2);
      void LIB_PER_PAGE;
    } else if (s === 'bestiary') {
      const pages = Math.ceil(bestiaryEntries().length / BEST_PER_PAGE);
      this.slotBtn(0, '< PREVIOUS', () => {
        this.bestPage = (this.bestPage + pages - 1) % pages;
        this.layout();
      });
      this.slotBtn(1, 'NEXT >', () => {
        this.bestPage = (this.bestPage + 1) % pages;
        this.layout();
      });
      this.slotBtn(2, 'BACK', () => this.setScreen('title'), { accent: '#8a7ab0' });
      this.btns[2].panel.mesh.position.x = 0;
      this.btns[2].panel.mesh.scale.x = 2.04;
      this.btns[3].shown = false;
      this.btns.forEach((b, i) => (b.panel.mesh.position.y = BOT + (i < 2 ? 1 : 0) * ROW_H));
      drawBody((c, top) => drawBestiary(c, top - 8, this.bestPage), 2);
    } else if (s === 'settings' || s === 'settings2') {
      const pc = (v: number): string => Math.round(v * 100) + '%';
      const cyc = (v: number, lo: number, hi: number, step: number): number => {
        const n = v + step > hi + 1e-6 ? lo : v + step;
        return Math.round(n * 100) / 100;
      };
      const set = (fn: () => void): (() => void) => () => {
        fn();
        this.applyAudioSettings();
        this.sparks.density = st.reducedIntensity ? 0.45 : 1;
        writeSfSave(this.save);
        this.layout();
      };
      if (s === 'settings') {
        this.slotBtn(0, 'MASTER VOLUME', set(() => (st.volume = cyc(st.volume, 0.2, 1, 0.2))), { sub: pc(st.volume) });
        this.slotBtn(1, 'MUSIC', set(() => (st.music = cyc(st.music, 0, 1, 0.25))), { sub: pc(st.music) });
        this.slotBtn(2, 'EFFECTS', set(() => (st.sfx = cyc(st.sfx, 0, 1, 0.25))), { sub: pc(st.sfx) });
        this.slotBtn(3, 'SOUND', set(() => (st.muted = !st.muted)), { sub: st.muted ? 'Muted' : 'On' });
        this.slotBtn(4, 'MAIN HAND', set(() => (st.dominant = st.dominant === 'right' ? 'left' : 'right')), { sub: st.dominant === 'right' ? 'Right' : 'Left' });
        this.slotBtn(5, 'POSTURE', set(() => (st.seated = !st.seated)), { sub: st.seated ? 'Seated' : 'Standing' });
        this.slotBtn(6, 'REDUCED INTENSITY', set(() => (st.reducedIntensity = !st.reducedIntensity)), { sub: st.reducedIntensity ? 'On: fewer flashes' : 'Off' });
        this.slotBtn(7, 'SUBTITLES', set(() => (st.subtitles = !st.subtitles)), { sub: st.subtitles ? 'On' : 'Off' });
        this.slotBtn(8, 'MORE >', () => this.setScreen('settings2'), { accent: '#ffd98c' });
        this.slotBtn(9, 'BACK', () => this.setScreen('title'), { accent: '#8a7ab0' });
      } else {
        this.slotBtn(0, 'AIM ASSIST', set(() => (st.aimAssist = cyc(st.aimAssist, 0, 1, 0.35))), { sub: pc(st.aimAssist) });
        this.slotBtn(1, 'DIFFICULTY', set(() => (st.difficulty = st.difficulty === 'normal' ? 'hard' : st.difficulty === 'hard' ? 'gentle' : 'normal')), { sub: st.difficulty });
        this.slotBtn(2, 'COLOUR CUES', set(() => (st.colourCues = !st.colourCues)), { sub: st.colourCues ? 'Letters on elements' : 'Off' });
        this.slotBtn(3, 'TUTORIAL', set(() => (st.tutorial = !st.tutorial)), { sub: st.tutorial ? 'Plays before the journey' : 'Skipped' });
        this.slotBtn(4, this.confirmReset ? 'TAP AGAIN TO ERASE' : 'RESET PROGRESS', () => {
          if (!this.confirmReset) {
            this.confirmReset = true;
            this.layout();
          } else {
            const keep = st;
            this.save = defaultSfSave();
            this.save.settings = keep;
            this.caster = new SpellCaster();
            writeSfSave(this.save);
            this.confirmReset = false;
            this.layout();
          }
        }, { accent: '#ff7a7a', sub: this.confirmReset ? 'This cannot be undone' : 'Spells, bosses, records' });
        this.slotBtn(5, '< BACK', () => this.setScreen('settings'), { accent: '#8a7ab0' });
      }
      place(5);
      drawBody((c, top) => {
        line(c, 'SETTINGS', top + 56, 60, '#f4eaff');
        line(c, s === 'settings' ? 'Comfort, sound and play style' : 'Assist, difficulty and data', top + 100, 28, '#b8a4e0', c.w / 2, 'center', 600);
        line(c, 'Sound level now: ' + (isMuted() ? 'muted' : pc(getMasterVolume())) + '   Tap a setting to change it.', top + 138, 26, '#a894d6', c.w / 2, 'center', 600);
      }, 5);
    } else if (s === 'credits') {
      this.slotBtn(0, 'BACK', () => this.setScreen('title'), { accent: '#8a7ab0' });
      this.btns[0].panel.mesh.position.x = 0;
      this.btns[0].panel.mesh.scale.x = 2.04;
      this.btns[0].panel.mesh.position.y = BOT;
      this.btns[1].shown = false;
      drawBody((c, top) => {
        line(c, 'CREDITS', top + 56, 60, '#f4eaff');
        let y = top + 130;
        for (const t of CREDITS) y = para(c, t, c.w / 2, y, c.w - 200, 31, '#d9ccf2', 1.3, 'center') + 10;
        y = para(c, 'Honest notes: this is a WebXR build, not a Unity/Quest APK. Hand-pose thresholds were tuned in code and on a desktop emulator; they have not been verified on a physical headset.', c.w / 2, y + 16, c.w - 200, 25, '#ffd98c', 1.3, 'center');
      }, 1);
    } else if (s === 'pause') {
      place(2);
      this.slotBtn(0, 'RESUME', () => this.resume(), { accent: '#ffd98c' });
      this.slotBtn(1, 'RESTART', () => this.restart());
      this.slotBtn(2, 'SETTINGS', () => this.setScreen('settings'));
      this.slotBtn(3, 'QUIT TO MENU', () => this.quitRun(), { accent: '#ff9a9a' });
      drawBody((c, top) => {
        line(c, 'PAUSED', top + 60, 68, '#f4eaff');
        const b = this.battle;
        if (b) {
          line(c, this.runLabel(), top + 112, 32, '#b8a4e0', c.w / 2, 'center', 600);
          line(c, 'Time ' + b.stats.time.toFixed(0) + ' s   Casts ' + b.stats.casts + '   Kills ' + b.stats.kills + '   Hits ' + b.stats.hits, top + 156, 28, '#d9ccf2', c.w / 2, 'center', 600);
        }
        para(c, 'Fire: both palms facing, spread, push.  Ice: pinch and pull.  Lightning: palms wide, thrust.  Aether: palms forward, hold.  Nature: reach down, draw a circle.  Shadow: fist, pull, open.  Cross wrists: shield.  Hands down fast: stomp.', 70, top + 208, c.w - 140, 26, '#a894d6', 1.3);
      }, 2);
      this.btns.forEach((b, i) => (b.panel.mesh.position.y = BOT + (1 - Math.floor(i / 2)) * ROW_H));
    } else if (s === 'result') {
      place(2);
      const win = this.resultWin;
      const camp = this.run === 'campaign' && win && this.battle?.boss && this.save.campaign < BOSS_ORDER.length;
      this.slotBtn(0, win ? (camp ? 'NEXT REALM' : 'PLAY AGAIN') : 'TRY AGAIN', () => (camp ? this.startJourney() : this.restart()), { accent: '#ffd98c' });
      this.slotBtn(1, 'MENU', () => this.quitRun(), { accent: '#8a7ab0' });
      drawBody((c, top) => {
        line(c, win ? 'VICTORY' : 'DEFEATED', top + 70, 84, win ? '#ffe9a8' : '#ff9a9a');
        line(c, this.resultNote, top + 126, 32, '#d9ccf2', c.w / 2, 'center', 600);
        const b = this.battle;
        if (b) {
          const acc = b.stats.casts ? Math.round((b.stats.hits / Math.max(1, b.stats.casts)) * 100) : 0;
          const rows: [string, string][] = [
            ['Time', b.stats.time.toFixed(0) + ' s'],
            ['Spells cast', String(b.stats.casts)],
            ['Hits landed', String(b.stats.hits) + (b.stats.casts ? '  (' + acc + ' per cast)' : '')],
            ['Enemies defeated', String(b.stats.kills)],
            ['Damage dealt', String(Math.round(b.stats.damageDealt))],
            ['Damage taken', String(Math.round(b.stats.damageTaken))],
            ['Fusions discovered', this.save.discovered.length + ' / ' + FUSIONS.length],
          ];
          if (this.run === 'endless') rows.unshift(['Wave reached', String(b.stats.wave)]);
          rows.forEach((r, i) => {
            line(c, r[0], top + 190 + i * 40, 30, '#b8a4e0', c.w / 2 - 40, 'right', 600);
            line(c, r[1], top + 190 + i * 40, 30, '#fbf4ff', c.w / 2 + 40, 'left');
          });
        }
      }, 2, win ? '#ffd98c' : '#ff7a7a');
      this.btns.forEach((b, i) => (b.panel.mesh.position.y = BOT + (1 - Math.floor(i / 2)) * ROW_H));
    }
    this.drawBtns();
  }
  private drawBtns(): void {
    for (const b of this.btns) {
      b.panel.mesh.visible = b.shown && this.screen !== 'play' && modeState.mode === 'spell';
      if (b.shown) {
        drawButton(b.panel, b.label, b.sub, b.accent, false, b.disabled, b.panel.mesh.scale.x);
        b.panel.commit();
      }
    }
    this.drawExtra();
  }
  private drawExtra(): void {
    const play = this.screen === 'play' && modeState.mode === 'spell';
    const labels: [string, string][] = [['II', '#b48cff'], ['SKIP TUTORIAL', '#ffd98c'], ['SPAWN', '#7dee98'], ['CLEAR', '#ff9a9a']];
    this.extra.forEach((b, i) => {
      const vis = play && (i === 0 || (i === 1 && this.run === 'tutorial') || ((i === 2 || i === 3) && (this.run === 'sandbox' || this.run === 'training')));
      b.shown = vis;
      b.panel.mesh.visible = vis;
      if (vis) {
        drawButton(b.panel, labels[i][0], i === 2 ? ENEMIES[Object.keys(ENEMIES)[this.sandboxPick % 7]].name : '', labels[i][1], false, false);
        b.panel.commit();
      }
    });
    for (const sg of this.sigils) sg.mesh.visible = play && !this.paused;
  }

  // ================================================================== slot presses
  private press(id: number): void {
    if (modeState.mode !== 'spell') return;
    if (id < 10) {
      const b = this.btns[id];
      if (!b || !b.shown || !b.act || this.screen === 'play') return;
      sfx.select();
      b.act();
      return;
    }
    if (this.screen !== 'play') return;
    if (id === 40) {
      this.pause();
    } else if (id === 41) {
      this.finishTutorial(true);
    } else if (id === 42) {
      this.spawnSandbox();
    } else if (id === 43) {
      this.clearEnemies();
    } else if (id >= 20 && id < 40) {
      const side: Side = id < 30 ? 'left' : 'right';
      const el = ELEMENTS[(id % 10) % 6];
      if (!this.paused) this.attune(side, el);
    }
  }

  private attune(side: Side | 'both', e: Element): void {
    this.caster.attune(side, e);
    sfx.select();
    this.sigilHot = 0.5;
    const p = this.head.pos;
    this.sparks.burst(p[0] + (side === 'left' ? -0.45 : side === 'right' ? 0.45 : 0), p[1] - 0.2, p[2] - 0.5, ELEMENT_HEX[e], 12, 0.5, 0.04, 0.5);
    if (this.tutStep === 4 && this.caster.left !== 'fire') this.advanceTutorial(4);
  }

  // ================================================================== run control
  private cfg(): { assist: number; enemyDmg: number } {
    const d = this.save.settings.difficulty;
    return d === 'gentle' ? { assist: 1.2, enemyDmg: 0.6 } : d === 'hard' ? { assist: 0.95, enemyDmg: 1.35 } : { assist: 1, enemyDmg: 1 };
  }
  private startJourney(): void {
    if (this.save.settings.tutorial) {
      this.startRun('tutorial');
      return;
    }
    const i = this.save.campaign >= BOSS_ORDER.length ? 0 : this.save.campaign;
    if (this.save.campaign >= BOSS_ORDER.length) this.save.campaign = 0;
    this.startRun('campaign', BOSS_ORDER[i]);
  }
  private lastRun: { kind: RunKind; arg?: string } = { kind: 'training' };
  private startRun(kind: RunKind, arg?: string): void {
    this.lastRun = { kind, arg };
    this.run = kind;
    this.trial = kind === 'trial' ? (TRIALS.find((t) => t.id === arg) ?? TRIALS[0]) : null;
    const cfg = this.cfg();
    const seed = (Math.random() * 1e6) | 0;
    let mode: BattleMode = 'training';
    let boss: string | undefined;
    if (kind === 'campaign') {
      mode = 'campaign';
      boss = arg ?? BOSS_ORDER[Math.min(this.save.campaign, 2)];
    } else if (kind === 'bossrush') mode = 'bossrush';
    else if (kind === 'endless') mode = 'endless';
    else if (kind === 'sandbox') mode = 'sandbox';
    else if (kind === 'trial') mode = 'trial';
    else mode = 'training';
    this.battle = new Battle({ mode, boss, seed, assist: cfg.assist, enemyDmg: cfg.enemyDmg });
    this.caster.infinite = kind === 'training' || kind === 'sandbox' || kind === 'tutorial';
    this.caster.energy = this.caster.maxEnergy;
    this.caster.cancel();
    this.engine = new GestureEngine();
    this.clearVisuals();
    if (kind === 'trial') this.setupTrial();
    if (kind === 'tutorial') {
      this.tutStep = 0;
      this.tutT = 0;
      this.caster.attune('both', 'fire');
    } else this.tutStep = -1;
    const realm: RealmId = this.battle.boss ? (this.battle.boss.def.id as RealmId) : 'sanctum';
    this.arena.setTheme(realm);
    this.world.scene.fog = this.fogFor(realm);
    this.paused = false;
    this.trialCount = 0;
    this.trialSeen.clear();
    this.trialClock = 0;
    this.spawnT = 0;
    this.resultNote = '';
    this.subText = '';
    this.setScreen('play');
    if (this.battle.boss) {
      const d = this.battle.boss.def;
      this.banner(d.name, d.title + '  -  ' + d.realm, 4);
      this.say(d.intro, 5);
      sfx.bossRoar();
    } else if (kind === 'endless') this.banner('ENDLESS RIFT', 'Survive as many waves as you can', 3);
    else if (kind === 'tutorial') this.banner('FIRST AWAKENING', 'Learn the six elements', 3);
    else if (kind === 'trial') this.banner(this.trial?.name ?? 'TRIAL', this.trial?.desc ?? '', 4);
    else if (kind === 'sandbox') this.banner('SANDBOX', 'Spawn enemies, test every spell', 3);
    else this.banner('TRAINING', 'No damage, unlimited energy', 3);
  }
  private fogFor(r: RealmId): FogExp2 {
    const t = THEMES[r];
    return new FogExp2(t.fog, t.fogD);
  }
  private restart(): void {
    this.startRun(this.lastRun.kind, this.lastRun.arg);
  }
  private pause(): void {
    if (this.screen !== 'play') return;
    this.paused = true;
    this.mouseL = false;
    this.mouseR = false;
    sfx.spellVoice(0, 0);
    this.setScreen('pause');
  }
  private resume(): void {
    this.paused = false;
    this.setScreen('play');
  }
  private quitRun(): void {
    this.persist();
    sfx.spellVoice(0, 0);
    this.battle = null;
    this.clearVisuals();
    this.paused = false;
    musicState.tension = 0;
    musicState.jam = 0;
    this.arena.setTheme('sanctum');
    this.setScreen('title');
  }
  private leave(): void {
    this.persist();
    import('./mode.js').then((m) => m.setMode('menu'));
  }
  private runLabel(): string {
    const k = this.run;
    if (k === 'campaign') return 'Journey - ' + (this.battle?.boss?.def.realm ?? '');
    if (k === 'trial') return this.trial?.name ?? 'Trial';
    return k === 'bossrush' ? 'Boss Rush' : k === 'endless' ? 'Endless Rift' : k === 'tutorial' ? 'Tutorial' : k === 'sandbox' ? 'Sandbox' : 'Training';
  }
  private persist(): void {
    const s = this.save;
    s.counts = { ...this.caster.counts };
    s.discovered = [...this.caster.discovered];
    try {
      writeSfSave(s);
    } catch {
      /* storage can be unavailable */
    }
  }

  // ---------------------------------------------------------------- trials and tutorial
  private setupTrial(): void {
    const b = this.battle as Battle;
    const t = this.trial as Trial;
    b.enemies = b.enemies.filter((e) => e.def.id !== 'dummy');
    if (t.id === 'embers') for (let i = 0; i < 5; i++) b.spawnEnemy(ENEMIES.ember_beast, [(i - 2) * 1.8, 0, ARENA_Z - i * 0.3]);
    else if (t.id === 'sentinels') for (let i = 0; i < 3; i++) b.spawnEnemy(ENEMIES.arcane_sentinel, [(i - 1) * 3, 0, ARENA_Z - 1]);
    else if (t.id === 'mixing') b.spawnDummy([0, 0, ARENA_Z + 1]);
    this.caster.infinite = t.id === 'mixing';
  }
  private trialTick(dt: number): void {
    const b = this.battle as Battle;
    const t = this.trial;
    if (!t || b.over !== 'none') return;
    this.trialClock += dt;
    let won = false;
    let note = '';
    if (t.id === 'embers') {
      won = b.alive().length === 0 && b.stats.kills >= 5;
      note = 'Ember Beasts left: ' + b.alive().length;
    } else if (t.id === 'sentinels') {
      won = b.alive().length === 0 && b.stats.kills >= 3;
      note = 'Sentinels left: ' + b.alive().length;
    } else if (t.id === 'storm') {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.trialClock < t.limit - 6) {
        this.spawnT = 7;
        const a = (Math.random() - 0.5) * 2;
        b.spawnEnemy(Math.random() < 0.5 ? ENEMIES.storm_stalker : ENEMIES.frost_wraith, [Math.sin(a) * 6, 0, -Math.cos(a) * 6]);
      }
      won = this.trialClock >= t.limit;
      note = 'Survive: ' + Math.max(0, Math.ceil(t.limit - this.trialClock)) + ' s';
    } else if (t.id === 'mixing') {
      won = this.trialSeen.size >= 3;
      note = 'Fusions cast: ' + this.trialSeen.size + ' / 3   Time left: ' + Math.max(0, Math.ceil(t.limit - this.trialClock)) + ' s';
      if (this.trialClock >= t.limit && !won) {
        b.player.hp = 0;
        this.resultNote = 'Out of time';
      }
    }
    this.subText = this.subText || '';
    this.trialNote = note;
    if (won) {
      b.over = 'win';
      b.events.push({ t: 'win' });
      const best = this.save.trials[t.id];
      if (!best || this.trialClock < best) this.save.trials[t.id] = Math.round(this.trialClock * 10) / 10;
      this.resultNote = t.name + ' complete in ' + this.trialClock.toFixed(0) + ' s';
    }
  }
  private trialNote = '';
  private advanceTutorial(from: number): void {
    if (this.tutStep !== from) return;
    this.tutStep++;
    this.tutT = 0;
    sfx.spellUnlock();
    if (this.tutStep >= TUTORIAL.length) this.finishTutorial(false);
  }
  private finishTutorial(skipped: boolean): void {
    this.save.settings.tutorial = false;
    this.tutStep = -1;
    this.persist();
    this.banner(skipped ? 'TUTORIAL SKIPPED' : 'WELL CAST', 'The journey begins', 3);
    const i = this.save.campaign >= BOSS_ORDER.length ? 0 : this.save.campaign;
    this.save.campaign = i;
    this.startRun('campaign', BOSS_ORDER[i]);
  }

  // ---------------------------------------------------------------- sandbox
  private spawnSandbox(): void {
    const b = this.battle;
    if (!b) return;
    const ids = Object.keys(ENEMIES);
    const def = ENEMIES[ids[this.sandboxPick % ids.length]];
    this.sandboxPick++;
    const a = (Math.random() - 0.5) * 1.6;
    b.spawnEnemy(def, [Math.sin(a) * 5, 0, -Math.cos(a) * 5]);
    this.drawExtra();
  }
  private clearEnemies(): void {
    const b = this.battle;
    if (!b) return;
    for (const e of b.enemies) if (e.def.id !== 'dummy') e.hp = 0;
    b.enemies = b.enemies.filter((e) => e.def.id === 'dummy');
  }

  // ---------------------------------------------------------------- messages
  private banner(a: string, b = '', secs = 3): void {
    this.bannerText = a;
    this.bannerSub = b;
    this.bannerT = secs;
    this.bannerMax = secs;
    this.drawBanner();
  }
  private bannerMax = 3;
  private say(s: string, secs = 3): void {
    this.subText = s;
    this.subT = secs;
    this.lastHint = '\u0000';
  }
  private drawBanner(): void {
    const p = this.hudBanner;
    p.ctx.clearRect(0, 0, p.w, p.h);
    if (this.bannerText) {
      const c = p.ctx;
      const g = c.createLinearGradient(0, 0, p.w, 0);
      g.addColorStop(0, 'rgba(10,4,24,0)');
      g.addColorStop(0.2, 'rgba(10,4,24,0.78)');
      g.addColorStop(0.8, 'rgba(10,4,24,0.78)');
      g.addColorStop(1, 'rgba(10,4,24,0)');
      c.fillStyle = g;
      c.fillRect(0, p.h * 0.1, p.w, p.h * 0.8);
      line(p, this.bannerText, p.h * 0.5, 96, '#fff3d0');
      line(p, this.bannerSub, p.h * 0.78, 38, '#d9ccf2', p.w / 2, 'center', 600);
    }
    p.commit();
  }

  // ================================================================== frame
  update(delta: number): void {
    if (this.optCooldown > 0) this.optCooldown -= delta;
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      this.onModeChange(modeState.mode === 'spell');
    }
    if (modeState.mode !== 'spell') return;
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.layout();
    }
    if (this.world.visibilityState.value === 'visible-blurred') return;
    const dt = Math.min(delta, 0.05);
    this.time += dt;
    this.tick(dt);
  }

  private onModeChange(on: boolean): void {
    this.root.visible = on;
    this.setRoomHidden(on);
    this.frameCamera(on);
    if (on) {
      this.prevFog = this.world.scene.fog;
      this.world.scene.fog = this.fogFor(this.arena.theme);
      this.save = loadSfSave();
      this.applyAudioSettings();
      this.caster.counts = { ...this.save.counts };
      this.caster.discovered = new Set(this.save.discovered);
      this.sparks.density = this.save.settings.reducedIntensity ? 0.45 : 1;
      this.vignette.visible = true;
      this.battle = null;
      this.paused = false;
      this.arena.setTheme('sanctum');
      this.setScreen('title');
    } else {
      this.persist();
      sfx.spellVoice(0, 0);
      this.vignette.visible = false;
      this.world.scene.fog = this.prevFog as FogExp2 | null;
      this.card.mesh.visible = false;
      for (const b of [...this.btns, ...this.extra]) b.panel.mesh.visible = false;
      for (const p of [this.hudBoss, this.hudStatus, this.hudHint, this.hudBanner]) p.mesh.visible = false;
      for (const s of this.sigils) s.mesh.visible = false;
      musicState.tension = 0;
      musicState.jam = 0;
      this.clearVisuals();
    }
  }
  private prevFog: unknown = null;
  private camSaved: { p: Vector3; q: Quaternion; fov: number } | null = null;
  /** desktop only: look straight down the arena instead of at the workshop table; restored on exit */
  private frameCamera(on: boolean): void {
    if (this.world.renderer.xr.isPresenting) return;
    const cam = this.world.camera;
    const pc = cam as unknown as { fov?: number; updateProjectionMatrix?: () => void };
    if (on) {
      this.camSaved = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: pc.fov ?? 50 };
      cam.position.set(0, 1.45, 0.3);
      cam.lookAt(0, 1.85, -6);
      // a slightly wider lens so a towering boss and the hand HUD fit the same desktop frame
      if (pc.fov !== undefined) {
        pc.fov = 64;
        pc.updateProjectionMatrix?.();
      }
    } else if (this.camSaved) {
      cam.position.copy(this.camSaved.p);
      cam.quaternion.copy(this.camSaved.q);
      if (pc.fov !== undefined) {
        pc.fov = this.camSaved.fov;
        pc.updateProjectionMatrix?.();
      }
      this.camSaved = null;
    }
  }
  private setRoomHidden(h: boolean): void {
    spellRoom.hide = h;
  }

  // ---------------------------------------------------------------- the simulation tick
  private tick(dt: number): void {
    this.updateHead();
    this.arena.update(dt, this.time, this.battle ? Math.min(1, this.battle.alive().length * 0.2 + (this.battle.boss ? 0.5 : 0)) : 0);
    this.sparks.update(dt);
    const b = this.battle;
    if (this.screen === 'title' || this.screen === 'modes' || this.screen === 'trials' || this.screen === 'library' || this.screen === 'bestiary' || this.screen.startsWith('settings') || this.screen === 'credits') {
      this.ambientMenu(dt);
      this.hideHud();
      this.updateHandVisuals(false);
      return;
    }
    if (!b) return;
    if (this.screen === 'pause') {
      this.hideHud(true);
      this.syncVisuals(dt, false);
      return;
    }
    if (this.screen === 'result') {
      this.hideHud(true);
      this.syncVisuals(dt, true);
      return;
    }
    // ---- input -> gesture -> cast -> battle
    this.readHands(dt);
    const L = this.frames[0];
    const R = this.frames[1];
    const g = this.engine.update(dt, L, R, this.head);
    this.gOut = g;
    const res = this.caster.update(dt, g, L, R, this.head, { shield: g.shield });
    this.view = res.view;
    this.handleGestureEvents(g, b);
    for (const ev of res.events) this.handleCastEvent(ev, b);
    b.setShield(g.shield && b.player.shieldHp > 0);
    const evs = b.update(dt, this.head.pos);
    for (const e of evs) this.handleBattleEvent(e, b);
    if (this.beamUntil > this.time) this.beamUntil = this.beamUntil; // keep until the caster says beamEnd
    if (this.run === 'trial') this.trialTick(dt);
    if (this.run === 'tutorial') this.tutorialTick(dt, g);
    if (this.run === 'endless' && b.over !== 'none') this.save.bestWave = Math.max(this.save.bestWave, b.stats.wave);
    this.updateMusic(b, dt);
    this.syncVisuals(dt, true);
    this.updateHandVisuals(true);
    this.updateCastVisuals(dt, res.view);
    this.updateHud(dt, b, res.view);
    if (b.over !== 'none' && this.screen === 'play') this.finishRun(b);
    this.updateTrackingNotice(dt, g);
  }

  private updateHead(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.tmpV);
    cam.getWorldDirection(this.tmpV2);
    const fx = this.tmpV2.x;
    const fz = this.tmpV2.z;
    const l = Math.hypot(fx, fz) || 1;
    this.head.pos[0] = this.tmpV.x;
    this.head.pos[1] = Math.max(0.9, this.tmpV.y);
    this.head.pos[2] = this.tmpV.z;
    this.head.fwd[0] = fx / l;
    this.head.fwd[1] = 0;
    this.head.fwd[2] = fz / l;
    this.head.right[0] = -this.head.fwd[2];
    this.head.right[1] = 0;
    this.head.right[2] = this.head.fwd[0];
  }

  // ---------------------------------------------------------------- hands
  private readHands(dt: number): void {
    if (this.injected) {
      this.frames = this.injected;
      return;
    }
    const ad = this.input.xr.visualAdapters.hand;
    this.handsXr = !!(ad.left.connected || ad.right.connected);
    this.presenting = !!this.world.renderer.xr.isPresenting;
    if (this.handsXr) {
      this.frames = [this.readXrHand('left'), this.readXrHand('right')];
    } else if (!this.presenting) {
      this.frames = this.virtualFrames(dt);
    } else this.frames = [null, null];
  }

  private readXrHand(side: Side): HandFrame | null {
    const ad = this.input.xr.visualAdapters.hand[side] as unknown as {
      connected: boolean;
      gripSpace?: { updateWorldMatrix(a: boolean, b: boolean): void; localToWorld(v: Vector3): Vector3 };
      jointSpaces?: { jointName?: string }[];
      jointTransforms?: Float32Array;
    };
    if (!ad.connected || !ad.gripSpace || !ad.jointTransforms || !ad.jointSpaces) return null;
    let idx = this.jIdx[side];
    if (!idx || Object.keys(idx).length === 0) {
      idx = {};
      ad.jointSpaces.forEach((j, i) => {
        if (j.jointName) idx![j.jointName] = i;
      });
      this.jIdx[side] = idx;
    }
    const m = ad.jointTransforms;
    ad.gripSpace.updateWorldMatrix(true, false);
    const P = (name: string): V3 | null => {
      const i = idx![name];
      if (i === undefined || m.length < (i + 1) * 16) return null;
      const x = m[i * 16 + 12];
      const y = m[i * 16 + 13];
      const z = m[i * 16 + 14];
      if (!Number.isFinite(x + y + z) || (x === 0 && y === 0 && z === 0)) return null;
      this.tmpV.set(x, y, z);
      ad.gripSpace!.localToWorld(this.tmpV);
      return [this.tmpV.x, this.tmpV.y, this.tmpV.z];
    };
    const wrist = P('wrist');
    const tt = P('thumb-tip');
    const it = P('index-finger-tip');
    const mt = P('middle-finger-tip');
    const rt = P('ring-finger-tip');
    const pt = P('pinky-finger-tip');
    const iK = P('index-finger-phalanx-proximal');
    const mK = P('middle-finger-phalanx-proximal');
    const pK = P('pinky-finger-phalanx-proximal');
    if (!wrist || !tt || !it || !mt || !rt || !pt || !iK || !mK || !pK) return null;
    const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
    const nrm = (a: V3): V3 => {
      const l = len(a) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    const palm: V3 = [(wrist[0] + mK[0]) / 2, (wrist[1] + mK[1]) / 2, (wrist[2] + mK[2]) / 2];
    const v1 = sub(iK, wrist);
    const v2 = sub(pK, wrist);
    const cr: V3 = [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
    const sgn = side === 'right' ? 1 : -1; // right-hand rule, mirrored for the left hand: unverified on hardware
    const normal = nrm([cr[0] * sgn, cr[1] * sgn, cr[2] * sgn]);
    const aim = nrm(sub(mK, wrist));
    const curlOf = (tip: V3): number => Math.max(0, Math.min(1, (0.16 - len(sub(tip, wrist))) / 0.07));
    const thumbCurl = Math.max(0, Math.min(1, (0.075 - len(sub(tt, iK))) / 0.045));
    const pinch = Math.max(0, Math.min(1, 1 - (len(sub(tt, it)) - 0.012) / 0.05));
    return {
      tracked: true,
      conf: 1,
      palm,
      normal,
      aim,
      wrist,
      tips: [tt, it, mt, rt, pt],
      curl: [thumbCurl, curlOf(it), curlOf(mt), curlOf(rt), curlOf(pt)],
      pinch,
      pinchPt: [(tt[0] + it[0]) / 2, (tt[1] + it[1]) / 2, (tt[2] + it[2]) / 2],
    };
  }

  /** desktop stand-in: mouse and keys drive synthetic hand poses that go through the SAME gesture engine */
  private virtualFrames(dt: number): [HandFrame, HandFrame] {
    const h = this.head;
    const inter = this.caster.interaction();
    const vh = this.vh;
    // aim from the mouse
    this.mouseAim();
    const held = this.mouseL && !this.mouseR;
    if (held && !vh.prevHeld) {
      vh.t = 0;
      vh.rel = 0;
    }
    if (held) vh.t += dt;
    if (!held && vh.prevHeld && vh.t > 0.15) {
      vh.rel = 0.45;
      vh.relKind = inter === 'vines' ? 'circle' : inter === 'void' ? 'open' : inter === 'spear' ? 'pinch' : inter === 'beam' ? '' : 'push';
      if (inter === 'beam') vh.rel = 0;
    }
    vh.prevHeld = held;
    const relActive = vh.rel > 0;
    if (relActive) vh.rel -= dt;
    const y = h.pos[1] - 0.3;
    const z0 = h.pos[2] - 0.8;
    const x0 = h.pos[0];
    const aim = this.aimDir;
    const OPEN = [0.1, 0.05, 0.05, 0.05, 0.05];
    const FIST = [0.8, 0.9, 0.9, 0.9, 0.9];
    const mk = (palm: V3, o: Partial<HandFrame> = {}): HandFrame => ({
      tracked: true,
      conf: 1,
      palm,
      normal: [0, 0, -1],
      aim,
      wrist: [palm[0], palm[1], palm[2] + 0.08],
      tips: [palm, palm, palm, palm, palm],
      curl: OPEN,
      pinch: 0,
      pinchPt: palm,
      ...o,
    });
    // shield: crossed wrists
    if (this.keyShield || this.mouseR) {
      return [mk([x0 + 0.12, y, z0 + 0.07], { wrist: [x0 + 0.1, y, z0 + 0.12] }), mk([x0 - 0.12, y, z0 + 0.07], { wrist: [x0 - 0.1, y, z0 + 0.12] })];
    }
    const active = held || relActive;
    // resting hands: apart and low, palms forward, so no orb forms and no spell charges
    if (!active) return [mk([x0 - 0.3, y - 0.3, z0 + 0.1]), mk([x0 + 0.3, y - 0.3, z0 + 0.1])];
    const t = vh.t;
    if (inter === 'orb' || inter === 'arc') {
      const target = inter === 'arc' ? 0.5 : 0.16 + 0.34 * Math.min(1, t / 1.8);
      const sp = relActive ? (inter === 'arc' ? 0.5 : 0.16 + 0.34 * Math.min(1, vh.t / 1.8)) : Math.min(target, 0.14 + t * 0.9);
      const adv = relActive ? (0.45 - vh.rel) * 3.2 : 0;
      const dz = adv * aim[2];
      const dx = adv * aim[0];
      const dy = adv * aim[1];
      if (inter === 'arc' && relActive) {
        // one hand thrusts
        return [mk([x0 - sp / 2, y, z0], { normal: [1, 0, 0] }), mk([x0 + sp / 2 + dx, y + dy, z0 + dz], { normal: [-1, 0, 0] })];
      }
      return [mk([x0 - sp / 2 + dx, y + dy, z0 + dz], { normal: [1, 0, 0] }), mk([x0 + sp / 2 + dx, y + dy, z0 + dz], { normal: [-1, 0, 0] })];
    }
    if (inter === 'spear') {
      const pull = relActive ? 0.4 : 0.12 + 0.3 * Math.min(1, t / 1.2);
      const pin = relActive ? 0 : 0.95;
      const rp: V3 = [x0 + 0.1, y, z0 + 0.1];
      return [mk([x0 - 0.12, y, z0 - 0.08], { normal: [0, 0, -1] }), mk(rp, { normal: [0, 0, 1], pinch: pin, pinchPt: [rp[0], rp[1], z0 - 0.08 + pull], curl: [0.4, 0.4, 0.2, 0.5, 0.5] })];
    }
    if (inter === 'beam') {
      return [mk([x0 - 0.12, y, z0], { normal: [0, 0, -1] }), mk([x0 + 0.12, y, z0], { normal: [0, 0, -1] })];
    }
    if (inter === 'vines') {
      const a = relActive ? (0.45 - vh.rel) * 11 : 0;
      const r = relActive ? 0.13 : 0;
      return [mk([x0 - 0.3, y - 0.3, z0 + 0.1]), mk([x0 + 0.2 + Math.cos(a) * r, h.pos[1] - 0.72 + Math.sin(a) * r, z0 + Math.sin(a) * r], { normal: [0, -1, 0] })];
    }
    // void: a fist on one side, the free hand pulled back toward the head
    const fistOpen = relActive;
    return [mk([x0 - 0.1, y, z0 - 0.08], { curl: fistOpen ? OPEN : FIST }), mk([x0 + 0.2, y, z0 + 0.3])];
  }
  private mouseAim(): void {
    if (this.mouseX === 0 && this.mouseY === 0) {
      this.aimDir = [0, 0, -1];
      return;
    }
    const cam = this.world.camera;
    this.ndc.set((this.mouseX / window.innerWidth) * 2 - 1, -(this.mouseY / window.innerHeight) * 2 + 1, 0.5).unproject(cam);
    cam.getWorldPosition(this.camP);
    this.ndc.sub(this.camP).normalize();
    // aim at the point where the mouse ray meets the arena plane, from the casting hand
    const tz = this.ndc.z < -0.01 ? (-5.5 - this.camP.z) / this.ndc.z : 8;
    const tx = this.camP.x + this.ndc.x * tz;
    const ty = Math.max(0.2, this.camP.y + this.ndc.y * tz);
    const ox = this.head.pos[0];
    const oy = this.head.pos[1] - 0.3;
    const oz = this.head.pos[2] - 0.8;
    const d: V3 = [tx - ox, ty - oy, -5.5 - oz];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    this.aimDir = [d[0] / l, d[1] / l, d[2] / l];
  }

  // ---------------------------------------------------------------- gesture and cast events
  private handleGestureEvents(g: GestureOut, b: Battle): void {
    for (const e of g.events) {
      if (e.t === 'shield') {
        sfx.spellShield(e.on);
        if (e.on && this.tutStep === 5) this.advanceTutorial(5);
      } else if (e.t === 'down' && e.speed > 1.7 && this.handsXr) {
        b.stomp();
      } else if (e.t === 'lost') this.say('Hand tracking lost. Bring your hands back into view.', 2.5);
      else if (e.t === 'recovered') this.say('', 0.01);
    }
  }
  private pan(x: number): number {
    return Math.max(-1, Math.min(1, x / 5));
  }
  private handleCastEvent(ev: CastEvent, b: Battle): void {
    const desktop = !this.handsXr && !this.presenting && !this.injected;
    if (ev.t === 'cast') {
      const dir: V3 = desktop ? this.aimDir : ev.dir;
      const origin: V3 = ev.origin;
      b.cast(ev.spell, ev.power, origin, dir);
      const el = ev.spell.elements[ev.spell.elements.length - 1];
      sfx.spellCast(ELIDX[el], ev.power, this.pan(dir[0] * 4));
      this.sparks.burst(origin[0], origin[1], origin[2], ELEMENT_HEX[el], 22, 1.4, 0.05, 0.6);
      this.flashA = Math.min(0.5, this.flashA + 0.2);
      if (ev.spell.tier === 'fusion') this.trialSeen.add(ev.spell.id);
      if (this.tutStep === 3 && ev.spell.tier !== 'fusion') this.advanceTutorial(3);
      if (this.tutStep === 6 && ev.spell.tier === 'fusion') this.advanceTutorial(6);
      this.persistSoon();
    } else if (ev.t === 'beam') {
      const dir: V3 = desktop ? this.aimDir : ev.dir;
      b.beamTick(ev.spell, ev.power, ev.origin, dir, ev.dt);
      this.beamUntil = this.time + 0.25;
      this.beamDir = dir;
      this.beamOrigin = ev.origin;
      this.beamPower = ev.power;
    } else if (ev.t === 'beamEnd') this.beamUntil = 0;
    else if (ev.t === 'fizzle') {
      sfx.spellFizzle();
      this.say(ev.why, 1.6);
    } else if (ev.t === 'discover') {
      sfx.spellDiscover();
      const s = ev.spell;
      this.banner('FUSION DISCOVERED', s.name + '  -  ' + s.elements.map((e) => ELEMENT_NAME[e]).join(' + '), 4.5);
      this.say(s.gesture, 6);
      const p = this.head.pos;
      for (let i = 0; i < 3; i++) this.sparks.burst(p[0], p[1] + 0.3, p[2] - 1.2, ELEMENT_HEX[s.elements[i % 2]], 30, 1.8, 0.07, 1.4);
      this.persistSoon();
    } else if (ev.t === 'unlock') {
      sfx.spellUnlock();
      this.banner('ADVANCED SPELL UNLOCKED', ev.spell.name + ' - hold the full charge for a second, then release', 4.5);
      this.persistSoon();
    }
  }
  private persistT = 0;
  private persistSoon(): void {
    this.persistT = 1.5;
  }

  // ---------------------------------------------------------------- battle events
  private handleBattleEvent(e: BEvent, b: Battle): void {
    const sp = this.sparks;
    switch (e.t) {
      case 'hit': {
        const big = e.dmg > 40;
        sfx.spellHit(ELIDX[e.element], big, this.pan(e.pos[0]));
        sp.burst(e.pos[0], e.pos[1], e.pos[2], ELEMENT_HEX[e.element], big ? 26 : 12, big ? 2.2 : 1.3, 0.06, 0.6);
        if (e.target === 'boss') this.bossHit = 0.15;
        break;
      }
      case 'beamHit':
        sp.burst(e.pos[0], e.pos[1], e.pos[2], ELEMENT_HEX[e.element], 3, 1, 0.04, 0.35);
        break;
      case 'enemyDie': {
        sfx.spellDie(this.pan(e.pos[0]));
        sp.burst(e.pos[0], e.pos[1], e.pos[2], ENEMIES[e.def] ? ENEMIES[e.def].hex : 0xffffff, 34, 2.2, 0.07, 0.9, 1);
        break;
      }
      case 'telegraph': {
        sfx.spellTelegraph(e.kind.length, this.pan(e.pos[0]));
        this.say(this.telegraphText(e.who, e.kind, b, e.pos), 1.6);
        break;
      }
      case 'spawn':
        break;
      case 'playerHurt':
        sfx.spellHurt();
        this.hurtFlash = this.save.settings.reducedIntensity ? 0.35 : 0.8;
        this.say(e.src + ' hits you', 1.2);
        break;
      case 'blocked':
        sfx.spellBlock();
        this.shieldFlash = 0.35;
        sp.burst(e.pos[0], e.pos[1] + 1.1, e.pos[2], 0x8ab4ff, 14, 1.2, 0.05, 0.4);
        break;
      case 'reflect':
        sfx.spellBlock();
        this.shieldFlash = 0.5;
        this.say('Reflected!', 1.4);
        sp.burst(e.pos[0], e.pos[1] + 1.1, e.pos[2], 0xffffff, 30, 2, 0.06, 0.6);
        break;
      case 'stomp':
        sfx.spellStomp();
        this.say('Shockwave broken!', 1.4);
        sp.ring(0, 0.05, -0.8, 0.4, 0xffd98c, 28, 0.06, 0.9);
        break;
      case 'armorBreak':
        sfx.spellHit(1, true);
        this.banner('ARMOUR SHATTERED', 'Hit him now', 2.5);
        sp.burst(e.pos[0], e.pos[1], e.pos[2], 0xbfeaff, 50, 3, 0.08, 1.2);
        break;
      case 'bossPhase': {
        const d = b.boss?.def;
        sfx.bossRoar();
        this.banner(e.name.toUpperCase(), d ? 'Phase ' + (e.phase + 1) + ' of ' + d.phases.length : '', 3.2);
        this.say(e.note, 6);
        if (this.bossVis) sp.burst(b.boss!.pos[0], b.boss!.pos[1] + 1.5, b.boss!.pos[2], d?.hex ?? 0xffffff, 60, 3.6, 0.09, 1.2);
        break;
      }
      case 'bossVuln':
        this.say(e.why + ': extra damage for ' + e.secs + ' s', 3);
        break;
      case 'barrier':
        this.say(e.on ? 'Her barrier is back. Overload the pylons with lightning.' : 'Barrier down. Strike her now!', 3.5);
        sfx.spellBlock();
        break;
      case 'absorb':
        this.say('He absorbs ' + ELEMENT_NAME[e.el] + '. Mix your elements.', 2.5);
        break;
      case 'grant':
        this.banner('AETHER NOVA', 'Charge Aether in both hands to full, hold, then release', 5);
        this.caster.counts.aether = Math.max(this.caster.counts.aether, ADV_CASTS);
        this.caster.attune('both', 'aether');
        sfx.spellUnlock();
        break;
      case 'bossDie':
        sfx.bossRoar();
        sfx.spellWin();
        this.banner(b.boss?.def.name + ' FALLS', b.boss?.def.realm ?? '', 4);
        if (this.bossVis) for (let i = 0; i < 5; i++) sp.burst(b.boss!.pos[0], b.boss!.pos[1] + 1.5, b.boss!.pos[2], b.boss!.def.hex, 50, 4, 0.09, 1.8);
        break;
      case 'wave':
        this.banner('WAVE ' + e.n, '', 2);
        sfx.spellUnlock();
        break;
      case 'heal':
        this.say('Healed ' + e.amount, 1.4);
        break;
      case 'bolt': {
        sfx.spellHit(2, true, 0);
        sp.burst(e.pos[0], e.pos[1] + 0.2, e.pos[2] - 0.5, 0xe0e8ff, 30, 2.4, 0.06, 0.5);
        this.flashLightning(e.from, e.pos);
        break;
      }
      case 'arc':
        this.flashArc(e.points, ELEMENT_HEX[e.element]);
        break;
      case 'teleport':
        sp.burst(e.from[0], e.from[1] + 1.2, e.from[2], 0xa9b8ff, 24, 1.8, 0.06, 0.6);
        sp.burst(e.to[0], e.to[1] + 1.2, e.to[2], 0xa9b8ff, 24, 1.8, 0.06, 0.6);
        break;
      case 'win':
        break;
      case 'lose':
        sfx.spellLose();
        break;
      default:
        break;
    }
  }
  private telegraphText(who: 'enemy' | 'boss', kind: string, b: Battle, pos: V3): string {
    const side = pos[0] < -1.2 ? ' from the left' : pos[0] > 1.2 ? ' from the right' : '';
    if (who === 'boss') {
      const n = b.boss?.def.name ?? 'Boss';
      switch (kind) {
        case 'fireball': return n + ' hurls a fireball: shield it or shoot it down';
        case 'shockwave': return 'Shockwave! Slam your hands down just before it hits';
        case 'bolt': return 'Lightning incoming: raise your shield at the last moment to reflect it';
        case 'fan': return 'A fan of bolts: shield or dodge';
        case 'rain': return 'Bolts raining from above';
        case 'shadowOrb': return 'A homing dark orb: burn it or block it';
        case 'elementBurst': return 'An elemental burst: answer with its opposite element';
        default: return n + ' attacks';
      }
    }
    return 'An enemy winds up' + side + ': shield or strike first';
  }
  private flashLightning(from: V3, to: V3): void {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      this.sparks.emit(from[0] + (to[0] - from[0]) * k + (Math.random() - 0.5) * 0.3, from[1] + (to[1] - from[1]) * k + (Math.random() - 0.5) * 0.3, from[2] + (to[2] - from[2]) * k + (Math.random() - 0.5) * 0.3, 0, 0, 0, 0xe0e8ff, 0.12, 0.35);
    }
  }
  private flashArc(pts: V3[], hex: number): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      for (let k = 0; k < 10; k++) {
        const t = k / 10;
        this.sparks.emit(a[0] + (c[0] - a[0]) * t + (Math.random() - 0.5) * 0.18, a[1] + (c[1] - a[1]) * t + (Math.random() - 0.5) * 0.18, a[2] + (c[2] - a[2]) * t + (Math.random() - 0.5) * 0.18, 0, 0, 0, hex, 0.1, 0.3);
      }
    }
  }

  // ---------------------------------------------------------------- tutorial
  private tutorialTick(dt: number, g: GestureOut): void {
    this.tutT += dt;
    const v = this.view;
    const step = this.tutStep;
    if (step === 0 && (g.tracked.left && g.tracked.right)) {
      if (this.tutT > (this.handsXr ? 0.6 : 1.6)) this.advanceTutorial(0);
    } else if (step === 1 && (g.orbFormed || (v && v.active))) this.advanceTutorial(1);
    else if (step === 2 && v && v.size > 0.5) this.advanceTutorial(2);
  }
  private tutText(): string {
    const s = TUTORIAL[this.tutStep];
    if (!s) return '';
    return 'Step ' + (this.tutStep + 1) + ' of ' + TUTORIAL.length + ':  ' + (this.handsXr || this.presenting ? s.xr : s.desk);
  }

  // ---------------------------------------------------------------- run end
  private finishRun(b: Battle): void {
    this.resultWin = b.over === 'win';
    this.paused = true;
    sfx.spellVoice(0, 0);
    const st = this.save;
    st.accuracy.casts += b.stats.casts;
    st.accuracy.hits += b.stats.hits;
    if (this.run === 'campaign' && this.resultWin && b.boss) {
      const id = b.boss.def.id;
      const idx = BOSS_ORDER.indexOf(id);
      if (idx >= 0 && idx + 1 > st.campaign) st.campaign = idx + 1;
      const prev = st.bossBest[id];
      if (!prev || b.stats.time < prev) st.bossBest[id] = Math.round(b.stats.time);
      this.resultNote = b.boss.def.name + ' defeated in ' + Math.round(b.stats.time) + ' s';
      if (st.campaign >= BOSS_ORDER.length) this.resultNote += '. All three realms are awake.';
    } else if (this.run === 'campaign') this.resultNote = (b.boss?.def.name ?? 'The boss') + ' still stands. Learn his phases and try again.';
    else if (this.run === 'bossrush') {
      this.resultNote = this.resultWin ? 'All three bosses defeated' : 'You fell in the rush';
      if (this.resultWin) for (const id of BOSS_ORDER) st.bossBest[id] ||= 1;
    } else if (this.run === 'endless') {
      st.bestWave = Math.max(st.bestWave, b.stats.wave);
      this.resultNote = 'You reached wave ' + b.stats.wave + (b.stats.wave >= st.bestWave ? '  (best)' : '');
    } else if (this.run === 'trial') this.resultNote ||= this.resultWin ? 'Trial complete' : 'Trial failed';
    this.persist();
    this.setScreen('result');
  }

  // ---------------------------------------------------------------- music
  private updateMusic(b: Battle, dt: number): void {
    const threat = Math.min(1, b.alive().length * 0.18 + b.eProj.length * 0.12 + (b.boss && !b.boss.dead ? 0.55 : 0));
    musicState.tension += (threat - musicState.tension) * Math.min(1, dt * 1.2);
    const bossOn = b.boss && !b.boss.dead ? 1 : 0;
    musicState.jam += (bossOn - musicState.jam) * Math.min(1, dt * 0.8);
  }

  // ================================================================== visuals
  private hideHud(keepStatus = false): void {
    this.hudBoss.mesh.visible = false;
    this.hudHint.mesh.visible = false;
    this.hudBanner.mesh.visible = false;
    this.hudStatus.mesh.visible = keepStatus && false;
    for (const s of this.sigils) s.mesh.visible = false;
    for (const b of this.extra) b.panel.mesh.visible = false;
    this.castGroup.visible = false;
    this.castBeam.visible = false;
    this.castBeamHit.visible = false;
    this.shield.visible = false;
    sfx.spellVoice(0, 0);
  }
  private ambientMenu(dt: number): void {
    // drifting motes in the sanctum behind the menu
    if (Math.random() < dt * 14 * this.sparks.density) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      this.sparks.emit(Math.cos(a) * r, 0.1, -2 - Math.abs(Math.sin(a)) * r, 0, 0.35, 0, [0xb48cff, 0x7fd8ff, 0xff9a40][(Math.random() * 3) | 0], 0.05, 5, 0, 0);
    }
  }
  private clearVisuals(): void {
    for (const v of this.projVis.values()) this.root.remove(v.g);
    this.projVis.clear();
    for (const v of this.enemyVis.values()) this.root.remove(v.holder);
    this.enemyVis.clear();
    for (const v of this.areaVis.values()) this.root.remove(v.g);
    this.areaVis.clear();
    if (this.bossVis) {
      this.root.remove(this.bossVis.holder);
      this.bossVis = null;
    }
    for (const r of this.ringVis) r.visible = false;
    this.castGroup.visible = false;
    this.castBeam.visible = false;
    this.castBeamHit.visible = false;
    this.beamUntil = 0;
    this.telegraphRing.visible = false;
  }

  /** sync meshes with the simulation */
  private syncVisuals(dt: number, live: boolean): void {
    const b = this.battle;
    if (!b) return;
    const t = this.time;
    // enemies
    const seen = new Set<number>();
    for (const e of b.enemies) {
      seen.add(e.id);
      let v = this.enemyVis.get(e.id);
      if (!v) {
        const holder = new Group();
        const rig = buildEnemy(e.def);
        holder.add(rig.group);
        const ring = new Mesh(new RingGeometry(0.85, 1, 36), new MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        holder.add(ring);
        const shell = new Mesh(new SphereGeometry(0.6, 14, 10), new MeshBasicMaterial({ color: 0xaee6ff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }));
        shell.position.y = 0.7;
        shell.visible = false;
        holder.add(shell);
        holder.scale.setScalar(e.def.scale);
        this.root.add(holder);
        v = { holder, rig, ring, shell, id: e.def.id, lastHp: e.hp };
        this.enemyVis.set(e.id, v);
        this.sparks.burst(e.pos[0], e.pos[1] + 0.8, e.pos[2], e.def.hex, 24, 1.5, 0.06, 0.8);
      }
      v.holder.position.set(e.pos[0], e.pos[1], e.pos[2]);
      v.holder.rotation.y = Math.atan2(this.head.pos[0] - e.pos[0], this.head.pos[2] - e.pos[2]);
      if (e.hp < v.lastHp - 0.01) v.rig.flash();
      v.lastHp = e.hp;
      const frozen = (e.status.freeze ?? 0) > 0;
      const burning = (e.status.burn ?? 0) > 0;
      v.rig.tick(live ? dt : 0, t, { tele: e.telegraph, frozen, burning, rooted: (e.status.root ?? 0) > 0, hpFrac: e.hp / e.maxHp, armor: e.armorHp > 0 });
      v.shell.visible = frozen;
      (v.ring.material as MeshBasicMaterial).opacity = e.telegraph > 0 ? 0.55 + Math.sin(t * 20) * 0.3 : 0;
      v.ring.scale.setScalar(1.2 + (e.telegraph > 0 ? Math.sin(t * 9) * 0.1 : 0));
      if (e.state === 'die') v.holder.scale.setScalar(Math.max(0.01, e.def.scale * Math.max(0, e.stateT) * 1.5));
      if (live && burning && Math.random() < 0.5 * this.sparks.density) this.sparks.emit(e.pos[0] + (Math.random() - 0.5) * 0.4, e.pos[1] + 0.4 + Math.random() * 0.6, e.pos[2] + (Math.random() - 0.5) * 0.4, 0, 1.2, 0, 0xff7a1a, 0.07, 0.5);
      if (live && (e.status.stun ?? 0) > 0 && Math.random() < 0.4) this.sparks.emit(e.pos[0] + Math.cos(t * 9) * 0.3, e.pos[1] + 1.4 * e.def.scale, e.pos[2] + Math.sin(t * 9) * 0.3, 0, 0, 0, 0xfff2a0, 0.06, 0.3);
      if (live && (e.status.root ?? 0) > 0 && Math.random() < 0.4) this.sparks.emit(e.pos[0] + (Math.random() - 0.5) * 0.5, 0.05, e.pos[2] + (Math.random() - 0.5) * 0.5, 0, 0.8, 0, 0x58e07a, 0.07, 0.6);
    }
    for (const [id, v] of this.enemyVis) {
      if (!seen.has(id)) {
        this.root.remove(v.holder);
        this.enemyVis.delete(id);
      }
    }
    // boss
    if (b.boss) {
      const bs = b.boss;
      if (!this.bossVis || this.bossVis.id !== bs.def.id) {
        if (this.bossVis) this.root.remove(this.bossVis.holder);
        const holder = new Group();
        const rig = buildBoss(bs.def);
        holder.add(rig.group);
        holder.scale.setScalar(bs.def.scale);
        const barrier = new Mesh(new SphereGeometry(0.75, 20, 14), new MeshBasicMaterial({ color: 0x8aa0ff, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
        barrier.position.y = 0.6;
        holder.add(barrier);
        const tele = new Mesh(new RingGeometry(0.6, 0.7, 40), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
        tele.position.y = 0.6;
        holder.add(tele);
        this.root.add(holder);
        this.bossVis = { holder, rig, id: bs.def.id, barrier, lastHp: bs.hp, tele };
      }
      const bv = this.bossVis;
      bv.holder.position.set(bs.pos[0], bs.pos[1], bs.pos[2]);
      bv.holder.rotation.y = Math.atan2(this.head.pos[0] - bs.pos[0], this.head.pos[2] - bs.pos[2]);
      if (bs.hp < bv.lastHp - 0.01) bv.rig.flash(Math.min(1, (bv.lastHp - bs.hp) / 40));
      bv.lastHp = bs.hp;
      const tele = bs.winding ? Math.max(0, bs.winding.dur - bs.winding.t) : 0;
      const w = bs.winding;
      bv.rig.tick(live ? dt : 0, t, { tele, frozen: false, burning: false, rooted: false, hpFrac: bs.hp / bs.maxHp, armor: bs.armorHp > 0, phase: bs.phase, kind: w?.kind, teleDur: w?.dur, trans: bs.trans, dead: bs.dead, deathK: bs.dead ? Math.min(1, bs.deathT / 4.2) : 0, vuln: bs.vuln > 0, barrier: bs.barrier, elHex: w?.el ? ELEMENT_HEX[w.el] : undefined });
      if (live) {
        this.runEmitters(bv.rig.emitters, dt);
        this.bossCues(bv.rig, bs.def.hex);
      }
      (bv.barrier.material as MeshBasicMaterial).opacity = bs.barrier ? 0.28 + Math.sin(t * 8) * 0.08 : 0;
      (bv.tele.material as MeshBasicMaterial).opacity = tele > 0 ? 0.7 : 0;
      (bv.tele.material as MeshBasicMaterial).color.setHex(bs.def.hex);
      bv.tele.scale.setScalar(1 + (tele > 0 ? (1 - tele) * 1.2 : 0));
      bv.tele.lookAt(this.head.pos[0], this.head.pos[1], this.head.pos[2]);
      if (bs.dead && bs.deathT > 3.6) bv.holder.scale.setScalar(Math.max(0.01, bs.def.scale * Math.max(0, 1 - (bs.deathT - 3.6) / 0.9)));
      this.bossPylons(b);
    } else if (this.bossVis) {
      this.root.remove(this.bossVis.holder);
      this.bossVis = null;
    }
    // projectiles
    const pseen = new Set<number>();
    const list: Proj[] = [...b.pProj, ...b.eProj];
    for (const p of list) {
      pseen.add(p.id);
      let v = this.projVis.get(p.id);
      if (!v) {
        v = this.makeProj(p);
        this.projVis.set(p.id, v);
        this.root.add(v.g);
      }
      v.g.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (v.kind === 'spear') v.g.lookAt(p.pos[0] + p.vel[0], p.pos[1] + p.vel[1], p.pos[2] + p.vel[2]);
      v.g.rotation.z += dt * 3;
      if (live) {
        const hex = ELEMENT_HEX[p.element];
        this.sparks.emit(p.pos[0] + (Math.random() - 0.5) * 0.08, p.pos[1] + (Math.random() - 0.5) * 0.08, p.pos[2] + (Math.random() - 0.5) * 0.08, -p.vel[0] * 0.05, -p.vel[1] * 0.05 + 0.1, -p.vel[2] * 0.05, hex, Math.max(0.05, p.radius * 0.35), 0.45);
        if (p.owner === 'enemy' && Math.random() < 0.3) this.sparks.emit(p.pos[0], p.pos[1], p.pos[2], 0, 0.3, 0, 0xffffff, 0.04, 0.3);
      }
    }
    for (const [id, v] of this.projVis) {
      if (!pseen.has(id)) {
        this.root.remove(v.g);
        this.projVis.delete(id);
      }
    }
    // areas
    const aseen = new Set<number>();
    for (const a of b.areas) {
      aseen.add(a.id);
      let v = this.areaVis.get(a.id);
      if (!v) {
        v = this.makeArea(a);
        this.areaVis.set(a.id, v);
        this.root.add(v.g);
        sfx.spellCast(ELIDX[a.spell.elements[a.spell.elements.length - 1]], 1.2, this.pan(a.pos[0]));
      }
      this.updateArea(v, a, t, live);
    }
    for (const [id, v] of this.areaVis) {
      if (!aseen.has(id)) {
        this.root.remove(v.g);
        this.areaVis.delete(id);
      }
    }
    // shock rings
    this.ringVis.forEach((m, i) => {
      const r = b.rings[i];
      m.visible = !!r && !r.hit;
      if (r && b.boss) {
        m.position.set(b.boss.pos[0], 0.06, b.boss.pos[2]);
        m.scale.setScalar(Math.max(0.1, r.r));
        const close = r.arrive < 0.6;
        (m.material as MeshBasicMaterial).color.setHex(close ? 0xffd98c : b.boss.def.hex);
        if (live && Math.random() < 0.6) this.sparks.emit(this.head.pos[0] + (Math.random() - 0.5) * 3, 0.1, this.head.pos[2] - 0.4 + r.arrive * 0.3, 0, 0.5, 0, 0xffd98c, 0.05, 0.4);
      }
    });
    // shield dome
    const g = this.gOut;
    const up = b.player.shieldUp;
    this.shield.visible = up || this.shieldFlash > 0;
    this.shield.position.set(this.head.pos[0], this.head.pos[1] - 0.3, this.head.pos[2] - 0.55);
    const frac = b.player.shieldHp / SHIELD_HP;
    this.shieldMat.color.setHex(frac > 0.5 ? 0x8ab4ff : frac > 0.25 ? 0xffd98c : 0xff7a7a);
    this.shieldMat.opacity = (up ? 0.55 : 0) + this.shieldFlash * 1.2;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    void g;
    // damage vignette: never a hard flash
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    (this.vignette.material as MeshBasicMaterial).opacity = Math.min(0.75, this.hurtFlash);
    this.bossHit = Math.max(0, this.bossHit - dt);
    this.flashA = Math.max(0, this.flashA - dt * 2);
    // telegraph: a ground ring for the nearest winding enemy
    this.telegraphRing.visible = false;
    if (this.persistT > 0) {
      this.persistT -= dt;
      if (this.persistT <= 0) this.persist();
    }
  }

  /** world-space particle sockets on rigs (chimneys, hands, hearts) */
  private runEmitters(list: Emitter[], dt: number): void {
    const d = this.sparks.density;
    for (const e of list) {
      if (!e.on || e.rate <= 0) continue;
      e.acc += e.rate * dt * d;
      if (e.acc < 1) continue;
      e.obj.getWorldPosition(this.tmpV);
      while (e.acc >= 1) {
        e.acc -= 1;
        const sp = e.spread;
        this.sparks.emit(this.tmpV.x + (Math.random() - 0.5) * sp * 0.3, this.tmpV.y + (Math.random() - 0.5) * sp * 0.3, this.tmpV.z + (Math.random() - 0.5) * sp * 0.3, e.vel[0] + (Math.random() - 0.5) * sp, e.vel[1] + (Math.random() - 0.5) * sp, e.vel[2] + (Math.random() - 0.5) * sp, e.hex, e.size * (0.7 + Math.random() * 0.6), e.life * (0.7 + Math.random() * 0.6), e.grav);
      }
    }
  }
  /** one-shot rig cues: landing slams, roars, shattering blades, breaking seals */
  private bossCues(rig: BossRig, hex: number): void {
    if (!rig.cues.length) return;
    rig.cueAt.getWorldPosition(this.tmpV);
    const b = this.battle;
    const bx = b?.boss ? b.boss.pos[0] : this.tmpV.x;
    const bz = b?.boss ? b.boss.pos[2] : this.tmpV.z;
    for (const c of rig.cues) {
      if (c === 'slam' || c === 'release-slam') {
        this.sparks.ring(bx, 0.08, bz + 1.2, 1.6, 0xffb060, 48, 0.1, 1.0);
        this.sparks.burst(bx, 0.3, bz + 1.5, 0xff7a1a, 40, 3.2, 0.09, 1.1, 3, 1.5);
        this.envPulse = Math.max(this.envPulse, 1);
        sfAudio.event('slam', [bx, 0.2, bz + 1.5], 1);
      } else if (c === 'land') {
        this.sparks.ring(bx, 0.08, bz, 2.2, hex, 64, 0.1, 1.2);
        this.sparks.burst(this.tmpV.x, this.tmpV.y, this.tmpV.z, hex, 60, 3.4, 0.09, 1.2);
        this.envPulse = Math.max(this.envPulse, 1);
        sfAudio.event('land', [bx, 1.5, bz], 1);
      } else if (c === 'roar' || c === 'seal') {
        this.sparks.burst(this.tmpV.x, this.tmpV.y, this.tmpV.z, hex, 50, 2.6, 0.08, 1.2);
        if (c === 'seal') this.sparks.ring(bx, 2.4, bz, 2.6, 0xe0c8ff, 60, 0.08, 1.4);
      } else if (c === 'shatter') {
        this.sparks.burst(this.tmpV.x, this.tmpV.y + 0.4, this.tmpV.z, 0xc3ceff, 40, 2.8, 0.07, 1.0, 4);
        sfAudio.event('shatter', [this.tmpV.x, this.tmpV.y, this.tmpV.z], 0.8);
      } else if (c === 'implode') {
        this.sparks.burst(this.tmpV.x, this.tmpV.y, this.tmpV.z, 0xffffff, 90, 5, 0.1, 1.6);
      }
    }
    rig.cues.length = 0;
  }
  private envPulse = 0;
  private bossPylons(b: Battle): void {
    b.pylons.forEach((p, i) => this.arena.setPylon(i, p.overload, !!b.boss?.barrier));
  }

  private makeProj(p: Proj): { g: Group; kind: string; el: Element; r: number } {
    const g = new Group();
    const hex = ELEMENT_HEX[p.element];
    const r = Math.max(0.06, p.radius);
    let kind = 'orb';
    if (p.owner === 'player' && p.spell && p.spell.kind === 'spear') {
      kind = 'spear';
      const cone = new Mesh(new ConeGeometry(r * 0.35, r * 3.2, 6), new MeshBasicMaterial({ color: 0xdff6ff }));
      cone.geometry.rotateX(-Math.PI / 2);
      g.add(cone);
    } else if (p.kind === 'shadowOrb' || (p.owner === 'player' && p.element === 'shadow')) {
      g.add(new Mesh(new SphereGeometry(r * 0.7, 14, 10), new MeshBasicMaterial({ color: 0x0a0414 })));
      const rim = new Mesh(new TorusGeometry(r * 0.85, r * 0.08, 6, 24), new MeshBasicMaterial({ color: hex, blending: AdditiveBlending, transparent: true, opacity: 0.9 }));
      g.add(rim);
    } else if (p.kind === 'bolt') {
      const bolt = new Mesh(new OctahedronGeometry(r * 0.8, 0), new MeshBasicMaterial({ color: 0xe8ecff }));
      bolt.scale.z = 2.4;
      g.add(bolt);
    } else {
      g.add(new Mesh(new IcosahedronGeometry(r * 0.7, 2), new MeshBasicMaterial({ color: p.owner === 'enemy' ? hex : 0xffffff })));
      if (p.kind === 'elementBurst') {
        const ring = new Mesh(new TorusGeometry(r, r * 0.07, 6, 28), new MeshBasicMaterial({ color: hex, blending: AdditiveBlending, transparent: true }));
        g.add(ring);
      }
    }
    g.add(glowSprite(hex, r * 3.4, 0.85));
    return { g, kind, el: p.element, r };
  }

  private makeArea(a: Area): { g: Group; a: Area; parts: Mesh[]; seed: number } {
    const g = new Group();
    const parts: Mesh[] = [];
    const el = a.spell.elements[a.spell.elements.length - 1];
    const hex = ELEMENT_HEX[el];
    g.position.set(a.pos[0], 0, a.pos[2]);
    const ring = new Mesh(new RingGeometry(0.92, 1, 56), new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.85, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    parts.push(ring);
    if (a.kind === 'nova') {
      const dome = new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }));
      g.add(dome);
      parts.push(dome);
    } else if (a.kind === 'void') {
      const orb = new Mesh(new SphereGeometry(0.5, 20, 14), new MeshBasicMaterial({ color: 0x06020c }));
      orb.position.y = 1;
      const rim = new Mesh(new TorusGeometry(0.62, 0.05, 8, 40), new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, blending: AdditiveBlending }));
      rim.position.y = 1;
      g.add(orb, rim);
      parts.push(orb, rim);
    } else if (a.kind === 'vines' || a.kind === 'prison') {
      for (let i = 0; i < 9; i++) {
        const geo = a.kind === 'vines' ? new ConeGeometry(0.07, 1.2, 5) : new ConeGeometry(0.12, 1.6, 5);
        const m = new Mesh(geo, new MeshBasicMaterial({ color: a.kind === 'vines' ? 0x58e07a : 0xbfeaff, transparent: a.kind === 'prison', opacity: 0.9 }));
        const ang = (i / 9) * Math.PI * 2;
        const rad = (0.2 + 0.7 * ((i * 37) % 10) / 10) * a.radius;
        m.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
        m.rotation.z = (Math.random() - 0.5) * 0.7;
        m.rotation.x = (Math.random() - 0.5) * 0.7;
        g.add(m);
        parts.push(m);
      }
    }
    return { g, a, parts, seed: Math.random() * 10 };
  }
  private updateArea(v: { g: Group; a: Area; parts: Mesh[]; seed: number }, a: Area, t: number, live: boolean): void {
    const k = Math.min(1, a.age / Math.max(0.01, a.dur));
    const el = a.spell.elements[a.spell.elements.length - 1];
    const hex = ELEMENT_HEX[el];
    const fade = 1 - Math.max(0, (k - 0.7) / 0.3);
    const ring = v.parts[0];
    ring.scale.setScalar(a.radius * (a.kind === 'nova' ? Math.min(1, a.age * 2.2) : 1));
    (ring.material as MeshBasicMaterial).opacity = 0.85 * fade;
    if (a.kind === 'nova') {
      const dome = v.parts[1];
      const s = a.radius * Math.min(1, a.age * 2.2);
      dome.scale.setScalar(s);
      dome.position.y = s * 0.2;
      (dome.material as MeshBasicMaterial).opacity = 0.4 * (1 - Math.min(1, a.age / a.dur));
    } else if (a.kind === 'void') {
      v.parts[1].scale.setScalar(1 + Math.sin(t * 6) * 0.1);
      v.parts[2].rotation.x = t * 2;
      v.parts[2].rotation.y = t * 1.3;
    } else if (a.kind === 'vines' || a.kind === 'prison') {
      for (let i = 1; i < v.parts.length; i++) {
        const grow = Math.min(1, a.age * 3 - i * 0.05);
        v.parts[i].scale.y = Math.max(0.01, grow) * fade;
        v.parts[i].position.y = 0.6 * Math.max(0.01, grow) * fade;
      }
    }
    if (live && Math.random() < 0.7 * this.sparks.density) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * a.radius;
      this.sparks.emit(a.pos[0] + Math.cos(ang) * r, 0.1 + Math.random() * (a.kind === 'cloud' ? 1.8 : 0.8), a.pos[2] + Math.sin(ang) * r, 0, 0.6, 0, hex, 0.09, 0.8);
    }
  }

  // ---------------------------------------------------------------- hand visuals
  private updateHandVisuals(on: boolean): void {
    const els: Element[] = [this.caster.left, this.caster.right];
    for (let i = 0; i < 2; i++) {
      const hv = this.handVis[i];
      const f = this.frames[i];
      const show = on && !!f;
      hv.glow.visible = show;
      hv.ring.visible = show;
      hv.letter.mesh.visible = show && this.save.settings.colourCues;
      if (!show || !f) continue;
      const hex = ELEMENT_HEX[els[i]];
      hv.glow.position.set(f.palm[0], f.palm[1], f.palm[2]);
      (hv.glow.material as { color: Color }).color.setHex(hex);
      hv.ring.position.set(f.palm[0] + f.normal[0] * 0.03, f.palm[1] + f.normal[1] * 0.03, f.palm[2] + f.normal[2] * 0.03);
      this.tmpV.set(f.normal[0], f.normal[1], f.normal[2]);
      this.tmpQ.setFromUnitVectors(this.tmpV2.set(0, 0, 1), this.tmpV);
      hv.ring.quaternion.copy(this.tmpQ);
      hv.ringMat.color.setHex(hex);
      hv.ring.rotateZ(this.time * (i ? -1 : 1));
      hv.letter.mesh.position.set(f.palm[0], f.palm[1] + 0.12, f.palm[2]);
      hv.letter.mesh.lookAt(this.head.pos[0], this.head.pos[1], this.head.pos[2]);
      const key = els[i] + i;
      if ((hv.letter as unknown as { key?: string }).key !== key) {
        (hv.letter as unknown as { key?: string }).key = key;
        const c = hv.letter.ctx;
        c.clearRect(0, 0, 64, 64);
        elementDot(hv.letter, 32, 32, 26, els[i], true);
        hv.letter.commit();
      }
    }
  }

  private updateCastVisuals(dt: number, v: CastView): void {
    const t = this.time;
    const hex = this.blendHex(v.elements);
    const hex2 = ELEMENT_HEX[v.elements[1]];
    const L = this.frames[0];
    const R = this.frames[1];
    sfx.spellVoice(v.active && v.mode !== 'none' ? Math.max(0.1, v.charge) : 0, ELIDX[v.elements[0]]);
    const beamOn = this.beamUntil > this.time;
    this.castGroup.visible = v.active && v.mode !== 'none';
    this.castBeam.visible = beamOn;
    this.castBeamHit.visible = false;
    for (const m of this.castArc) m.visible = false;
    this.castCore.visible = this.castHalo.visible = this.castRing.visible = false;
    this.castSpear.visible = false;
    this.castGround.visible = false;
    const b = this.battle;
    if (beamOn && b) {
      const o = this.beamOrigin;
      const d = this.beamDir;
      const hit = b.raycast(o, d, 40, 0.28);
      const len = hit.t;
      this.tmpV.set(d[0], d[1], d[2]);
      this.tmpQ.setFromUnitVectors(this.up, this.tmpV);
      this.castBeam.quaternion.copy(this.tmpQ);
      this.castBeam.position.set(o[0] + d[0] * len * 0.5, o[1] + d[1] * len * 0.5, o[2] + d[2] * len * 0.5);
      this.castBeamCore.scale.set(0.8 + Math.sin(t * 40) * 0.2, len, 0.8 + Math.sin(t * 40) * 0.2);
      this.castBeamOut.scale.set(1 + this.beamPower * 0.6 + Math.sin(t * 25) * 0.15, len, 1 + this.beamPower * 0.6);
      (this.castBeamOut.material as MeshBasicMaterial).color.setHex(ELEMENT_HEX.aether);
      this.castBeamHit.visible = hit.kind !== 'none';
      this.castBeamHit.position.set(hit.point[0], hit.point[1], hit.point[2]);
      this.castBeamHit.scale.setScalar(0.5 + Math.sin(t * 30) * 0.1);
    }
    if (!this.castGroup.visible) return;
    const pos = v.pos;
    this.castGroup.position.set(0, 0, 0);
    const reduced = this.save.settings.reducedIntensity;
    const pulse = 1 + Math.sin(t * (reduced ? 4 : 10)) * 0.06;
    if (v.mode === 'orb') {
      const r = (0.025 + v.size * 0.11) * pulse * (1 + v.overcharge * 0.35);
      this.castCore.visible = this.castHalo.visible = this.castRing.visible = true;
      this.castCore.position.set(pos[0], pos[1], pos[2]);
      this.castCore.scale.setScalar(r * 0.62);
      (this.castCore.material as MeshBasicMaterial).color.setHex(hex).lerp(new Color(0xffffff), 0.3);
      this.castHalo.position.copy(this.castCore.position);
      this.castHalo.scale.setScalar(r * 5);
      (this.castHalo.material as { color: Color }).color.setHex(hex);
      this.castRing.position.copy(this.castCore.position);
      this.castRing.scale.setScalar(r * 1.9);
      this.castRing.rotation.set(t * 1.4, t * 2.1, 0);
      (this.castRing.material as MeshBasicMaterial).color.setHex(hex2);
      if (Math.random() < 0.8 * this.sparks.density) {
        const a = Math.random() * Math.PI * 2;
        const rr2 = r * 2.4;
        const px = pos[0] + Math.cos(a) * rr2;
        const py = pos[1] + Math.sin(a) * rr2;
        this.sparks.emit(px, py, pos[2] + (Math.random() - 0.5) * 0.1, (pos[0] - px) * 2.5, (pos[1] - py) * 2.5, 0, Math.random() < 0.5 ? hex : hex2, 0.04, 0.4);
      }
      if (v.overcharged && Math.random() < 0.6) this.sparks.burst(pos[0], pos[1], pos[2], 0xffffff, 2, 0.8, 0.05, 0.4);
    } else if (v.mode === 'spear') {
      this.castSpear.visible = this.castHalo.visible = true;
      this.castSpear.position.set(pos[0], pos[1], pos[2]);
      this.tmpV.set(pos[0] + v.dir[0], pos[1] + v.dir[1], pos[2] + v.dir[2]);
      this.castSpear.lookAt(this.tmpV);
      this.castSpear.scale.set(0.5 + v.size * 0.6, 0.5 + v.size * 0.6, 0.4 + v.size * 1.3);
      this.castHalo.position.copy(this.castSpear.position);
      this.castHalo.scale.setScalar(0.2 + v.size * 0.4);
      (this.castHalo.material as { color: Color }).color.setHex(hex);
      if (Math.random() < 0.5) this.sparks.emit(pos[0], pos[1], pos[2], (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, -0.2, 0xdff6ff, 0.03, 0.4);
    } else if (v.mode === 'arc' && L && R) {
      this.castHalo.visible = true;
      this.castHalo.position.set(pos[0], pos[1], pos[2]);
      this.castHalo.scale.setScalar(0.25 + v.size * 0.35);
      (this.castHalo.material as { color: Color }).color.setHex(hex);
      this.castArc.forEach((m, i) => {
        m.visible = true;
        const a = this.tmpV.set(L.palm[0], L.palm[1], L.palm[2]);
        const bpt = this.tmpV2.set(R.palm[0], R.palm[1], R.palm[2]);
        const mid = a.clone().add(bpt).multiplyScalar(0.5);
        mid.x += (Math.random() - 0.5) * 0.12;
        mid.y += (Math.random() - 0.5) * 0.12 + (i - 1) * 0.03;
        const len = a.distanceTo(bpt);
        m.position.copy(mid);
        this.tmpQ.setFromUnitVectors(this.up, bpt.clone().sub(a).normalize());
        m.quaternion.copy(this.tmpQ);
        m.scale.set(1 + Math.random(), len, 1 + Math.random());
      });
      if (Math.random() < 0.7) this.sparks.burst(pos[0], pos[1], pos[2], 0xe0e8ff, 2, 0.9, 0.04, 0.3);
    } else if (v.mode === 'vines') {
      this.castGround.visible = true;
      this.castGround.position.set(pos[0], 0.04, pos[2]);
      this.castGround.scale.setScalar(0.25 + v.size * 0.7);
      this.castHalo.visible = true;
      this.castHalo.position.set(pos[0], pos[1], pos[2]);
      this.castHalo.scale.setScalar(0.3);
      (this.castHalo.material as { color: Color }).color.setHex(hex);
      if (Math.random() < 0.7) this.sparks.emit(pos[0] + (Math.random() - 0.5) * 0.4, 0.05, pos[2] + (Math.random() - 0.5) * 0.4, 0, 0.9, 0, 0x58e07a, 0.06, 0.8);
    } else if (v.mode === 'void') {
      const r = (0.04 + v.size * 0.12) * pulse;
      this.castCore.visible = this.castRing.visible = this.castHalo.visible = true;
      this.castCore.position.set(pos[0], pos[1], pos[2]);
      this.castCore.scale.setScalar(r);
      (this.castCore.material as MeshBasicMaterial).color.setHex(0x06020c);
      this.castRing.position.copy(this.castCore.position);
      this.castRing.scale.setScalar(r * 1.6);
      this.castRing.rotation.set(t * 2, t, 0);
      (this.castRing.material as MeshBasicMaterial).color.setHex(0x9a5aff);
      this.castHalo.position.copy(this.castCore.position);
      this.castHalo.scale.setScalar(r * 4);
      (this.castHalo.material as { color: Color }).color.setHex(0x6a3aa8);
      if (Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2;
        this.sparks.emit(pos[0] + Math.cos(a) * r * 3, pos[1] + Math.sin(a) * r * 3, pos[2], -Math.cos(a) * 0.6, -Math.sin(a) * 0.6, 0, 0x9a5aff, 0.04, 0.5);
      }
    } else if (v.mode === 'beam') {
      this.castHalo.visible = true;
      this.castHalo.position.set(pos[0], pos[1], pos[2]);
      this.castHalo.scale.setScalar(0.15 + v.charge * 0.3);
      (this.castHalo.material as { color: Color }).color.setHex(hex);
    }
    void dt;
  }
  private blendHex(e: [Element, Element]): number {
    const a = new Color(ELEMENT_HEX[e[0]]);
    return a.lerp(new Color(ELEMENT_HEX[e[1]]), 0.5).getHex();
  }

  // ---------------------------------------------------------------- HUD
  private updateTrackingNotice(dt: number, g: GestureOut): void {
    const any = g.tracked.left || g.tracked.right;
    if (!any && (this.handsXr || this.presenting)) this.lostT += dt;
    else this.lostT = 0;
    this.lostShown = this.lostT > 1.2;
  }
  private updateHud(dt: number, b: Battle, v: CastView): void {
    const play = this.screen === 'play';
    this.hudStatus.mesh.visible = play;
    this.hudHint.mesh.visible = play;
    this.hudBoss.mesh.visible = play && !!b.boss;
    this.hudBanner.mesh.visible = play && this.bannerT > 0;
    for (const s of this.sigils) s.mesh.visible = play;
    this.statusAcc += dt;
    this.bossAcc += dt;
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      const k = Math.min(1, this.bannerT / 0.6, (this.bannerMax - this.bannerT) / 0.3);
      (this.hudBanner.mesh.material as MeshBasicMaterial).opacity = Math.max(0, k);
      if (this.bannerT <= 0) {
        this.bannerText = '';
        this.drawBanner();
      }
    }
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) {
        this.subText = '';
        this.lastHint = '\u0000';
      }
    }
    // sigil highlight and positions follow the head so the rails stay at the sides
    const hx = this.head.pos[0];
    const hy = this.head.pos[1];
    const hz = this.head.pos[2];
    this.sigilHot = Math.max(0, this.sigilHot - dt);
    for (const sg of this.sigils) {
      const sel = (sg.side === 'left' ? this.caster.left : this.caster.right) === sg.el;
      const idx = ELEMENTS.indexOf(sg.el);
      sg.mesh.position.set(hx + (sg.side === 'left' ? -0.52 : 0.52), hy - 0.18 - idx * 0.115 + 0.35, hz - 0.42);
      sg.mesh.scale.setScalar(sel ? 1.25 + Math.sin(this.time * 5) * 0.05 : 0.85);
      (sg.mesh.material as MeshBasicMaterial).opacity = sel ? 1 : 0.55;
      // fingertip touch: the index tip of either hand selects the element on that rail
      for (const f of this.frames) {
        if (!f || !this.handsXr) continue;
        const tip = f.tips[1];
        if (Math.hypot(tip[0] - sg.mesh.position.x, tip[1] - sg.mesh.position.y, tip[2] - sg.mesh.position.z) < 0.055 && !sel && this.sigilCd <= 0) {
          this.sigilCd = 0.5;
          this.attune(sg.side, sg.el);
        }
      }
    }
    this.sigilCd = Math.max(0, this.sigilCd - dt);
    // reposition the status, hint, extra buttons around the head
    this.hudStatus.mesh.position.set(hx - 0.66, hy - 0.2, hz - 0.78);
    // in a headset the hint sits low, under the action; on a flat screen it must stay inside the frame
    const flat = !this.presenting && !this.handsXr;
    this.hudHint.mesh.position.set(hx, hy - (flat ? 0.4 : 0.72), hz - 0.95);
    this.hudHint.mesh.rotation.x = flat ? -0.25 : -0.55;
    this.extra[0].panel.mesh.position.set(hx - 0.66, hy + 0.2, hz - 0.7);
    this.extra[1].panel.mesh.position.set(hx + 0.7, hy + 0.2, hz - 0.75);
    this.extra[2].panel.mesh.position.set(hx + 0.7, hy + 0.08, hz - 0.75);
    this.extra[3].panel.mesh.position.set(hx + 0.7, hy - 0.04, hz - 0.75);
    if (this.statusAcc > 0.08) {
      this.statusAcc = 0;
      this.drawStatus(b, v);
      this.drawHint(b, v);
    }
    if (this.bossAcc > 0.1) {
      this.bossAcc = 0;
      this.drawBossBar(b);
    }
    this.drawExtraIfNeeded();
  }
  private sigilCd = 0;
  private extraKey = '';
  private drawExtraIfNeeded(): void {
    const k = this.screen + this.run + this.sandboxPick;
    if (k !== this.extraKey) {
      this.extraKey = k;
      this.drawExtra();
    }
  }
  private statusKey = '';
  private drawStatus(b: Battle, v: CastView): void {
    const pl = b.player;
    const key = [Math.round(pl.hp), Math.round(pl.shieldHp / 4), Math.round(this.caster.energy / 2), v.elements.join(), v.spell.id, this.save.settings.colourCues, Math.round(v.charge * 10), v.overcharged].join('|');
    if (key === this.statusKey) return;
    this.statusKey = key;
    const p = this.hudStatus;
    const c = p.ctx;
    p.card('rgba(10,6,26,0.78)', '#6a50b0');
    const bar = (y: number, frac: number, col: string, label: string): void => {
      line(p, label, y - 8, 26, '#d9ccf2', 24, 'left', 600);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      rr(c, 24, y, p.w - 48, 26, 13);
      c.fill();
      c.fillStyle = col;
      rr(c, 24, y, Math.max(26, (p.w - 48) * Math.max(0, Math.min(1, frac))), 26, 13);
      c.fill();
    };
    bar(66, pl.hp / pl.maxHp, pl.hp / pl.maxHp > 0.35 ? '#ff6a78' : '#ff2a3a', 'LIFE ' + Math.round(pl.hp));
    bar(126, pl.shieldHp / SHIELD_HP, '#8ab4ff', 'SHIELD');
    bar(186, this.caster.energy / this.caster.maxEnergy, '#ffd98c', 'ENERGY' + (this.caster.infinite ? '  (free)' : ''));
    line(p, 'LEFT', 232, 22, '#a894d6', 70, 'center', 600);
    line(p, 'RIGHT', 232, 22, '#a894d6', p.w - 70, 'center', 600);
    elementDot(p, 70, 272, 28, v.elements[0], true);
    elementDot(p, p.w - 70, 272, 28, v.elements[1], true);
    line(p, v.spell.name, 276, 30, '#fff3d0');
    if (v.charge > 0.02) {
      c.fillStyle = 'rgba(255,255,255,0.12)';
      rr(c, 120, 300, p.w - 240, 12, 6);
      c.fill();
      c.fillStyle = v.overcharged ? '#ffffff' : '#c9a8ff';
      rr(c, 120, 300, Math.max(12, (p.w - 240) * v.charge), 12, 6);
      c.fill();
    }
    line(p, v.elements[0] === v.elements[1] ? ELEMENT_NAME[v.elements[0]] : 'Fusion', 346, 22, '#a894d6', p.w / 2, 'center', 600);
    // quick reference of the discovered fusions count
    line(p, 'Fusions ' + this.caster.discovered.size + '/' + FUSIONS.length, 460, 22, '#a894d6', p.w / 2, 'center', 600);
    p.commit();
  }
  private drawHint(b: Battle, v: CastView): void {
    let text = '';
    let sub = '';
    if (this.lostShown) text = 'Hand tracking lost: bring your hands back into view';
    else if (this.tutStep >= 0) text = this.tutText();
    else if (this.subText && this.save.settings.subtitles) text = this.subText;
    else if (v.hint) text = v.hint;
    else {
      const boss = b.boss;
      if (boss && !boss.dead) {
        const ph = boss.def.phases[boss.phase];
        text = ph.note;
      } else if (this.run === 'trial') text = this.trialNote;
      else if (this.run === 'endless') text = 'Wave ' + b.stats.wave + '   Kills ' + b.stats.kills;
      else text = this.handsXr || this.presenting ? 'Touch a sigil to change element. Cross your wrists to shield.' : 'Mouse: hold LEFT to charge, release to cast. SPACE or RIGHT = shield. Keys 1-6 = element (Shift = right hand, Alt = left). F = stomp. P = pause.';
    }
    if (this.save.settings.subtitles && this.subText && this.tutStep >= 0) sub = this.subText;
    const key = text + '|' + sub;
    if (key === this.lastHint) return;
    this.lastHint = key;
    const p = this.hudHint;
    p.card('rgba(10,6,26,0.78)', '#6a50b0');
    para(p, text, p.w / 2, 70, p.w - 80, 38, '#fff3d0', 1.2, 'center');
    if (sub) para(p, sub, p.w / 2, 150, p.w - 80, 28, '#ffd98c', 1.2, 'center');
    p.commit();
  }
  private bossKey = '';
  private drawBossBar(b: Battle): void {
    const bs = b.boss;
    if (!bs) return;
    const key = [Math.round(bs.hp / 4), bs.phase, bs.armorHp > 0 ? Math.round(bs.armorHp / 8) : 0, bs.barrier, bs.vuln > 0].join('|');
    if (key === this.bossKey) return;
    this.bossKey = key;
    const p = this.hudBoss;
    const c = p.ctx;
    c.clearRect(0, 0, p.w, p.h);
    line(p, bs.def.name + '  -  ' + bs.def.phases[bs.phase].name, 56, 60, '#fff3d0');
    c.fillStyle = 'rgba(10,4,24,0.92)';
    rr(c, 36, 76, p.w - 72, 50, 25);
    c.fill();
    c.strokeStyle = 'rgba(255,230,170,0.85)';
    c.lineWidth = 3;
    rr(c, 36, 76, p.w - 72, 50, 25);
    c.stroke();
    c.fillStyle = 'rgba(10,4,24,0.0)';
    rr(c, 40, 78, p.w - 80, 44, 22);
    c.fill();
    const frac = Math.max(0, bs.hp / bs.maxHp);
    const g = c.createLinearGradient(40, 0, p.w - 40, 0);
    g.addColorStop(0, '#ff3a4a');
    g.addColorStop(1, '#' + bs.def.hex.toString(16).padStart(6, '0'));
    c.fillStyle = g;
    rr(c, 44, 82, Math.max(36, (p.w - 88) * frac), 36, 18);
    c.fill();
    // phase thresholds
    c.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 1; i < bs.def.phases.length; i++) c.fillRect(44 + (p.w - 88) * bs.def.phases[i].below - 1, 78, 3, 44);
    if (bs.armorHp > 0) {
      const ph = bs.def.phases[bs.phase];
      c.fillStyle = 'rgba(180,220,255,0.9)';
      rr(c, 44, 126, Math.max(14, (p.w - 88) * Math.min(1, bs.armorHp / (ph.armor?.hp ?? 1)) * 0.5), 12, 6);
      c.fill();
      line(p, 'ARMOUR - breaks to ' + (ph.armor?.breakBy.map((e) => ELEMENT_NAME[e]).join(' / ') ?? ''), 160, 26, '#bfeaff', p.w / 2, 'center', 600);
    } else if (bs.barrier) line(p, 'BARRIER - overload the three pylons with lightning', 160, 26, '#a9b8ff', p.w / 2, 'center', 600);
    else if (bs.vuln > 0) line(p, 'EXPOSED', 160, 28, '#ffd98c', p.w / 2, 'center');
    p.commit();
  }

  // ================================================================== test hooks
  private bindHooks(): void {
    const w = window as unknown as Record<string, unknown>;
    w.__sf = () => {
      const b = this.battle;
      return {
        screen: this.screen,
        mode: modeState.mode,
        run: this.run,
        paused: this.paused,
        left: this.caster.left,
        right: this.caster.right,
        energy: Math.round(this.caster.energy),
        discovered: [...this.caster.discovered],
        counts: this.caster.counts,
        over: b?.over,
        hp: b ? Math.round(b.player.hp) : null,
        shield: b?.player.shieldUp,
        enemies: b ? b.alive().length : 0,
        kills: b?.stats.kills,
        casts: b?.stats.casts,
        wave: b?.stats.wave,
        boss: b?.boss ? { id: b.boss.def.id, hp: Math.round(b.boss.hp), max: b.boss.maxHp, phase: b.boss.phase, dead: b.boss.dead, armor: Math.round(b.boss.armorHp), barrier: b.boss.barrier } : null,
        proj: b ? b.pProj.length : 0,
        cam: [this.head.pos[0], this.head.pos[1], this.head.pos[2]],
        tut: this.tutStep,
        handsXr: this.handsXr,
        view: this.view ? { mode: this.view.mode, charge: +this.view.charge.toFixed(2), size: +this.view.size.toFixed(2), spell: this.view.spell.id } : null,
        save: { campaign: this.save.campaign, bestWave: this.save.bestWave, trials: this.save.trials, settings: this.save.settings },
        visuals: { enemies: this.enemyVis.size, proj: this.projVis.size, areas: this.areaVis.size, geometries: this.world.renderer.info.memory.geometries, textures: this.world.renderer.info.memory.textures },
      };
    };
    w.__sfPress = (id: number) => this.press(id);
    w.__sfStart = (kind: RunKind, arg?: string) => this.startRun(kind, arg);
    w.__sfAttune = (side: Side | 'both', e: Element) => this.attune(side, e);
    w.__sfInput = (o: { l?: boolean; r?: boolean; shield?: boolean; x?: number; y?: number }) => {
      if (o.l !== undefined) this.mouseL = o.l;
      if (o.r !== undefined) this.mouseR = o.r;
      if (o.shield !== undefined) this.keyShield = o.shield;
      if (o.x !== undefined) this.mouseX = o.x;
      if (o.y !== undefined) this.mouseY = o.y;
    };
    w.__sfInject = (f: [HandFrame | null, HandFrame | null] | null) => {
      this.injected = f;
    };
    w.__sfStep = (n: number, dt = 1 / 30) => {
      for (let i = 0; i < n; i++) this.tick(dt);
    };
    w.__sfBattle = () => this.battle;
    w.__sfCaster = () => this.caster;
    w.__sfLayout = () => this.btns.filter((b) => b.shown).map((b) => b.label);
  }
}

// ---- small helpers kept at the bottom

function drawBossLine(c: TextPanel, y: number, save: SfSave): void {
  const parts = BOSS_ORDER.map((id) => {
    const t = save.bossBest[id];
    return BOSSES[id].name + (t ? '  ' + t + ' s' : '  -');
  });
  line(c, 'Boss records:   ' + parts.join('     '), y, 26, '#a894d6', c.w / 2, 'center', 600);
  void REALMS;
}
void Mesh;
void pill;
