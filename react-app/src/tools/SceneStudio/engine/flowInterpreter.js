// Timeline/flow interpreter for Scene Studio Phase 3.

/** Find the clip active at scene time `t` within a single track. */
export function clipAt(track, t) {
  if (!track?.clips?.length) return null;
  return track.clips.find((c) => t >= c.start && t < c.start + c.duration) || null;
}

/**
 * Evaluate one of the supported easing curves at progress `p` ∈ [0,1].
 * Returns a value in [0,1]. Unknown names fall back to linear.
 */
export function curveEval(curve, p) {
  const x = Math.max(0, Math.min(1, p));
  if (curve && typeof curve === 'object' && String(curve.type || '').toLowerCase() === 'custom') {
    return evalCustomCurve(curve.points, x);
  }
  if (curve === 'easeIn') return x * x;
  if (curve === 'easeOut') return 1 - (1 - x) * (1 - x);
  if (curve === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  if (curve === 'smoothstep') return x * x * (3 - 2 * x);
  if (curve === 'backIn') return x * x * (2.70158 * x - 1.70158);
  if (curve === 'backOut') {
    const t = x - 1;
    return 1 + t * t * (2.70158 * t + 1.70158);
  }
  if (curve === 'overshoot') {
    const t = x - 1;
    return 1 + t * t * (3.3 * t + 2.3);
  }
  if (curve === 'stepStart') return x <= 0 ? 0 : 1;
  if (curve === 'stepEnd') return x < 1 ? 0 : 1;
  return x;
}

function evalCustomCurve(points, x) {
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
    if (dx <= 0.000001) return b.y;
    const t = (x - a.x) / dx;
    return a.y + (b.y - a.y) * t;
  }
  return x;
}

/**
 * Raw, *un-eased* clip progress at scene time `t`, in [0,1]. Respects loop.
 * Used by PNG tween application where the curve is applied per-property,
 * not baked into the time domain.
 */
export function clipRawProgress(clip, sceneTime) {
  if (!clip) return 0;
  const dur = Math.max(0.001, clip.duration || 0);
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  let local = Math.max(0, sceneTime - clip.start) * speed;
  if (clip.loop) local = local % dur;
  else local = Math.min(local, dur);
  return local / dur;
}

/**
 * Convert global scene time to clip-local playback time, with curve remap
 * baked into the time axis. Used by Spine track-time seeking so the
 * playback rate ramps according to the clip's master curve.
 */
export function remapClipTime(clip, sceneTime, sourceDuration = null) {
  if (!clip) return 0;
  const durRaw = Number(sourceDuration);
  const dur = Number.isFinite(durRaw) && durRaw > 0
    ? durRaw
    : Math.max(0.001, clip.duration || 0);
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  let local = Math.max(0, sceneTime - clip.start) * speed;
  if (clip.loop) local = local % dur;
  else local = Math.min(local, dur);
  const progress = local / dur;
  return curveEval(clip.curve || 'linear', progress) * dur;
}

function sortedMarkers(scene) {
  const pri = (m) => (m.type === 'emit' ? 0 : 1);
  return [...(scene.flow?.markers || [])].sort((a, b) => a.time - b.time || pri(a) - pri(b));
}

/**
 * Advance timeline state by dt seconds.
 *
 * state shape:
 *   { time:number, playing:boolean, hold:null|{type,markerId,signal,until},
 *     emitted:string[] (this-tick only, drained by React subscribers),
 *     signalsSeen:Set<string> (all signals emitted this play session) }
 */
export function tickFlow(scene, state, dt) {
  const duration = clampFinite(scene?.stage?.duration, 0.01, 300, 5);
  const out = {
    ...state,
    time: clampFinite(state?.time, 0, duration, 0),
    playing: !!state?.playing,
    hold: state?.hold || null,
    emitted: [],
    signalsSeen: state?.signalsSeen instanceof Set ? state.signalsSeen : new Set()
  };
  if (!out.playing) return out;

  // Existing hold blocks progression until resolved.
  if (out.hold) {
    if (out.hold.type === 'wait') {
      const holdUntil = clampFinite(out.hold.until, 0, duration + 300, out.time);
      out.time = Math.min(holdUntil, out.time + clampFinite(dt, 0, 1, 0));
      if (out.time >= out.hold.until) out.hold = null;
      return out;
    } else {
      return out;
    }
  }

  const safeDt = clampFinite(dt, 0, 1, 0);
  let nextT = Math.min(duration, out.time + safeDt);
  const markers = sortedMarkers(scene).filter((m) => m.time > out.time && m.time <= nextT);
  for (const m of markers) {
    if (m.type === 'emit') {
      if (m.signal) {
        out.emitted.push(m.signal);
        out.signalsSeen.add(m.signal);
      }
      continue;
    }
    if (m.type === 'wait') {
      out.time = m.time;
      out.hold = { type: 'wait', markerId: m.id, until: m.time + Math.max(0, m.duration || 0) };
      return out;
    }
    if (m.type === 'waitForClick') {
      out.time = m.time;
      out.hold = { type: 'waitForClick', markerId: m.id };
      return out;
    }
    if (m.type === 'waitForSignal') {
      const signal = m.signal || '';
      // If the signal already fired earlier in this play session — either
      // earlier this tick or in a prior tick — the wait resolves instantly.
      if (signal && (out.emitted.includes(signal) || out.signalsSeen.has(signal))) continue;
      out.time = m.time;
      out.hold = { type: 'waitForSignal', markerId: m.id, signal };
      return out;
    }
  }

  out.time = nextT;
  if (out.time >= duration) out.playing = false;
  return out;
}

export function createInitialFlowState() {
  return { time: 0, playing: false, hold: null, emitted: [], signalsSeen: new Set() };
}

export function flowPlay(state) {
  return { ...state, playing: true };
}

export function flowPause(state) {
  return { ...state, playing: false };
}

export function flowStop(state) {
  return { ...state, time: 0, playing: false, hold: null, emitted: [], signalsSeen: new Set() };
}

export function flowSeek(scene, state, time) {
  const duration = clampFinite(scene?.stage?.duration, 0.01, 300, 5);
  const t = clampFinite(time, 0, duration, state?.time || 0);
  // Seeking invalidates the signal history (we may have jumped backward
  // past an earlier emit). Clearing keeps replay semantics consistent.
  return { ...state, time: t, hold: null, emitted: [], signalsSeen: new Set() };
}

export function flowResumeByClick(state) {
  if (state.hold?.type !== 'waitForClick') return state;
  return { ...state, hold: null, playing: true };
}

export function flowResolveSignal(state, signal) {
  const cur = state.signalsSeen instanceof Set ? state.signalsSeen : new Set();
  const matched = state.hold?.type === 'waitForSignal' && state.hold.signal === signal;
  const alreadySeen = !signal || cur.has(signal);
  if (alreadySeen && !matched) return state;
  const seen = alreadySeen ? cur : new Set(cur).add(signal);
  if (matched) return { ...state, hold: null, playing: true, signalsSeen: seen };
  return { ...state, signalsSeen: seen };
}

export function activeClips(scene, time) {
  const out = new Map();
  for (const tr of scene.flow?.tracks || []) {
    const clip = clipAt(tr, time);
    if (clip) out.set(tr.layerId, clip);
  }
  return out;
}

function clampFinite(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
