import {
  Entity,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  Pressed,
  RayInteractable,
  createSystem,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { modeState, setMode } from './mode.js';
import { isFontReady, TextPanel } from './panel.js';
import { MenuButton, MenuTargets } from './ui-components.js';

const TABLE_Y = 0.72;
const TABLE_CENTER_Z = -0.55;

interface Btn {
  entity: Entity;
  panel: TextPanel;
  mesh: Mesh;
  home: number;
}

/**
 * Hands-first mode menu: big floating cards you point at and pinch (or click).
 * Also owns the small "back" card shown while a game is running.
 */
export class MenuSystem extends createSystem({
  pressed: { required: [MenuButton, Pressed] },
  hovered: { required: [MenuButton, Hovered] },
}) {
  private buttons: Btn[] = [];
  private title!: TextPanel;
  private back!: Btn;
  private lastMode = '';
  private fontWasReady = false;
  private cooldown = 0;

  private makeButton(
    target: (typeof MenuTargets)[keyof typeof MenuTargets],
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    tilt: number,
    draw: (p: TextPanel) => void,
  ): Btn {
    const panel = new TextPanel(w, h, 512);
    panel.mesh.position.set(x, y, z);
    panel.mesh.rotation.x = tilt;
    const entity = this.world.createTransformEntity(panel.mesh);
    entity.addComponent(RayInteractable);
    entity.addComponent(MenuButton, { target });
    draw(panel);
    return { entity, panel, mesh: panel.mesh, home: y };
  }

  private drawButtons(): void {
    const card = (
      p: TextPanel,
      bn: string,
      en: string,
      sub: string,
      color: string,
    ) => {
      p.card('rgba(40,24,12,0.88)', color);
      p.text(bn, p.h * 0.42, 80, color);
      p.text(en, p.h * 0.62, 50, '#ffe9c4');
      p.text(sub, p.h * 0.82, 30, '#cdb99a');
      p.commit();
    };
    card(this.buttons[0].panel, 'Marbles', 'গুলি', 'Flick them out of the ring', '#7fd8ff');
    card(this.buttons[1].panel, 'Kite Fight', 'ঘুড়ি', 'Cut the other kites', '#ffb56b');
    const b = this.back.panel;
    b.card('rgba(40,24,12,0.88)', '#ffd9a0');
    b.text('← Menu', b.h * 0.62, 70, '#ffe9c4');
    b.commit();
    const t = this.title;
    t.card('rgba(30,18,10,0.0)', 'rgba(0,0,0,0)');
    t.text('GUTI', t.h * 0.5, 120, '#ffd9a0');
    t.text('গুটি  •  hands-only village games', t.h * 0.9, 34, '#ffe9c4');
    t.commit();
  }

  init(): void {
    const y = TABLE_Y + 0.2;
    const z = TABLE_CENTER_Z + 0.02;
    this.buttons.push(
      this.makeButton(MenuTargets.Guti, 0.22, 0.22, -0.15, y, z, -0.5, () => {}),
      this.makeButton(MenuTargets.Kite, 0.22, 0.22, 0.15, y, z, -0.5, () => {}),
    );
    this.back = this.makeButton(
      MenuTargets.Menu,
      0.14,
      0.07,
      0.34,
      TABLE_Y + 0.07,
      TABLE_CENTER_Z + 0.2,
      -0.9,
      () => {},
    );
    this.title = new TextPanel(0.5, 0.15, 640);
    this.title.mesh.position.set(0, TABLE_Y + 0.4, TABLE_CENTER_Z - 0.05);
    this.title.mesh.rotation.x = -0.35;
    this.world.createTransformEntity(this.title.mesh);
    this.drawButtons();

    const onPress = (entity: Entity) => {
      if (this.cooldown > 0) return;
      const target = entity.getValue(MenuButton, 'target');
      if (!target) return;
      // only act on buttons that are visible in the current mode
      const o = entity.object3D;
      if (!o || !o.visible) return;
      sfx.ambience();
      sfx.select();
      this.cooldown = 0.4;
      setMode(target as 'menu' | 'guti' | 'kite');
    };
    this.cleanupFuncs.push(this.queries.pressed.subscribe('qualify', onPress));
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    if (modeState.mode !== this.lastMode) {
      this.lastMode = modeState.mode;
      const menu = modeState.mode === 'menu';
      for (const b of this.buttons) b.mesh.visible = menu;
      this.title.mesh.visible = menu;
      this.back.mesh.visible = !menu;
    }
    if (isFontReady() !== this.fontWasReady) {
      this.fontWasReady = isFontReady();
      this.drawButtons();
    }
    // hover feedback: buttons lift a little
    for (const b of this.buttons) {
      let hov = false;
      for (const e of this.queries.hovered.entities) {
        if (e === b.entity) hov = true;
      }
      const target = b.home + (hov ? 0.025 : 0);
      b.mesh.position.y += (target - b.mesh.position.y) * Math.min(1, delta * 12);
      (b.mesh.material as MeshBasicMaterial).opacity = hov ? 1 : 0.92;
    }
  }
}
