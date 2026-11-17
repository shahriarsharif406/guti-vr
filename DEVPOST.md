# Devpost submission texts (final, matches the real game)

**Project name:** Guti
**Elevator pitch (<=140 chars):** Make it with your hands, then play it: kites, marble runs and clay pots from a Bangladeshi village. Hands only, seated.
**Playable link (Try it out):** https://shahriarsharif406.github.io/guti-vr/
**GitHub:** https://github.com/shahriarsharif406/guti-vr
**Track:** Gaming  **Division:** New Experience  **Build path:** IWSDK (WebXR)

## Inspiration
In Bangladesh we make our own toys: bamboo and paper kites, clay marbles, pots from the potter's wheel. Guti is about that, in VR, with nothing but your hands: build it, then play it. Every Bangladeshi kid also grew up on গুলি (marbles), ঘুড়ি (kites over the paddy fields) and লাটিম (spinning tops). They are played with bare hands, in a courtyard or an open field, and each fits a short, seated VR session. Guti brings them into VR with nothing but your hands.

## What it does
* **Kite Alive (ঘুড়ি):** build your kite on a workbench (cross the bamboo sticks, glue the paper, pick a tail, tie the string), then fly it: five ways to play (rival-kite festival, free flight, wind master, sky rings, rescue), four places and five skies. Golden wind streams, a gust forecast, string tension, manjha, an eagle, power wires and trees that snag your kite.
* **Marble Run (গুলির পথ):** drop bamboo ramps on a board with your hands, release the marble and watch it roll into the basket. Five levels, each checked solvable by an automatic solver.
* **Pottery wheel (কুমোরের চাকা):** shape spinning clay with both hands (push the wall out from inside, squeeze from outside, lift the rim), match a kolshi, bowl or vase, glaze it, fire it in the kiln and put it on your shelf.
* **Marbles (গুলি):** pinch the white marble, pull back, release. Six ways to play across 37 levels (Classic, hole game, Precision, Race, Duel vs an AI village kid, optional Fantasy), four Bangladeshi settings.
* **Coming soon:** Lattim (spinning tops with a gyroscopic tilt model) and Danguli (two-strike stick game), already built and kept off the menu until polished.

## Hand interaction
Everything is *pinch, move, release*, and the pinch point is the real midpoint between thumb tip and index tip, not the wrist. Hand tracking drops out during fast motion, so shots use a slow pull-back (slingshot) instead of a fling, and the kite follows the hand with a little lag like a real kite. Menus are big cards you point at and pinch. The whole play space is within about two feet in front of a seated player. Controllers work as a fallback (trigger = pinch) but are never required.

## How we built it
IWSDK (WebXR) with TypeScript, Three.js, Havok physics (marbles) and Vite. All sounds are synthesised at runtime and all visuals are procedural, so the build is tiny and loads fast. Hosted as a PWA-ready web app on GitHub Pages.

## Challenges
Hand tracking jitter and dropouts, tuning marble friction so shots feel good, making the kite-cut rule readable (fast = cut, slow = get cut), and rendering Bengali text in-headset (bundled font).

## What's next
More things to make by hand (boats, rickshaw art, pitha), Lattim and Danguli, shared creations, mixed-reality mode and Horizon Store packaging.

## Built with
WebXR, IWSDK, TypeScript, Three.js, Havok Physics, Vite, Meta Quest, Hand Tracking

## Demo video script (< 3 min)
1. 0:00 Title "Guti: make it, then play it". Menu with four cards (10 s).
2. 0:10 Pottery: push, squeeze, lift the rim, glaze, kiln, shelf (40 s).
3. 0:50 Kite workshop: sticks, paper, tail, string, then fly it and cut a rival kite (60 s).
4. 1:50 Marble Run: place two ramps, release, marble drops in the basket (30 s).
5. 2:20 Marbles: one quick shot in the village courtyard (15 s).
6. 2:35 Closing: "No controllers. Seated. Made in Bangladesh." (10 s).
Record from the Quest (Meta Quest app -> Cast/Record). Upload to YouTube as Public.
