// ClipGraphEditor — whole-clip animation curve editor.
//
// Renders one subplot per logical channel with a shared time axis at
// the bottom. Each subplot has its own Y axis auto-fitted to the keys'
// value range (absolute, not normalised). Drag a key in 2D to change
// (t, v) simultaneously. Click an empty point on the curve to insert
// a new key at that exact moment. The subplots stack vertically so
// the artist can see the whole motion in one place.
//
// vec2 / rgb channels overlay one line per component in distinct
// colours. Scalar channels (rotation, alpha) render a single line.

import { useMemo, useRef, useState } from 'react';
import { curveEval } from '../engine/animation/curves.js';
import {
  CHANNEL_NAMES,
  channelLayout,
  evalChannel,
  insertOrUpdateKey,
  moveKeyTime,
  setKeyComponent,
  setKeyValue
} from '../engine/animation/keyframes.js';

const PLOT_HEIGHT = 96;       // pixels per subplot
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const KEY_RADIUS = 5;
const SAMPLES_PER_PIXEL = 1 / 4;

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
function componentsOfKey(name, v) {
  const layout = channelLayout(name);
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
function fitYRange(name, keys) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of keys) {
    for (const { value } of componentsOfKey(name, k.v)) {
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

export function ClipGraphEditor({ clip, flowTime, selectedKey, onSelectKey, onPatchChannel }) {
  const channels = clip.channels || {};
  const duration = Math.max(0.001, clip.duration || 1);
  const visibleNames = useMemo(
    () => CHANNEL_NAMES.filter((n) => channels[n]?.keys?.length),
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

  return (
    <div className="scene-channels-graph" ref={wrapRef}>
      {visibleNames.map((name) => (
        <ChannelSubplot
          key={name}
          name={name}
          channel={channels[name]}
          clipDuration={duration}
          flowTime={flowTime}
          clipStart={clip.start}
          plotW={plotW}
          selectedKey={selectedKey}
          onSelectKey={onSelectKey}
          onPatchChannel={onPatchChannel}
        />
      ))}
    </div>
  );
}

function ChannelSubplot({
  name, channel, clipDuration, flowTime, clipStart, plotW,
  selectedKey, onSelectKey, onPatchChannel
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const layout = channelLayout(name);
  const keys = channel?.keys || [];
  const [yLo, yHi] = useMemo(() => fitYRange(name, keys), [name, keys]);
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
      const v = evalChannel(channel, t);
      if (v == null) continue;
      const dispComps = componentsOfKey(name, v);
      for (const { comp, value } of dispComps) {
        const px = xToPx(t);
        const py = yToPx(value);
        pathByComp[comp] += (pathByComp[comp] ? ' L' : 'M') + `${px.toFixed(1)} ${py.toFixed(1)}`;
      }
    }
    return Object.entries(pathByComp).map(([comp, d]) => ({
      comp,
      d,
      color: COMPONENT_COLORS[name]?.[comp] || '#a8afc0'
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, name, layout, clipDuration, innerW, innerH, yLo, yHi, samples]);

  // Begin dragging a key. We carry comp so vec2 / rgb drags only touch
  // that component (drag y-axis updates only `x` of position, etc.).
  const beginKeyDrag = (idx, comp) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectKey?.({ name, idx });
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
      onSelectKey?.({ name, idx: newIdx });
      st.idx = newIdx;
    }
  };

  const onPointerUp = (e) => {
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
    const next = insertOrUpdateKey(channel, t, currentV, { out: 'linear' });
    onPatchChannel?.(name, next);
  };

  const playheadX = xToPx(localT);

  return (
    <div className="scene-channels-graph-row">
      <div className="scene-channels-graph-head">
        <span className="scene-channels-graph-name">{CHANNEL_DISPLAY_NAME[name] || name}</span>
        <span className="scene-channels-graph-range">
          {yLo.toFixed(name === 'alpha' || name === 'tint' ? 2 : 1)} … {yHi.toFixed(name === 'alpha' || name === 'tint' ? 2 : 1)}
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
        {/* Keyframe dots — one per component for vec2/rgb */}
        {keys.map((k, idx) => {
          const comps = componentsOfKey(name, k.v);
          const isSel = selectedKey?.name === name && selectedKey.idx === idx;
          return comps.map((c) => (
            <circle
              key={`${idx}-${c.comp}`}
              cx={xToPx(k.t)}
              cy={yToPx(c.value)}
              r={KEY_RADIUS + (isSel ? 1 : 0)}
              className={'scene-channels-graph-key' + (isSel ? ' is-selected' : '')}
              fill={COMPONENT_COLORS[name]?.[c.comp] || '#a8afc0'}
              onPointerDown={beginKeyDrag(idx, c.comp)}
            />
          ));
        })}
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
