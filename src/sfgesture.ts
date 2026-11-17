/**
 * SPELLFORGE gesture recognition (pure logic, no rendering, no DOM).
 * A state machine over two tracked hands: poses with hysteresis, two-hand shapes, motion gestures,
 * confidence, cooldowns, tracking-loss recovery and false-positive guards.
 * Everything is in metres and world space; the head frame supplies "forward" and "right".
 */
export type V3 = [number, number, number];
export type Pose = 'none' | 'open' | 'fist' | 'pinch' | 'point';
export type Side = 'left' | 'right';

export interface HandFrame {
  tracked: boolean;
  /** 0..1 how trustworthy the joint data is (1 for good tracking) */
  conf: number;
  palm: V3;
  /** unit vector out of the palm */
  normal: V3;
  /** unit vector along the fingers (where the hand points) */
  aim: V3;
  wrist: V3;
  /** thumb, index, middle, ring, pinky tips */
  tips: V3[];
  /** thumb, index, middle, ring, pinky: 0 straight, 1 fully curled */
  curl: number[];
  /** 0 open .. 1 thumb and index touching */
  pinch: number;
  pinchPt: V3;
}
export interface Head {
  pos: V3;
  fwd: V3; // horizontal unit
  right: V3; // horizontal unit
}

export type GEvent =
  | { t: 'orbForm' }
  | { t: 'orbBreak' }
  | { t: 'push'; hand: Side | 'both'; speed: number; dir: V3; conf: number }
  | { t: 'shield'; on: boolean }
  | { t: 'up'; hand: Side; speed: number }
  | { t: 'down'; hand: Side; speed: number }
  | { t: 'circle'; hand: Side; dir: 1 | -1 }
  | { t: 'rotate'; dir: 1 | -1 }
  | { t: 'pinchStart'; hand: Side }
  | { t: 'pinchEnd'; hand: Side; dist: number }
  | { t: 'lost'; hand: Side }
  | { t: 'recovered'; hand: Side }
  | { t: 'collect'; on: boolean };

export interface GestureOut {
  pose: Record<Side, Pose>;
  poseConf: Record<Side, number>;
  tracked: Record<Side, boolean>;
  palmsFacing: boolean;
  orbHeld: number;
  orbFormed: boolean;
  spread: number;
  /** m/s, positive when the hands move apart */
  spreadRate: number;
  rotationRate: number;
  shield: boolean;
  collecting: boolean;
  /** palm vertical speed per hand (m/s) */
  vy: Record<Side, number>;
  conf: number;
  events: GEvent[];
}

export const T = {
  poseHold: 0.08, // a new pose must persist this long before it is accepted
  facingMaxDist: 0.55,
  facingDot: -0.45,
  orbForm: 0.25,
  orbGrace: 0.2,
  pushSpeed: 1.15,
  pushFwdDot: 0.25,
  pushCooldown: 0.45,
  pushArm: 0.1, // hand must have been quiet this long
  shieldEnter: 0.2,
  shieldExit: 0.15,
  upSpeed: 1.5,
  downSpeed: -1.7,
  vertCooldown: 0.7,
  circleSpan: 1.6,
  circleAngle: 5.0,
  circleCooldown: 0.9,
  rotateAngle: 0.85,
  rotateCooldown: 0.7,
  lostAfter: 0.25,
  minConf: 0.5,
  collectHold: 0.5,
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const dist = (a: V3, b: V3): number => len(sub(a, b));
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return scale(a, 1 / l);
};

interface HandState {
  last: V3 | null;
  vel: V3;
  pose: Pose;
  cand: Pose;
  candT: number;
  lost: number;
  wasLost: boolean;
  quiet: number;
  armed: boolean;
  pinching: boolean;
  pinchStartPt: V3 | null;
  vertCd: number;
  circleCd: number;
  trail: { x: number; y: number; t: number }[];
  collectT: number;
}
const newHand = (): HandState => ({ last: null, vel: [0, 0, 0], pose: 'none', cand: 'none', candT: 0, lost: 99, wasLost: false, quiet: 0, armed: false, pinching: false, pinchStartPt: null, vertCd: 0, circleCd: 0, trail: [], collectT: 0 });

