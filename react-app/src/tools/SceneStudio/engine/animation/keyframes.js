// engine/animation/keyframes.js
//
// Per-property keyframe channels for PNG / pngSequence layers.
//
// A channel is `{ keys: [{ t, v, out }, …] }` where:
//   - `t`   is clip-local seconds (0 <= t <= clip.duration). Keys are
//           always stored sorted by `t`.
//   - `v`   is the property value at that key.
//   - `out` is the easing curve from this key to the NEXT key (spec
//           accepted by `curveEval`). Ignored on the last key.
//
// Hold-in / hold-out semantics: values before the first key clamp to the
// first key's `v`; values after the last key clamp to the last key's `v`.
// No extrapolation. A user who wants "hold from start" doesn't have to
// add an explicit `t=0` key — the clamp covers it.

import { curveEval } from './curves.js';

/** Properties on a PNG / pngSequence layer that can be animated. */
export const CHANNEL_PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];

/** Sub-frame tolerance (≈ 1/240s) for "two keys at the same time". */
export const KEY_EPSILON = 1 / 240;

/**
 * Binary search for the segment containing `t`. Returns index `i` such
 * that `keys[i].t <= t < keys[i+1].t`. Caller guarantees keys.length ≥ 2
 * and that `t` is strictly inside the range.
 */
function findSegment(keys, t) {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Evaluate a channel at clip-local time `t`. Returns `null` when the
 * channel has no keys (caller should leave the base value in place).
 */
export function evalChannel(channel, t) {
  const keys = channel?.keys;
  if (!keys || keys.length === 0) return null;
  if (keys.length === 1) return keys[0].v;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  const i = findSegment(keys, t);
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 1e-6) return b.v;
  const p = (t - a.t) / span;
  const eased = curveEval(a.out || 'linear', p);
  return a.v + (b.v - a.v) * eased;
}

/**
 * Insert or update a key at `t` with value `v`. Returns a new channel.
 *
 *   - If a key already exists within `eps` of `t`, its `v` is updated
 *     in place and `out` is preserved (so editing a held value never
 *     resets the curve).
 *   - Otherwise a fresh key is inserted. Its `out` defaults to
 *     `opts.out` (or `"linear"`), and the **previous** key's `out`
 *     is preserved (so the curve into the new key matches what was
 *     there before).
 */
export function insertOrUpdateKey(channel, t, v, opts = {}) {
  const eps = opts.eps ?? KEY_EPSILON;
  const defaultOut = opts.out || 'linear';
  const keys = channel?.keys ? channel.keys.slice() : [];

  for (let i = 0; i < keys.length; i++) {
    if (Math.abs(keys[i].t - t) <= eps) {
      keys[i] = { ...keys[i], v };
      return { keys };
    }
  }

  let insertAt = keys.findIndex((k) => k.t > t);
  if (insertAt === -1) insertAt = keys.length;
  keys.splice(insertAt, 0, { t, v, out: defaultOut });
  keys.sort((a, b) => a.t - b.t);
  return { keys };
}

/** Remove the key at index `idx`. Returns a new channel (no mutation). */
export function removeKey(channel, idx) {
  const keys = (channel?.keys || []).slice();
  if (idx >= 0 && idx < keys.length) keys.splice(idx, 1);
  return { keys };
}

/** Update the `out` curve spec on a single key. Last key's `out` is ignored. */
export function setKeyOut(channel, idx, out) {
  const keys = (channel?.keys || []).slice();
  if (idx >= 0 && idx < keys.length) keys[idx] = { ...keys[idx], out };
  return { keys };
}

/** Set a key's value. */
export function setKeyValue(channel, idx, v) {
  const keys = (channel?.keys || []).slice();
  if (idx >= 0 && idx < keys.length) keys[idx] = { ...keys[idx], v };
  return { keys };
}

/** Move a key's `t`, re-sorting keys afterwards. */
export function moveKeyTime(channel, idx, newT) {
  const keys = (channel?.keys || []).slice();
  if (idx < 0 || idx >= keys.length) return { keys };
  keys[idx] = { ...keys[idx], t: Math.max(0, newT) };
  keys.sort((a, b) => a.t - b.t);
  return { keys };
}

/**
 * Clip-local seconds for a scene time, honouring loop + speed. Matches
 * the math used by Spine track-time seeking so PNG channels and Spine
 * animations stay in sync inside the same clip.
 */
export function clipLocalSeconds(clip, sceneTime) {
  const dur = Math.max(0.001, Number(clip.duration) || 0);
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0
    ? Number(clip.speed)
    : 1;
  let local = Math.max(0, sceneTime - clip.start) * speed;
  if (clip.loop) local = local % dur;
  else local = Math.min(local, dur);
  return local;
}
