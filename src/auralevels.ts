/**
 * Aura Weaver: the journey. Five worlds, fifteen puzzles. Each puzzle is a light board (mechanic D), a thread board
 * (A, B, C, E) or both on one loom. Every puzzle is checked by a solver in tests/aura.test.ts.
 * Pure data + factories: no rendering.
 */
import { CYAN, GOLD, MAGENTA, makeLevels, WHITE } from './auralogic.js';
import type { Level } from './auralogic.js';
import { node } from './threadlogic.js';
import type { Weave } from './threadlogic.js';

export type Mech = 'A' | 'B' | 'C' | 'D' | 'E';
export const MECH_NAME: Record<Mech, string> = { A: 'Thread weaving', B: 'Celestial geometry', C: 'Time weaving', D: 'Light refraction', E: 'Memory echoes' };

export interface World {
  name: string;
  short: string;
  /** one-line environmental story beat shown as an optional subtitle when the world opens */
  intro: string;
}
export const WORLDS: World[] = [
  { name: 'THE SILENT SANCTUARY', short: 'Sanctuary', intro: 'The threads were cut. The temple forgot how to breathe.' },
  { name: 'THE GARDEN OF LOST LIGHT', short: 'Garden', intro: 'Here light was grown like flowers. The roots still remember the colours.' },
  { name: 'THE CELESTIAL OBSERVATORY', short: 'Observatory', intro: 'The weavers once read the stars to know where every thread should go.' },
  { name: 'THE TIMELESS ARCHIVE', short: 'Archive', intro: 'Every thread ever woven is kept here. The past still answers.' },
  { name: 'THE HEART OF ETERNITY', short: 'Heart', intro: 'All threads lead home. The heart has been waiting for a weaver.' },
];

export interface Puzzle {
  id: string;
  name: string;
  world: number;
  mech: Mech[];
  goal: string;
  hint: string;
  /** memory fragment revealed (as an optional subtitle) when the puzzle is restored */
  story: string;
  light: Level | null;
  weave: Weave | null;
  /** generous time for the optional "swift" record (seconds); slow play is never punished */
  swift: number;
}

const blank = (w: number): Level => ({ name: '', chapter: WORLDS[w].name, goal: '', hint: '', sources: [], elems: [], targets: [] });
const lightOf = (levels: Level[], i: number, w: number): Level => ({ ...levels[i], chapter: WORLDS[w].name });

