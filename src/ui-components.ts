import { createComponent, Types } from '@iwsdk/core';

export const MenuTargets = { Guti: 'guti', Kite: 'kite', Menu: 'menu' } as const;

/** A big pressable panel that switches the game mode. */
export const MenuButton = createComponent('MenuButton', {
  target: {
    type: Types.Enum,
    default: MenuTargets.Menu,
    enum: MenuTargets,
  },
});
