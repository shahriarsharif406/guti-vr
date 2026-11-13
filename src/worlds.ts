/** The four places a marble can be shot: shared by game, environment and sound. */
export type WorldId = 'earth' | 'moon' | 'mars' | 'station';

export interface WorldDef {
  id: WorldId;
  name: string;
  /** m/s^2, real values */
  gravity: number;
  /** marble air/rolling drag: lower means marbles travel farther */
  damping: number;
  /** one real fact, shown when the world is cleared */
  fact: string;
  intro: string;
  sunColor: number;
  sunIntensity: number;
  floorColor: number;
  tableColor: number;
  space: boolean;
}

export const WORLDS: Record<WorldId, WorldDef> = {
  earth: {
    id: 'earth',
    name: 'Village',
    gravity: 9.81,
    damping: 0.9,
    fact: 'Earth gravity: 9.81 m/s²',
    intro: 'Home: the village courtyard',
    sunColor: 0xffc288,
    sunIntensity: 2.2,
    floorColor: 0x6b4a33,
    tableColor: 0xb98a5e,
    space: false,
  },
  moon: {
    id: 'moon',
    name: 'Moon',
    gravity: 1.62,
    damping: 0.45,
    fact: 'Moon gravity = 1/6 of Earth',
    intro: 'The Moon: gravity 1.62, marbles slide far',
    sunColor: 0xffffff,
    sunIntensity: 2.8,
    floorColor: 0x8a8a92,
    tableColor: 0xa3a3ad,
    space: true,
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    gravity: 3.71,
    damping: 0.7,
    fact: 'Mars gravity = 38% of Earth',
    intro: 'Mars: gravity 3.71, dusty and light',
    sunColor: 0xffd0a0,
    sunIntensity: 2.1,
    floorColor: 0x9a4e2e,
    tableColor: 0xb8643b,
    space: true,
  },
  station: {
    id: 'station',
    name: 'Station',
    gravity: 0,
    damping: 0.55,
    fact: 'Orbit: weightless, always falling',
    intro: 'Space Station: zero gravity, no friction',
    sunColor: 0xe4ecff,
    sunIntensity: 2.6,
    floorColor: 0x39414d,
    tableColor: 0x8a93a1,
    space: true,
  },
};

/** Which world is on screen right now (read by the environment system). */
export const worldState: { id: WorldId } = { id: 'earth' };
