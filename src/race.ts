/**
 * GEAR SHIFT: NEON OVERDRIVE - the racer half of the GearShift station.
 * RaceSim (racelogic.ts) is the deterministic rules engine; RaceWorld draws the scrolling night world;
 * RaceAudio (gsaudio.ts) is the procedural engine and synthwave score. This system wires input, camera, HUD,
 * menu, results and saves together. The workshop bench (gearshift.ts) hides itself while this is on screen.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  TorusGeometry,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  createSystem,
  type Entity,
} from '@iwsdk/core';
import { RaceAudio, raceAudio } from './gsaudio.js';
import { NEON, RACE_Y, gsStage } from './gsstage.js';
import { raceRoom, modeState } from './mode.js';
import { TextPanel, FONT } from './panel.js';
import {
  ACHIEVEMENTS,
  CARS,
  CLASS_COLOR,
  CLASS_GLYPH,
  CLASS_LABEL,
  DIFFS,
  MODES,
  RaceSim,
  TIER_NAMES,
  TIER_XP,
  TRACKS,
  applyRecords,
  coachLive,
  coachReport,
  dailyFor,
  ghostGap,
  medalOf,
  newAchievements,
  recordKey,
  resultOf,
  tierOf,
  type GhostData,
  type RaceEvent,
  type RaceResult,
  type Records,
} from './racelogic.js';
import { RaceWorld } from './raceworld.js';
import { RaceOpt } from './ui-components.js';

void RaceAudio;

const LS = { rec: 'pw-race-records', xp: 'pw-race-xp', ach: 'pw-race-ach', set: 'pw-race-set', ghost: 'pw-race-ghost-' };
interface RaceSettings {
  car: number;
  track: number;
  diff: number;
  mode: number;
  quality: number; // 0 low 1 medium 2 high
  reduced: boolean; // reduced flashing / camera motion
  cockpit: boolean;
}
const readJson = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const writeJson = (k: string, v: unknown): void => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

type Screen = 'menu' | 'race' | 'results';

/** a panel that rides with the desktop camera, or sits fixed in the cockpit when in XR */
interface Anchored {
  p: TextPanel;
  cam: [number, number, number];
  xr: [number, number, number];
  tilt: number;
}

