import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CURVE_PRESETS, TWEEN_PROPS, uid } from '../engine/sceneModel.js';
import { channelKeyDots, CHANNEL_NAMES, evalChannel, isPathChannel, maxChannelKeyTime } from '../engine/animation/keyframes.js';
import { SPINNER_ACTIONS, normalizeSpinnerConfig } from '../engine/spinner/spinnerModel.js';
import { normalizeWinSeqConfig, findWinSeqFlow, winSeqFlowDuration } from '../engine/winseq/winseqModel.js';
import { spinnerClipDurationAction } from './SpinnerInspectorSections.jsx';
import { NumberField } from '../../../components/NumberField.jsx';
import { elementZoom, rootZoom } from '../../../utils/domZoom.js';

/**
 * Compute the clip length that matches the content a clip points at — one spine
 * animation cycle, the full win-sequence flow, or a spinner action's computed
 * time. Returns null when there's no meaningful auto-duration. Shared by the
 * timeline pickers so selecting new content re-fits the clip automatically.
 */
function fittedClipDuration(asset, clip, layer, descriptor) {
  if (!asset) return null;
  if (asset.type === 'spine') {
    const resolved = clip.anim || layer?.spine?.defaultAnimation || null;
    if (!resolved) return null;
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const d = Number(descriptor?.animationDurations?.[resolved]);
    return Number.isFinite(d) && d > 0 ? Math.max(0.05, d / speed) : null;
  }
  if (asset.type === 'winseq') {
    const flow = findWinSeqFlow(normalizeWinSeqConfig(asset.winseq), clip.winseq?.sequenceId);
    if (!flow) return null;
    return Math.max(0.05, winSeqFlowDuration(flow, descriptor?.animationDurations || {},
      { hangOnLastIdle: clip.winseq?.hangOnLastIdle === true }));
  }
  if (asset.type === 'spinner') {
    const act = spinnerClipDurationAction(normalizeSpinnerConfig(asset.spinner), clip);
    return act && Number.isFinite(act.duration) ? act.duration : null;
  }
  return null;
}

const LABEL_COL_W = 140;

// Spinner action progression for adjacent-add "+" buttons.
const SPINNER_ACTION_SEQUENCE = ['startSpin', 'spin', 'stopSpin', 'presentWin', 'holdResult'];
function nextSpinnerAction(currentAction) {
  const idx = SPINNER_ACTION_SEQUENCE.indexOf(currentAction);
  if (idx < 0 || idx >= SPINNER_ACTION_SEQUENCE.length - 1) return 'spin';
  return SPINNER_ACTION_SEQUENCE[idx + 1];
}

// Default duration in seconds for each spinner action clip.
function spinnerActionDuration(action) {
  if (action === 'startSpin') return 0.5;
  if (action === 'stopSpin')  return 0.8;
  if (action === 'presentWin') return 1.0;
  if (action === 'holdResult') return 1.0;
  return 3.0; // spin
}

// Given a sorted clip list on a spinner track, determine what action the NEXT
// added clip should have (follows the last clip's action in the sequence).
function nextActionForSpinnerTrack(clips) {
  if (!clips || !clips.length) return 'startSpin';
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const last = sorted[sorted.length - 1];
  return nextSpinnerAction(last.action || 'startSpin');
}
/**
 * Shift every keyframe in a clip's channels by `shift` clip-local seconds,
 * clamped to [0, duration]. Used by left-edge resize so the keys keep their
 * absolute (scene) time when the clip's start moves — extending a clip leftward
 * doesn't drag its keys along.
 */
function shiftClipChannels(channels, shift, duration) {
  if (!channels || !shift) return channels;
  const clampT = (t) => Math.max(0, Math.min(duration, t + shift));
  const out = {};
  for (const name of Object.keys(channels)) {
    const ch = channels[name];
    if (!ch) { out[name] = ch; continue; }
    if (ch.mode === 'path' && ch.path) {
      const prog = ch.path.progress;
      out[name] = prog?.keys
        ? { ...ch, path: { ...ch.path, progress: { ...prog, keys: prog.keys.map((k) => ({ ...k, t: clampT(k.t) })) } } }
        : ch;
    } else if (ch.split && ch.perComp) {
      const perComp = {};
      for (const c of Object.keys(ch.perComp)) {
        perComp[c] = { ...ch.perComp[c], keys: (ch.perComp[c]?.keys || []).map((k) => ({ ...k, t: clampT(k.t) })) };
      }
      out[name] = { ...ch, perComp };
    } else if (Array.isArray(ch.keys)) {
      out[name] = { ...ch, keys: ch.keys.map((k) => ({ ...k, t: clampT(k.t) })) };
    } else {
      out[name] = ch;
    }
  }
  return out;
}

const DEFAULT_PX_PER_SEC = 120;
const MIN_PX_PER_SEC = 30;
const MAX_PX_PER_SEC = 1440;   // ~4× deeper than the old 360 cap, for frame-level work
const ROW_H = 40;
const RULER_H = 24;
const ADJACENT_ADD_MIN_GAP = 0.2;

// Channel display order (bottom → top in the clip band).
const KF_CHANNELS = ['position', 'scale', 'rotation', 'alpha', 'tint'];
const KF_SLOT_H = 11;    // vertical pitch per channel row (collapsed reference)

// ── Expanded-clip layout (Unity AnimationTrack style) ─────────────────
// Only the SELECTED clip expands to show full per-channel keyframe rows; the
// track it lives on grows to fit, and the other clips on that track flatten to
// a single summary row. These constants drive both the track height and the
// clip's keyframe band so the two always agree.
const EXP_ROW_H = 16;        // pitch per channel row when expanded (big hit area)
const EXP_SUMMARY_H = 16;    // the "all keys" summary row on top
const EXP_BAND_BASE = 4;     // padding below the lowest channel row
const EXP_BAND_GAP = 4;      // gap between channel rows and the summary row
const EXP_HEADER_H = 18;     // clip label/select strip above the band
const CLIP_VPAD = 6;         // .scene-clip top+bottom inset (3 + 3)

/** Keyframe band height for an expanded clip with `nRows` channel rows. */
function expandedBandH(nRows) {
  return EXP_BAND_BASE + nRows * EXP_ROW_H + EXP_BAND_GAP + EXP_SUMMARY_H;
}
/** Full track row height needed to show `clip` expanded. */
function expandedTrackHeight(clip) {
  const { maxStack } = buildClipDots(clip);
  return CLIP_VPAD + EXP_HEADER_H + expandedBandH(maxStack);
}

/**
 * Build the display dot list for one clip.
 *
 * Each active logical channel (and each split component) gets its own
 * dedicated horizontal row so labels and diamonds never share a Y level.
 * `stack` = row index (0 = bottom). Returns `{ dots, maxStack, rowLabels }`.
 *
 * rowLabels: [{ key, abbr, row }] — used to render left-edge channel labels.
 */
function buildClipDots(clip) {
  if (!clip?.channels) return { dots: [], maxStack: 1, rowLabels: [] };
  const dots = [];
  const rowLabels = [];
  let row = 0;

  for (const name of KF_CHANNELS) {
    const ch = clip.channels[name];
    if (!ch) continue;

    if (ch.split && ch.perComp) {
      // Split: one row per active component (x/y for vec2, r/g/b for rgb)
      const comps = name === 'tint' ? ['r', 'g', 'b'] : ['x', 'y'];
      for (const comp of comps) {
        const sub = ch.perComp[comp];
        if (!sub?.keys?.length) continue;
        for (let i = 0; i < sub.keys.length; i++) {
          const k = sub.keys[i];
          dots.push({ channel: name, comp, idx: i, kid: k.kid, t: k.t, v: k.v, stack: row });
        }
        rowLabels.push({ key: `${name}.${comp}`, abbr: `${CH_ABBR[name]}.${comp}`, row });
        row++;
      }
    } else if (ch.keys?.length) {
      // Linked: one row for the whole channel
      for (let i = 0; i < ch.keys.length; i++) {
        const k = ch.keys[i];
        dots.push({ channel: name, comp: null, idx: i, kid: k.kid, t: k.t, v: k.v, stack: row });
      }
      rowLabels.push({ key: name, abbr: CH_ABBR[name], row });
      row++;
    }
  }

  // Stable render order (by row, then stable kid) — NOT by time. Diamonds are
  // positioned by CSS `left`, so time order is irrelevant to layout, and a
  // time-based order would reshuffle the DOM nodes whenever a dragged key
  // crosses a neighbour, dropping its pointer capture mid-drag.
  dots.sort((a, b) => a.stack - b.stack || String(a.kid ?? '').localeCompare(String(b.kid ?? '')));
  return { dots, maxStack: row || 1, rowLabels };
}

/**
 * Group a clip's keyframes by (≈equal) time into summary columns. Each column
 * is `{ t, members: [{ channel, comp, idx, kid }] }`. Used for the flattened
 * (unselected) clip display — one diamond per time — and for the expanded
 * clip's top summary row, which drags every key at that time together.
 */
function clipSummaryColumns(clip) {
  const { dots } = buildClipDots(clip);
  const groups = new Map();
  for (const d of dots) {
    const tk = d.t.toFixed(4);
    if (!groups.has(tk)) groups.set(tk, { t: d.t, members: [] });
    groups.get(tk).members.push({ channel: d.channel, comp: d.comp ?? null, idx: d.idx, kid: d.kid });
  }
  return [...groups.values()].sort((a, b) => a.t - b.t);
}

/**
 * Single-scroll-container timeline. Layout:
 *
 *   ┌── header ───────────────────────────────────────────┐
 *   │ ▶ ⏸ ⏹  00:00 / 00:05  duration[…]  + marker         │
 *   ├──────────────┬──────────────────────────────────────┤
 *   │ name (label) │ ruler (sticky to lanes-scroll x)     │  ← row index 0
 *   │ L1 wins      │ [== clip ==]                         │  ← row index 1
 *   │ L2 bg        │     [== clip ==]                     │  ← row index 2
 *   └──────────────┴──────────────────────────────────────┘
 *
 * Left "labels" column is in its own flex item (does not scroll). The
 * lanes side owns horizontal scrolling for ruler + every lane row, so
 * dragging the playhead on the ruler scrolls in sync with the lanes
 * automatically.
 *
 * Per §19 we only render tracks that actually exist in `scene.flow.tracks`.
 * Layers without a track stay invisible here — the hierarchy panel is
 * the place to see them. Step 3 of the redesign will wire up
 * drag-from-hierarchy to *create* tracks; until then, the legacy
 * "+ clip on selected" button keeps working as a fallback.
 */
