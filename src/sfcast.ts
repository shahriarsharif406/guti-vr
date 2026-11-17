/**
 * SPELLFORGE spell casting (pure logic). Turns gesture output into spell charging and casts.
 * Each element has its own signature interaction; two different attuned elements form a fusion that is
 * cast through the two-palm orb. Holding a full charge for a second overcharges the spell (advanced version).
 */
import type { Element, SpellDef } from './sfdata';
import { ADVANCED_SPELLS, BASE_SPELLS, FUSIONS, resolveSpell } from './sfdata';
import type { GestureOut, HandFrame, Head, Side, V3 } from './sfgesture';

export type Mode = 'none' | 'orb' | 'spear' | 'arc' | 'beam' | 'vines' | 'void';
export interface CastView {
  mode: Mode;
  active: boolean;
  elements: [Element, Element];
  pos: V3;
  dir: V3;
  /** visual size 0..1 */
  size: number;
  charge: number;
  overcharge: number;
  overcharged: boolean;
  cooldown: number;
  hint: string;
  spell: SpellDef;
}
export type CastEvent =
  | { t: 'cast'; spell: SpellDef; power: number; origin: V3; dir: V3; fresh: boolean }
  | { t: 'beam'; spell: SpellDef; power: number; origin: V3; dir: V3; dt: number }
  | { t: 'beamEnd' }
  | { t: 'fizzle'; why: string }
  | { t: 'discover'; spell: SpellDef }
  | { t: 'unlock'; spell: SpellDef };

export const ADV_CASTS = 5;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const mid = (a: V3, b: V3): V3 => mul(add(a, b), 0.5);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const dist = (a: V3, b: V3): number => len(sub(a, b));

const SIGNATURE: Record<Element, Mode> = { fire: 'orb', ice: 'spear', lightning: 'arc', aether: 'beam', nature: 'vines', shadow: 'void' };

export class SpellCaster {
  left: Element = 'fire';
  right: Element = 'fire';
  energy = 100;
  maxEnergy = 100;
  counts: Record<Element, number> = { fire: 0, ice: 0, lightning: 0, aether: 0, nature: 0, shadow: 0 };
  discovered = new Set<string>();
  /** training and sandbox never run out of energy */
  infinite = false;
  private charge = 0;
  private density = 0;
  private overT = 0;
  private cd = 0;
  private mode: Mode = 'none';
  private view: CastView;
  private beaming = false;
  private beamAcc = 0;
  private reachT = 0;
  private lastPinchPull = 0;
  private fistOpenGrace = 0;
  private wasFist = false;

  constructor() {
    this.view = this.makeView(BASE_SPELLS.fire);
  }
  private makeView(spell: SpellDef): CastView {
    return { mode: 'none', active: false, elements: [this.left, this.right], pos: [0, 1.2, -0.4], dir: [0, 0, -1], size: 0, charge: 0, overcharge: 0, overcharged: false, cooldown: 0, hint: '', spell };
  }

  advancedUnlocked = (e: Element): boolean => this.counts[e] >= ADV_CASTS;
  attune(side: Side | 'both', e: Element): void {
    if (side === 'both' || side === 'left') this.left = e;
    if (side === 'both' || side === 'right') this.right = e;
    this.cancel();
  }
  currentSpell(overcharged = false): SpellDef {
    return resolveSpell(this.left, this.right, overcharged, this.advancedUnlocked);
  }
  interaction(): Mode {
    return this.left !== this.right ? 'orb' : SIGNATURE[this.left];
  }
  cancel(): void {
    this.charge = 0;
    this.density = 0;
    this.overT = 0;
    this.mode = 'none';
    this.beaming = false;
  }

