import { defineAssets } from '@iwsdk/core';

// Guti builds all of its visuals procedurally in GameSystem, so the manifest
// is intentionally empty. Keep this module deterministic and side-effect free.
export default defineAssets({});
