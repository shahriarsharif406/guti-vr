# Aura Weaver - status

Statuses are kept separate. VERIFIED means checked on a real Quest headset; it is **NO** for everything.
"e2e" = `tests/aura-e2e.mjs` (Playwright, desktop Chromium, software GL at about 1 fps, fixed-step hooks).
"unit" = `npm run test:aura` (81 node tests).

| Area | IMPLEMENTED | TESTED | VERIFIED |
| --- | --- | --- | --- |
| 15-puzzle journey over 5 worlds (light, thread and combined puzzles) in the game loop | yes | e2e: all 15 solved and saved; unit: every puzzle solvable | NO |
| Entry from title (START / CONTINUE) and from the CHAPTERS level menu (5 worlds) | yes | e2e: chapter 1 opens the first thread puzzle | NO |
| Thread board renderer (`src/threadview.ts`): nodes per kind, powered / dormant threads, stretched drag thread with tension colour, walls, rings, sockets, echo ghosts, era tint, hint guide | yes | one desktop screenshot; e2e: no geometry/texture growth over 30 loads | NO |
| Thread controller (`src/threadplay.ts`): grab, pull, connect, refuse, cut, re-route, rings, eras, keys, echoes, hints | yes | unit (grab/connect/cut/reset/rings/echo/hint-solve) | NO |
| Mouse input on the loom (pointer events on a RayInteractable plane) | yes | e2e: real mouse drag weaves, tap cuts, empty drop refused | NO |
| XR controller ray / hand pointer input on the loom (same RayInteractable plane) | yes | **no** (no XR session was run) | NO |
| Hand pinch / grip direct input for mirrors and prisms (existing light path) | yes (unchanged) | no | NO |
| ERA and HINT buttons (also keys E and H), tutorial and refuse messages | yes | e2e: ERA switches era, HINT gives a step | NO |
| Audio feedback via existing helpers (grab, tension-pitched tick, cut, impure, chime, awaken, pulse, whoosh, panned with withPan; thread energy feeds the beam hum) | yes | events reach the handler (e2e stats); **no listening test** | NO |
| Save v2: 15 slots, best moves / time / hints / swift, stats; v1 migration; interim 7-slot v2 records re-indexed | yes | unit (incl. new interim-layout test); e2e: progress survives reload | NO |
| Pause / photo mode / leaving the mode cancel drags; hidden menu panels no longer swallow rays | yes | e2e: loom stops taking rays while paused | NO |
| Finale after the last puzzle | yes | e2e | NO |
| Frame-time budget (72-90 Hz) | not measured | **no FPS numbers exist** | NO |

Known limits:
- Per-frame code of the thread board does not allocate in steady state; it allocates on events (re-evaluation, hints,
  HUD redraw) and while an echo is being recorded (up to 30 samples/s for at most 6 s).
- The pre-existing light-board code still allocates small arrays per frame (`filter` in gates/audio); not changed here.
- Colour-independent letter labels are not drawn on thread crystals yet (only on light gates).
- Hidden discoveries (12 slots in the save) are not awarded by any puzzle yet.

Run the checks: `npx tsc --noEmit`, `npm test`, then `npm run build && npx vite preview --port 4175` and
`node tests/aura-e2e.mjs`.

## Nov 18 update: bigger loom and clearer menus
- IMPLEMENTED: the whole loom (board, elements, threads) is drawn 1.2x larger (root scale; puzzle coordinates and solver unchanged, so all 15 puzzles still fit). Mouse/ray/hand input is mapped through the scale.
- IMPLEMENTED: new glass-style panels for the title, chapter list, in-game HUD (bigger text), progress compass and completion card; new pill buttons with an icon badge and accent colour for the game row, ERA/HINT, chapter select and the 12 settings.
- TESTED: tsc clean; npm test passes (4 suites); browser e2e (desktop Chromium, software GL) passes all checks incl. 15 puzzles; a mouse drag of a mirror on the enlarged board changed its angle; screenshots of title, chapters, a thread puzzle, a light puzzle and the pause menu were looked at.
- NOT VERIFIED: any headset, XR ray/hand input on the scaled board, frame rate, legibility at real headset distance. Some icon glyphs (e.g. lightning, gear) depend on the system font.

## Round 2 (audio, board, ledge art)
- IMPLEMENTED: new `src/auraaudio.ts`: original procedural score (lydian pad, harp-like plucks fanning out from the centre to the edges, bell accents, dotted echo, long reverb) and event sounds (mirror tick tied to angle, gate-awaken chime cascade, solved swell, finale, grab, thread snip, whoosh, UI click, beam hum voices). Routed through the shared master compressor/limiter; voice cap 48. Aura sets `auraRoom.music` while open, so the workshop music steps aside (Aura music is the only music); on leaving Aura the music bus fades to 0 and Aura sounds are gated.
- Why it was silent: Aura only used the small shared effects (gain ~0.05) with the quiet workshop pad; no dedicated score existed and nothing was audible in practice. This is a diagnosis from the code and a headless run, not from listening.
- IMPLEMENTED: loom scale 1.2 to 1.3 (board bigger, HUD pulled closer so it stays on screen in a 1100x650 desktop view); compass moved inward.
- IMPLEMENTED: ledge redesign: gold trim rails, glow strip, smooth glass lanterns on gold bases instead of spiky cones, rounded lotus petals. Lotuses still bloom per solved puzzle and the lanterns still light with progress.
- TESTED: tsc clean for Aura files; npm test (81/64/39/48 pass); Aura browser e2e 35 checks pass (desktop, software GL).
- TESTED (partly): headless run shows the AudioContext running, non-zero output, peak below 0 dBFS (sparse sampling at about 1 fps, so the true peak is not measured), music bus 0 after leaving Aura.
- NOT VERIFIED: how it sounds (nobody listened), loudness balance, headset behaviour, FPS, the new look at real headset distance.
