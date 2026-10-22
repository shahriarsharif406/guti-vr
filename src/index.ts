import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game.js';
import { KiteSystem } from './kite.js';
import { MenuSystem } from './menu.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(MenuSystem);
  world.registerSystem(GameSystem);
  world.registerSystem(KiteSystem);
});