  /** returns the events of this frame; read `view` afterwards for visuals */
  update(dt: number, g: GestureOut, L: HandFrame | null, R: HandFrame | null, head: Head, can: { shield: boolean }): { events: CastEvent[]; view: CastView } {
    const events: CastEvent[] = [];
    this.cd = Math.max(0, this.cd - dt);
    this.energy = clamp(this.energy + (this.infinite ? 100 : (g.collecting ? 24 : 7)) * dt, 0, this.maxEnergy);
    if (this.infinite) this.energy = this.maxEnergy;
    const inter = this.interaction();
    const spell = this.currentSpell(false);
    const v = this.view;
    v.elements = [this.left, this.right];
    v.spell = spell;
    v.cooldown = this.cd;
    v.hint = '';
    let want = false; // the precondition pose for the current interaction is held
    let pos: V3 = v.pos;
    let dir: V3 = head.fwd;
    let size = 0;
    let rate = 0;
    let release = false;
    let releaseDir: V3 | null = null;
    const both = L && R && L.tracked && R.tracked;
    const evs = g.events;
    const push = evs.find((e) => e.t === 'push') as Extract<(typeof evs)[number], { t: 'push' }> | undefined;
    const aimBlend = (d: V3): V3 => norm(add(mul(d, 0.5), mul(head.fwd, 0.5)));

    if (can.shield) {
      // the shield and casting are exclusive
      this.cancel();
      v.mode = 'none';
      v.active = false;
      v.size = 0;
      return { events, view: v };
    }

    if (inter === 'orb') {
      if (both && g.orbFormed) {
        want = true;
        pos = mid(L.palm, R.palm);
        size = clamp((g.spread - 0.1) / 0.4, 0.06, 1);
        rate = 0.42 + Math.max(0, g.spreadRate) * 0.9;
        if (evs.some((e) => e.t === 'rotate') || g.spreadRate < -0.25) this.density = clamp(this.density + 0.25, 0, 1);
        v.hint = this.left !== this.right ? 'Fusion: ' + this.currentSpell().name + ' - push to release' : 'Spread to grow, rotate to compress, push to launch';
        if (push) {
          release = true;
          releaseDir = aimBlend(push.dir);
        }
      }
    } else if (inter === 'arc') {
      if (both && g.orbFormed && g.spread > 0.3) {
        want = true;
        pos = mid(L.palm, R.palm);
        size = clamp((g.spread - 0.25) / 0.4, 0.1, 1);
        rate = 0.55 + clamp(g.spread - 0.3, 0, 0.3);
        v.hint = 'Arc crackling - thrust a hand at the target';
        if (push) {
          release = true;
          releaseDir = aimBlend(push.dir);
        }
      } else if (both && g.orbFormed) v.hint = 'Spread your palms wider';
    } else if (inter === 'spear') {
      if (both) {
        const lp = g.pose.left === 'pinch';
        const rp = g.pose.right === 'pinch';
        const palm = lp ? R : rp ? L : null;
        const pin = lp ? L : rp ? R : null;
        if (palm && pin && dot(palm.normal, head.fwd) > 0.2) {
          const pull = dist(pin.pinchPt, palm.palm);
          this.lastPinchPull = pull;
          if (pull > 0.1) {
            want = true;
            pos = mid(palm.palm, pin.pinchPt);
            dir = norm(add(mul(palm.aim, 0.6), mul(head.fwd, 0.4)));
            size = clamp((pull - 0.08) / 0.4, 0.1, 1);
            rate = 0.5 + size * 0.5;
            v.hint = 'Pull to sharpen, release the pinch to launch';
          }
        }
        const pe = evs.find((e) => e.t === 'pinchEnd') as Extract<(typeof evs)[number], { t: 'pinchEnd' }> | undefined;
        if (pe && pe.dist > 0.15 && this.charge > 0.12) {
          release = true;
          const palm2 = pe.hand === 'left' ? R : L;
          releaseDir = palm2 ? aimBlend(palm2.aim) : head.fwd;
          pos = this.view.pos;
        }
      }
    } else if (inter === 'beam') {
      if (both && L.normal && dot(L.normal, head.fwd) > 0.45 && dot(R.normal, head.fwd) > 0.45 && g.spread > 0.08 && g.spread < 0.5 && g.pose.left !== 'fist' && g.pose.right !== 'fist') {
        want = true;
        pos = mid(L.palm, R.palm);
        dir = norm(add(mul(L.aim, 0.5), mul(R.aim, 0.5)));
        size = clamp(g.spread / 0.3, 0.2, 1);
        rate = 0.9;
        v.hint = 'Hold steady: the beam follows your hands';
      }
    } else if (inter === 'vines') {
      let low: HandFrame | null = null;
      for (const h of [L, R]) if (h && h.tracked && h.palm[1] < head.pos[1] - 0.5 && h.normal[1] < -0.4) low = h;
      if (low) {
        want = true;
        this.reachT += dt;
        pos = [low.palm[0], low.palm[1] - 0.05, low.palm[2]];
        size = clamp(this.reachT / 1.2, 0.1, 1);
        rate = 0.75;
        v.hint = 'Draw a circle to raise the vines';
        const c = evs.find((e) => e.t === 'circle');
        if (c) {
          release = true;
          releaseDir = head.fwd;
        }
      } else this.reachT = 0;
    } else if (inter === 'void') {
      let fist: HandFrame | null = null;
      let other: HandFrame | null = null;
      if (both) {
        if (g.pose.left === 'fist' && g.pose.right !== 'fist') {
          fist = L;
          other = R;
        } else if (g.pose.right === 'fist' && g.pose.left !== 'fist') {
          fist = R;
          other = L;
        }
      }
      if (fist && other && dist(fist.palm, other.palm) > 0.22 && dot(sub(other.palm, fist.palm), head.fwd) < -0.05) {
        want = true;
        this.wasFist = true;
        this.fistOpenGrace = 0.25;
        pos = fist.palm;
        dir = norm(add(mul(fist.aim, 0.5), mul(head.fwd, 0.5)));
        size = clamp((dist(fist.palm, other.palm) - 0.2) / 0.4, 0.1, 1);
        rate = 0.6;
        v.hint = 'Pull back to feed it, open your fist to send it';
      } else if (this.wasFist) {
        // the fist opened: release
        this.fistOpenGrace -= dt;
        const anyFist = g.pose.left === 'fist' || g.pose.right === 'fist';
        if (!anyFist && this.charge > 0.15) {
          release = true;
          releaseDir = norm(add(mul(L && L.tracked ? L.aim : head.fwd, 0.4), mul(head.fwd, 0.6)));
          this.wasFist = false;
        } else if (this.fistOpenGrace <= 0) this.wasFist = false;
        pos = v.pos;
      }
    }

    // charging
    if (want && this.cd <= 0) {
      this.charge = clamp(this.charge + rate * dt, 0, 1);
      this.mode = inter;
      v.pos = pos;
      v.dir = dir;
      v.size = size;
      if (this.charge >= 0.98) this.overT += dt;
      else this.overT = Math.max(0, this.overT - dt);
      v.overcharged = this.overT >= 1.0;
    } else if (!want) {
      // losing the pose bleeds the charge off (hysteresis: a flicker does not wipe it instantly)
      if (!(inter === 'spear' && this.charge > 0.12 && release) && !(inter === 'void' && this.wasFist)) {
        this.charge = Math.max(0, this.charge - dt * 1.6);
        this.density = Math.max(0, this.density - dt * 0.5);
        if (this.charge <= 0.001) {
          this.mode = 'none';
          this.overT = 0;
          v.overcharged = false;
        }
      }
    }

    // beam is a channel, everything else is charge and release
    if (inter === 'beam') {
      if (want && this.cd <= 0 && this.charge > 0.5) {
        const cost = spell.cost * 0.5;
        if (!this.beaming) {
          this.beaming = true;
          this.countCast(spell, events);
        }
        const drain = cost * dt * (0.5 + this.charge * 0.5);
        if (this.energy < drain) {
          this.beaming = false;
          this.cancel();
          events.push({ t: 'fizzle', why: 'Out of energy' });
          events.push({ t: 'beamEnd' });
        } else {
          this.energy -= drain;
          this.beamAcc += dt;
          if (this.beamAcc >= 0.1) {
            events.push({ t: 'beam', spell, power: 0.5 + this.charge * 0.5, origin: pos, dir, dt: this.beamAcc });
            this.beamAcc = 0;
          }
        }
      } else if (this.beaming) {
        this.beaming = false;
        events.push({ t: 'beamEnd' });
        if (this.overT >= 1.0 && this.advancedUnlocked('aether')) release = true;
        else if (this.overT >= 1.0) events.push({ t: 'fizzle', why: 'Aether Nova unlocks after 5 casts' });
        releaseDir = head.fwd;
        if (release) this.cancelKeepCharge();
      }
      if (release) {
        const adv = ADVANCED_SPELLS.aether;
        if (this.energy >= adv.cost * 0.6) this.fire(adv, 1, v.pos, releaseDir ?? head.fwd, events);
        else events.push({ t: 'fizzle', why: 'Not enough energy' });
        this.cancel();
        release = false;
      }
    } else if (release) {
      const overcharged = this.overT >= 1.0;
      const adv = overcharged && this.advancedUnlocked(this.left) && this.left === this.right;
      const sp = overcharged ? this.currentSpell(true) : spell;
      if (overcharged && !adv && this.left === this.right) events.push({ t: 'fizzle', why: sp.name + ' needs ' + ADV_CASTS + ' casts of this element' });
      const power = clamp(0.3 + 0.7 * this.charge + this.density * 0.15, 0.2, 1.25);
      if (this.cd > 0) events.push({ t: 'fizzle', why: 'Recovering' });
      else if (this.energy < sp.cost * Math.max(0.5, power) * 0.8) events.push({ t: 'fizzle', why: 'Not enough energy' });
      else if (this.charge < 0.12) events.push({ t: 'fizzle', why: 'Too weak' });
      else this.fire(sp, power, v.pos, releaseDir ?? head.fwd, events);
      this.cancel();
      this.reachT = 0;
    }

    v.charge = this.charge;
    v.overcharge = clamp(this.overT, 0, 1);
    v.mode = this.charge > 0.02 || (want && this.cd <= 0) ? inter : 'none';
    v.active = v.mode !== 'none';
    if (this.cd > 0 && want) v.hint = 'Recovering...';
    if (!v.active) v.size = Math.max(0, v.size - dt * 3);
    return { events, view: v };
  }

