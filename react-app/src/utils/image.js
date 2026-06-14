export function getImageDimensions(uint8) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([uint8], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read dimensions'));
    };
    img.src = url;
  });
}

export async function freshBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Promisified canvas.toBlob — rejects instead of silently yielding null.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [mime='image/png']
 * @param {number} [quality]   0..1 for lossy formats
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, mime = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`toBlob(${mime}) failed`))),
      mime,
      quality
    );
  });
}

/**
 * Build a soft "feather" alpha mask via the shared ImageMagick chain
 * (shave → black border → blur → level). Shared by the blur tools, the
 * outline tool, and the Spinner's blurred-symbol generator so the edge-fade
 * recipe lives in one place.
 *
 * Requires `window._Magick` (wasm-imagemagick) to be loaded. Pass FRESH bytes
 * — `_Magick.Call` transfers (detaches) the input buffer.
 *
 * @param {Uint8Array} bytes   PNG bytes to derive the mask from
 * @param {number} feather     feather radius in px (shave/border/blur amount)
 * @param {object} [opts]
 * @param {'colorizeWhite'|'alphaExtract'|'asis'} [opts.prep='colorizeWhite']
 *        How to reduce the input to a single channel before feathering:
 *        - 'colorizeWhite': flatten to a solid-white silhouette (full RGBA in)
 *        - 'alphaExtract':  extract the alpha channel first (full RGBA in)
 *        - 'asis':          input is already a single-channel/alpha image
 * @returns {Promise<Blob>} the feathered mask PNG
 */
export async function makeFeatherMask(bytes, feather, { prep = 'colorizeWhite' } = {}) {
  const prepArgs =
    prep === 'colorizeWhite' ? ['-alpha', 'off', '-fill', 'white', '-colorize', '100']
    : prep === 'alphaExtract' ? ['-alpha', 'extract']
    : [];
  const r = await window._Magick.Call(
    [{ name: 'in.png', content: bytes }],
    ['convert', 'in.png', ...prepArgs,
      '-shave', `${feather}x${feather}`, '-bordercolor', 'black', '-border', `${feather}x${feather}`,
      '-blur', `0x${feather}`, '-level', '20%,80%', 'mask.png']
  );
  if (!r || !r.length) throw new Error('Feather mask creation failed');
  return r[0].blob;
}

/**
 * Resample a PNG to exact pixel dimensions via ImageMagick WASM.
 * Requires `window._Magick`. Pass FRESH bytes (the buffer is transferred).
 *
 * @param {Uint8Array} bytes
 * @param {number} w
 * @param {number} h
 * @param {string} [filter='Lanczos']   any ImageMagick resampling filter
 * @returns {Promise<Blob>} the scaled PNG
 */
export async function scaleImageWasm(bytes, w, h, filter = 'Lanczos') {
  const r = await window._Magick.Call(
    [{ name: 'in.png', content: bytes }],
    ['convert', 'in.png', '-filter', filter, '-resize', `${w}x${h}!`, '+repage', 'out.png']
  );
  if (!r || !r.length) throw new Error('Scale failed');
  return r[0].blob;
}
