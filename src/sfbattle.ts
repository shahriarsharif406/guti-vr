/**
 * SPELLFORGE battle simulation (pure logic): player, enemy AI, boss phases, projectiles, status effects, damage.
 * Rendering and audio only read this state and its event list. Deterministic given a seed.
 */
import type { BossDef, EnemyDef, Element, PhaseDef, SpellDef, Status } from './sfdata';
import { BOSSES, COUNTER, DUMMY, ENEMIES, damageAgainst } from './sfdata';
import type { V3 } from './sfgesture';

export type BattleMode = 'campaign' | 'training' | 'endless' | 'bossrush' | 'sandbox' | 'trial';
export type EState = 'idle' | 'detect' | 'approach' | 'attack' | 'evade' | 'stagger' | 'recover' | 'retreat' | 'die';

export interface Enemy {
  id: number;
  def: EnemyDef;
  pos: V3;
  hp: number;
  maxHp: number;
  armorHp: number;
  state: EState;
  stateT: number;
  status: Partial<Record<Status, number>>;
  atkCd: number;
  telegraph: number; // > 0 while winding up
  burnTick: number;
  evadeCd: number;
  pullTo: V3 | null;
  retreated: boolean;
  blink: number;
  summoned: boolean;
}
export interface Pylon {
  pos: V3;
  overload: number;
}
export interface Boss {
  def: BossDef;
  pos: V3;
  anchor: number;
  hp: number;
  maxHp: number;
  phase: number;
  phaseT: number; // time inside the phase
  trans: number; // > 0 during the phase-change roar (invulnerable)
  atkT: number;
  atkIdx: number;
  winding: { kind: string; t: number; dur: number; el?: Element } | null;
  armorHp: number;
  summonT: number;
  vuln: number; // seconds of extra damage after a counter or overload
  barrier: boolean;
  absorbHist: Element[];
  teleT: number;
  dead: boolean;
  deathT: number;
  finisherOpen: boolean;
}
export interface Proj {
  id: number;
  owner: 'player' | 'enemy';
  spell: SpellDef | null;
  power: number;
  pos: V3;
  vel: V3;
  life: number;
  radius: number;
  kind: string; // visual kind: fireball, bolt, shadowOrb, ice, elementBurst, player
  element: Element;
  dmg: number;
  hp: number; // enemy projectiles can be shot down
  homing: number;
  reflectable: boolean;
  parry: boolean;
  fromBoss: boolean;
}
export interface Area {
  id: number;
  pos: V3;
  radius: number;
  age: number;
  dur: number;
  spell: SpellDef;
  power: number;
  tick: number;
  kind: 'nova' | 'cloud' | 'void' | 'vines' | 'prison';
  pulled: boolean;
}
export interface Ring {
  id: number;
  r: number;
  speed: number;
  dmg: number;
  arrive: number; // time until it reaches the player
  hit: boolean;
}

export type BEvent =
  | { t: 'hit'; pos: V3; element: Element; dmg: number; target: 'enemy' | 'boss' | 'pylon' | 'proj' }
  | { t: 'enemyDie'; pos: V3; id: number; def: string }
  | { t: 'telegraph'; who: 'enemy' | 'boss'; kind: string; dur: number; pos: V3; el?: Element }
  | { t: 'spawn'; id: number; def: string; pos: V3 }
  | { t: 'enemyProj'; proj: Proj }
  | { t: 'playerProj'; proj: Proj }
  | { t: 'shockwave'; ring: Ring }
  | { t: 'bolt'; pos: V3; from: V3 }
  | { t: 'area'; area: Area }
  | { t: 'playerHurt'; dmg: number; src: string }
  | { t: 'blocked'; pos: V3 }
  | { t: 'reflect'; pos: V3 }
  | { t: 'stomp' }
  | { t: 'armorBreak'; pos: V3 }
  | { t: 'bossPhase'; phase: number; name: string; note: string }
  | { t: 'bossVuln'; secs: number; why: string }
  | { t: 'barrier'; on: boolean }
  | { t: 'absorb'; el: Element }
  | { t: 'grant'; what: string }
  | { t: 'bossDie' }
  | { t: 'win' }
  | { t: 'lose' }
  | { t: 'wave'; n: number }
  | { t: 'status'; id: number; s: Status; on: boolean; pos: V3 }
  | { t: 'heal'; amount: number }
  | { t: 'beamHit'; pos: V3; element: Element }
  | { t: 'arc'; from: V3; points: V3[]; element: Element }
  | { t: 'teleport'; from: V3; to: V3; who: 'enemy' | 'boss' };

export interface Stats {
  casts: number;
  hits: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  time: number;
  wave: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const dist = (a: V3, b: V3): number => len(sub(a, b));
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/** distance from point p to the ray (o, d) and the ray parameter of the closest approach */
function rayPoint(o: V3, d: V3, p: V3): { dist: number; t: number } {
  const t = Math.max(0, dot(sub(p, o), d));
  const q = add(o, mul(d, t));
  return { dist: dist(q, p), t };
}

export const PLAYER_HEAD: V3 = [0, 1.35, 0];
export const ARENA_Z = -6;
const SHOCK_SPEED = 3.2;
const SHIELD_MAX = 80;

/** small deterministic generator so waves and boss choices replay identically in tests */
export class Rng {
  constructor(private s = 1234567) {}
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  pick<T>(a: T[]): T {
    return a[Math.floor(this.next() * a.length) % a.length];
  }
}

export interface BattleOpts {
  mode: BattleMode;
  boss?: string;
  seed?: number;
  /** player damage multiplier (accessibility / difficulty) */
  assist?: number;
  /** enemy damage multiplier */
  enemyDmg?: number;
}

export class Battle {
  mode: BattleMode;
  rng: Rng;
  time = 0;
  player = { hp: 100, maxHp: 100, shieldHp: SHIELD_MAX, shieldUp: false, shieldT: 99, hurtT: 0, regenT: 0 };
  enemies: Enemy[] = [];
  boss: Boss | null = null;
  pylons: Pylon[] = [];
  pProj: Proj[] = [];
  eProj: Proj[] = [];
  areas: Area[] = [];
  rings: Ring[] = [];
  stats: Stats = { casts: 0, hits: 0, kills: 0, damageDealt: 0, damageTaken: 0, time: 0, wave: 0 };
  events: BEvent[] = [];
  over: 'none' | 'win' | 'lose' = 'none';
  assist: number;
  enemyDmg: number;
  bossQueue: string[] = [];
  waveCd = 2;
  private nextId = 1;
  private downAt = -99;

