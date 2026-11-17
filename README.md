# গুটি · Guti

Hands-only VR village games from Bangladesh, built for the **Meta VR Start Developer Competition 2026**.
No controllers. Seated. Everything within arm's reach.

* **গুলি (Marbles)** – pinch the white marble, pull back, release. Flick the coloured marbles out of the *goalla* ring. 13 levels across four Bangladeshi places: the village courtyard, a dry harvest field, the monsoon mud and a Dhaka rooftop at dusk. Each surface changes how far a marble slides.
* **ঘুড়ি (Kite Alive)** – stand in an open paddy field beside a beel. Pinch and move your hand to fly your kite. Touch rival kites **fast** to cut their strings, dodge crows, eagles and enemy manjha strings, stay clear of **power wires and trees** (a snagged kite costs a life, shake your hand to free it), read the **wind forecast**, ride the **golden wind streams** for free lift, and watch your **string tension** (ease it with your other hand or SPACE) to keep your kite alive as long as you can. Each game has its own folk-style music (bansuri, tanpura, tabla/dhol); press M to mute.
* **লাটিম (Lattim)** – pinch the spinning top, swing and let go. Knock the other tops out of the chalk ring before yours stops spinning. 6 rounds.

Built with the Immersive Web SDK (IWSDK, WebXR), TypeScript, Three.js, Havok physics and Vite.

## Play

**Live:** https://shahriarsharif406.github.io/guti-vr/

Open the deployed link in the Meta Quest Browser, tap **Enter XR**, put your hands in front of you.
Add `?level=5` (harvest field), `?level=8` (monsoon) or `?level=11` (rooftop) to the link to jump to a marbles world.
On a laptop you can try it with the mouse: click a card, then click-and-drag (drag down/back = pull; in kite mode drag to steer; in lattim drag up and let go to throw).

## Run locally

```bash
npm install
npm run dev        # https://localhost:8081  (IWER emulator runs automatically in desktop browsers)
npm run build      # production build in dist/
```

## Deploy (GitHub Pages)

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` is built and published by `.github/workflows/deploy.yml`.

## Controls / design notes

* Input is *pinch → move → release* instead of fast gestures, because hand tracking drops out on quick motion.
* Controllers still work as a fallback (trigger = pinch), but the whole game is playable with bare hands, including the menu (point + pinch).
* All sound effects are synthesised at runtime; no audio files.


## Accessibility & polish
- Wordless onboarding: a ghost fingertip demonstrates pinch, pull and release on level 1.
- Look-to-select: gaze at a menu card for about 1.5 s to choose it, no hand press needed.
- Generous grab radius, and either hand works (one-handed play).
- Collect stars to unlock marble skins: Pearl, Jade, Ruby, Gold, Galaxy.
- Gameplay freezes automatically when the headset is removed or the system menu opens.
- Level map: tap a tile to replay any unlocked level; each shows its saved stars.

## Credits
All scenery, models, textures and sounds are procedural (code-generated). The sunset sky lighting is a CC0 HDRI from [Poly Haven](https://polyhaven.com).
