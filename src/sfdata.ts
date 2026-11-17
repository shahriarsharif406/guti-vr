/**
 * SPELLFORGE data tables (pure TypeScript, no rendering): elements, spells, fusions, enemies, bosses.
 * These are the "ScriptableObject" equivalents of the web build: plain, typed, data-driven definitions
 * that the caster, battle simulation, UI and tests all read.
 */
export type Element = 'fire' | 'ice' | 'lightning' | 'aether' | 'nature' | 'shadow';
export const ELEMENTS: Element[] = ['fire', 'ice', 'lightning', 'aether', 'nature', 'shadow'];
export const ELEMENT_NAME: Record<Element, string> = { fire: 'Pyrogenesis', ice: 'Cryogenesis', lightning: 'Stormcall', aether: 'Aether', nature: 'Verdant', shadow: 'Umbra' };
export const ELEMENT_HEX: Record<Element, number> = { fire: 0xff7a1a, ice: 0x7fd8ff, lightning: 0xa9b8ff, aether: 0xd07cff, nature: 0x58e07a, shadow: 0x6a3aa8 };
export const ELEMENT_CSS: Record<Element, string> = { fire: '#ff9a40', ice: '#9fe4ff', lightning: '#c3ceff', aether: '#e09cff', nature: '#7dee98', shadow: '#a37be0' };
/** elemental counters used by Void King phase 5 and by the grimoire hints */
export const COUNTER: Record<Element, Element> = { fire: 'ice', ice: 'fire', lightning: 'nature', nature: 'lightning', aether: 'shadow', shadow: 'aether' };

export type Status = 'burn' | 'freeze' | 'stun' | 'root' | 'slow' | 'pull' | 'blind';
export type SpellKind = 'projectile' | 'spear' | 'arc' | 'beam' | 'vines' | 'void' | 'nova' | 'cloud';

export interface SpellDef {
  id: string;
  name: string;
  tier: 'base' | 'advanced' | 'fusion';
  elements: Element[];
  kind: SpellKind;
  /** damage at full power */
  damage: number;
  /** energy at full power */
  cost: number;
  cooldown: number;
  speed: number;
  /** hit radius (projectiles) or area radius (nova, cloud, void) in metres */
  radius: number;
  status?: { s: Status; dur: number; chance: number };
  /** extra targets a lightning arc may jump to */
  chain?: number;
  pierce?: boolean;
  difficulty: number;
  gesture: string;
  blurb: string;
}

const base = (o: Omit<SpellDef, 'tier'>): SpellDef => ({ tier: 'base', ...o });
const adv = (o: Omit<SpellDef, 'tier'>): SpellDef => ({ tier: 'advanced', ...o });
const fuse = (o: Omit<SpellDef, 'tier'>): SpellDef => ({ tier: 'fusion', ...o });

