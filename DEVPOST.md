# Pocket Workshop

## Inspiration
The best moments in VR are when your hands make something. Pocket Workshop is a tiny workshop on your table where you build first, then play with what you built.

## What it does
Six hand-made stations, seated and hands-only: shape clay on a pottery wheel; build a kite and fly it; lay ramps for a marble run; line up dominoes; snap bricks into a tower and smash it; fold a paper plane and throw it through rings.

## How we built it
IWSDK + TypeScript on WebXR. Hand-tracking pinch input, a custom lathe mesh for clay, custom 2D marble physics with a solver that verifies every level is winnable, procedural audio and scenery.

## Challenges
Making hand input reliable and readable for first-time players, and keeping performance Quest-friendly.

## What's next
More workshop stations, more materials and shareable creations.
