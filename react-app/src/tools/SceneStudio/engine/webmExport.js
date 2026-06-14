// Deterministic WebM capture for Scene Studio.
//
// MediaRecorder timestamps frames by wall-clock, so we drive a deterministic
// render loop (one render per frame at t = i/fps) but PACE it to real time
// (1000/fps ms per frame). As long as a frame renders inside its budget the
// resulting clip has the correct duration; if a render is slow the clip
// stretches rather than dropping frames — content stays correct and ordered.
//
// Frames are pushed manually via canvas.captureStream(0) + track.requestFrame()
// so the recorder samples exactly the deterministic render, not whatever the
// live editor happens to be showing.

const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

/** First WebM mime this browser's MediaRecorder can produce, or null. */
export function pickWebmMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  return WEBM_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

/** True when this browser can record a canvas to WebM at all (Chrome/Firefox). */
export function isWebmExportSupported(canvas) {
  return !!(canvas && typeof canvas.captureStream === 'function' && pickWebmMime());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Record `frameCount` deterministic frames from a canvas into a WebM Blob.
 *
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas       source canvas (its backing store is captured)
 * @param {number} o.frameCount
 * @param {number} o.fps
 * @param {string} o.mimeType                from pickWebmMime()
 * @param {number} [o.bitrate]               videoBitsPerSecond
 * @param {(t:number, i:number)=>void} o.renderFrame   render the scene at scene-time t = i/fps
 * @param {(p:{frame:number,total:number})=>void} [o.onProgress]
 * @param {{aborted:boolean}} [o.signal]     cooperative cancel flag
 * @returns {Promise<Blob>}
 */
export async function recordCanvasFrames({
  canvas, frameCount, fps, mimeType, bitrate, renderFrame, onProgress, signal
}) {
  if (!canvas || typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas capture is not supported in this browser.');
  }
  if (!mimeType) throw new Error('This browser cannot record WebM. Try Chrome or Firefox.');

  const stream = canvas.captureStream(0); // 0 fps → we push frames manually
  const track = stream.getVideoTracks()[0];
  const pushFrame = () => {
    if (track && typeof track.requestFrame === 'function') track.requestFrame();
    else if (typeof stream.requestFrame === 'function') stream.requestFrame();
  };

  const recorder = new MediaRecorder(stream, {
    mimeType,
    ...(bitrate ? { videoBitsPerSecond: bitrate } : {})
  });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(e?.error || new Error('MediaRecorder error'));
  });

  const frameMs = 1000 / fps;
  let cancelled = false;

  recorder.start();
  await sleep(0); // let the recorder come up before the first frame

  const startWall = performance.now();
  try {
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) { cancelled = true; break; }
      renderFrame(i / fps, i);
      pushFrame();
      onProgress?.({ frame: i + 1, total: frameCount });
      // Pace to wall-clock so the recorder's timestamps yield correct duration.
      const target = startWall + (i + 1) * frameMs;
      const wait = target - performance.now();
      if (wait > 4) await sleep(wait);
    }
    // Hold the final frame for one frame-duration so it isn't zero-length.
    await sleep(frameMs);
  } finally {
    try { recorder.stop(); } catch { /* already stopped */ }
    try { track?.stop?.(); } catch { /* ignore */ }
  }

  await stopped;
  if (cancelled) throw new Error('cancelled');
  return new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' });
}
