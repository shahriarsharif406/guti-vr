import { AssetType, defineAssets } from '@iwsdk/core';

// The only external asset is the CC0 sunset HDRI (Poly Haven); everything else is procedural.
export default defineAssets({
  sunsetHdr: {
    url: import.meta.env.BASE_URL + 'hdri/sunset.exr',
    type: AssetType.HDRTexture,
    priority: 'critical' as const,
  },
  floor_lamp: {
    url: import.meta.env.BASE_URL + 'models/ap_floor_lamp.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  plant_small: {
    url: import.meta.env.BASE_URL + 'models/ap_plant_small.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  plant_cactus: {
    url: import.meta.env.BASE_URL + 'models/ap_plant_cactus.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  table_lamp: {
    url: import.meta.env.BASE_URL + 'models/ap_table_lamp.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  side_table: {
    url: import.meta.env.BASE_URL + 'models/ap_side_table.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  book_stack: {
    url: import.meta.env.BASE_URL + 'models/ap_book_stack.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  mug: {
    url: import.meta.env.BASE_URL + 'models/ap_mug.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
  basket: {
    url: import.meta.env.BASE_URL + 'models/ap_basket.glb',
    type: AssetType.GLTF,
    priority: 'critical' as const,
  },
});
