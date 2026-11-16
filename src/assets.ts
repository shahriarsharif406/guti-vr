import { AssetType, defineAssets } from '@iwsdk/core';

// Village models by Kenney (MIT, see public/models/CREDITS.md). Everything else is procedural.
const B = import.meta.env.BASE_URL + 'models/';
const model = (file: string) => ({
  url: B + file,
  type: AssetType.GLTF,
  priority: 'critical' as const,
});

export default defineAssets({
  houseA: model('building-small-a.glb'),
  houseB: model('building-small-b.glb'),
  houseC: model('building-small-c.glb'),
  houseD: model('building-small-d.glb'),
  trees: model('grass-trees.glb'),
  treesTall: model('grass-trees-tall.glb'),
  lamps: model('road-straight-lightposts.glb'),
  fountain: model('pavement-fountain.glb'),
  sunsetHdr: {
    url: import.meta.env.BASE_URL + 'hdri/sunset.exr',
    type: AssetType.HDRTexture,
    priority: 'critical' as const,
  },
});
