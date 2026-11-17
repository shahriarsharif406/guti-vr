export type Mode = 'menu' | 'guti' | 'kite' | 'lattim' | 'danguli' | 'kitecraft' | 'marblerun' | 'paperplane' | 'gears' | 'aura' | 'spell';

/** Tiny shared state: which game screen is active. */
export const modeState: { mode: Mode } = { mode: 'menu' };

export function setMode(mode: Mode): void {
  modeState.mode = mode;
}
