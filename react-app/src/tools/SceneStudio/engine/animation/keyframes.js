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

import { curveEval, easingEndpointSlopes, hermite } from './curves.js';
import { getPathSpline } from './pathSpline.js';

// ── Per-key tangent model (P4) ────────────────────────────────────────
//
// In addition to the legacy per-segment easing (`key.out`), a key may
// carry tangent information:
//   - `tm` (tangent mode): 'auto' | 'flat' | 'linear' | 'free' | 'broken'
//   - `ti` / `to` (in / out tangent SLOPES, value-units per second) — same
//     value shape as `v` (number | {x,y} | {r,g,b}). Only consulted for
//     'free' (uses `to`, mirrored to in) and 'broken' (independent ti/to).
//
// A segment between key a and key b is interpolated with a cubic Hermite
// spline when EITHER endpoint declares a tangent mode (`a.tm` or `b.tm`).
// Otherwise it falls back to the legacy easing path (`curveEval(a.out)`),
// so scenes authored before P4 animate exactly as before. When only one
// endpoint of a tangent-driven segment is legacy, that endpoint's slope is
// seeded from its legacy easing curve so the join stays continuous.

export const TANGENT_MODES = ['auto', 'flat', 'linear', 'free', 'broken'];

/** A key participates in the tangent model when it declares a mode. */
export function keyHasTangents(k) {
  return !!k && typeof k.tm === 'string' && TANGENT_MODES.includes(k.tm);
}

/** Extract a scalar component from a key value. comp null/'_' = scalar. */
function compOf(v, comp) {
  if (comp == null || comp === '_') return Number(v) || 0;
  return Number(v?.[comp]) || 0;
}

/** Extract a scalar slope from a key tangent field (ti/to). */
function slopeOf(field, comp) {
  if (field == null) return null;
  if (comp == null || comp === '_') {
    return typeof field === 'number' && Number.isFinite(field) ? field : null;
  }
  const n = Number(field?.[comp]);
  return Number.isFinite(n) ? n : null;
}

function secant(keys, iA, iB, comp) {
  const a = keys[iA];
  const b = keys[iB];
  const dt = b.t - a.t;
  if (Math.abs(dt) < 1e-6) return 0;
  return (compOf(b.v, comp) - compOf(a.v, comp)) / dt;
}

/** Catmull-Rom style auto slope through key i for a scalar component. */
function autoSlope(keys, i, comp) {
  const prev = i > 0 ? keys[i - 1] : null;
  const next = i < keys.length - 1 ? keys[i + 1] : null;
  if (prev && next) {
    const dt = next.t - prev.t;
    if (Math.abs(dt) < 1e-6) return 0;
    return (compOf(next.v, comp) - compOf(prev.v, comp)) / dt;
  }
  if (next) return secant(keys, i, i + 1, comp);
  if (prev) return secant(keys, i - 1, i, comp);
  return 0;
}

/** Effective out-slope of key i for a scalar component, per its mode. */
function resolveOutSlope(keys, i, comp) {
  const k = keys[i];
  switch (k.tm) {
    case 'flat':   return 0;
    case 'linear': return i < keys.length - 1 ? secant(keys, i, i + 1, comp) : 0;
    case 'broken': return slopeOf(k.to, comp) ?? autoSlope(keys, i, comp);
    case 'free':   return slopeOf(k.to, comp) ?? autoSlope(keys, i, comp);
    default:       return autoSlope(keys, i, comp); // 'auto'
  }
}

/** Effective in-slope of key i for a scalar component, per its mode. */
function resolveInSlope(keys, i, comp) {
  const k = keys[i];
  switch (k.tm) {
    case 'flat':   return 0;
    case 'linear': return i > 0 ? secant(keys, i - 1, i, comp) : 0;
    case 'broken': return slopeOf(k.ti, comp) ?? autoSlope(keys, i, comp);
    case 'free':   return slopeOf(k.to, comp) ?? autoSlope(keys, i, comp); // mirror out
    default:       return autoSlope(keys, i, comp); // 'auto'
  }
}

/** True when the segment keys[i] → keys[i+1] should use Hermite. */
function segmentIsTangentDriven(keys, i) {
  return keyHasTangents(keys[i]) || keyHasTangents(keys[i + 1]);
}

