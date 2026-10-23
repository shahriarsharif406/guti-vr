import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { EnvSystem } from './env.js';
import { FxSystem } from './fx.js';
import { GameSystem } from './game.js';
import { KiteSystem } from './kite.js';
import { MenuSystem } from './menu.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(EnvSystem);
  world.registerSystem(FxSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(GameSystem);
  world.registerSystem(KiteSystem);
});
