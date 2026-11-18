# Spellforge QA test plan

## Automated (run on every change)
| Command | Covers | Status |
|---|---|---|
| `npx tsc --noEmit` | types | passing Nov 18 |
| `npm test` (`test:spell`: 64 tests) | gestures, casting, fusions, battle, bosses, save, music mix rules, tips, discovery nudge | passing Nov 18 |
| `npm run build` | production bundle | passing Nov 18 |
| `node tests/spell-e2e.mjs` (needs `npx vite preview --port 4175`) | screens, all elements, shield, fusion discovery, 3 boss fights, HRTF audio path, music layers, tips, endless, trials, sandbox, tutorial, no console errors | passing Nov 18 (35 checks) |

## Manual, needs a headset (NOT DONE)
1. Hand tracking: every sigil and gesture with both hands, left-handed setting, seated and standing.
2. Audio: close eyes, confirm an enemy wind-up is heard from the correct side and height; turn the head and confirm the sound stays in place.
3. Music: listen through a full boss fight; tempo and layers should rise per phase without clipping.
4. Onboarding: fresh save, play tutorial then first boss; each tip appears once and is readable.
5. Comfort: flashes with reduced effects on and off; 20-minute session.
6. Performance: Quest browser frame timing in the busiest boss phase.