  constructor(o: BattleOpts) {
    this.mode = o.mode;
    this.rng = new Rng(o.seed ?? 99);
    this.assist = o.assist ?? 1;
    this.enemyDmg = o.enemyDmg ?? 1;
    if (o.mode === 'training' || o.mode === 'sandbox') this.spawnDummy([0, 0, ARENA_Z + 1]);
    if (o.mode === 'campaign') this.bossQueue = ['ignar'];
    if (o.mode === 'bossrush') this.bossQueue = ['ignar', 'vyra', 'voidking'];
    if (o.boss) this.bossQueue = [o.boss];
    if (this.bossQueue.length) this.spawnBoss(this.bossQueue.shift() as string);
    if (o.mode === 'sandbox') this.player.maxHp = this.player.hp = 100;
  }

  // ------------------------------------------------------------------ spawning
  spawnEnemy(def: EnemyDef, pos: V3, summoned = false): Enemy {
    const scaleHp = this.mode === 'endless' ? 1 + this.stats.wave * 0.07 : 1;
    const e: Enemy = { id: this.nextId++, def, pos: [...pos], hp: def.hp * scaleHp, maxHp: def.hp * scaleHp, armorHp: def.armorHp, state: 'idle', stateT: 0.6, status: {}, atkCd: 1.2, telegraph: 0, burnTick: 0, evadeCd: 0, pullTo: null, retreated: false, blink: 4 + this.rng.next() * 3, summoned };
    this.enemies.push(e);
    this.events.push({ t: 'spawn', id: e.id, def: def.id, pos: e.pos });
    return e;
  }
  spawnDummy(pos: V3): Enemy {
    return this.spawnEnemy(DUMMY, pos);
  }
  spawnBoss(id: string): void {
    const def = BOSSES[id];
    this.boss = {
      def, pos: [0, 0, ARENA_Z - 1], anchor: 0, hp: def.hp, maxHp: def.hp, phase: 0, phaseT: 0, trans: 2.2, atkT: 4, atkIdx: 0, winding: null,
      armorHp: 0, summonT: 6, vuln: 0, barrier: false, absorbHist: [], teleT: 6, dead: false, deathT: 0, finisherOpen: false,
    };
    this.pylons = [];
    this.events.push({ t: 'bossPhase', phase: 0, name: def.phases[0].name, note: def.intro });
    if (id === 'vyra') this.pylons = [{ pos: [-3, 0, ARENA_Z + 0.5], overload: 0 }, { pos: [0, 0, ARENA_Z + 2.5], overload: 0 }, { pos: [3, 0, ARENA_Z + 0.5], overload: 0 }];
    if (id === 'vyra') this.boss.pos = [0, 1.6, ARENA_Z];
    this.applyPhase(0, true);
  }
  private applyPhase(i: number, first = false): void {
    const b = this.boss;
    if (!b) return;
    const ph = b.def.phases[i];
    b.phase = i;
    b.phaseT = 0;
    if (!first) b.trans = 1.6;
    b.atkT = Math.max(b.atkT, 2.2);
    b.armorHp = ph.armor ? ph.armor.hp : 0;
    b.barrier = !!ph.barrier;
    b.summonT = ph.summon ? 3 : 99;
    b.absorbHist = [];
    if (ph.barrier) this.events.push({ t: 'barrier', on: true });
    if (ph.finisher && !b.finisherOpen) this.events.push({ t: 'grant', what: 'aether_nova' });
    if (!first) this.events.push({ t: 'bossPhase', phase: i, name: ph.name, note: ph.note });
    else this.events.push({ t: 'bossPhase', phase: i, name: ph.name, note: ph.note });
  }
  private phaseDef(): PhaseDef | null {
    return this.boss ? this.boss.def.phases[this.boss.phase] : null;
  }

  // ------------------------------------------------------------------ queries
  center(e: Enemy): V3 {
    const lift = e.def.behaviour === 'ranged' || e.def.id === 'arcane_sentinel' ? 1.2 : 0;
    return [e.pos[0], e.pos[1] + lift + e.def.scale * 0.7, e.pos[2]];
  }
  radiusOf(e: Enemy): number {
    return e.def.scale * 0.6;
  }
  bossCenter(): V3 {
    const b = this.boss as Boss;
    return [b.pos[0], b.pos[1] + b.def.scale * 0.55, b.pos[2]];
  }
  bossRadius(): number {
    const b = this.boss as Boss;
    return b.def.scale * 0.42;
  }
  alive(): Enemy[] {
    return this.enemies.filter((e) => e.state !== 'die');
  }
  /** first thing a ray hits, for aim and for hitscan spells */
  raycast(o: V3, d: V3, maxT = 30, extra = 0): { kind: 'enemy' | 'boss' | 'pylon' | 'none'; t: number; enemy?: Enemy; pylon?: Pylon; point: V3 } {
    let best: { kind: 'enemy' | 'boss' | 'pylon' | 'none'; t: number; enemy?: Enemy; pylon?: Pylon; point: V3 } = { kind: 'none', t: maxT, point: add(o, mul(d, maxT)) };
    const consider = (kind: 'enemy' | 'boss' | 'pylon', c: V3, r: number, ref?: Enemy | Pylon): void => {
      const rp = rayPoint(o, d, c);
      if (rp.dist <= r + extra && rp.t < best.t) best = { kind, t: rp.t, point: add(o, mul(d, rp.t)), enemy: kind === 'enemy' ? (ref as Enemy) : undefined, pylon: kind === 'pylon' ? (ref as Pylon) : undefined };
    };
    for (const e of this.enemies) if (e.state !== 'die') consider('enemy', this.center(e), this.radiusOf(e), e);
    if (this.boss && !this.boss.dead) consider('boss', this.bossCenter(), this.bossRadius());
    for (const p of this.pylons) consider('pylon', [p.pos[0], p.pos[1] + 1, p.pos[2]], 0.6, p);
    return best;
  }
  /** aim assist: bends a direction toward the nearest target inside a cone */
  assistDir(o: V3, d: V3, coneDeg = 14): V3 {
    if (this.assist <= 0) return d;
    let best: V3 | null = null;
    let bestDot = Math.cos((coneDeg * Math.PI) / 180);
    const tryT = (c: V3): void => {
      const dir = norm(sub(c, o));
      const dd = dot(dir, d);
      if (dd > bestDot) {
        bestDot = dd;
        best = dir;
      }
    };
    for (const e of this.enemies) if (e.state !== 'die') tryT(this.center(e));
    if (this.boss && !this.boss.dead) tryT(this.bossCenter());
    if (!best) return d;
    const k = 0.7 * this.assist;
    return norm(add(mul(d, 1 - k), mul(best, k)));
  }