export function TimelinePanel({
  scene,
  flowState,
  timelines = [],
  activeTimelineId = null,
  onSelectTimeline,
  onAddTimeline,
  onRenameTimeline,
  onRemoveTimeline,
  selectedLayerId,
  selectedLayerAssetType,
  selectedClipId,
  selectedClipIds = [],
  selectedKey,
  selectedKeys = [],
  assetDescriptors = {},
  autoKey = true,
  onToggleAutoKey,
  onAddKeys,
  onSelectLayer,
  onSelectClip,
  onSelectClips,
  onSelectKey,
  onSelectKeys,
  onMoveKey,
  onTransformKeys,
  onDeleteKey,
  onMoveKeyByFrame,
  onPatchFlow,
  onFlowAction
}) {
  const fps = scene.stage.fps || 60;
  const duration = clampFinite(scene.stage.duration, 0.01, 300, 5);

  const tracks = scene.flow?.tracks || [];
  const lanesScrollRef = useRef(null);
  const scrubbingRef = useRef(false);
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [dragPreview, setDragPreview] = useState(null);
  // Two independent "magnet" modes, both on by default:
  //  - stickPlayheadToItems: while scrubbing, the playhead snaps to keyframes
  //    and clip starts/ends.
  //  - stickItemsToPlayhead: while dragging clips/keyframes, they snap to the
  //    current playhead time.
  const [stickPlayheadToItems, setStickPlayheadToItems] = useState(true);
  const [stickItemsToPlayhead, setStickItemsToPlayhead] = useState(true);
  const totalW = Math.max(600, Math.min(36000, Math.round(duration * pxPerSec)));
  const setFlow = useCallback((nextFlow) => onPatchFlow?.(nextFlow), [onPatchFlow]);

  // Zoom-aware gridlines (seconds / sub-second / per-frame). The ruler labels
  // the second + sub-second lines; the lane overlay draws all three faintly.
  const gridlines = useMemo(() => buildGridlines(duration, pxPerSec, fps), [duration, pxPerSec, fps]);
  const rulerTicks = useMemo(() => gridlines.filter((g) => g.level !== 'frame'), [gridlines]);

  // Manual vs automatic timeline length. Once the user types a length, the
  // scene flips to manual and clips are bounded by it; otherwise the length
  // auto-grows/shrinks to the content (handled in SceneStudioInner) and clips
  // may extend up to the absolute cap so a drag can grow the timeline.
  const manualDuration = !!scene.stage?.manualDuration;
  const dragMax = manualDuration ? duration : 300;

  // Per-track row height. A track stays a compact single row UNLESS it holds the
  // selected clip — then it expands to fit that clip's full per-channel keyframe
  // rows (Unity AnimationTrack style); its other clips flatten to a summary row.
  const trackHeights = useMemo(() => {
    const m = new Map();
    for (const track of tracks) {
      const expandedClip = (track.clips || []).find((c) => c.id === selectedClipId && c.channels);
      m.set(track.id, expandedClip ? expandedTrackHeight(expandedClip) : ROW_H);
    }
    return m;
  }, [tracks, selectedClipId]);
  const heightOf = (track) => trackHeights.get(track.id) || ROW_H;

  const defaultClipDurationForLayer = useCallback((layerId, speed = 1, animOverride = null, spinnerAction = null) => {
    const layer = scene.layers.find((l) => l.id === layerId);
    if (!layer) return 1;
    const asset = scene.assets.find((a) => a.id === layer.assetId);
    if (asset?.type === 'spinner') {
      // 'spin' clips default to the configured min spin time; other actions use
      // their fixed defaults.
      if ((spinnerAction || 'spin') === 'spin') {
        const mst = Number(asset.spinner?.timing?.minSpinTime);
        if (Number.isFinite(mst) && mst > 0) return mst;
      }
      return spinnerActionDuration(spinnerAction || 'spin');
    }
    if (asset?.type === 'winseq') {
      const config = normalizeWinSeqConfig(asset.winseq);
      const flow = findWinSeqFlow(config, animOverride);
      if (!flow) return 1;
      const durations = assetDescriptors?.[asset.id]?.animationDurations || {};
      return Math.max(0.05, winSeqFlowDuration(flow, durations, { hangOnLastIdle: false }));
    }
    if (asset?.type !== 'spine') return 1;
    const animName = animOverride || layer.spine?.defaultAnimation || null;
    if (!animName) return 1;
    const rawDur = Number(assetDescriptors?.[asset.id]?.animationDurations?.[animName]);
    const speedSafe = Number.isFinite(Number(speed)) && Number(speed) > 0 ? Number(speed) : 1;
    if (!Number.isFinite(rawDur) || rawDur <= 0) return 1;
    return Math.max(0.05, rawDur / speedSafe);
  }, [scene.layers, scene.assets, assetDescriptors]);

  const defaultClipForLayer = useCallback((layerId, slot, spinnerAction = null) => {
    const layer = scene.layers.find((l) => l.id === layerId);
    const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
    const isSpinner = asset?.type === 'spinner';
    const isWinSeq = asset?.type === 'winseq';
    const base = {
      id: uid('C'),
      name: null,
      start: slot.start,
      duration: slot.duration,
      anim: null,
      // New clips default to "hold last frame" (loop = false); the inspector's
      // loop/hold toggle flips this per clip.
      loop: false,
      curve: 'linear',
      speed: 1,
      mixDuration: null,
      // Spine AnimationState track index (see sceneModel.js). Default 0; the
      // clip badge / inspector let the artist bump it to mix animations.
      track: 0,
      autoFitDuration: !isSpinner && !isWinSeq
    };
    if (isSpinner) {
      base.action = spinnerAction || 'startSpin';
      base.spinner = null;
    }
    if (isWinSeq) {
      // Default to the first generated flow; the clip inspector lets the artist
      // pick another and refit the duration.
      const config = normalizeWinSeqConfig(asset.winseq);
      const flow = config?.sequences?.[0] || null;
      base.winseq = { sequenceId: flow?.id || null, hangOnLastIdle: false };
    }
    return base;
  }, [scene.layers, scene.assets]);

  /**
   * Free slot at the playhead for the ghost "New Clip" preview on `track`.
   * Unlike findFreeSlot, this does NOT push the slot past a clip the playhead
   * is inside — when the playhead sits over an existing clip it returns null so
   * the ghost simply isn't drawn. Only genuine free space (empty track or a gap
   * between clips, with at least ADJACENT_ADD_MIN_GAP of room) yields a slot.
   */
  const ghostSlotForTrack = (track) => {
    if (!track) return null;
    const start = flowState.time;
    for (const c of track.clips || []) {
      if (start >= c.start && start < c.start + c.duration) return null; // inside a clip
    }
    const layer = scene.layers.find((l) => l.id === track.layerId);
    const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
    const isSpinner = asset?.type === 'spinner';
    const spinnerAction = isSpinner ? nextActionForSpinnerTrack(track.clips) : null;
    const wantedDuration = defaultClipDurationForLayer(track.layerId, 1, null, spinnerAction);
    // Trim against the next clip on the track / end of timeline.
    let maxEnd = duration;
    for (const c of [...(track.clips || [])].sort((a, b) => a.start - b.start)) {
      if (c.start >= start) { maxEnd = Math.min(maxEnd, c.start); break; }
    }
    const dur = Math.min(wantedDuration, maxEnd - start);
    if (dur < ADJACENT_ADD_MIN_GAP) return null; // not enough room
    return { start, duration: dur };
  };

  /**
   * Drop a "New Clip" at the playhead on `track`, at exactly the ghost slot
   * (so clicking the ghost matches what it previews). Spinner tracks get the
   * contextually-next action.
   */
  const createNewClipOnTrack = (track) => {
    const slot = ghostSlotForTrack(track);
    if (!slot) return;
    const layer = scene.layers.find((l) => l.id === track.layerId);
    const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
    const isSpinner = asset?.type === 'spinner';
    const spinnerAction = isSpinner ? nextActionForSpinnerTrack(track.clips) : null;
    addClipToTrack(track.id, slot, null, isSpinner ? { action: spinnerAction } : null);
  };

  /**
   * Does the drag event carry our hierarchy-layer sentinel? Browsers
   * expose the MIME types via dataTransfer.types during dragover even
   * though the actual data is sealed until drop, so we can use it to
   * gate `e.preventDefault()` (= "this drop is acceptable").
   */
  const isLayerDrag = (e) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    if (typeof types.includes === 'function') return types.includes('application/x-ygg-layer-id');
    return Array.from(types).indexOf('application/x-ygg-layer-id') >= 0;
  };

  const layerIdFromDrop = (e) => {
    try {
      return e.dataTransfer.getData('application/x-ygg-layer-id')
        || e.dataTransfer.getData('text/plain') || null;
    } catch { return null; }
  };

  /**
   * Find a free slot of `slotDuration` seconds starting at `prefStart`
   * that does not collide with existing clips on the same track. If no
   * slot of full length fits in the remaining timeline, shrink it.
   * Returns { start, duration } or null when the timeline is too full.
   */
  // `maxBound` caps where a slot may end. Defaults to the current timeline
  // length, but callers adding after the last clip on an auto-length timeline
  // pass `dragMax` so the new clip can extend past the end (the timeline then
  // auto-grows to fit it — see SceneStudioInner).
  const findFreeSlot = (track, prefStart, slotDuration = 1, maxBound = duration) => {
    const clips = [...(track?.clips || [])].sort((a, b) => a.start - b.start);
    let start = clamp(prefStart, 0, Math.max(0, maxBound - 0.05));
    // Push start past any clip that contains it
    for (const c of clips) {
      if (start >= c.start && start < c.start + c.duration) start = c.start + c.duration;
    }
    if (start >= maxBound) return null;
    // Trim against the next clip / end of bound
    let maxEnd = maxBound;
    for (const c of clips) {
      if (c.start >= start) { maxEnd = Math.min(maxEnd, c.start); break; }
    }
    const dur = Math.max(0.05, Math.min(slotDuration, maxEnd - start));
    if (dur < 0.05) return null;
    return { start, duration: dur };
  };

  /**
   * Compute the scene time corresponding to a clientX value relative to
   * the lanes-scroll viewport, honouring horizontal scroll position.
   * Used by both scrubbing AND drop-position calculation.
   */
  const sceneXFromClient = (clientX) => {
    const wrap = lanesScrollRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    const z = elementZoom(wrap); // undo CSS ui-scale zoom on the pointer term
    // Lane content starts after the frozen label column inside the scroller.
    const xInScroll = (clientX - rect.left) / z + wrap.scrollLeft - LABEL_COL_W;
    return clamp(xInScroll / pxPerSec, 0, duration);
  };

  const computeDropPreview = (targetTrack, e) => {
    const at = sceneXFromClient(e.clientX);
    const layerId = layerIdFromDrop(e);
    if (!targetTrack) {
      if (!layerId) {
        return { kind: 'newTrack', at, slot: { start: at, duration: 1 }, label: 'new track' };
      }
      const tempTrack = { id: '__preview__', layerId, clips: [] };
      const slot = findFreeSlot(tempTrack, at, 1);
      return {
        kind: 'newTrack',
        at,
        layerId,
        slot: slot || null,
        label: slot ? `new track · ${fmtSec(slot.start)}–${fmtSec(slot.start + slot.duration)}` : 'no free slot'
      };
    }
    const droppingToSameLayer = !layerId || layerId === targetTrack.layerId;
    if (droppingToSameLayer) {
      const slot = findFreeSlot(targetTrack, at, 1);
      return {
        kind: 'addClip',
        at,
        trackId: targetTrack.id,
        layerId: targetTrack.layerId,
        slot: slot || null,
        label: slot ? `add clip · ${fmtSec(slot.start)}–${fmtSec(slot.start + slot.duration)}` : 'no free slot on track'
      };
    }
    const tempTrack = { id: '__preview__', layerId, clips: [] };
    const slot = findFreeSlot(tempTrack, at, 1);
    return {
      kind: 'newTrack',
      at,
      layerId,
      slot: slot || null,
      label: slot ? `new track · ${fmtSec(slot.start)}–${fmtSec(slot.start + slot.duration)}` : 'no free slot'
    };
  };

  const clearDragPreview = () => setDragPreview(null);

  const onLaneDragOver = (e) => {
    if (!isLayerDrag(e)) return;
    e.preventDefault();
    // MUST match the `effectAllowed` set by the hierarchy on drag start.
    // Hierarchy uses 'move' for reparenting, and the browser refuses the
    // drop (no-drop cursor) when dropEffect is outside that set. We're
    // not copying the layer — we're *placing* it on the timeline — so
    // 'move' is also the right semantic.
    e.dataTransfer.dropEffect = 'move';
  };

  const onTrackLaneDragOver = (track) => (e) => {
    onLaneDragOver(e);
    if (!isLayerDrag(e)) return;
    setDragPreview(computeDropPreview(track, e));
  };

  const onEmptyAreaDragOver = (e) => {
    onLaneDragOver(e);
    if (!isLayerDrag(e)) return;
    setDragPreview(computeDropPreview(null, e));
  };

  /** Drop on an existing track lane: add a clip in that track. */
  const onLaneDrop = (track) => (e) => {
    if (!isLayerDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDragPreview();
    const layerId = layerIdFromDrop(e);
    if (!layerId) return;
    // If the dropped layer differs from the track's layer, route to
    // "new track" instead — dropping warstwa A na lane warstwy B
    // tworzy nowy track dla A na końcu listy.
    if (layerId !== track.layerId) {
      createTrackForLayer(layerId, sceneXFromClient(e.clientX));
      return;
    }
    const slot = findFreeSlot(track, sceneXFromClient(e.clientX), 1);
    if (!slot) return;
    addClipToTrack(track.id, slot);
  };

  /** Drop on empty area (no track yet, or below all tracks): new track. */
  const onEmptyAreaDrop = (e) => {
    if (!isLayerDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDragPreview();
    const layerId = layerIdFromDrop(e);
    if (!layerId) return;
    createTrackForLayer(layerId, sceneXFromClient(e.clientX));
  };

  const createTrackForLayer = (layerId, atTime) => {
    const newTrack = { id: uid('T'), layerId, name: null, clips: [] };
    const wantedDuration = defaultClipDurationForLayer(layerId);
    const slot = findFreeSlot(newTrack, atTime, wantedDuration);
    if (!slot) return;
    // PNG clips start with no `channels` — the user enables a chip
    // ("animate: x") in the inspector once they want to keyframe a
    // property. Auto-pre-filling them every-prop-checked was the
    // top complaint about the old tween model.
    const clip = defaultClipForLayer(layerId, slot);
    newTrack.clips.push(clip);
    setFlow({ ...(scene.flow || {}), tracks: [...tracks, newTrack] });
    onSelectLayer?.(layerId);
  };

  const addClipToTrack = (trackId, slot, extraChannels = null, extraProps = null, allowGrow = false) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    const spinnerAction = extraProps?.action || null;
    // Honour an inherited anim/speed (adjacent-add copies the source clip) so
    // the new clip is sized to that animation's cycle, not the generic 1s.
    const animOverride = extraProps?.anim ?? null;
    const speedOverride = Number.isFinite(Number(extraProps?.speed)) && Number(extraProps?.speed) > 0 ? Number(extraProps.speed) : 1;
    const wantedDuration = defaultClipDurationForLayer(track.layerId, speedOverride, animOverride, spinnerAction);
    // When growing past the end of an auto-length timeline, let the slot reach
    // up to dragMax instead of clamping to the current length.
    const maxBound = (allowGrow && !manualDuration) ? dragMax : duration;
    const resolved = findFreeSlot(track, slot.start, wantedDuration, maxBound) || slot;
    const clip = { ...defaultClipForLayer(track.layerId, resolved, spinnerAction) };
    if (extraChannels && Object.keys(extraChannels).length) clip.channels = extraChannels;
    if (extraProps) Object.assign(clip, extraProps);
    const nextTracks = tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) }
        : t
    );
    setFlow({ ...(scene.flow || {}), tracks: nextTracks });
  };

  /**
   * Build static (single-key) channels capturing the bordering state of a
   * clip, so an adjacent clip "holds" that pose. Left side = the clip's START
   * value (so the object waits at point A before the clip); right side = the
   * clip's END value (waits at point B after). Covers every animated channel
   * (position incl. path mode, scale, rotation, alpha, tint).
   */
  const seedChannelsFromClipEdge = (clip, side) => {
    const src = clip?.channels;
    if (!src) return null;
    const localT = side === 'left' ? 0 : Math.max(0, Number(clip.duration) || 0);
    const out = {};
    for (const name of CHANNEL_NAMES) {
      const ch = src[name];
      if (!ch) continue;
      const animated = ch.keys?.length
        || (ch.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length))
        || isPathChannel(ch);
      if (!animated) continue;
      const v = evalChannel(ch, localT, name);
      if (v == null) continue;
      out[name] = { keys: [{ t: 0, v, out: 'linear' }] };
    }
    return Object.keys(out).length ? out : null;
  };

  /** Add an empty track to a layer. Used by the "+" button on label cells. */
  const addTrackForLayer = (layerId) => {
    const newTrack = { id: uid('T'), layerId, name: null, clips: [] };
    setFlow({ ...(scene.flow || {}), tracks: [...tracks, newTrack] });
    onSelectLayer?.(layerId);
  };

  /** Remove a track + its clips. */
  const removeTrack = (trackId) => {
    setFlow({ ...(scene.flow || {}), tracks: tracks.filter((t) => t.id !== trackId) });
  };

  /**
   * Move a track up (dir -1) or down (dir +1) in the array — i.e. above/below
   * an adjacent track. Array order = the row stacking order, and for spine
   * layers it also breaks a same-index tie at runtime (later row wins).
   */
  const moveTrack = (trackId, dir) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= tracks.length) return;
    const next = [...tracks];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setFlow({ ...(scene.flow || {}), tracks: next });
  };

  const patchClip = (trackId, clipId, rawPatch) => {
    // Auto-fit: when a picker changes the animation / win-sequence / spinner
    // action and the caller didn't set a duration explicitly, snap the clip
    // length to the freshly-selected content (no manual "set time" click).
    let patch = rawPatch;
    if (!Object.prototype.hasOwnProperty.call(rawPatch, 'duration') &&
        (Object.prototype.hasOwnProperty.call(rawPatch, 'anim') ||
         Object.prototype.hasOwnProperty.call(rawPatch, 'action') ||
         Object.prototype.hasOwnProperty.call(rawPatch, 'winseq'))) {
      const track = tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      const layer = track ? scene.layers.find((l) => l.id === track.layerId) : null;
      const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
      if (clip && asset) {
        const fit = fittedClipDuration(asset, { ...clip, ...rawPatch }, layer, assetDescriptors?.[asset.id]);
        if (Number.isFinite(fit) && fit > 0) patch = { ...rawPatch, duration: fit };
      }
    }
    const nextTracks = tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          const nc = { ...c, ...patch };
          // Bound to dragMax: the manual length when set, else the absolute cap
          // so a drag can push the clip past the current (auto) length and grow it.
          nc.start = clampFinite(nc.start, 0, dragMax, c.start);
          nc.duration = clampFinite(nc.duration, 0.05, dragMax, c.duration);
          // Keyframe-bounds guard: a clip can't be shrunk past its furthest
          // key. For a left-edge resize (start + duration both change, right
          // edge fixed) we re-derive start so the right edge stays put.
          const maxKeyT = maxChannelKeyTime(c.channels);
          if (maxKeyT > 0 && nc.duration < maxKeyT) {
            const rightEdgePreserved =
              Object.prototype.hasOwnProperty.call(patch, 'start') &&
              Object.prototype.hasOwnProperty.call(patch, 'duration') &&
              Math.abs((c.start + c.duration) - (patch.start + patch.duration)) < 1e-3;
            nc.duration = maxKeyT;
            if (rightEdgePreserved) nc.start = Math.max(0, (c.start + c.duration) - nc.duration);
          }
          nc.loop = !!nc.loop;
          if (Object.prototype.hasOwnProperty.call(patch, 'duration')) nc.autoFitDuration = false;
          nc.speed = clampFinite(Number(nc.speed), 0.01, 100, c.speed ?? 1);
          if (nc.mixDuration == null || nc.mixDuration === '') nc.mixDuration = null;
          else nc.mixDuration = clampFinite(Number(nc.mixDuration), 0, 10, c.mixDuration ?? 0);
          return nc;
        }).sort((a, b) => a.start - b.start)
      };
    });
    setFlow({ ...(scene.flow || {}), tracks: nextTracks });
  };

  useEffect(() => {
    if (!tracks.length) return;
    let changed = false;
    const nextTracks = tracks.map((track) => {
      const layer = scene.layers.find((l) => l.id === track.layerId);
      if (!layer) return track;
      const asset = scene.assets.find((a) => a.id === layer.assetId);
      if (asset?.type !== 'spine') return track;
      const durations = assetDescriptors?.[asset.id]?.animationDurations;
      if (!durations || typeof durations !== 'object') return track;
      const ordered = [...(track.clips || [])].sort((a, b) => a.start - b.start);
      let trackChanged = false;
      const clips = ordered.map((clip, idx) => {
        if (!clip.autoFitDuration) return clip;
        const anim = clip.anim || layer.spine?.defaultAnimation || null;
        if (!anim) return clip;
        const rawDur = Number(durations[anim]);
        if (!Number.isFinite(rawDur) || rawDur <= 0) return clip;
        const speedSafe = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
        const nextStart = clip.start;
        // The LAST clip on an auto-length timeline may fit to its full anim
        // cycle and push the timeline out (auto-grow follows). Using the current
        // `duration` here would clamp a freshly-added end clip to ~0s, since it
        // starts exactly at the old timeline end.
        const isLastClip = idx === ordered.length - 1;
        const rightBound = !isLastClip ? ordered[idx + 1].start : (manualDuration ? duration : dragMax);
        const target = Math.max(0.05, Math.min(rawDur / speedSafe, Math.max(0.05, rightBound - nextStart)));
        trackChanged = true;
        changed = true;
        return { ...clip, duration: target, autoFitDuration: false };
      });
      return trackChanged ? { ...track, clips } : track;
    });
    if (changed) setFlow({ ...(scene.flow || {}), tracks: nextTracks });
  }, [tracks, scene.layers, scene.assets, scene.flow, assetDescriptors, duration, setFlow]);

  const insertAdjacentClip = (track, clip, side) => {
    const siblings = [...(track.clips || [])].sort((a, b) => a.start - b.start);
    const idx = siblings.findIndex((c) => c.id === clip.id);
    if (idx < 0) return;
    const leftBound = idx > 0 ? siblings[idx - 1].start + siblings[idx - 1].duration : 0;
    const rightBound = idx < siblings.length - 1 ? siblings[idx + 1].start : duration;
    // For spinner tracks, determine the contextually correct next action.
    const layer = scene.layers.find((l) => l.id === track.layerId);
    const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
    const isSpinner = asset?.type === 'spinner';
    const isSpine = asset?.type === 'spine';
    const isWinSeq = asset?.type === 'winseq';
    const spinnerAction = isSpinner ? nextSpinnerAction(clip.action || 'startSpin') : null;
    // Spine: the new clip inherits the source clip's animation + speed, so it's
    // a meaningful full-cycle clip the user can re-point — not a 1s stub.
    const inheritSpeed = isSpine && Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    // Win-seq: inherit the source clip's flow + hang flag so the adjacent clip
    // is a meaningful full-sequence clip, sized to the same flow.
    const winseqOverride = isWinSeq && clip.winseq
      ? { sequenceId: clip.winseq.sequenceId ?? null, hangOnLastIdle: clip.winseq.hangOnLastIdle === true }
      : null;
    const extraProps = isSpinner ? { action: spinnerAction }
      : isSpine ? { anim: clip.anim ?? null, speed: inheritSpeed }
      : isWinSeq ? { winseq: winseqOverride }
      : null;
    const wantedDuration = defaultClipDurationForLayer(
      track.layerId, inheritSpeed,
      isSpine ? (clip.anim ?? null) : isWinSeq ? (clip.winseq?.sequenceId ?? null) : null,
      spinnerAction
    );
    const seeded = isSpinner ? null : seedChannelsFromClipEdge(clip, side);
    if (side === 'left') {
      const gap = clip.start - leftBound;
      if (gap < ADJACENT_ADD_MIN_GAP) return;
      const d = Math.min(wantedDuration, gap);
      addClipToTrack(track.id, { start: clip.start - d, duration: d }, seeded, extraProps);
      return;
    }
    const clipEnd = clip.start + clip.duration;
    // Adding after the LAST clip on an auto-length timeline extends the
    // timeline by the new clip's duration (auto-grow follows it). Otherwise the
    // new clip is bounded by the next clip / the manual timeline length.
    const isLast = idx === siblings.length - 1;
    const allowGrow = isLast && !manualDuration;
    const rightCap = allowGrow ? dragMax : rightBound;
    const gap = rightCap - clipEnd;
    if (gap < ADJACENT_ADD_MIN_GAP) return;
    const d = Math.min(wantedDuration, gap);
    addClipToTrack(track.id, { start: clipEnd, duration: d }, seeded, extraProps, allowGrow);
  };

  /**
   * Snap a `start` value to:
   *   - any other clip's start / end on the SAME track
   *   - any marker time
   *   - the current scrubber time
   *   - the nearest integer second
   *   - clip duration boundaries (so total ≤ scene duration)
   * Snap is disabled when `disable === true` (Alt held). Threshold is
   * 6 screen pixels expressed in scene time.
   *
   * Returns the snapped value plus the snap target name (for guides).
   */
  const snapTime = (value, ownClipId, ownTrackId, disable) => {
    if (disable) return value;
    const targets = [];
    targets.push(0);
    targets.push(duration);
    // Snap clip edges to the playhead only when the "stick items → playhead"
    // magnet is on (Alt still disables all snapping via `disable`).
    if (stickItemsToPlayhead) targets.push(flowState.time);
    const ownTrack = tracks.find((t) => t.id === ownTrackId);
    for (const c of ownTrack?.clips || []) {
      if (c.id === ownClipId) continue;
      targets.push(c.start);
      targets.push(c.start + c.duration);
    }
    // Integer seconds in a small window so we don't blow up the cost
    const lo = Math.max(0, Math.floor(value) - 2);
    const hi = Math.min(duration, Math.ceil(value) + 2);
    for (let s = lo; s <= hi; s++) targets.push(s);
    const threshold = 6 / pxPerSec;
    let best = value;
    let bestDiff = threshold;
    for (const t of targets) {
      const d = Math.abs(t - value);
      if (d <= bestDiff) { best = t; bestDiff = d; }
    }
    return best;
  };

  const setTimelineZoom = useCallback((nextPx) => {
    const wrap = lanesScrollRef.current;
    const prev = pxPerSec;
    const clamped = clampFinite(Number(nextPx), MIN_PX_PER_SEC, MAX_PX_PER_SEC, prev);
    if (!wrap || !Number.isFinite(clamped) || clamped === prev) {
      setPxPerSec(clamped);
      return;
    }
    // Keep the time under the viewport center stable across zoom. Lane content
    // is offset by the frozen label column, so factor LABEL_COL_W in/out.
    const centerTime = (wrap.scrollLeft + wrap.clientWidth / 2 - LABEL_COL_W) / prev;
    setPxPerSec(clamped);
    requestAnimationFrame(() => {
      const target = Math.max(0, LABEL_COL_W + centerTime * clamped - wrap.clientWidth / 2);
      wrap.scrollLeft = target;
    });
  }, [pxPerSec]);

  const onTimelineZoomInput = (e) => {
    setTimelineZoom(Number(e.target.value));
  };

  useEffect(() => {
    const wrap = lanesScrollRef.current;
    if (!wrap) return;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;
      // Alt+wheel = vertical scroll of the timeline lanes
      if (e.altKey) {
        e.preventDefault();
        wrap.scrollTop += e.deltaY > 0 ? 40 : -40;
        return;
      }
      e.preventDefault();
      // Multiplicative so the feel is even across the wide 30–1440 range.
      const next = pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
      setTimelineZoom(next);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [pxPerSec, setTimelineZoom]);

  // ── Scrubber: drag the playhead by pointer on the ruler / lanes ──
  //
  // We listen at the lanes-scroll level so a press on either the ruler
  // row or a lane row counts. Clip elements `stopPropagation` so they
  // don't initiate scrubbing while being moved (step 4 wires that).
  const timeFromClientX = useCallback((clientX) => {
    const wrap = lanesScrollRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    const z = elementZoom(wrap);
    // Lane content starts after the frozen label column inside the scroller.
    const xInScroll = (clientX - rect.left) / z + wrap.scrollLeft - LABEL_COL_W;
    return clamp(xInScroll / pxPerSec, 0, duration);
  }, [duration, pxPerSec]);

  // Mode A — the playhead snaps to every keyframe time and clip start/end.
  const playheadSnapTargets = useMemo(() => {
    const out = [];
    for (const track of tracks) {
      for (const c of track.clips || []) {
        out.push(c.start, c.start + c.duration);
        for (const d of buildClipDots(c).dots) out.push(c.start + d.t);
      }
    }
    return out;
  }, [tracks]);

  const snapPlayhead = useCallback((t) => {
    if (!stickPlayheadToItems || !playheadSnapTargets.length) return t;
    const threshold = 8 / pxPerSec;
    let best = t;
    let bestDiff = threshold;
    for (const target of playheadSnapTargets) {
      const d = Math.abs(target - t);
      if (d <= bestDiff) { best = target; bestDiff = d; }
    }
    return best;
  }, [stickPlayheadToItems, playheadSnapTargets, pxPerSec]);

  const onScrubPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    // Skip drags that originated on a clip — clips own their own pointers.
    if (e.target.closest('.scene-clip')) return;
    scrubbingRef.current = true;
    onFlowAction?.('seek', snapPlayhead(timeFromClientX(e.clientX)));
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }, [onFlowAction, timeFromClientX, snapPlayhead]);

  const onScrubPointerMove = useCallback((e) => {
    if (!scrubbingRef.current) return;
    onFlowAction?.('seek', snapPlayhead(timeFromClientX(e.clientX)));
  }, [onFlowAction, timeFromClientX, snapPlayhead]);

  const onScrubPointerUp = useCallback((e) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  // ── Clip multi-selection ────────────────────────────────────────────
  const selectedSet = useMemo(() => new Set(selectedClipIds || []), [selectedClipIds]);

  /**
   * Resolve a clip click (with modifiers) into a new selection.
   *   - plain click  → single select
   *   - ctrl/⌘ click → toggle membership
   *   - shift click  → range within the same track as the current primary
   */
  const handleClipClick = (track, clip, e) => {
    const additive = e?.ctrlKey || e?.metaKey;
    const range = e?.shiftKey;
    if (range && selectedClipId) {
      const primaryTrack = tracks.find((t) => t.clips?.some((c) => c.id === selectedClipId));
      if (primaryTrack && primaryTrack.id === track.id) {
        const sorted = [...track.clips].sort((a, b) => a.start - b.start);
        const i1 = sorted.findIndex((c) => c.id === selectedClipId);
        const i2 = sorted.findIndex((c) => c.id === clip.id);
        if (i1 >= 0 && i2 >= 0) {
          const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
          onSelectClips?.(sorted.slice(lo, hi + 1).map((c) => c.id), clip.id);
          return;
        }
      }
      onSelectClips?.([clip.id], clip.id);
      return;
    }
    if (additive) {
      const set = new Set(selectedSet);
      if (set.has(clip.id)) set.delete(clip.id);
      else set.add(clip.id);
      const ids = [...set];
      onSelectClips?.(ids, set.has(clip.id) ? clip.id : (ids.length ? ids[ids.length - 1] : null));
      return;
    }
    onSelectClips?.([clip.id], clip.id);
  };

  // ── Group move: drag any selected clip to translate the whole set ────
  const groupDragRef = useRef(null);
  const beginGroupMove = useCallback(() => {
    const idSet = new Set(selectedClipIds || []);
    const snap = [];
    for (const track of tracks) {
      for (const c of track.clips || []) {
        if (idSet.has(c.id)) snap.push({ trackId: track.id, id: c.id, start: c.start, duration: c.duration });
      }
    }
    groupDragRef.current = { snap, idSet };
  }, [selectedClipIds, tracks]);

  const updateGroupMove = useCallback((deltaT) => {
    const g = groupDragRef.current;
    if (!g) return;
    // Tightest common delta so no selected clip overlaps a non-selected sibling.
    let minDelta = -Infinity;
    let maxDelta = Infinity;
    for (const track of tracks) {
      const others = (track.clips || []).filter((c) => !g.idSet.has(c.id));
      for (const item of g.snap) {
        if (item.trackId !== track.id) continue;
        const cs = item.start;
        const ce = item.start + item.duration;
        let minStart = 0;
        let maxEnd = dragMax;
        for (const s of others) {
          const sEnd = s.start + s.duration;
          if (sEnd <= cs) minStart = Math.max(minStart, sEnd);
          else if (s.start >= ce) maxEnd = Math.min(maxEnd, s.start);
        }
        minDelta = Math.max(minDelta, minStart - cs);
        maxDelta = Math.min(maxDelta, maxEnd - ce);
      }
    }
    const d = Math.max(minDelta, Math.min(maxDelta, deltaT));
    const startMap = new Map(g.snap.map((it) => [it.id, it.start]));
    const nextTracks = tracks.map((track) => {
      if (!(track.clips || []).some((c) => g.idSet.has(c.id))) return track;
      return {
        ...track,
        clips: track.clips
          .map((c) => (startMap.has(c.id) ? { ...c, start: clamp(startMap.get(c.id) + d, 0, dragMax) } : c))
          .sort((a, b) => a.start - b.start)
      };
    });
    setFlow({ ...(scene.flow || {}), tracks: nextTracks });
  }, [tracks, dragMax, scene.flow, setFlow]);

  const endGroupMove = useCallback(() => { groupDragRef.current = null; }, []);

  // ── Marquee selection on empty lane body ────────────────────────────
  const marqueeRef = useRef(null);
  const [marquee, setMarquee] = useState(null); // { x0, y0, x1, y1 } in lanes content px
  const panRef = useRef(null); // middle-mouse pan { x, y, sl, st, pointerId }

  const lanesContentPoint = (clientX, clientY) => {
    const wrap = lanesScrollRef.current;
    const rect = wrap.getBoundingClientRect();
    const z = elementZoom(wrap);
    return {
      x: (clientX - rect.left) / z + wrap.scrollLeft,
      y: (clientY - rect.top) / z + wrap.scrollTop
    };
  };

  const onLanesPointerDown = useCallback((e) => {
    // Middle-mouse drag = pan the timeline (both axes), like the scene view.
    if (e.button === 1) {
      e.preventDefault();
      const wrap = lanesScrollRef.current;
      panRef.current = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop, pointerId: e.pointerId };
      try { wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button !== 0) return;
    // Clips own their pointers; the frozen label column + sticky ruler are not
    // part of the lane body — ignore presses on any of them.
    if (e.target.closest('.scene-clip')
      || e.target.closest('.scene-timeline-label-cell')
      || e.target.closest('.scene-timeline-ruler-row')) return;
    const p = lanesContentPoint(e.clientX, e.clientY);
    marqueeRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, pointerId: e.pointerId };
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    try { lanesScrollRef.current.setPointerCapture(e.pointerId); } catch {}
  }, []);

  const onLanesPointerMove = useCallback((e) => {
    const pan = panRef.current;
    if (pan) {
      const wrap = lanesScrollRef.current;
      const z = elementZoom(wrap);
      wrap.scrollLeft = pan.sl - (e.clientX - pan.x) / z;
      wrap.scrollTop = pan.st - (e.clientY - pan.y) / z;
      return;
    }
    const st = marqueeRef.current;
    if (!st) return;
    const p = lanesContentPoint(e.clientX, e.clientY);
    if (!st.moved && (Math.abs(p.x - st.x0) > 3 || Math.abs(p.y - st.y0) > 3)) st.moved = true;
    st.x1 = p.x; st.y1 = p.y;
    setMarquee({ x0: st.x0, y0: st.y0, x1: p.x, y1: p.y });
  }, []);

  const onLanesPointerUp = useCallback((e) => {
    if (panRef.current) {
      try { lanesScrollRef.current.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      panRef.current = null;
      return;
    }
    const st = marqueeRef.current;
    if (!st) return;
    marqueeRef.current = null;
    try { lanesScrollRef.current.releasePointerCapture(e.pointerId); } catch {}
    setMarquee(null);
    if (!st.moved) {
      // Bare click on empty space clears the selection.
      onSelectClips?.([], null);
      return;
    }
    const minX = Math.min(st.x0, st.x1);
    const maxX = Math.max(st.x0, st.x1);
    const minY = Math.min(st.y0, st.y1);
    const maxY = Math.max(st.y0, st.y1);
    // Content X includes the frozen label column; Y includes the ruler header.
    const minT = (minX - LABEL_COL_W) / pxPerSec;
    const maxT = (maxX - LABEL_COL_W) / pxPerSec;
    const hits = [];
    let top = RULER_H;
    for (const track of tracks) {
      const h = heightOf(track);
      const tTop = top;
      const tBot = top + h;
      top += h;
      if (tBot < minY || tTop > maxY) continue;
      for (const c of track.clips || []) {
        const cs = c.start;
        const ce = c.start + c.duration;
        if (ce < minT || cs > maxT) continue;
        hits.push(c.id);
      }
    }
    onSelectClips?.(hits, hits.length ? hits[hits.length - 1] : null);
  // heightOf reads trackHeights which is derived from tracks; deps cover it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, pxPerSec, onSelectClips]);

  // Note: clips are deleted via the Delete / Backspace key (handled in
  // SceneStudioInner) — single or multi-selected. The old per-clip ✕ button
  // was removed in favour of keyboard delete + marquee selection.

  useEffect(() => {
    const onEnd = () => clearDragPreview();
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    return () => {
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
    };
  }, []);

  useEffect(() => {
    const wrap = lanesScrollRef.current;
    if (!wrap) return;
    const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    if (wrap.scrollLeft > max) {
      wrap.scrollLeft = max;
    }
  }, [totalW, pxPerSec]);

  useEffect(() => {
    if (!dragPreview?.layerId) return;
    onSelectLayer?.(dragPreview.layerId);
  }, [dragPreview?.layerId, onSelectLayer]);

  // ── Track / clip labelling ────────────────────────────────────────
  const labelForTrack = (track) => {
    const layer = scene.layers.find((l) => l.id === track.layerId);
    const layerName = layer?.name || '(missing layer)';
    const sameLayerTracks = tracks.filter((t) => t.layerId === track.layerId);
    if (sameLayerTracks.length <= 1) {
      return track.name ? `${layerName} · ${track.name}` : layerName;
    }
    const idx = sameLayerTracks.indexOf(track);
    return `${layerName} · ${track.name || `track ${idx + 1}`}`;
  };

  const labelForClip = (track, clip) => {
    if (clip.name) return clip.name;
    const layer = scene.layers.find((l) => l.id === track.layerId);
    const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
    if (asset?.type === 'spinner') return clip.action || 'spinner';
    if (asset?.type === 'winseq') {
      const flow = findWinSeqFlow(normalizeWinSeqConfig(asset.winseq), clip.winseq?.sequenceId);
      const tag = clip.winseq?.hangOnLastIdle ? ' (hang)' : '';
      return (flow?.label || clip.winseq?.sequenceId || 'win seq') + tag;
    }
    // Compute default: "<layer name> clip N"
    const sameTrackClips = track.clips || [];
    const clipIdx = sameTrackClips.findIndex((c) => c.id === clip.id);
    const defaultName = `${layer?.name || 'clip'} clip ${clipIdx + 1}`;
    if (asset?.type === 'spine') return defaultName;
    if (clip.channels) {
      const animated = [];
      for (const k of ['position', 'scale', 'rotation', 'alpha', 'tint']) {
        const ch = clip.channels[k];
        if (ch?.keys?.length || ch?.split) animated.push(k);
      }
      return animated.length ? animated.map((k) => k.slice(0, 3)).join(' · ') : defaultName;
    }
    return defaultName;
  };

  // Selection-state of a track row:
  //   'clip'  → a clip on this track is selected (yellow clip + accent row)
  //   'layer' → the track's object is selected but no clip is (gray/white row,
  //             so picking an object on stage/hierarchy instantly reveals its
  //             track)
  const trackSelState = (track) => {
    const hasClip = (track.clips || []).some((c) => selectedSet.has(c.id) || c.id === selectedClipId);
    if (hasClip) return 'clip';
    if (track.layerId === selectedLayerId) return 'layer';
    return null;
  };
  const selStateClass = (state) =>
    state === 'clip' ? ' selected' : state === 'layer' ? ' layer-selected' : '';

  // Selected object with no track yet → render a ghost track row with an
  // "add track" affordance so it can be added straight from the timeline.
  const selectedLayerHasTrack = tracks.some((t) => t.layerId === selectedLayerId);
  const ghostLayer = selectedLayerId && !selectedLayerHasTrack
    ? scene.layers.find((l) => l.id === selectedLayerId)
    : null;

  return (
    <div className="scene-timeline">
      <div className="scene-timeline-head">
        {/* Left: timeline picker + controls, then zoom. */}
        <div className="scene-timeline-left">
          <div className="scene-timeline-tl-picker">
            <select
              className="scene-toolbar-select"
              value={activeTimelineId || ''}
              onChange={(e) => onSelectTimeline?.(e.target.value)}
              title="Active timeline"
            >
              {timelines.map((tl) => (
                <option key={tl.id} value={tl.id}>{tl.name}</option>
              ))}
            </select>
            <button
              className="scene-btn scene-btn--sm"
              onClick={() => onAddTimeline?.()}
              title="Add a new timeline to this scene"
            >＋ tl</button>
            <button
              className="scene-btn scene-btn--sm"
              onClick={() => {
                const cur = timelines.find((t) => t.id === activeTimelineId);
                const name = window.prompt('Rename timeline', cur?.name || 'Timeline');
                if (name) onRenameTimeline?.(activeTimelineId, name);
              }}
              title="Rename active timeline"
            >✎</button>
            <button
              className="scene-btn scene-btn--sm"
              disabled={timelines.length <= 1}
              onClick={() => {
                if (window.confirm('Remove this timeline and all its clips?')) onRemoveTimeline?.(activeTimelineId);
              }}
              title={timelines.length <= 1 ? 'Cannot remove the only timeline' : 'Remove active timeline'}
            >🗑</button>
          </div>
          {/* Zoom slider removed — zoom with the mouse wheel over the timeline.
              Keep a compact readout for feedback. */}
          <span className="scene-timeline-zoom-readout" title="Timeline zoom — scroll the wheel over the timeline to change">
            {Math.round((pxPerSec / DEFAULT_PX_PER_SEC) * 100)}%
          </span>
        </div>

        {/* Center: playback transport + time readout. */}
        <div className="scene-timeline-center">
          <button className="scene-btn" onClick={() => onFlowAction?.('play')}>▶</button>
          <button className="scene-btn" onClick={() => onFlowAction?.('pause')}>⏸</button>
          <button className="scene-btn" onClick={() => onFlowAction?.('stop')}>⏹</button>
          <span className="scene-toolbar-tag">{fmtTime(flowState.time, fps)} / {fmtTime(duration, fps)}</span>
          {flowState.hold && <span className="scene-pill">hold: {flowState.hold.type}</span>}
        </div>

        {/* Right: keyframe tools, then timeline length + fps at the far right. */}
        <div className="scene-timeline-right">
          <button
            className={'scene-btn' + (stickPlayheadToItems ? ' scene-btn--primary' : '')}
            onClick={() => setStickPlayheadToItems((v) => !v)}
            title={stickPlayheadToItems
              ? 'Snap playhead ON — scrubbing snaps the playhead to keyframes and clip starts/ends. Click to turn off.'
              : 'Snap playhead OFF — the playhead scrubs freely. Click to snap it to keyframes & clip edges.'}
          >
            {stickPlayheadToItems ? '🧲 play' : '○ play'}
          </button>
          <button
            className={'scene-btn' + (stickItemsToPlayhead ? ' scene-btn--primary' : '')}
            onClick={() => setStickItemsToPlayhead((v) => !v)}
            title={stickItemsToPlayhead
              ? 'Snap to playhead ON — dragging clips/keyframes snaps them to the playhead. Click to turn off.'
              : 'Snap to playhead OFF — clips/keyframes drag freely past the playhead. Click to snap them to it.'}
          >
            {stickItemsToPlayhead ? '🧲 keys' : '○ keys'}
          </button>
          <button
            className={'scene-btn' + (autoKey ? ' scene-btn--primary' : '')}
            onClick={onToggleAutoKey}
            title={autoKey
              ? 'Auto-key ON — editing a transform while a clip is selected records a keyframe at the playhead. Click to turn off.'
              : 'Auto-key OFF — transform edits change the base pose only. Use "+ key" to record explicitly. Click to turn on.'}
          >
            {autoKey ? '⦿ auto-key' : '○ auto-key'}
          </button>
          <select
            className="scene-addkey-select"
            value=""
            disabled={!selectedClipId}
            onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) onAddKeys?.(v); }}
            title={selectedClipId
              ? 'Add a keyframe at the playhead for a specific property'
              : 'Select a clip first to add keyframes'}
          >
            <option value="" disabled>+ key…</option>
            <option value="all">key all</option>
            <option value="position">position (x, y)</option>
            <option value="position.x">position · x only</option>
            <option value="position.y">position · y only</option>
            <option value="scale">scale (x, y)</option>
            <option value="scale.x">scale · x only</option>
            <option value="scale.y">scale · y only</option>
            <option value="rotation">rotation</option>
            <option value="alpha">alpha</option>
            <option value="tint">tint</option>
          </select>
          {/* Frame-nav (← / →) and del-key buttons removed — arrow keys step the
              playhead and Delete removes the selected key(s). "New Clip" is now
              the in-lane ghost on the selected track, not a toolbar button. */}
          <label
            className="scene-timeline-length"
            title={manualDuration
              ? 'Timeline length (seconds) — set manually. Click "auto" to fit the content.'
              : 'Timeline length (seconds) — auto-fits the content. Type a value to set it manually.'}
          >
            <span>length</span>
            <NumberField
              className="scene-duration-input"
              step={0.5}
              min={0.5}
              max={300}
              value={Number(duration.toFixed(2))}
              disabled={!manualDuration}
              onChange={(v) => onFlowAction?.('setDuration', v)}
            />
            <button
              type="button"
              className={'scene-btn scene-btn--sm scene-length-auto' + (manualDuration ? '' : ' scene-btn--primary')}
              onClick={() => onFlowAction?.(manualDuration ? 'setDurationAuto' : 'setDuration', duration)}
              title={manualDuration ? 'Auto-fit the timeline length to the content' : 'Length is auto-fitting the content'}
            >
              auto
            </button>
          </label>
          <label className="scene-timeline-fps" title="Frames per second — affects keyframe snap and move-by-frame">
            <span>fps</span>
            <NumberField
              min={1}
              max={120}
              step={1}
              int
              value={fps}
              onChange={(v) => onFlowAction?.('setFps', v)}
            />
          </label>
        </div>
      </div>

      {/* Single 2-D scroll container. Each track is ONE flex row — a sticky-left
          label cell + its lane — so a label always lines up with its lane and
          scrolls vertically with it. The ruler is a sticky-top row whose corner
          is sticky on both axes; labels stay visible during horizontal scroll. */}
      <div
        ref={lanesScrollRef}
        className="scene-timeline-scroll"
        onPointerDown={onLanesPointerDown}
        onPointerMove={onLanesPointerMove}
        onPointerUp={onLanesPointerUp}
        onPointerCancel={onLanesPointerUp}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      >
        <div className="scene-timeline-grid" style={{ width: LABEL_COL_W + totalW }}>

          {/* Ruler — sticky top. Corner cell is sticky on both axes. */}
          <div className="scene-timeline-ruler-row" style={{ height: RULER_H }}>
            <div className="scene-timeline-label-cell scene-timeline-label-cell--ruler" style={{ width: LABEL_COL_W, height: RULER_H }}>
              <span className="scene-timeline-label-head">time</span>
            </div>
            <div
              className="scene-timeline-ruler"
              style={{ width: totalW, height: RULER_H }}
              onPointerDown={onScrubPointerDown}
              onPointerMove={onScrubPointerMove}
              onPointerUp={onScrubPointerUp}
              onPointerCancel={onScrubPointerUp}
            >
              {rulerTicks.map((t) => (
                <div
                  key={t.value}
                  className={'scene-tick' + (t.level === 'sub' ? ' scene-tick--sub' : '')}
                  style={{ left: t.value * pxPerSec }}
                >
                  <span>{fmtTickLabel(t.value)}</span>
                </div>
              ))}
              <div className="scene-playhead" style={{ left: flowState.time * pxPerSec, top: 0, bottom: 0 }} />
            </div>
          </div>

          {tracks.length === 0 && !ghostLayer ? (
            <div className="scene-timeline-row" style={{ height: ROW_H }}>
              <div className="scene-timeline-label-cell scene-timeline-label-empty" style={{ width: LABEL_COL_W, height: ROW_H }}>
                no tracks
              </div>
              <div
                className={'scene-timeline-empty-row' + (dragPreview?.kind === 'newTrack' ? ' drag-over' : '')}
                style={{ height: ROW_H, width: totalW }}
                onDragOver={onEmptyAreaDragOver}
                onDrop={onEmptyAreaDrop}
              >
                {dragPreview?.kind === 'newTrack'
                  ? dragPreview.label
                  : 'drop a layer from the hierarchy onto this strip to create a track'}
                {dragPreview?.kind === 'newTrack' && dragPreview.slot && (
                  <div
                    className="scene-drop-preview-clip"
                    style={{ left: dragPreview.slot.start * pxPerSec, width: Math.max(8, dragPreview.slot.duration * pxPerSec) }}
                  />
                )}
              </div>
            </div>
          ) : tracks.map((track) => (
            <div key={track.id} className="scene-timeline-row" style={{ height: heightOf(track) }}>
              <div
                className={'scene-timeline-label-cell' + selStateClass(trackSelState(track))}
                style={{ width: LABEL_COL_W, height: heightOf(track) }}
                onClick={() => onSelectLayer?.(track.layerId)}
                title={labelForTrack(track)}
              >
                <span className="scene-timeline-label-text">{labelForTrack(track)}</span>
                <button
                  className="scene-icon-btn scene-track-action"
                  title="Move this track up (above the track over it)"
                  disabled={tracks.indexOf(track) === 0}
                  onClick={(e) => { e.stopPropagation(); moveTrack(track.id, -1); }}
                >
                  ▲
                </button>
                <button
                  className="scene-icon-btn scene-track-action"
                  title="Move this track down (below the track under it)"
                  disabled={tracks.indexOf(track) === tracks.length - 1}
                  onClick={(e) => { e.stopPropagation(); moveTrack(track.id, 1); }}
                >
                  ▼
                </button>
                <button
                  className="scene-icon-btn scene-track-action"
                  title="Add another track for this layer"
                  onClick={(e) => { e.stopPropagation(); addTrackForLayer(track.layerId); }}
                >
                  +
                </button>
                <button
                  className="scene-icon-btn scene-track-action scene-track-action--remove"
                  title="Remove this track and all its clips"
                  onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                >
                  ✕
                </button>
              </div>
              <div
                className={'scene-timeline-lane' + (dragPreview?.trackId === track.id ? ' drag-over' : '') + selStateClass(trackSelState(track))}
                style={{ height: heightOf(track), width: totalW }}
                onDragOver={onTrackLaneDragOver(track)}
                onDrop={onLaneDrop(track)}
              >
                {dragPreview?.trackId === track.id && dragPreview.slot && (
                  <div
                    className="scene-drop-preview-clip"
                    style={{ left: dragPreview.slot.start * pxPerSec, width: Math.max(8, dragPreview.slot.duration * pxPerSec) }}
                  />
                )}
                {/* "New Clip" ghost — at the playhead on EVERY row of the
                    selected object (not just one), so a clip can be added to any
                    track. Only shows where there's a free slot at the playhead. */}
                {track.layerId === selectedLayerId && !dragPreview && (() => {
                  const slot = ghostSlotForTrack(track);
                  if (!slot) return null;
                  return (
                    <button
                      className="scene-clip-ghost"
                      style={{ left: slot.start * pxPerSec, width: Math.max(8, slot.duration * pxPerSec) }}
                      title={`New Clip · ${fmtSec(slot.start)}–${fmtSec(slot.start + slot.duration)} — click to add`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); createNewClipOnTrack(track); }}
                    >
                      ＋ New Clip
                    </button>
                  );
                })()}
                {track.clips.map((c) => {
                  const trackLayer = scene.layers.find((l) => l.id === track.layerId);
                  const trackAsset = trackLayer ? scene.assets.find((a) => a.id === trackLayer.assetId) : null;
                  const isSpine = trackAsset?.type === 'spine';
                  const isSpinner = trackAsset?.type === 'spinner';
                  const isWinSeq = trackAsset?.type === 'winseq';
                  const spineAnimations = isSpine
                    ? (assetDescriptors?.[trackAsset.id]?.animations || [])
                    : [];
                  const winseqFlows = isWinSeq
                    ? (normalizeWinSeqConfig(trackAsset.winseq)?.sequences || [])
                    : [];
                  return (
                    <ClipBlock
                      key={c.id}
                      clip={c}
                      label={labelForClip(track, c)}
                      isSpine={isSpine}
                      isSpinner={isSpinner}
                      isWinSeq={isWinSeq}
                      spineAnimations={spineAnimations}
                      winseqFlows={winseqFlows}
                      selected={selectedSet.has(c.id)}
                      primary={c.id === selectedClipId}
                      inMultiSelection={selectedSet.has(c.id) && selectedSet.size > 1}
                      duration={dragMax}
                      pxPerSec={pxPerSec}
                      flowTime={flowState.time}
                      stickToPlayhead={stickItemsToPlayhead}
                      siblings={track.clips.filter((other) => other.id !== c.id)}
                      onSelect={(e) => handleClipClick(track, c, e)}
                      onPatch={(patch) => patchClip(track.id, c.id, patch)}
                      onGroupMoveBegin={beginGroupMove}
                      onGroupMoveUpdate={updateGroupMove}
                      onGroupMoveEnd={endGroupMove}
                      snapTime={(value, disable) => snapTime(value, c.id, track.id, disable)}
                      onAddLeft={() => insertAdjacentClip(track, c, 'left')}
                      onAddRight={() => insertAdjacentClip(track, c, 'right')}
                      selectedKey={selectedKey}
                      selectedKeys={selectedKeys}
                      onSelectKey={(clipId, name, idx, comp, t) => {
                        onSelectClip?.(clipId);
                        onSelectKey?.({ clipId, name, idx, comp });
                        if (typeof t === 'number') onFlowAction?.('seek', c.start + t);
                      }}
                      onSelectKeys={(clipId, list, primary) => {
                        onSelectClip?.(clipId);
                        onSelectKeys?.(
                          list.map((k) => ({ clipId, ...k })),
                          primary ? { clipId, ...primary } : null
                        );
                      }}
                      onMoveKey={(clipId, name, idx, comp, newT) => onMoveKey?.(clipId, name, idx, comp, newT)}
                      onTransformKeys={onTransformKeys}
                      onSeekClipLocal={(localT) => onFlowAction?.('seek', c.start + localT)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {ghostLayer && (
            <div className="scene-timeline-row" style={{ height: ROW_H }}>
              <div
                className="scene-timeline-label-cell scene-timeline-label-cell--ghost layer-selected"
                style={{ width: LABEL_COL_W, height: ROW_H }}
                title={`${ghostLayer.name} has no track yet — add one`}
              >
                <span className="scene-timeline-label-text">{ghostLayer.name}</span>
                <button
                  className="scene-icon-btn scene-track-action"
                  title="Add a track for this object"
                  onClick={(e) => { e.stopPropagation(); addTrackForLayer(ghostLayer.id); }}
                >
                  +
                </button>
              </div>
              <div
                className="scene-timeline-lane scene-timeline-lane--ghost layer-selected"
                style={{ height: ROW_H, width: totalW }}
              >
                {/* New-Clip ghost at the playhead — one click creates the track
                    AND a clip on it (the common case), instead of an empty track
                    you then have to populate. Falls back to a centered button
                    when the playhead has no free slot. */}
                {(() => {
                  const slot = ghostSlotForTrack({ id: '__ghost__', layerId: ghostLayer.id, clips: [] });
                  if (!slot) {
                    return (
                      <button
                        className="scene-btn scene-btn--sm scene-timeline-ghost-add"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); addTrackForLayer(ghostLayer.id); }}
                        title="Add a track for this object so you can animate it"
                      >
                        ＋ add track for “{ghostLayer.name}”
                      </button>
                    );
                  }
                  return (
                    <button
                      className="scene-clip-ghost"
                      style={{ left: slot.start * pxPerSec, width: Math.max(8, slot.duration * pxPerSec) }}
                      title={`New Clip · ${fmtSec(slot.start)}–${fmtSec(slot.start + slot.duration)} — click to add a track + clip`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); createTrackForLayer(ghostLayer.id, flowState.time); }}
                    >
                      ＋ New Clip
                    </button>
                  );
                })()}
              </div>
            </div>
          )}

          {tracks.length > 0 && (
            <div className="scene-timeline-row" style={{ height: 22 }}>
              <div
                className="scene-timeline-label-cell scene-timeline-label-cell--filler"
                style={{ width: LABEL_COL_W, height: 22 }}
                title="Drop a layer onto the lane on the right to create a new track"
              >
                <span className="scene-timeline-label-text">drop layer →</span>
              </div>
              <div
                className={'scene-timeline-lane scene-timeline-lane--add' + (dragPreview?.kind === 'newTrack' ? ' drag-over' : '')}
                style={{ height: 22, width: totalW }}
                onDragOver={onEmptyAreaDragOver}
                onDrop={onEmptyAreaDrop}
              >
                {dragPreview?.kind === 'newTrack' ? dragPreview.label : 'drop here to add a new track'}
                {dragPreview?.kind === 'newTrack' && dragPreview.slot && (
                  <div
                    className="scene-drop-preview-clip"
                    style={{ left: dragPreview.slot.start * pxPerSec, width: Math.max(8, dragPreview.slot.duration * pxPerSec) }}
                  />
                )}
              </div>
            </div>
          )}

          {marquee && (
            <div
              className="scene-marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0)
              }}
            />
          )}

          {/* Lane gridlines (seconds / sub-second / per-frame) — faint, over the
              lanes, beneath the playhead. Offset past the frozen label column. */}
          <div
            className="scene-timeline-gridlines"
            style={{ left: LABEL_COL_W, top: RULER_H, width: totalW }}
          >
            {gridlines.map((g) => (
              <div
                key={g.value}
                className={`scene-gridline scene-gridline--${g.level}`}
                style={{ left: g.value * pxPerSec }}
              />
            ))}
          </div>

          {/* Global playhead spanning the lane area (offset past the label col). */}
          <div
            className="scene-playhead"
            style={{ left: LABEL_COL_W + flowState.time * pxPerSec, top: RULER_H, bottom: 0 }}
          />
        </div>
      </div>

    </div>
  );
}

