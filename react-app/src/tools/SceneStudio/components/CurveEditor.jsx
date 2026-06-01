// CurveEditor — editable cubic-bezier surface with two draggable handles.
//
// `value` is a curve spec (preset string or `{ bezier: [x1, y1, x2, y2] }`).
// `onChange(nextSpec)` fires on every drag step so the parent re-renders
// motion in real time. Clicking a preset chip overwrites the spec with
// the preset's canonical bezier.

import { useRef, useState } from 'react';
import {
  CURVE_PRESETS,
  detectPreset,
  formatBezier,
  PRESET_BEZIER,
  toBezier
} from '../engine/animation/curves.js';

const SIZE = 200;
const PAD = 28;
const INNER = SIZE - 2 * PAD;
const SAMPLES = 56;

function valueToPx(v, axis) {
  if (axis === 'x') return PAD + v * INNER;
  // y axis: 0 at the bottom of the plot, 1 at the top
  return PAD + (1 - v) * INNER;
}

function pixelToValue(px, py, rect) {
  const sx = (px - rect.left) * (SIZE / rect.width);
  const sy = (py - rect.top) * (SIZE / rect.height);
  return {
    x: (sx - PAD) / INNER,
    y: 1 - (sy - PAD) / INNER
  };
}

function buildCurvePath(x1, y1, x2, y2) {
  let d = '';
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const y = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    d += (i === 0 ? 'M' : ' L') + `${valueToPx(x, 'x').toFixed(2)} ${valueToPx(y, 'y').toFixed(2)}`;
  }
  return d;
}

export function CurveEditor({ value, onChange }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'p1' | 'p2' | null
  const bezier = toBezier(value);
  const [x1, y1, x2, y2] = bezier;
  const path = buildCurvePath(x1, y1, x2, y2);
  const detected = detectPreset(value);

  const handlePointerDown = (id) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(id);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  const handlePointerMove = (e) => {
    if (!dragging) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { x, y } = pixelToValue(e.clientX, e.clientY, rect);
    // x is clamped so handles can't cross the unit interval — that keeps
    // the bezier monotonic in time. y is allowed to overshoot.
    const cx = Math.max(0, Math.min(1, x));
    const cy = Math.max(-1, Math.min(2, y));
    const next = bezier.slice();
    if (dragging === 'p1') { next[0] = cx; next[1] = cy; }
    else if (dragging === 'p2') { next[2] = cx; next[3] = cy; }
    onChange?.({ bezier: next });
  };

  const handlePointerUp = (e) => {
    if (!dragging) return;
    setDragging(null);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  const pickPreset = (name) => {
    if (name === 'custom') {
      // Emit the current bezier as a custom spec (so we drop the preset name)
      onChange?.({ bezier: bezier.slice() });
      return;
    }
    onChange?.(name);
  };

  // Axis label X positions
  const xZero = valueToPx(0, 'x');
  const xOne = valueToPx(1, 'x');
  const yZero = valueToPx(0, 'y');
  const yOne = valueToPx(1, 'y');

  return (
    <div className="scene-curve-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="scene-curve-editor-svg"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Plot background + frame */}
        <rect x={PAD} y={PAD} width={INNER} height={INNER} className="scene-curve-bg" />
        {/* Mid-line guides at 0.25, 0.5, 0.75 */}
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v} className="scene-curve-grid">
            <line x1={valueToPx(v, 'x')} y1={PAD} x2={valueToPx(v, 'x')} y2={PAD + INNER} />
            <line x1={PAD} y1={valueToPx(v, 'y')} x2={PAD + INNER} y2={valueToPx(v, 'y')} />
          </g>
        ))}
        {/* Identity diagonal as visual guide */}
        <line x1={xZero} y1={yZero} x2={xOne} y2={yOne} className="scene-curve-guide" />
        {/* Handle stems */}
        <line x1={xZero} y1={yZero} x2={valueToPx(x1, 'x')} y2={valueToPx(y1, 'y')} className="scene-curve-handle-line" />
        <line x1={xOne} y1={yOne} x2={valueToPx(x2, 'x')} y2={valueToPx(y2, 'y')} className="scene-curve-handle-line" />
        {/* The curve itself */}
        <path d={path} className="scene-curve-path" />
        {/* Anchors at (0,0) and (1,1) */}
        <circle cx={xZero} cy={yZero} r={3} className="scene-curve-anchor" />
        <circle cx={xOne} cy={yOne} r={3} className="scene-curve-anchor" />
        {/* Draggable control points */}
        <circle
          cx={valueToPx(x1, 'x')}
          cy={valueToPx(y1, 'y')}
          r={8}
          className={'scene-curve-handle' + (dragging === 'p1' ? ' is-dragging' : '')}
          onPointerDown={handlePointerDown('p1')}
        />
        <circle
          cx={valueToPx(x2, 'x')}
          cy={valueToPx(y2, 'y')}
          r={8}
          className={'scene-curve-handle' + (dragging === 'p2' ? ' is-dragging' : '')}
          onPointerDown={handlePointerDown('p2')}
        />
        {/* Axis labels */}
        <text x={xZero - 6} y={yZero + 14} className="scene-curve-axis-label">0</text>
        <text x={xOne - 4} y={yZero + 14} className="scene-curve-axis-label">1</text>
        <text x={xZero - 14} y={yOne + 4} className="scene-curve-axis-label">1</text>
      </svg>

      <div className="scene-curve-presets">
        {CURVE_PRESETS.map((name) => (
          <button
            key={name}
            type="button"
            className={'scene-chip scene-chip--xs' + (detected === name ? ' on' : '')}
            onClick={() => pickPreset(name)}
            title={`Snap handles to "${name}"`}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          className={'scene-chip scene-chip--xs' + (detected === 'custom' ? ' on' : '')}
          onClick={() => pickPreset('custom')}
          title="Keep current handle positions as a custom curve"
        >
          custom
        </button>
      </div>

      <div className="scene-curve-readout" title={`cubic-bezier(${bezier.map((n) => n.toFixed(3)).join(', ')})`}>
        {formatBezier({ bezier })}
      </div>
    </div>
  );
}

// Helper for callers that want a preview without the editor surface.
export function CurveThumbnail({ value, size = 28 }) {
  const bezier = toBezier(value);
  const [x1, y1, x2, y2] = bezier;
  const W = size;
  const H = size;
  const PADt = 2;
  const INNERt = size - 2 * PADt;
  const toX = (v) => PADt + v * INNERt;
  const toY = (v) => PADt + (1 - v) * INNERt;
  let d = '';
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const y = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    d += (i === 0 ? 'M' : ' L') + `${toX(x).toFixed(2)} ${toY(y).toFixed(2)}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="scene-curve-thumb">
      <line x1={toX(0)} y1={toY(0)} x2={toX(1)} y2={toY(1)} className="scene-curve-thumb-guide" />
      <path d={d} className="scene-curve-thumb-path" />
    </svg>
  );
}

// Re-export PRESET_BEZIER so callers can introspect / theme presets.
export { PRESET_BEZIER };
