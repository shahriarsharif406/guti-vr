/**
 * GEAR SHIFT: NEON OVERDRIVE - pure, deterministic racing simulation.
 * No DOM, no Three.js, no Math.random: same inputs + same dt sequence => same result.
 * Rendering, audio and UI read the RaceSim state and its per-step events; they never write it.
 */

// ------------------------------------------------------------------ data
export interface CarSpec {
  id: string;
  name: string;
  tag: string;
  mass: number; // kg
  peakTorque: number; // Nm
  idle: number;
  redline: number;
  limiter: number;
  ratios: number[];
  finalDrive: number;
  wheelR: number; // m
  cda: number; // drag coefficient x frontal area (m^2)
  crr: number; // rolling resistance
  efficiency: number; // transmission efficiency
  grip: number; // tyre friction coefficient (arcade)
  turbo: number; // boost torque gain at full pressure (0.3 = +30%)
  heat: number; // heat build multiplier
  paint: number; // hex body colour
  accent: number; // hex neon accent
  unlockTier: number; // career tier needed
}

/** Normalised torque curve (rpm / redline -> fraction of peak torque). Sharp fall after the peak so the best shift point moves per gear. */
const TORQUE_CURVE: [number, number][] = [
  [0, 0.42],
  [0.15, 0.55],
  [0.3, 0.72],
  [0.5, 0.9],
  [0.65, 1.0],
  [0.75, 0.99],
  [0.85, 0.93],
  [0.95, 0.78],
  [1.0, 0.66],
  [1.06, 0.5],
];

export const CARS: CarSpec[] = [
  { id: 'vx1', name: 'VX-1 VOLT', tag: 'Balanced six-speed hybrid', mass: 1520, peakTorque: 610, idle: 950, redline: 8200, limiter: 8500, ratios: [3.3, 2.2, 1.62, 1.27, 1.03, 0.86], finalDrive: 3.45, wheelR: 0.34, cda: 0.7, crr: 0.013, efficiency: 0.9, grip: 1.45, turbo: 0.32, heat: 1, paint: 0x0d1b2e, accent: 0x22e6ff, unlockTier: 0 },
  { id: 'titan', name: 'TITAN GT', tag: 'Heavy twin-turbo torque, five gears', mass: 1780, peakTorque: 820, idle: 850, redline: 7200, limiter: 7450, ratios: [3.0, 1.95, 1.4, 1.08, 0.86], finalDrive: 3.3, wheelR: 0.35, cda: 0.78, crr: 0.014, efficiency: 0.89, grip: 1.4, turbo: 0.45, heat: 1.2, paint: 0x2a0b26, accent: 0xff2bd6, unlockTier: 1 },
  { id: 'kestrel', name: 'KESTREL R', tag: 'Light, screaming 9,400 rpm, seven gears', mass: 1290, peakTorque: 470, idle: 1100, redline: 9400, limiter: 9700, ratios: [3.5, 2.5, 1.9, 1.5, 1.22, 1.0, 0.85], finalDrive: 3.6, wheelR: 0.33, cda: 0.62, crr: 0.012, efficiency: 0.91, grip: 1.55, turbo: 0.22, heat: 0.9, paint: 0x08231b, accent: 0x2bff9a, unlockTier: 2 },
];

export type DiffId = 'beginner' | 'amateur' | 'professional' | 'expert' | 'elite';
export interface Difficulty {
  id: DiffId;
  name: string;
  window: number; // timing window scale
  stress: number; // engine stress gain scale
  score: number; // score multiplier
  tier: number;
}
export const DIFFS: Difficulty[] = [
  { id: 'beginner', name: 'BEGINNER', window: 2.4, stress: 0.4, score: 0.8, tier: 0 },
  { id: 'amateur', name: 'AMATEUR', window: 1.7, stress: 0.65, score: 1, tier: 1 },
  { id: 'professional', name: 'PROFESSIONAL', window: 1.25, stress: 0.85, score: 1.25, tier: 2 },
  { id: 'expert', name: 'EXPERT', window: 1.0, stress: 1.0, score: 1.6, tier: 3 },
  { id: 'elite', name: 'ELITE', window: 0.75, stress: 1.2, score: 2.1, tier: 4 },
];
export const TIER_NAMES = ['BEGINNER', 'AMATEUR', 'PROFESSIONAL', 'EXPERT', 'ELITE'];
export const TIER_XP = [0, 300, 900, 2000, 4000];

export type ZoneKind = 'city' | 'tunnel' | 'highway';
export interface Track {
  id: string;
  name: string;
  tag: string;
  /** zone pattern repeated along the road; lengths in metres */
  pattern: { kind: ZoneKind; len: number }[];
  /** every `cornerEvery` metres a braking zone slows the car to `cornerSpeed` (m/s) */
  cornerEvery: number;
  cornerSpeed: number;
  rain: boolean;
  unlockTier: number;
}
export const TRACKS: Track[] = [
  { id: 'city', name: 'NEON CITY CIRCUIT', tag: 'Skyscrapers, ads and one long tunnel', pattern: [{ kind: 'city', len: 900 }, { kind: 'tunnel', len: 450 }, { kind: 'city', len: 500 }, { kind: 'highway', len: 650 }], cornerEvery: 760, cornerSpeed: 28, rain: false, unlockTier: 0 },
  { id: 'tunnel', name: 'HYPERION TUNNEL RUN', tag: 'Mostly underground, wet and loud', pattern: [{ kind: 'tunnel', len: 1100 }, { kind: 'city', len: 300 }], cornerEvery: 640, cornerSpeed: 25, rain: true, unlockTier: 1 },
  { id: 'highway', name: 'SKYLINE HIGHWAY', tag: 'Fast open road under the synth sun', pattern: [{ kind: 'highway', len: 1400 }, { kind: 'tunnel', len: 300 }, { kind: 'city', len: 400 }], cornerEvery: 1000, cornerSpeed: 33, rain: false, unlockTier: 2 },
];

