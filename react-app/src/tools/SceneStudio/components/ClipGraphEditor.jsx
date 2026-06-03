// ClipGraphEditor — whole-clip animation curve editor.
//
// Renders one subplot per logical channel with a shared time axis at
// the bottom. Each subplot has its own Y axis auto-fitted to the keys'
// value range (absolute, not normalised). Drag a key in 2D to change
// (t, v) simultaneously. Click an empty point on the curve to insert
// a new key at that exact moment. The subplots stack vertically so
// the artist can see the whole motion in one place.
//
// When a key is selected, a CurveEditor (normalised bezier) appears
// immediately below that channel's subplots so the artist doesn't
// have to scroll to find the curve controls. The edited segment is
// also subtly highlighted on the plot.
//
// vec2 / rgb channels overlay one line per component in distinct
// colours. Scalar channels (rotation, alpha) render a single line.

import { useMemo, useRef, useState } from 'react';
import { curveEval } from '../engine/animation/curves.js';
import {
  CHANNEL_NAMES,
  channelLayout,
  effectiveSlopes,
  evalChannel,
  insertOrUpdateKey,
  keyHasTangents,
  linkChannel,
  moveKeyTime,
  setKeyComponent,
  setKeyTangentMode,
  setKeyTangentSlope,
  setKeyValue,
  splitChannel
} from '../engine/animation/keyframes.js';
import { CurveEditor } from './CurveEditor.jsx';

const PLOT_HEIGHT = 96;       // pixels per subplot
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const KEY_RADIUS = 5;
const SAMPLES_PER_PIXEL = 1 / 4;
const TAN_HANDLE_LEN = 30;    // px length of a tangent handle stem
const TAN_HANDLE_R = 4;       // px radius of a tangent handle knob
const TAN_MIN_DX = 4;         // px — clamp so slope stays finite while dragging

// Tangent-mode chips shown for the selected key. 'auto' is labelled
// "smooth" to match the artist-facing Maya/AE vocabulary.
const TANGENT_MODE_CHIPS = [
  { mode: 'auto',   label: 'smooth' },
  { mode: 'flat',   label: 'flat' },
  { mode: 'linear', label: 'linear' },
  { mode: 'broken', label: 'broken' }
];

// Rotation is plotted in degrees but stored in radians; tangent slopes must
// convert across that boundary. All other channels are 1:1.
function displaySlopeFactor(name) {
  return name === 'rotation' ? 180 / Math.PI : 1;
}

const COMPONENT_COLORS = {
  position: { x: '#ff6b6b', y: '#4f9eff' },
  scale:    { x: '#6bcb77', y: '#c084fc' },
  rotation: { _: '#ffd166' },
  alpha:    { _: '#a8afc0' },
  tint:     { r: '#ff6b6b', g: '#6bcb77', b: '#4f9eff' }
};

const CHANNEL_DISPLAY_NAME = {
  position: 'position (px)',
  scale:    'scale',
  rotation: 'rotation (°)',
  alpha:    'alpha',
  tint:     'tint (rgb 0-1)'
};

// How the channel's `v` is decomposed into one or more named components.
// Returns `[{ comp, value }]` — comp === '_' marks a scalar.
// `layoutOverride` lets callers force a scalar render (split-mode rows)
// even though the parent channel name would otherwise imply vec2 / rgb.
function componentsOfKey(name, v, layoutOverride = null) {
  const layout = layoutOverride || channelLayout(name);
  if (layout === 'vec2') {
    return [
      { comp: 'x', value: v?.x ?? 0 },
      { comp: 'y', value: v?.y ?? 0 }
    ];
  }
  if (layout === 'rgb') {
    return [
      { comp: 'r', value: v?.r ?? 0 },
      { comp: 'g', value: v?.g ?? 0 },
      { comp: 'b', value: v?.b ?? 0 }
    ];
  }
  // Rotation is stored in radians but displayed in degrees on this plot
  // so the artist sees familiar numbers.
  if (name === 'rotation') return [{ comp: '_', value: (Number(v) || 0) * 180 / Math.PI }];
  return [{ comp: '_', value: Number(v) || 0 }];
}

// Convert a display-space value back to storage form (for rotation).
function valueToStorage(name, display) {
  if (name === 'rotation') return (Number(display) || 0) * Math.PI / 180;
  return Number(display) || 0;
}

