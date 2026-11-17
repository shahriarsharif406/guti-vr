import { createComponent, Types } from '@iwsdk/core';

export const MenuTargets = { Guti: 'guti', Kite: 'kite', Lattim: 'lattim', Danguli: 'danguli', Menu: 'menu' } as const;

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
