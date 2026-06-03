// engine/animation/curves.js
//
// Unified easing-curve evaluator. A curve spec is one of:
//
//   - A preset name string: "linear" | "easeIn" | "easeOut" | "easeInOut" |
//     "smoothstep" | "backIn" | "backOut" | "overshoot" | "stepStart" |
//     "stepEnd".
//   - A cubic-bezier object: `{ bezier: [x1, y1, x2, y2] }` — same shape as
//     CSS `cubic-bezier(x1, y1, x2, y2)`. x1/x2 are clamped to [0, 1]; y
//     values are unbounded so back-easing / overshoot is expressible.
//   - A legacy custom-points object: `{ type: 'custom', points: [{x,y},…] }`
//     — kept for backwards compatibility with earlier curve picker output.
//
// All preset names also exist as canonical bezier control points so the
// curve editor can show handles even when the user picked a preset name.

export const CURVE_PRESETS = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'smoothstep',
  'backIn',
  'backOut',
  'overshoot',
  'stepStart',
  'stepEnd'
];

/**
 * Canonical cubic-bezier control points for each preset. Approximations of
 * the hand-rolled evaluators below — used by the curve editor as the
 * starting handle positions when the user clicks a preset chip.
 */
export const PRESET_BEZIER = {
  linear:     [0,     0,     1,     1     ],
  easeIn:     [0.42,  0,     1,     1     ],
  easeOut:    [0,     0,     0.58,  1     ],
  easeInOut:  [0.42,  0,     0.58,  1     ],
  smoothstep: [0.4,   0,     0.6,   1     ],
  backIn:     [0.6,  -0.28,  0.735, 0.045 ],
  backOut:    [0.175, 0.885, 0.32,  1.275 ],
  overshoot:  [0.34,  1.56,  0.64,  1     ],
  stepStart:  [0,     1,     0,     1     ],
  stepEnd:    [1,     0,     1,     0     ]
};

// Cubic-bezier eval. Curve goes from (0,0) to (1,1) with two control points
// (x1,y1) and (x2,y2). Solve for parameter `t` so that x(t) = x, then
// return y(t). Newton-Raphson with bisection fallback.
function bezierComponent(t, a1, a2) {
  const u = 1 - t;
  return 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t;
}

function bezierComponentDerivative(t, a1, a2) {
  const u = 1 - t;
  return 3 * u * u * a1 + 6 * u * t * (a2 - a1) + 3 * t * t * (1 - a2);
}

export function cubicBezier(x, x1, y1, x2, y2) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const cx = bezierComponent(t, x1, x2) - x;
    if (Math.abs(cx) < 1e-6) break;
    const dx = bezierComponentDerivative(t, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    let next = t - cx / dx;
    if (next < 0) next = 0;
    else if (next > 1) next = 1;
    if (next === t) break;
    t = next;
  }
  return bezierComponent(t, y1, y2);
}