// Auto-fit the Y axis: return [min, max] for a channel given its keys.
// Pads by 10% of the range, or +/- 1 unit if all keys have the same value.
function fitYRange(name, keys, layoutOverride = null) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of keys) {
    for (const { value } of componentsOfKey(name, k.v, layoutOverride)) {
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    // Sensible defaults per channel so an empty / 1-key plot doesn't
    // collapse into a 0-height range.
    if (name === 'alpha' || name === 'tint') return [0, 1];
    if (name === 'rotation') return [-180, 180];
    return [0, 1];
  }
  if (Math.abs(hi - lo) < 1e-4) {
    // Constant value — give it ±5% room (or ±1 if value is 0).
    const pad = Math.max(0.05 * Math.abs(lo), name === 'alpha' || name === 'tint' ? 0.1 : 1);
    lo -= pad;
    hi += pad;
  } else {
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  }
  // For alpha + tint, clamp the bounds to [0, 1] but keep the padded
  // range visible so the curve isn't pinned to the edges.
  if (name === 'alpha' || name === 'tint') {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 1);
  }
  return [lo, hi];
}

export function ClipGraphEditor({ clip, flowTime, selectedKey, onSelectKey, onPatchChannel, curveRef, defaultTangentMode = 'auto' }) {
  const channels = clip.channels || {};
  const duration = Math.max(0.001, clip.duration || 1);
  const visibleNames = useMemo(
    () => CHANNEL_NAMES.filter((n) => {
      const ch = channels[n];
      if (ch?.keys?.length) return true;
      if (ch?.split && ch.perComp && Object.values(ch.perComp).some((c) => c?.keys?.length)) return true;
      return false;
    }),
    [channels]
  );

  // Make the plot fill the panel's width. Measured below with a ResizeObserver.
  const wrapRef = useRef(null);
  const [plotW, setPlotW] = useState(280);
  useMemo(() => {
    if (typeof window === 'undefined' || !wrapRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(180, Math.round(e.contentRect.width));
        setPlotW(w);
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapRef.current]);

  if (!visibleNames.length) return null;

  const toggleSplit = (name) => {
    const ch = channels[name];
    if (!ch) return;
    const next = ch.split ? linkChannel(ch, name) : splitChannel(ch, name);
    onPatchChannel?.(name, next);
  };

  return (
    <div className="scene-channels-graph" ref={wrapRef}>
      {visibleNames.map((name) => {
        const ch = channels[name];
        const layout = channelLayout(name);
        const canSplit = layout === 'vec2' || layout === 'rgb';
        const isSplit = !!ch.split;

        // Resolve the key list for the selected key (if it's in this channel).
        const selIsHere = selectedKey?.name === name;
        const selComp = selIsHere ? (selectedKey.comp ?? null) : null;
        const selKeys = selIsHere
          ? ((ch.split && selComp)
              ? (ch.perComp?.[selComp]?.keys || [])
              : (ch.keys || []))
          : [];
        const selKeyObj = selIsHere ? selKeys[selectedKey.idx] : null;
        const hasNextKey = selIsHere && selectedKey.idx < selKeys.length - 1;

        return (
          <div className="scene-channels-graph-channel" key={name}>
            <div className="scene-channels-graph-channel-head">
              <span className="scene-channels-graph-name">{CHANNEL_DISPLAY_NAME[name] || name}</span>
              {canSplit && (
                <button
                  type="button"
                  className={'scene-chip scene-chip--xs' + (isSplit ? ' on' : '')}
                  onClick={() => toggleSplit(name)}
                  title={isSplit
                    ? 'Currently split — components have independent timings and curves. Click to re-link.'
                    : 'Currently linked — one shared curve for all components. Click to split into independent curves.'}
                >
                  {isSplit ? 'split' : 'linked'}
                </button>
              )}
            </div>
            {isSplit
              ? renderSplitSubplots({
                  channel: ch, name, layout,
                  duration, flowTime, clipStart: clip.start, plotW,
                  selectedKey, onSelectKey, onPatchChannel, defaultTangentMode
                })
              : (
                <ChannelSubplot
                  name={name}
                  channel={ch}
                  layout={layout}
                  comp={null}
                  clipDuration={duration}
                  flowTime={flowTime}
                  clipStart={clip.start}
                  plotW={plotW}
                  selectedKey={selectedKey}
                  onSelectKey={onSelectKey}
                  onPatchChannel={onPatchChannel}
                  defaultTangentMode={defaultTangentMode}
                />
              )}

            {/* Per-key tangent controls + (for legacy keys) the bezier editor */}
            {selIsHere && selKeyObj && (
              <TangentControls
                channel={ch}
                name={name}
                selComp={selComp}
                selectedKey={selectedKey}
                selKeyObj={selKeyObj}
                hasNextKey={hasNextKey}
                onPatchChannel={onPatchChannel}
                onSelectKey={onSelectKey}
                curveRef={curveRef}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Route a keys-channel transform to the right list: a split channel's
// per-component sub-list (when selComp is set) or the linked key list.
function applyToSelectedKeyList(channel, selComp, transform) {
  if (channel?.split && selComp) {
    const sub = { keys: channel.perComp?.[selComp]?.keys || [] };
    const next = transform(sub);
    return {
      ...channel,
      split: true,
      perComp: { ...(channel.perComp || {}), [selComp]: { keys: next.keys || [] } }
    };
  }
  return transform(channel);
}

/**
 * Per-key tangent toolbar shown below the channel's subplots when a key is
 * selected. Mode chips (smooth/flat/linear/broken) switch the key's tangent
 * mode; for keys still on the legacy easing model the bezier CurveEditor is
 * offered so old clips remain fully editable until the artist opts in.
 */
function TangentControls({ channel, name, selComp, selectedKey, selKeyObj, hasNextKey, onPatchChannel, onSelectKey, curveRef }) {
  const idx = selectedKey.idx;
  const isTangent = keyHasTangents(selKeyObj);
  const mode = isTangent ? selKeyObj.tm : null;

  const setMode = (m) => {
    const updated = applyToSelectedKeyList(channel, selComp, (ch) => setKeyTangentMode(ch, idx, m));
    onPatchChannel?.(name, updated);
  };

  return (
    <div ref={curveRef} className="scene-channel-curve scene-channel-curve--graph">
      <div className="scene-channel-curve-head">
        <span>
          {name}{selComp ? '.' + selComp : ''} · key {idx + 1}
          {isTangent ? ` · tangent: ${mode}` : ' · easing (legacy)'}
        </span>
        <button
          type="button"
          className="scene-icon-btn"
          onClick={() => onSelectKey?.(null)}
          title="Deselect key"
        >
          ✕
        </button>
      </div>

      <div className="scene-tangent-modes">
        {TANGENT_MODE_CHIPS.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            className={'scene-chip scene-chip--xs' + (mode === m ? ' on' : '')}
            onClick={() => setMode(m)}
            title={m === 'broken'
              ? 'Independent in/out tangents — drag each handle separately'
              : m === 'auto'
                ? 'Smooth — tangents auto-computed from neighbours (Catmull-Rom)'
                : m === 'flat'
                  ? 'Flat — horizontal tangents (ease in/out)'
                  : 'Linear — straight segments toward the neighbouring keys'}
          >
            {label}
          </button>
        ))}
      </div>

      {isTangent ? (
        <div className="scene-tangent-hint">
          drag the in/out handles on the graph to shape this key
        </div>
      ) : hasNextKey ? (
        <CurveEditor
          value={selKeyObj.out || 'linear'}
          onChange={(spec) => {
            const updated = applyToSelectedKeyList(channel, selComp, (ch) => {
              if (!ch.keys) return ch;
              const keys = ch.keys.map((k, i) => (i === idx ? { ...k, out: spec } : k));
              return { ...ch, keys };
            });
            onPatchChannel?.(name, updated);
          }}
        />
      ) : (
        <div className="scene-tangent-hint">
          last key — pick a tangent mode above to shape the incoming curve
        </div>
      )}
    </div>
  );
}

function renderSplitSubplots({ channel, name, layout, duration, flowTime, clipStart, plotW, selectedKey, onSelectKey, onPatchChannel, defaultTangentMode = 'auto' }) {
  const comps = layout === 'vec2' ? ['x', 'y'] : ['r', 'g', 'b'];
  return comps.map((comp) => {
    const sub = channel.perComp?.[comp] || { keys: [] };
    const subChannel = { keys: sub.keys || [] };
    return (
      <ChannelSubplot
        key={comp}
        name={name}
        comp={comp}
        channel={subChannel}
        layout="scalar"
        labelOverride={`${name}.${comp}`}
        clipDuration={duration}
        flowTime={flowTime}
        clipStart={clipStart}
        plotW={plotW}
        selectedKey={selectedKey}
        onSelectKey={onSelectKey}
        defaultTangentMode={defaultTangentMode}
        onPatchChannel={(_chName, newSubChannel) => {
          // Write the per-comp scalar list back into the parent channel
          // via onPatchChannel(name, mergedChannel).
          const nextPerComp = { ...(channel.perComp || {}) };
          nextPerComp[comp] = { keys: newSubChannel.keys || [] };
          onPatchChannel?.(name, { ...channel, split: true, perComp: nextPerComp });
        }}
      />
    );
  });
}

export function ChannelSubplot({
  name, channel, clipDuration, flowTime, clipStart, plotW,
  selectedKey, onSelectKey, onPatchChannel,
  // For split-mode sub-rows: parent's comp ('x'/'y'/'r'/'g'/'b') so
  // the dot click reports it. labelOverride displays "position.x" etc.
  // layout overrides the implicit channelLayout(name) when this subplot
  // is a scalar view of a parent vec2 / rgb channel.
  comp: parentComp = null,
  layout: layoutProp = null,
  labelOverride = null,
  defaultTangentMode = 'auto'
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const tanDragRef = useRef(null);
  const layout = layoutProp || channelLayout(name);
  const keys = channel?.keys || [];
  const [yLo, yHi] = useMemo(() => fitYRange(name, keys, layout), [name, keys, layout]);
  const localT = Math.max(0, Math.min(clipDuration, flowTime - clipStart));

  const innerW = Math.max(40, plotW - PAD_LEFT - PAD_RIGHT);
  const innerH = PLOT_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const totalH = PLOT_HEIGHT;

  const xToPx = (t) => PAD_LEFT + (t / clipDuration) * innerW;
  const yToPx = (v) => PAD_TOP + (1 - (v - yLo) / Math.max(1e-6, yHi - yLo)) * innerH;
  const pxToX = (px) => Math.max(0, Math.min(clipDuration, ((px - PAD_LEFT) / innerW) * clipDuration));
  const pxToY = (py) => yHi - ((py - PAD_TOP) / Math.max(1, innerH)) * (yHi - yLo);

  // Sample the channel finely for the line render. One sample every few
  // pixels keeps the SVG cheap and the curve buttery.
  const samples = Math.max(16, Math.round(innerW * SAMPLES_PER_PIXEL));
  const paths = useMemo(() => {
    if (!keys.length) return [];
    const comps = layout === 'vec2'
      ? ['x', 'y']
      : layout === 'rgb'
        ? ['r', 'g', 'b']
        : ['_'];
    const pathByComp = {};
    for (const c of comps) pathByComp[c] = '';
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * clipDuration;
      const v = evalChannel(channel, t, name);
      if (v == null) continue;
      const dispComps = componentsOfKey(name, v, layout);
      for (const { comp, value } of dispComps) {
        const px = xToPx(t);
        const py = yToPx(value);
        pathByComp[comp] += (pathByComp[comp] ? ' L' : 'M') + `${px.toFixed(1)} ${py.toFixed(1)}`;
      }
    }
    return Object.entries(pathByComp).map(([comp, d]) => ({
      comp,
      d,
      // For split sub-rows, the parent's comp is what should drive colour
      // even when the sub-row's own "comp" is the scalar sentinel '_'.
      color: COMPONENT_COLORS[name]?.[parentComp || comp] || '#a8afc0'
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, name, layout, clipDuration, innerW, innerH, yLo, yHi, samples]);

  // Compute the highlight segment for the selected key in this subplot.
  // Only shown when a key in this subplot is selected and has a next key.
  const segmentHighlight = (() => {
    if (!selectedKey || selectedKey.name !== name) return null;
    const effectiveComp = parentComp || null;
    // For split sub-rows, the selectedKey.comp must match this subplot's parentComp.
    if (parentComp && selectedKey.comp !== parentComp) return null;
    // For linked (parentComp=null), accept comp=null or matched.
    if (!parentComp && selectedKey.comp != null && layout !== 'vec2' && layout !== 'rgb') return null;
    const idx = selectedKey.idx;
    if (idx < 0 || idx >= keys.length - 1) return null;
    const x1 = xToPx(keys[idx].t);
    const x2 = xToPx(keys[idx + 1].t);
    return { x: Math.min(x1, x2), width: Math.abs(x2 - x1) };
  })();

  // Tangent-handle geometry for the selected key in this subplot. Computes
  // the selected key's in/out handle knob positions plus faint read-only
  // handles on the immediate neighbours (the "3-point" context). Returns
  // null when no key of this subplot/component is selected.
  const pxPerSec = innerW / Math.max(1e-6, clipDuration);
  const pxPerValue = innerH / Math.max(1e-6, yHi - yLo);
  const dispFactor = displaySlopeFactor(name);
  const tangentUI = (() => {
    if (!selectedKey || selectedKey.name !== name) return null;
    if (parentComp && selectedKey.comp !== parentComp) return null;
    const selIdx = selectedKey.idx;
    if (selIdx < 0 || selIdx >= keys.length) return null;
    // Which component this subplot's handles act on.
    const activeComp = parentComp || selectedKey.comp || '_';
    // How to read a shaped slope from effectiveSlopes(), and the comp passed
    // to setKeyTangentSlope. Split sub-rows + scalar channels are scalar.
    const extractComp = (!parentComp && (layout === 'vec2' || layout === 'rgb'))
      ? activeComp : null;
    const writeComp = extractComp;

    const dispValOf = (k) => componentsOfKey(name, k.v, layout)
      .find((c) => c.comp === activeComp || c.comp === '_')?.value ?? 0;
    const slopeFrom = (shaped) => (extractComp == null ? shaped : (shaped?.[extractComp] ?? 0));

    const handlePoint = (kx, ky, dispSlope, dir) => {
      const vx = dir * pxPerSec;
      const vy = dir * (-pxPerValue * dispSlope);
      const len = Math.hypot(vx, vy) || 1;
      return { x: kx + (vx / len) * TAN_HANDLE_LEN, y: ky + (vy / len) * TAN_HANDLE_LEN };
    };

    const k = keys[selIdx];
    const kx = xToPx(k.t);
    const ky = yToPx(dispValOf(k));
    const eff = effectiveSlopes(keys, selIdx);
    const out = { kx, ky, ...handlePoint(kx, ky, slopeFrom(eff.out) * dispFactor, +1) };
    const inn = { kx, ky, ...handlePoint(kx, ky, slopeFrom(eff.in) * dispFactor, -1) };

    // Faint neighbour handles (read-only) for context.
    const neighbours = [];
    if (selIdx > 0) {
      const p = keys[selIdx - 1];
      const px = xToPx(p.t);
      const py = yToPx(dispValOf(p));
      const ps = slopeFrom(effectiveSlopes(keys, selIdx - 1).out) * dispFactor;
      neighbours.push({ key: 'prev', px, py, ...handlePoint(px, py, ps, +1) });
    }
    if (selIdx < keys.length - 1) {
      const nx = keys[selIdx + 1];
      const px = xToPx(nx.t);
      const py = yToPx(dispValOf(nx));
      const ns = slopeFrom(effectiveSlopes(keys, selIdx + 1).in) * dispFactor;
      neighbours.push({ key: 'next', px, py, ...handlePoint(px, py, ns, -1) });
    }
    return { selIdx, writeComp, currentMode: k.tm ?? null, out, inn, neighbours };
  })();

  // Begin dragging a tangent handle. `side` is 'in' | 'out'.
  const beginTanDrag = (side) => (e) => {
    if (e.button !== 0 || !tangentUI) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    tanDragRef.current = {
      side,
      idx: tangentUI.selIdx,
      writeComp: tangentUI.writeComp,
      currentMode: tangentUI.currentMode,
      kx: tangentUI.out.kx,
      ky: tangentUI.out.ky,
      scaleX: plotW / rect.width,
      scaleY: totalH / rect.height,
      rectLeft: rect.left,
      rectTop: rect.top,
      pointerId: e.pointerId
    };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  // Begin dragging a key. We carry comp so vec2 / rgb drags only touch
  // that component (drag y-axis updates only `x` of position, etc.).
  const beginKeyDrag = (idx, comp) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectKey?.({ name, idx, comp: parentComp || comp });
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = plotW / rect.width;
    const scaleY = totalH / rect.height;
    dragRef.current = {
      idx, comp,
      origT: channel.keys[idx].t,
      origV: channel.keys[idx].v,
      pointerId: e.pointerId,
      scaleX, scaleY,
      rectLeft: rect.left,
      rectTop: rect.top,
      moved: false
    };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e) => {
    // Tangent-handle drag takes priority when active.
    const tan = tanDragRef.current;
    if (tan) {
      const px = (e.clientX - tan.rectLeft) * tan.scaleX;
      const py = (e.clientY - tan.rectTop) * tan.scaleY;
      let dx = px - tan.kx;
      const dy = py - tan.ky;
      if (tan.side === 'out') dx = Math.max(TAN_MIN_DX, dx);
      else dx = Math.min(-TAN_MIN_DX, dx);
      const dispSlope = -(dy / dx) * (pxPerSec / Math.max(1e-6, pxPerValue));
      const storeSlope = dispSlope / dispFactor;
      // Plain drag keeps a smooth key unified ('free'); flat/linear/broken
      // keys break into independent ('broken') handles.
      const free = tan.currentMode == null || tan.currentMode === 'auto' || tan.currentMode === 'free';
      const next = setKeyTangentSlope(channel, tan.idx, tan.side, tan.writeComp, storeSlope, { free });
      onPatchChannel?.(name, next);
      return;
    }
    const st = dragRef.current;
    if (!st) return;
    const localPx = (e.clientX - st.rectLeft) * st.scaleX;
    const localPy = (e.clientY - st.rectTop) * st.scaleY;
    if (!st.moved
        && Math.abs(localPx - xToPx(st.origT)) < 3
        && Math.abs(localPy - yToPx(componentsOfKey(name, st.origV).find((c) => c.comp === st.comp || c.comp === '_')?.value ?? 0)) < 3) {
      return;
    }
    st.moved = true;
    const newT = pxToX(localPx);
    const newDisplayY = pxToY(localPy);
    const newStoredY = valueToStorage(name, newDisplayY);
    // Time first
    let next = moveKeyTime(channel, st.idx, newT);
    // Find the new index in the (possibly re-sorted) keys array
    const newIdx = next.keys.findIndex((k) => Math.abs(k.t - newT) < 1e-6);
    const idxToUse = newIdx >= 0 ? newIdx : st.idx;
    // Then value
    if (layout === 'vec2' && (st.comp === 'x' || st.comp === 'y')) {
      next = setKeyComponent(next, idxToUse, st.comp, newStoredY);
    } else if (layout === 'rgb' && (st.comp === 'r' || st.comp === 'g' || st.comp === 'b')) {
      next = setKeyComponent(next, idxToUse, st.comp, newStoredY);
    } else {
      next = setKeyValue(next, idxToUse, newStoredY);
    }
    onPatchChannel?.(name, next);
    // Keep selection following the dragged key index.
    if (newIdx >= 0 && newIdx !== st.idx) {
      onSelectKey?.({ name, idx: newIdx, comp: parentComp || st.comp });
      st.idx = newIdx;
    }
  };

  const onPointerUp = (e) => {
    if (tanDragRef.current) {
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
      tanDragRef.current = null;
      return;
    }
    if (!dragRef.current) return;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };

  // Click on empty plot inserts a new key at that point (insert-at-x with
  // current evaluated value to preserve the curve shape).
  const onPlotPointerDown = (e) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = plotW / rect.width;
    const localPx = (e.clientX - rect.left) * scaleX;
    if (localPx < PAD_LEFT || localPx > PAD_LEFT + innerW) return;
    const t = pxToX(localPx);
    const currentV = keys.length ? evalChannel(channel, t) : null;
    if (currentV == null) return;
    const next = insertOrUpdateKey(channel, t, currentV, { out: 'linear', tm: defaultTangentMode });
    onPatchChannel?.(name, next);
  };

  const playheadX = xToPx(localT);

  const displayLabel = labelOverride || CHANNEL_DISPLAY_NAME[name] || name;
  const precision = name === 'alpha' || name === 'tint' ? 2 : 1;
  return (
    <div className="scene-channels-graph-row">
      <div className="scene-channels-graph-head">
        <span className="scene-channels-graph-name">{displayLabel}</span>
        <span className="scene-channels-graph-range">
          {yLo.toFixed(precision)} … {yHi.toFixed(precision)}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${plotW} ${totalH}`}
        className="scene-channels-graph-svg"
        style={{ width: '100%', height: totalH }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={onPlotPointerDown}
      >
        {/* Background + frame */}
        <rect x={PAD_LEFT} y={PAD_TOP} width={innerW} height={innerH} className="scene-channels-graph-bg" />

        {/* Segment highlight for the selected key's curve */}
        {segmentHighlight && (
          <rect
            x={segmentHighlight.x}
            y={PAD_TOP}
            width={segmentHighlight.width}
            height={innerH}
            className="scene-channels-graph-seg-highlight"
          />
        )}

        {/* Y-axis ticks at min / mid / max */}
        {[0, 0.5, 1].map((p) => {
          const v = yLo + (yHi - yLo) * (1 - p);
          const py = PAD_TOP + innerH * p;
          return (
            <g key={p} className="scene-channels-graph-tick">
              <line x1={PAD_LEFT} y1={py} x2={PAD_LEFT + innerW} y2={py} />
              <text x={PAD_LEFT - 4} y={py + 3} textAnchor="end" className="scene-channels-graph-tick-label">
                {v.toFixed(name === 'alpha' || name === 'tint' ? 2 : 0)}
              </text>
            </g>
          );
        })}
        {/* Time-axis tick at 0 and clip.duration */}
        <text x={PAD_LEFT} y={totalH - 4} className="scene-channels-graph-tick-label">0</text>
        <text x={PAD_LEFT + innerW} y={totalH - 4} textAnchor="end" className="scene-channels-graph-tick-label">
          {clipDuration.toFixed(2)}s
        </text>
        {/* Per-component curves */}
        {paths.map((p) => (
          <path key={p.comp} d={p.d} className="scene-channels-graph-curve" stroke={p.color} />
        ))}
        {/* Keyframe dots — one per component for vec2/rgb (linked mode).
            Split-mode sub-rows render keys as scalars (one dot per key).
            `is-selected` matches on (name, idx, comp) so clicking the X
            dot doesn't also highlight the Y dot. */}
        {keys.map((k, idx) => {
          const comps = componentsOfKey(name, k.v, layout);
          return comps.map((c) => {
            const effectiveComp = parentComp || c.comp;
            const isSel = selectedKey?.name === name
              && selectedKey.idx === idx
              && (selectedKey.comp === effectiveComp
                  || (selectedKey.comp == null && effectiveComp === '_'));
            return (
              <circle
                key={`${idx}-${c.comp}`}
                cx={xToPx(k.t)}
                cy={yToPx(c.value)}
                r={KEY_RADIUS + (isSel ? 1 : 0)}
                className={'scene-channels-graph-key' + (isSel ? ' is-selected' : '')}
                fill={COMPONENT_COLORS[name]?.[effectiveComp] || '#a8afc0'}
                onPointerDown={beginKeyDrag(idx, c.comp)}
              />
            );
          });
        })}
        {/* Tangent handles for the selected key (+ faint neighbour context) */}
        {tangentUI && (
          <g className="scene-graph-tangents">
            {tangentUI.neighbours.map((nb) => (
              <g key={nb.key} className="scene-graph-tan scene-graph-tan--ghost">
                <line x1={nb.px} y1={nb.py} x2={nb.x} y2={nb.y} className="scene-graph-tan-line" />
                <circle cx={nb.x} cy={nb.y} r={TAN_HANDLE_R - 1} className="scene-graph-tan-knob" />
              </g>
            ))}
            <g className="scene-graph-tan">
              <line x1={tangentUI.inn.kx} y1={tangentUI.inn.ky} x2={tangentUI.inn.x} y2={tangentUI.inn.y} className="scene-graph-tan-line" />
              <circle
                cx={tangentUI.inn.x}
                cy={tangentUI.inn.y}
                r={TAN_HANDLE_R}
                className="scene-graph-tan-knob is-interactive"
                onPointerDown={beginTanDrag('in')}
              />
            </g>
            <g className="scene-graph-tan">
              <line x1={tangentUI.out.kx} y1={tangentUI.out.ky} x2={tangentUI.out.x} y2={tangentUI.out.y} className="scene-graph-tan-line" />
              <circle
                cx={tangentUI.out.x}
                cy={tangentUI.out.y}
                r={TAN_HANDLE_R}
                className="scene-graph-tan-knob is-interactive"
                onPointerDown={beginTanDrag('out')}
              />
            </g>
          </g>
        )}

        {/* Playhead line — only visible while playhead is inside the clip range */}
        {localT >= 0 && localT <= clipDuration && (
          <line
            x1={playheadX}
            y1={PAD_TOP}
            x2={playheadX}
            y2={PAD_TOP + innerH}
            className="scene-channels-graph-playhead"
          />
        )}
      </svg>
    </div>
  );
}