export const BASE_SPELLS: Record<Element, SpellDef> = {
  fire: base({ id: 'flame_orb', name: 'Flame Orb', elements: ['fire'], kind: 'projectile', damage: 34, cost: 22, cooldown: 0.6, speed: 7, radius: 0.55, status: { s: 'burn', dur: 4, chance: 0.9 }, difficulty: 2, gesture: 'Bring both palms together, spread to grow the fire, rotate to compress it, push forward.', blurb: 'A living sphere of fire. Burns what it touches and melts ice armour.' }),
  ice: base({ id: 'frost_spear', name: 'Frost Spear', elements: ['ice'], kind: 'spear', damage: 30, cost: 18, cooldown: 0.5, speed: 13, radius: 0.35, status: { s: 'freeze', dur: 2.2, chance: 0.6 }, pierce: false, difficulty: 3, gesture: 'Hold one palm forward. Pinch with the other hand and pull back to sharpen the spear, release to launch.', blurb: 'A fast shard of ice. Shatters armour and freezes enemies.' }),
  lightning: base({ id: 'thunder_arc', name: 'Thunder Arc', elements: ['lightning'], kind: 'arc', damage: 26, cost: 20, cooldown: 0.5, speed: 40, radius: 0.5, status: { s: 'stun', dur: 1.4, chance: 0.5 }, chain: 3, difficulty: 2, gesture: 'Spread both palms wide so the arc crackles between them, then thrust one hand at the target.', blurb: 'Instant branching lightning that jumps between enemies and overloads pylons.' }),
  aether: base({ id: 'aether_beam', name: 'Aether Beam', elements: ['aether'], kind: 'beam', damage: 16, cost: 28, cooldown: 0.4, speed: 60, radius: 0.28, difficulty: 3, gesture: 'Hold both open palms side by side pointing at the target. The beam follows your hands while you hold.', blurb: 'A sustained beam of raw arcane energy. Tears open exposed cores.' }),
  nature: base({ id: 'thorn_vine', name: 'Thorn Vine', elements: ['nature'], kind: 'vines', damage: 22, cost: 18, cooldown: 0.7, speed: 9, radius: 0.5, status: { s: 'root', dur: 3, chance: 0.9 }, difficulty: 2, gesture: 'Reach a palm toward the ground, draw a circle, vines burst toward the enemy.', blurb: 'Thorned vines grow along the ground and entangle enemies.' }),
  shadow: base({ id: 'void_grasp', name: 'Void Grasp', elements: ['shadow'], kind: 'void', damage: 24, cost: 24, cooldown: 0.8, speed: 8, radius: 1.5, status: { s: 'pull', dur: 1.2, chance: 1 }, difficulty: 4, gesture: 'Close one fist, pull the other hand back to build a dark sphere, open the fist to send it.', blurb: 'A dark sphere that collapses and drags nearby enemies into the centre.' }),
};

/** Overcharged versions: hold the full charge for about a second, then release. Unlocked by mastery. */
export const ADVANCED_SPELLS: Record<Element, SpellDef> = {
  fire: adv({ id: 'phoenix_burst', name: 'Phoenix Burst', elements: ['fire'], kind: 'nova', damage: 70, cost: 55, cooldown: 2.5, speed: 10, radius: 3.2, status: { s: 'burn', dur: 6, chance: 1 }, difficulty: 4, gesture: 'Hold the Flame Orb at full charge, then push.', blurb: 'A phoenix of fire sweeps the whole battlefield.' }),
  ice: adv({ id: 'glacial_prison', name: 'Glacial Prison', elements: ['ice'], kind: 'nova', damage: 38, cost: 50, cooldown: 2.5, speed: 10, radius: 2.6, status: { s: 'freeze', dur: 4.5, chance: 1 }, difficulty: 4, gesture: 'Hold the Frost Spear at full charge, then release.', blurb: 'A huge ice formation traps everything near the target.' }),
  lightning: adv({ id: 'tempest_nova', name: 'Tempest Nova', elements: ['lightning'], kind: 'nova', damage: 55, cost: 55, cooldown: 2.5, speed: 12, radius: 3.4, status: { s: 'stun', dur: 2.6, chance: 1 }, difficulty: 4, gesture: 'Hold the Thunder Arc at full charge, then thrust.', blurb: 'A circular discharge of electricity that stuns the whole field.' }),
  aether: adv({ id: 'aether_nova', name: 'Aether Nova', elements: ['aether'], kind: 'nova', damage: 90, cost: 65, cooldown: 3, speed: 9, radius: 2.8, difficulty: 5, gesture: 'Hold the Aether Beam at full charge, then clap your palms forward.', blurb: 'A controlled, expanding sphere of arcane power. Devastating to exposed cores.' }),
  nature: adv({ id: 'ancient_roots', name: 'Ancient Roots', elements: ['nature'], kind: 'nova', damage: 48, cost: 50, cooldown: 2.5, speed: 9, radius: 3, status: { s: 'root', dur: 5, chance: 1 }, difficulty: 4, gesture: 'Hold the Thorn Vine at full charge, then release.', blurb: 'A network of giant roots erupts from the ground and holds everything.' }),
  shadow: adv({ id: 'eclipse', name: 'Eclipse', elements: ['shadow'], kind: 'cloud', damage: 14, cost: 60, cooldown: 3, speed: 6, radius: 3.4, status: { s: 'slow', dur: 5, chance: 1 }, difficulty: 5, gesture: 'Hold the Void Grasp at full charge, then release.', blurb: 'A field of dark energy that slows and drains everything inside for several seconds.' }),
};

