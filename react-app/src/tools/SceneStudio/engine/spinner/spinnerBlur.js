// Blurred-symbol generation for the Spinner (Phase 5, SPINNER.md §4 step ④).
// Ported from the retired SlotMachineTool's makeBlurWasm: a 5-step ImageMagick
// WASM chain (motion blur → feather mask → alpha extract → alpha multiply →
// CopyOpacity composite) that yields a vertically motion-blurred symbol with
// soft transparent edges. Falls back to a canvas "stacked ghost" approximation
// when Magick WASM is not loaded.

import { freshBytes, makeFeatherMask } from '../../../../utils/image.js';

function renderSymbolToCell(img, cellW, cellH, symScale) {
  const tmp = document.createElement('canvas');
  tmp.width = cellW; tmp.height = cellH;
  const tctx = tmp.getContext('2d');
  const sw = img.naturalWidth * symScale, sh = img.naturalHeight * symScale;
  tctx.drawImage(img, cellW / 2 - sw / 2, cellH / 2 - sh / 2, sw, sh);
  return tmp;
}

// A motion-blurred symbol reads as a soft streak regardless of source
// resolution — nobody can tell the blur pass ran on a downsampled image, but
// every step of the WASM chain (and the canvas fallback's N-times redraw)
// costs roughly proportional to pixel count, so blurring at 1/4 size is
// dramatically cheaper (1/16th the pixels) for a visually indistinguishable
// result. The output PNG stays at the downsampled size — the spinner runtime
// (`spinnerRuntime.js`) scales the blur sprite up to match the static
// sprite's size at render time, comparing actual texture dimensions, so
// nothing here needs to re-upsample before returning.
const BLUR_DOWNSAMPLE = 4;

function downsampleCanvas(canvas, factor) {
  const w = Math.max(1, Math.round(canvas.width / factor));
  const h = Math.max(1, Math.round(canvas.height / factor));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, w, h);
  return out;
}

function canvasToPngBytes(canvas) {
  return new Promise((res) => {
    canvas.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png');
  });
}

/**
 * WASM path, low-level: directionally motion-blurs an arbitrary source
 * canvas (vertical, matching a slot reel's scroll axis) — same 5-step chain
 * as the module header describes. Requires window._Magick (wasm-imagemagick).
 * Shared by the static-symbol pipeline below AND the T7 animOnly symbols'
 * runtime blur bake (`spinnerRuntime.bakeSpinePoseTexture`) so both symbol
 * kinds get the identical blur style instead of two different algorithms.
 * @returns {Promise<Blob>} PNG blob, same dimensions as `canvas`.
 */
export async function blurCanvasWasm(canvas, sigma, feather) {
  const uint8 = await canvasToPngBytes(canvas);
  const blurArg = `0x${sigma}+90`;

  const r1 = await window._Magick.Call(
    [{ name: 'input.png', content: uint8 }],
    ['convert', 'input.png', '-motion-blur', blurArg, 'blurred.png']
  );
  if (!r1 || !r1.length) throw new Error('Motion blur failed');
  const blurred = r1[0].blob;

  const mask = await makeFeatherMask(await freshBytes(blurred), feather);

  const r3 = await window._Magick.Call(
    [{ name: 'blurred.png', content: await freshBytes(blurred) }],
    ['convert', 'blurred.png', '-alpha', 'extract', 'orig_alpha.png']
  );
  if (!r3 || !r3.length) throw new Error('Alpha extract failed');
  const alpha = r3[0].blob;

  const r4 = await window._Magick.Call(
    [{ name: 'orig_alpha.png', content: await freshBytes(alpha) }, { name: 'mask.png', content: await freshBytes(mask) }],
    ['convert', 'orig_alpha.png', 'mask.png', '-compose', 'Multiply', '-composite', 'combined_alpha.png']
  );
  if (!r4 || !r4.length) throw new Error('Alpha multiply failed');
  const cAlpha = r4[0].blob;

  const r5 = await window._Magick.Call(
    [{ name: 'blurred.png', content: await freshBytes(blurred) }, { name: 'combined_alpha.png', content: await freshBytes(cAlpha) }],
    ['convert', 'blurred.png', 'combined_alpha.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'output.png']
  );
  if (!r5 || !r5.length) throw new Error('Final composite failed');

  return r5[0].blob;
}

/**
 * Canvas fallback, low-level: approximates vertical motion blur by stacking
 * an arbitrary source canvas N times along Y at low alpha. Cheaper-looking
 * than the WASM chain but keeps things usable when Magick isn't loaded.
 * @returns {Promise<Blob>} PNG blob, same dimensions as `canvas`.
 */
export async function blurCanvasFallback(canvas, sigma) {
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext('2d');
  const span = Math.max(4, sigma * 1.6);          // vertical smear extent in px
  const steps = Math.max(8, Math.round(span / 2));
  ctx.globalAlpha = 1.6 / steps;
  for (let i = 0; i < steps; i++) {
    const dy = (i / (steps - 1) - 0.5) * span;
    ctx.drawImage(canvas, 0, dy);
  }
  ctx.globalAlpha = 1;
  return new Promise((res) => out.toBlob(res, 'image/png'));
}

/**
 * Shared downsample-then-blur step: takes an ALREADY-RENDERED arbitrary
 * canvas — a static symbol drawn into a cell (below) or a Spine idle pose
 * captured live off the viewport renderer (`spinnerRuntime.js` /
 * `PixiViewport.bakeSpinePosePng`) — and runs the identical
 * downsample-then-blur pipeline regardless of source: WASM chain when
 * available, canvas ghost fallback otherwise. This is the ONE place both
 * symbol kinds (static art and animations-only) get their blur from, so they
 * can never visually diverge and both get the same 16x pixel-count speedup.
 * @returns {Promise<Blob>} PNG blob, downsampled `BLUR_DOWNSAMPLE`x from
 *   `canvas` — callers scale the result back up at display/export time.
 */
export async function blurRenderedCanvas(canvas, sigma, feather) {
  const small = downsampleCanvas(canvas, BLUR_DOWNSAMPLE);
  // Same absolute streak length relative to the (now smaller) image — sigma
  // is a pixel radius, so it must shrink with the image or the blur would
  // look BLUR_DOWNSAMPLE× stronger once the runtime scales the result back up.
  const dsSigma = Math.max(1, Math.round(sigma / BLUR_DOWNSAMPLE));
  const dsFeather = Math.max(0, Math.round(feather / BLUR_DOWNSAMPLE));
  return window._Magick
    ? blurCanvasWasm(small, dsSigma, dsFeather)
    : blurCanvasFallback(small, dsSigma);
}

/**
 * Preferred entry point for STATIC symbol art: renders the source image into
 * a cell-sized canvas, then runs it through `blurRenderedCanvas`.
 * @returns {Promise<Blob>} PNG blob, downsampled `BLUR_DOWNSAMPLE`x from
 *   cellW × cellH — the spinner runtime scales the resulting texture back up
 *   to match the static texture's size, so callers don't need to care.
 */
export async function makeBlurredSymbol(img, cellW, cellH, symScale, sigma, feather) {
  return blurRenderedCanvas(renderSymbolToCell(img, cellW, cellH, symScale), sigma, feather);
}