/** Lofted car shell: stations along z (nose to tail) of half-width, roof height and floor height, each a rounded-square ring. */
function loftBody(): BufferGeometry {
  const S: number[][] = [
    [-2.62, 0.3, 0.4, 0.3],
    [-2.3, 0.58, 0.47, 0.28],
    [-1.8, 0.82, 0.55, 0.27],
    [-1.1, 0.95, 0.62, 0.27],
    [-0.3, 0.98, 0.7, 0.28],
    [0.5, 0.98, 0.74, 0.28],
    [1.3, 1.02, 0.84, 0.3],
    [1.95, 0.92, 0.82, 0.32],
    [2.4, 0.72, 0.74, 0.34],
  ];
  const cr = (a: number, b: number, c: number, d: number, t: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const rings: number[][] = [];
  for (let i = 0; i < S.length - 1; i++) {
    const p0 = S[Math.max(0, i - 1)];
    const p1 = S[i];
    const p2 = S[i + 1];
    const p3 = S[Math.min(S.length - 1, i + 2)];
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      rings.push([0, 1, 2, 3].map((c) => cr(p0[c], p1[c], p2[c], p3[c], t)));
    }
  }
  rings.push(S[S.length - 1].slice());
  const N = 28;
  const pos: number[] = [];
  for (const [z, hw, top, bot] of rings) {
    const cy = (top + bot) / 2;
    const hh = (top - bot) / 2;
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 2 / 2.8; // superellipse: rounded-square section
      pos.push(Math.sign(c) * Math.pow(Math.abs(c), e) * hw, cy + Math.sign(s) * Math.pow(Math.abs(s), e) * hh, z);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < N; j++) {
      const a = r * N + j;
      const b = r * N + ((j + 1) % N);
      idx.push(a, a + N, b, b, a + N, b + N);
    }
  }
  const cap = (ring: number, flip: boolean): void => {
    const [z, , top, bot] = rings[ring];
    const ci = pos.length / 3;
    pos.push(0, (top + bot) / 2, z);
    for (let j = 0; j < N; j++) {
      const a = ring * N + j;
      const b = ring * N + ((j + 1) % N);
      if (flip) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  };
  cap(0, false);
  cap(rings.length - 1, true);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class RaceSystem extends createSystem({
  opts: { required: [RaceOpt, Pressed] },
}) {
  private rw!: RaceWorld;
  private carGroup = new Group();
  private wheels: Mesh[] = [];
  private bodyMat!: MeshPhysicalMaterial;
  private glowMat!: MeshBasicMaterial;
  private cabin!: Group;
  private sim: RaceSim | null = null;
  private ghost: GhostData | null = null;
  private screen: Screen = 'menu';
  private active = false;
  private set: RaceSettings = { car: 0, track: 0, diff: 1, mode: 0, quality: 1, reduced: false, cockpit: false };
  private rec: Records = { best: {}, board: {} };
  private xp = 0;
  private ach: string[] = [];
  private daily = false;
  private card!: Anchored;
  private hudTop!: Anchored;
  private hudBot!: Anchored;
  private entry!: Anchored;
  private btns: { a: Anchored; id: number; show: () => boolean; label: () => [string, string]; drawn: string }[] = [];
  private entities: Entity[] = [];
  private result: RaceResult | null = null;
  private pb: { score: boolean; time: boolean; combo: boolean; kmh: boolean; rank: number } | null = null;
  private newAch: string[] = [];
  private flash = { text: '', color: '#fff', t: 0 };
  private banner = { text: '', t: 0 };
  private beatT = 0;
  private hudT = 0;
  private cardKey = '';
  private lastZone = '';
  private camSaved: { p: Vector3; q: Quaternion; fov: number; py: number } | null = null;
  private readonly tv = new Vector3();
  private readonly tq = new Quaternion();
  private optCooldown = 0;
  private time = 0;
  private padPrev = { up: false, down: false, boost: false };
  private shake = 0;

  init(): void {
    this.rw = new RaceWorld();
    this.rw.setOrigin(0, RACE_Y, 0);
    this.rw.root.visible = false;
    this.world.createTransformEntity(this.rw.root);
    this.buildCar();
    this.carGroup.position.set(0, RACE_Y, 0);
    this.carGroup.visible = false;
    this.world.createTransformEntity(this.carGroup);

    this.card = this.mk(1.5, 0.95, 1024, [0, 0.12, -2.05], [0, RACE_Y + 1.55, -2.0], 0);
    this.hudTop = this.mk(1.2, 0.19, 1024, [0, 0.6, -1.7], [0, RACE_Y + 1.75, -1.6], 0);
    this.hudBot = this.mk(1.1, 0.37, 1024, [0, -0.62, -1.7], [0, RACE_Y + 0.95, -0.85], -0.55);
    for (const a of [this.card, this.hudTop, this.hudBot]) this.entities.push(this.world.createTransformEntity(a.p.mesh));
    this.entry = this.mk(0.32, 0.11, 512, [0, 0, 0], [-0.74, 0.66, -0.5], -0.9);
    this.entry.p.mesh.position.set(-0.74, 0.66, -0.5);
    this.entry.p.mesh.rotation.x = -0.9;
    this.makeButton(this.entry, 40, () => this.active === false && modeState.mode === 'gears' && gsStage.stage === 'bench', () => ['▶ RACER', '']);

    // menu: 5 mode buttons + settings row
    for (let i = 0; i < 6; i++) {
      this.makeButton(this.mk(0.5, 0.09, 512, [-0.52 + (i % 3) * 0.52, -0.5 + Math.floor(i / 3) * -0.11, -2.0], [-0.52 + (i % 3) * 0.52, RACE_Y + 0.82 - Math.floor(i / 3) * 0.11, -1.9], 0), i, () => this.active && this.screen === 'menu', () => [MODES[i].name, '']);
    }
    const row = (i: number, id: number, show: () => boolean, label: () => [string, string], x: number, y: number): void => {
      void i;
      this.makeButton(this.mk(0.5, 0.09, 512, [x, y, -2.0], [x, RACE_Y + y + 1.32, -1.9], 0), id, show, label);
    };
    const m = (): boolean => this.active && this.screen === 'menu';
    row(0, 10, m, () => ['CAR', CARS[this.set.car].name], -0.52, -0.72);
    row(0, 11, m, () => ['TRACK', TRACKS[this.set.track].name], 0, -0.72);
    row(0, 12, m, () => ['DIFFICULTY', DIFFS[this.set.diff].name], 0.52, -0.72);
    row(0, 13, m, () => ['DAILY CHALLENGE', dailyFor(this.today()).modifier.name], -0.52, -0.83);
    row(0, 14, m, () => ['QUALITY', ['LOW', 'MEDIUM', 'HIGH'][this.set.quality]], 0, -0.83);
    row(0, 15, m, () => ['REDUCED EFFECTS', this.set.reduced ? 'ON' : 'OFF'], 0.52, -0.83);
    row(0, 16, m, () => ['◀ BACK TO BENCH', ''], 0, -0.94);
    const r = (): boolean => this.active && this.screen === 'results';
    row(0, 20, r, () => ['RETRY', ''], -0.3, -0.72);
    row(0, 21, r, () => ['MENU', ''], 0.3, -0.72);

    this.set = { ...this.set, ...readJson<Partial<RaceSettings>>(LS.set, {}) };
    this.rec = readJson<Records>(LS.rec, { best: {}, board: {} });
    this.xp = readJson<number>(LS.xp, 0);
    this.ach = readJson<string[]>(LS.ach, []);

    this.cleanupFuncs.push(
      this.queries.opts.subscribe('qualify', (e: Entity) => {
        if (this.optCooldown > 0) return;
        this.optCooldown = 0.3;
        this.press(e.getValue(RaceOpt, 'id') as number);
      }),
    );
    const key = (ev: KeyboardEvent): void => {
      if (!this.active) return;
      const k = ev.key;
      if (k === 'Escape') {
        this.exit();
        return;
      }
      if (this.screen === 'results' && (k === 'Enter' || k === 'r' || k === 'R')) this.press(20);
      else if (this.screen === 'menu' && (k === 'Enter' || k === ' ')) this.press(this.set.mode);
      else if (this.screen === 'race' && this.sim) {
        if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'Enter') {
          ev.preventDefault();
          this.sim.shiftUp(false);
        } else if (k === 'ArrowDown' || k === 's' || k === 'S') this.sim.shiftDown();
        else if (k === 'b' || k === 'B' || k === 'Shift') this.sim.boost();
        else if (k === 'c' || k === 'C') {
          this.set.cockpit = !this.set.cockpit;
          this.applyView();
        } else if (k === 'r' || k === 'R') this.start();
      }
    };
    const down = (ev: PointerEvent): void => {
      if (!this.active || this.screen !== 'race' || !this.sim || this.sim.phase !== 'race') return;
      if (ev.button === 2) this.sim.boost();
      else this.sim.shiftUp(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down);
    });

    const w = window as unknown as Record<string, unknown>;
    w.__race = () => ({
      active: this.active,
      screen: this.screen,
      stage: gsStage.stage,
      phase: this.sim?.phase,
      gear: this.sim?.gear,
      rpm: this.sim?.rpm,
      kmh: this.sim?.kmh,
      distance: this.sim?.distance,
      score: this.sim?.score,
      combo: this.sim?.combo,
      shifts: this.sim?.log.length,
      counts: this.sim?.counts,
      raceT: this.sim?.raceT,
      result: this.result,
      settings: this.set,
      win: this.sim ? this.sim.window() : null,
    });
    w.__raceOpen = () => this.enter();
    w.__racePress = (id: number) => this.press(id);
    w.__raceStart = (mode?: number) => {
      if (mode !== undefined) this.set.mode = mode;
      this.press(this.set.mode);
    };
    /** advance the simulation by fixed seconds regardless of the (slow) render rate */
    w.__raceStep = (secs: number, ups = 0) => {
      if (!this.sim) return null;
      let t = 0;
      while (t < secs) {
        const s = this.sim;
        if (this.screen === 'race' && s.phase === 'race' && ups > 0) {
          // auto-driver: shift at the ideal rpm (used by the tests)
          const win = s.window();
          if (s.rpm >= win.center && s.gear < s.gears - 1) s.shiftUp(false);
        }
        this.advance(1 / 60);
        t += 1 / 60;
        if (this.screen !== 'race') break;
      }
      return (window as unknown as { __race: () => unknown }).__race();
    };
    w.__raceShift = () => this.sim?.shiftUp(false);
    this.leaveBench();
  }

  // ----------------------------------------------------------------- building blocks
  private mk(wm: number, hm: number, px: number, cam: [number, number, number], xr: [number, number, number], tilt: number): Anchored {
    const p = new TextPanel(wm, hm, px);
    p.mesh.visible = false;
    return { p, cam, xr, tilt };
  }

  private makeButton(a: Anchored, id: number, show: () => boolean, label: () => [string, string]): void {
    const e = this.world.createTransformEntity(a.p.mesh);
    e.addComponent(RayInteractable);
    e.addComponent(RaceOpt, { id });
    this.btns.push({ a, id, show, label, drawn: '' });
  }

  private buildCar(): void {
    const g = this.carGroup;
    const spec = CARS[0];
    this.bodyMat = new MeshPhysicalMaterial({ color: spec.paint, metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, emissive: spec.accent, emissiveIntensity: 0.1 });
    this.glowMat = new MeshBasicMaterial({ color: spec.accent, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    const dark = new MeshStandardMaterial({ color: 0x05060c, metalness: 0.9, roughness: 0.2 });
    const glass = new MeshStandardMaterial({ color: 0x0a1a2c, metalness: 1, roughness: 0.05, emissive: 0x0a2a44, emissiveIntensity: 0.4 });
    const tail = new MeshBasicMaterial({ color: NEON.red });
    const add = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0): Mesh => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.x = rx;
      g.add(m);
      return m;
    };
    const ball = new SphereGeometry(1, 28, 18);
    const box = new BoxGeometry(1, 1, 1);
    // body: one lofted shell (rounded-square cross-sections that change along the car), then canopy, wing and details
    add(loftBody(), this.bodyMat, 0, 0, 0);
    const glassClear = new MeshStandardMaterial({ color: 0x0b1c30, metalness: 0.9, roughness: 0.06, transparent: true, opacity: 0.62, emissive: 0x0a2a44, emissiveIntensity: 0.35 });
    add(ball, glassClear, 0, 0.84, 0.15, 0.5, 0.24, 1.0, -0.07); // glass canopy
    add(ball, dark, 0, 0.8, 0.28, 0.13, 0.13, 0.13); // driver helmet
    add(box, this.bodyMat, 0, 1.0, 0.15, 0.09, 0.03, 0.8); // roof spine
    add(box, dark, 0, 0.3, -2.62, 1.55, 0.05, 0.36); // front splitter
    add(box, dark, 0, 0.3, 2.3, 1.5, 0.12, 0.45); // diffuser
    for (const fx of [-0.45, -0.15, 0.15, 0.45]) add(box, dark, fx, 0.33, 2.36, 0.025, 0.14, 0.4); // diffuser fins
    add(box, dark, 0, 1.06, 2.12, 1.9, 0.05, 0.5); // rear wing
    add(box, dark, -0.95, 0.96, 2.12, 0.05, 0.32, 0.55); // end plates
    add(box, dark, 0.95, 0.96, 2.12, 0.05, 0.32, 0.55);
    add(box, dark, -0.4, 0.84, 2.1, 0.05, 0.38, 0.12); // wing struts
    add(box, dark, 0.4, 0.84, 2.1, 0.05, 0.38, 0.12);
    add(box, tail, 0, 0.74, 2.42, 1.3, 0.05, 0.03); // tail light bar
    add(box, this.glowMat, -0.5, 0.54, -2.34, 0.38, 0.035, 0.05); // headlight blades
    add(box, this.glowMat, 0.5, 0.54, -2.34, 0.38, 0.035, 0.05);
    add(box, this.glowMat, 0, 0.16, 0, 1.9, 0.03, 4.4); // underglow
    add(box, this.glowMat, -0.99, 0.46, 0.1, 0.03, 0.03, 2.2); // side light lines
    add(box, this.glowMat, 0.99, 0.46, 0.1, 0.03, 0.03, 2.2);
    add(box, dark, -0.97, 0.5, 0.55, 0.1, 0.16, 0.7); // side intakes
    add(box, dark, 0.97, 0.5, 0.55, 0.1, 0.16, 0.7);
    for (const sx of [-1, 1]) {
      add(box, dark, sx * 0.66, 0.82, -0.75, 0.16, 0.07, 0.1); // mirrors
      add(box, dark, sx * 0.66, 0.74, -0.7, 0.03, 0.1, 0.03);
    }
    // dark wheel-arch liners sit just behind each tyre so the tyres read as set into the body
    const archGeo = new CylinderGeometry(0.46, 0.46, 0.36, 24);
    archGeo.rotateZ(Math.PI / 2);
    for (const [x, z] of [[-0.95, -1.45], [0.95, -1.45], [-1.0, 1.5], [1.0, 1.5]] as [number, number][]) add(archGeo, dark, x, 0.4, z, 1, 0.9, 1);
    const steel = new MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.3 });
    const tyre = new CylinderGeometry(0.36, 0.36, 0.34, 24);
    tyre.rotateZ(Math.PI / 2);
    const rimGeo = new TorusGeometry(0.24, 0.025, 8, 24);
    rimGeo.rotateY(Math.PI / 2);
    for (const [x, z, k] of [[-1.0, -1.45, 0.95], [1.0, -1.45, 0.95], [-1.05, 1.5, 1.05], [1.05, 1.5, 1.05]] as [number, number, number][]) {
      const wm = add(tyre, dark, x, 0.36 * k, z, 1, k, k);
      this.wheels.push(wm);
      const rim = new Mesh(rimGeo, this.glowMat);
      rim.position.set(Math.sign(x) * 0.18, 0, 0);
      wm.add(rim);
      for (let q = 0; q < 5; q++) {
        const spoke = new Mesh(new BoxGeometry(0.018, 0.46, 0.05), this.glowMat);
        spoke.position.set(Math.sign(x) * 0.18, 0, 0);
        spoke.rotation.x = (q * Math.PI) / 5;
        wm.add(spoke);
      }
      const disc = new Mesh(new CylinderGeometry(0.17, 0.17, 0.02, 20), steel);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(Math.sign(x) * 0.12, 0, 0);
      wm.add(disc);
      const caliper = new Mesh(new BoxGeometry(0.05, 0.12, 0.09), tail);
      caliper.position.set(Math.sign(x) * 0.12, 0.17, 0);
      wm.add(caliper);
    }
    // cockpit dash visible only in first-person
    this.cabin = new Group();
    const dash = new Mesh(new BoxGeometry(1.5, 0.18, 0.5), dark);
    dash.position.set(0, 0.86, -0.55);
    this.cabin.add(dash);
    const wheel = new Mesh(new CylinderGeometry(0.17, 0.17, 0.03, 20), dark);
    wheel.rotation.x = 1.2;
    wheel.position.set(0, 0.98, -0.25);
    this.cabin.add(wheel);
    this.cabin.visible = false;
    g.add(this.cabin);
  }

  private today(): string {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ----------------------------------------------------------------- flow
  private leaveBench(): void {
    gsStage.stage = 'bench';
  }

  private enter(): void {
    if (this.active) return;
    this.active = true;
    gsStage.stage = 'pick';
    raceRoom.active = true;
    this.screen = 'menu';
    this.cardKey = '';
    this.rw.root.visible = true;
    this.carGroup.visible = true;
    this.rw.setDetail(this.set.quality);
    this.rw.setTrack(TRACKS[this.set.track], TRACKS[this.set.track].rain);
    this.rw.update({ distance: 0, speed: 0, time: 0, beat: 0, progress: 0, boost: 0, intensity: 0.5, cornerIn: 500, braking: false }, 0.016);
    this.frame(true);
    raceAudio.start();
    this.applyVolumes();
    raceAudio.setIntensity(0.2, true, false);
    this.applyCar();
    this.applyView();
  }

  private exit(): void {
    if (!this.active) return;
    this.active = false;
    raceAudio.stop();
    raceRoom.active = false;
    this.sim = null;
    this.rw.root.visible = false;
    this.carGroup.visible = false;
    for (const a of [this.card, this.hudTop, this.hudBot]) a.p.mesh.visible = false;
    for (const b of this.btns) b.a.p.mesh.visible = false;
    this.frame(false);
    gsStage.stage = 'bench';
  }

  private applyVolumes(): void {
    raceAudio.setVolumes({ master: 0.9, music: 0.8, engine: 0.9, sfx: 0.9, ambient: 0.7 }, false);
  }

  private applyCar(): void {
    const c = CARS[this.set.car];
    this.bodyMat.color.setHex(c.paint);
    this.bodyMat.emissive.setHex(c.accent);
    this.glowMat.color.setHex(c.accent);
  }

  private applyView(): void {
    const cockpit = this.set.cockpit || this.world.renderer.xr.isPresenting;
    this.cabin.visible = cockpit && this.screen === 'race';
    for (const m of this.carGroup.children) if (m !== this.cabin) m.visible = !cockpit || this.screen !== 'race';
    if (this.world.renderer.xr.isPresenting) return;
    const cam = this.world.camera;
    if (cockpit && this.screen === 'race') {
      cam.position.set(0, 1.12, 0.2);
      cam.lookAt(0, RACE_Y + 1.0, -10);
    } else {
      cam.position.set(0, 2.5, 7.4);
      cam.lookAt(0, RACE_Y + 0.25, -9);
    }
  }

  private frame(on: boolean): void {
    const cam = this.world.camera as unknown as { fov?: number; updateProjectionMatrix?: () => void };
    if (on) {
      this.camSaved = { p: this.world.camera.position.clone(), q: this.world.camera.quaternion.clone(), fov: cam.fov ?? 50, py: this.player.position.y };
      this.player.position.y = RACE_Y;
      if (cam.fov !== undefined && !this.world.renderer.xr.isPresenting) {
        cam.fov = 62;
        cam.updateProjectionMatrix?.();
      }
    } else if (this.camSaved) {
      this.player.position.y = this.camSaved.py;
      this.world.camera.position.copy(this.camSaved.p);
      this.world.camera.quaternion.copy(this.camSaved.q);
      if (cam.fov !== undefined) {
        cam.fov = this.camSaved.fov;
        cam.updateProjectionMatrix?.();
      }
      this.camSaved = null;
    }
  }

  private start(): void {
    const s = this.set;
    const d = dailyFor(this.today());
    const mode = this.daily ? MODES.find((m) => m.id === d.mode) ?? MODES[0] : MODES[s.mode];
    const car = this.daily ? CARS.find((c) => c.id === d.car) ?? CARS[0] : CARS[s.car];
    const track = this.daily ? TRACKS.find((t) => t.id === d.track) ?? TRACKS[0] : TRACKS[s.track];
    const diff = this.daily ? DIFFS.find((x) => x.id === d.diff) ?? DIFFS[1] : DIFFS[s.diff];
    this.sim = new RaceSim({ car, diff, track, mode, windowMod: this.daily ? d.modifier.windowMod : 1, heatMod: this.daily ? d.modifier.heatMod : 1, rainMod: this.daily ? d.modifier.rain : undefined });
    this.ghost = readJson<GhostData | null>(LS.ghost + recordKey(mode.id, track.id), null);
    this.result = null;
    this.rw.setTrack(track, this.sim.rain);
    this.rw.setDetail(s.quality);
    this.bodyMat.color.setHex(car.paint);
    this.glowMat.color.setHex(car.accent);
    this.bodyMat.emissive.setHex(car.accent);
    this.screen = 'race';
    gsStage.stage = 'race';
    this.flash.t = 0;
    this.banner.text = '';
    this.cardKey = '';
    this.card.p.mesh.visible = false;
    this.applyView();
    raceAudio.setIntensity(0.35, false, false);
  }

  private press(id: number): void {
    if (id === 40) {
      this.enter();
      return;
    }
    if (!this.active) return;
    raceAudio.ui();
    if (id >= 0 && id <= 5 && this.screen === 'menu') {
      this.set.mode = id;
      this.daily = false;
      this.start();
    } else if (id === 10) this.set.car = this.next(this.set.car, CARS.length, tierOf(this.xp), CARS.map((c) => c.unlockTier));
    else if (id === 11) this.set.track = this.next(this.set.track, TRACKS.length, tierOf(this.xp), TRACKS.map((t) => t.unlockTier));
    else if (id === 12) this.set.diff = (this.set.diff + 1) % DIFFS.length;
    else if (id === 13) {
      this.daily = true;
      this.start();
    } else if (id === 14) {
      this.set.quality = (this.set.quality + 1) % 3;
      this.rw.setDetail(this.set.quality);
    } else if (id === 15) this.set.reduced = !this.set.reduced;
    else if (id === 16) this.exit();
    else if (id === 20) this.start();
    else if (id === 21) {
      this.screen = 'menu';
      this.sim = null;
      this.cardKey = '';
      gsStage.stage = 'pick';
      this.applyView();
      raceAudio.setIntensity(0.2, true, false);
    }
    writeJson(LS.set, this.set);
    this.applyCar();
  }

  /** cycle to the next unlocked option */
  private next(cur: number, n: number, tier: number, unlock: number[]): number {
    for (let i = 1; i <= n; i++) {
      const k = (cur + i) % n;
      if (unlock[k] <= tier) return k;
    }
    return cur;
  }

  // ----------------------------------------------------------------- per frame
  update(delta: number): void {
    if (this.optCooldown > 0) this.optCooldown -= delta;
    this.time += delta;
    // the bench entry button shows only while the bench is up
    const onBench = modeState.mode === 'gears' && gsStage.stage === 'bench' && !this.active;
    if (modeState.mode !== 'gears' && this.active) this.exit();
    this.placeAll(onBench);
    if (!this.active) return;
    if (this.world.visibilityState.value === 'visible-blurred') return;
    this.pollPads();
    this.advance(Math.min(delta, 0.05));
    this.drawUi();
  }

  private pollPads(): void {
    if (this.screen !== 'race' || !this.sim) return;
    const sim = this.sim;
    let up = false;
    let down = false;
    let boost = false;
    const xr = this.input.xr?.gamepads;
    if (xr && this.world.renderer.xr.isPresenting) {
      const r = xr.right;
      const l = xr.left;
      up = !!r?.getButtonPressed('xr-standard-trigger') || !!l?.getButtonPressed('xr-standard-trigger');
      boost = !!r?.getButtonPressed('xr-standard-squeeze') || !!l?.getButtonPressed('xr-standard-squeeze');
      down = !!r?.getButtonPressed('a-button') || !!l?.getButtonPressed('x-button');
    } else if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gp = navigator.getGamepads()[0];
      if (gp) {
        up = !!gp.buttons[0]?.pressed || !!gp.buttons[5]?.pressed;
        down = !!gp.buttons[2]?.pressed || !!gp.buttons[4]?.pressed;
        boost = !!gp.buttons[1]?.pressed || !!gp.buttons[7]?.pressed;
      }
    }
    if (up && !this.padPrev.up) sim.shiftUp(this.world.renderer.xr.isPresenting);
    if (down && !this.padPrev.down) sim.shiftDown();
    if (boost && !this.padPrev.boost) sim.boost();
    this.padPrev.up = up;
    this.padPrev.down = down;
    this.padPrev.boost = boost;
  }

  private advance(dt: number): void {
    const sim = this.sim;
    this.beatT = (this.beatT + dt * (112 / 60)) % 1;
    const beat = Math.pow(1 - this.beatT, 3);
    if (sim && this.screen === 'race') {
      const ev = sim.step(dt);
      for (let i = 0; i < ev.length; i++) this.onEvent(ev[i]);
      const intens = this.set.reduced ? 0.4 : 1;
      this.rw.update({ distance: sim.distance, speed: sim.v, time: this.time, beat: beat * (this.set.reduced ? 0.3 : 1), progress: sim.progress, boost: sim.boosting ? 1 : 0, intensity: intens, cornerIn: sim.cornerIn, braking: sim.braking }, dt);
      raceAudio.engine({ rpm: sim.rpmShown, load: sim.throttle, speed: sim.v, turbo: sim.turboP, boosting: sim.boosting, wheelspin: sim.wheelspin, braking: sim.braking, limiter: sim.limiterT > 0, zone: sim.zone, rain: sim.rain }, sim.phase === 'race' || sim.phase === 'countdown', dt);
      raceAudio.setIntensity(Math.min(1, 0.15 + sim.v / (sim.topSpeed || 1) * 0.5 + Math.min(sim.combo, 10) * 0.03 + sim.progress * 0.2), false, sim.progress > 0.85 && sim.phase === 'race');
      for (const w of this.wheels) w.rotation.x -= sim.v * dt / 0.34;
      this.shake = this.set.reduced ? 0 : Math.min(1, sim.v / 90) * 0.012 + (sim.boosting ? 0.02 : 0);
      if (sim.phase === 'finished' || sim.phase === 'over') this.finish();
    } else {
      this.rw.update({ distance: this.time * 14, speed: 14, time: this.time, beat, progress: 0, boost: 0, intensity: 0.5, cornerIn: 500, braking: false }, dt);
      raceAudio.engine({ rpm: 900, load: 0, speed: 0, turbo: 0, boosting: false, wheelspin: 0, braking: false, limiter: false, zone: 'city', rain: false }, false, dt);
      for (const w of this.wheels) w.rotation.x -= 14 * dt / 0.34;
    }
    raceAudio.music();
    this.rw.root.position.set(0, RACE_Y, 0);
    if (this.flash.t > 0) this.flash.t -= dt;
    if (this.banner.t > 0) this.banner.t -= dt;
  }

  private onEvent(e: RaceEvent): void {
    const sim = this.sim as RaceSim;
    switch (e.type) {
      case 'count':
        raceAudio.beep(false);
        this.banner = { text: String(e.n), t: 0.9 };
        break;
      case 'go':
        raceAudio.beep(true);
        this.banner = { text: 'GO!', t: 0.9 };
        break;
      case 'shift':
        raceAudio.shift(e.cls);
        this.flash = { text: CLASS_GLYPH[e.cls] + ' ' + CLASS_LABEL[e.cls] + (e.combo > 1 ? '  x' + e.combo : ''), color: CLASS_COLOR[e.cls], t: 1.1 };
        if (e.cls === 'perfect') raceAudio.accent();
        break;
      case 'downshift':
        raceAudio.downshift();
        break;
      case 'boost':
        raceAudio.boost(e.on);
        if (e.on) this.banner = { text: 'TURBO!', t: 0.8 };
        break;
      case 'blowoff':
        raceAudio.blowoff();
        break;
      case 'backfire':
        raceAudio.backfire();
        break;
      case 'milestone':
        raceAudio.chime();
        this.banner = { text: e.kmh + ' KM/H', t: 1.1 };
        break;
      case 'warn':
        raceAudio.alarm();
        this.banner = { text: e.what === 'heat' ? 'ENGINE HOT - SHIFT EARLY' : e.what === 'stress' ? 'ENGINE STRESS' : 'REV LIMITER', t: 1.4 };
        break;
      case 'limp':
        this.banner = { text: 'LIMP MODE', t: 1.5 };
        break;
      case 'blown':
        raceAudio.crash();
        this.banner = { text: 'ENGINE BLOWN', t: 2 };
        break;
      case 'finish':
        raceAudio.chime();
        break;
      default:
        break;
    }
    void sim;
  }

  private finish(): void {
    const sim = this.sim as RaceSim;
    if (this.screen === 'results') return;
    const r = resultOf(sim, this.ghost, this.daily, this.today());
    this.result = r;
    this.pb = applyRecords(this.rec, r);
    const before = this.ach.slice();
    const gained = newAchievements(this.ach, r, sim);
    this.newAch = gained.map((a) => a.name);
    this.ach = before.concat(gained.map((a) => a.id));
    this.xp += Math.round(r.score / 60) + (r.finished ? 40 : 5);
    writeJson(LS.rec, this.rec);
    writeJson(LS.xp, this.xp);
    writeJson(LS.ach, this.ach);
    const key = recordKey(r.mode, r.track);
    if (this.pb.score || this.pb.time) {
      const g: GhostData = { v: 1, key, time: r.time, score: r.score, samples: sim.ghostSamples.slice() };
      writeJson(LS.ghost + key, g);
    }
    this.screen = 'results';
    gsStage.stage = 'pick';
    this.cardKey = '';
    this.applyView();
    raceAudio.setIntensity(0.3, true, false);
  }

  // ----------------------------------------------------------------- layout
  private placeOne(a: Anchored, show: boolean): void {
    const m = a.p.mesh;
    m.visible = show;
    if (!show) return;
    if (this.world.renderer.xr.isPresenting) {
      m.position.set(a.xr[0], a.xr[1], a.xr[2]);
      m.rotation.set(a.tilt, 0, 0);
      return;
    }
    const cam = this.world.camera;
    this.tv.set(a.cam[0], a.cam[1], a.cam[2]);
    cam.localToWorld(this.tv);
    m.position.copy(this.tv);
    cam.getWorldQuaternion(this.tq);
    m.quaternion.copy(this.tq);
  }

  private placeAll(onBench: boolean): void {
    // the bench-entry button is in bench space (not anchored)
    this.entry.p.mesh.visible = onBench;
    if (onBench) this.drawBtn(this.btns[0]);
    for (let i = 1; i < this.btns.length; i++) {
      const b = this.btns[i];
      const show = b.show();
      this.placeOne(b.a, show);
      if (show) this.drawBtn(b);
    }
    this.placeOne(this.card, this.active && this.screen !== 'race');
    this.placeOne(this.hudTop, this.active && this.screen === 'race');
    this.placeOne(this.hudBot, this.active && this.screen === 'race');
  }

  // ----------------------------------------------------------------- drawing
  private drawBtn(b: { a: Anchored; label: () => [string, string]; drawn: string }): void {
    const [t, s] = b.label();
    const k = t + '|' + s;
    if (b.drawn === k) return;
    b.drawn = k;
    const p = b.a.p;
    const c = p.ctx;
    c.clearRect(0, 0, p.w, p.h);
    const g = c.createLinearGradient(0, 0, p.w, 0);
    g.addColorStop(0, 'rgba(8,10,30,0.92)');
    g.addColorStop(1, 'rgba(30,8,44,0.92)');
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(4, 4, p.w - 8, p.h - 8, p.h / 2 - 4);
    c.fill();
    c.strokeStyle = '#22e6ff';
    c.shadowColor = '#22e6ff';
    c.shadowBlur = 10;
    c.lineWidth = 3;
    c.stroke();
    c.shadowBlur = 0;
    c.textAlign = 'center';
    c.fillStyle = '#e8fbff';
    if (s) {
      c.font = '700 ' + p.h * 0.3 + 'px ' + FONT;
      c.fillText(t, p.w / 2, p.h * 0.42);
      c.fillStyle = '#ff7be8';
      c.font = '700 ' + p.h * 0.3 + 'px ' + FONT;
      c.fillText(s, p.w / 2, p.h * 0.8);
    } else {
      c.font = '700 ' + p.h * 0.4 + 'px ' + FONT;
      c.fillText(t, p.w / 2, p.h * 0.66);
    }
    p.commit();
  }

  private drawUi(): void {
    if (this.screen === 'race' && this.sim) {
      this.hudT -= 1;
      if (this.hudT > 0) return;
      this.hudT = 2;
      this.drawTop(this.sim);
      this.drawBottom(this.sim);
    } else {
      this.drawCard();
    }
  }

  private drawTop(sim: RaceSim): void {
    const p = this.hudTop.p;
    const c = p.ctx;
    c.clearRect(0, 0, p.w, p.h);
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.font = '800 54px ' + FONT;
    c.fillText(String(Math.round(sim.score)).padStart(6, '0'), 24, 70);
    c.font = '700 26px ' + FONT;
    c.fillStyle = '#22e6ff';
    c.fillText('SCORE   x' + sim.multiplier.toFixed(1), 24, 100);
    // progress bar
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(380, 40, 560, 14);
    c.fillStyle = '#ff2bd6';
    c.fillRect(380, 40, 560 * sim.progress, 14);
    c.textAlign = 'right';
    c.fillStyle = '#e8fbff';
    c.font = '700 30px ' + FONT;
    const t = sim.raceT;
    const left = sim.mode.timeLimit > 0 ? Math.max(0, sim.mode.timeLimit - t) : t;
    c.fillText((sim.mode.timeLimit > 0 ? 'T-' : '') + Math.floor(left / 60) + ':' + (left % 60).toFixed(1).padStart(4, '0'), 1000, 100);
    c.textAlign = 'left';
    c.font = '700 24px ' + FONT;
    c.fillStyle = '#b9c6ff';
    const gap = this.ghost && sim.mode.distance > 0 ? ghostGap(this.ghost, sim.raceT, sim.distance, sim.v) : null;
    c.fillText(sim.mode.name + (gap !== null ? '   GHOST ' + (gap > 0 ? '+' : '') + gap.toFixed(1) + 's' : ''), 380, 100);
    p.commit();
  }

  private drawBottom(sim: RaceSim): void {
    const p = this.hudBot.p;
    const c = p.ctx;
    c.clearRect(0, 0, p.w, p.h);
    const W = p.w;
    // rpm bar with the live shift window
    const bx = 40;
    const bw = W - 80;
    const by = 190;
    const car = sim.car;
    c.fillStyle = 'rgba(8,10,30,0.7)';
    c.fillRect(bx - 8, by - 24, bw + 16, 64);
    const x = (rpm: number): number => bx + bw * Math.min(1, rpm / (car.limiter + 200));
    const win = sim.window();
    const seg = (half: number, col: string): void => {
      c.fillStyle = col;
      c.fillRect(x(win.center - half), by - 18, x(win.center + half) - x(win.center - half), 52);
    };
    seg(win.good, 'rgba(255,225,74,0.45)');
    seg(win.excellent, 'rgba(34,230,255,0.6)');
    seg(win.perfect, 'rgba(25,245,140,0.95)');
    c.fillStyle = '#ff2d4a';
    c.fillRect(x(car.redline), by - 18, bx + bw - x(car.redline), 52);
    c.fillStyle = '#ffffff';
    c.fillRect(bx, by + 40, x(sim.rpmShown) - bx, 6);
    c.fillRect(x(sim.rpmShown) - 3, by - 28, 6, 72);
    // speed & gear
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.font = '800 110px ' + FONT;
    c.fillText(String(Math.round(sim.kmh)), 40, 140);
    c.font = '700 28px ' + FONT;
    c.fillStyle = '#22e6ff';
    c.fillText('KM/H   ' + Math.round(sim.rpmShown) + ' RPM', 50, 40);
    c.textAlign = 'center';
    c.fillStyle = sim.shiftT > 0 ? '#ffe14a' : '#ffffff';
    c.font = '800 130px ' + FONT;
    c.fillText(String(sim.gear + 1), W / 2, 145);
    // meters: turbo, stress, heat
    const meter = (mx: number, label: string, v: number, col: string): void => {
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.fillRect(mx, 262, 230, 12);
      c.fillStyle = col;
      c.fillRect(mx, 262, 230 * Math.max(0, Math.min(1, v)), 12);
      c.textAlign = 'left';
      c.fillStyle = '#b9c6ff';
      c.font = '700 22px ' + FONT;
      c.fillText(label, mx, 300);
    };
    meter(40, sim.canBoost() ? 'TURBO READY [B]' : 'TURBO', sim.turboE / 100, '#ff2bd6');
    meter(380, 'STRESS', sim.stress / 100, '#ff9a2b');
    meter(720, 'HEAT', sim.temp / 1.2, '#ff2d4a');
    // flash, coach tip, banner
    c.textAlign = 'center';
    if (this.flash.t > 0) {
      c.globalAlpha = Math.min(1, this.flash.t * 2.5);
      c.fillStyle = this.flash.color;
      c.font = '800 58px ' + FONT;
      c.fillText(this.flash.text, W / 2, 80);
      c.globalAlpha = 1;
    } else if (sim.phase === 'race') {
      const tip = coachLive(sim.log);
      if (tip) {
        c.fillStyle = '#b9c6ff';
        c.font = '700 26px ' + FONT;
        c.fillText(tip, W / 2, 80);
      }
    }
    if (this.banner.t > 0) {
      c.globalAlpha = Math.min(1, this.banner.t * 2);
      c.fillStyle = '#ffffff';
      c.shadowColor = '#22e6ff';
      c.shadowBlur = 24;
      c.font = '800 96px ' + FONT;
      c.fillText(this.banner.text, W / 2, 40);
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    }
    p.commit();
  }

  /** draw centred text, shrinking the font so it never clips */
  private fit(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number): void {
    c.font = '700 ' + size + 'px ' + FONT;
    const w = c.measureText(text).width;
    if (w > maxW) c.font = '700 ' + Math.max(14, Math.floor((size * maxW) / w)) + 'px ' + FONT;
    c.fillText(text, x, y);
  }

  private drawCard(): void {
    const key = this.screen + '|' + this.set.car + this.set.track + this.set.diff + this.set.mode + (this.result?.score ?? '') + this.xp + this.set.quality;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const p = this.card.p;
    const c = p.ctx;
    c.clearRect(0, 0, p.w, p.h);
    const g = c.createLinearGradient(0, 0, p.w, p.h);
    g.addColorStop(0, 'rgba(5,6,16,0.92)');
    g.addColorStop(1, 'rgba(26,6,40,0.92)');
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(6, 6, p.w - 12, p.h - 12, 36);
    c.fill();
    c.strokeStyle = '#22e6ff';
    c.shadowColor = '#22e6ff';
    c.shadowBlur = 16;
    c.lineWidth = 4;
    c.stroke();
    c.shadowBlur = 0;
    c.textAlign = 'center';
    if (this.screen === 'menu') {
      c.fillStyle = '#ffffff';
      c.font = '800 76px ' + FONT;
      c.fillText('GEAR SHIFT', p.w / 2, 100);
      c.fillStyle = '#ff2bd6';
      c.font = '800 56px ' + FONT;
      c.fillText('NEON OVERDRIVE', p.w / 2, 168);
      c.fillStyle = '#b9c6ff';
      c.font = '700 28px ' + FONT;
      c.fillText('Space / click = upshift   B = turbo   C = view   Esc = exit', p.w / 2, 220);
      const tier = tierOf(this.xp);
      c.fillStyle = '#22e6ff';
      c.fillText('RANK ' + TIER_NAMES[tier] + '   XP ' + this.xp + (tier < TIER_NAMES.length - 1 ? ' / ' + TIER_XP[tier + 1] : ''), p.w / 2, 270);
      const m = MODES[this.set.mode];
      c.fillStyle = '#e8fbff';
      c.fillText(CARS[this.set.car].name + '  -  ' + CARS[this.set.car].tag, p.w / 2, 330);
      c.fillText(TRACKS[this.set.track].name + '  -  ' + TRACKS[this.set.track].tag, p.w / 2, 372);
      const best = this.rec.best[recordKey(m.id, TRACKS[this.set.track].id)];
      c.fillStyle = '#ffe14a';
      c.fillText(best ? 'BEST (' + m.name + '): ' + best.score + (best.time ? '  ' + best.time.toFixed(2) + 's' : '') : 'Pick a mode below to start', p.w / 2, 420);
      c.fillStyle = '#b9c6ff';
      c.fillText(m.desc, p.w / 2, 464);
      const d = dailyFor(this.today());
      c.fillStyle = '#19f58c';
      c.fillText('DAILY: ' + d.mode.toUpperCase() + ' on ' + d.track + ' - ' + d.modifier.name, p.w / 2, 508);
    } else if (this.result) {
      const r = this.result;
      c.fillStyle = r.finished ? '#19f58c' : '#ff2d4a';
      c.font = '800 64px ' + FONT;
      c.fillText(r.finished ? 'RACE COMPLETE' : 'RACE OVER', p.w / 2, 88);
      c.fillStyle = '#ffffff';
      c.font = '800 150px ' + FONT;
      c.fillText(r.grade, p.w / 2, 240);
      c.font = '700 34px ' + FONT;
      c.fillStyle = '#e8fbff';
      c.fillText('SCORE ' + r.score + '    TIME ' + r.time.toFixed(2) + 's    TOP ' + r.maxKmh + ' km/h', p.w / 2, 296);
      c.fillText('PERFECT ' + r.perfect + '    ACCURACY ' + r.accuracy + '%    BEST COMBO ' + r.bestCombo, p.w / 2, 340);
      const mode = MODES.find((x) => x.id === r.mode);
      const medal = mode && mode.medals && r.finished ? medalOf(mode, r.time) : '';
      c.fillStyle = '#ffe14a';
      const flags = [this.pb?.score ? 'NEW BEST SCORE' : '', this.pb?.time ? 'NEW BEST TIME' : '', r.ghostBeaten ? 'GHOST BEATEN' : '', medal ? medal + ' MEDAL' : ''].filter(Boolean).join('   ');
      c.fillText(flags || 'RANK #' + ((this.pb?.rank ?? 0) + 1) + ' on this board', p.w / 2, 388);
      c.fillStyle = '#ff7be8';
      const tips = this.sim ? coachReport(this.sim.log, this.sim.gears) : [];
      c.font = '700 28px ' + FONT;
      for (let i = 0; i < Math.min(2, tips.length); i++) this.fit(c, tips[i], p.w / 2, 440 + i * 38, 28, p.w - 80);
      if (this.newAch.length) {
        c.fillStyle = '#19f58c';
        this.fit(c, 'UNLOCKED: ' + this.newAch.join(', '), p.w / 2, 530, 28, p.w - 80);
      }
    }
    void ACHIEVEMENTS;
    p.commit();
  }
}
