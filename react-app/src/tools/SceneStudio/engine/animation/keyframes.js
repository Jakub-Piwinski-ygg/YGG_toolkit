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
 * Pack three 0..1 RGB floats into a single 0xRRGGBB Pixi tint value.
 * Clamps each channel and rounds to the nearest integer.
 */
function packRgbToTint(v) {
  const r = Math.max(0, Math.min(255, Math.round((v.r ?? 1) * 255)));
  const g = Math.max(0, Math.min(255, Math.round((v.g ?? 1) * 255)));
  const b = Math.max(0, Math.min(255, Math.round((v.b ?? 1) * 255)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Logical channel definitions. Each entry says how the channel's value
 * maps onto Pixi sprite props and whether keys carry a scalar / vec2 /
 * vec3 (rgb).
 */
export const CHANNEL_DEFS = {
  position: {
    layout: 'vec2',
    label: 'position',
    components: ['x', 'y'],
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
  },
  alpha: {
    layout: 'scalar',
    label: 'alpha',
    components: null,
    apply: (obj, v) => { obj.alpha = Math.max(0, Math.min(1, v)); }
  },
  tint: {
    layout: 'rgb',
    label: 'tint',
    components: ['r', 'g', 'b'],
    apply: (obj, v) => {
      // Pixi v8 Sprite and Spine container both accept obj.tint as a
      // uint24 RGB value. Spine 4.2 also exposes .skeleton.color.{r,g,b}
      // but Container.tint already routes through the renderer's
      // batch tint, so use that for parity.
      try { obj.tint = packRgbToTint(v); } catch { /* ignore */ }
    }
  }
};

export const CHANNEL_NAMES = ['position', 'scale', 'rotation', 'alpha', 'tint'];

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
  rotation: { channel: 'rotation', component: null },
  alpha:    { channel: 'alpha',    component: null },
  tintR:    { channel: 'tint',     component: 'r' },
  tintG:    { channel: 'tint',     component: 'g' },
  tintB:    { channel: 'tint',     component: 'b' }
};

/** Sub-frame tolerance (~ 1/240s) for "two keys at the same time". */
export const KEY_EPSILON = 1 / 240;

// ── Channel value helpers ─────────────────────────────────────────────

function isVec2(v) {
  return v && typeof v === 'object'
    && typeof v.x === 'number' && typeof v.y === 'number'
    && typeof v.r !== 'number';
}
function isRgb(v) {
  return v && typeof v === 'object'
    && typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number';
}

function cloneValue(v) {
  if (typeof v === 'number') return v;
  if (isVec2(v)) return { x: v.x, y: v.y };
  if (isRgb(v))  return { r: v.r, g: v.g, b: v.b };
  return v;
}

function lerpValue(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (isVec2(a) && isVec2(b)) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  if (isRgb(a) && isRgb(b)) {
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    };
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
  const layout = channelLayout(name);
  if (layout === 'vec2') return { x: 0, y: 0 };
  if (layout === 'rgb')  return { r: 1, g: 1, b: 1 };
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

/** Compose a vec3 (rgb) value the same way `composeVec2Value` works. */
export function composeRgbValue(current, patchComponents) {
  const c = isRgb(current) ? current : { r: 1, g: 1, b: 1 };
  return {
    r: typeof patchComponents.r === 'number' ? patchComponents.r : c.r,
    g: typeof patchComponents.g === 'number' ? patchComponents.g : c.g,
    b: typeof patchComponents.b === 'number' ? patchComponents.b : c.b
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
 * Evaluate a scalar key list at clip-local time `t`. Returns null if
 * the list is empty. Used both directly for scalar channels and as the
 * per-component evaluator for `channel.split` storage.
 */
export function evalScalarKeys(keys, t) {
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
 * Evaluate a channel at clip-local time `t`. Returns the channel's value
 * (number or `{ x, y }` or `{ r, g, b }`). Returns `null` when the
 * channel has no keys.
 *
 * Two storage shapes are supported:
 *   - Linked (default): `{ keys: [{ t, v, out }] }` — vec2/rgb keys
 *     share a single time + curve.
 *   - Split (`channel.split === true`): `{ split: true, perComp: { x:
 *     { keys }, y: { keys } } }` — each component is an independent
 *     scalar curve. Allows X and Y to have separate timings + easing.
 *
 * `channelName` may be passed so the split branch can decide which
 * component set (x/y vs r/g/b) to expect; it falls back to detecting
 * from `perComp` keys.
 */
export function evalChannel(channel, t, channelName = null) {
  if (channel?.split && channel.perComp) {
    const layout = channelName ? channelLayout(channelName) : null;
    if (layout === 'vec2' || channel.perComp.x || channel.perComp.y) {
      return {
        x: evalScalarKeys(channel.perComp.x?.keys, t) ?? 0,
        y: evalScalarKeys(channel.perComp.y?.keys, t) ?? 0
      };
    }
    if (layout === 'rgb' || channel.perComp.r || channel.perComp.g || channel.perComp.b) {
      return {
        r: evalScalarKeys(channel.perComp.r?.keys, t) ?? 1,
        g: evalScalarKeys(channel.perComp.g?.keys, t) ?? 1,
        b: evalScalarKeys(channel.perComp.b?.keys, t) ?? 1
      };
    }
    return null;
  }
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

/**
 * Convert a linked vec2 / rgb channel into split form. Each component
 * becomes its own scalar key list, preserving the linked key times and
 * `out` curve. Scalar channels are returned unchanged.
 */
export function splitChannel(channel, channelName) {
  if (!channel || channel.split) return channel;
  const layout = channelLayout(channelName);
  const comps = layout === 'vec2' ? ['x', 'y']
    : layout === 'rgb' ? ['r', 'g', 'b']
    : null;
  if (!comps) return channel;
  const keys = channel.keys || [];
  const perComp = {};
  for (const c of comps) {
    perComp[c] = {
      keys: keys.map((k) => ({
        t: k.t,
        v: Number(k.v?.[c] ?? 0),
        out: k.out || 'linear'
      }))
    };
  }
  return { split: true, perComp };
}

/**
 * Convert a split channel back into linked form. Takes the union of
 * key times across all components, evaluates each at every time, and
 * builds vec2/rgb keys. Out-curves come from the first component's key
 * at that time (or 'linear' if none).
 */
export function linkChannel(channel, channelName) {
  if (!channel?.split) return channel;
  const layout = channelLayout(channelName);
  const comps = layout === 'vec2' ? ['x', 'y']
    : layout === 'rgb' ? ['r', 'g', 'b']
    : null;
  if (!comps) return channel;
  const allTimes = new Set();
  for (const c of comps) {
    for (const k of channel.perComp?.[c]?.keys || []) allTimes.add(Number(k.t.toFixed(6)));
  }
  const sorted = [...allTimes].sort((a, b) => a - b);
  if (!sorted.length) return { keys: [] };
  const keys = sorted.map((t) => {
    const v = {};
    for (const c of comps) {
      v[c] = evalScalarKeys(channel.perComp?.[c]?.keys, t) ?? 0;
    }
    // Prefer the X / R key's out curve when it lands exactly on this time;
    // fall back to the first component-key that does.
    let out = 'linear';
    for (const c of comps) {
      const k = channel.perComp?.[c]?.keys?.find((kk) => Math.abs(kk.t - t) < 1e-5);
      if (k?.out) { out = k.out; break; }
    }
    return { t, v, out };
  });
  return { keys };
}

// ── Mutation helpers ─────────────────────────────────────────────────

/**
 * Enumerate a channel's keyframes for DISPLAY (timeline dots, motion
 * path). Returns a flat list of `{ comp, idx, t, v }` entries:
 *   - Linked channels (vec2 / rgb / scalar): one entry per key, comp = null.
 *   - Split channels: one entry per per-component key, comp = 'x' / 'y' /
 *     'r' / 'g' / 'b'. `idx` is the index within that component's list.
 *
 * Used so split channels stop disappearing from the timeline + motion
 * path, which only knew the linked `keys` shape.
 */
export function channelKeyDots(channel) {
  if (!channel) return [];
  if (channel.split && channel.perComp) {
    const out = [];
    for (const comp of Object.keys(channel.perComp)) {
      const keys = channel.perComp[comp]?.keys || [];
      for (let i = 0; i < keys.length; i++) {
        out.push({ comp, idx: i, t: keys[i].t, v: keys[i].v });
      }
    }
    return out;
  }
  const keys = channel.keys || [];
  return keys.map((k, i) => ({ comp: null, idx: i, t: k.t, v: k.v }));
}

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
