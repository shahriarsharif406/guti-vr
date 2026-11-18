# Quality roadmap

Scale: 1 broken, 2 prototype, 3 functional, 4 good, 5 polished, 6 competition, 7 exceptional.
Scores are honest self-assessments from desktop software-rendered testing, not headset testing.

| Area | Now | Next step | Priority |
|---|---|---|---|
| Spellforge core loop (cast, fuse, fight, boss) | 4 | real-hand tuning (needs a Quest) | P0 when hardware exists |
| Spellforge art and VFX | 4 | the seven regular enemies are now layered creature models (src/sfcreatures.ts) with emissive eyes and cores, idle, wind-up and frozen states; boss silhouettes are still simple low-poly | P2 |
| Spellforge audio | 4 | procedural battle engine (src/sfaudio.ts): per-element cast and impact, enemy telegraph and hit, shield clang, boss roar, UI clicks, intensifying music bed, limiter and 40-voice cap. Replaces the quiet shared voices that were inaudible at arena distance. Not listened to on real speakers or a headset | P2 |
| GearShift puzzle design | 4 | grading added; more levels | P2 |
| GearShift audio | 3-4 | needs human listening pass | P1 |
| Aura Weaver | 4 | echoes / hint polish | P2 |
| Presentation (video, Devpost text) | 3 | user records video; scripts exist | P0 before deadline |
| Headset verification | 0 | none possible here | blocked |

Decisions: the prompts describe a Unity/APK build, a car-racing GearShift and a thread-weaving Aura game. These are different products from the working WebXR games. Replacing working games with new ones a day before the deadline is the larger risk, so the shared parts (audio, comfort, onboarding, feedback, records, honest documentation) are applied instead.