export type ModeId = 'quick' | 'perfect' | 'timeattack' | 'endurance' | 'turborush' | 'vrcockpit';
export interface ModeSpec {
  id: ModeId;
  name: string;
  desc: string;
  distance: number; // finish distance (0 = none)
  timeLimit: number; // seconds (0 = none)
  shiftLimit: number; // upshifts (0 = none)
  cornerScale: number; // corner spacing multiplier
  heatScale: number;
  turboCharge: number;
  /** target times (s) for gold/silver/bronze in Time Attack */
  medals?: [number, number, number];
}
export const MODES: ModeSpec[] = [
  { id: 'quick', name: 'QUICK RACE', desc: '3 km sprint. Shift on the green, chase your ghost.', distance: 3000, timeLimit: 0, shiftLimit: 0, cornerScale: 1, heatScale: 1, turboCharge: 1 },
  { id: 'perfect', name: 'PERFECT SHIFT CHALLENGE', desc: '20 upshifts. Only timing counts.', distance: 0, timeLimit: 0, shiftLimit: 20, cornerScale: 0.45, heatScale: 1, turboCharge: 1 },
  { id: 'timeattack', name: 'TIME ATTACK', desc: '2 km against the clock. Medals for speed.', distance: 2000, timeLimit: 0, shiftLimit: 0, cornerScale: 1.2, heatScale: 1, turboCharge: 1, medals: [39.5, 42.5, 47] },
  { id: 'endurance', name: 'ENDURANCE', desc: '8 km. Keep the engine cool or it blows.', distance: 8000, timeLimit: 0, shiftLimit: 0, cornerScale: 1, heatScale: 1.3, turboCharge: 1 },
  { id: 'turborush', name: 'TURBO RUSH', desc: '75 seconds. Turbo charges twice as fast and doubles score.', distance: 0, timeLimit: 75, shiftLimit: 0, cornerScale: 0.8, heatScale: 1.1, turboCharge: 2 },
  { id: 'vrcockpit', name: 'VR COCKPIT CHALLENGE', desc: '3 km using the physical gear lever. Lever shifts score x1.25.', distance: 3000, timeLimit: 0, shiftLimit: 0, cornerScale: 1, heatScale: 1, turboCharge: 1 },
];

export type ShiftClass = 'perfect' | 'excellent' | 'good' | 'early' | 'late' | 'overload';
export const CLASS_BASE: Record<ShiftClass, number> = { perfect: 1000, excellent: 600, good: 300, early: 60, late: 60, overload: 0 };
export const CLASS_LABEL: Record<ShiftClass, string> = { perfect: 'PERFECT', excellent: 'EXCELLENT', good: 'GOOD', early: 'EARLY', late: 'LATE', overload: 'ENGINE OVERLOAD' };
/** Colour + shape glyph per class (shape keeps the indicator readable without colour). */
export const CLASS_COLOR: Record<ShiftClass, string> = { perfect: '#19f58c', excellent: '#22e6ff', good: '#ffe14a', early: '#ff9a2b', late: '#ff9a2b', overload: '#ff2d4a' };
export const CLASS_GLYPH: Record<ShiftClass, string> = { perfect: '◆', excellent: '▲', good: '●', early: '◀', late: '▶', overload: '✖' };

// ------------------------------------------------------------------ helpers
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const KMH = 3.6;