const F = (a: Element, b: Element, o: Omit<SpellDef, 'tier' | 'elements'>): SpellDef => fuse({ elements: [a, b], ...o });
/** every pair of the six elements is a fusion: 15 recipes, all data driven */
export const FUSIONS: SpellDef[] = [
  F('fire', 'ice', { id: 'steam_explosion', name: 'Steam Explosion', kind: 'nova', damage: 44, cost: 40, cooldown: 1.6, speed: 8, radius: 2.4, status: { s: 'blind', dur: 3, chance: 1 }, difficulty: 3, gesture: 'Fire in one hand, Ice in the other, palms together, push.', blurb: 'Scalding steam bursts outward and blinds enemies.' }),
  F('fire', 'lightning', { id: 'plasma_burst', name: 'Plasma Burst', kind: 'projectile', damage: 52, cost: 42, cooldown: 1.4, speed: 16, radius: 0.5, status: { s: 'stun', dur: 1.5, chance: 0.7 }, difficulty: 3, gesture: 'Fire and Lightning together, push.', blurb: 'A fast ball of white-hot plasma.' }),
  F('fire', 'aether', { id: 'inferno_tornado', name: 'Inferno Tornado', kind: 'cloud', damage: 18, cost: 45, cooldown: 2, speed: 5, radius: 2.4, status: { s: 'burn', dur: 5, chance: 1 }, difficulty: 3, gesture: 'Fire and Aether together, rotate your hands, push.', blurb: 'A spinning column of flame that burns everything inside.' }),
  F('fire', 'nature', { id: 'wildfire', name: 'Wildfire', kind: 'cloud', damage: 15, cost: 38, cooldown: 2, speed: 5, radius: 2.8, status: { s: 'burn', dur: 6, chance: 1 }, difficulty: 3, gesture: 'Fire and Nature together, push.', blurb: 'Burning growth spreads across the ground.' }),
  F('fire', 'shadow', { id: 'voidflame', name: 'Voidflame', kind: 'projectile', damage: 60, cost: 46, cooldown: 1.6, speed: 9, radius: 0.7, status: { s: 'burn', dur: 5, chance: 1 }, difficulty: 4, gesture: 'Fire and Shadow together, push.', blurb: 'Black fire that ignores resistances.' }),
  F('ice', 'lightning', { id: 'frozen_storm', name: 'Frozen Storm', kind: 'arc', damage: 34, cost: 40, cooldown: 1.4, speed: 40, radius: 0.6, status: { s: 'freeze', dur: 2.5, chance: 1 }, chain: 4, difficulty: 3, gesture: 'Ice and Lightning together, push.', blurb: 'Lightning that freezes every enemy it jumps to.' }),
  F('ice', 'aether', { id: 'prism_lance', name: 'Prism Lance', kind: 'spear', damage: 58, cost: 42, cooldown: 1.5, speed: 20, radius: 0.4, pierce: true, difficulty: 4, gesture: 'Ice and Aether together, push.', blurb: 'A crystal lance that pierces through everything in line.' }),
  F('ice', 'nature', { id: 'frozen_thorns', name: 'Frozen Thorn Prison', kind: 'vines', damage: 36, cost: 40, cooldown: 1.8, speed: 9, radius: 0.9, status: { s: 'freeze', dur: 3.5, chance: 1 }, difficulty: 3, gesture: 'Ice and Nature together, push.', blurb: 'Frozen thorns lock enemies in a cage.' }),
  F('ice', 'shadow', { id: 'black_ice', name: 'Black Ice', kind: 'cloud', damage: 12, cost: 38, cooldown: 2, speed: 5, radius: 2.8, status: { s: 'slow', dur: 6, chance: 1 }, difficulty: 3, gesture: 'Ice and Shadow together, push.', blurb: 'Treacherous black ice slows everything crossing it.' }),
  F('lightning', 'aether', { id: 'arcane_thunderstorm', name: 'Arcane Thunderstorm', kind: 'cloud', damage: 24, cost: 52, cooldown: 2.4, speed: 6, radius: 3, status: { s: 'stun', dur: 1.2, chance: 0.6 }, chain: 5, difficulty: 4, gesture: 'Lightning and Aether together, push.', blurb: 'A storm of arcane lightning above the target.' }),
  F('lightning', 'nature', { id: 'conductive_bloom', name: 'Conductive Bloom', kind: 'arc', damage: 30, cost: 36, cooldown: 1.2, speed: 40, radius: 0.8, status: { s: 'root', dur: 2.5, chance: 1 }, chain: 3, difficulty: 3, gesture: 'Lightning and Nature together, push.', blurb: 'Lightning rooted by vines. It cannot miss grounded foes.' }),
  F('lightning', 'shadow', { id: 'dark_current', name: 'Dark Current', kind: 'arc', damage: 40, cost: 40, cooldown: 1.3, speed: 40, radius: 0.6, status: { s: 'stun', dur: 2.2, chance: 1 }, chain: 3, difficulty: 3, gesture: 'Lightning and Shadow together, push.', blurb: 'Black lightning that stuns for longer.' }),
  F('aether', 'nature', { id: 'genesis_bloom', name: 'Genesis Bloom', kind: 'nova', damage: 20, cost: 45, cooldown: 2.5, speed: 6, radius: 2.4, difficulty: 3, gesture: 'Aether and Nature together, push. Heals you.', blurb: 'A burst of life that heals you and damages what it touches.' }),
  F('aether', 'shadow', { id: 'twilight_rift', name: 'Twilight Rift', kind: 'void', damage: 50, cost: 48, cooldown: 2, speed: 8, radius: 2, status: { s: 'pull', dur: 1.5, chance: 1 }, difficulty: 5, gesture: 'Aether and Shadow together, push.', blurb: 'A rift that drags enemies in, then detonates.' }),
  F('nature', 'shadow', { id: 'rot_garden', name: 'Rot Garden', kind: 'cloud', damage: 16, cost: 36, cooldown: 2, speed: 5, radius: 2.6, status: { s: 'root', dur: 5, chance: 1 }, difficulty: 3, gesture: 'Nature and Shadow together, push.', blurb: 'Decaying thorns that hold and slowly drain enemies.' }),
];