/**
 * Hermite value of one scalar component across segment keys[i] → keys[i+1].
 * Endpoints lacking a tangent mode are seeded from the left key's legacy
 * easing curve so a mixed (legacy ↔ tangent) join stays continuous.
 */
function hermiteCompValue(keys, i, comp, s) {
  const a = keys[i];
  const b = keys[i + 1];
  const dt = b.t - a.t;
  const av = compOf(a.v, comp);
  const bv = compOf(b.v, comp);
  if (Math.abs(dt) < 1e-6) return bv;
  let legacy = null; // [startSlopeProgress, endSlopeProgress] lazily computed
  const vScale = (bv - av) / dt;
  let mOut;
  if (keyHasTangents(a)) {
    mOut = resolveOutSlope(keys, i, comp);
  } else {
    legacy = easingEndpointSlopes(a.out || 'linear');
    mOut = legacy[0] * vScale;
  }
  let mIn;
  if (keyHasTangents(b)) {
    mIn = resolveInSlope(keys, i + 1, comp);
  } else {
    if (!legacy) legacy = easingEndpointSlopes(a.out || 'linear');
    mIn = legacy[1] * vScale;
  }
  const span = b.t - a.t;
  return hermite(av, bv, mOut, mIn, span, s);
}

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

// Stable id for keys created here. `kf`-prefixed so it never collides with the
// `k`-prefixed ids `deriveFlowGraph` stamps onto legacy keys (see sceneModel).
let _kfSeq = 0;
function nextKeyId() { return `kf${(_kfSeq++).toString(36)}`; }

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
  if (segmentIsTangentDriven(keys, i)) return hermiteCompValue(keys, i, null, p);
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
function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

/** True when a (position) channel is in on-scene path mode. */
export function isPathChannel(ch) {
  return !!ch && ch.mode === 'path' && ch.path && Array.isArray(ch.path.points) && ch.path.points.length >= 2;
}

/**
 * Largest clip-local key time across all of a clip's channels (linked,
 * split, and path-mode progress keys). Used to stop a clip being resized
 * shorter than its furthest keyframe, which would orphan keys outside it.
 */
export function maxChannelKeyTime(channels) {
  if (!channels || typeof channels !== 'object') return 0;
  let m = 0;
  for (const name of Object.keys(channels)) {
    const ch = channels[name];
    if (!ch) continue;
    if (ch.mode === 'path' && ch.path) {
      for (const k of ch.path.progress?.keys || []) if (k.t > m) m = k.t;
      continue;
    }
    if (Array.isArray(ch.keys)) for (const k of ch.keys) if (k.t > m) m = k.t;
    if (ch.split && ch.perComp) {
      for (const c of Object.values(ch.perComp)) {
        for (const k of (c?.keys || [])) if (k.t > m) m = k.t;
      }
    }
  }
  return m;
}

/**
 * Bake a path-mode channel down to plain linked vec2 x/y keys at `fps`
 * samples per second across `duration`. The exported result reproduces the
 * authored motion (spline + progress curve) so the game engine never needs
 * arc-length math — it just plays ordinary position keys.
 */
export function bakePathToKeys(channel, duration, fps = 30) {
  if (!isPathChannel(channel)) return channel;
  const spline = getPathSpline(channel.path.points);
  const prog = channel.path.progress?.keys || [];
  const dur = Math.max(0.001, Number(duration) || 1);
  const n = Math.max(2, Math.round(dur * Math.max(1, fps)));
  const keys = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * dur;
    const p = clamp01(evalScalarKeys(prog, t) ?? 0);
    const pt = spline.pointAtFraction(p);
    keys.push({ t, v: { x: pt.x, y: pt.y }, out: 'linear' });
  }
  return { keys };
}

/**
 * Bake a path-mode channel to an EXACT number of keys (≥2), evenly spaced in
 * time, carrying smooth ('auto') tangents. Used when flattening path → normal
 * curves: few keys still approximate the trajectory because the cubic-Hermite
 * interpolation between them follows the auto tangents (so 3–4 keys look far
 * better than 3–4 linear keys would). The artist picks the count = accuracy.
 */
