# গুটি · Guti

Hands-only VR village games from Bangladesh, built for the **Meta VR Start Developer Competition 2026**.
No controllers. Seated. Everything within arm's reach.

* **গুলি (Marbles)** – pinch the white marble, pull back, release. Flick the coloured marbles out of the *goalla* ring. 10 levels.
* **ঘুড়ি কাটাকাটি (Kite Fight)** – pinch and move your hand to fly your kite. Touch the other kites **fast** to cut their strings; touch slowly and they cut you. 60-second rounds.

Built with the Immersive Web SDK (IWSDK, WebXR), TypeScript, Three.js, Havok physics and Vite.

## Play

**Live:** https://shahriarsharif406.github.io/guti-vr/

Open the deployed link in the Meta Quest Browser, tap **Enter XR**, put your hands in front of you.
On a laptop you can try it with the mouse: click a card, then click-and-drag (drag down/back = pull; in kite mode drag to steer).

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
