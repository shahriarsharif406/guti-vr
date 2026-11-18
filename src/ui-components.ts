import { createComponent, Types } from '@iwsdk/core';

export const MenuTargets = { Guti: 'guti', Kite: 'kite', Lattim: 'lattim', Danguli: 'danguli', Pottery: 'pottery', MarbleRun: 'marblerun', Dominoes: 'dominoes', Bricks: 'bricks', PaperPlane: 'paperplane', Gears: 'gears', Aura: 'aura', Spell: 'spell', Menu: 'menu' } as const;

/** A big pressable panel that switches the game mode. */
export const MenuButton = createComponent('MenuButton', {
  target: {
    type: Types.Enum,
    default: MenuTargets.Menu,
    enum: MenuTargets,
  },
});

/** A pressable tile on the level map. */
export const LevelTile = createComponent('LevelTile', {
  level: { type: Types.Int8, default: 1 },
});

/** A pressable option on the Kite Alive setup card (mode, place, time, kite design, fly). */
export const KiteOpt = createComponent('KiteOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option on the Danguli pitch (game mode, difficulty). */
export const DanOpt = createComponent('DanOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option on the Lattim table (mode, top design). */
export const LatOpt = createComponent('LatOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the pottery wheel (glaze, fire, new clay). */
export const PotOpt = createComponent('PotOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option in the kite workshop (fly, start over). */
export const CraftOpt = createComponent('CraftOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the marble-run board (release, reset, level). */
export const RunOpt = createComponent('RunOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the domino table (topple, again, clear). */
export const DomOpt = createComponent('DomOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the brick table. */
export const BrickOpt = createComponent('BrickOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the paper plane table. */
export const PlaneOpt = createComponent('PlaneOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the GearShift bench. */
export const GearOpt = createComponent('GearOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option at the Aura Weaver sanctuary (levels, settings, photo mode). */
export const AuraOpt = createComponent('AuraOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option in Spellforge (menu slots 0-9, sigils 20-35, in-play buttons 40+). */
export const SfOpt = createComponent('SfOpt', {
  id: { type: Types.Int8, default: 0 },
});

/** A pressable option in GearShift: Neon Overdrive (menu, results, bench entry). */
export const RaceOpt = createComponent('RaceOpt', {
  id: { type: Types.Int8, default: 0 },
});
