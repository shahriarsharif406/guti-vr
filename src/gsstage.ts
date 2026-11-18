/**
 * Which half of the GearShift station is on screen:
 * 'pick' = the mode picker, 'bench' = the gear-assembly puzzle, 'race' = GEAR SHIFT: NEON OVERDRIVE.
 * Tiny shared state so the bench (gearshift.ts) and the racer (race.ts) never draw at the same time.
 */
export type GsStage = 'pick' | 'bench' | 'race';
export const gsStage: { stage: GsStage } = { stage: 'bench' };

/** Neon palette shared by the racer's world, car, VFX and UI. */
export const NEON = {
  obsidian: 0x05060c,
  cyan: 0x22e6ff,
  magenta: 0xff2bd6,
  emerald: 0x19f58c,
  violet: 0x8a3bff,
  amber: 0xffb02e,
  red: 0xff2d4a,
};

/** The racer lives far below the workshop so nothing from the other stations is ever in view. */
export const RACE_Y = -400;
