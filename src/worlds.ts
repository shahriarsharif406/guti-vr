/** The four places a marble can be shot (ids kept; scenery is Bangladeshi): shared by game, environment and sound. */
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
    name: 'Harvest Field',
    gravity: 9.81,
    damping: 0.5,
    fact: 'Dry, dusty ground: marbles slide far',
    intro: 'The harvest field: dry ground, marbles slide far',
    sunColor: 0xffd29a,
    sunIntensity: 2.6,
    floorColor: 0xb59a5b,
    tableColor: 0xc9a56a,
    space: false,
  },
  mars: {
    id: 'mars',
    name: 'Monsoon',
    gravity: 9.81,
    damping: 1.5,
    fact: 'Wet monsoon mud: marbles stop quickly',
    intro: 'Monsoon: wet mud slows every marble',
    sunColor: 0xb9c8d6,
    sunIntensity: 1.5,
    floorColor: 0x4a3a2a,
    tableColor: 0x7a5a3e,
    space: false,
  },
  station: {
    id: 'station',
    name: 'Dhaka Rooftop',
    gravity: 9.81,
    damping: 0.3,
    fact: 'Smooth rooftop cement: very slippery',
    intro: 'Dhaka rooftop at dusk: slippery cement',
    sunColor: 0xff9c6a,
    sunIntensity: 2.0,
    floorColor: 0x8d8a84,
    tableColor: 0xa09a90,
    space: false,
  },
};

/** Which world is on screen right now (read by the environment system). */
export const worldState: { id: WorldId } = { id: 'earth' };
