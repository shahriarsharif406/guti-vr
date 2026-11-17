import { AssetType, defineAssets } from '@iwsdk/core';

// The only external asset is the CC0 sunset HDRI (Poly Haven); everything else is procedural.
export default defineAssets({
  sunsetHdr: {
    url: import.meta.env.BASE_URL + 'hdri/sunset.exr',
    type: AssetType.HDRTexture,
    priority: 'critical' as const,
  },
});
