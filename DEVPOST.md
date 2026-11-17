# Pocket Workshop

**Build something with your hands, then play with it. Hands only, seated, no controllers.**

## Inspiration
The best moments in VR are when your hands make something. Pocket Workshop is a cozy workshop on your table: you build first, then play with what you built.

## What it does
Five stations, all driven by hand-tracking pinch:
- **GearShift:** a blueprint bench of 6 gear puzzles. Seat the right gears (some with two layers of teeth) so the output wheel spins the way the goal says.
- **Pottery:** shape spinning clay into a pot, glaze it, fire it in a kiln and keep it on your shelf.
- **Brick Builder:** snap bricks into a tower, then smash it with a wrecking ball.
- **Domino Run:** stand dominoes in a chain and watch it fall.
- **Aura Weaver:** turn mirrors and prisms, mix cyan, magenta and gold light, wake dark monoliths and watch a forgotten sanctuary bloom. 7 solver-verified puzzles, procedural adaptive music, save and photo mode.

A small **AI Workshop Mentor** sets a fair challenge (the game verifies the goal) and comments on what you made in one friendly line. No personal data is sent, and it falls back to built-in lines when offline.

## How we built it
IWSDK + TypeScript on WebXR. A custom lathe mesh for clay, a stud-grid brick system with support and collapse simulation, a domino toppling simulation, procedural scenery, and real sound effects.

## Challenges
Making hand input forgiving for first-time players and keeping scenes light for Quest.

## What's next
More stations, more materials and shareable creations.

## Credits
SFX: "Oculus Audio Pack 01" by Oculus VR, LLC (CC BY 4.0). 3D props: Free Apartment Props by Vuena (CC0). AI mentor text: Pollinations.
