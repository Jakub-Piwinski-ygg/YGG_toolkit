// engine/winseq/winNumberView.js
//
// Pixi v8 view for the Win-Sequence count-up NUMBER. Slices a single bitmap-font
// atlas (8×8 grid, 256px/cell by default) into per-glyph sub-textures sharing
// one TextureSource, and lays a formatted string out as a pooled row of centered
// glyph sprites. No animation / no bone math here — that lives in the runtime.

import { Container, Sprite, Texture, Rectangle } from 'pixi.js';

/** index → glyph sub-Texture (row-major: col = i % cols, row = floor(i / cols)). */
export function buildGlyphTextures(source, num) {
  const { cell, cols, charLayout } = num;
  const map = new Map();
  for (let i = 0; i < charLayout.length; i++) {
    const ch = charLayout[i];
    if (map.has(ch)) continue; // first occurrence wins
    const col = i % cols;
    const row = Math.floor(i / cols);
    map.set(ch, new Texture({ source, frame: new Rectangle(col * cell, row * cell, cell, cell) }));
  }
  return map;
}

/**
 * Build the number Container. `root.setText(str)` re-lays the string each frame
 * (cheap — the runtime only calls it when the string actually changes).
 */
export function buildWinNumberContainer(source, num) {
  const root = new Container();
  root.__glyphs = buildGlyphTextures(source, num);
  root.__pool = [];
  root.__num = num;
  root.setText = (str) => layoutWinNumber(root, str);
  root.setText('0');
  return root;
}

/**
 * Lay `str` out as glyph sprites (pooled, reused across frames). Fixed-cell
 * advance + a global letterSpacing handles the proportional typeface without
 * per-glyph trimming. Centered on the container origin by default so the bone
 * follow places the number's midpoint on the bone.
 */
export function layoutWinNumber(root, str) {
  const num = root.__num;
  const glyphW = num.cell * num.glyphScale;
  const advance = glyphW + num.letterSpacing;
  const spaceAdvance = advance * 0.5;

  const ensure = (i) => {
    let spr = root.__pool[i];
    if (!spr) {
      spr = new Sprite();
      spr.anchor.set(0.5);
      root.addChild(spr);
      root.__pool[i] = spr;
    }
    return spr;
  };

  let x = 0;
  let used = 0;
  for (const ch of String(str)) {
    if (ch === ' ') { x += spaceAdvance; continue; }
    const tex = root.__glyphs.get(ch);
    if (!tex) { x += advance; continue; } // unknown glyph keeps spacing predictable
    const spr = ensure(used);
    spr.texture = tex;
    spr.visible = true;
    spr.scale.set(num.glyphScale);
    spr.x = x + glyphW / 2;
    spr.y = num.baselineOffset;
    x += advance;
    used++;
  }
  // hide surplus pooled sprites
  for (let i = used; i < root.__pool.length; i++) root.__pool[i].visible = false;

  // alignment — `x` is the total advanced width
  const shift = num.align === 'center' ? -x / 2 : num.align === 'right' ? -x : 0;
  if (shift) for (let i = 0; i < used; i++) root.__pool[i].x += shift;
}
