import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const gradientMapMeta = {
  id: 'gradientmap',
  label: 'Gradient Map',
  small: 'map luminance to colours',
  icon: '🌈',
  needsMagick: false,
  batchMode: false,
  desc: "Maps the luminance of each pixel to a user-defined colour gradient — just like Photoshop's Gradient Map adjustment. Click the gradient bar to add colour stops, drag to reposition, select and press ✕ to remove. Alpha channel is preserved."
};

const PRESETS = {
  'B → W': [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }],
  'Warm': [{ pos: 0, color: '#1a0a00' }, { pos: .3, color: '#8b2500' }, { pos: .6, color: '#ff8c00' }, { pos: 1, color: '#fffde0' }],
  'Cool': [{ pos: 0, color: '#020024' }, { pos: .35, color: '#0d47a1' }, { pos: .7, color: '#00bcd4' }, { pos: 1, color: '#e0f7fa' }],
  'Sunset': [{ pos: 0, color: '#1a0533' }, { pos: .25, color: '#6a1b9a' }, { pos: .5, color: '#e53935' }, { pos: .75, color: '#ff9800' }, { pos: 1, color: '#fff9c4' }],
  'Duotone Cyan': [{ pos: 0, color: '#0d0d0d' }, { pos: 1, color: '#00e5ff' }],
  'Duotone Gold': [{ pos: 0, color: '#1a1200' }, { pos: 1, color: '#ffd700' }],
  'Heat': [{ pos: 0, color: '#000004' }, { pos: .25, color: '#420a68' }, { pos: .5, color: '#dd513a' }, { pos: .75, color: '#fca50a' }, { pos: 1, color: '#fcffa4' }],
  'Vintage': [{ pos: 0, color: '#2b1f0e' }, { pos: .3, color: '#6b4226' }, { pos: .6, color: '#c2956a' }, { pos: 1, color: '#f5e6c8' }]
};

const sortStops = (stops) => [...stops].sort((a, b) => a.pos - b.pos);

function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function sampleGradient(stops, t) {
  if (stops.length === 1) return hexToRgb(stops[0].color);
  if (t <= stops[0].pos) return hexToRgb(stops[0].color);
  if (t >= stops[stops.length - 1].pos) return hexToRgb(stops[stops.length - 1].color);
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].pos && t <= stops[i + 1].pos) {
      const range = stops[i + 1].pos - stops[i].pos;
      const frac = range === 0 ? 0 : (t - stops[i].pos) / range;
      const c0 = hexToRgb(stops[i].color);
      const c1 = hexToRgb(stops[i + 1].color);
      return {
        r: Math.round(c0.r + (c1.r - c0.r) * frac),
        g: Math.round(c0.g + (c1.g - c0.g) * frac),
        b: Math.round(c0.b + (c1.b - c0.b) * frac)
      };
    }
  }
  return hexToRgb(stops[stops.length - 1].color);
}

function buildLUT(stops) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = sampleGradient(stops, i / 255);
    lut[i * 3] = c.r;
    lut[i * 3 + 1] = c.g;
    lut[i * 3 + 2] = c.b;
  }
  return lut;
}

