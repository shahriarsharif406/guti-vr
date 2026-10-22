# Devpost submission texts (final, matches the real game)

**Project name:** Guti
**Elevator pitch (<=140 chars):** Guti: hands-only VR village games from Bangladesh. Flick marbles out of the ring and cut rival kites. No controllers, seated.
**Track:** Gaming  **Division:** New Experience  **Build path:** IWSDK (WebXR)

## Inspiration
Every Bangladeshi kid knows two games: গুলি (marbles) and ঘুড়ি কাটাকাটি (kite fighting). Both are played with bare hands, in a courtyard or on a rooftop, and both fit a short, social, seated-friendly VR session. Guti brings them into VR with nothing but your hands.

## What it does
* **গুলি:** a clay disc sits at hand height. Pinch the white marble, pull back to see the aim arrow and power colour, release. Knock all coloured marbles out of the গোল্লা ring within your shots. 10 levels.
* **ঘুড়ি কাটাকাটি:** pinch and move your hand to steer your kite. Touch another kite fast to slice its string; touch slowly and you get cut. 60-second rounds with a best score.

## Hand interaction
Everything is *pinch, move, release*. Hand tracking drops out during fast motion, so shots use a slow pull-back (slingshot) instead of a fling, and the kite follows the hand with a little lag like a real kite. Menus are big cards you point at and pinch. The whole play space is within about two feet in front of a seated player. Controllers work as a fallback (trigger = pinch) but are never required.

## How we built it
IWSDK (WebXR) with TypeScript, Three.js, Havok physics (marbles) and Vite. All sounds are synthesised at runtime and all visuals are procedural, so the build is tiny and loads fast. Hosted as a PWA-ready web app on GitHub Pages.

## Challenges
Hand tracking jitter and dropouts, tuning marble friction so shots feel good, making the kite-cut rule readable (fast = cut, slow = get cut), and rendering Bengali text in-headset (bundled font).

## What's next
More marble games (target shooting, guti pyramid), two-player pass-and-play, more kite sky scenes, and Horizon Store packaging.

## Built with
WebXR, IWSDK, TypeScript, Three.js, Havok Physics, Vite, Meta Quest, Hand Tracking

## Demo video script (< 3 min)
1. 0:00 Title card "Guti – hands-only VR village games". Show the headset view of the menu (10 s).
2. 0:10 Marbles: first-shot hint ring, pinch, pull (arrow turns green→red), release, marbles scatter (40 s).
3. 0:50 Clear level 1, quick cut to level 5 (15 s).
4. 1:05 Back to menu with the pinch-pressed card, open Kite Fight (10 s).
5. 1:15 Steer the kite, slice two strings, get hit once, show final score (50 s).
6. 2:05 Closing: "No controllers. Seated. Made in Bangladesh." (10 s).
Record from the Quest (Meta Quest app -> Cast/Record) or the IWER emulator window. Upload to YouTube as Public.