function classify(h: HandFrame, prev: Pose): { pose: Pose; conf: number } {
  const c = h.curl;
  const fing = (c[1] + c[2] + c[3] + c[4]) / 4;
  const slack = prev === 'fist' ? 0.12 : 0;
  if (h.pinch > (prev === 'pinch' ? 0.65 : 0.82) && c[2] < 0.8) return { pose: 'pinch', conf: Math.min(1, h.pinch) };
  if (fing > 0.72 - slack) return { pose: 'fist', conf: Math.min(1, (fing - 0.5) * 2.2) };
  if (c[1] < (prev === 'point' ? 0.4 : 0.3) && (c[2] + c[3] + c[4]) / 3 > 0.62) return { pose: 'point', conf: Math.min(1, (1 - c[1]) * ((c[2] + c[3] + c[4]) / 3)) };
  if (fing < (prev === 'open' ? 0.42 : 0.3)) return { pose: 'open', conf: Math.min(1, (0.55 - fing) * 2.2) };
  return { pose: 'none', conf: 0.4 };
}

export class GestureEngine {
  private hs: Record<Side, HandState> = { left: newHand(), right: newHand() };
  private facingT = 0;
  private facingGrace = 0;
  private formed = false;
  private pushCd = 0;
  private shieldT = 0;
  private shieldOn = false;
  private uncrossT = 0;
  private spreadPrev = -1;
  private spreadRate = 0;
  private rotAcc = 0;
  private rotPrev: number | null = null;
  private rotAge = 0;
  private rotCd = 0;
  private rotRate = 0;
  private collecting = false;
  private time = 0;

  reset(): void {
    this.hs = { left: newHand(), right: newHand() };
    this.facingT = 0;
    this.facingGrace = 0;
    this.formed = false;
    this.shieldOn = false;
    this.shieldT = 0;
    this.spreadPrev = -1;
  }

