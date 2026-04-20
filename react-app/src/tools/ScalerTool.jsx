import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getImageDimensions } from '../utils/image.js';

export const scalerMeta = {
  id: 'scaler',
  label: 'Image Scaler',
  small: 'scale canvas + image together',
  icon: '⤡',
  needsMagick: true,
  batchMode: false,
  desc: 'Scales image and canvas together using ImageMagick WASM for high-quality resampling. Choose from multiple filter algorithms — Lanczos is the best general-purpose choice; Mitchell is great for mixed content; Point gives nearest-neighbour (pixel-art). Enter a scale factor or set a longest-edge target in pixels.'
};

export function ScalerTool() {
  const [factor, setFactor] = useState(1.0);
  const [longestEdge, setLongestEdge] = useState('');
  const [filter, setFilter] = useState('Lanczos');
  const [preview, setPreview] = useState('load files to see size preview');
  const { inputFiles, registerRunner } = useApp();

  const settingsRef = useRef({ factor, longestEdge, filter });
  settingsRef.current = { factor, longestEdge, filter };

  useEffect(() => {
    registerRunner(scalerMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_scaled.png',
      run: async (uint8) => {
        const { factor, longestEdge, filter } = settingsRef.current;
        const dims = await getImageDimensions(uint8);
        const le = parseInt(longestEdge) || 0;
        let nw, nh;
        if (le > 0) {
          const longest = Math.max(dims.w, dims.h);
          const s = le / longest;
          nw = Math.round(dims.w * s);
          nh = Math.round(dims.h * s);
        } else {
          nw = Math.round(dims.w * factor);
          nh = Math.round(dims.h * factor);
        }
        nw = Math.max(1, nw);
        nh = Math.max(1, nh);

        const r = await window._Magick.Call(
          [{ name: 'input.png', content: uint8 }],
          ['convert', 'input.png', '-filter', filter, '-resize', `${nw}x${nh}!`, '+repage', 'output.png']
        );
        if (!r || !r.length) throw new Error('No output from ImageMagick');
        return r[0].blob;
      }
    });
    return () => registerRunner(scalerMeta.id, null);
  }, [registerRunner]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!inputFiles.length) {
        setPreview('load files to see size preview');
        return;
      }
      try {
        const bytes = new Uint8Array(await inputFiles[0].file.arrayBuffer());
        const dims = await getImageDimensions(bytes);
        if (cancelled) return;
        const le = parseInt(longestEdge) || 0;
        let nw, nh;
        if (le > 0) {
          const longest = Math.max(dims.w, dims.h);
          const s = le / longest;
          nw = Math.round(dims.w * s);
          nh = Math.round(dims.h * s);
        } else {
          nw = Math.round(dims.w * (factor || 1));
          nh = Math.round(dims.h * (factor || 1));
        }
        setPreview(`First image: ${dims.w}×${dims.h} px → ${Math.max(1, nw)}×${Math.max(1, nh)} px`);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [inputFiles, factor, longestEdge]);

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Scale Factor</label>
          <input type="number" min="0.01" max="20" step="0.01" value={factor} onChange={(e) => setFactor(+e.target.value)} />
        </div>
        <div className="field">
          <label>Longest edge override (px)</label>
          <input type="number" min="1" max="16384" placeholder="— use factor —" value={longestEdge} onChange={(e) => setLongestEdge(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Resampling filter</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="Lanczos">Lanczos — sharpest, best for photos &amp; icons</option>
          <option value="Mitchell">Mitchell — smooth, great for mixed content</option>
          <option value="Catrom">Catmull-Rom — sharp edges, slight ringing</option>
          <option value="Cubic">Cubic — smoother than Catmull-Rom</option>
          <option value="Triangle">Triangle (Bilinear) — fast, mild softening</option>
          <option value="Box">Box (Nearest) — pixel-art / hard edges</option>
          <option value="Gaussian">Gaussian — very soft, good for blur-down</option>
          <option value="Hermite">Hermite — preserves edges well</option>
        </select>
      </div>
      <div className="info-pill">{preview}</div>
    </>
  );
}
