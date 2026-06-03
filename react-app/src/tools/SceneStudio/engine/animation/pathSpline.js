// engine/animation/pathSpline.js
//
// Pure 2D geometry for the on-scene motion-path mode (P5). A path is an
// ordered list of spatial control points; the curve between them is a cubic
// Bézier whose handles come from each point's tangent mode:
//
//   point = { x, y, tm?, ti?:{x,y}, to?:{x,y} }
//     tm 'auto'   → smooth Catmull-Rom handles (default)
//     tm 'linear' → zero-length handles (straight segments)
//     tm 'broken' → explicit `ti` / `to` handle OFFSET vectors (world units)
//     tm 'free'   → mirrored: out = `to`, in = -`to`
//
// We build an arc-length lookup table so a progress value p ∈ [0,1] maps to a
// point at that FRACTION OF TOTAL LENGTH (constant-speed parametrisation —
// the separate progress(t) curve then shapes acceleration). This file knows
// nothing about time or keyframes; `keyframes.js` orchestrates progress eval
// and baking on top of it (keeping the import graph acyclic).

const SEG_SAMPLES = 24; // bézier samples per segment for the arc-length LUT

export function resolvePointHandles(points) {
  return resolveHandles(points);
}

function resolveHandles(points) {
  const n = points.length;
  const H = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[i - 1] || p;
    const next = points[i + 1] || p;
    let outV = null;
    let inV = null;
    if (p.tm === 'linear') {
      outV = { x: 0, y: 0 };
      inV = { x: 0, y: 0 };
    } else if (p.tm === 'broken' || p.tm === 'free') {
      if (p.to) outV = { x: p.to.x, y: p.to.y };
      if (p.tm === 'free') {
        if (p.to) inV = { x: -p.to.x, y: -p.to.y };
      } else if (p.ti) {
        inV = { x: p.ti.x, y: p.ti.y };
      }
    }
    // Auto (Catmull-Rom → Bézier): handle offset = (next - prev) / 6. Falls
    // back here for any component a non-auto mode left unset.
    if (!outV || !inV) {
      const dx = (next.x - prev.x) / 6;
      const dy = (next.y - prev.y) / 6;
      if (!outV) outV = { x: dx, y: dy };
      if (!inV) inV = { x: -dx, y: -dy };
    }
    H.push({
      inX: p.x + inV.x, inY: p.y + inV.y,
      outX: p.x + outV.x, outY: p.y + outV.y
    });
  }
  return H;
}

function build(points) {
  if (!Array.isArray(points) || points.length < 2) {
    const p = points?.[0] || { x: 0, y: 0 };
    return {
      totalLength: 0,
      pointAtFraction: () => ({ x: p.x, y: p.y }),
      tangentAtFraction: () => ({ x: 1, y: 0 })
    };
  }
  const H = resolveHandles(points);
  const xs = [points[0].x];
  const ys = [points[0].y];
  const cum = [0];
  let total = 0;
  let lastx = points[0].x;
  let lasty = points[0].y;
  for (let i = 0; i < points.length - 1; i++) {
    const P0 = points[i];
    const P3 = points[i + 1];
    const P1x = H[i].outX, P1y = H[i].outY;
    const P2x = H[i + 1].inX, P2y = H[i + 1].inY;
    for (let s = 1; s <= SEG_SAMPLES; s++) {
      const u = s / SEG_SAMPLES;
      const v = 1 - u;
      const x = v * v * v * P0.x + 3 * v * v * u * P1x + 3 * v * u * u * P2x + u * u * u * P3.x;
      const y = v * v * v * P0.y + 3 * v * v * u * P1y + 3 * v * u * u * P2y + u * u * u * P3.y;
      total += Math.hypot(x - lastx, y - lasty);
      xs.push(x); ys.push(y); cum.push(total);
      lastx = x; lasty = y;
    }
  }
  const findIdx = (target) => {
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    return [lo, hi];
  };
  return {
    totalLength: total,
    pointAtFraction(f) {
      if (total <= 0) return { x: xs[0], y: ys[0] };
      const target = Math.max(0, Math.min(1, f)) * total;
      const [lo, hi] = findIdx(target);
      const segLen = cum[hi] - cum[lo] || 1e-6;
      const tt = (target - cum[lo]) / segLen;
      return { x: xs[lo] + (xs[hi] - xs[lo]) * tt, y: ys[lo] + (ys[hi] - ys[lo]) * tt };
    },
    tangentAtFraction(f) {
      if (total <= 0) return { x: 1, y: 0 };
      const target = Math.max(0, Math.min(1, f)) * total;
      const [lo, hi] = findIdx(target);
      const dx = xs[hi] - xs[lo];
      const dy = ys[hi] - ys[lo];
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
  };
}

// Cache the built spline (LUT) keyed by the points array identity. React
// produces a fresh points array on every edit, so identity-keying gives
// automatic invalidation without manual versioning.
const cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

export function getPathSpline(points) {
  if (!Array.isArray(points) || points.length < 2) return build(points || []);
  if (!cache) return build(points);
  let s = cache.get(points);
  if (!s) { s = build(points); cache.set(points, s); }
  return s;
}

/** Default smooth-auto point at a world position. */
export function makePathPoint(x, y, tm = 'auto') {
  return { x, y, tm };
}

/**
 * Arc-length fraction (0..1) of each control point along the spline.
 * Used to place an auto-keyed point at the object's current progress.
 */
export function pointArcFractions(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return (points || []).map((_, i) => (i === 0 ? 0 : 1));
  }
  const H = resolveHandles(points);
  const frac = [0];
  let total = 0;
  let lastx = points[0].x;
  let lasty = points[0].y;
  for (let i = 0; i < points.length - 1; i++) {
    const P0 = points[i];
    const P3 = points[i + 1];
    const P1x = H[i].outX, P1y = H[i].outY;
    const P2x = H[i + 1].inX, P2y = H[i + 1].inY;
    for (let s = 1; s <= SEG_SAMPLES; s++) {
      const u = s / SEG_SAMPLES;
      const v = 1 - u;
      const x = v * v * v * P0.x + 3 * v * v * u * P1x + 3 * v * u * u * P2x + u * u * u * P3.x;
      const y = v * v * v * P0.y + 3 * v * v * u * P1y + 3 * v * u * u * P2y + u * u * u * P3.y;
      total += Math.hypot(x - lastx, y - lasty);
      lastx = x; lasty = y;
    }
    frac.push(total);
  }
  if (total > 0) for (let i = 0; i < frac.length; i++) frac[i] /= total;
  else for (let i = 0; i < frac.length; i++) frac[i] = i / (frac.length - 1);
  return frac;
}

/**
 * Insert a smooth control point at arc-length `fraction`, or move the
 * nearest existing point if one already sits within `eps` of that fraction
 * (so repeated drags at the same playhead time refine one point instead of
 * spamming new ones). Returns a NEW points array.
 */
export function insertOrUpdatePathPoint(points, fraction, x, y, eps = 0.02) {
  const pts = Array.isArray(points) ? points.slice() : [];
  if (pts.length < 2) { pts.push({ x, y, tm: 'auto' }); return pts; }
  const f = pointArcFractions(pts);
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(f[i] - fraction) <= eps) {
      pts[i] = { ...pts[i], x, y };
      return pts;
    }
  }
  let idx = f.findIndex((ff) => ff > fraction);
  if (idx === -1) idx = pts.length;
  pts.splice(idx, 0, { x, y, tm: 'auto' });
  return pts;
}
