# Pocket Workshop

**Three experiences, your bare hands.** A hands-only WebXR project for Meta Quest: a clockwork puzzle bench, a light-weaving sanctuary and a spell-casting arena.

- **GearShift** – a steampunk blueprint bench of gear puzzles in three chapters.
- **Aura Weaver: The Light Sanctuary** – turn mirrors and prisms, mix cyan, magenta and gold light, and wake the monoliths of a dark sanctuary until it blooms. See [docs/AURA_WEAVER.md](docs/AURA_WEAVER.md).
- **Spellforge: The Arcane Awakening** – cast fire, ice, lightning, aether, nature and shadow with your bare hands, discover fusions, face three bosses. See [docs/SPELLFORGE.md](docs/SPELLFORGE.md).

No controllers needed: hand tracking with pinch. Mouse works on desktop for quick testing.

Live: https://shahriarsharif406.github.io/guti-vr/ (open in the Quest Browser, tap "Enter VR").

Built with IWSDK (WebXR), TypeScript, Three.js. All visuals and sounds are procedural.

## GearShift mentor (AI)
GearShift can show one friendly line from a small language model (free, key-less Pollinations text endpoint). No personal data is sent; if the network is blocked a built-in line is used so the game never waits.

## Credits

- Sound effects: "Oculus Audio Pack 01" by Oculus VR, LLC (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0. Files renamed to the UCS naming convention; OGG previews transcoded from the original WAVs.
- 3D props (lamps, plants, side table, books, mug, basket): "Free Apartment Props" by Vuena, CC0 (https://github.com/Vuena/free-apartment-props-cc0).

## Run it
```
npm install
npm run dev        # managed dev server + browser
npm run build && npm run preview
npm run typecheck
npm run test:aura  # 28 logic tests: colour mixing, optics, all 7 puzzles, save data
npm run test:spell # 58 logic tests: gestures, spells, fusions, bosses, save data
```
Browser checks (need `npm run build` and a preview server on port 4175): `node tests/aura-e2e.mjs`, `node tests/spell-e2e.mjs`.

## Honest status
Verified in a desktop browser (software rendering, so frame rate is not representative). Not verified on a Quest headset. No performance number is claimed.
