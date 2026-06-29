// engine/mp4Export.js
//
// MP4 (H.264) export fallback via ffmpeg.wasm. Used only when the browser's
// MediaRecorder can't natively produce MP4 (Chrome/Firefox); Safari records MP4
// directly and never touches this.
//
// The small @ffmpeg/ffmpeg + @ffmpeg/util JS is bundled (so Vite resolves the
// internal Web Worker URL correctly — importing it from a CDN makes load() hang
// forever because the worker can't fetch its own module cross-origin). Only the
// large wasm CORE is fetched from CDN at runtime, so the app bundle stays small.
// This whole module is dynamically imported, so even that JS only loads when an
// MP4 fallback actually runs.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const LOAD_TIMEOUT_MS = 60_000;

let _ffmpegPromise = null;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Lazily create the FFmpeg instance + load the wasm core from CDN. */
async function getFfmpeg(onLog) {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
    let coreURL, wasmURL;
    try {
      // Same-origin blob URLs so the worker can load them without CORS issues.
      coreURL = await withTimeout(toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        LOAD_TIMEOUT_MS, 'Timed out downloading the MP4 encoder core from CDN.');
      wasmURL = await withTimeout(toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
        LOAD_TIMEOUT_MS, 'Timed out downloading the MP4 encoder wasm from CDN.');
    } catch (err) {
      _ffmpegPromise = null;
      throw new Error(`Could not fetch the MP4 encoder (ffmpeg.wasm) from CDN: ${err.message}`);
    }
    try {
      await withTimeout(ffmpeg.load({ coreURL, wasmURL }), LOAD_TIMEOUT_MS,
        'The MP4 encoder failed to initialize (worker did not start).');
    } catch (err) {
      _ffmpegPromise = null;
      throw err;
    }
    return ffmpeg;
  })();
  return _ffmpegPromise;
}

/** True when an MP4 fallback can at least attempt to run. */
export function isMp4FallbackPossible() {
  return typeof WebAssembly !== 'undefined';
}

/**
 * Encode an ordered array of PNG frames into an H.264 MP4 Blob.
 *
 * @param {Uint8Array[]} frames    PNG bytes, one per frame
 * @param {object} o
 * @param {number} o.fps
 * @param {number} [o.crf]         x264 quality (0=lossless … 51); ~18-26 sensible
 * @param {(p:{phase:string})=>void} [o.onProgress]
 * @param {(msg:string)=>void} [o.onLog]
 * @param {{aborted:boolean}} [o.signal]
 * @returns {Promise<Blob>} video/mp4
 */
export async function encodeFramesToMp4(frames, { fps, crf = 22, onProgress, onLog, signal } = {}) {
  if (!frames?.length) throw new Error('No frames to encode.');
  onProgress?.({ phase: 'loading encoder (CDN)' });
  const ffmpeg = await getFfmpeg(onLog);
  if (signal?.aborted) throw new Error('cancelled');

  const names = [];
  onProgress?.({ phase: 'writing frames' });
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    const name = `f${String(i).padStart(5, '0')}.png`;
    // eslint-disable-next-line no-await-in-loop
    await ffmpeg.writeFile(name, frames[i]);
    frames[i] = null; // release the JS-side copy; it now lives in ffmpeg's FS
    names.push(name);
  }

  onProgress?.({ phase: 'encoding 0%' });
  // ffmpeg.exec is silent; surface its progress ratio so the UI isn't "stuck".
  const progHandler = onProgress
    ? ({ progress }) => onProgress({ phase: `encoding ${Math.max(0, Math.min(100, Math.round((progress || 0) * 100)))}%` })
    : null;
  if (progHandler) ffmpeg.on('progress', progHandler);
  try {
    await ffmpeg.exec([
      '-framerate', String(Math.max(1, Math.round(fps))),
      '-i', 'f%05d.png',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', String(Math.max(0, Math.min(51, Math.round(crf)))),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      'out.mp4'
    ]);
  } finally {
    if (progHandler) ffmpeg.off('progress', progHandler);
  }
  if (signal?.aborted) throw new Error('cancelled');

  const data = await ffmpeg.readFile('out.mp4');
  try {
    for (const n of names) await ffmpeg.deleteFile(n);
    await ffmpeg.deleteFile('out.mp4');
  } catch { /* ignore */ }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new Blob([bytes], { type: 'video/mp4' });
}