const key = (a: Element, b: Element): string => [a, b].sort().join('+');
const FUSION_MAP = new Map<string, SpellDef>(FUSIONS.map((f) => [key(f.elements[0], f.elements[1]), f]));
/** The spell resulting from two attuned elements. Same element = base spell, different = a fusion. */
export function resolveSpell(left: Element, right: Element, overcharged: boolean, unlocked: (e: Element) => boolean): SpellDef {
  if (left === right) return overcharged && unlocked(left) ? ADVANCED_SPELLS[left] : BASE_SPELLS[left];
  return FUSION_MAP.get(key(left, right)) ?? BASE_SPELLS[right];
}
export const ALL_SPELLS: SpellDef[] = [...ELEMENTS.map((e) => BASE_SPELLS[e]), ...ELEMENTS.map((e) => ADVANCED_SPELLS[e]), ...FUSIONS];

// ------------------------------------------------------------------ damage rules
export interface Targetable {
  resist: Partial<Record<Element, number>>; // multiplier on incoming damage, 1 = normal
  armor: number; // flat fraction of damage ignored while armour holds (0..1)
  armorHp: number; // armour pool, only shattered by the elements in `armorBreak`
  armorBreak: Element[];
}
/** damage after elemental multipliers; fusions use the best multiplier of their two elements */
export function damageAgainst(spell: SpellDef, power: number, t: Targetable): { dmg: number; armorDmg: number } {
  const p = Math.max(0.15, Math.min(1.25, power));
  const mult = Math.max(...spell.elements.map((e) => t.resist[e] ?? 1));
  const raw = spell.damage * p * mult;
  const breaks = spell.elements.some((e) => t.armorBreak.includes(e));
  if (t.armorHp > 0) {
    if (breaks) return { dmg: raw * (1 - t.armor * 0.35), armorDmg: raw * 1.4 };
    return { dmg: raw * (1 - t.armor), armorDmg: 0 };
  }
  return { dmg: raw, armorDmg: 0 };
}

