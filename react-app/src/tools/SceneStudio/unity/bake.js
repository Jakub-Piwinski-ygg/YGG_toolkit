// Bake Scene Studio timeline animation into plain per-property key arrays.
//
// Every curve form (presets, cubic-bezier, custom points, per-key tangents,
// path-mode position) is handled by sampling through the engine's own
// evalChannel() at a fixed fps — guaranteed visual parity with the studio
// preview, at the cost of dense keys. Redundant intermediate samples on
// perfectly-linear segments are pruned afterwards.
//
// Output values stay in Scene-Studio space (pixels, y-down, radians).
// Space conversion to Unity happens in animClip.js / prefab.js.

import { evalChannel, clipLocalSeconds } from '../engine/animation/keyframes.js';
import { tracksForLayer } from '../engine/sceneModel.js';

const PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'alpha'];

function baseValues(transform) {
  return {
    x: transform?.x ?? 0,
    y: transform?.y ?? 0,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    alpha: typeof transform?.alpha === 'number' ? transform.alpha : 1
  };
}

/** Find the clip governing scene-time t (latest-started clip that has begun). */
function activeClipAt(clips, t) {
  let active = null;
  for (const c of clips) {
    if (c.start <= t && (!active || c.start >= active.start)) active = c;
  }
  return active;
}

function sampleClip(clip, sceneTime, base, prev) {
  const local = clipLocalSeconds(clip, sceneTime, { clampPastEnd: true });
  const ch = clip.channels || {};
  const out = { ...prev };
  const pos = ch.position ? evalChannel(ch.position, local, 'position') : null;
  if (pos) { out.x = pos.x; out.y = pos.y; }
  const scale = ch.scale ? evalChannel(ch.scale, local, 'scale') : null;
  if (scale) { out.scaleX = scale.x; out.scaleY = scale.y; }
  const rot = ch.rotation ? evalChannel(ch.rotation, local, 'rotation') : null;
  if (rot != null) out.rotation = rot;
  const alpha = ch.alpha ? evalChannel(ch.alpha, local, 'alpha') : null;
  if (alpha != null) out.alpha = alpha;
  return out;
}

/** Drop middle keys that sit exactly on the line between neighbours. */
function pruneLinear(keys, epsilon = 1e-4) {
  if (keys.length <= 2) return keys;
  const out = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = out[out.length - 1];
    const b = keys[i];
    const c = keys[i + 1];
    const span = c.t - a.t;
    if (span <= 1e-9) continue;
    const expect = a.v + (c.v - a.v) * ((b.t - a.t) / span);
    if (Math.abs(expect - b.v) > epsilon) out.push(b);
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/**
 * Bake one layer. Returns { animated: boolean, props: { x: [{t,v}], … } }.
 * Props with no animation come back as empty arrays.
 *
 * @param {object} scene
 * @param {object} layer
 * @param {'landscape'|'portrait'} orientation
 * @param {number} fps        bake sampling rate
 */
export function bakeLayer(scene, layer, orientation, fps = 30) {
  const duration = Math.max(0.05, Number(scene.stage?.duration) || 5);
  const transform = orientation === 'portrait'
    ? (layer.transforms?.portrait ?? layer.transforms?.landscape)
    : layer.transforms?.landscape;
  const base = baseValues(transform);

  const clips = tracksForLayer(scene, layer.id)
    .flatMap((tr) => tr.clips || [])
    .filter((c) => c.channels && Object.keys(c.channels).length);
  if (!clips.length) {
    return { animated: false, base, props: Object.fromEntries(PROPS.map((p) => [p, []])) };
  }

  const step = 1 / Math.max(1, fps);
  const samples = [];
  let prev = { ...base };
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const time = Math.min(t, duration);
    const clip = activeClipAt(clips, time);
    prev = clip ? sampleClip(clip, time, base, prev) : prev;
    samples.push({ t: time, v: { ...prev } });
    if (time >= duration) break;
  }
  // Make clip boundaries exact: add samples at every clip start.
  for (const c of clips) {
    if (c.start > 0 && c.start < duration && !samples.some((s) => Math.abs(s.t - c.start) < 1e-6)) {
      const clip = activeClipAt(clips, c.start);
      const v = clip ? sampleClip(clip, c.start, base, base) : base;
      samples.push({ t: c.start, v });
    }
  }
  samples.sort((a, b) => a.t - b.t);

  const props = {};
  let animated = false;
  for (const p of PROPS) {
    const keys = pruneLinear(samples.map((s) => ({ t: s.t, v: s.v[p] })),
      p === 'alpha' ? 1e-4 : (p.startsWith('scale') ? 1e-4 : 5e-3));
    const constant = keys.every((k) => Math.abs(k.v - keys[0].v) < 1e-6);
    props[p] = constant ? [] : keys;
    if (!constant) animated = true;
  }
  return { animated, base, props };
}

/**
 * Collect spine animation cues for a layer's clips — consumed by the
 * generated YggScenePlayer (and the editor Timeline builder).
 */
export function spineCuesForLayer(scene, layer) {
  if (!layer.spine) return [];
  const cues = [];
  for (const tr of tracksForLayer(scene, layer.id)) {
    for (const clip of tr.clips || []) {
      if (!clip.anim) continue;
      cues.push({
        layerId: layer.id,
        anim: clip.anim,
        start: clip.start,
        duration: clip.duration,
        speed: clip.speed ?? 1,
        loop: clip.loop !== false,
        mixDuration: clip.mixDuration
      });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}