export function torqueFrac(rpmFrac: number): number {
  const c = TORQUE_CURVE;
  if (rpmFrac <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpmFrac <= c[i][0]) {
      const [x0, y0] = c[i - 1];
      const [x1, y1] = c[i];
      return y0 + ((rpmFrac - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return c[c.length - 1][1];
}

/** Engine rpm that maximises acceleration for an upshift out of `gear` (0-based), clamped to a playable band. */
export function idealShiftRpm(car: CarSpec, gear: number): number {
  if (gear >= car.ratios.length - 1) return car.redline;
  const g0 = car.ratios[gear];
  const g1 = car.ratios[gear + 1];
  let best = 0.8;
  for (let f = 0.7; f <= 1.0; f += 0.0025) {
    const now = torqueFrac(f) * g0;
    const next = torqueFrac((f * g1) / g0) * g1;
    if (now >= next) best = f;
    else break;
  }
  return clamp(best, 0.8, 0.965) * car.redline;
}

export function rpmFromSpeed(car: CarSpec, gear: number, v: number): number {
  return (v / car.wheelR) * car.ratios[gear] * car.finalDrive * (60 / (2 * Math.PI));
}
export function speedFromRpm(car: CarSpec, gear: number, rpm: number): number {
  return (rpm / (car.ratios[gear] * car.finalDrive)) * ((2 * Math.PI) / 60) * car.wheelR;
}

export function zoneAt(track: Track, d: number): ZoneKind {
  let total = 0;
  for (const z of track.pattern) total += z.len;
  let x = ((d % total) + total) % total;
  for (const z of track.pattern) {
    if (x < z.len) return z.kind;
    x -= z.len;
  }
  return track.pattern[0].kind;
}

export interface ShiftWindow {
  center: number; // ideal rpm
  perfect: number; // half widths (rpm)
  excellent: number;
  good: number;
}

export interface ShiftRecord {
  t: number;
  gear: number; // gear shifted OUT of (0-based)
  rpm: number;
  center: number;
  good: number; // good half-width at the time
  cls: ShiftClass;
  points: number;
  lever: boolean;
}

export type RaceEvent =
  | { type: 'count'; n: number }
  | { type: 'go' }
  | { type: 'shift'; cls: ShiftClass; gear: number; rpm: number; delta: number; points: number; combo: number }
  | { type: 'downshift'; gear: number }
  | { type: 'boost'; on: boolean; manual: boolean }
  | { type: 'blowoff' }
  | { type: 'backfire' }
  | { type: 'milestone'; kmh: number }
  | { type: 'zone'; kind: ZoneKind }
  | { type: 'brake'; on: boolean }
  | { type: 'warn'; what: 'stress' | 'heat' | 'limiter' }
  | { type: 'limp' }
  | { type: 'blown' }
  | { type: 'finish' };

export type Phase = 'intro' | 'countdown' | 'race' | 'finished' | 'over';

export interface RaceSetup {
  car: CarSpec;
  diff: Difficulty;
  track: Track;
  mode: ModeSpec;
  /** daily challenge modifiers */
  windowMod?: number;
  heatMod?: number;
  rainMod?: boolean;
  introTime?: number;
}

export const STEP = 1 / 120;
const BRAKE_DECEL = 12;
const INTRO = 2.6;
const COUNT = 3;
const MILESTONES = [100, 150, 200, 250, 300, 330];

// ------------------------------------------------------------------ simulation
export class RaceSim {
  readonly car: CarSpec;
  readonly diff: Difficulty;
  readonly track: Track;
  readonly mode: ModeSpec;
  private readonly windowMod: number;
  private readonly heatMod: number;
  readonly rain: boolean;
  readonly ideal: number[];
  readonly topSpeed: number;
  private readonly introTime: number;

  phase: Phase = 'intro';
  phaseT = 0;
  raceT = 0;
  gear = 0;
  rpm = 0;
  rpmShown = 0; // smoothed rpm for gauges/audio
  v = 0; // m/s
  distance = 0;
  throttle = 0;
  accel = 0;
  turboP = 0; // physical boost pressure 0..1
  turboE = 0; // turbo energy meter 0..100
  boostT = 0; // remaining manual boost seconds
  miniBoostT = 0; // perfect-shift kick
  temp = 0.35; // 0..1.2 normalised engine temperature
  stress = 0; // 0..100
  shiftT = 0; // remaining torque-cut time of the current shift
  lagT = 0; // power loss after a bad shift
  limiterT = 0;
  wheelspin = 0;
  braking = false;
  combo = 0;
  bestCombo = 0;
  perfectStreak = 0;
  bestPerfectStreak = 0;
  score = 0;
  maxSpeed = 0;
  maxRpm = 0;
  upshifts = 0;
  leverShifts = 0;
  counts: Record<ShiftClass, number> = { perfect: 0, excellent: 0, good: 0, early: 0, late: 0, overload: 0 };
  log: ShiftRecord[] = [];
  ghostSamples: number[] = [];
  events: RaceEvent[] = [];
  zone: ZoneKind;
  boostUses = 0;
  limpT = 0;
  overheated = false;
  private acc = 0;
  private sampleT = 0;
  private milestoneIdx = 0;
  private pendingUp = 0;
  private pendingLever = false;
  private pendingDown = 0;
  private pendingBoost = false;
  private lastCount = 4;
  private nextCorner: number;
  private warned = { stress: false, heat: false };
  private limiterMissed = false;

  constructor(setup: RaceSetup) {
    this.car = setup.car;
    this.diff = setup.diff;
    this.track = setup.track;
    this.mode = setup.mode;
    this.windowMod = setup.windowMod ?? 1;
    this.heatMod = setup.heatMod ?? 1;
    this.rain = setup.rainMod ?? setup.track.rain;
    this.introTime = setup.introTime ?? INTRO;
    this.ideal = this.car.ratios.map((_, g) => idealShiftRpm(this.car, g));
    this.topSpeed = speedFromRpm(this.car, this.car.ratios.length - 1, this.car.redline);
    this.rpm = this.rpmShown = this.car.idle;
    this.zone = zoneAt(this.track, 0);
    this.nextCorner = this.cornerSpacing();
  }

  private cornerSpacing(): number {
    return this.track.cornerEvery * this.mode.cornerScale;
  }

  get gears(): number {
    return this.car.ratios.length;
  }
  get kmh(): number {
    return this.v * KMH;
  }
  get rpmFrac(): number {
    return this.rpm / this.car.redline;
  }
  get boosting(): boolean {
    return this.boostT > 0;
  }
  get multiplier(): number {
    return 1 + 0.2 * Math.min(this.combo, 15);
  }
  get running(): boolean {
    return this.phase === 'race';
  }
  /** 0..1 progress through the race goal */
  get progress(): number {
    const m = this.mode;
    if (m.distance > 0) return clamp(this.distance / m.distance, 0, 1);
    if (m.timeLimit > 0) return clamp(this.raceT / m.timeLimit, 0, 1);
    if (m.shiftLimit > 0) return clamp(this.upshifts / m.shiftLimit, 0, 1);
    return 0;
  }
  get accuracy(): number {
    const n = this.log.length;
    if (!n) return 0;
    const c = this.counts;
    return (c.perfect + c.excellent * 0.8 + c.good * 0.5) / n;
  }
  /** distance to the next braking point (m), or -1 when not relevant */
  get cornerIn(): number {
    return this.nextCorner - this.distance;
  }

  /** The live timing window for an upshift out of the current gear. */
  window(out?: ShiftWindow): ShiftWindow {
    const w = out ?? { center: 0, perfect: 0, excellent: 0, good: 0 };
    const car = this.car;
    const g = this.gear;
    const heat = clamp((this.temp - 0.7) / 0.4, 0, 1);
    // hot engines want an earlier shift; high boost pressure moves the sweet spot up a little
    w.center = Math.min(car.limiter - 120, this.ideal[g] - heat * 0.04 * car.redline + this.turboP * 0.012 * car.redline);
    const speedF = 1 - 0.18 * clamp(this.v / this.topSpeed, 0, 1);
    const gearF = 1 - 0.05 * g;
    const heatF = 1 - 0.3 * heat;
    const condF = (this.rain ? 0.9 : 1) * (this.zone === 'tunnel' ? 0.95 : 1);
    const base = 0.018 * car.redline * this.diff.window * this.windowMod * speedF * gearF * heatF * condF;
    w.perfect = base;
    w.excellent = base * 2.1;
    w.good = base * 3.6;
    return w;
  }

  private readonly w: ShiftWindow = { center: 0, perfect: 0, excellent: 0, good: 0 };

  classify(rpm: number): { cls: ShiftClass; delta: number } {
    const w = this.window(this.w);
    const d = rpm - w.center;
    if (rpm >= this.car.limiter - 40 || this.limiterT > 0.35) return { cls: 'overload', delta: d };
    const a = Math.abs(d);
    if (a <= w.perfect) return { cls: 'perfect', delta: d };
    if (a <= w.excellent) return { cls: 'excellent', delta: d };
    if (a <= w.good) return { cls: 'good', delta: d };
    return { cls: d < 0 ? 'early' : 'late', delta: d };
  }

  // ---- inputs (queued; applied on the next fixed step so timing is frame-rate independent)
  shiftUp(lever = false): void {
    this.pendingUp++;
    if (lever) this.pendingLever = true;
  }
  shiftDown(): void {
    this.pendingDown++;
  }
  boost(): void {
    this.pendingBoost = true;
  }
  canBoost(): boolean {
    return this.phase === 'race' && this.turboE >= 40 && this.boostT <= 0;
  }

  /** Advance by dt seconds (any frame time); internally runs fixed 1/120 s steps. */
  step(dt: number): RaceEvent[] {
    this.events.length = 0;
    this.acc += Math.min(Math.max(dt, 0), 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.tick(STEP);
    }
    return this.events;
  }

  private emit(e: RaceEvent): void {
    this.events.push(e);
  }

  private tick(dt: number): void {
    this.phaseT += dt;
    const car = this.car;
    if (this.phase === 'intro') {
      this.rpm = car.idle + Math.max(0, Math.sin(this.phaseT * 3)) * 400 * Math.min(1, this.phaseT);
      this.rpmShown = this.rpm;
      if (this.phaseT >= this.introTime) {
        this.phase = 'countdown';
        this.phaseT = 0;
      }
      this.pendingUp = this.pendingDown = 0;
      this.pendingBoost = false;
      return;
    }
    if (this.phase === 'countdown') {
      const n = Math.max(1, Math.ceil(COUNT - this.phaseT));
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.emit({ type: 'count', n });
      }
      // the needle rises toward launch revs as the lights count down
      const launch = car.redline * 0.5;
      this.rpm += (car.idle + (launch - car.idle) * clamp(this.phaseT / COUNT, 0, 1) - this.rpm) * Math.min(1, dt * 6);
      this.rpmShown = this.rpm;
      this.pendingUp = this.pendingDown = 0;
      this.pendingBoost = false;
      if (this.phaseT >= COUNT) {
        this.phase = 'race';
        this.phaseT = 0;
        this.emit({ type: 'go' });
      }
      return;
    }
    if (this.phase !== 'race') {
      // coast down after the finish
      this.v = Math.max(0, this.v - 9 * dt);
      this.distance += this.v * dt;
      this.rpm += (Math.max(car.idle, rpmFromSpeed(car, this.gear, this.v) * 0.6) - this.rpm) * Math.min(1, dt * 3);
      this.rpmShown = this.rpm;
      this.throttle = 0;
      this.turboP = Math.max(0, this.turboP - dt * 2);
      this.boostT = 0;
      return;
    }
    this.raceT += dt;

    // ---- inputs
    if (this.pendingBoost) {
      this.pendingBoost = false;
      if (this.canBoost()) {
        this.boostT = (this.turboE / 100) * 4;
        this.turboE = 0;
        this.boostUses++;
        this.emit({ type: 'boost', on: true, manual: true });
      }
    }
    while (this.pendingUp > 0) {
      this.pendingUp--;
      this.doUpshift(this.pendingLever);
    }
    this.pendingLever = false;
    while (this.pendingDown > 0) {
      this.pendingDown--;
      if (this.gear > 0 && this.shiftT <= 0) {
        this.gear--;
        this.shiftT = 0.12;
        this.emit({ type: 'downshift', gear: this.gear });
      }
    }

    // ---- braking zones: the track slows you; the gearbox drops gears to keep the engine alive
    // a braking marker: start exactly when the remaining distance is needed to reach corner speed
    const target = this.track.cornerSpeed;
    const need = (this.v * this.v - target * target) / (2 * BRAKE_DECEL) + 12;
    const inBrake = this.cornerIn > 0 && this.cornerIn <= need && this.v > target + 0.3;
    if (inBrake !== this.braking) {
      this.braking = inBrake;
      this.emit({ type: 'brake', on: inBrake });
    }
    if (this.distance >= this.nextCorner) this.nextCorner += this.cornerSpacing();

    // ---- engine
    const ratio = car.ratios[this.gear] * car.finalDrive;
    const wheelRpm = rpmFromSpeed(car, this.gear, this.v);
    const shifting = this.shiftT > 0;
    this.throttle = this.braking || shifting || this.limpT > 0 ? 0 : 1;
    // launch: clutch slips in first gear below launch revs
    const launchRpm = car.redline * 0.48;
    let rpm = wheelRpm;
    if (this.gear === 0 && wheelRpm < launchRpm) rpm = Math.max(wheelRpm, launchRpm * this.throttle + car.idle * (1 - this.throttle));
    rpm = Math.max(car.idle, rpm);
    let limiter = false;
    if (rpm >= car.limiter) {
      rpm = car.limiter;
      limiter = true;
    }
    this.rpm = rpm;
    if (rpm > this.maxRpm) this.maxRpm = rpm;
    this.rpmShown += (rpm - this.rpmShown) * Math.min(1, dt * 30);

    // turbo spool (lags), released on every shift
    const spoolTarget = this.throttle * clamp((this.rpmFrac - 0.35) / 0.4, 0, 1);
    this.turboP += (spoolTarget - this.turboP) * Math.min(1, dt * (spoolTarget > this.turboP ? 1.6 : 5));
    let torque = car.peakTorque * torqueFrac(rpm / car.redline) * (1 + car.turbo * this.turboP);
    if (this.boostT > 0) torque *= 1.38;
    if (this.miniBoostT > 0) torque *= 1.15;
    if (this.lagT > 0) torque *= 0.55;
    if (limiter) torque *= 0.05; // fuel cut bounces off the limiter
    torque *= this.throttle;
    let force = (torque * ratio * car.efficiency) / car.wheelR;
    const tractionMax = car.grip * (this.rain ? 0.85 : 1) * car.mass * 9.81;
    this.wheelspin = force > tractionMax ? clamp((force - tractionMax) / tractionMax, 0, 1) : 0;
    force = Math.min(force, tractionMax);
    const drag = 0.5 * 1.2 * car.cda * this.v * this.v + car.crr * car.mass * 9.81;
    const brake = this.braking ? car.mass * BRAKE_DECEL : 0;
    this.accel = (force - drag - brake) / car.mass;
    this.v = Math.max(0, this.v + this.accel * dt);
    this.distance += this.v * dt;
    if (this.v > this.maxSpeed) this.maxSpeed = this.v;

    // auto downshift while braking so the engine stays in its band (rev-matched blip)
    if (this.braking && this.gear > 0 && rpmFromSpeed(car, this.gear, this.v) < car.redline * 0.55 && rpmFromSpeed(car, this.gear - 1, this.v) < car.redline * 0.9) {
      this.gear--;
      this.emit({ type: 'downshift', gear: this.gear });
    }

    // ---- timers
    if (this.shiftT > 0) this.shiftT -= dt;
    if (this.lagT > 0) this.lagT -= dt;
    if (this.miniBoostT > 0) this.miniBoostT -= dt;
    if (this.boostT > 0) {
      this.boostT -= dt;
      if (this.boostT <= 0) this.emit({ type: 'boost', on: false, manual: true });
    }
    if (this.limpT > 0) this.limpT -= dt;

    // ---- limiter, heat and stress
    if (limiter) {
      this.limiterT += dt;
      if (this.limiterT > 0.6 && !this.limiterMissed) {
        this.limiterMissed = true;
        this.emit({ type: 'warn', what: 'limiter' });
      }
    } else {
      this.limiterT = Math.max(0, this.limiterT - dt * 4);
      if (this.limiterT === 0) this.limiterMissed = false;
    }
    const heatMul = car.heat * this.mode.heatScale * this.heatMod;
    const rf = this.rpmFrac;
    const dTemp = (rf * rf * rf * 0.07 + (this.boostT > 0 ? 0.06 : 0) + (limiter ? 0.22 : 0)) * heatMul - 0.03 - 0.015 * clamp(this.v / 80, 0, 1);
    this.temp = clamp(this.temp + dTemp * dt, 0.25, 1.2);
    let dStress = 0;
    if (limiter) dStress += 32;
    if (this.temp > 0.9) dStress += 6 * (this.temp - 0.9) / 0.3;
    if (!limiter && rf < 0.86 && this.temp < 0.8) dStress -= 3;
    this.stress = clamp(this.stress + (dStress > 0 ? dStress * this.diff.stress : dStress) * dt, 0, 100);
    if (this.temp > 1.0) this.overheated = true;
    if (this.stress > 70 && !this.warned.stress) {
      this.warned.stress = true;
      this.emit({ type: 'warn', what: 'stress' });
    } else if (this.stress < 55) this.warned.stress = false;
    if (this.temp > 0.95 && !this.warned.heat) {
      this.warned.heat = true;
      this.emit({ type: 'warn', what: 'heat' });
    } else if (this.temp < 0.85) this.warned.heat = false;
    if (this.stress >= 100) {
      if (this.diff.id === 'beginner') {
        this.stress = 65;
        this.limpT = 2.5;
        this.combo = 0;
        this.emit({ type: 'limp' });
      } else {
        this.phase = 'over';
        this.phaseT = 0;
        this.emit({ type: 'blown' });
        return;
      }
    }

    // ---- score, milestones, zones, ghost samples
    this.score += this.v * dt * 0.5 * this.diff.score;
    while (this.milestoneIdx < MILESTONES.length && this.kmh >= MILESTONES[this.milestoneIdx]) {
      this.score += 250 * this.diff.score;
      this.emit({ type: 'milestone', kmh: MILESTONES[this.milestoneIdx] });
      this.milestoneIdx++;
    }
    const z = zoneAt(this.track, this.distance);
    if (z !== this.zone) {
      this.zone = z;
      this.emit({ type: 'zone', kind: z });
    }
    this.sampleT += dt;
    if (this.sampleT >= 0.1) {
      this.sampleT -= 0.1;
      this.ghostSamples.push(Math.round(this.distance * 10) / 10);
    }

    // ---- finish conditions
    const m = this.mode;
    if ((m.distance > 0 && this.distance >= m.distance) || (m.timeLimit > 0 && this.raceT >= m.timeLimit) || (m.shiftLimit > 0 && this.upshifts >= m.shiftLimit)) {
      this.phase = 'finished';
      this.phaseT = 0;
      this.boostT = 0;
      this.emit({ type: 'finish' });
    }
  }

  private doUpshift(lever: boolean): void {
    const car = this.car;
    if (this.shiftT > 0.02) return; // still in the previous shift
    if (this.gear >= car.ratios.length - 1) return; // top gear: nothing to shift into
    const rpmBefore = this.rpm;
    const { cls, delta } = this.classify(rpmBefore);
    const w = this.window(this.w);
    this.gear++;
    this.upshifts++;
    if (lever) this.leverShifts++;
    this.counts[cls]++;
    // consequences
    const turboGain = { perfect: 22, excellent: 12, good: 4, early: 0, late: 0, overload: 0 }[cls] * this.mode.turboCharge;
    this.turboE = Math.min(100, this.turboE + turboGain);
    if (this.turboP > 0.5) this.emit({ type: 'blowoff' });
    this.turboP *= cls === 'perfect' ? 0.7 : 0.35; // a clean shift keeps the turbo spooled
    this.shiftT = cls === 'perfect' ? 0.07 : cls === 'excellent' ? 0.1 : cls === 'good' ? 0.14 : 0.22;
    if (cls === 'perfect') {
      this.miniBoostT = 0.9;
      this.stress = Math.max(0, this.stress - 6);
      this.temp = Math.max(0.25, this.temp - 0.035);
    }
    if (cls === 'early') {
      this.lagT = 0.5; // bogs below the power band
      this.stress = Math.min(100, this.stress + 3 * this.diff.stress);
    }
    if (cls === 'late') {
      this.lagT = 0.25;
      this.stress = Math.min(100, this.stress + 8 * this.diff.stress);
    }
    if (cls === 'overload') {
      this.lagT = 0.7;
      this.stress = Math.min(100, this.stress + 20 * this.diff.stress);
      this.temp = Math.min(1.2, this.temp + 0.05);
      this.emit({ type: 'backfire' });
    }
    if (cls === 'perfect' || cls === 'excellent') this.combo++;
    else if (cls !== 'good') this.combo = 0;
    if (cls === 'perfect') this.perfectStreak++;
    else this.perfectStreak = 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.bestPerfectStreak = Math.max(this.bestPerfectStreak, this.perfectStreak);
    const leverMul = lever && this.mode.id === 'vrcockpit' ? 1.25 : 1;
    const turboMul = this.boostT > 0 ? (this.mode.id === 'turborush' ? 2 : 1.5) : 1;
    const points = Math.round(CLASS_BASE[cls] * this.multiplier * this.diff.score * turboMul * leverMul);
    this.score += points;
    this.limiterT = 0;
    this.log.push({ t: Math.round(this.raceT * 1000) / 1000, gear: this.gear - 1, rpm: Math.round(rpmBefore), center: Math.round(w.center), good: Math.round(w.good), cls, points, lever });
    this.emit({ type: 'shift', cls, gear: this.gear, rpm: rpmBefore, delta, points, combo: this.combo });
    if (cls === 'perfect') this.emit({ type: 'boost', on: true, manual: false });
  }
}

// ------------------------------------------------------------------ grading, ghost, coach
export type Grade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'DNF';
export function gradeOf(sim: RaceSim): Grade {
  if (sim.phase === 'over') return 'DNF';
  const a = sim.accuracy;
  if (a >= 0.93 && sim.counts.overload === 0 && sim.counts.late + sim.counts.early === 0) return 'S+';
  if (a >= 0.88) return 'S';
  if (a >= 0.78) return 'A';
  if (a >= 0.64) return 'B';
  if (a >= 0.5) return 'C';
  return 'D';
}

export function medalOf(mode: ModeSpec, time: number): '' | 'GOLD' | 'SILVER' | 'BRONZE' {
  if (!mode.medals) return '';
  if (time <= mode.medals[0]) return 'GOLD';
  if (time <= mode.medals[1]) return 'SILVER';
  if (time <= mode.medals[2]) return 'BRONZE';
  return '';
}

export interface GhostData {
  v: 1;
  key: string;
  time: number;
  score: number;
  samples: number[]; // distance every 0.1 s of race time
}
/** Distance the ghost had covered at race time t (linear interpolation; holds the last value). */
export function ghostDistanceAt(g: GhostData | null, t: number): number {
  if (!g || !g.samples.length) return 0;
  const f = t / 0.1 - 1;
  if (f <= 0) return g.samples[0] * Math.max(0, t / 0.1);
  const i = Math.floor(f);
  if (i >= g.samples.length - 1) return g.samples[g.samples.length - 1];
  return g.samples[i] + (g.samples[i + 1] - g.samples[i]) * (f - i);
}
/** Time gap to the ghost in seconds (positive = you are behind). */
export function ghostGap(g: GhostData | null, t: number, distance: number, v: number): number {
  if (!g) return 0;
  const gd = ghostDistanceAt(g, t);
  return (gd - distance) / Math.max(v, 8);
}

/** Rule-based coach: reads the shift log and names the clearest habit to fix. */
export function coachReport(log: ShiftRecord[], gears: number): string[] {
  if (!log.length) return ['No shifts yet. Tap SHIFT when the needle reaches the green zone.'];
  const tips: { w: number; s: string }[] = [];
  const byGear: { n: number; off: number }[] = [];
  for (let g = 0; g < gears; g++) byGear.push({ n: 0, off: 0 });
  let early = 0;
  let late = 0;
  let over = 0;
  for (const r of log) {
    const off = (r.rpm - r.center) / Math.max(1, r.good);
    byGear[r.gear].n++;
    byGear[r.gear].off += off;
    if (r.cls === 'early') early++;
    if (r.cls === 'late') late++;
    if (r.cls === 'overload') over++;
  }
  const n = log.length;
  if (over > 0) tips.push({ w: over * 3, s: 'You hit the rev limiter ' + over + 'x. Shift before the red zone: the needle bouncing costs speed and cooks the engine.' });
  if (early / n > 0.25) tips.push({ w: early * 2, s: 'You shift early (' + early + ' of ' + n + '). Wait for the light bar to turn fully green; early shifts bog the engine below its power band.' });
  if (late / n > 0.25) tips.push({ w: late * 2, s: 'You shift late (' + late + ' of ' + n + '). Commit as soon as the bar turns green; the engine is already past its best torque.' });
  let worst = -1;
  let worstOff = 0;
  byGear.forEach((b, g) => {
    if (b.n >= 2 && Math.abs(b.off / b.n) > Math.abs(worstOff)) {
      worstOff = b.off / b.n;
      worst = g;
    }
  });
  if (worst >= 0 && Math.abs(worstOff) > 0.45) tips.push({ w: Math.abs(worstOff) * 4, s: 'Gear ' + (worst + 1) + ' to ' + (worst + 2) + ' is your weak shift: on average ' + (worstOff < 0 ? 'early' : 'late') + '. The ideal point moves per gear - watch the ' + (worstOff < 0 ? 'right' : 'left') + ' edge of the green band.' });
  const perfect = log.filter((r) => r.cls === 'perfect').length;
  if (perfect / n >= 0.6) tips.push({ w: 1, s: 'Great rhythm: ' + perfect + ' perfect shifts. Save turbo for the long straights after a braking zone.' });
  if (!tips.length) tips.push({ w: 0, s: 'Solid run. Chain excellent shifts to build the combo multiplier up to x4.' });
  tips.sort((a, b) => b.w - a.w);
  return tips.slice(0, 3).map((t) => t.s);
}

/** Short live hint after a pattern of misses (returns '' when there is nothing to say). */
export function coachLive(log: ShiftRecord[]): string {
  const k = log.length;
  if (k < 2) return '';
  const last = log.slice(-3);
  const e = last.filter((r) => r.cls === 'early').length;
  const l = last.filter((r) => r.cls === 'late' || r.cls === 'overload').length;
  if (e >= 2) return 'COACH: a touch later - wait for green';
  if (l >= 2) return 'COACH: shift sooner - before the red';
  return '';
}

// ------------------------------------------------------------------ progression, records, achievements, daily
export function tierOf(xp: number): number {
  let t = 0;
  for (let i = 0; i < TIER_XP.length; i++) if (xp >= TIER_XP[i]) t = i;
  return t;
}

export interface RaceResult {
  mode: ModeId;
  track: string;
  car: string;
  diff: DiffId;
  score: number;
  time: number;
  distance: number;
  maxKmh: number;
  maxRpm: number;
  shifts: number;
  perfect: number;
  accuracy: number;
  bestCombo: number;
  grade: Grade;
  finished: boolean;
  leverShifts: number;
  boostUses: number;
  overheated: boolean;
  overloads: number;
  ghostBeaten: boolean;
  daily: boolean;
  date: string;
}

export function resultOf(sim: RaceSim, ghost: GhostData | null, daily: boolean, date: string): RaceResult {
  const finished = sim.phase === 'finished';
  return {
    mode: sim.mode.id,
    track: sim.track.id,
    car: sim.car.id,
    diff: sim.diff.id,
    score: Math.round(sim.score),
    time: Math.round(sim.raceT * 100) / 100,
    distance: Math.round(sim.distance),
    maxKmh: Math.round(sim.maxSpeed * KMH),
    maxRpm: Math.round(sim.maxRpm),
    shifts: sim.log.length,
    perfect: sim.counts.perfect,
    accuracy: Math.round(sim.accuracy * 1000) / 10,
    bestCombo: sim.bestCombo,
    grade: gradeOf(sim),
    finished,
    leverShifts: sim.leverShifts,
    boostUses: sim.boostUses,
    overheated: sim.overheated,
    overloads: sim.counts.overload,
    ghostBeaten: finished && !!ghost && (sim.mode.distance > 0 ? sim.raceT < ghost.time : sim.score > ghost.score),
    daily,
    date,
  };
}

export interface RecordEntry {
  score: number;
  time: number;
  grade: Grade;
  car: string;
  diff: DiffId;
  date: string;
}
export interface Records {
  best: Record<string, { score: number; time: number; combo: number; kmh: number; accuracy: number }>;
  board: Record<string, RecordEntry[]>;
}
export const recordKey = (mode: string, track: string): string => mode + '@' + track;

/** Merge a result into the records; returns which personal bests it set. */
export function applyRecords(rec: Records, r: RaceResult): { score: boolean; time: boolean; combo: boolean; kmh: boolean; rank: number } {
  const key = recordKey(r.mode, r.track);
  const prev = rec.best[key];
  const out = { score: false, time: false, combo: false, kmh: false, rank: -1 };
  const b = prev ? { ...prev } : { score: 0, time: 0, combo: 0, kmh: 0, accuracy: 0 };
  if (r.score > b.score) {
    b.score = r.score;
    out.score = true;
  }
  if (r.finished && (r.mode === 'quick' || r.mode === 'timeattack' || r.mode === 'endurance' || r.mode === 'vrcockpit') && (b.time === 0 || r.time < b.time)) {
    b.time = r.time;
    out.time = true;
  }
  if (r.bestCombo > b.combo) {
    b.combo = r.bestCombo;
    out.combo = true;
  }
  if (r.maxKmh > b.kmh) {
    b.kmh = r.maxKmh;
    out.kmh = true;
  }
  b.accuracy = Math.max(b.accuracy, r.accuracy);
  rec.best[key] = b;
  const list = (rec.board[key] ??= []);
  const entry: RecordEntry = { score: r.score, time: r.time, grade: r.grade, car: r.car, diff: r.diff, date: r.date };
  list.push(entry);
  list.sort((a, c) => c.score - a.score);
  if (list.length > 10) list.length = 10;
  out.rank = list.indexOf(entry);
  return out;
}

/** Interface for a future online leaderboard; the shipped build only has the local implementation. */
export interface LeaderboardProvider {
  readonly online: boolean;
  submit(key: string, entry: RecordEntry): Promise<number>;
  top(key: string, n: number): Promise<RecordEntry[]>;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  test: (r: RaceResult, sim: { bestPerfectStreak: number }) => boolean;
}
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-perfect', name: 'Clean Cut', desc: 'Land a PERFECT shift', test: (r) => r.perfect >= 1 },
  { id: 'combo5', name: 'In The Groove', desc: 'Reach a x5 combo', test: (r) => r.bestCombo >= 5 },
  { id: 'combo10', name: 'Metronome', desc: 'Reach a x10 combo', test: (r) => r.bestCombo >= 10 },
  { id: 'streak5', name: 'Five Emeralds', desc: '5 PERFECT shifts in a row', test: (_r, s) => s.bestPerfectStreak >= 5 },
  { id: 'kmh300', name: 'Three Hundred', desc: 'Reach 300 km/h', test: (r) => r.maxKmh >= 300 },
  { id: 'gradeS', name: 'S-Rank Driver', desc: 'Finish a race with grade S or better', test: (r) => r.finished && (r.grade === 'S' || r.grade === 'S+') },
  { id: 'flawless', name: 'Flawless', desc: 'Finish with no early, late or overload shifts', test: (r) => r.finished && r.grade === 'S+' },
  { id: 'ghost', name: 'Ghostbuster', desc: 'Beat your own ghost', test: (r) => r.ghostBeaten },
  { id: 'turbo', name: 'Overdrive', desc: 'Fire the manual turbo 3 times in one race', test: (r) => r.boostUses >= 3 },
  { id: 'cool', name: 'Cool Head', desc: 'Finish Endurance without overheating', test: (r) => r.mode === 'endurance' && r.finished && !r.overheated },
  { id: 'lever', name: 'Hands On', desc: 'Make 10 shifts with the VR gear lever in one race', test: (r) => r.leverShifts >= 10 },
  { id: 'elite', name: 'Elite', desc: 'Finish any race on ELITE', test: (r) => r.finished && r.diff === 'elite' },
  { id: 'daily', name: 'Daily Driver', desc: 'Finish a daily challenge', test: (r) => r.daily && r.finished },
  { id: 'gold', name: 'Gold Standard', desc: 'Win a GOLD medal in Time Attack', test: (r) => r.mode === 'timeattack' && r.finished && r.time <= (MODES[2].medals as number[])[0] },
];

export function newAchievements(have: string[], r: RaceResult, sim: { bestPerfectStreak: number }): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !have.includes(a.id) && a.test(r, sim));
}