export function isBezierSpec(spec) {
  if (!spec || typeof spec !== 'object') return false;
  if (!Array.isArray(spec.bezier) || spec.bezier.length !== 4) return false;
  return spec.bezier.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function evalPreset(name, x) {
  if (name === 'easeIn') return x * x;
  if (name === 'easeOut') return 1 - (1 - x) * (1 - x);
  if (name === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  if (name === 'smoothstep') return x * x * (3 - 2 * x);
  if (name === 'backIn') return x * x * (2.70158 * x - 1.70158);
  if (name === 'backOut') {
    const t = x - 1;
    return 1 + t * t * (2.70158 * t + 1.70158);
  }
  if (name === 'overshoot') {
    const t = x - 1;
    return 1 + t * t * (3.3 * t + 2.3);
  }
  if (name === 'stepStart') return x <= 0 ? 0 : 1;
  if (name === 'stepEnd') return x < 1 ? 0 : 1;
  return x; // linear or unknown
}

function evalCustomPoints(points, x) {
  if (!Array.isArray(points) || points.length < 2) return x;
  const pts = points
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return x;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (x > b.x) continue;
    const dx = b.x - a.x;
    if (dx <= 1e-6) return b.y;
    return a.y + (b.y - a.y) * ((x - a.x) / dx);
  }
  return x;
}

// ── Hermite (per-key tangent) interpolation ───────────────────────────
//
// The P4 keyframe model stores per-key tangents (slopes in value-units per
// second) instead of a per-segment normalised easing curve. A segment
// between two keys is then a cubic Hermite spline determined by the two
// endpoint values and the left key's out-slope + the right key's in-slope.
// This matches how Unity AnimationCurve / Maya graph editor tangents work.

const SLOPE_CLAMP = 1e4;

/**
 * Cubic Hermite interpolation for one scalar component.
 * @param {number} v0  value at the left key
 * @param {number} v1  value at the right key
 * @param {number} m0  out-slope at the left key (value units per second)
 * @param {number} m1  in-slope at the right key (value units per second)
 * @param {number} dt  segment duration in seconds (t1 - t0)
 * @param {number} s   normalised progress within the segment, 0..1
 */
export function hermite(v0, v1, m0, m1, dt, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * v0 + h10 * (m0 * dt) + h01 * v1 + h11 * (m1 * dt);
}

/**
 * Numerically estimate the endpoint slopes (of the eased PROGRESS, i.e.
 * d(easedProgress)/d(normalisedTime)) of any curve spec at s=0 and s=1.
 * Works uniformly for presets, bezier specs and custom-point specs.
 * Returns `[startSlope, endSlope]`, each clamped to ±SLOPE_CLAMP.
 *
 * Multiply these by `(v1 - v0) / dt` to convert into value-space slopes
 * usable as Hermite tangents — this is how a legacy per-segment easing
 * curve is seeded into the per-key tangent model without changing the
 * segment's endpoint behaviour.
 */
export function easingEndpointSlopes(spec) {
  const h = 1e-3;
  const start = curveEval(spec, h) / h;          // f(0) === 0 for all eases
  const end = (1 - curveEval(spec, 1 - h)) / h;  // f(1) === 1 for all eases
  const clamp = (n) => Math.max(-SLOPE_CLAMP, Math.min(SLOPE_CLAMP, Number.isFinite(n) ? n : 0));
  return [clamp(start), clamp(end)];
}

/**
 * Evaluate a curve spec at progress `p ∈ [0, 1]`. Returns the eased value
 * (typically in [0, 1] but back-eased curves may overshoot).
 */
export function curveEval(spec, p) {
  const x = Math.max(0, Math.min(1, p));
  if (typeof spec === 'string') return evalPreset(spec, x);
  if (isBezierSpec(spec)) {
    const [x1, y1, x2, y2] = spec.bezier;
    return cubicBezier(x, x1, y1, x2, y2);
  }
  if (spec && typeof spec === 'object' && String(spec.type || '').toLowerCase() === 'custom') {
    return evalCustomPoints(spec.points, x);
  }
  return x;
}

/**
 * Resolve any curve spec into a bezier-array [x1, y1, x2, y2]. Used by the
 * curve editor so handles can be shown regardless of which form the spec
 * is currently in. Falls back to linear for unrecognised input.
 */
export function toBezier(spec) {
  if (isBezierSpec(spec)) return spec.bezier.slice();
  if (typeof spec === 'string' && PRESET_BEZIER[spec]) return PRESET_BEZIER[spec].slice();
  return PRESET_BEZIER.linear.slice();
}

/**
 * Match a bezier-array against the preset table. Returns the preset name
 * if all four values are within `epsilon` of a canonical preset, else
 * `'custom'`. Useful for highlighting the active chip in the curve editor.
 */
export function detectPreset(spec, epsilon = 0.005) {
  if (typeof spec === 'string' && PRESET_BEZIER[spec]) return spec;
  const b = toBezier(spec);
  for (const name of Object.keys(PRESET_BEZIER)) {
    const ref = PRESET_BEZIER[name];
    if (
      Math.abs(ref[0] - b[0]) < epsilon &&
      Math.abs(ref[1] - b[1]) < epsilon &&
      Math.abs(ref[2] - b[2]) < epsilon &&
      Math.abs(ref[3] - b[3]) < epsilon
    ) return name;
  }
  return 'custom';
}

/** CSS-style readout for a curve spec: `cubic-bezier(0.42, 0.00, 0.58, 1.00)`. */
export function formatBezier(spec) {
  const b = toBezier(spec);
  return `cubic-bezier(${b.map((n) => n.toFixed(2)).join(', ')})`;
}

/**
 * Normalize a curve spec into one of the persistable forms. Returns the
 * preset string when it matches one, otherwise a bezier object. Drops
 * unknown shapes back to "linear".
 */
export function normalizeCurveSpec(spec, fallback = 'linear') {
  if (typeof spec === 'string') return CURVE_PRESETS.includes(spec) ? spec : fallback;
  if (isBezierSpec(spec)) {
    const [x1, y1, x2, y2] = spec.bezier;
    return {
      bezier: [
        Math.max(0, Math.min(1, x1)),
        y1,
        Math.max(0, Math.min(1, x2)),
        y2
      ]
    };
  }
  if (spec && typeof spec === 'object' && String(spec.type || '').toLowerCase() === 'custom') {
    return spec; // pass-through legacy form
  }
  return fallback;
}