  // ------------------------------------------------------------------ player actions
  /** a spell cast by the player; resolves by kind */
  cast(spell: SpellDef, power: number, origin: V3, dirIn: V3): void {
    this.stats.casts++;
    const dir = this.assistDir(origin, norm(dirIn));
    const el = spell.elements[spell.elements.length - 1];
    switch (spell.kind) {
      case 'projectile':
      case 'spear':
      case 'void': {
        const p: Proj = { id: this.nextId++, owner: 'player', spell, power, pos: [...origin], vel: mul(dir, spell.speed), life: 3.5, radius: spell.radius * (0.6 + 0.4 * power), kind: 'player', element: el, dmg: spell.damage * power, hp: 99, homing: 2.2 * this.assist, reflectable: false, parry: false, fromBoss: false };
        this.pProj.push(p);
        this.events.push({ t: 'playerProj', proj: p });
        break;
      }
      case 'arc':
        this.hitscanArc(spell, power, origin, dir);
        break;
      case 'vines': {
        const r = this.raycast(origin, dir, 14, 1.2);
        const pt: V3 = r.kind === 'none' ? add([origin[0], 0, origin[2]], mul([dir[0], 0, dir[2]], 7)) : [r.point[0], 0, r.point[2]];
        this.addArea(spell, power, pt, 'vines', 3.2);
        break;
      }
      case 'nova':
      case 'cloud': {
        const r = this.raycast(origin, dir, 16, 0.6);
        const pt: V3 = r.kind === 'none' ? [origin[0] + dir[0] * 6, 0, Math.min(origin[2] + dir[2] * 6, -2)] : [r.point[0], 0, r.point[2]];
        this.addArea(spell, power, pt, spell.kind === 'nova' ? (spell.status?.s === 'freeze' || spell.status?.s === 'root' ? 'prison' : 'nova') : 'cloud', spell.kind === 'nova' ? 1.1 : 5);
        break;
      }
      case 'beam':
        break;
    }
    if (spell.id === 'genesis_bloom') {
      const h = Math.round(18 * power);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + h);
      this.events.push({ t: 'heal', amount: h });
    }
  }
  private addArea(spell: SpellDef, power: number, pos: V3, kind: Area['kind'], dur: number): void {
    const a: Area = { id: this.nextId++, pos, radius: spell.radius * (0.8 + 0.2 * power), age: 0, dur, spell, power, tick: 0, kind: spell.kind === 'void' ? 'void' : kind, pulled: false };
    this.areas.push(a);
    this.events.push({ t: 'area', area: a });
    if (a.kind === 'nova' || a.kind === 'prison') this.applyAreaBurst(a);
  }
  /** one beam tick from a channelled Aether Beam */
  beamTick(spell: SpellDef, power: number, origin: V3, dirIn: V3, dt: number): void {
    const dir = this.assistDir(origin, norm(dirIn), 8);
    const el = spell.elements[0];
    const r = this.raycast(origin, dir, 40, spell.radius);
    if (r.kind === 'none') return;
    const dmg = spell.damage * power * dt * 6;
    if (r.kind === 'enemy' && r.enemy) this.damageEnemy(r.enemy, spell, power, dmg, r.point, false);
    else if (r.kind === 'boss') this.damageBoss(spell, power, dmg, r.point);
    this.events.push({ t: 'beamHit', pos: r.point, element: el });
  }
  private hitscanArc(spell: SpellDef, power: number, o: V3, d: V3): void {
    const r = this.raycast(o, d, 40, spell.radius);
    const pts: V3[] = [o];
    const el = spell.elements[0];
    const hitList: Enemy[] = [];
    if (r.kind === 'pylon' && r.pylon) {
      pts.push(r.point);
      this.overloadPylon(r.pylon);
    } else if (r.kind === 'enemy' && r.enemy) {
      pts.push(this.center(r.enemy));
      this.damageEnemy(r.enemy, spell, power, spell.damage * power, this.center(r.enemy), true);
      hitList.push(r.enemy);
    } else if (r.kind === 'boss') {
      pts.push(r.point);
      this.damageBoss(spell, power, spell.damage * power, r.point);
    } else {
      pts.push(r.point);
    }
    // chain to the nearest unhit enemies and to pylons
    let from = pts[pts.length - 1];
    for (let i = 0; i < (spell.chain ?? 0); i++) {
      let best: Enemy | null = null;
      let bd = 3.6;
      for (const e of this.enemies) {
        if (e.state === 'die' || hitList.includes(e)) continue;
        const dd = dist(from, this.center(e));
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      }
      if (!best) break;
      hitList.push(best);
      from = this.center(best);
      pts.push(from);
      this.damageEnemy(best, spell, power * 0.75, spell.damage * power * 0.75, from, true);
    }
    this.events.push({ t: 'arc', from: o, points: pts, element: el });
  }
  private overloadPylon(p: Pylon): void {
    if (p.overload > 0) return;
    p.overload = 8;
    this.events.push({ t: 'hit', pos: [p.pos[0], 1, p.pos[2]], element: 'lightning', dmg: 0, target: 'pylon' });
    if (this.boss && this.boss.barrier && this.pylons.every((q) => q.overload > 0)) {
      this.boss.barrier = false;
      this.boss.vuln = 7;
      this.events.push({ t: 'barrier', on: false });
      this.events.push({ t: 'bossVuln', secs: 7, why: 'Barrier down' });
    }
  }
  /** the 'down' gesture: breaks a shockwave that is about to arrive */
  stomp(): void {
    this.downAt = this.time;
  }
  setShield(up: boolean): void {
    if (up && !this.player.shieldUp) this.player.shieldT = 0;
    this.player.shieldUp = up && this.player.shieldHp > 0;
  }

