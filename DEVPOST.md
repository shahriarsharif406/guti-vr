# Devpost submission texts (final, matches the real game)

**Project name:** Guti
**Elevator pitch (<=140 chars):** Guti: four Bangladeshi village games in VR (marbles, kites, lattim, danguli). Hands only, seated, no controllers.
**Playable link (Try it out):** https://shahriarsharif406.github.io/guti-vr/
**GitHub:** https://github.com/shahriarsharif406/guti-vr
**Track:** Gaming  **Division:** New Experience  **Build path:** IWSDK (WebXR)

## Inspiration
Every Bangladeshi kid grew up on গুলি (marbles), ঘুড়ি (kites over the paddy fields) and লাটিম (spinning tops). They are played with bare hands, in a courtyard or an open field, and each fits a short, seated VR session. Guti brings them into VR with nothing but your hands.

## What it does
* **Marbles (গুলি):** pinch the white marble, pull back, release. Six ways to play across 37 levels: Classic goalla ring, গর্ত hole game, Precision, Race (hole-in-one), turn-based Duel vs Rafiq (AI), and an optional Fantasy set (Moon, Mars, orbit). The default is rural Bangladesh: village courtyard, harvest field, monsoon mud, Dhaka rooftop at dusk. Surfaces change how far marbles slide. Rocks, heavy and golden marbles, combos, saved stars and unlockable skins.
* **Kite Alive (ঘুড়ি):** five ways to play (rival-kite festival, free flight, wind master, sky rings, rescue a snagged kite), four places (village paddy, monsoon beel, winter mustard field, river char), five skies from golden evening to storm, and a kite designer. Golden wind streams, a gust forecast, string tension, manjha, an eagle, power wires and trees that snag your kite.
* **Danguli (ডাংগুলি):** a two-strike hands-only game: flick the guli up, then hit it in mid-air as far as you can. Real ballistic flight with drag and bounce; three tries per round.
* **Lattim (লাটিম):** pinch the top, swing, release. A faster flick gives more spin. Knock the other tops out of the chalk ring before your top wobbles to a stop. 6 rounds.

## Hand interaction
Everything is *pinch, move, release*, and the pinch point is the real midpoint between thumb tip and index tip, not the wrist. Hand tracking drops out during fast motion, so shots use a slow pull-back (slingshot) instead of a fling, and the kite follows the hand with a little lag like a real kite. Menus are big cards you point at and pinch. The whole play space is within about two feet in front of a seated player. Controllers work as a fallback (trigger = pinch) but are never required.

## How we built it
IWSDK (WebXR) with TypeScript, Three.js, Havok physics (marbles) and Vite. All sounds are synthesised at runtime and all visuals are procedural, so the build is tiny and loads fast. Hosted as a PWA-ready web app on GitHub Pages.

## Challenges
Hand tracking jitter and dropouts, tuning marble friction so shots feel good, making the kite-cut rule readable (fast = cut, slow = get cut), and rendering Bengali text in-headset (bundled font).

## What's next
Guti is the first step of a Bangla folk-games arcade: dang-guli, sat-chara and boli-khela are next, plus two-player pass-and-play, more rural scenes and Horizon Store packaging.

## Built with
WebXR, IWSDK, TypeScript, Three.js, Havok Physics, Vite, Meta Quest, Hand Tracking

## Demo video script (< 3 min)
1. 0:00 Title "Guti: hands-only VR village games". Menu with four cards (10 s).
2. 0:10 Marbles in the village: ghost-hand hint, pinch, pull, release, marbles scatter (25 s).
3. 0:35 Jump with ?level=8 (monsoon rain) then ?level=11 (Dhaka rooftop): different surfaces, different slides (25 s).
4. 1:00 Menu, open Kite Alive: steer, slice two strings, dodge a crow, a gust, final survival time (50 s).
5. 1:50 Menu, open Lattim: swing and release, knock a top out, level cleared (35 s).
6. 2:25 Closing: "No controllers. Seated. Made in Bangladesh." (10 s).
Record from the Quest (Meta Quest app -> Cast/Record). Upload to YouTube as Public.


## Accessibility & polish
- Wordless onboarding: a ghost fingertip demonstrates pinch, pull and release on level 1.
- Look-to-select: gaze at a menu card for about 1.5 s to choose it, no hand press needed.
- Generous grab radius, and either hand works (one-handed play).
- Collect stars to unlock marble skins: Pearl, Jade, Ruby, Gold, Galaxy.
- Gameplay freezes automatically when the headset is removed or the system menu opens.
- Level map: tap a tile to replay any unlocked level; each shows its saved stars.
