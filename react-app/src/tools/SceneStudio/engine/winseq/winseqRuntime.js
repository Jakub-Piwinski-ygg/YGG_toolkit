// engine/winseq/winseqRuntime.js
//
// Pixi v8 driver for the Win-Sequence object — Scene Studio Phase 6.
// The object IS a Spine instance (win_sequence.json), built through the
// ordinary spine path in pixiApp.js and tagged with `__winseq = { config }`.
// This module is a thin, scrub-safe view over the pure evaluator: per frame
// it picks the active clip, evaluates which chained animation should play at
// the clip-local time, and reflects it onto Spine track 0 — exactly the same
// deterministic `setAnimation + trackTime + update(0)` pattern the spinner
// overlay pool and applySpineMultiTrack use. NO chaining logic lives here.

import { clipAt, lastClipAt } from '../flowInterpreter.js';
import { evaluateWinSeqFlow, findWinSeqFlow } from './winseqModel.js';

/**
 * Build the `{ [animName]: seconds }` duration map straight from the live
 * Spine skeleton data — the single source of truth for chained-step lengths,
 * so no durations need persisting in the scene file.
 */
export function winSeqDurationsFromSpine(obj) {
  const out = {};
  const anims = obj?.skeleton?.data?.animations || [];
  for (const a of anims) { if (a?.name) out[a.name] = Number(a.duration) || 0; }
  return out;
}

function clearTrack(obj, cache) {
  if (cache.anim !== null) {
    try { obj.state.setEmptyAnimation(0, 0); } catch { /* ignore */ }
    cache.anim = null;
    cache.loop = null;
  }
}

/**
 * Per-frame application — strictly t-driven, scrub-safe in both directions.
 * Mirrors applySpineMultiTrack's "hold the last clip's final pose" behaviour
 * when the playhead sits in a gap after a clip.
 *
 * @param {object} obj     Spine instance with `__winseq = { config }`
 * @param {object} layer   owning SceneLayer (unused; kept for signature parity)
 * @param {Array}  tracks  this layer's flow tracks
 * @param {number} t       global timeline seconds
 */
export function applyWinSeqAtTime(obj, layer, tracks, t) {
  const ws = obj.__winseq;
  if (!ws || !obj.state || !obj.skeleton) return;
  const config = ws.config;
  const durations = ws.durations || (ws.durations = winSeqDurationsFromSpine(obj));
  const cache = obj.__wsCache || (obj.__wsCache = { anim: null, loop: null });

  // One win-sequence object = one action track (track[0]). Extra tracks are
  // ignored — the sequence is a single chained timeline.
  const track = (tracks && tracks[0]) || null;
  let clip = clipAt(track, t);
  let holding = false;
  if (!clip) {
    // Gap / past the end: hold the last clip's final pose (Unity-Timeline-like).
    clip = lastClipAt(track, t);
    holding = true;
  }
  if (!clip) { clearTrack(obj, cache); return; }

  const payload = clip.winseq || {};
  const flow = findWinSeqFlow(config, payload.sequenceId);
  if (!flow) { clearTrack(obj, cache); return; }

  // Clip-local time; when holding past the clip end, freeze at the last frame.
  const localRaw = holding ? (clip.duration - 1e-4) : (t - clip.start);
  const ev = evaluateWinSeqFlow(flow, durations, localRaw, { hangOnLastIdle: payload.hangOnLastIdle === true });
  if (!ev) { clearTrack(obj, cache); return; }

  if (cache.anim !== ev.anim || cache.loop !== ev.loop) {
    try { obj.state.setAnimation(0, ev.anim, ev.loop); }
    catch { /* anim missing on skeleton — ignore */ }
    cache.anim = ev.anim;
    cache.loop = ev.loop;
  }
  try {
    const tr = obj.state.tracks[0];
    if (tr) {
      tr.trackTime = ev.animTime;
      tr.timeScale = 0; // pose is fully t-driven; never self-advance
      tr.alpha = 1;
    }
  } catch { /* ignore */ }
  // Deterministic pose refresh without advancing time.
  try { obj.update(0); } catch { /* ignore */ }
}

/** Reset to a clean pose (setup mode). */
export function resetWinSeqState(obj) {
  if (!obj?.state || !obj?.skeleton) return;
  const cache = obj.__wsCache || (obj.__wsCache = { anim: null, loop: null });
  try { obj.state.clearTracks(); } catch { /* ignore */ }
  try {
    if (typeof obj.skeleton.setToSetupPose === 'function') obj.skeleton.setToSetupPose();
    else if (typeof obj.skeleton.setupPose === 'function') obj.skeleton.setupPose();
  } catch { /* ignore */ }
  cache.anim = null;
  cache.loop = null;
  try { obj.update?.(0); } catch { /* ignore */ }
}