export function GradientMapTool() {
  const [stops, setStops] = useState([
    { pos: 0, color: '#000000' },
    { pos: 1, color: '#ffffff' }
  ]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [lumMode, setLumMode] = useState('rec709');
  const [alphaMode, setAlphaMode] = useState('keep');
  const { registerRunner } = useApp();

  const barRef = useRef(null);
  const canvasRef = useRef(null);
  const colorPickerRef = useRef(null);

  const settingsRef = useRef({ stops, lumMode, alphaMode });
  settingsRef.current = { stops, lumMode, alphaMode };

  const drawBar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (const s of stops) grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, [stops]);

  useEffect(() => {
    drawBar();
    const handler = () => drawBar();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [drawBar]);

  useEffect(() => {
    registerRunner(gradientMapMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_gmap.png',
      run: async (_u, _n, file) => {
        const { stops, lumMode, alphaMode } = settingsRef.current;
        const lut = buildLUT(stops);
        return new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(url);
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
              const r = d[i], g = d[i + 1], b = d[i + 2];
              let lum;
              switch (lumMode) {
                case 'avg': lum = Math.round((r + g + b) / 3); break;
                case 'lightness': lum = Math.round((Math.max(r, g, b) + Math.min(r, g, b)) / 2); break;
                case 'maxrgb': lum = Math.max(r, g, b); break;
                default: lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b); break;
              }
              lum = Math.max(0, Math.min(255, lum));
              d[i] = lut[lum * 3];
              d[i + 1] = lut[lum * 3 + 1];
              d[i + 2] = lut[lum * 3 + 2];
              if (alphaMode === 'full') d[i + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
            c.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('toBlob failed'))), 'image/png');
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
          img.src = url;
        });
      }
    });
    return () => registerRunner(gradientMapMeta.id, null);
  }, [registerRunner]);

  const startDrag = (e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveIdx(idx);
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const stopObj = stops[idx];
    let currentStops = stops;
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const next = currentStops.map((s) => (s === stopObj ? { ...s, pos: x } : s));
      const sorted = sortStops(next);
      const newActive = sorted.findIndex((s) => s === next.find((n) => n === stopObj) || (Math.abs(s.pos - x) < 0.001 && s.color === stopObj.color));
      currentStops = sorted.map((s) => (s.color === stopObj.color && Math.abs(s.pos - x) < 0.001 ? stopObj : s));
      // Simpler: just mutate stopObj and sort
      stopObj.pos = x;
      const re = sortStops(currentStops);
      currentStops = re;
      setStops(re);
      const newIdx = re.indexOf(stopObj);
      if (newIdx >= 0) setActiveIdx(newIdx);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const addStopAt = (e) => {
    if (e.target.classList.contains('gm-stop')) return;
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const col = sampleGradient(stops, pos);
    const hex = '#' + [col.r, col.g, col.b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const newStop = { pos, color: hex };
    const next = sortStops([...stops, newStop]);
    setStops(next);
    setActiveIdx(next.indexOf(newStop));
  };

  const removeActive = () => {
    if (stops.length <= 1) return;
    const next = stops.filter((_, i) => i !== activeIdx);
    setStops(next);
    setActiveIdx(Math.min(activeIdx, next.length - 1));
  };

  const changeColor = (hex) => {
    setStops((prev) => prev.map((s, i) => (i === activeIdx ? { ...s, color: hex } : s)));
  };

  const loadPreset = (name) => {
    const p = PRESETS[name];
    if (!p) return;
    setStops(p.map((s) => ({ ...s })));
    setActiveIdx(0);
  };

  const active = stops[activeIdx];

  return (
    <>
      <div className="gm-gradient-bar-wrap">
        <div className="gm-gradient-bar" ref={barRef} onClick={addStopAt}>
          <canvas className="gm-gradient-canvas" ref={canvasRef}></canvas>
          <div className="gm-stops-track">
            {stops.map((s, i) => (
              <div
                key={i}
                className={`gm-stop${i === activeIdx ? ' active' : ''}`}
                style={{ left: `${s.pos * 100}%`, background: s.color }}
                onMouseDown={(e) => startDrag(e, i)}
                onDoubleClick={() => {
                  if (stops.length > 1) {
                    const next = stops.filter((_, j) => j !== i);
                    setStops(next);
                    setActiveIdx(Math.min(activeIdx, next.length - 1));
                  }
                }}
                title={`Pos: ${(s.pos * 100).toFixed(0)}%`}
              />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '.58rem', color: '#444' }}>
        <span>click bar to add stop</span><span>·</span><span>drag to move</span><span>·</span><span>double-click a stop to remove</span>
      </div>

      <div className="gm-controls">
        <div className="gm-color-edit" onClick={() => colorPickerRef.current?.click()}>
          <div className="gm-color-dot-lg" style={{ background: active?.color || '#000' }} />
          <span className="gm-color-hex">{active?.color || '#000000'}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.58rem', color: '#444', marginLeft: '.15rem' }}>
            {active ? `${(active.pos * 100).toFixed(0)}%` : '0%'}
          </span>
        </div>
        <input
          ref={colorPickerRef}
          type="color"
          value={active?.color || '#000000'}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          onInput={(e) => changeColor(e.target.value)}
          onChange={(e) => changeColor(e.target.value)}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.58rem', color: '#555' }}>{stops.length} stops</span>
        <button
          className="btn"
          onClick={removeActive}
          style={{ fontSize: '.58rem', padding: '.2rem .55rem', color: 'var(--accent3)', borderColor: 'rgba(255,107,71,.3)', marginLeft: 'auto' }}
          title="Remove selected stop (min 1)"
        >
          ✕ remove stop
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.6rem', color: 'var(--muted)', marginRight: '.15rem' }}>Presets</span>
        {Object.keys(PRESETS).map((k) => (
          <button key={k} className="gm-preset-btn" onClick={() => loadPreset(k)}>{k}</button>
        ))}
      </div>

      <div className="field-row">
        <div className="field">
          <label>Luminance formula</label>
          <select value={lumMode} onChange={(e) => setLumMode(e.target.value)}>
            <option value="rec709">Rec. 709 (0.2126R + 0.7152G + 0.0722B)</option>
            <option value="avg">Average ((R+G+B) / 3)</option>
            <option value="lightness">Lightness ((max+min) / 2)</option>
            <option value="maxrgb">Max channel (desaturate)</option>
          </select>
        </div>
        <div className="field">
          <label>Alpha handling</label>
          <select value={alphaMode} onChange={(e) => setAlphaMode(e.target.value)}>
            <option value="keep">Preserve original alpha</option>
            <option value="full">Force fully opaque</option>
          </select>
        </div>
      </div>
    </>
  );
}