  // ------------------------------------------------------------------ damage
  private statusAdd(e: Enemy, spell: SpellDef): void {
    const s = spell.status;
    if (!s || this.rng.next() > s.chance) return;
    if (e.def.id === 'dummy') return;
    const was = (e.status[s.s] ?? 0) > 0;
    e.status[s.s] = Math.max(e.status[s.s] ?? 0, s.dur);
    if (s.s === 'stun' || s.s === 'freeze') e.telegraph = 0;
    if (!was) this.events.push({ t: 'status', id: e.id, s: s.s, on: true, pos: this.center(e) });
  }
  damageEnemy(e: Enemy, spell: SpellDef, power: number, raw: number, at: V3, stat = true): void {
    if (e.state === 'die') return;
    const t = { resist: e.def.resist, armor: e.def.armor, armorHp: e.armorHp, armorBreak: e.def.armorBreak };
    const base = damageAgainst({ ...spell, damage: raw / Math.max(0.15, Math.min(1.25, power)) }, power, t);
    let dmg = base.dmg * this.assist;
    if ((e.status.freeze ?? 0) > 0) dmg *= 1.25;
    if (spell.id === 'voidflame') dmg = raw * this.assist; // ignores resistance
    e.armorHp = Math.max(0, e.armorHp - base.armorDmg);
    if (base.armorDmg > 0 && e.armorHp <= 0 && e.def.armorHp > 0) this.events.push({ t: 'armorBreak', pos: this.center(e) });
    e.hp -= dmg;
    if (stat) this.stats.hits++;
    this.stats.damageDealt += dmg;
    this.events.push({ t: 'hit', pos: at, element: spell.elements[spell.elements.length - 1], dmg, target: 'enemy' });
    this.statusAdd(e, spell);
    if (dmg > e.maxHp * 0.22 && e.def.id !== 'dummy' && e.state !== 'stagger') this.toState(e, 'stagger', 0.7);
    if (e.hp <= 0 && e.def.id !== 'dummy') this.kill(e);
    if (e.def.id === 'dummy' && e.hp <= 0) e.hp = e.maxHp;
  }
  private kill(e: Enemy): void {
    e.state = 'die';
    e.stateT = 0.9;
    e.telegraph = 0;
    this.stats.kills++;
    this.events.push({ t: 'enemyDie', pos: this.center(e), id: e.id, def: e.def.id });
  }
  damageBoss(spell: SpellDef, power: number, raw: number, at: V3): void {
    const b = this.boss;
    if (!b || b.dead) return;
    const ph = b.def.phases[b.phase];
    let dmg: number;
    const el = spell.elements[spell.elements.length - 1];
    if (b.trans > 0) dmg = 0;
    else {
      const base = damageAgainst({ ...spell, damage: raw / Math.max(0.15, Math.min(1.25, power)) }, power, { resist: b.def.resist, armor: ph.armor ? 0.65 : 0, armorHp: b.armorHp, armorBreak: ph.armor ? ph.armor.breakBy : [] });
      dmg = base.dmg;
      if (b.armorHp > 0 && base.armorDmg > 0) {
        b.armorHp = Math.max(0, b.armorHp - base.armorDmg);
        if (b.armorHp <= 0) {
          this.events.push({ t: 'armorBreak', pos: this.bossCenter() });
          this.events.push({ t: 'bossVuln', secs: 6, why: 'Armour shattered' });
          b.vuln = Math.max(b.vuln, 6);
        }
      }
      if (ph.core) dmg *= spell.elements.includes(ph.core.best) ? ph.core.best_mult : ph.core.other_mult;
      if (b.barrier) dmg *= 0.03;
      if (b.vuln > 0) dmg *= 1.6;
      if (ph.absorbs) {
        b.absorbHist.push(el);
        if (b.absorbHist.length > 6) b.absorbHist.shift();
        const same = b.absorbHist.filter((x) => x === el).length;
        if (same >= 3) {
          dmg *= 0.1;
          this.events.push({ t: 'absorb', el });
        }
      }
      if (ph.finisher) {
        const aetherNova = spell.id === 'aether_nova';
        if (!aetherNova) dmg = Math.min(dmg * 0.08, Math.max(0, b.hp - 1)); // only the Nova can finish him
        else dmg = b.hp + 1; // the finishing spell
      }
      dmg *= this.assist;
    }
    // never kill from a non-final phase in one hit: clamp to the phase threshold
    const nextBelow = b.def.phases[b.phase + 1]?.below;
    if (nextBelow !== undefined && !ph.finisher) {
      const floor = b.maxHp * nextBelow - 1;
      if (b.hp - dmg < floor && b.hp > floor) dmg = Math.max(0, b.hp - floor);
    }
    b.hp -= dmg;
    this.stats.hits++;
    this.stats.damageDealt += dmg;
    this.events.push({ t: 'hit', pos: at, element: el, dmg, target: 'boss' });
    if (b.hp <= 0) this.killBoss();
  }
  private killBoss(): void {
    const b = this.boss as Boss;
    b.hp = 0;
    b.dead = true;
    b.deathT = 0;
    this.eProj.length = 0;
    this.rings.length = 0;
    for (const e of this.enemies) if (e.state !== 'die') this.kill(e);
    this.events.push({ t: 'bossDie' });
  }
  private applyAreaBurst(a: Area): void {
    const sp = a.spell;
    const hit = (c: V3, r: number, fn: () => void): void => {
      if (dist([c[0], 0, c[2]], [a.pos[0], 0, a.pos[2]]) <= a.radius + r) fn();
    };
    for (const e of this.enemies) {
      if (e.state === 'die') continue;
      hit(this.center(e), this.radiusOf(e), () => this.damageEnemy(e, sp, a.power, sp.damage * a.power, this.center(e), true));
    }
    if (this.boss && !this.boss.dead) hit(this.bossCenter(), this.bossRadius(), () => this.damageBoss(sp, a.power, sp.damage * a.power, this.bossCenter()));
    for (const p of this.pylons) hit([p.pos[0], 1, p.pos[2]], 0.5, () => sp.elements.includes('lightning') && this.overloadPylon(p));
    // an explosion also destroys enemy projectiles in range
    for (const p of this.eProj) if (dist([p.pos[0], 0, p.pos[2]], [a.pos[0], 0, a.pos[2]]) < a.radius + 0.5) p.hp = 0;
  }