// ------------------------------------------------------------------ enemies
export type Behaviour = 'melee' | 'ranged' | 'dash' | 'teleport' | 'guard' | 'heavy';
export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number; // m/s
  behaviour: Behaviour;
  resist: Partial<Record<Element, number>>;
  armor: number;
  armorHp: number;
  armorBreak: Element[];
  dmg: number;
  telegraph: number; // seconds of visible wind-up before an attack lands
  cooldown: number;
  range: number; // attack distance from the player
  projSpeed: number;
  element: Element;
  scale: number;
  hex: number;
  weak: string;
}
export const ENEMIES: Record<string, EnemyDef> = {
  voidling: { id: 'voidling', name: 'Voidling', hp: 45, speed: 1.1, behaviour: 'melee', resist: { shadow: 0.4, aether: 1.4 }, armor: 0, armorHp: 0, armorBreak: [], dmg: 10, telegraph: 0.9, cooldown: 2.2, range: 1.2, projSpeed: 0, element: 'shadow', scale: 0.7, hex: 0x3a1a5a, weak: 'Aether' },
  ember_beast: { id: 'ember_beast', name: 'Ember Beast', hp: 90, speed: 1.5, behaviour: 'melee', resist: { fire: 0.1, ice: 1.8, nature: 0.8 }, armor: 0, armorHp: 0, armorBreak: [], dmg: 14, telegraph: 0.8, cooldown: 2, range: 1.3, projSpeed: 0, element: 'fire', scale: 0.95, hex: 0xff5a1a, weak: 'Ice' },
  frost_wraith: { id: 'frost_wraith', name: 'Frost Wraith', hp: 55, speed: 0.8, behaviour: 'ranged', resist: { ice: 0.1, fire: 1.8, lightning: 1.2 }, armor: 0, armorHp: 0, armorBreak: [], dmg: 9, telegraph: 1.0, cooldown: 3, range: 4.5, projSpeed: 4.5, element: 'ice', scale: 0.85, hex: 0x8fd8ff, weak: 'Fire' },
  storm_stalker: { id: 'storm_stalker', name: 'Storm Stalker', hp: 60, speed: 2.6, behaviour: 'dash', resist: { lightning: 0.1, nature: 1.8 }, armor: 0, armorHp: 0, armorBreak: [], dmg: 12, telegraph: 0.7, cooldown: 2.4, range: 1.4, projSpeed: 0, element: 'lightning', scale: 0.8, hex: 0xb7c4ff, weak: 'Nature' },
  root_colossus: { id: 'root_colossus', name: 'Root Colossus', hp: 220, speed: 0.55, behaviour: 'heavy', resist: { nature: 0.2, fire: 1.8 }, armor: 0.7, armorHp: 120, armorBreak: ['fire'], dmg: 24, telegraph: 1.4, cooldown: 3.5, range: 1.6, projSpeed: 0, element: 'nature', scale: 1.5, hex: 0x3d7a3a, weak: 'Fire' },
  shadow_reaper: { id: 'shadow_reaper', name: 'Shadow Reaper', hp: 70, speed: 1.2, behaviour: 'teleport', resist: { shadow: 0.2, aether: 1.5, lightning: 1.3 }, armor: 0, armorHp: 0, armorBreak: [], dmg: 16, telegraph: 0.9, cooldown: 2.8, range: 1.3, projSpeed: 0, element: 'shadow', scale: 1.0, hex: 0x1d1030, weak: 'Aether' },
  arcane_sentinel: { id: 'arcane_sentinel', name: 'Arcane Sentinel', hp: 120, speed: 0.7, behaviour: 'guard', resist: { aether: 0.2, shadow: 1.6 }, armor: 0.8, armorHp: 80, armorBreak: ['lightning', 'shadow'], dmg: 11, telegraph: 1.1, cooldown: 3, range: 5, projSpeed: 6, element: 'aether', scale: 1.1, hex: 0xd07cff, weak: 'Shadow or Lightning' },
};
export const DUMMY: EnemyDef = { id: 'dummy', name: 'Training Dummy', hp: 400, speed: 0, behaviour: 'guard', resist: {}, armor: 0, armorHp: 0, armorBreak: [], dmg: 0, telegraph: 9, cooldown: 99, range: 0, projSpeed: 0, element: 'aether', scale: 1, hex: 0xb89a6a, weak: 'None' };