/** Deterministic daily challenge from a date string (yyyy-mm-dd). */
export interface Daily {
  date: string;
  mode: ModeId;
  track: string;
  car: string;
  diff: DiffId;
  modifier: { name: string; windowMod: number; heatMod: number; rain: boolean };
}
const DAILY_MODS = [
  { name: 'RAIN STORM', windowMod: 0.95, heatMod: 0.9, rain: true },
  { name: 'HOT ENGINE', windowMod: 1, heatMod: 1.5, rain: false },
  { name: 'RAZOR WINDOWS', windowMod: 0.8, heatMod: 1, rain: false },
  { name: 'COOL NIGHT', windowMod: 1.1, heatMod: 0.8, rain: false },
];
export function dailyFor(date: string): Daily {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const pick = <T>(a: T[], salt: number): T => a[(((h >>> salt) ^ Math.imul(h, salt + 1)) >>> 0) % a.length] as T;
  const modes: ModeId[] = ['quick', 'perfect', 'timeattack', 'turborush'];
  return {
    date,
    mode: pick(modes, 3),
    track: pick(TRACKS, 7).id,
    car: pick(CARS, 11).id,
    diff: pick(DIFFS.slice(1, 4), 13).id,
    modifier: pick(DAILY_MODS, 17),
  };
}

export const findCar = (id: string): CarSpec => CARS.find((c) => c.id === id) ?? CARS[0];
export const findDiff = (id: string): Difficulty => DIFFS.find((d) => d.id === id) ?? DIFFS[1];
export const findTrack = (id: string): Track => TRACKS.find((t) => t.id === id) ?? TRACKS[0];
export const findMode = (id: string): ModeSpec => MODES.find((m) => m.id === id) ?? MODES[0];