/**
 * Single draggable clip block. Three interaction zones:
 *   - left ~6 px:  resize start (right edge stays put)
 *   - right ~6 px: resize end   (left edge stays put)
 *   - middle:      move whole clip
 *
 * Snap targets and Alt-to-disable come from the parent. We mutate
 * scene state every pointermove via `onPatch` — the live feel is
 * the whole point, and React absorbs the churn fine because the
 * patch is just one clip swap inside a small array.
 */
const EDGE_HIT_PX = 6;
const EDGE_GUARD_PX = 12;

const CH_ABBR = { position: 'pos', scale: 'sca', rotation: 'rot', alpha: 'α', tint: 'tint' };

const SPINNER_ACTION_COLOR = { startSpin: '#4a8', spin: '#48c', stopSpin: '#c86', presentWin: '#c5a', holdResult: '#88a' };

function ClipBlock({ clip, label, isSpine, isSpinner, isWinSeq = false, spineAnimations = [], winseqFlows = [], selected, primary, inMultiSelection, duration, siblings = [], pxPerSec, flowTime = 0, stickToPlayhead = false, onSelect, onPatch, onGroupMoveBegin, onGroupMoveUpdate, onGroupMoveEnd, snapTime, onAddLeft, onAddRight, selectedKey, selectedKeys = [], onSelectKey, onSelectKeys, onMoveKey, onTransformKeys, onSeekClipLocal }) {
  const ref = useRef(null);
  const dragRef = useRef(null);
  const sorted = [...siblings].sort((a, b) => a.start - b.start);
  let leftGap = clip.start;
  let rightGap = duration - (clip.start + clip.duration);
  for (const s of sorted) {
    const sEnd = s.start + s.duration;
    if (sEnd <= clip.start) leftGap = Math.min(leftGap, clip.start - sEnd);
    else if (s.start >= clip.start + clip.duration) { rightGap = Math.min(rightGap, s.start - (clip.start + clip.duration)); break; }
  }
  const canAddLeft = leftGap >= ADJACENT_ADD_MIN_GAP;
  const canAddRight = rightGap >= ADJACENT_ADD_MIN_GAP;

  /**
   * Compute the tightest [minStart, maxEnd] window the clip is allowed
   * to occupy without overlapping a sibling on the same track. Anchored
   * to the clip's ORIGINAL position so a slow drag past a sibling
   * doesn't tunnel through it — the sibling becomes a hard wall.
   */
  const neighbourBounds = (origStart, origEnd) => {
    let minStart = 0;
    let maxEnd = duration;
    for (const s of siblings) {
      const sEnd = s.start + s.duration;
      if (sEnd <= origStart) minStart = Math.max(minStart, sEnd);
      else if (s.start >= origEnd) maxEnd = Math.min(maxEnd, s.start);
    }
    return { minStart, maxEnd };
  };

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    let mode;
    if (px <= EDGE_HIT_PX + EDGE_GUARD_PX) mode = 'resizeStart';
    else if (px >= rect.width - (EDGE_HIT_PX + EDGE_GUARD_PX)) mode = 'resizeEnd';
    else mode = 'move';
    const plain = !(e.ctrlKey || e.metaKey || e.shiftKey);
    // Group move: dragging a clip that's part of a multi-selection (plain
    // click, move zone) translates the whole set. Selection is DEFERRED to
    // pointer-up so a plain click on an already-selected clip doesn't collapse
    // the set before the drag can start.
    const willGroup = plain && inMultiSelection && mode === 'move';
    if (!willGroup) onSelect?.(e);
    dragRef.current = {
      mode,
      startClientX: e.clientX,
      origStart: clip.start,
      origDuration: clip.duration,
      origChannels: clip.channels,
      pointerId: e.pointerId,
      group: willGroup,
      deferredSelect: willGroup,
      moved: false
    };
    if (willGroup) onGroupMoveBegin?.();
    try { ref.current.setPointerCapture(e.pointerId); } catch {}
  }, [clip.start, clip.duration, onSelect, inMultiSelection, onGroupMoveBegin]);

  const onPointerMove = useCallback((e) => {
    const st = dragRef.current;
    if (!st) return;
    const deltaT = (e.clientX - st.startClientX) / rootZoom() / pxPerSec;
    if (!st.moved && Math.abs(e.clientX - st.startClientX) > 3) st.moved = true;
    if (st.group) { onGroupMoveUpdate?.(deltaT); return; }
    const altDisableSnap = e.altKey;
    const origEnd = st.origStart + st.origDuration;
    const { minStart, maxEnd } = neighbourBounds(st.origStart, origEnd);
    let nextStart = st.origStart;
    let nextDuration = st.origDuration;

    let shiftKeys = 0; // clip-local seconds to add to every key (left-resize only)

    if (st.mode === 'move') {
      const lo = minStart;
      const hi = Math.max(lo, maxEnd - st.origDuration);
      nextStart = clamp(st.origStart + deltaT, lo, hi);
      nextStart = clamp(snapTime(nextStart, altDisableSnap), lo, hi);
    } else if (st.mode === 'resizeStart') {
      const lo = minStart;
      const hi = origEnd - 0.05;
      let raw = clamp(st.origStart + deltaT, lo, hi);
      raw = clamp(snapTime(raw, altDisableSnap), lo, hi);
      nextStart = raw;
      nextDuration = origEnd - raw;
      // Keep keys at their absolute scene time: when start moves by Δ, add Δ to
      // every key's clip-local time (computed from the drag-start snapshot).
      shiftKeys = st.origStart - nextStart;
    } else if (st.mode === 'resizeEnd') {
      const lo = st.origStart + 0.05;
      const hi = maxEnd;
      let rawEnd = clamp(origEnd + deltaT, lo, hi);
      rawEnd = clamp(snapTime(rawEnd, altDisableSnap), lo, hi);
      nextDuration = rawEnd - st.origStart;
    }

    const patch = { start: nextStart, duration: nextDuration };
    if (st.mode === 'resizeStart' && st.origChannels) {
      patch.channels = shiftClipChannels(st.origChannels, shiftKeys, nextDuration);
    }
    onPatch?.(patch);
  }, [duration, onPatch, snapTime, siblings, pxPerSec, onGroupMoveUpdate]);

  const onPointerUp = useCallback((e) => {
    const st = dragRef.current;
    if (!st) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch {}
    if (st.group) {
      onGroupMoveEnd?.();
      // No drag happened → collapse the multi-selection to this clip.
      if (!st.moved && st.deferredSelect) onSelect?.({ ctrlKey: false, metaKey: false, shiftKey: false });
    }
    dragRef.current = null;
  }, [onGroupMoveEnd, onSelect]);

  // Cursor changes by hover zone so users see the resize affordance
  const onPointerMoveHover = useCallback((e) => {
    if (dragRef.current) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    let cursor = 'grab';
    if (px <= EDGE_HIT_PX + EDGE_GUARD_PX || px >= rect.width - (EDGE_HIT_PX + EDGE_GUARD_PX)) cursor = 'ew-resize';
    if (ref.current.style.cursor !== cursor) ref.current.style.cursor = cursor;
  }, []);

  return (
    <div
      ref={ref}
      className={'scene-clip' + (selected ? ' selected' : '') + (primary ? ' primary' : '') + (isSpinner && clip.action ? ` scene-clip--spinner-${clip.action}` : '')}
      style={{
        left: clip.start * pxPerSec,
        width: Math.max(8, clip.duration * pxPerSec),
        borderTopColor: isSpinner && clip.action ? SPINNER_ACTION_COLOR[clip.action] : undefined
      }}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { onPointerMove(e); onPointerMoveHover(e); }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {selected && canAddLeft && (
        <button
          className="scene-icon-btn scene-clip-add scene-clip-add--left"
          title="Add clip on the left"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAddLeft?.(); }}
        >
          +
        </button>
      )}
      <div className="scene-clip-edge scene-clip-edge--left" />
      <div className="scene-clip-body">
        <div className="scene-clip-body-line">
          {/* Per-clip Spine AnimationState track — shown to the LEFT, in front of
              the name. Higher number draws on top; clips on different tracks mix.
              Decoupled from the timeline row. */}
          {isSpine && (
            <label
              className="scene-clip-track"
              title="Spine track — higher number draws on top. Clips on different tracks play together (mix)."
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="scene-clip-track-tag">T</span>
              <NumberField
                min={0}
                max={64}
                step={1}
                int
                value={Number.isFinite(Number(clip.track)) ? Math.floor(Number(clip.track)) : 0}
                onChange={(v) => onPatch?.({ track: v })}
              />
            </label>
          )}
          {isSpinner ? (
            <select
              className="scene-clip-spine-select"
              value={clip.action || ''}
              title="Spinner action"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); onPatch?.({ action: e.target.value || null }); }}
            >
              <option value="">— action —</option>
              {SPINNER_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          ) : isSpine && spineAnimations.length > 0 ? (
            <select
              className="scene-clip-spine-select"
              value={clip.anim || ''}
              title="Animation"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); onPatch?.({ anim: e.target.value || null }); }}
            >
              <option value="">(setup pose)</option>
              {spineAnimations.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          ) : isWinSeq && winseqFlows.length > 0 ? (
            <select
              className="scene-clip-spine-select"
              value={clip.winseq?.sequenceId || ''}
              title="Win sequence"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onPatch?.({ winseq: { sequenceId: e.target.value || null, hangOnLastIdle: clip.winseq?.hangOnLastIdle === true } });
              }}
            >
              {winseqFlows.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          ) : (
            <span className="scene-clip-label" title={label}>{label}</span>
          )}
        </div>
        {/* channel abbreviations are rendered inside ClipKeyframeDots at the Y level of each channel's first keyframe */}
      </div>
      <ClipKeyframeDots
        clip={clip}
        expanded={primary}
        pxPerSec={pxPerSec}
        flowTime={flowTime}
        stickToPlayhead={stickToPlayhead}
        selectedKeys={selectedKeys}
        onSelectKey={onSelectKey}
        onSelectKeys={onSelectKeys}
        onTransformKeys={onTransformKeys}
        onSeekClipLocal={onSeekClipLocal}
      />
      <div className="scene-clip-edge scene-clip-edge--right" />
      {selected && canAddRight && (
        <button
          className="scene-icon-btn scene-clip-add scene-clip-add--right"
          title="Add clip on the right"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAddRight?.(); }}
        >
          +
        </button>
      )}
    </div>
  );
}

