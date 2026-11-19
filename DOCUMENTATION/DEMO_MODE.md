# Autoplay demo mode (dev only)

Purpose: record a clean two-hand walkthrough on a laptop without driving the IWER emulator by hand.

```
npm run dev:runtime          # or: npm run dev
open https://localhost:8081/?demo=all      (also ?demo=menu | gear | race | aura | spell)
```

The page enters the emulated XR session by itself, switches IWER to hand input and animates both hands
(eased motion, real pinch values). Start the recorder (Win+Alt+R) before opening the URL. A full run is about
3 minutes on a normal laptop; the exact length depends on how fast the machine renders. `?demo=gear&gl=0,3`
picks the GearShift levels.

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
| Aura Weaver | pinch a prism or mirror and sweep around it to the solution angle, all through the normal pinch code | `__auraSolve` only if a grab missed; level start is `__auraPlay` |
| Spellforge | palms facing, orb, spread, two-hand push through the real gesture engine | if no hit/cast registers within a second, the current spell is fired through `Battle.cast` from the hand position; the mode/run start and attunements are hooks |

## Verified vs not

Verified in the cloud sandbox (software-rendered Chromium, about 2 fps, emulated XR session): the session
starts, both hands follow the script, GearShift levels were solved by physically placed gears and a
hand-pulled lever, Aura levels were solved by hand-turned elements, Spellforge casts registered by gesture on
some runs and by the assist on others. Not verified: visual quality, frame rate, smoothness on the target laptop,
the racer shift timing (the sandbox is too slow for the race clock), Quest hardware. `VERIFIED` stays NO.