  // ------------------------------------------------------------------ update
  update(dt: number, head: V3 = PLAYER_HEAD): BEvent[] {
    this.events = [];
    if (this.over !== 'none') return this.events;
    this.time += dt;
    this.stats.time += dt;
    const pl = this.player;
    pl.hurtT = Math.max(0, pl.hurtT - dt);
    pl.shieldT += dt;
    if (!pl.shieldUp) {
      pl.regenT += dt;
      if (pl.regenT > 3) pl.shieldHp = Math.min(SHIELD_MAX, pl.shieldHp + 14 * dt);
    } else pl.regenT = 0;
    if (pl.shieldHp <= 0) pl.shieldUp = false;

    this.updatePlayerProj(dt);
    this.updateAreas(dt);
    this.updateEnemies(dt, head);
    if (this.boss) this.updateBoss(dt, head);
    this.updateEnemyProj(dt, head);
    this.updateRings(dt);
    for (const p of this.pylons) p.overload = Math.max(0, p.overload - dt);
    if (this.boss && this.boss.barrier === false && this.phaseDef()?.barrier && this.pylons.every((p) => p.overload <= 0) && this.boss.vuln <= 0) {
      this.boss.barrier = true;
      this.events.push({ t: 'barrier', on: true });
    }
    this.enemies = this.enemies.filter((e) => e.state !== 'die' || e.stateT > 0);
    this.updateModes(dt);
    if (pl.hp <= 0 && this.over === 'none') {
      this.over = 'lose';
      this.events.push({ t: 'lose' });
    }
    return this.events;
  }