// ------------------------------------------------------------------ bosses
export type AttackKind = 'fireball' | 'shockwave' | 'summon' | 'bolt' | 'fan' | 'shadowOrb' | 'elementBurst' | 'rain';
export interface PhaseDef {
  name: string;
  /** phase starts when boss hp fraction is at or below this */
  below: number;
  attacks: AttackKind[];
  interval: number;
  summon?: { kind: string; count: number; every: number };
  /** armour shell that only the listed elements can break */
  armor?: { hp: number; breakBy: Element[] };
  /** core exposed: every spell except the listed element does reduced damage */
  core?: { best: Element; best_mult: number; other_mult: number };
  teleports?: boolean;
  /** boss is untouchable until all pylons/pillars are overloaded */
  barrier?: boolean;
  /** boss absorbs repeated use of one element */
  absorbs?: boolean;
  /** finale phase: only a full Aether Nova ends it */
  finisher?: boolean;
  note: string;
}
export interface BossDef {
  id: string;
  name: string;
  title: string;
  realm: string;
  hp: number;
  element: Element;
  scale: number;
  resist: Partial<Record<Element, number>>;
  hex: number;
  phases: PhaseDef[];
  intro: string;
}
export const BOSSES: Record<string, BossDef> = {
  ignar: {
    id: 'ignar', name: 'IGNAR', title: 'The Ashen Titan', realm: 'The Ember Forge', hp: 900, element: 'fire', scale: 3.4,
    resist: { fire: 0.15, ice: 1.2, nature: 0.7 }, hex: 0xff5a1a,
    intro: 'The forge wakes. Something enormous breathes in the dark.',
    phases: [
      { name: 'Fire Barrage', below: 1, attacks: ['fireball'], interval: 3.2, note: 'Block the fireballs with crossed arms, or strike them out of the air.' },
      { name: 'Ground Shockwaves', below: 0.78, attacks: ['shockwave', 'fireball'], interval: 3.6, note: 'Slam your hands down just before a shockwave arrives to break it.' },
      { name: 'Ember Pack', below: 0.58, attacks: ['fireball'], interval: 3.4, summon: { kind: 'ember_beast', count: 2, every: 9 }, armor: { hp: 260, breakBy: ['ice'] }, note: 'His armour only breaks to Ice. Deal with the beasts too.' },
      { name: 'Exposed Core', below: 0.36, attacks: ['fireball', 'shockwave'], interval: 3, core: { best: 'aether', best_mult: 2.6, other_mult: 0.5 }, note: 'The core burns bare. Aether tears it apart.' },
      { name: 'Final Collapse', below: 0.12, attacks: ['fireball'], interval: 2.6, core: { best: 'aether', best_mult: 2.6, other_mult: 0.7 }, note: 'He is breaking. Finish it.' },
    ],
  },
  vyra: {
    id: 'vyra', name: 'VYRA', title: 'The Storm Empress', realm: 'The Storm Citadel', hp: 800, element: 'lightning', scale: 2.4,
    resist: { lightning: 0.1, nature: 1.4, ice: 1.1 }, hex: 0xa9b8ff,
    intro: 'Thunder gathers into a shape. It looks at you.',
    phases: [
      { name: 'Lightning Strikes', below: 1, attacks: ['bolt'], interval: 2.8, note: 'Raise your shield just as a bolt lands to reflect it back.' },
      { name: 'Storm Step', below: 0.8, attacks: ['bolt', 'fan'], interval: 3, teleports: true, note: 'She blinks between the pylons. Track her.' },
      { name: 'Electric Barrier', below: 0.6, attacks: ['bolt'], interval: 3.2, barrier: true, note: 'Overload the three pylons with lightning to drop her barrier.' },
      { name: 'Tempest', below: 0.38, attacks: ['fan', 'bolt', 'rain'], interval: 2.4, teleports: true, note: 'Bolts from every direction. Shield and breathe.' },
      { name: 'Open Heart', below: 0.18, attacks: ['bolt'], interval: 3, core: { best: 'nature', best_mult: 2.4, other_mult: 1 }, note: 'She is exposed. Nature and combos hit hard.' },
    ],
  },
  voidking: {
    id: 'voidking', name: 'THE VOID KING', title: 'Ruler of the Broken Seals', realm: 'The Void Throne', hp: 1300, element: 'shadow', scale: 4,
    resist: { shadow: 0.1, aether: 1.2, fire: 1.0 }, hex: 0x7a3acb,
    intro: 'Seven seals lie broken. A crown of nothing turns toward you.',
    phases: [
      { name: 'Dimensional Awakening', below: 1, attacks: ['shadowOrb'], interval: 3.6, summon: { kind: 'voidling', count: 2, every: 10 }, note: 'The rift opens. Hold your ground.' },
      { name: 'Shadow Attacks', below: 0.84, attacks: ['shadowOrb', 'fan'], interval: 3, note: 'Dark orbs home in on you. Burn them with Fire or block them.' },
      { name: 'Arena Collapse', below: 0.68, attacks: ['shadowOrb', 'rain'], interval: 3, summon: { kind: 'shadow_reaper', count: 1, every: 12 }, note: 'Reapers stalk you while the arena rains darkness.' },
      { name: 'Magic Absorption', below: 0.5, attacks: ['shadowOrb'], interval: 3, absorbs: true, note: 'He absorbs the element you repeat. Mix your elements.' },
      { name: 'Elemental Counterattack', below: 0.3, attacks: ['elementBurst'], interval: 4, note: 'He throws an element at you. Answer with its opposite.' },
      { name: 'Final Aether', below: 0.12, attacks: ['shadowOrb', 'elementBurst'], interval: 3.2, finisher: true, note: 'Charge Aether in both hands to full and release the Aether Nova.' },
    ],
  },
};
export const BOSS_ORDER = ['ignar', 'vyra', 'voidking'];
export const REALMS = ['The First Awakening', 'The Ember Forge', 'The Frozen Cathedral', 'The Storm Citadel', 'The Verdant Realm', 'The Abyssal Rift', 'The Void Throne'];
