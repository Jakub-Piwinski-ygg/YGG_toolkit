// Blurred-symbol generation for the Spinner (Phase 5, SPINNER.md §4 step ④).
// Ported from the retired SlotMachineTool's makeBlurWasm: a 5-step ImageMagick
// WASM chain (motion blur → feather mask → alpha extract → alpha multiply →
// CopyOpacity composite) that yields a vertically motion-blurred symbol with
// soft transparent edges. Falls back to a canvas "stacked ghost" approximation
// when Magick WASM is not loaded.

import { freshBytes } from '../../../../utils/image.js';

function renderSymbolToCell(img, cellW, cellH, symScale) {
  const tmp = document.createElement('canvas');
  tmp.width = cellW; tmp.height = cellH;
  const tctx = tmp.getContext('2d');
  const sw = img.naturalWidth * symScale, sh = img.naturalHeight * symScale;
  tctx.drawImage(img, cellW / 2 - sw / 2, cellH / 2 - sh / 2, sw, sh);
  return tmp;
}

function canvasToPngBytes(canvas) {
  return new Promise((res) => {
    canvas.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png');
  });
}

/**
 * WASM path: returns a PNG Blob of the blurred symbol, same cell dimensions.
 * Requires window._Magick (wasm-imagemagick) to be loaded.
 */
export async function makeBlurredSymbolWasm(img, cellW, cellH, symScale, sigma, feather) {
  const uint8 = await canvasToPngBytes(renderSymbolToCell(img, cellW, cellH, symScale));
  const blurArg = `0x${sigma}+90`;

  const r1 = await window._Magick.Call(
    [{ name: 'input.png', content: uint8 }],
    ['convert', 'input.png', '-motion-blur', blurArg, 'blurred.png']
  );
  if (!r1 || !r1.length) throw new Error('Motion blur failed');
  const blurred = r1[0].blob;

  const r2 = await window._Magick.Call(
    [{ name: 'blurred.png', content: await freshBytes(blurred) }],
    ['convert', 'blurred.png', '-alpha', 'off', '-fill', 'white', '-colorize', '100',
      '-shave', `${feather}x${feather}`, '-bordercolor', 'black', '-border', `${feather}x${feather}`,
      '-blur', `0x${feather}`, '-level', '20%,80%', 'mask.png']
  );
  if (!r2 || !r2.length) throw new Error('Mask failed');
  const mask = r2[0].blob;

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
 * Canvas fallback: approximates vertical motion blur by stacking the symbol
 * N times along Y at low alpha. Cheaper-looking than the WASM chain but
 * keeps the wizard usable when Magick isn't available.
 */
export async function makeBlurredSymbolCanvas(img, cellW, cellH, symScale, sigma) {
  const cell = renderSymbolToCell(img, cellW, cellH, symScale);
  const out = document.createElement('canvas');
  out.width = cellW; out.height = cellH;
  const ctx = out.getContext('2d');
  const span = Math.max(4, sigma * 1.6);          // vertical smear extent in px
  const steps = Math.max(8, Math.round(span / 2));
  ctx.globalAlpha = 1.6 / steps;
  for (let i = 0; i < steps; i++) {
    const dy = (i / (steps - 1) - 0.5) * span;
    ctx.drawImage(cell, 0, dy);
  }
  ctx.globalAlpha = 1;
  return new Promise((res) => out.toBlob(res, 'image/png'));
}

/**
 * Preferred entry point: WASM chain when available, canvas ghost otherwise.
 * @returns {Promise<Blob>} PNG blob, cellW × cellH.
 */
export async function makeBlurredSymbol(img, cellW, cellH, symScale, sigma, feather) {
  if (window._Magick) {
    return makeBlurredSymbolWasm(img, cellW, cellH, symScale, sigma, feather);
  }
  return makeBlurredSymbolCanvas(img, cellW, cellH, symScale, sigma);
}