export function bakePathToKeyCount(channel, duration, count) {
  if (!isPathChannel(channel)) return channel;
  const spline = getPathSpline(channel.path.points);
  const prog = channel.path.progress?.keys || [];
  const dur = Math.max(0.001, Number(duration) || 1);
  const n = Math.max(2, Math.min(1000, Math.round(count) || 2));
  const keys = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur;
    const p = clamp01(evalScalarKeys(prog, t) ?? 0);
    const pt = spline.pointAtFraction(p);
    keys.push({ t, v: { x: pt.x, y: pt.y }, out: 'linear', tm: 'auto' });
  }
  return { keys };
}

export function evalChannel(channel, t, channelName = null) {
  // Path mode (P5): position is driven by a spatial spline + a progress(t)
  // curve. Evaluate live here — the rest of the system (motion path,
  // syncTransforms, export) reads this like any other vec2 channel.
  if (isPathChannel(channel)) {
    const p = clamp01(evalScalarKeys(channel.path.progress?.keys, t) ?? 0);
    const pt = getPathSpline(channel.path.points).pointAtFraction(p);
    return { x: pt.x, y: pt.y };
  }
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
  if (segmentIsTangentDriven(keys, i)) {
    // Hermite per component — each component carries its own slope.
    if (isVec2(a.v) && isVec2(b.v)) {
      return { x: hermiteCompValue(keys, i, 'x', p), y: hermiteCompValue(keys, i, 'y', p) };
    }
    if (isRgb(a.v) && isRgb(b.v)) {
      return {
        r: hermiteCompValue(keys, i, 'r', p),
        g: hermiteCompValue(keys, i, 'g', p),
        b: hermiteCompValue(keys, i, 'b', p)
      };
    }
    return hermiteCompValue(keys, i, null, p);
  }
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
        out.push({ comp, idx: i, t: keys[i].t, v: keys[i].v, kid: keys[i].kid });
      }
    }
    return out;
  }
  const keys = channel.keys || [];
  return keys.map((k, i) => ({ comp: null, idx: i, t: k.t, v: k.v, kid: k.kid }));
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

  const k = { t, v: cloneValue(v), out: defaultOut, kid: nextKeyId() };
  // Optional per-key tangent mode for new keys (P4 global default-ease).
  if (opts.tm && TANGENT_MODES.includes(opts.tm)) k.tm = opts.tm;
  let insertAt = keys.findIndex((kk) => kk.t > t);
  if (insertAt === -1) insertAt = keys.length;
  keys.splice(insertAt, 0, k);
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

// ── Multi-key transform (marquee move / scale) ────────────────────────
//
// A selection identity is `{ name, comp, kid }`:
//   - comp null  → a linked channel's key with that `kid`.
//   - comp set   → a split channel's `perComp[comp]` key with that `kid`.
//
// Identity is by stable `kid` (not array index) so a selected set can be
// dragged freely past non-selected neighbours — the list is just re-sorted by
// time and the selection follows its keys. See `deriveFlowGraph` for stamping.

/** The key array a `{ name, comp }` identity points at, or null. */
export function channelKeyList(channels, name, comp) {
  const ch = channels?.[name];
  if (!ch) return null;
  if (comp) return ch.split ? (ch.perComp?.[comp]?.keys || null) : null;
  return Array.isArray(ch.keys) ? ch.keys : null;
}

/**
 * Apply a clip-local time map to a SUBSET of a clip's keyframes (the marquee
 * selection). `mapT(t)` is the per-key time transform — `t => t + delta` for a
 * move, `t => pivot + (t - pivot) * factor` for a scale.
 *
 * Selected keys take their mapped time and the whole list is re-sorted by time;
 * because keys are identified by stable `kid`, a selected key may pass right
 * THROUGH a non-selected neighbour (no index clamp). When selected keys map
 * past the clip's [0, duration] range the clip itself grows — `start` moves
 * earlier and/or `duration` extends — but only within `bounds.leftRoom` /
 * `bounds.rightRoom` seconds (free space to the neighbouring clips / timeline
 * edges); overflow beyond that clamps.
 *
 * @param {object} clip            clip snapshot { start, duration, channels }
 * @param {Array}  selected        [{ name, comp, kid }]
 * @param {(t:number)=>number} mapT
 * @param {{leftRoom?:number,rightRoom?:number}} bounds
 * @returns {{ start, duration, channels } | null}  new clip fields, or null
 */
