# Feature status (Pocket Workshop: GearShift, Aura Weaver, Spellforge)

Three statuses are kept apart on purpose and are never interchangeable:
**I** = implemented in code, **T** = tested by a script or test run that was actually executed, **V** = verified on a real headset.
**V is empty everywhere: no Quest or other headset was available. No frame-rate number is claimed.**

Platform: WebXR (IWSDK + Three.js), run in a browser and in a headset browser. It is not a Unity project and ships no APK.

## Spellforge: The Arcane Awakening
| Area | I | T | V | Notes |
|---|---|---|---|---|
| Hand-pose gesture engine (hysteresis, hold times, confidence, cooldowns) | yes | logic tests (58) | no | palm-normal sign for left/right unverified on hardware |
| 6 elements, each with its own signature interaction | yes | e2e (desktop mouse stand-in) | no | |
| 15 fusions with discovery + library | yes | e2e (1 fusion) + logic | no | |
| 7 enemy types, status effects, shield/reflect/stomp | yes | logic + e2e | no | |
| 3 bosses (5/5/6 phases), distinct mechanics | yes | e2e phase sequence | no | |
| Modes: Journey, Training, Sandbox, Endless, Boss Rush, 4 Trials, Tutorial | yes | e2e | no | |
| Positional audio (stereo pan by enemy position for hits, deaths, wind-ups, casts) | yes | typecheck only | no | stereo pan, not full 3D HRTF |
| Boss/enemy telegraphs (text + sound) | yes | e2e | no | |
| Settings: subtitles, aim assist, colour-blind clue, reduced effects, left hand, seated, volumes | yes | partly | no | |
| Save / records | yes | logic tests | no | local only |
| Original adaptive music | yes (procedural) | no | no | procedural synth, not recorded music |
| 7 realms | no | - | - | 3 themed arenas built (Ember Forge, Frost, Void) |
| Environment reacting to spells (ignite/freeze surfaces) | no | - | - | not built |

## GearShift
| Area | I | T | V | Notes |
|---|---|---|---|---|
| 6 verified gear-train levels in 3 chapters, clutch + ignition levers | yes | logic solver + e2e | no | |
| Tooth-mesh audio, adaptive music, haptics | yes | no (cannot be heard here) | no | mix reworked Nov 18 after player feedback: limiter, soft pulse, original lever sound |
| Star grading (time, jams), personal best saved | yes | typecheck | no | added Nov 18 |
| Finale: holographic orrery | yes | screenshot | no | |
| Racer "Neon Overdrive" (6 modes, HUD, results, records, ghost, procedural engine + music) | yes | 39 logic tests + desktop e2e (auto-driver) | no | see GEARSHIFT_STATUS.md; primitive car model, XR controller input untested |

## Aura Weaver
| Area | I | T | V | Notes |
|---|---|---|---|---|
| 7 solver-verified light-optics levels, 5 chapters feel | yes | 28 logic tests + e2e | no | |
| Title/continue/chapter select, 12 settings, tutorial hints, save, photo mode | yes | e2e | no | |
| Adaptive audio buses, mute, sanctuary awakening finale | yes | partly | no | |
| Prompt's thread-weaving, time weaving, memory echoes, 5 worlds | no | - | - | different design; not built |
