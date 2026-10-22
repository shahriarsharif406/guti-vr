export type Mode = 'menu' | 'guti' | 'kite';

/** Tiny shared state: which game screen is active. */
export const modeState: { mode: Mode } = { mode: 'menu' };

export function setMode(mode: Mode): void {
  modeState.mode = mode;
}