/** Fresh puzzle objects every call (angles and rings are mutable game state). */
export function makePuzzles(): Puzzle[] {
  const L = makeLevels();
  const P: Puzzle[] = [];
  // ============================================================ WORLD 1: THE SILENT SANCTUARY (teach A, then D)
  P.push({
    id: 'first-thread',
    name: 'The first thread',
    world: 0,
    mech: ['A'],
    goal: 'Pull a thread from the bright crystal to the sleeping one',
    hint: 'Pinch the glowing crystal, draw to the dark one, let go',
    story: 'A single thread. This is how every world begins.',
    light: null,
    weave: {
      nodes: [node('source', -0.26, -0.02, { mask: CYAN }), node('receiver', 0.26, 0.04, { mask: CYAN })],
      rings: [],
      walls: [],
      fixed: [],
      maxLen: 0.7,
      eras: 1,
      echoSlots: 0,
      sockets: [],
    },
    swift: 30,
  });
  P.push({
    id: 'splitter',
    name: 'Two hearts',
    world: 0,
    mech: ['A'],
    goal: 'Wake both sleeping crystals. A thread can only reach so far',
    hint: 'Go around the broken pillar. The twin crystal splits a thread in two',
    story: 'The temple had two hearts. When one went dark, the other could not bear it.',
    light: null,
    weave: {
      nodes: [
        node('source', -0.45, 0.0, { mask: CYAN }),
        node('relay', -0.2, 0.22),
        node('relay', -0.2, -0.22),
        node('splitter', 0.05, 0.0),
        node('receiver', 0.38, 0.2, { mask: CYAN }),
        node('receiver', 0.38, -0.2, { mask: CYAN }),
      ],
      rings: [],
      walls: [{ x1: -0.2, y1: -0.13, x2: -0.2, y2: 0.13, era: 0 }],
      fixed: [],
      maxLen: 0.4,
      eras: 1,
      echoSlots: 0,
      sockets: [],
    },
    swift: 60,
  });
  P.push({
    id: 'first-light',
    name: 'First light',
    world: 0,
    mech: ['D'],
    goal: L[0].goal,
    hint: L[0].hint,
    story: 'Light is only a thread you cannot hold.',
    light: lightOf(L, 0, 0),
    weave: null,
    swift: 30,
  });
  P.push({
    id: 'around-the-corner',
    name: 'Around the corner',
    world: 0,
    mech: ['D'],
    goal: L[1].goal,
    hint: L[1].hint,
    story: 'The sanctuary breathes again. Far away, something answers.',
    light: lightOf(L, 1, 0),
    weave: null,
    swift: 45,
  });
  // ============================================================ WORLD 2: THE GARDEN OF LOST LIGHT (D, then A + D)
  P.push({ id: 'split-dawn', name: 'Split the dawn', world: 1, mech: ['D'], goal: L[2].goal, hint: L[2].hint, story: 'White light is every colour, waiting.', light: lightOf(L, 2, 1), weave: null, swift: 45 });
  P.push({ id: 'violet', name: 'Violet gate', world: 1, mech: ['D'], goal: L[3].goal, hint: L[3].hint, story: 'Two colours meeting make a third. The garden was built on that.', light: lightOf(L, 3, 1), weave: null, swift: 60 });
  {
    const lv = blank(1);
    lv.sources = [{ x: -0.5, y: 0.24, ang: 0, mask: CYAN }];
    lv.elems = [{ kind: 'mirror', x: -0.33, y: 0.24, a: 0, rot: true, len: 0.075, mask: 0 }];
    lv.targets = [{ x: -0.33, y: -0.2, mask: CYAN, r: 0.05 }];
    P.push({
      id: 'root-light',
      name: 'Roots of light',
      world: 1,
      mech: ['D', 'A'],
      goal: 'Wake the root with light, then weave its energy to both blossoms',
      hint: 'The sealed flower opens only while the upper blossom is lit',
      story: 'The gardeners grew light from roots. When the light left, the roots slept too.',
      light: lv,
      weave: {
        nodes: [
          node('source', -0.18, -0.2, { mask: CYAN, light: 0 }),
          node('splitter', 0.02, 0.0),
          node('receiver', 0.3, 0.24, { mask: CYAN }),
          node('locked', 0.24, -0.16, { lockBy: 2 }),
          node('receiver', 0.46, -0.02, { mask: CYAN }),
        ],
        rings: [],
        walls: [],
        fixed: [],
        maxLen: 0.38,
        eras: 1,
        echoSlots: 0,
        sockets: [],
      },
      swift: 90,
    });
  }
  // ============================================================ WORLD 3: THE CELESTIAL OBSERVATORY (B, then A + B, then D)
  {
    const R = (r: number): number => r;
    P.push({
      id: 'orrery',
      name: 'The orrery',
      world: 2,
      mech: ['B'],
      goal: 'Turn the rings until every star rests in its constellation',
      hint: 'Each ring carries its own stars. Match them to the faint outline',
      story: 'The weavers drew their maps in the sky. This one points home.',
      light: null,
      weave: {
        nodes: [
          node('star', 0, 0, { ring: 0, phase: 0 }),
          node('star', 0, 0, { ring: 1, phase: 0 }),
          node('star', 0, 0, { ring: 2, phase: 0 }),
          node('star', 0, 0, { ring: 2, phase: (3 * Math.PI) / 4 }),
        ],
        rings: [
          { cx: 0, cy: 0, r: R(0.09), steps: 8, a: 0, motor: -1 },
          { cx: 0, cy: 0, r: R(0.18), steps: 8, a: 0, motor: -1 },
          { cx: 0, cy: 0, r: R(0.27), steps: 8, a: 0, motor: -1 },
        ],
        walls: [],
        fixed: [],
        maxLen: 0.3,
        eras: 1,
        echoSlots: 0,
        sockets: [
          { node: 0, x: 0.09 * Math.cos((3 * Math.PI) / 4), y: 0.09 * Math.sin((3 * Math.PI) / 4) },
          { node: 1, x: -0.18, y: 0 },
          { node: 2, x: 0, y: -0.27 },
          { node: 3, x: 0.27 * Math.cos(Math.PI / 4), y: 0.27 * Math.sin(Math.PI / 4) },
        ],
      },
      swift: 60,
    });
  }
  P.push({
    id: 'star-bridge',
    name: 'Star bridge',
    world: 2,
    mech: ['B', 'A'],
    goal: 'Wake the orbit engine, turn the ring, and bridge the void with stars',
    hint: 'Feed the orbit engine first, turn the ring, then free the thread and weave across the stars',
    story: 'They used the stars as stepping stones. Nothing was too far.',
    light: null,
    weave: {
      nodes: [
        node('source', -0.46, 0.02, { mask: GOLD }),
        node('rotator', -0.3, -0.22),
        node('star', 0, 0, { ring: 0, phase: Math.PI / 2 }),
        node('star', 0, 0, { ring: 0, phase: -Math.PI / 2 }),
        node('receiver', 0.46, 0.02, { mask: GOLD }),
        node('relay', 0, 0.02),
      ],
      rings: [{ cx: 0, cy: 0.02, r: 0.21, steps: 8, a: 0, motor: 1 }],
      walls: [],
      fixed: [],
      maxLen: 0.3,
      eras: 1,
      echoSlots: 0,
      sockets: [],
    },
    swift: 90,
  });
  P.push({ id: 'cathedral', name: 'Lost cathedral', world: 2, mech: ['D'], goal: L[4].goal, hint: L[4].hint, story: 'Even stone could not stop them. They stepped light around it.', light: lightOf(L, 4, 2), weave: null, swift: 90 });
  // ============================================================ WORLD 4: THE TIMELESS ARCHIVE (C, then E, then D)
  P.push({
    id: 'two-eras',
    name: 'Two eras',
    world: 3,
    mech: ['C', 'A'],
    goal: 'The wall fell long ago. Plant light in the past so it grows in the present',
    hint: 'Turn the hourglass. In the past the arch is open: feed the seed',
    story: 'Before the fall, the arch stood open. What we planted then still grows.',
    light: null,
    weave: {
      nodes: [
        node('source', -0.44, 0.02, { mask: MAGENTA }),
        node('relay', -0.14, 0.16),
        node('seed', 0.18, 0.16, { era: 1 }),
        node('bloom', 0.18, 0.16, { era: 2, seed: 2 }),
        node('receiver', 0.44, 0.0, { mask: MAGENTA, era: 2 }),
        node('receiver', -0.28, -0.22, { mask: MAGENTA, era: 2 }),
      ],
      rings: [],
      walls: [{ x1: 0.02, y1: -0.33, x2: 0.02, y2: 0.33, era: 2 }],
      fixed: [],
      maxLen: 0.36,
      eras: 2,
      echoSlots: 0,
      sockets: [],
    },
    swift: 120,
  });
  P.push({
    id: 'memory-echo',
    name: 'Memory echo',
    world: 3,
    mech: ['E', 'A'],
    goal: 'Two keystones must be held at once. Let your memory hold one',
    hint: 'Charge the memory crystal, tap it to record yourself holding a key, then hold the other',
    story: 'They could not be in two places at once. So they remembered themselves.',
    light: null,
    weave: {
      nodes: [
        node('source', -0.46, 0.16, { mask: CYAN }),
        node('key', -0.18, 0.16),
        node('key', 0.12, 0.16),
        node('receiver', 0.42, 0.16, { mask: CYAN }),
        node('source', -0.46, -0.2, { mask: CYAN }),
        node('memory', -0.16, -0.2, { mask: CYAN }),
      ],
      rings: [],
      walls: [],
      fixed: [
        { a: 0, b: 1, era: 2, fixed: true },
        { a: 1, b: 2, era: 2, fixed: true },
        { a: 2, b: 3, era: 2, fixed: true },
      ],
      maxLen: 0.36,
      eras: 1,
      echoSlots: 1,
      sockets: [],
    },
    swift: 120,
  });
  P.push({ id: 'resonance', name: 'Resonance', world: 3, mech: ['D'], goal: L[5].goal, hint: L[5].hint, story: 'The archive kept every colour that was ever woven.', light: lightOf(L, 5, 3), weave: null, swift: 120 });
  // ============================================================ WORLD 5: THE HEART OF ETERNITY (D, then everything)
  P.push({ id: 'eternal-bloom', name: 'Eternal bloom', world: 4, mech: ['D'], goal: L[6].goal, hint: L[6].hint, story: 'Three colours, one heart. The weavers were never gone. They were the threads.', light: lightOf(L, 6, 4), weave: null, swift: 150 });
  {
    const lv = blank(4);
    lv.sources = [{ x: -0.5, y: 0.25, ang: 0, mask: GOLD }];
    lv.elems = [{ kind: 'mirror', x: -0.38, y: 0.25, a: 0, rot: true, len: 0.07, mask: 0 }];
    lv.targets = [{ x: -0.38, y: -0.1, mask: GOLD, r: 0.045 }];
    P.push({
      id: 'heart',
      name: 'Heart of eternity',
      world: 4,
      mech: ['D', 'A', 'C', 'B', 'E'],
      goal: 'Light the root, plant the past, align the star and hold the heart open',
      hint: 'Light first. Then the past seed and the memory. Then the star. Then echo one key and hold the other',
      story: 'Every thread you wove was a memory returning. The universe remembers itself through you.',
      light: lv,
      weave: {
        nodes: [
          node('source', -0.22, -0.1, { mask: GOLD, light: 0 }), // 0 root fed by light
          node('seed', -0.04, -0.27, { era: 1 }), // 1
          node('bloom', -0.04, -0.27, { era: 2, seed: 1 }), // 2
          node('key', -0.04, 0.06), // 3
          node('star', 0, 0, { ring: 0, phase: 0 }), // 4
          node('receiver', 0.45, 0.25, { mask: GOLD, era: 2 }), // 5
          node('key', 0.18, -0.24), // 6
          node('receiver', 0.45, -0.22, { mask: GOLD, era: 2 }), // 7
          node('memory', -0.3, -0.3, { mask: GOLD }), // 8
        ],
        rings: [{ cx: 0.2, cy: 0.1, r: 0.13, steps: 8, a: 0, motor: -1 }],
        walls: [],
        fixed: [
          { a: 0, b: 3, era: 2, fixed: true },
          { a: 6, b: 7, era: 2, fixed: true },
        ],
        maxLen: 0.34,
        eras: 2,
        echoSlots: 1,
        sockets: [{ node: 4, x: 0.2, y: 0.23 }],
      },
      swift: 240,
    });
  }
  return P;
}

/** Old (v1) save indices -> new puzzle indices, so a returning player keeps the light puzzles they restored. */
export const V1_TO_V2 = [2, 3, 4, 5, 9, 12, 13];
export { CYAN, GOLD, MAGENTA, WHITE };
