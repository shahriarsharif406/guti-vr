# Aura Weaver: The Light Sanctuary

A forgotten sanctuary has lost its light. You are the Weaver. Turn mirrors and prisms, mix cyan, magenta and gold, and wake the monoliths until the world blooms. It is the fifth station of Pocket Workshop and is played with hand pinch (mouse, touch and keyboard also work on a desktop).

## Play (judge script, about 2 minutes)
1. Open the live link, click **Aura Weaver** on the menu card. A title screen sets the mood (the first light already glows behind it). Press **START**.
2. **0:10** Level 1: pinch (or click) the ringed mirror and swing it. The cyan beam bends into the sleeping monolith. Hold it 0.8 s: the monolith awakens, a chord rings, a wave crosses the board, the first lotus blooms.
3. **0:40** Level 2-3: a prism splits white light into cyan, magenta and gold. Route each colour to its own gate.
4. **1:10** Level 4: two beams must **mix** into violet at one gate. Extra colour keeps a gate shut (the gate tells you what it needs).
5. **1:30** Levels 5-7: stone walls, filters, splitters. Level 7 merges everything into a white heart.
6. After the last gate the finale plays: waves, flora blooming, title card with a light signature drawn from how you played. Use **Photo mode** in the pause menu to capture it.

Controls: pinch and swing (turn), tap (one step), mouse drag, Tab and arrow keys, R retry, Enter next, P or Esc pause, M music on/off, [ and ] volume.

## Light model (documented and tested)
Three primaries as bits: CYAN 1, MAGENTA 2, GOLD 4. Mixing is additive (bitwise union), so cyan + magenta = violet, cyan + gold = emerald, magenta + gold = ember, all three = white. A gate opens only when the union of all light reaching it **exactly** equals its colour. A prism re-emits each primary in a fan of -30, 0 and +30 degrees. A filter keeps its colour. A splitter transmits one copy and reflects one. Walls absorb. Mirrors and prisms turn in 15 degree steps. All seven levels are checked by an exhaustive solver (`npm run test:aura`).

## Architecture (inside the IWSDK app)
| File | Role |
|---|---|
| `src/auralogic.ts` | Pure optics, colour mixing, solver and the 7 levels over 5 chapters. No DOM or rendering. |
| `src/aurasave.ts` | Versioned LocalStorage save, validated and clamped on load. |
| `src/aurafx.ts` | Shaders and procedural meshes: liquid-light beams, nebula, crystals, ripples, lotus, fractal ferns, floating stones. |
| `src/aura.ts` | `AuraSystem` (IWSDK system): screens (title, chapters, game, settings), input, gate awakening, world state, finale, photo mode, event bus. |
| `src/audio.ts` | Procedural WebAudio: master, music and effects buses, adaptive aura music, beam drone voices, awakening chords. |
| `tests/` | Logic tests and a browser end-to-end script. |

Events (rotate, awaken, complete, finale, impure) flow through one bus; audio, visuals, save and world state subscribe to it. One `trace()` call is the single source of truth for both the drawn beams and the puzzle result, so they cannot disagree.

## Systems implemented
- Liquid-light beam shader (instanced quads), nebula atmosphere shader, crystal shader (fresnel, iridescence, caustics), chromatic ripple shader, rune rings, lotus, fractal ferns, crystal spires, floating stones, pollen particles.
- Monolith awakening, world pulse, sanctuary state (restoration, purity, awake gates), compass HUD, guiding wisps, light memory (ghost trace), colour-letter labels.
- Procedural audio with separate master, music and effects volume, mute, adaptive harmony, gate chords.
- Title, chapter select (locked until unlocked), pause, settings (audio, quality, motion, flashes, colour labels, wisps, tutorial), restart, completion card, photo mode (3 compositions, HUD hidden, share or download), continue and new game.
- Three quality tiers plus automatic degradation under load.

## Limitations (stated plainly)
- **Not verified on a headset.** Desktop browser only, software rendered. No frame-rate figure is claimed.
- **No real post-process bloom.** WebXR on Quest makes a full EffectComposer pipeline costly, so glow is done with additive halos, shader fresnel and radial god-ray quads on awake gates.
- **Light bending is by rotating optics in 15 degree steps**, not free-form spline dragging. There is no focusing lens and no energy-storage crystal. Crystals light up as the sanctuary restores.
- Audio is plain WebAudio nodes, no AudioWorklet (not needed). Mobile portrait layout is not a separate design: the board is a 3D object in the room.
- The finale "camera choreography" is a slow dolly of the board toward you, since a VR camera belongs to the player.
- Haptics only where the browser supports `navigator.vibrate`.
