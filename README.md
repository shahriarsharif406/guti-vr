# Pocket Workshop

**Build it with your hands, then play it.** A seated, hands-only WebXR experience for Meta Quest: a cozy miniature workshop on your table where you make something with your own hands, then use it.

- **Pottery** – pinch and pull a spinning clay lump into a jug, bowl or vase, glaze it, fire it in the kiln and put it on your shelf.
- **Brick Builder** – snap studded bricks into a tower, then smash it with a wrecking ball.
- **Domino Run** – line up colourful dominoes by hand, push the first one, watch the chain.

No controllers needed: hand tracking with pinch. Mouse works on desktop for quick testing.

Live: https://shahriarsharif406.github.io/guti-vr/ (open in the Quest Browser, tap "Enter VR").

Built with IWSDK (WebXR), TypeScript, Three.js. All visuals and sounds are procedural.

## Credits

- Sound effects: "Oculus Audio Pack 01" by Oculus VR, LLC (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0. Files renamed to the UCS naming convention; OGG previews transcoded from the original WAVs.
- 3D props (lamps, plants, side table, books, mug, basket): "Free Apartment Props" by Vuena, CC0 (https://github.com/Vuena/free-apartment-props-cc0).

## Workshop Mentor (AI)
When you finish a creation, a small language model (free, key-less Pollinations text endpoint) reads a one-line description of what you made (e.g. "a tower 10 bricks high") and replies with one friendly sentence. No personal data is sent; if the network is slow or blocked, a built-in line is used so the game never waits.
