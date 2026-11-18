export type Mode = 'menu' | 'guti' | 'kite' | 'lattim' | 'danguli' | 'kitecraft' | 'marblerun' | 'paperplane' | 'gears' | 'aura' | 'spell';

/** Tiny shared state: which game screen is active. */
export const modeState: { mode: Mode } = { mode: 'menu' };

export function setMode(mode: Mode): void {
  modeState.mode = mode;
}

/** Spellforge owns the whole scene while this is set: the workshop room is hidden. */
export const spellRoom: { hide: boolean } = { hide: false };

/** GearShift "Neon Overdrive" racer is running: the workshop music steps aside for its own synthwave score. */
export const raceRoom: { active: boolean } = { active: false };

/** Aura Weaver builds its own five worlds and plays its own adaptive score: the workshop room and music step aside. */
export const auraRoom: { hide: boolean; music: boolean } = { hide: false, music: false };
