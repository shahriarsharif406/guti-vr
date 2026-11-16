# Devpost submission texts (final, matches the real game)

**Project name:** Guti
**Elevator pitch (<=140 chars):** Guti: a Bangladeshi village marble game that travels to the Moon, Mars and a space station. Hands only, seated, no controllers.
**Playable link (Try it out):** https://shahriarsharif406.github.io/guti-vr/
**GitHub:** https://github.com/shahriarsharif406/guti-vr
**Track:** Gaming  **Division:** New Experience  **Build path:** IWSDK (WebXR)

## Inspiration
Every Bangladeshi kid knows two games: গুলি (marbles) and ঘুড়ি কাটাকাটি (kite fighting). Both are played with bare hands, in a courtyard or on a rooftop, and both fit a short, social, seated-friendly VR session. Guti brings them into VR with nothing but your hands.

## What it does
* **Marbles (গুলি) across four worlds:** pinch the white marble, pull back, release, and knock every coloured marble out of the গোল্লা ring. The same shot behaves differently in each world because we use real gravity: the village (9.81 m/s²), the Moon (1.62), Mars (3.71) and a space station (zero gravity, no friction, marbles float away). 13 levels with rocks, heavy and golden marbles, combos, scores and saved star ratings. Clearing a world shows one real space fact.
* **Kite Fight (ঘুড়ি কাটাকাটি):** pinch and move your hand to steer your kite. Touch a rival kite fast to cut its string; touch slowly and you get cut. Four kite types, wind gusts, combos, a "sharp string" pickup and rising waves in 60-second rounds.

## Hand interaction
Everything is *pinch, move, release*, and the pinch point is the real midpoint between thumb tip and index tip, not the wrist. Hand tracking drops out during fast motion, so shots use a slow pull-back (slingshot) instead of a fling, and the kite follows the hand with a little lag like a real kite. Menus are big cards you point at and pinch. The whole play space is within about two feet in front of a seated player. Controllers work as a fallback (trigger = pinch) but are never required.

## How we built it
IWSDK (WebXR) with TypeScript, Three.js, Havok physics (marbles) and Vite. All sounds are synthesised at runtime and all visuals are procedural, so the build is tiny and loads fast. Hosted as a PWA-ready web app on GitHub Pages.

## Challenges
Hand tracking jitter and dropouts, tuning marble friction so shots feel good, making the kite-cut rule readable (fast = cut, slow = get cut), and rendering Bengali text in-headset (bundled font).

## What's next
Guti is the first step of a Bangla folk-games arcade: next come lattim (spinning tops), dang-guli, and sat-chara, plus more worlds (Jupiter, an asteroid), two-player pass-and-play, more kite sky scenes, and Horizon Store packaging.

## Built with
WebXR, IWSDK, TypeScript, Three.js, Havok Physics, Vite, Meta Quest, Hand Tracking

## Demo video script (< 3 min)
1. 0:00 Title card "Guti – hands-only VR village games". Show the headset view of the menu (10 s).
2. 0:10 Village marbles: first-shot hint ring, pinch, pull, release, marbles scatter (25 s).
3. 0:35 Open ?level=5 (Moon): slow, long slides, then ?level=11 (Station): marbles float off the table in zero gravity (30 s).
4. 1:05 Back to menu with the pinch-pressed card, open Kite Fight (10 s).
5. 1:15 Steer the kite, slice two strings, get hit once, show final score (50 s).
6. 2:05 Closing: "No controllers. Seated. Made in Bangladesh." (10 s).
Record from the Quest (Meta Quest app -> Cast/Record) or the IWER emulator window. Upload to YouTube as Public.


## Accessibility & polish
- Wordless onboarding: a ghost fingertip demonstrates pinch, pull and release on level 1.
- Look-to-select: gaze at a menu card for about 1.5 s to choose it, no hand press needed.
- Generous grab radius, and either hand works (one-handed play).
- Collect stars to unlock marble skins: Pearl, Jade, Ruby, Gold, Galaxy.
- Gameplay freezes automatically when the headset is removed or the system menu opens.
- Level map: tap a tile to replay any unlocked level; each shows its saved stars.
