# Spellforge: The Arcane Awakening

A hands-only WebXR spell-casting arena inside Pocket Workshop. Cast six elements with your bare hands, combine any two into fusions nobody tells you about, and face three bosses.

Honest scope: this is a **WebXR build (IWSDK + Three.js)**, not a Unity/Quest APK. It was written to the Spellforge design brief but only part of that brief is implemented; the tables below say exactly which. Nothing here has been run on a Quest headset.

## How to play
| Element | Gesture (hand tracking) | Desktop stand-in |
|---|---|---|
| Fire: Flame Orb | Both palms facing, spread to grow, rotate to compress, push | Hold left mouse, release |
| Ice: Frost Spear | Palm forward, pinch with the other hand and pull back, release | same (attune with key 2) |
| Lightning: Thunder Arc | Palms wide so the arc crackles, thrust one hand | same (key 3) |
| Aether: Beam | Both palms forward side by side, hold (channelled) | hold (key 4) |
| Nature: Thorn Vine | Reach a palm to the floor, draw a circle | hold, release (key 5) |
| Shadow: Void Grasp | Close one fist, pull the other hand back, open the fist | hold, release (key 6) |
| Shield | Cross your wrists | Space or right mouse |
| Stomp (breaks shockwaves) | Slam hands down fast | F |
| Change element | Touch a sigil on the left/right rail (left rail = left hand) | keys 1-6 (Shift = right hand, Alt = left) |

- **Fusions:** attune your two hands to two different elements, make the orb, push. All 15 pairs are distinct spells and are hidden in the Spell Library until discovered.
- **Overcharge:** hold a full charge for about a second to release the advanced spell (unlocked after 5 casts of that element).

## What is implemented
- 6 elements, 6 base spells, 6 advanced spells, 15 fusions (27 spells), all data-driven.
- Gesture engine with hysteresis, minimum hold times, confidence gating, cooldowns, an "armed" guard so waving never fires a spell, tracking-loss recovery.
- 7 enemy types with distinct behaviours (melee, ranged, dash, teleport, guard, heavy), telegraphed attacks, elemental resistances, armour, status effects (burn, freeze, stun, root, slow, pull).
- 3 bosses with 5 / 5 / 6 data-driven phases: **Ignar** (fireballs, shockwaves you break with a stomp, armour that only breaks to Ice, exposed core), **Vyra** (bolts you can reflect, teleporting, a barrier held up by three pylons that lightning overloads), **Void King** (absorbs a repeated element, elemental counter-bursts, a final phase that only an Aether Nova ends).
- Modes: Journey (tutorial then the three bosses), Training, Sandbox (spawn any enemy), Endless Rift, Boss Rush, 4 Trials, plus a Spell Library and a Bestiary.
- Comfort and access: no camera motion, reduced-intensity mode (fewer particles and flashes), subtitles, aim assist, three difficulties, colour-blind letter cues, seated or standing, main-hand setting, separate master/music/effects volumes, mute.
- Versioned save (`pw-spellforge-v1`) with validation of corrupt data.
- Procedural audio: charge voice that follows spell size, per-element cast and impact sounds, boss roars, a discovery chord, adaptive combat and boss music.

## What is NOT in this build (from the brief)
- Unity, Quest APK, Meta XR SDK, OpenXR hand-pose package, Android build, Horizon Store packaging.
- The brief lists 7 realms; there are **3 themed arenas** (Ember Forge, Storm Citadel, Void Throne) plus a neutral sanctum used for training and endless.
- 13+ gestures: 11 are recognised (orb, spread, rotate, push, pinch-pull, circle, shield, hold, fist, up/down, stomp); some spells share a gesture.
- Voice, multiplayer, passthrough/MR arenas.

## What was verified
- `npm run test:spell`: 58 logic tests (gesture recognition on synthetic hand poses, spell casting, fusions, battle rules, boss phases, save data). Synthetic poses are not real hands.
- `node tests/spell-e2e.mjs`: desktop-browser run through the same gesture pipeline (software GL): menus, every element, shield, fusion discovery, all three boss phase sequences, endless, trials, sandbox, tutorial, no console errors.
- **Not verified:** real hand tracking on a headset (palm-normal sign for each hand, curl thresholds and the fingertip sigil touch are untested on hardware), frame rate on Quest. No performance figure is claimed.
