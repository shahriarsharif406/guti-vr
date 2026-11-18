# GearShift: Neon Overdrive - status

Statuses are kept separate. VERIFIED (on a real Quest headset) is **NO** for everything.

| Area | IMPLEMENTED | TESTED | Notes |
| --- | --- | --- | --- |
| Gear-train assembly bench (12 levels, star grades) | yes | browser (desktop, software GL) | unchanged by the racer |
| Racer rules engine (RaceSim, 120 Hz fixed step) | yes | 39 node tests | shift windows, turbo, heat, stress, grades, records, daily challenge |
| Night-city world (city / tunnel / highway, rain) | yes | desktop screenshots | procedural shaders, instanced props |
| Procedural engine + synthwave score | yes | no listening test | WebAudio, compressor + limiter on the master bus |
| Menu, 5 race modes, car / track / difficulty / quality pickers | yes | e2e (hooks) | 6 race modes incl. VR Cockpit (button added; uses the same trigger shift, the physical lever is not wired) |
| Input: keyboard, mouse, gamepad | yes | keyboard path via hooks | Space / click = upshift, B = turbo, C = view, Esc = exit |
| Input: XR controller (trigger / grip / A) | yes | **no** | untested without a headset |
| HUD, results, coach tips, local records, ghost | yes | e2e (result + grade) | local only; no online leaderboard |
| Hypercar model | simple primitive model | screenshot | not a hero-quality asset |

Not done: physical lever shifting in VR, touch gestures, a recorded soundtrack, a measured frame rate on any device.
Run the check: `npm run build && npx vite preview --port 4175` then `node tests/gearshift-e2e.mjs`.
