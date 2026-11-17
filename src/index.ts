import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { EnvSystem } from './env.js';
import { FxSystem } from './fx.js';
import { GameSystem } from './game.js';
import { KiteSystem } from './kite.js';
import { DanguliSystem } from './danguli.js';
import { KiteCraftSystem } from './kitecraft.js';
import { MarbleRunSystem } from './marblerun.js';
import { PaperPlaneSystem } from './paperplane.js';
import { GearShiftSystem } from './gearshift.js';
import { AuraSystem } from './aura.js';
import { LattimSystem } from './lattim.js';
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
  world.registerSystem(LattimSystem);
  world.registerSystem(DanguliSystem);
  world.registerSystem(KiteCraftSystem);
  world.registerSystem(MarbleRunSystem);
  world.registerSystem(PaperPlaneSystem);
  world.registerSystem(GearShiftSystem);
  world.registerSystem(AuraSystem);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 600);
  }
});
