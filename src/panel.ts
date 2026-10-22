import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from '@iwsdk/core';
import '@fontsource/noto-sans-bengali/bengali-700.css';

export const FONT = '"Noto Sans Bengali", sans-serif';

let fontReady = false;
try {
  void document.fonts
    .load('700 40px "Noto Sans Bengali"', 'গুটি')
    .then(() => {
      fontReady = true;
    });
} catch {
  fontReady = true;
}
export const isFontReady = (): boolean => fontReady;

/** A flat canvas-textured quad for HUD text. Redraw only when content changes. */
export class TextPanel {
  readonly mesh: Mesh;
  readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  constructor(
    readonly widthM: number,
    readonly heightM: number,
    readonly px = 640,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.round((px * heightM) / widthM);
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.tex = new CanvasTexture(canvas);
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.tex, transparent: true }),
    );
  }
  get w(): number {
    return this.ctx.canvas.width;
  }
  get h(): number {
    return this.ctx.canvas.height;
  }
  /** Fill a rounded dark card with a light border. */
  card(fill = 'rgba(30,18,10,0.8)', stroke = '#ffd9a0'): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = fill;
    c.fillRect(0, 0, this.w, this.h);
    c.strokeStyle = stroke;
    c.lineWidth = 6;
    c.strokeRect(3, 3, this.w - 6, this.h - 6);
  }
  text(
    s: string,
    y: number,
    size: number,
    color = '#ffe9c4',
    x = this.w / 2,
  ): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.textAlign = 'center';
    c.font = '700 ' + size + 'px ' + FONT;
    c.fillText(s, x, y);
  }
  commit(): void {
    this.tex.needsUpdate = true;
  }
}
