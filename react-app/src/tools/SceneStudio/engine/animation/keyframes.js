// engine/animation/keyframes.js
//
// Per-channel keyframe animation for PNG / pngSequence layers.
//
// We model three LOGICAL channels — `position`, `scale`, `rotation`.
// `position` and `scale` carry vec2 values (so the user drags the sprite
// once and authors a single key for both x and y, with one shared `out`
// curve). `rotation` is scalar.
//
// A channel is `{ keys: [{ t, v, out }, …] }` where:
//   - `t`   is clip-local seconds (0 <= t <= clip.duration). Always sorted.
//   - `v`   is either a number (rotation) or `{ x: number, y: number }`
//           (position, scale).
//   - `out` is the easing curve from this key to the NEXT key (a spec
//           accepted by `curveEval`). Ignored on the last key.
//
// Hold-in / hold-out: values before the first key clamp to the first
// key's `v`; values after the last key clamp to the last key's `v`. No
// extrapolation. The interpreter also evaluates channels for `t` past
// the clip's end so the sprite holds its last keyframe value instead of
// snapping back to base pose — see `pixiApp.applyPngChannels`.

import { curveEval } from './curves.js';

/**
 * Logical channel definitions. Each entry says how the channel's value
 * maps onto Pixi sprite props and whether keys carry a scalar or vec2.
 */
export const CHANNEL_DEFS = {
  position: {
    layout: 'vec2',
    label: 'position',
    components: ['x', 'y'],
    // How the eval result is written to a Pixi container.
    apply: (obj, v) => { obj.x = v.x; obj.y = v.y; }
  },
  scale: {
    layout: 'vec2',
    label: 'scale',
    components: ['x', 'y'],
    apply: (obj, v) => { if (obj.scale?.set) obj.scale.set(v.x, v.y); }
  },
  rotation: {
    layout: 'scalar',
    label: 'rotation',
    components: null,
    apply: (obj, v) => { obj.rotation = v; }
  }
};

export const CHANNEL_NAMES = ['position', 'scale', 'rotation'];

/**
 * Map a sprite-level transform prop (the keys of the patch object that
 * `handlePatchTransform` receives) onto its logical channel + component.
 * Component is null for scalar channels.
 */
export const SPRITE_PROP_TO_CHANNEL = {
  x:        { channel: 'position', component: 'x' },
  y:        { channel: 'position', component: 'y' },
  scaleX:   { channel: 'scale',    component: 'x' },
  scaleY:   { channel: 'scale',    component: 'y' },
  rotation: { channel: 'rotation', component: null }
};

/** Sub-frame tolerance (~ 1/240s) for "two keys at the same time". */
export const KEY_EPSILON = 1 / 240;

// ── Channel value helpers ─────────────────────────────────────────────

function isVec2(v) {
  return v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number';
}

function cloneValue(v) {
  if (typeof v === 'number') return v;
  if (isVec2(v)) return { x: v.x, y: v.y };
  return v;
}

function lerpValue(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (isVec2(a) && isVec2(b)) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return cloneValue(b);
}

/**
 * Read the layout of a channel by name. Returns 'vec2' or 'scalar'.
 * Unknown channels are treated as scalar (safe default).
 */
export function channelLayout(name) {
  return CHANNEL_DEFS[name]?.layout || 'scalar';
}

/**
 * Build a default value for a channel. Used by auto-key when a channel
 * does not yet exist and a patch only sets one component.
 */
export function defaultValueForChannel(name) {
  if (channelLayout(name) === 'vec2') return { x: 0, y: 0 };
  return 0;
}

/**
 * Compose a vec2 value by merging a partial patch into a current value.
 * Used by auto-key when the user changes only one component of a vec2
 * channel (e.g. dragging `x` only) — the missing component is read from
 * the channel's current value at the playhead so we don't clobber it.
 */
export function composeVec2Value(current, patchComponents) {
  const c = isVec2(current) ? current : { x: 0, y: 0 };
  return {
    x: typeof patchComponents.x === 'number' ? patchComponents.x : c.x,
    y: typeof patchComponents.y === 'number' ? patchComponents.y : c.y
  };
}