  update(dt: number, L: HandFrame | null, R: HandFrame | null, head: Head): GestureOut {
    this.time += dt;
    const events: GEvent[] = [];
    const frames: Record<Side, HandFrame | null> = { left: L && L.tracked ? L : null, right: R && R.tracked ? R : null };
    const out: GestureOut = {
      pose: { left: 'none', right: 'none' },
      poseConf: { left: 0, right: 0 },
      tracked: { left: false, right: false },
      palmsFacing: false,
      orbHeld: 0,
      orbFormed: false,
      spread: 0,
      spreadRate: 0,
      rotationRate: 0,
      shield: false,
      collecting: false,
      vy: { left: 0, right: 0 },
      conf: 0,
      events,
    };
    this.pushCd = Math.max(0, this.pushCd - dt);
    this.rotCd = Math.max(0, this.rotCd - dt);

    for (const side of ['left', 'right'] as Side[]) {
      const s = this.hs[side];
      const f = frames[side];
      s.vertCd = Math.max(0, s.vertCd - dt);
      s.circleCd = Math.max(0, s.circleCd - dt);
      if (!f) {
        s.lost += dt;
        if (s.lost > T.lostAfter && !s.wasLost) {
          s.wasLost = true;
          events.push({ t: 'lost', hand: side });
        }
        s.last = null;
        s.vel = [0, 0, 0];
        s.pose = 'none';
        s.pinching = false;
        continue;
      }
      if (s.wasLost) {
        s.wasLost = false;
        events.push({ t: 'recovered', hand: side });
      }
      s.lost = 0;
      out.tracked[side] = true;
      // smoothed velocity
      if (s.last && dt > 1e-4) {
        const v = scale(sub(f.palm, s.last), 1 / dt);
        const a = Math.min(1, dt * 14);
        s.vel = [s.vel[0] + (v[0] - s.vel[0]) * a, s.vel[1] + (v[1] - s.vel[1]) * a, s.vel[2] + (v[2] - s.vel[2]) * a];
      }
      s.last = f.palm;
      out.vy[side] = s.vel[1];
      // pose with a minimum hold time (hysteresis in classify)
      const c = classify(f, s.pose);
      if (c.pose === s.pose) {
        s.cand = s.pose;
        s.candT = 0;
      } else if (c.pose === s.cand) {
        s.candT += dt;
        if (s.candT >= T.poseHold) {
          s.pose = c.pose;
          s.candT = 0;
        }
      } else {
        s.cand = c.pose;
        s.candT = 0;
      }
      out.pose[side] = s.pose;
      out.poseConf[side] = c.conf * f.conf;
      // pinch begin / end (end reports how far the pinch travelled: used by the ice spear)
      const pinchNow = s.pose === 'pinch';
      if (pinchNow && !s.pinching) {
        s.pinching = true;
        s.pinchStartPt = f.pinchPt;
        events.push({ t: 'pinchStart', hand: side });
      } else if (!pinchNow && s.pinching) {
        s.pinching = false;
        const other = frames[side === 'left' ? 'right' : 'left'];
        events.push({ t: 'pinchEnd', hand: side, dist: other ? dist(f.pinchPt, other.palm) : 0 });
      }
      // quiet timer arms the push
      const speed = len(s.vel);
      s.quiet = speed < 0.6 ? s.quiet + dt : 0;
      if (s.quiet >= T.pushArm) s.armed = true;
      // vertical gestures
      if (s.vertCd <= 0 && s.pose !== 'pinch') {
        if (s.vel[1] > T.upSpeed) {
          events.push({ t: 'up', hand: side, speed: s.vel[1] });
          s.vertCd = T.vertCooldown;
        } else if (s.vel[1] < T.downSpeed) {
          events.push({ t: 'down', hand: side, speed: -s.vel[1] });
          s.vertCd = T.vertCooldown;
        }
      }
      // circle: signed angle swept around the trail centroid in the head's right/up plane
      const x = dot(sub(f.palm, head.pos), head.right);
      const y = f.palm[1];
      s.trail.push({ x, y, t: this.time });
      while (s.trail.length && this.time - s.trail[0].t > T.circleSpan) s.trail.shift();
      if (s.circleCd <= 0 && s.trail.length > 12 && s.pose !== 'pinch') {
        let cx = 0;
        let cy = 0;
        for (const p of s.trail) {
          cx += p.x;
          cy += p.y;
        }
        cx /= s.trail.length;
        cy /= s.trail.length;
        let sum = 0;
        let r = 0;
        let prev = Math.atan2(s.trail[0].y - cy, s.trail[0].x - cx);
        for (let i = 1; i < s.trail.length; i++) {
          const a = Math.atan2(s.trail[i].y - cy, s.trail[i].x - cx);
          let d = a - prev;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          sum += d;
          prev = a;
          r += Math.hypot(s.trail[i].x - cx, s.trail[i].y - cy);
        }
        r /= s.trail.length - 1;
        if (Math.abs(sum) > T.circleAngle && r > 0.04 && r < 0.38) {
          events.push({ t: 'circle', hand: side, dir: sum > 0 ? 1 : -1 });
          s.circleCd = T.circleCooldown;
          s.trail.length = 0;
        }
      }
    }

    const Lf = frames.left;
    const Rf = frames.right;
    out.conf = Math.min(Lf ? Lf.conf : 0, Rf ? Rf.conf : 0);

    // two-hand shapes
    if (Lf && Rf) {
      const d = dist(Lf.palm, Rf.palm);
      out.spread = d;
      const openish = (h: HandFrame): boolean => (h.curl[1] + h.curl[2] + h.curl[3] + h.curl[4]) / 4 < 0.6;
      const facing = d < T.facingMaxDist && dot(Lf.normal, Rf.normal) < T.facingDot && openish(Lf) && openish(Rf) && out.conf >= T.minConf;
      if (facing) {
        this.facingT += dt;
        this.facingGrace = T.orbGrace;
      } else {
        this.facingGrace -= dt;
        if (this.facingGrace <= 0) this.facingT = 0;
      }
      out.palmsFacing = facing;
      if (!this.formed && this.facingT >= T.orbForm) {
        this.formed = true;
        events.push({ t: 'orbForm' });
      } else if (this.formed && this.facingGrace <= 0) {
        this.formed = false;
        events.push({ t: 'orbBreak' });
      }
      if (this.spreadPrev >= 0 && dt > 1e-4) {
        const r = (d - this.spreadPrev) / dt;
        this.spreadRate += (r - this.spreadRate) * Math.min(1, dt * 10);
      }
      this.spreadPrev = d;
      // dual-hand rotation about the forward axis
      const v = sub(Rf.palm, Lf.palm);
      const ang = Math.atan2(v[1], dot(v, head.right));
      if (this.rotPrev !== null && d < 0.6) {
        let da = ang - this.rotPrev;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        this.rotAcc += da;
        this.rotAge += dt;
        this.rotRate = dt > 1e-4 ? da / dt : 0;
        if (this.rotAge > 1.0) {
          this.rotAcc *= 0.5;
          this.rotAge = 0.5;
        }
        if (this.rotCd <= 0 && Math.abs(this.rotAcc) > T.rotateAngle && out.conf >= T.minConf) {
          events.push({ t: 'rotate', dir: this.rotAcc > 0 ? 1 : -1 });
          this.rotCd = T.rotateCooldown;
          this.rotAcc = 0;
          this.rotAge = 0;
        }
      } else {
        this.rotAcc = 0;
        this.rotAge = 0;
        this.rotRate = 0;
      }
      this.rotPrev = ang;
      // crossed arms: wrists swapped sideways, both in front of the chest
      const lx = dot(sub(Lf.wrist, head.pos), head.right);
      const rx = dot(sub(Rf.wrist, head.pos), head.right);
      const lf = dot(sub(Lf.wrist, head.pos), head.fwd);
      const rf = dot(sub(Rf.wrist, head.pos), head.fwd);
      const hy = (Lf.wrist[1] + Rf.wrist[1]) / 2 - head.pos[1];
      const crossed = lx > rx + 0.02 && lf > 0.12 && lf < 0.75 && rf > 0.12 && rf < 0.75 && hy > -0.65 && hy < 0.08 && out.conf >= T.minConf;
      if (crossed) {
        this.uncrossT = 0;
        this.shieldT += dt;
        if (!this.shieldOn && this.shieldT >= T.shieldEnter) {
          this.shieldOn = true;
          events.push({ t: 'shield', on: true });
        }
      } else {
        this.shieldT = 0;
        this.uncrossT += dt;
        if (this.shieldOn && this.uncrossT >= T.shieldExit) {
          this.shieldOn = false;
          events.push({ t: 'shield', on: false });
        }
      }
    } else {
      // a tracking drop cancels two-hand state after the grace period
      this.facingGrace -= dt;
      if (this.facingGrace <= 0) {
        this.facingT = 0;
        if (this.formed) {
          this.formed = false;
          events.push({ t: 'orbBreak' });
        }
      }
      this.spreadPrev = -1;
      this.spreadRate = 0;
      this.rotPrev = null;
      this.rotAcc = 0;
      this.shieldT = 0;
      this.uncrossT += dt;
      if (this.shieldOn && this.uncrossT >= T.shieldExit) {
        this.shieldOn = false;
        events.push({ t: 'shield', on: false });
      }
    }

    // push: open palm facing forward, fast and deliberate, from a quiet start; one or both hands
    if (this.pushCd <= 0) {
      const hit: { side: Side; speed: number; dir: V3; conf: number }[] = [];
      for (const side of ['left', 'right'] as Side[]) {
        const f = frames[side];
        const s = this.hs[side];
        if (!f || s.pose === 'fist' || s.pose === 'pinch') continue;
        const along = dot(s.vel, head.fwd);
        const orbThrust = this.formed && along > 0 && along / (len(s.vel) || 1) > 0.8; // palms face each other inside an orb
        if (along > T.pushSpeed && (dot(f.normal, head.fwd) > T.pushFwdDot || orbThrust) && s.armed && f.conf >= T.minConf) {
          // armed = the hand was nearly still just before, so waving around never fires a spell
          s.armed = false;
          hit.push({ side, speed: along, dir: norm(s.vel), conf: f.conf });
        }
      }
      if (hit.length) {
        const sp = Math.max(...hit.map((h) => h.speed));
        const d = hit.length === 2 ? norm([hit[0].dir[0] + hit[1].dir[0], hit[0].dir[1] + hit[1].dir[1], hit[0].dir[2] + hit[1].dir[2]]) : hit[0].dir;
        events.push({ t: 'push', hand: hit.length === 2 ? 'both' : hit[0].side, speed: sp, dir: d, conf: Math.min(...hit.map((h) => h.conf)) });
        this.pushCd = T.pushCooldown;
      }
    }

    // energy collection: an open palm held up and still
    let coll = false;
    for (const side of ['left', 'right'] as Side[]) {
      const f = frames[side];
      const s = this.hs[side];
      if (f && s.pose === 'open' && f.normal[1] > 0.6 && len(s.vel) < 0.3) s.collectT += dt;
      else s.collectT = 0;
      if (s.collectT >= T.collectHold) coll = true;
    }
    if (coll !== this.collecting) {
      this.collecting = coll;
      events.push({ t: 'collect', on: coll });
    }

    out.orbHeld = this.facingT;
    out.orbFormed = this.formed;
    out.spreadRate = this.spreadRate;
    out.rotationRate = this.rotRate;
    out.shield = this.shieldOn;
    out.collecting = this.collecting;
    return out;
  }
}
