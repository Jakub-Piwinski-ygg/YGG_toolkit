import { useCallback, useEffect, useRef, useState } from 'react';

// ── Color math ───────────────────────────────────────────────────────────────

function hexToRgbInt(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
    .join('');
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, v };
}

function hsvToRgb(h, s, v) {
  h /= 360;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const cases = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]];
  const [r, g, b] = cases[i % 6];
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pointerFraction(e, el) {
  const rect = el.getBoundingClientRect();
  return {
    x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
  };
}

// ── Component ────────────────────────────────────────────────────────────────

// Props: value (hex string "#rrggbb"), onChange (hex => void)
export function HsvColorPicker({ value, onChange }) {
  const [hsv, setHsv] = useState(() => {
    try { const rgb = hexToRgbInt(value || '#111111'); return rgbToHsv(rgb.r, rgb.g, rgb.b); }
    catch { return { h: 0, s: 0, v: 0.1 }; }
  });
  const [hexInput, setHexInput] = useState(value || '#111111');

  const svCanvasRef = useRef(null);  // canvas element — for 2D drawing
  const svDivRef = useRef(null);     // wrapper div — for pointer event bounds
  const dragging = useRef(null);     // 'sv' | 'hue' | null

  // Sync when the controlled value changes from outside
  useEffect(() => {
    if (!value) return;
    try {
      const rgb = hexToRgbInt(value);
      const next = rgbToHsv(rgb.r, rgb.g, rgb.b);
      setHsv(next);
      setHexInput(value);
    } catch { /* ignore */ }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw the SV canvas whenever hue changes
  useEffect(() => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.fillStyle = `hsl(${hsv.h}, 100%, 50%)`;
    ctx.fillRect(0, 0, w, h);
    const wg = ctx.createLinearGradient(0, 0, w, 0);
    wg.addColorStop(0, 'rgba(255,255,255,1)');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wg; ctx.fillRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  }, [hsv.h]);

  const emit = useCallback((h, s, v) => {
    const next = { h, s, v };
    setHsv(next);
    const rgb = hsvToRgb(h, s, v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    setHexInput(hex);
    onChange?.(hex);
  }, [onChange]);

  // SV square pointer handlers (capture so drag works outside element)
  const onSvDown = (e) => {
    dragging.current = 'sv';
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pointerFraction(e, e.currentTarget);
    emit(hsv.h, x, 1 - y);
  };
  const onSvMove = (e) => {
    if (dragging.current !== 'sv') return;
    const { x, y } = pointerFraction(e, e.currentTarget);
    emit(hsv.h, x, 1 - y);
  };
  const onSvUp = () => { dragging.current = null; };

  // Hue bar pointer handlers
  const onHueDown = (e) => {
    dragging.current = 'hue';
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x } = pointerFraction(e, e.currentTarget);
    emit(x * 360, hsv.s, hsv.v);
  };
  const onHueMove = (e) => {
    if (dragging.current !== 'hue') return;
    const { x } = pointerFraction(e, e.currentTarget);
    emit(x * 360, hsv.s, hsv.v);
  };
  const onHueUp = () => { dragging.current = null; };

  const onHexChange = (e) => {
    const raw = e.target.value;
    setHexInput(raw);
    if (/^#[0-9a-f]{6}$/i.test(raw)) {
      try {
        const rgb = hexToRgbInt(raw);
        const next = rgbToHsv(rgb.r, rgb.g, rgb.b);
        setHsv(next);
        onChange?.(raw);
      } catch { /* ignore */ }
    }
  };

  const { r: pr, g: pg, b: pb } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const previewHex = rgbToHex(pr, pg, pb);

  return (
    <div className="hsv-picker">
      {/* SV square */}
      <div
        ref={svDivRef}
        className="hsv-sv-wrap"
        onPointerDown={onSvDown}
        onPointerMove={onSvMove}
        onPointerUp={onSvUp}
      >
        <canvas ref={svCanvasRef} className="hsv-sv-canvas" width={160} height={120} />
        <div
          className="hsv-cursor"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      {/* Hue bar */}
      <div
        className="hsv-hue-wrap"
        onPointerDown={onHueDown}
        onPointerMove={onHueMove}
        onPointerUp={onHueUp}
      >
        <div className="hsv-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      {/* Swatch + hex input */}
      <div className="hsv-bottom">
        <div className="hsv-swatch" style={{ background: previewHex }} />
        <input
          className="hsv-hex"
          type="text"
          value={hexInput}
          onChange={onHexChange}
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// Utility export for SpinePlayer (converts hex → 0-1 float channels)
export function hexToRgb01(hex) {
  try {
    const { r, g, b } = hexToRgbInt(hex);
    return { r: r / 255, g: g / 255, b: b / 255 };
  } catch {
    return { r: 0, g: 0, b: 0 };
  }
}