  private cancelKeepCharge(): void {
    this.beaming = false;
  }

  private fire(spell: SpellDef, power: number, origin: V3, dir: V3, events: CastEvent[]): void {
    const cost = spell.cost * Math.max(0.5, power);
    this.energy = Math.max(0, this.energy - cost);
    this.cd = spell.cooldown;
    const fresh = this.countCast(spell, events);
    events.push({ t: 'cast', spell, power, origin, dir: norm(dir), fresh });
  }
  /** mastery and discovery bookkeeping; returns true when the spell was new */
  private countCast(spell: SpellDef, events: CastEvent[]): boolean {
    const el = spell.elements;
    for (const e of el) this.counts[e]++;
    for (const e of el) {
      if (this.counts[e] === ADV_CASTS && el.length === 1) events.push({ t: 'unlock', spell: ADVANCED_SPELLS[e] });
    }
    let fresh = false;
    if (!this.discovered.has(spell.id)) {
      this.discovered.add(spell.id);
      if (spell.tier !== 'base') {
        fresh = true;
        events.push({ t: 'discover', spell });
      }
    }
    return fresh;
  }
  /** called by the battle for fire-and-forget heals etc. */
  addEnergy(n: number): void {
    this.energy = clamp(this.energy + n, 0, this.maxEnergy);
  }
  static allFusionIds(): string[] {
    return FUSIONS.map((f) => f.id);
  }
}
