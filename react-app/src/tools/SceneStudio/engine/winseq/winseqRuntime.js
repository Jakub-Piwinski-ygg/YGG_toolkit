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

import { clipAt } from '../flowInterpreter.js';
import { evaluateWinSeqFlow, findWinSeqFlow, evaluateWinSeqSetupPose } from './winseqModel.js';

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

/** Hide the win-sequence (and clear its driving context so the number child
 *  hides too). Used whenever no control clip is actively driving it. */
function hideWinSeq(obj, cache) {
  clearTrack(obj, cache);
  obj.__wsActive = null;
  obj.visible = false;
}

/**
 * Per-frame application — strictly t-driven, scrub-safe in both directions.
 *
 * A win-sequence object has NO idle/default animation of its own: it is the
 * in-game "win celebration" that only exists while its control-track clip
 * plays. So it is VISIBLE only while an active clip drives it, and INVISIBLE
 * otherwise (before the first clip, in gaps between clips, and after the last
 * clip ends) — unlike a Spine layer, it does NOT hold the last frame. Its
 * positioning pose in setup mode is handled separately (applyWinSeqSetupPose).
 *
 * @param {object} obj     Spine instance with `__winseq = { config }`
 * @param {object} layer   owning SceneLayer (drives base visibility)
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
  // Only an ACTIVE clip at the playhead makes it visible — no last-frame hold.
  const clip = clipAt(track, t);
  if (!clip) { hideWinSeq(obj, cache); return; }

  const payload = clip.winseq || {};
  const flow = findWinSeqFlow(config, payload.sequenceId);
  if (!flow) { hideWinSeq(obj, cache); return; }

  const localRaw = t - clip.start;
  const ev = evaluateWinSeqFlow(flow, durations, localRaw, { hangOnLastIdle: payload.hangOnLastIdle === true });
  if (!ev) { hideWinSeq(obj, cache); return; }

  // Driven by an active clip → visible. Unified visibility model: hiding is an
  // alpha-0 gate (transform.alpha, applied by applyPngChannels), never a hard
  // Pixi `visible=false`, so the object stays live in the runtime.
  obj.visible = true;

  // Publish the driving context so a child win-number layer (processed later in
  // the same applyFlowAtTime pass) can follow the bone + count up at this time.
  obj.__wsActive = {
    flow,
    durations,
    localT: localRaw,
    hangOnLastIdle: payload.hangOnLastIdle === true,
  };

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

/**
 * Pose the win-sequence on its SETUP default pose — the representative frame
 * shown (visible) while the object is positioned/scaled in setup mode. This is
 * what makes it possible to "see it in full" to place it, even though it is
 * invisible-by-default in animate mode. The pose comes from config.setupPose
 * (a chosen flow + frame; defaults to the biggest flow's mid-idle). Falls back
 * to the raw skeleton setup pose when no flow resolves.
 */
export function applyWinSeqSetupPose(obj) {
  if (!obj?.state || !obj?.skeleton) return;
  const ws = obj.__winseq;
  const cache = obj.__wsCache || (obj.__wsCache = { anim: null, loop: null });
  try { obj.state.clearTracks(); } catch { /* ignore */ }
  // Clean skeletal base first, so a partial anim can't leave stale bone state.
  try {
    if (typeof obj.skeleton.setToSetupPose === 'function') obj.skeleton.setToSetupPose();
    else if (typeof obj.skeleton.setupPose === 'function') obj.skeleton.setupPose();
  } catch { /* ignore */ }
  cache.anim = null;
  cache.loop = null;

  const config = ws?.config;
  const durations = ws?.durations || (ws && (ws.durations = winSeqDurationsFromSpine(obj)));
  const ev = config ? evaluateWinSeqSetupPose(config, durations) : null;
  if (ev) {
    try { obj.state.setAnimation(0, ev.anim, false); }
    catch { /* anim missing on skeleton — keep the raw setup pose */ }
    cache.anim = ev.anim;
    cache.loop = false;
    try {
      const tr = obj.state.tracks[0];
      if (tr) { tr.trackTime = ev.animTime; tr.timeScale = 0; tr.alpha = 1; }
    } catch { /* ignore */ }
  }
  try { obj.update?.(0); } catch { /* ignore */ }
}

/** Reset to the clean setup pose (entering setup mode). The count-up number is
 *  hidden separately by resetAnimationState. */
export function resetWinSeqState(obj) {
  if (!obj?.state || !obj?.skeleton) return;
  applyWinSeqSetupPose(obj);
  obj.__wsActive = null;
}