export function transformClipKeys(clip, selected, mapT, bounds = {}) {
  const channels = clip?.channels;
  if (!channels || !selected?.length) return null;
  const leftRoom = Math.max(0, Number(bounds.leftRoom) || 0);
  const rightRoom = Math.max(0, Number(bounds.rightRoom) || 0);
  const dur = Math.max(0.05, Number(clip.duration) || 0);
  const EPS = 1e-4;

  const listKeyOf = (name, comp) => `${name}|${comp || ''}`;
  const selByList = new Map(); // listKey → Set(kid)
  for (const s of selected) {
    if (s.kid == null) continue;
    const lk = listKeyOf(s.name, s.comp);
    if (!selByList.has(lk)) selByList.set(lk, new Set());
    selByList.get(lk).add(s.kid);
  }
  if (!selByList.size) return null;

  // Raw mapped time of every selected key → overall overflow past [0, dur].
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const [lk, kidSet] of selByList) {
    const [name, comp] = lk.split('|');
    const keys = channelKeyList(channels, name, comp || null);
    if (!keys) continue;
    for (const k of keys) {
      if (!kidSet.has(k.kid)) continue;
      const nt = mapT(k.t);
      if (nt < gMin) gMin = nt;
      if (nt > gMax) gMax = nt;
    }
  }
  if (!Number.isFinite(gMin)) return null;

  const leftShift = gMin < 0 ? Math.min(-gMin, leftRoom) : 0;
  const rightExtra = gMax > dur ? Math.min(gMax - dur, rightRoom) : 0;
  const newDuration = dur + leftShift + rightExtra;
  const newStart = Math.max(0, clip.start - leftShift);

  // Transform one key list: ALL keys shift by +leftShift (origin moved left);
  // selected take their mapped time. Re-sort by time (kid keeps identity), then
  // nudge any exactly-coincident keys apart so two never stack on one frame.
  const transformList = (keys, name, comp) => {
    const kidSet = selByList.get(listKeyOf(name, comp));
    const mapped = keys.map((k) => {
      const sel = kidSet?.has(k.kid);
      let nt = (sel ? mapT(k.t) : k.t) + leftShift;
      nt = Math.max(0, Math.min(newDuration, nt));
      return { ...k, t: nt };
    });
    mapped.sort((a, b) => a.t - b.t);
    let prev = -Infinity;
    for (let i = 0; i < mapped.length; i++) {
      if (mapped[i].t <= prev) mapped[i] = { ...mapped[i], t: prev + EPS };
      prev = mapped[i].t;
    }
    return mapped;
  };

  const newChannels = {};
  for (const name of Object.keys(channels)) {
    const ch = channels[name];
    if (!ch) { newChannels[name] = ch; continue; }
    if (ch.split && ch.perComp) {
      const perComp = {};
      for (const c of Object.keys(ch.perComp)) {
        perComp[c] = { ...ch.perComp[c], keys: transformList(ch.perComp[c]?.keys || [], name, c) };
      }
      newChannels[name] = { ...ch, perComp };
    } else if (Array.isArray(ch.keys)) {
      newChannels[name] = { ...ch, keys: transformList(ch.keys, name, null) };
    } else {
      newChannels[name] = ch;
    }
  }

  return { start: newStart, duration: newDuration, channels: newChannels };
}

// ── Tangent mutation + introspection (P4) ─────────────────────────────

/**
 * Out-slope of key i for a component, honouring a LEGACY easing curve when
 * the key has no tangent mode — so promoting a legacy key seeds a slope
 * that matches the current on-screen curve at the join (no visual jump).
 */
function outSlopeContinuous(keys, i, comp) {
  if (keyHasTangents(keys[i])) return resolveOutSlope(keys, i, comp);
  if (i >= keys.length - 1) return autoSlope(keys, i, comp);
  const a = keys[i];
  const b = keys[i + 1];
  const dt = b.t - a.t;
  if (Math.abs(dt) < 1e-6) return 0;
  const [s0] = easingEndpointSlopes(a.out || 'linear');
  return s0 * (compOf(b.v, comp) - compOf(a.v, comp)) / dt;
}