  private updateModes(dt: number): void {
    if (this.mode === 'endless') {
      this.waveCd -= dt;
      if (this.alive().length === 0 && this.waveCd <= 0) {
        this.stats.wave++;
        this.events.push({ t: 'wave', n: this.stats.wave });
        this.spawnWave(this.stats.wave);
        this.waveCd = 3;
      } else if (this.alive().length > 0) this.waveCd = 3;
    }
    if (this.boss && this.boss.dead) {
      this.boss.deathT += dt;
      if (this.boss.deathT > 4.5 && this.over === 'none') {
        if (this.bossQueue.length) {
          this.spawnBoss(this.bossQueue.shift() as string);
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 40);
        } else {
          this.over = 'win';
          this.events.push({ t: 'win' });
        }
      }
    }
  }
  spawnWave(n: number): void {
    const pool = ['voidling', 'ember_beast', 'frost_wraith', 'storm_stalker', 'shadow_reaper', 'root_colossus', 'arcane_sentinel'];
    const count = Math.min(2 + Math.floor(n * 0.9), 9);
    for (let i = 0; i < count; i++) {
      const maxIdx = Math.min(pool.length, 1 + Math.floor(n / 2) + 1);
      const id = n % 5 === 0 && i === 0 ? 'root_colossus' : pool[Math.floor(this.rng.next() * maxIdx)];
      const a = (this.rng.next() - 0.5) * 2.2;
      const r = 5 + this.rng.next() * 3;
      this.spawnEnemy(ENEMIES[id], [Math.sin(a) * r, 0, -Math.cos(a) * r]);
    }
  }

  private updatePlayerProj(dt: number): void {
    for (const p of this.pProj) {
      p.life -= dt;
      // gentle homing (assist) toward the nearest target
      if (p.homing > 0) {
        let best: V3 | null = null;
        let bd = 1e9;
        for (const e of this.enemies) {
          if (e.state === 'die') continue;
          const c = this.center(e);
          const dd = dist(c, p.pos);
          if (dd < bd && dot(norm(sub(c, p.pos)), norm(p.vel)) > 0.8) {
            bd = dd;
            best = c;
          }
        }
        if (this.boss && !this.boss.dead) {
          const c = this.bossCenter();
          const dd = dist(c, p.pos);
          if (dd < bd && dot(norm(sub(c, p.pos)), norm(p.vel)) > 0.8) best = c;
        }
        if (best) {
          const sp = len(p.vel);
          const want = norm(sub(best, p.pos));
          const cur = norm(p.vel);
          const k = Math.min(1, p.homing * dt);
          p.vel = mul(norm(add(mul(cur, 1 - k), mul(want, k))), sp);
        }
      }
      // enemies dodge slow projectiles (dash and teleport kinds)
      for (const e of this.enemies) {
        if (e.state === 'die' || e.evadeCd > 0) continue;
        if ((e.def.behaviour === 'dash' || e.def.behaviour === 'teleport') && p.spell && p.spell.speed < 10 && dist(p.pos, this.center(e)) < 1.6 && e.def.id !== 'dummy') {
          e.evadeCd = 2.2;
          this.toState(e, 'evade', 0.35);
          const side = this.rng.next() < 0.5 ? -1 : 1;
          e.pos = [e.pos[0] + side * 1.3, e.pos[1], e.pos[2]];
        }
      }
      const np = add(p.pos, mul(p.vel, dt));
      // collisions along the step
      const step = sub(np, p.pos);
      const sl = len(step) || 1e-6;
      const dir = mul(step, 1 / sl);
      const r = this.raycast(p.pos, dir, sl, p.radius);
      const sp = p.spell as SpellDef;
      if (r.kind === 'enemy' && r.enemy) {
        this.impact(p, r.point);
        this.damageEnemy(r.enemy, sp, p.power, p.dmg, r.point, true);
        p.life = 0;
      } else if (r.kind === 'boss') {
        this.impact(p, r.point);
        this.damageBoss(sp, p.power, p.dmg, r.point);
        p.life = 0;
      } else if (r.kind === 'pylon' && r.pylon && sp.elements.includes('lightning')) {
        this.overloadPylon(r.pylon);
        p.life = 0;
      } else {
        // shoot down enemy projectiles
        for (const q of this.eProj) {
          if (q.hp > 0 && dist(np, q.pos) < p.radius + q.radius + 0.2) {
            const counter = q.kind === 'elementBurst' && sp.elements.includes(COUNTER[q.element]);
            q.hp = 0;
            this.events.push({ t: 'hit', pos: q.pos, element: sp.elements[0], dmg: 0, target: 'proj' });
            if (counter && this.boss) {
              this.boss.vuln = Math.max(this.boss.vuln, 3.5);
              this.events.push({ t: 'bossVuln', secs: 3.5, why: 'Countered' });
            }
            p.life = 0;
            break;
          }
        }
      }
      if (np[1] < 0.05 && p.life > 0) {
        // ground impact: void spells and fire still detonate on the floor
        if (sp.kind === 'void') this.impact(p, [np[0], 0, np[2]]);
        p.life = sp.kind === 'void' ? 0 : p.life;
        np[1] = 0.05;
      }
      p.pos = np;
      if (p.life <= 0 && sp.kind === 'void') {
        const a: Area = { id: this.nextId++, pos: [p.pos[0], 0, p.pos[2]], radius: sp.radius, age: 0, dur: 1.4, spell: sp, power: p.power, tick: 0, kind: 'void', pulled: false };
        this.areas.push(a);
        this.events.push({ t: 'area', area: a });
      }
      if (p.life <= 0 && sp.kind === 'projectile' && sp.radius > 0.5 && !p.fromBoss) {
        // fire orbs splash a little where they end
      }
    }
    this.pProj = this.pProj.filter((p) => p.life > 0);
  }
  private impact(p: Proj, at: V3): void {
    const sp = p.spell as SpellDef;
    if (sp.kind === 'projectile' && sp.radius >= 0.5) {
      // splash on nearby enemies
      for (const e of this.enemies) {
        if (e.state === 'die') continue;
        if (dist(this.center(e), at) < 1.3) this.damageEnemy(e, sp, p.power * 0.5, p.dmg * 0.5, this.center(e), false);
      }
    }
  }

  private updateAreas(dt: number): void {
    for (const a of this.areas) {
      a.age += dt;
      a.tick += dt;
      const sp = a.spell;
      if (a.kind === 'void' && !a.pulled) {
        // pull everything toward the centre, then collapse
        for (const e of this.enemies) {
          if (e.state === 'die' || e.def.id === 'dummy') continue;
          const d = dist([e.pos[0], 0, e.pos[2]], [a.pos[0], 0, a.pos[2]]);
          if (d < a.radius * 1.6) {
            const toC = norm([a.pos[0] - e.pos[0], 0, a.pos[2] - e.pos[2]]);
            const k = Math.min(d, 4.5 * dt);
            e.pos = [e.pos[0] + toC[0] * k, e.pos[1], e.pos[2] + toC[2] * k];
            if (!(e.status.pull && e.status.pull > 0)) e.status.pull = 0.4;
          }
        }
        if (a.age > 1.1) {
          a.pulled = true;
          this.applyAreaBurst(a);
        }
      } else if (a.kind === 'cloud' || a.kind === 'vines') {
        if (a.tick > 0.5) {
          a.tick = 0;
          for (const e of this.enemies) {
            if (e.state === 'die') continue;
            const c = this.center(e);
            if (dist([c[0], 0, c[2]], [a.pos[0], 0, a.pos[2]]) <= a.radius + this.radiusOf(e)) this.damageEnemy(e, sp, a.power * 0.6, sp.damage * a.power * 0.5, c, false);
          }
          if (this.boss && !this.boss.dead) {
            const c = this.bossCenter();
            if (dist([c[0], 0, c[2]], [a.pos[0], 0, a.pos[2]]) <= a.radius + this.bossRadius()) this.damageBoss(sp, a.power * 0.6, sp.damage * a.power * 0.5, c);
          }
          if (sp.chain) for (const p of this.pylons) if (dist([p.pos[0], 0, p.pos[2]], [a.pos[0], 0, a.pos[2]]) < a.radius + 1) this.overloadPylon(p);
        }
      }
    }
    this.areas = this.areas.filter((a) => a.age < a.dur);
  }

  private toState(e: Enemy, s: EState, t: number): void {
    e.state = s;
    e.stateT = t;
    if (s === 'stagger') e.telegraph = 0;
  }

  private updateEnemies(dt: number, head: V3): void {
    const pl = this.player;
    for (const e of this.enemies) {
      e.evadeCd = Math.max(0, e.evadeCd - dt);
      e.atkCd = Math.max(0, e.atkCd - dt);
      // status effects tick
      for (const k of Object.keys(e.status) as Status[]) {
        const left = (e.status[k] ?? 0) - dt;
        if (left <= 0) {
          delete e.status[k];
          this.events.push({ t: 'status', id: e.id, s: k, on: false, pos: this.center(e) });
        } else e.status[k] = left;
      }
      if (e.state === 'die') {
        e.stateT -= dt;
        continue;
      }
      if (e.def.id === 'dummy') continue;
      if ((e.status.burn ?? 0) > 0) {
        e.burnTick += dt;
        if (e.burnTick >= 0.5) {
          e.burnTick = 0;
          const d = 3 + e.maxHp * 0.025;
          e.hp -= d;
          this.stats.damageDealt += d;
          this.events.push({ t: 'hit', pos: this.center(e), element: 'fire', dmg: d, target: 'enemy' });
          if (e.hp <= 0) {
            this.kill(e);
            continue;
          }
        }
      }
      const frozen = (e.status.freeze ?? 0) > 0;
      const stunned = (e.status.stun ?? 0) > 0;
      if (frozen || stunned) {
        e.telegraph = 0;
        continue;
      }
      const rooted = (e.status.root ?? 0) > 0;
      const slow = (e.status.slow ?? 0) > 0 ? 0.4 : 1;
      e.stateT -= dt;
      const toP: V3 = [head[0] - e.pos[0], 0, head[2] - e.pos[2]];
      const d = len(toP);
      const dirP = norm(toP);
      switch (e.state) {
        case 'idle':
          if (e.stateT <= 0) this.toState(e, 'detect', 0.4);
          break;
        case 'detect':
          if (e.stateT <= 0) this.toState(e, 'approach', 99);
          break;
        case 'approach': {
          if (e.hp < e.maxHp * 0.2 && !e.retreated && e.def.behaviour !== 'heavy') {
            e.retreated = true;
            this.toState(e, 'retreat', 1.2);
            break;
          }
          if (e.def.behaviour === 'teleport') {
            e.blink -= dt;
            if (e.blink <= 0) {
              e.blink = 4 + this.rng.next() * 3;
              const a = (this.rng.next() - 0.5) * 2.4;
              const r = Math.max(e.def.range + 0.5, 3.2);
              const to: V3 = [Math.sin(a) * r, 0, -Math.cos(a) * r];
              this.events.push({ t: 'teleport', from: [...e.pos], to, who: 'enemy' });
              e.pos = to;
            }
          }
          if (d > e.def.range) {
            if (!rooted) {
              const sp = e.def.speed * slow;
              e.pos = [e.pos[0] + dirP[0] * sp * dt, e.pos[1], e.pos[2] + dirP[2] * sp * dt];
            }
          } else if (e.atkCd <= 0 || e.def.behaviour === 'ranged') {
            if (e.atkCd <= 0) {
              this.toState(e, 'attack', e.def.telegraph);
              e.telegraph = e.def.telegraph;
              this.events.push({ t: 'telegraph', who: 'enemy', kind: e.def.behaviour === 'ranged' || e.def.id === 'arcane_sentinel' ? 'shoot' : 'strike', dur: e.def.telegraph, pos: this.center(e), el: e.def.element });
            }
          }
          if (e.def.behaviour === 'dash' && d > e.def.range && d < 5 && !rooted) {
            const sp = e.def.speed * 1.6 * slow;
            e.pos = [e.pos[0] + dirP[0] * sp * dt, e.pos[1], e.pos[2] + dirP[2] * sp * dt];
          }
          break;
        }
        case 'attack': {
          e.telegraph = Math.max(0, e.telegraph - dt);
          if (e.stateT <= 0) {
            const blind = (e.status.blind ?? 0) > 0 && this.rng.next() < 0.6;
            if (!blind) {
              if (e.def.projSpeed > 0) {
                const from = this.center(e);
                const dir = norm(sub(head, from));
                const p: Proj = { id: this.nextId++, owner: 'enemy', spell: null, power: 1, pos: from, vel: mul(dir, e.def.projSpeed), life: 6, radius: 0.28, kind: e.def.id === 'frost_wraith' ? 'ice' : 'shadowOrb', element: e.def.element, dmg: e.def.dmg, hp: 8, homing: 0, reflectable: true, parry: false, fromBoss: false };
                this.eProj.push(p);
                this.events.push({ t: 'enemyProj', proj: p });
              } else if (d <= e.def.range + 0.6) this.hurtPlayer(e.def.dmg, e.def.name, this.center(e));
            }
            e.atkCd = e.def.cooldown;
            this.toState(e, 'recover', 0.6);
          }
          break;
        }
        case 'stagger':
        case 'evade':
          if (e.stateT <= 0) this.toState(e, 'approach', 99);
          break;
        case 'recover':
          if (e.stateT <= 0) this.toState(e, 'approach', 99);
          break;
        case 'retreat': {
          if (!rooted) e.pos = [e.pos[0] - dirP[0] * e.def.speed * 1.3 * dt, e.pos[1], e.pos[2] - dirP[2] * e.def.speed * 1.3 * dt];
          if (e.stateT <= 0) this.toState(e, 'approach', 99);
          break;
        }
        default:
          break;
      }
      void pl;
    }
  }

  // ------------------------------------------------------------------ boss
  private updateBoss(dt: number, head: V3): void {
    const b = this.boss as Boss;
    if (b.dead) return;
    b.phaseT += dt;
    b.vuln = Math.max(0, b.vuln - dt);
    if (b.trans > 0) {
      b.trans -= dt;
      return;
    }
    // phase change by hp
    const next = b.def.phases[b.phase + 1];
    if (next && b.hp <= b.maxHp * next.below) this.applyPhase(b.phase + 1);
    const ph = b.def.phases[b.phase];
    // teleport (Vyra)
    if (ph.teleports) {
      b.teleT -= dt;
      if (b.teleT <= 0) {
        b.teleT = 5;
        const anchors: V3[] = [[-3.2, 1.8, ARENA_Z], [0, 2.4, ARENA_Z - 1], [3.2, 1.8, ARENA_Z], [0, 1.4, ARENA_Z + 1.5]];
        let k = Math.floor(this.rng.next() * anchors.length);
        if (k === b.anchor) k = (k + 1) % anchors.length;
        b.anchor = k;
        this.events.push({ t: 'teleport', from: [...b.pos], to: anchors[k], who: 'boss' });
        b.pos = [...anchors[k]];
      }
    }
    // minions
    if (ph.summon) {
      b.summonT -= dt;
      if (b.summonT <= 0) {
        b.summonT = ph.summon.every;
        const alive = this.enemies.filter((e) => e.state !== 'die').length;
        if (alive < 5) {
          for (let i = 0; i < ph.summon.count; i++) {
            const a = (this.rng.next() - 0.5) * 2;
            this.spawnEnemy(ENEMIES[ph.summon.kind], [Math.sin(a) * 6, 0, -Math.cos(a) * 6 - 1], true);
          }
          this.events.push({ t: 'telegraph', who: 'boss', kind: 'summon', dur: 1, pos: this.bossCenter() });
        }
      }
    }
    // attacks
    if (b.winding) {
      b.winding.t += dt;
      if (b.winding.t >= b.winding.dur) {
        this.resolveBossAttack(b.winding.kind, head, b.winding.el);
        b.winding = null;
        b.atkT = ph.interval * (this.mode === 'endless' ? 0.9 : 1);
      }
    } else {
      b.atkT -= dt;
      if (b.atkT <= 0 && this.player.hp > 0) {
        const kind = ph.attacks[b.atkIdx % ph.attacks.length];
        b.atkIdx++;
        const dur = ({ fireball: 1.3, shockwave: 1.9, summon: 1.2, bolt: 1.1, fan: 1.4, shadowOrb: 1.2, elementBurst: 1.7, rain: 1.6 } as Record<string, number>)[kind] ?? 1.2;
        const el = kind === 'elementBurst' ? this.rng.pick<Element>(['fire', 'ice', 'lightning', 'nature']) : undefined;
        b.winding = { kind, t: 0, dur, el };
        this.events.push({ t: 'telegraph', who: 'boss', kind, dur, pos: this.bossCenter(), el });
      }
    }
  }
  private mkEnemyProj(kind: string, el: Element, from: V3, to: V3, speed: number, dmg: number, hp: number, homing = 0, reflect = true): Proj {
    const dir = norm(sub(to, from));
    const p: Proj = { id: this.nextId++, owner: 'enemy', spell: null, power: 1, pos: [...from], vel: mul(dir, speed), life: 9, radius: 0.35, kind, element: el, dmg: dmg * this.enemyDmg, hp, homing, reflectable: reflect, parry: false, fromBoss: true };
    this.eProj.push(p);
    this.events.push({ t: 'enemyProj', proj: p });
    return p;
  }
  private resolveBossAttack(kind: string, head: V3, el?: Element): void {
    const b = this.boss as Boss;
    const from = this.bossCenter();
    switch (kind) {
      case 'fireball':
        this.mkEnemyProj('fireball', 'fire', from, head, 3.6, 16, 22);
        break;
      case 'shadowOrb':
        this.mkEnemyProj('shadowOrb', 'shadow', from, head, 2.6, 13, 14, 1.4, false);
        break;
      case 'bolt': {
        // instant strike on the player after the telegraph; a well-timed shield reflects it
        this.events.push({ t: 'bolt', pos: head, from });
        if (this.player.shieldUp && this.player.shieldT < 0.45) {
          this.events.push({ t: 'reflect', pos: [head[0], head[1], head[2] - 0.6] });
          this.damageBossRaw(46, 'lightning', 'Reflected');
        } else this.hurtPlayer(15 * this.enemyDmg, 'Lightning', head);
        break;
      }
      case 'fan':
        for (let i = -1; i <= 1; i++) this.mkEnemyProj('bolt', b.def.element, from, [head[0] + i * 0.9, head[1], head[2]], 9, 9, 6);
        break;
      case 'rain':
        for (let i = 0; i < 4; i++) {
          const p = this.mkEnemyProj('bolt', b.def.element, [head[0] + (this.rng.next() - 0.5) * 3, 6 + i * 0.8, head[2] - 2 - i * 0.5], [head[0], head[1], head[2]], 8, 8, 5);
          p.life = 6;
        }
        break;
      case 'shockwave': {
        const r: Ring = { id: this.nextId++, r: 0, speed: SHOCK_SPEED, dmg: 20 * this.enemyDmg, arrive: Math.abs(b.pos[2] - head[2]) / SHOCK_SPEED, hit: false };
        this.rings.push(r);
        this.events.push({ t: 'shockwave', ring: r });
        break;
      }
      case 'summon': {
        for (let i = 0; i < 2; i++) this.spawnEnemy(ENEMIES.ember_beast, [(i - 0.5) * 4, 0, ARENA_Z + 1], true);
        break;
      }
      case 'elementBurst': {
        const e = el ?? 'fire';
        this.mkEnemyProj('elementBurst', e, from, head, 5, 20, 24, 0, true);
        break;
      }
      default:
        break;
    }
  }
  private damageBossRaw(n: number, el: Element, why: string): void {
    const b = this.boss;
    if (!b || b.dead) return;
    b.hp -= n * this.assist;
    this.stats.damageDealt += n;
    this.events.push({ t: 'hit', pos: this.bossCenter(), element: el, dmg: n, target: 'boss' });
    this.events.push({ t: 'bossVuln', secs: 0, why });
    const nextBelow = b.def.phases[b.phase + 1]?.below;
    if (nextBelow !== undefined && b.hp < b.maxHp * nextBelow - 1) b.hp = b.maxHp * nextBelow - 1;
    if (b.hp <= 0) this.killBoss();
  }

  private updateEnemyProj(dt: number, head: V3): void {
    for (const p of this.eProj) {
      p.life -= dt;
      if (p.homing > 0) {
        const want = norm(sub(head, p.pos));
        const sp = len(p.vel);
        const k = Math.min(1, p.homing * dt);
        p.vel = mul(norm(add(mul(norm(p.vel), 1 - k), mul(want, k))), sp);
      }
      p.pos = add(p.pos, mul(p.vel, dt));
      if (p.hp <= 0) {
        p.life = 0;
        continue;
      }
      const toHead = sub(head, p.pos);
      if (len(toHead) < 0.45) {
        p.life = 0;
        const front = this.player.shieldUp;
        if (front) {
          this.player.shieldHp -= p.dmg * 1.5;
          this.events.push({ t: 'blocked', pos: p.pos });
          if (this.player.shieldT < 0.4 && p.reflectable && this.boss && !this.boss.dead) {
            this.events.push({ t: 'reflect', pos: p.pos });
            this.damageBossRaw(p.dmg * 2.2, p.element, 'Reflected');
          }
          if (this.player.shieldHp <= 0) {
            this.player.shieldHp = 0;
            this.player.shieldUp = false;
          }
        } else this.hurtPlayer(p.dmg, p.kind, p.pos);
      }
    }
    this.eProj = this.eProj.filter((p) => p.life > 0);
  }
  private updateRings(dt: number): void {
    for (const r of this.rings) {
      r.r += r.speed * dt;
      r.arrive -= dt;
      if (!r.hit && r.arrive <= 0) {
        r.hit = true;
        // broken by a stomp within the window, otherwise blocked or hurts
        if (this.time - this.downAt < 0.6 && this.time - this.downAt > -0.1) {
          this.events.push({ t: 'stomp' });
          if (this.boss) this.damageBossRaw(18, 'fire', 'Stomped');
        } else if (this.player.shieldUp) {
          this.player.shieldHp -= r.dmg;
          this.events.push({ t: 'blocked', pos: [0, 0.2, -0.8] });
          if (this.player.shieldHp <= 0) {
            this.player.shieldHp = 0;
            this.player.shieldUp = false;
          }
        } else this.hurtPlayer(r.dmg, 'Shockwave', [0, 0.2, -0.8]);
      }
    }
    this.rings = this.rings.filter((r) => r.arrive > -1);
  }
  hurtPlayer(dmg: number, src: string, pos: V3): void {
    const pl = this.player;
    if (this.mode === 'training' || this.mode === 'sandbox') return;
    const d = dmg * (pos ? 1 : 1);
    if (pl.shieldUp && src !== 'Shockwave') {
      pl.shieldHp -= d;
      this.events.push({ t: 'blocked', pos });
      if (pl.shieldHp <= 0) {
        pl.shieldHp = 0;
        pl.shieldUp = false;
      }
      return;
    }
    pl.hp = Math.max(0, pl.hp - d);
    pl.hurtT = 0.8;
    this.stats.damageTaken += d;
    this.events.push({ t: 'playerHurt', dmg: d, src });
  }
  /** rushing the sandbox: reset everything */
  restoreAll(): void {
    this.player.hp = this.player.maxHp;
    this.player.shieldHp = SHIELD_MAX;
  }
}
export const SHIELD_HP = SHIELD_MAX;