/**
 * Render diamond markers on a clip block at each keyframe's clip-local
 * time, color-coded by logical channel (position / scale / rotation).
 *
 *   - Click selects the keyframe + seeks the playhead to it.
 *   - Horizontal drag moves the key's `t` (clamped to the clip's range
 *     and to neighbouring keys).
 *   - The selected diamond gets a white outline.
 *
 * Wrapper has `pointer-events: none` so empty bands don't block the
 * clip's own drag/resize; each diamond re-enables its own events.
 */
const DOT_BIG = 15;
const DOT_SM = 11;

function fmtKeyVal(v) {
  if (typeof v === 'number') return v.toFixed(2);
  if (v && typeof v === 'object' && typeof v.x === 'number') return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)})`;
  if (v && typeof v === 'object' && typeof v.r === 'number') return `rgb(${v.r.toFixed(2)}, ${v.g.toFixed(2)}, ${v.b.toFixed(2)})`;
  return String(v);
}

/**
 * Keyframe band for a single clip. Two modes:
 *
 *   - FLAT (unselected clip): every channel's keys collapse to ONE summary
 *     diamond per distinct time, on a single centred row — decorative, so the
 *     clip reads cleanly. Selecting the clip is how you start editing its keys.
 *   - EXPANDED (the selected clip): full per-channel rows rendered BIG with
 *     large hit areas, plus a Unity-style summary row on top whose diamonds
 *     drag every key at that time together. Marquee box-select, group move,
 *     and edge-scale all operate here. Keys are identified by stable `kid`, so
 *     a selected set drags freely past non-selected neighbours.
 */
function ClipKeyframeDots({
  clip, expanded, pxPerSec, flowTime = 0, stickToPlayhead = false, selectedKeys = [], onSelectKey, onSelectKeys, onTransformKeys, onSeekClipLocal
}) {
  const bandRef = useRef(null);
  const dotDragRef = useRef(null);     // group move via dragging a selected dot / summary col
  const handleDragRef = useRef(null);  // scale via selection-box edge handle
  const marqueeRef = useRef(null);
  const [marquee, setMarquee] = useState(null); // band-local { x0,y0,x1,y1 }

  const { dots, maxStack, rowLabels } = buildClipDots(clip);
  const summary = clipSummaryColumns(clip);
  if (!dots.length) return null;

  const idOf = (d) => ({ name: d.channel, comp: d.comp ?? null, idx: d.idx, kid: d.kid });
  const selList = (selectedKeys || []).filter((k) => k.clipId === clip.id);
  const selSet = new Set(selList.map((k) => k.kid).filter((k) => k != null));
  const isSel = (kid) => selSet.has(kid);
  const selListBare = () => selList.map((k) => ({ name: k.name, comp: k.comp ?? null, idx: k.idx, kid: k.kid }));

  // ── FLAT: one decorative summary diamond per distinct time ──
  if (!expanded) {
    return (
      <div className="scene-clip-keyframes scene-clip-keyframes--flat">
        {summary.map((col) => (
          <span
            key={col.t.toFixed(4)}
            className="scene-clip-keyframe scene-clip-keyframe--summary"
            style={{ left: `${col.t * pxPerSec}px` }}
          />
        ))}
      </div>
    );
  }

  // ── EXPANDED ──
  const bandH = expandedBandH(maxStack);
  const rowBaseline = (row) => EXP_BAND_BASE + row * EXP_ROW_H;
  const summaryBaseline = EXP_BAND_BASE + maxStack * EXP_ROW_H + EXP_BAND_GAP;
  const dotBottom = (baseline, slotH) => baseline + (slotH - DOT_BIG) / 2;
  const centreFromTop = (baseline, slotH) => bandH - (baseline + slotH / 2);

  const selDots = dots.filter((d) => isSel(d.kid));
  const hasSel = selDots.length > 0;
  const minSelT = hasSel ? Math.min(...selDots.map((d) => d.t)) : 0;
  const maxSelT = hasSel ? Math.max(...selDots.map((d) => d.t)) : 0;
  const canScale = selDots.length >= 2 && (maxSelT - minSelT) > 1e-3;

  // Snap the drag so the anchor key lands on the playhead when "stick items →
  // playhead" is on and the anchor is within a few px of it. `anchorT` is the
  // dragged key's clip-local time; returns the (possibly adjusted) delta.
  const snapDeltaToPlayhead = (anchorT, deltaT) => {
    if (!stickToPlayhead || anchorT == null) return deltaT;
    const threshold = 8 / pxPerSec;
    const anchorAbs = clip.start + anchorT + deltaT;
    if (Math.abs(anchorAbs - flowTime) <= threshold) return flowTime - clip.start - anchorT;
    return deltaT;
  };

  // ── Dragging a dot → move the whole selection (or just that dot) ──
  const dotDragBegin = (d) => {
    const inSel = isSel(d.kid);
    const list = inSel ? selListBare() : [idOf(d)];
    if (!inSel) onSelectKeys?.(clip.id, list, idOf(d)); // single-select for highlight
    dotDragRef.current = { snapshot: clip, list, anchorT: d.t };
  };
  const dotDragMove = (deltaT) => {
    const st = dotDragRef.current;
    if (!st) return;
    onTransformKeys?.(st.snapshot, st.list, { kind: 'move', delta: snapDeltaToPlayhead(st.anchorT, deltaT) });
  };
  const dotDragEnd = () => { dotDragRef.current = null; };

  const toggleKey = (d) => {
    const cur = selListBare();
    const exists = isSel(d.kid);
    const next = exists ? cur.filter((k) => k.kid !== d.kid) : [...cur, idOf(d)];
    onSelectKeys?.(clip.id, next, exists ? (next[next.length - 1] || null) : idOf(d));
  };

  // ── Summary row: drag a column to move EVERY key at that time together ──
  const summaryColList = (col) =>
    col.members.map((m) => ({ name: m.channel, comp: m.comp ?? null, idx: m.idx, kid: m.kid }));
  const summaryDragBegin = (col) => {
    const list = summaryColList(col);
    onSelectKeys?.(clip.id, list, list[list.length - 1] || null);
    dotDragRef.current = { snapshot: clip, list, anchorT: col.t };
  };
  const summaryClick = (col) => {
    const list = summaryColList(col);
    onSelectKeys?.(clip.id, list, list[list.length - 1] || null);
    onSeekClipLocal?.(col.t);
  };

  // ── Scale handles on the selection box ──
  const handleDown = (side) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    handleDragRef.current = {
      side, startX: e.clientX, snapshot: clip, list: selListBare(),
      span: maxSelT - minSelT, minSelT, maxSelT, pointerId: e.pointerId
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const handleMove = (e) => {
    const st = handleDragRef.current;
    if (!st || st.span <= 1e-4) return;
    const deltaT = (e.clientX - st.startX) / rootZoom() / pxPerSec;
    let pivot;
    let factor;
    if (st.side === 'right') { pivot = st.minSelT; factor = (st.span + deltaT) / st.span; }
    else { pivot = st.maxSelT; factor = (st.span - deltaT) / st.span; }
    factor = Math.max(0.05, factor);
    onTransformKeys?.(st.snapshot, st.list, { kind: 'scale', pivot, factor });
  };
  const handleUp = (e) => {
    if (!handleDragRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    handleDragRef.current = null;
  };

  // ── Dragging the selection-box BODY moves the whole selection ──
  const boxMoveDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    // Anchor on the selection's left edge so it can snap to the playhead.
    dotDragRef.current = { snapshot: clip, list: selListBare(), anchorT: minSelT };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dotDragRef.current.startX = e.clientX;
  };
  const boxMoveMove = (e) => {
    const st = dotDragRef.current;
    if (!st || st.startX == null) return;
    onTransformKeys?.(st.snapshot, st.list, { kind: 'move', delta: snapDeltaToPlayhead(st.anchorT, (e.clientX - st.startX) / rootZoom() / pxPerSec) });
  };
  const boxMoveUp = (e) => {
    if (!dotDragRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dotDragRef.current = null;
  };

  // ── Marquee selection over the band ──
  const bandLocal = (e) => {
    const r = bandRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const z = elementZoom(bandRef.current);
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };
  const marqueeDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = bandLocal(e);
    marqueeRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, pointerId: e.pointerId };
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const marqueeMove = (e) => {
    const st = marqueeRef.current;
    if (!st) return;
    const p = bandLocal(e);
    if (!st.moved && (Math.abs(p.x - st.x0) > 3 || Math.abs(p.y - st.y0) > 3)) st.moved = true;
    st.x1 = p.x; st.y1 = p.y;
    setMarquee({ x0: st.x0, y0: st.y0, x1: p.x, y1: p.y });
  };
  const marqueeUp = (e) => {
    const st = marqueeRef.current;
    if (!st) return;
    marqueeRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setMarquee(null);
    if (!st.moved) { onSelectKeys?.(clip.id, [], null); return; }
    const minX = Math.min(st.x0, st.x1);
    const maxX = Math.max(st.x0, st.x1);
    const minY = Math.min(st.y0, st.y1);
    const maxY = Math.max(st.y0, st.y1);
    const hits = dots.filter((d) => {
      const x = d.t * pxPerSec;
      const yTop = centreFromTop(rowBaseline(d.stack || 0), EXP_ROW_H);
      return x >= minX - 2 && x <= maxX + 2 && yTop >= minY - EXP_ROW_H && yTop <= maxY + EXP_ROW_H;
    }).map(idOf);
    onSelectKeys?.(clip.id, hits, hits.length ? hits[hits.length - 1] : null);
  };

  return (
    <div ref={bandRef} className="scene-clip-keyframes scene-clip-keyframes--expanded" style={{ height: bandH }}>
      {/* Marquee capture layer — below dots so they keep priority. */}
      <div
        className="scene-kf-marquee-capture"
        onPointerDown={marqueeDown}
        onPointerMove={marqueeMove}
        onPointerUp={marqueeUp}
        onPointerCancel={marqueeUp}
      />
      {/* Alternating per-channel row stripes */}
      {rowLabels.map(({ row }) => (
        <div
          key={`stripe-${row}`}
          className={`scene-clip-row-stripe scene-clip-row-stripe--${row % 2 === 0 ? 'a' : 'b'}`}
          style={{ bottom: rowBaseline(row), height: EXP_ROW_H }}
        />
      ))}
      {/* Summary row stripe (sits above the channel rows) */}
      <div
        className="scene-clip-row-stripe scene-clip-row-stripe--summary"
        style={{ bottom: summaryBaseline, height: EXP_SUMMARY_H }}
      />
      {rowLabels.map(({ key, abbr, row }) => (
        <span
          key={`lbl-${key}`}
          className={`scene-clip-ch-label scene-clip-ch-label--${key.split('.')[0]}`}
          style={{ bottom: rowBaseline(row) + 3 }}
        >
          {abbr}
        </span>
      ))}
      <span
        className="scene-clip-ch-label scene-clip-ch-label--summary"
        style={{ bottom: summaryBaseline + 4 }}
      >
        all
      </span>
      {/* Summary diamonds — drag a column to move every key at that time.
          Keyed by the column's member kids (stable while they move together)
          rather than its time, so the diamond never remounts mid-drag and keeps
          its pointer capture. */}
      {summary.map((col) => (
        <KeyframeDot
          key={`sum:${col.members.map((m) => m.kid).sort().join(',') || col.t.toFixed(4)}`}
          left={col.t * pxPerSec}
          bottom={dotBottom(summaryBaseline, EXP_SUMMARY_H)}
          big
          summary
          channel="summary"
          title={`${col.members.length} key(s) @ ${col.t.toFixed(2)}s — drag to move them all together`}
          selected={col.members.every((m) => isSel(m.kid)) && col.members.length > 0}
          pxPerSec={pxPerSec}
          onDragBegin={() => summaryDragBegin(col)}
          onDragMove={dotDragMove}
          onDragEnd={dotDragEnd}
          onClickNoDrag={() => summaryClick(col)}
        />
      ))}
      {/* Per-channel diamonds (big hit areas) */}
      {dots.map((d) => {
        const label = d.comp ? `${d.channel}.${d.comp}` : d.channel;
        return (
          <KeyframeDot
            key={d.kid ?? `${d.channel}:${d.comp ?? '_'}:${d.idx}`}
            left={d.t * pxPerSec}
            bottom={dotBottom(rowBaseline(d.stack || 0), EXP_ROW_H)}
            big
            channel={d.channel}
            title={`${label} = ${fmtKeyVal(d.v)} @ ${d.t.toFixed(2)}s — drag to move · ctrl-click to multi-select · marquee to box-select`}
            selected={isSel(d.kid)}
            pxPerSec={pxPerSec}
            onToggle={() => toggleKey(d)}
            onDragBegin={() => dotDragBegin(d)}
            onDragMove={dotDragMove}
            onDragEnd={dotDragEnd}
            onClickNoDrag={() => onSelectKey?.(clip.id, d.channel, d.idx, d.comp, d.t)}
          />
        );
      })}
      {/* Selection box: body = move all selected keys, edges = scale timing. */}
      {hasSel && (
        <div
          className="scene-kf-selbox"
          style={{ left: minSelT * pxPerSec, width: Math.max(1, (maxSelT - minSelT) * pxPerSec) }}
        >
          <div
            className="scene-kf-selbox-move"
            title="Drag to move the selected keyframes in time"
            onPointerDown={boxMoveDown}
            onPointerMove={boxMoveMove}
            onPointerUp={boxMoveUp}
            onPointerCancel={boxMoveUp}
          />
          {canScale && (
            <div
              className="scene-kf-selbox-edge scene-kf-selbox-edge--l"
              title="Drag to scale the selected keys' timing (slower/faster)"
              onPointerDown={handleDown('left')}
              onPointerMove={handleMove}
              onPointerUp={handleUp}
              onPointerCancel={handleUp}
            />
          )}
          {canScale && (
            <div
              className="scene-kf-selbox-edge scene-kf-selbox-edge--r"
              title="Drag to scale the selected keys' timing (slower/faster)"
              onPointerDown={handleDown('right')}
              onPointerMove={handleMove}
              onPointerUp={handleUp}
              onPointerCancel={handleUp}
            />
          )}
        </div>
      )}
      {marquee && (
        <div
          className="scene-kf-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0)
          }}
        />
      )}
    </div>
  );
}

function KeyframeDot({ left, bottom, big, summary, channel, title, selected, pxPerSec, onToggle, onDragBegin, onDragMove, onDragEnd, onClickNoDrag }) {
  const ref = useRef(null);
  const dragRef = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && onToggle) { onToggle(); return; } // additive toggle, no drag
    onDragBegin?.();
    dragRef.current = { startClientX: e.clientX, moved: false, pointerId: e.pointerId };
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e) => {
    const st = dragRef.current;
    if (!st) return;
    if (!st.moved && Math.abs(e.clientX - st.startClientX) < 3) return;
    st.moved = true;
    onDragMove?.((e.clientX - st.startClientX) / rootZoom() / pxPerSec);
  };
  const onPointerUp = (e) => {
    const st = dragRef.current;
    if (!st) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!st.moved) onClickNoDrag?.(); // plain click → select this key + seek
    onDragEnd?.();
    dragRef.current = null;
  };
  return (
    <span
      ref={ref}
      className={
        'scene-clip-keyframe'
        + (summary ? ' scene-clip-keyframe--summary' : ` scene-clip-keyframe--${channel}`)
        + (big ? ' scene-clip-keyframe--big' : '')
        + (selected ? ' is-selected' : '')
      }
      style={{ left: `${left}px`, bottom: `${bottom}px` }}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

function evaluateLayerAtTime(scene, layerId, atTime) {
  const layer = scene.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const base = layer.transforms?.[scene.stage.activeOrientation] || layer.transforms?.landscape;
  if (!base) return null;
  const pose = {
    x: Number(base.x) || 0,
    y: Number(base.y) || 0,
    scaleX: Number(base.scaleX ?? 1),
    scaleY: Number(base.scaleY ?? 1),
    rotation: Number(base.rotation || 0)
  };
  const tracks = (scene.flow?.tracks || []).filter((t) => t.layerId === layerId);
  for (const track of tracks) {
    const clip = (track.clips || []).find((c) => atTime >= c.start && atTime < c.start + c.duration);
    if (!clip?.tween) continue;
    const progress = computeClipProgress(clip, atTime);
    for (const prop of TWEEN_PROPS) {
      const from = clip.tween.from?.[prop] ?? pose[prop];
      const to = clip.tween.to?.[prop] ?? pose[prop];
      if (typeof from !== 'number' || typeof to !== 'number') continue;
      const curve = clip.tween.curves?.[prop] ?? clip.curve ?? 'linear';
      const eased = evalPresetCurve(curve, progress);
      pose[prop] = from + (to - from) * eased;
    }
  }
  return pose;
}

function computeClipProgress(clip, sceneTime) {
  const dur = Math.max(0.001, Number(clip.duration) || 0);
  const speed = Number.isFinite(Number(clip.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  let local = Math.max(0, sceneTime - clip.start) * speed;
  if (clip.loop) local = local % dur;
  else local = Math.min(local, dur);
  return local / dur;
}

function evalPresetCurve(curve, p) {
  const x = Math.max(0, Math.min(1, p));
  if (curve && typeof curve === 'object' && String(curve.type || '').toLowerCase() === 'custom') {
    const pts = Array.isArray(curve.points) ? curve.points : [];
    if (pts.length < 2) return x;
    const sorted = pts
      .map((pt) => ({ x: Number(pt?.x), y: Number(pt?.y) }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .sort((a, b) => a.x - b.x);
    if (sorted.length < 2) return x;
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (x > b.x) continue;
      const dx = b.x - a.x;
      if (dx <= 0.000001) return b.y;
      const t = (x - a.x) / dx;
      return a.y + (b.y - a.y) * t;
    }
    return x;
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

// ── Zoom-aware ruler ticks + gridlines ────────────────────────────────
const TICK_TARGET_PX = 76;   // desired spacing between labelled ticks
const FRAME_GRID_MIN_PX = 7; // only draw per-frame gridlines once frames are this wide

/** Smallest "nice" time step ≥ the target spacing at the current zoom. */
function niceTimeStep(pxPerSec, fps) {
  const raw = TICK_TARGET_PX / Math.max(1, pxPerSec);
  const frame = 1 / Math.max(1, fps);
  const candidates = [frame, 2 * frame, 5 * frame, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const c of candidates) if (c >= raw - 1e-9) return c;
  return candidates[candidates.length - 1];
}

function fmtTickLabel(value) {
  const n = Number(value.toFixed(3));
  return Number.isInteger(n) ? `${n}s` : `${n}s`;
}

/**
 * Build the timeline gridlines for the current zoom / fps. Returns
 * `[{ value, level }]` where level is:
 *   - 'second' : a whole-second line (strong, labelled in the ruler)
 *   - 'sub'    : a sub-second line at the chosen nice step (.25/.5/.75…)
 *   - 'frame'  : a per-frame line (faint), only emitted once frames are wide
 *               enough to read (FRAME_GRID_MIN_PX).
 * Deduped so a frame line never doubles a second/sub line.
 */
function buildGridlines(duration, pxPerSec, fps) {
  const out = [];
  const seen = new Set();
  const push = (value, level) => {
    const k = value.toFixed(4);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ value, level });
  };
  const step = niceTimeStep(pxPerSec, fps);
  for (let i = 0; i * step <= duration + 1e-6 && i < 1500; i++) {
    const v = i * step;
    push(v, Math.abs(v - Math.round(v)) < 1e-6 ? 'second' : 'sub');
  }
  if (!seen.has(duration.toFixed(4))) push(duration, 'sub');
  const frame = 1 / Math.max(1, fps);
  if (frame * pxPerSec >= FRAME_GRID_MIN_PX) {
    for (let i = 0; i * frame <= duration + 1e-6 && i < 4000; i++) push(i * frame, 'frame');
  }
  return out.sort((a, b) => a.value - b.value);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function clampFinite(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function fmtTime(sec, fps) {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60).toString().padStart(2, '0');
  const secs = Math.floor(s % 60).toString().padStart(2, '0');
  const fr = Math.floor((s % 1) * fps).toString().padStart(2, '0');
  return `${mins}:${secs}:${fr}`;
}

function fmtSec(s) {
  return `${Number(s.toFixed(2))}s`;
}