function inSlopeContinuous(keys, i, comp) {
  if (keyHasTangents(keys[i])) return resolveInSlope(keys, i, comp);
  if (i <= 0) return autoSlope(keys, i, comp);
  const a = keys[i - 1];
  const b = keys[i];
  const dt = b.t - a.t;
  if (Math.abs(dt) < 1e-6) return 0;
  const [, s1] = easingEndpointSlopes(a.out || 'linear');
  return s1 * (compOf(b.v, comp) - compOf(a.v, comp)) / dt;
}

function shapeLike(vShape) {
  if (isVec2(vShape)) return 'vec2';
  if (isRgb(vShape)) return 'rgb';
  return 'scalar';
}

/** Coerce an arbitrary slope source into the value-shape of `vShape`. */
function toSlopeShape(src, vShape) {
  const shape = shapeLike(vShape);
  if (shape === 'scalar') return Number.isFinite(Number(src)) ? Number(src) : 0;
  if (shape === 'vec2') return { x: Number(src?.x) || 0, y: Number(src?.y) || 0 };
  return { r: Number(src?.r) || 0, g: Number(src?.g) || 0, b: Number(src?.b) || 0 };
}

function mapSlopeShape(vShape, fn) {
  const shape = shapeLike(vShape);
  if (shape === 'scalar') return fn(null);
  if (shape === 'vec2') return { x: fn('x'), y: fn('y') };
  return { r: fn('r'), g: fn('g'), b: fn('b') };
}

/**
 * Current effective in/out tangent slopes of key `idx`, as value-shaped
 * objects (number / {x,y} / {r,g,b}). Honours legacy easing for keys with
 * no tangent mode. Used by the editor to draw handles and to seed slopes
 * when a key is promoted into the tangent model.
 */
export function effectiveSlopes(keys, idx) {
  const v = keys?.[idx]?.v;
  if (idx == null || !keys?.[idx]) return { in: 0, out: 0 };
  return {
    in: mapSlopeShape(v, (c) => inSlopeContinuous(keys, idx, c)),
    out: mapSlopeShape(v, (c) => outSlopeContinuous(keys, idx, c))
  };
}

/**
 * Set a key's tangent mode. Switching into 'free'/'broken' seeds the stored
 * slopes from the current effective slopes so the curve doesn't jump.
 * Switching into 'auto'/'flat'/'linear' drops stored slopes (computed).
 */
export function setKeyTangentMode(channel, idx, mode) {
  const keys = (channel?.keys || []).slice();
  if (idx < 0 || idx >= keys.length || !TANGENT_MODES.includes(mode)) return { keys };
  const k = keys[idx];
  const nk = { ...k, tm: mode };
  if (mode === 'free' || mode === 'broken') {
    const eff = effectiveSlopes(keys, idx);
    nk.to = toSlopeShape(k.to ?? eff.out, k.v);
    if (mode === 'broken') nk.ti = toSlopeShape(k.ti ?? eff.in, k.v);
    else delete nk.ti;
  } else {
    delete nk.ti;
    delete nk.to;
  }
  keys[idx] = nk;
  return { keys };
}

/**
 * Set one side's tangent slope for a component (drag handler). Ensures the
 * key is in an explicit mode: 'free' mirrors both sides from `to`; any other
 * drag promotes to 'broken' with both sides seeded so the untouched side
 * keeps its shape. `comp` is null for scalar channels.
 */
export function setKeyTangentSlope(channel, idx, side, comp, slopeValue, opts = {}) {
  const keys = (channel?.keys || []).slice();
  if (idx < 0 || idx >= keys.length) return { keys };
  const k = keys[idx];
  const wantFree = opts.free === true || k.tm === 'free';
  const eff = effectiveSlopes(keys, idx);
  const setComp = (base, value) => {
    if (comp == null) return value;
    const obj = (base && typeof base === 'object') ? { ...base } : {};
    obj[comp] = value;
    return obj;
  };
  if (wantFree) {
    let to = toSlopeShape(k.to ?? eff.out, k.v);
    to = setComp(to, slopeValue);
    keys[idx] = { ...k, tm: 'free', to, ti: undefined };
    delete keys[idx].ti;
  } else {
    let to = toSlopeShape(k.to ?? eff.out, k.v);
    let ti = toSlopeShape(k.ti ?? eff.in, k.v);
    if (side === 'out') to = setComp(to, slopeValue);
    else ti = setComp(ti, slopeValue);
    keys[idx] = { ...k, tm: 'broken', to, ti };
  }
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
