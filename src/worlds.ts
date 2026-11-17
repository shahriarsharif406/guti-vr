/** Places a marble can be shot: four Bangladeshi ones (ids moon/mars/station are legacy names) plus three optional Fantasy worlds. */
export type WorldId = 'earth' | 'moon' | 'mars' | 'station' | 'luna' | 'ares' | 'orbit';

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
    gravity: 1.62, // tuned physics values (not shown to the player)
    damping: 0.45,
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
    gravity: 3.71,
    damping: 0.7,
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
    gravity: 0,
    damping: 0.55,
    fact: 'Smooth rooftop cement: very slippery',
    intro: 'Dhaka rooftop at dusk: slippery cement',
    sunColor: 0xff9c6a,
    sunIntensity: 2.0,
    floorColor: 0x8d8a84,
    tableColor: 0xa09a90,
    space: false,
  },
  // ---- Fantasy (optional): real gravity values
  luna: {
    id: 'luna',
    name: 'Fantasy: Moon',
    gravity: 1.62,
    damping: 0.45,
    fact: 'Moon gravity: 1.62 m/s²',
    intro: 'Fantasy: the Moon. Low gravity, marbles bounce and glide',
    sunColor: 0xfff4e0,
    sunIntensity: 3.0,
    floorColor: 0x77767a,
    tableColor: 0x9a9aa0,
    space: true,
  },
  ares: {
    id: 'ares',
    name: 'Fantasy: Mars',
    gravity: 3.71,
    damping: 0.7,
    fact: 'Mars gravity: 3.71 m/s²',
    intro: 'Fantasy: Mars. Red dust, a third of Earth gravity',
    sunColor: 0xffc79a,
    sunIntensity: 2.2,
    floorColor: 0x8a4a2e,
    tableColor: 0xb06a48,
    space: true,
  },
  orbit: {
    id: 'orbit',
    name: 'Fantasy: Space Station',
    gravity: 0,
    damping: 0.55,
    fact: 'Zero gravity: nothing falls',
    intro: 'Fantasy: space station. Zero gravity, marbles never settle by themselves',
    sunColor: 0xe8f0ff,
    sunIntensity: 3.0,
    floorColor: 0x30343c,
    tableColor: 0x8d96a3,
    space: true,
  },
};

/** Which world is on screen right now (read by the environment system). */
export const worldState: { id: WorldId } = { id: 'earth' };
