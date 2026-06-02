import { useCallback, useEffect, useRef, useState } from 'react';
import { CURVE_PRESETS, TWEEN_PROPS, uid } from '../engine/sceneModel.js';

const LABEL_COL_W = 140;
const DEFAULT_PX_PER_SEC = 120;
const MIN_PX_PER_SEC = 30;
const MAX_PX_PER_SEC = 360;
const ROW_H = 30;
const RULER_H = 24;
const ADJACENT_ADD_MIN_GAP = 0.2;

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
  selectedLayerId,
  selectedLayerAssetType,
  selectedClipId,
  selectedKey,
  assetDescriptors = {},
  onSelectLayer,
  onSelectClip,
  onSelectKey,
  onMoveKey,
  onPatchFlow,
  onFlowAction
}) {
  const fps = scene.stage.fps || 30;
  const duration = clampFinite(scene.stage.duration, 0.01, 300, 5);

  const tracks = scene.flow?.tracks || [];
  const lanesScrollRef = useRef(null);
  const rulerRef = useRef(null);
  const scrubbingRef = useRef(false);
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [dragPreview, setDragPreview] = useState(null);
  const totalW = Math.max(600, Math.min(36000, Math.round(duration * pxPerSec)));
  const setFlow = useCallback((nextFlow) => onPatchFlow?.(nextFlow), [onPatchFlow]);

  const defaultClipDurationForLayer = useCallback((layerId, speed = 1, animOverride = null) => {
    const layer = scene.layers.find((l) => l.id === layerId);
    if (!layer) return 1;
    const asset = scene.assets.find((a) => a.id === layer.assetId);
    if (asset?.type !== 'spine') return 1;
    const animName = animOverride || layer.spine?.defaultAnimation || null;
    if (!animName) return 1;
    const rawDur = Number(assetDescriptors?.[asset.id]?.animationDurations?.[animName]);
    const speedSafe = Number.isFinite(Number(speed)) && Number(speed) > 0 ? Number(speed) : 1;
    if (!Number.isFinite(rawDur) || rawDur <= 0) return 1;
    return Math.max(0.05, rawDur / speedSafe);
  }, [scene.layers, scene.assets, assetDescriptors]);

  const defaultClipForLayer = useCallback((layerId, slot) => {
    const layer = scene.layers.find((l) => l.id === layerId);
    const defaultLoop = layer?.spine?.loop !== false;
    return {
      id: uid('C'),
      start: slot.start,
      duration: slot.duration,
      anim: null,
      loop: defaultLoop,
      curve: 'linear',
      speed: 1,
      mixDuration: null,
      autoFitDuration: true
    };
  }, [scene.layers]);

  const ensureTrackForLayer = (layerId) => {
    const existing = tracks.find((t) => t.layerId === layerId);
    return existing || { id: uid('T'), layerId, name: null, clips: [] };
  };

  const addClipOnSelected = () => {
    if (!selectedLayerId) return;
    const track = ensureTrackForLayer(selectedLayerId);
    const start = clamp(flowState.time, 0, Math.max(0, duration - 0.25));
    const wantedDuration = defaultClipDurationForLayer(selectedLayerId);
    const slot = findFreeSlot(track, start, wantedDuration);
    if (!slot) return;
    const clip = defaultClipForLayer(selectedLayerId, slot);
    const nextTracks = tracks.filter((t) => t.id !== track.id);
    nextTracks.push({ ...track, clips: [...track.clips, clip].sort((a, b) => a.start - b.start) });
    setFlow({ ...(scene.flow || {}), tracks: nextTracks });
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
  const findFreeSlot = (track, prefStart, slotDuration = 1) => {
    const clips = [...(track?.clips || [])].sort((a, b) => a.start - b.start);
    let start = clamp(prefStart, 0, Math.max(0, duration - 0.05));
    // Push start past any clip that contains it
    for (const c of clips) {
      if (start >= c.start && start < c.start + c.duration) start = c.start + c.duration;
    }
    if (start >= duration) return null;
    // Trim against the next clip / end of scene
    let maxEnd = duration;
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
    const xInScroll = (clientX - rect.left) + wrap.scrollLeft;
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

  const addClipToTrack = (trackId, slot) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    const wantedDuration = defaultClipDurationForLayer(track.layerId);
    const resolved = findFreeSlot(track, slot.start, wantedDuration) || slot;
    const clip = { ...defaultClipForLayer(track.layerId, resolved) };
    const nextTracks = tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) }
        : t
    );
    setFlow({ ...(scene.flow || {}), tracks: nextTracks });
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

  const patchClip = (trackId, clipId, patch) => {
    const nextTracks = tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          const nc = { ...c, ...patch };
          nc.start = clampFinite(nc.start, 0, duration, c.start);
          nc.duration = clampFinite(nc.duration, 0.05, 300, c.duration);
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
        const rightBound = idx < ordered.length - 1 ? ordered[idx + 1].start : duration;
        const target = Math.max(0.05, Math.min(rawDur / speedSafe, Math.max(0.05, rightBound - nextStart)));
        trackChanged = true;
        changed = true;
        return { ...clip, duration: target, autoFitDuration: false };
      });
      return trackChanged ? { ...track, clips } : track;
    });
    if (changed) setFlow({ ...(scene.flow || {}), tracks: nextTracks });
  }, [tracks, scene.layers, scene.assets, scene.flow, assetDescriptors, duration, setFlow]);

  const removeClip = (trackId, clipId) => {
    const nextTracks = tracks.map((t) =>
      t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
    );
    setFlow({ ...(scene.flow || {}), tracks: nextTracks });
  };

  const insertAdjacentClip = (track, clip, side) => {
    const siblings = [...(track.clips || [])].sort((a, b) => a.start - b.start);
    const idx = siblings.findIndex((c) => c.id === clip.id);
    if (idx < 0) return;
    const leftBound = idx > 0 ? siblings[idx - 1].start + siblings[idx - 1].duration : 0;
    const rightBound = idx < siblings.length - 1 ? siblings[idx + 1].start : duration;
    const wantedDuration = defaultClipDurationForLayer(track.layerId);
    if (side === 'left') {
      const gap = clip.start - leftBound;
      if (gap < ADJACENT_ADD_MIN_GAP) return;
      const d = Math.min(wantedDuration, gap);
      addClipToTrack(track.id, { start: clip.start - d, duration: d });
      return;
    }
    const clipEnd = clip.start + clip.duration;
    const gap = rightBound - clipEnd;
    if (gap < ADJACENT_ADD_MIN_GAP) return;
    const d = Math.min(wantedDuration, gap);
    addClipToTrack(track.id, { start: clipEnd, duration: d });
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
    targets.push(flowState.time);
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
    const centerTime = (wrap.scrollLeft + wrap.clientWidth / 2) / prev;
    setPxPerSec(clamped);
    requestAnimationFrame(() => {
      const target = Math.max(0, centerTime * clamped - wrap.clientWidth / 2);
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
      // In timeline area, wheel controls timeline zoom directly.
      // Keep Ctrl/Meta untouched for browser-level page zoom gestures.
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const next = pxPerSec + (e.deltaY < 0 ? 12 : -12);
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
    const xInScroll = (clientX - rect.left) + wrap.scrollLeft;
    return clamp(xInScroll / pxPerSec, 0, duration);
  }, [duration, pxPerSec]);

  const onScrubPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    // Skip drags that originated on a clip — clips own their own pointers.
    if (e.target.closest('.scene-clip')) return;
    scrubbingRef.current = true;
    onFlowAction?.('seek', timeFromClientX(e.clientX));
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }, [onFlowAction, timeFromClientX]);

  const onScrubPointerMove = useCallback((e) => {
    if (!scrubbingRef.current) return;
    onFlowAction?.('seek', timeFromClientX(e.clientX));
  }, [onFlowAction, timeFromClientX]);

  const onScrubPointerUp = useCallback((e) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  // ── Keyboard: Delete / Backspace on the selected clip ─────────────
  //
  // We listen at window level but only act when the active element is
  // NOT a text input (else the user can never type into the marker /
  // start / duration fields). Selection must be present.
  useEffect(() => {
    if (!selectedClipId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Find and remove the selected clip across all tracks.
      const containing = tracks.find((tr) => tr.clips.some((c) => c.id === selectedClipId));
      if (!containing) return;
      e.preventDefault();
      removeClip(containing.id, selectedClipId);
      onSelectClip?.(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId, tracks, onSelectClip]);

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
    const layer = scene.layers.find((l) => l.id === track.layerId);
    const asset = layer ? scene.assets.find((a) => a.id === layer.assetId) : null;
    if (asset?.type === 'spine') return clip.anim || '(setup pose)';
    if (clip.channels) {
      const animated = [];
      for (const k of ['x', 'y', 'scaleX', 'scaleY', 'rotation']) {
        if (clip.channels[k]?.keys?.length) animated.push(k);
      }
      return animated.length ? animated.join(' · ') : 'static';
    }
    return 'static';
  };

  return (
    <div className="scene-timeline">
      <div className="scene-timeline-head">
        <div className="scene-timeline-controls">
          <button className="scene-btn" onClick={() => onFlowAction?.('play')}>▶</button>
          <button className="scene-btn" onClick={() => onFlowAction?.('pause')}>⏸</button>
          <button className="scene-btn" onClick={() => onFlowAction?.('stop')}>⏹</button>
          <span className="scene-toolbar-tag">{fmtTime(flowState.time, fps)} / {fmtTime(duration, fps)}</span>
          {flowState.hold && <span className="scene-pill">hold: {flowState.hold.type}</span>}
        </div>
        <div className="scene-timeline-actions">
          <label className="scene-timeline-zoom">
            <span>zoom</span>
            <input
              type="range"
              min={MIN_PX_PER_SEC}
              max={MAX_PX_PER_SEC}
              step={5}
              value={pxPerSec}
              onChange={onTimelineZoomInput}
              title="Timeline zoom (mouse wheel in timeline area)"
            />
            <em>{Math.round((pxPerSec / DEFAULT_PX_PER_SEC) * 100)}%</em>
          </label>
          <input
            className="scene-duration-input"
            type="number"
            step={0.5}
            min={0.5}
            max={300}
            value={Number(duration.toFixed(2))}
            onChange={(e) => onFlowAction?.('setDuration', Number(e.target.value))}
            title="Scene duration (seconds)"
          />
          {selectedLayerId && (
            <button className="scene-btn" onClick={addClipOnSelected}>+ clip on selected</button>
          )}
        </div>
      </div>

      <div className="scene-timeline-body">
        <div className="scene-timeline-labels" style={{ width: LABEL_COL_W }}>
          <div className="scene-timeline-label-cell scene-timeline-label-cell--ruler" style={{ height: RULER_H }}>
            <span className="scene-timeline-label-head">time</span>
          </div>
          {tracks.length === 0 ? (
            <div className="scene-timeline-label-cell scene-timeline-label-empty" style={{ height: ROW_H }}>
              no tracks
            </div>
          ) : tracks.map((track) => {
            const selected = track.layerId === selectedLayerId;
            return (
              <div
                key={track.id}
                className={'scene-timeline-label-cell' + (selected ? ' selected' : '')}
                style={{ height: ROW_H }}
                onClick={() => onSelectLayer?.(track.layerId)}
                title={labelForTrack(track)}
              >
                <span className="scene-timeline-label-text">{labelForTrack(track)}</span>
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
            );
          })}
          {tracks.length > 0 && (
            <div
              className="scene-timeline-label-cell scene-timeline-label-cell--filler"
              style={{ height: 22 }}
              title="Drop a layer onto the lane on the right to create a new track"
            >
              <span className="scene-timeline-label-text">drop layer →</span>
            </div>
          )}
        </div>

        <div
          ref={lanesScrollRef}
          className="scene-timeline-lanes-scroll"
          onPointerDown={onScrubPointerDown}
          onPointerMove={onScrubPointerMove}
          onPointerUp={onScrubPointerUp}
          onPointerCancel={onScrubPointerUp}
        >
          <div className="scene-timeline-lanes" style={{ width: totalW }}>
            <div className="scene-timeline-ruler" ref={rulerRef} style={{ height: RULER_H }}>
              {buildTicks(duration).map((t) => (
                <div key={t.value} className="scene-tick" style={{ left: t.value * pxPerSec }}>
                  <span>{t.label}</span>
                </div>
              ))}
            </div>

            {tracks.length === 0 ? (
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
            ) : tracks.map((track) => (
              <div
                key={track.id}
                className={'scene-timeline-lane' + (dragPreview?.trackId === track.id ? ' drag-over' : '')}
                style={{ height: ROW_H, width: totalW }}
                onDragOver={onTrackLaneDragOver(track)}
                onDrop={onLaneDrop(track)}
              >
                {dragPreview?.trackId === track.id && dragPreview.slot && (
                  <div
                    className="scene-drop-preview-clip"
                    style={{ left: dragPreview.slot.start * pxPerSec, width: Math.max(8, dragPreview.slot.duration * pxPerSec) }}
                  />
                )}
                {track.clips.map((c) => (
                  <ClipBlock
                    key={c.id}
                    clip={c}
                    label={labelForClip(track, c)}
                    selected={c.id === selectedClipId}
                    duration={duration}
                    pxPerSec={pxPerSec}
                    siblings={track.clips.filter((other) => other.id !== c.id)}
                    onSelect={() => onSelectClip?.(c.id)}
                    onPatch={(patch) => patchClip(track.id, c.id, patch)}
                    onRemove={() => { onSelectClip?.(null); removeClip(track.id, c.id); }}
                    snapTime={(value, disable) => snapTime(value, c.id, track.id, disable)}
                    onAddLeft={() => insertAdjacentClip(track, c, 'left')}
                    onAddRight={() => insertAdjacentClip(track, c, 'right')}
                    selectedKey={selectedKey}
                    onSelectKey={(clipId, name, idx) => {
                      onSelectClip?.(clipId);
                      onSelectKey?.({ clipId, name, idx });
                      const key = c.channels?.[name]?.keys?.[idx];
                      if (key) onFlowAction?.('seek', c.start + key.t);
                    }}
                    onMoveKey={(clipId, name, idx, newT) => onMoveKey?.(clipId, name, idx, newT)}
                  />
                ))}
              </div>
            ))}

            {tracks.length > 0 && (
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
            )}

            <div
              className="scene-playhead"
              style={{ left: flowState.time * pxPerSec, bottom: 0 }}
            />
          </div>
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

function ClipBlock({ clip, label, selected, duration, siblings = [], pxPerSec, onSelect, onPatch, onRemove, snapTime, onAddLeft, onAddRight, selectedKey, onSelectKey, onMoveKey }) {
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
    onSelect?.();
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    let mode;
    if (px <= EDGE_HIT_PX + EDGE_GUARD_PX) mode = 'resizeStart';
    else if (px >= rect.width - (EDGE_HIT_PX + EDGE_GUARD_PX)) mode = 'resizeEnd';
    else mode = 'move';
    dragRef.current = {
      mode,
      startClientX: e.clientX,
      origStart: clip.start,
      origDuration: clip.duration,
      pointerId: e.pointerId
    };
    try { ref.current.setPointerCapture(e.pointerId); } catch {}
  }, [clip.start, clip.duration, onSelect]);

  const onPointerMove = useCallback((e) => {
    const st = dragRef.current;
    if (!st) return;
    const deltaT = (e.clientX - st.startClientX) / pxPerSec;
    const altDisableSnap = e.altKey;
    const origEnd = st.origStart + st.origDuration;
    const { minStart, maxEnd } = neighbourBounds(st.origStart, origEnd);
    let nextStart = st.origStart;
    let nextDuration = st.origDuration;

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
    } else if (st.mode === 'resizeEnd') {
      const lo = st.origStart + 0.05;
      const hi = maxEnd;
      let rawEnd = clamp(origEnd + deltaT, lo, hi);
      rawEnd = clamp(snapTime(rawEnd, altDisableSnap), lo, hi);
      nextDuration = rawEnd - st.origStart;
    }

    onPatch?.({ start: nextStart, duration: nextDuration });
  }, [duration, onPatch, snapTime, siblings]);

  const onPointerUp = useCallback((e) => {
    if (!dragRef.current) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch {}
    dragRef.current = null;
  }, []);

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
      className={'scene-clip' + (selected ? ' selected' : '')}
      style={{ left: clip.start * pxPerSec, width: Math.max(8, clip.duration * pxPerSec) }}
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
      <span className="scene-clip-label">{label}</span>
      <button
        className="scene-icon-btn scene-clip-remove"
        title="Remove clip"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
      >
        ✕
      </button>
      <ClipKeyframeDots
        clip={clip}
        pxPerSec={pxPerSec}
        selectedKey={selectedKey}
        onSelectKey={onSelectKey}
        onMoveKey={onMoveKey}
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
function ClipKeyframeDots({
  clip, pxPerSec, selectedKey, onSelectKey, onMoveKey
}) {
  if (!clip.channels) return null;
  const dots = [];
  for (const name of ['position', 'scale', 'rotation', 'alpha', 'tint']) {
    const ch = clip.channels[name];
    if (!ch?.keys?.length) continue;
    for (let i = 0; i < ch.keys.length; i++) {
      const k = ch.keys[i];
      dots.push({ name, idx: i, t: k.t, v: k.v, key: `${name}-${i}` });
    }
  }
  if (!dots.length) return null;
  return (
    <div className="scene-clip-keyframes">
      {dots.map((d) => (
        <KeyframeDot
          key={d.key}
          dot={d}
          clip={clip}
          pxPerSec={pxPerSec}
          selected={
            selectedKey?.clipId === clip.id
            && selectedKey.name === d.name
            && selectedKey.idx === d.idx
          }
          onSelect={() => onSelectKey?.(clip.id, d.name, d.idx)}
          onMove={(newT) => onMoveKey?.(clip.id, d.name, d.idx, newT)}
        />
      ))}
    </div>
  );
}

function KeyframeDot({ dot, clip, pxPerSec, selected, onSelect, onMove }) {
  const ref = useRef(null);
  const dragRef = useRef(null);
  const fmtVal = (v) => {
    if (typeof v === 'number') return v.toFixed(2);
    if (v && typeof v === 'object' && typeof v.x === 'number') {
      return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)})`;
    }
    return String(v);
  };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.();
    dragRef.current = {
      startClientX: e.clientX,
      origT: dot.t,
      moved: false,
      pointerId: e.pointerId
    };
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e) => {
    const st = dragRef.current;
    if (!st) return;
    const deltaT = (e.clientX - st.startClientX) / pxPerSec;
    if (!st.moved && Math.abs(deltaT) < (3 / pxPerSec)) return;
    st.moved = true;
    const clamped = Math.max(0, Math.min(clip.duration, st.origT + deltaT));
    onMove?.(clamped);
  };
  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };
  return (
    <span
      ref={ref}
      className={
        `scene-clip-keyframe scene-clip-keyframe--${dot.name}`
        + (selected ? ' is-selected' : '')
      }
      style={{ left: `${dot.t * pxPerSec}px` }}
      title={`${dot.name} = ${fmtVal(dot.v)} @ ${dot.t.toFixed(2)}s — drag to move, click to seek`}
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

function buildTicks(duration) {
  const out = [];
  const step = duration > 120 ? 10 : duration > 30 ? 5 : 1;
  const maxTicks = 800;
  for (let t = 0, i = 0; t <= duration + 0.0001 && i < maxTicks; t += step, i++) {
    out.push({ value: t, label: `${Math.round(t)}s` });
  }
  if (!out.length || out[out.length - 1].value < duration) {
    out.push({ value: duration, label: `${Math.round(duration)}s` });
  }
  return out;
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
