# Pocket Workshop

**Three hands-only experiences in one WebXR app. No controllers.**

## Inspiration
The best moments in VR are when your hands do something that feels real. We wanted three very different things you can do with nothing but your hands: solve, compose and cast.

## What it does
- **GearShift:** a steampunk blueprint bench of gear puzzles. Seat the right gears so the output wheel spins the way the goal says. A "Racer" button opens Neon Overdrive: shift at the green zone for score and grades.
- **Aura Weaver:** turn mirrors and prisms, mix cyan, magenta and gold light and wake dark monoliths until a forgotten sanctuary blooms. 15 puzzles: light optics plus thread weaving. Adaptive music, save and photo mode.
- **Spellforge: The Arcane Awakening:** cast fire, ice, lightning, aether, nature and shadow with distinct hand gestures. Attune your two hands to different elements and discover fusion spells nobody tells you about (15 of them). Face three bosses with multi-phase fights (Ignar, Vyra, the Void King), plus Endless Rift, Boss Rush, Trials, a Spell Library and a Bestiary.

## How we built it
IWSDK + TypeScript on WebXR. Spellforge has a gesture engine (hysteresis, hold times, confidence, an armed-push guard) that works on synthetic hand poses, so it is unit-tested (64 tests) and also driven by a mouse stand-in on desktop. All visuals and audio are procedural.

## Challenges
Making hand gestures forgiving yet precise, and keeping effects light enough for a headset.

## Honest status
Verified in a desktop browser with automated tests. Not verified on a physical Quest headset; no frame-rate claim is made.

## What's next
Real-hand tuning on device, more realms and enemies.

## Credits
SFX: "Oculus Audio Pack 01" by Oculus VR, LLC (CC BY 4.0). 3D props: Free Apartment Props by Vuena (CC0).