// ── Segment lookup + eval ─────────────────────────────────────────────

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
 * Evaluate a channel at clip-local time `t`. Returns the channel's value
 * (number or `{ x, y }`). Returns `null` when the channel has no keys.
 */
export function evalChannel(channel, t) {
  const keys = channel?.keys;
  if (!keys || keys.length === 0) return null;
  if (keys.length === 1) return cloneValue(keys[0].v);
  if (t <= keys[0].t) return cloneValue(keys[0].v);
  const last = keys[keys.length - 1];
  if (t >= last.t) return cloneValue(last.v);
  const i = findSegment(keys, t);
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 1e-6) return cloneValue(b.v);
  const p = (t - a.t) / span;
  const eased = curveEval(a.out || 'linear', p);
  return lerpValue(a.v, b.v, eased);
}

// ── Mutation helpers ─────────────────────────────────────────────────

/**
 * Insert or update a key at `t` with value `v`. Returns a new channel.
 *
 * - If a key already exists within `eps` of `t`, its `v` is updated.
 *   Its `out` is preserved so editing a value never resets the curve.
 * - Otherwise a new key is inserted with `out = opts.out || 'linear'`.
 *
 * `v` may be a number or `{ x, y }` — the caller is responsible for
 * matching the channel's layout.
 */
export function insertOrUpdateKey(channel, t, v, opts = {}) {
  const eps = opts.eps ?? KEY_EPSILON;
  const defaultOut = opts.out || 'linear';
  const keys = channel?.keys ? channel.keys.slice() : [];

  for (let i = 0; i < keys.length; i++) {
    if (Math.abs(keys[i].t - t) <= eps) {
      keys[i] = { ...keys[i], v: cloneValue(v) };
      return { keys };
    }
  }

  let insertAt = keys.findIndex((k) => k.t > t);
  if (insertAt === -1) insertAt = keys.length;
  keys.splice(insertAt, 0, { t, v: cloneValue(v), out: defaultOut });
  keys.sort((a, b) => a.t - b.t);
  return { keys };
}

export function removeKey(channel, idx) {
  const keys = (channel?.keys || []).slice();
  if (idx >= 0 && idx < keys.length) keys.splice(idx, 1);
  return { keys };
}

export function setKeyOut(channel, idx, out) {
  const keys = (channel?.keys || []).slice();
  if (idx >= 0 && idx < keys.length) keys[idx] = { ...keys[idx], out };
  return { keys };
}

export function setKeyValue(channel, idx, v) {
  const keys = (channel?.keys || []).slice();
  if (idx >= 0 && idx < keys.length) keys[idx] = { ...keys[idx], v: cloneValue(v) };
  return { keys };
}

/** Set one component of a vec2 key. Scalar channels ignore `component`. */
export function setKeyComponent(channel, idx, component, value) {
  const keys = (channel?.keys || []).slice();
  if (idx < 0 || idx >= keys.length) return { keys };
  const k = keys[idx];
  if (isVec2(k.v) && component) {
    keys[idx] = { ...k, v: { ...k.v, [component]: value } };
  } else if (typeof k.v === 'number') {
    keys[idx] = { ...k, v: value };
  }
  return { keys };
}

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
 *
 * When `clampPastEnd` is true, times past `clip.duration` are clamped to
 * the duration — so the interpreter can keep evaluating the channel past
 * the clip's end and naturally hold the last keyframe value.
 */
export function clipLocalSeconds(clip, sceneTime, opts = {}) {
  const dur = Math.max(0.001, Number(clip.duration) || 0);
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0
    ? Number(clip.speed)
    : 1;
  let local = Math.max(0, sceneTime - clip.start) * speed;
  if (clip.loop) local = local % dur;
  else if (opts.clampPastEnd) local = Math.min(local, dur);
  else local = Math.min(local, dur);
  return local;
}
