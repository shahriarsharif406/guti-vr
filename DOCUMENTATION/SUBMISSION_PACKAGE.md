# Spellforge: submission package

**What it is:** a hands-first WebXR spell-casting game (IWSDK + Three.js). Six elements, 15 discoverable fusions, three multi-phase bosses, Journey/Training/Sandbox/Endless/Boss Rush/Trials/Tutorial modes.

**New in this build:** 3D positional (HRTF) sound so you hear where an attack comes from; procedural music that speeds up and adds layers with tension and each boss phase; first-run tips and nudges that point to undiscovered fusions.

**Honest status:** IMPLEMENTED and TESTED by automated logic tests and a desktop browser e2e run. **VERIFIED on a headset: NO** (none was available). No frame-rate claim. See PRODUCTION_AUDIT.md and BUG_TRACKER.md.

**How to run:** `npm install`, `npm run build`, `npx vite preview --port 4175`, open `https://<host>:4175/` and pick Spellforge. Desktop: hold left mouse to charge, release to cast, SPACE to shield, 1-6 for elements.

**Media still needed:** headset capture video and screenshots (desktop e2e screenshots exist but use software rendering).
