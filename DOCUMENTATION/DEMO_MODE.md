# Autoplay demo mode (dev only)

Purpose: record a clean two-hand walkthrough on a laptop without driving the IWER emulator by hand.

```
npm run dev:runtime          # or: npm run dev
```

Three separately recordable segments, each about 55-60 s on a normal laptop (the budget is `&t=56` seconds):

| URL | What it shows |
|---|---|
| `https://localhost:8081/?demo=gear`  | GearShift: levels 0, 1, 3, 5, 7, 11 in turn while time remains (`&gl=0,3` picks levels) |
| `https://localhost:8081/?demo=aura`  | Aura Weaver: the four light puzzles (levels 2-5) while time remains |
| `https://localhost:8081/?demo=spell` | Spellforge: two creature fights, then the three bosses Ignar, Vyra and the Void King |

`?demo=all` plays the three back to back (about 3 minutes), `?demo=race` is the racer on its own.
A segment ends with `[demo] DONE <name> after Ns` in the console and `window.__demoDone = true`; the last frame is held for 2.5 s.
A segment only starts a new level or boss when there is time left for it, so it is cut by the budget, not mid-action.

The page enters the emulated XR session by itself, switches IWER to hand input and animates both hands
(eased motion, real pinch values). Start the recorder (Win+Alt+R) before opening the URL. The exact length depends on how fast the machine renders.

It lives in `src/demo.ts` and is imported only behind `import.meta.env.DEV`, so production builds (the GitHub Pages
site) contain none of it (checked: no demo strings in `dist/`).

## How the hands are driven

The emulator build used by the dev server has no hand pinning, so `demo.ts` sets `IWER_DEVICE.controlMode =
"programmatic"` (stops the emulator panels overriding the poses), moves `hand.position` and runs a small
closed loop on the point the games actually read (the thumb/index-tip midpoint), then pinches with
`updatePinchValue`. The games see these hands through the normal input path.

## What is real and what is assisted

Every assisted step is written to `window.__demoLog` (open the console to read it).

| Part | Real hand interaction | Hook-assisted |
|---|---|---|
| Menu | hands sweep and press the card (a ray/dwell press if it registers) | falls back to `__setMode` if the press did not register |
| GearShift | pick gears from the rack, place on the pegs, pull the ignition (and clutch) lever, all through the normal pinch code; the level is solved by the lever | `__gearSolve` / `__gearWin` only if a pick or pull missed |
| Racer | hands raised on a wheel, flick on each shift | the menu/start press and the gear shifts themselves are hook calls (`__raceStart`, `__raceShift`) |
| Aura Weaver | pinch a prism or mirror and sweep around it to the solution angle, all through the normal pinch code | `__auraSolve` only if a grab missed or the level ran past its 14 s hand budget; level start is `__auraPlay`. Level 6 is a thread puzzle, not a light puzzle, so it is skipped |
| Spellforge | palms facing, orb, spread, two-hand push through the real gesture engine | if no hit/cast registers within a second, the current spell is fired through `Battle.cast` from the hand position; the mode/run start and attunements are hooks. **Bosses:** two casts in the opening phase, then the boss health is moved to the last phase by hook and the final blow is a hook (`killBoss`), so that the late phases and the kill fit into the time. The Void King's finisher normally needs the Aether Nova; here the kill is assisted. |

## Hands

The demo draws its own hands from the emulator's joint data: tapered tube fingers with rounded joints, a thickened palm, a wrist and forearm stub, a translucent skin shader with rim light, tips that glow on pinch, and a short low-pass filter so the drawing never pops. Geometry and materials are built once and `update()` allocates nothing. The finger curl itself comes from the emulator's pose and pinch value, not from the drawing code.

## Robustness

Hand moves are short (about 0.2-0.6 s), every wait for the sensed pose is capped at 0.9-1.5 s, the hand part of a level is capped (20 s GearShift, 14 s Aura) and a missed pick or grab is completed by the hook. A lever that does not register is pulled once more before the win is triggered by hook. Everything assisted is in `window.__demoLog`.

## Verified vs not

Verified in the cloud sandbox (software-rendered Chromium, about 2 fps, emulated XR session): the session
starts, both hands follow the script, GearShift levels were solved by physically placed gears and a
hand-pulled lever, Aura levels were solved by hand-turned elements, Spellforge casts registered by gesture on
some runs and by the assist on others. Not verified: visual quality, frame rate, smoothness on the target laptop,
the racer shift timing (the sandbox is too slow for the race clock), Quest hardware. `VERIFIED` stays NO.

Segments (this round): all three segments ran to their `DONE` line in the sandbox with a shortened budget (`&t=40`). The sandbox is much slower than the target laptop, so a segment covered 1 level (Aura), 1 boss (Spellforge) and 1 level (GearShift, which was stopped before its end), not the 4 levels / 3 bosses that fit on a normal laptop; the later levels and bosses were not played end to end. Level and boss data were checked: Aura levels 2-5 are light puzzles with rotatable elements. The new hands were looked at in sandbox screenshots only.
