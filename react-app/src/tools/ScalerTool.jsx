import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getImageDimensions, scaleImageWasm } from '../utils/image.js';
import { makeBatchRun } from '../utils/batch.js';

export const scalerMeta = {
  id: 'scaler',
  label: 'Image Scaler',
  small: 'scale canvas + image together',
  icon: '⤡',
  needsMagick: true,
  batchMode: true,
  desc: 'Scales image and canvas together using ImageMagick WASM for high-quality resampling. Choose from multiple filter algorithms — Lanczos is the best general-purpose choice; Mitchell is great for mixed content; Point gives nearest-neighbour (pixel-art). Enter a scale factor or set a longest-edge target in pixels.'
};

// Resolve the target dimensions for a source image given the current settings.
// axis: 'both' scales uniformly; 'w'/'h' scale only that axis and leave the
// other untouched; 'xy' scales each axis independently (factorY/pxY drive
// height). The pixel field is a longest-edge target in 'both' mode and a direct
// target size for the relevant axis otherwise.
function targetSize(dims, { factor, pxTarget, factorY, pxY, axis }) {
  const px = parseInt(pxTarget) || 0;
  let nw, nh;
  if (axis === 'w') {
    nw = px > 0 ? px : Math.round(dims.w * factor);
    nh = dims.h;
  } else if (axis === 'h') {
    nh = px > 0 ? px : Math.round(dims.h * factor);
    nw = dims.w;
  } else if (axis === 'xy') {
    const pyy = parseInt(pxY) || 0;
    nw = px > 0 ? px : Math.round(dims.w * factor);
    nh = pyy > 0 ? pyy : Math.round(dims.h * factorY);
  } else if (px > 0) {
    const s = px / Math.max(dims.w, dims.h);
    nw = Math.round(dims.w * s);
    nh = Math.round(dims.h * s);
  } else {
    nw = Math.round(dims.w * factor);
    nh = Math.round(dims.h * factor);
  }
  return { nw: Math.max(1, nw), nh: Math.max(1, nh) };
}

export function ScalerTool() {
  const [factor, setFactor] = useState(1.0);
  const [longestEdge, setLongestEdge] = useState('');
  const [factorY, setFactorY] = useState(1.0);
  const [pxY, setPxY] = useState('');
  const [axis, setAxis] = useState('both');
  const [filter, setFilter] = useState('Lanczos');
  const [preview, setPreview] = useState('load files to see size preview');
  const { inputFiles, registerRunner, log, setProgressLabel } = useApp();

  const settingsRef = useRef({ factor, longestEdge, factorY, pxY, axis, filter });
  settingsRef.current = { factor, longestEdge, factorY, pxY, axis, filter };

  const xy = axis === 'xy';
  const pxLabel = axis === 'w' || xy ? 'Target width (px)'
    : axis === 'h' ? 'Target height (px)'
    : 'Longest edge override (px)';
  const factorLabel = xy ? 'Width factor' : 'Scale Factor';

  useEffect(() => {
    const outName = (n) => n.replace(/\.png$/i, '') + '_scaled.png';
    const processOne = async (uint8) => {
        const { factor, longestEdge, factorY, pxY, axis, filter } = settingsRef.current;
        const dims = await getImageDimensions(uint8);
        const { nw, nh } = targetSize(dims, { factor, pxTarget: longestEdge, factorY, pxY, axis });
        return scaleImageWasm(uint8, nw, nh, filter);
    };
    registerRunner(scalerMeta.id, {
      outName,
      run: makeBatchRun(processOne, outName, { log, setProgressLabel })
    });
    return () => registerRunner(scalerMeta.id, null);
  }, [registerRunner, log, setProgressLabel]);

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
        const { nw, nh } = targetSize(dims, { factor: factor || 1, pxTarget: longestEdge, factorY: factorY || 1, pxY, axis });
        setPreview(`First image: ${dims.w}×${dims.h} px → ${nw}×${nh} px`);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [inputFiles, factor, longestEdge, factorY, pxY, axis]);

  return (
    <>
      <div className="field">
        <label>Scale axis</label>
        <select value={axis} onChange={(e) => setAxis(e.target.value)}>
          <option value="both">Both — uniform (keep aspect ratio)</option>
          <option value="w">Width only — height unchanged</option>
          <option value="h">Height only — width unchanged</option>
          <option value="xy">Independent X &amp; Y — stretch each axis</option>
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label>{factorLabel}</label>
          <input type="number" min="0.01" max="20" step="0.01" value={factor} onChange={(e) => setFactor(+e.target.value)} />
        </div>
        <div className="field">
          <label>{pxLabel}</label>
          <input type="number" min="1" max="16384" placeholder="— use factor —" value={longestEdge} onChange={(e) => setLongestEdge(e.target.value)} />
        </div>
      </div>
      {xy && (
        <div className="field-row">
          <div className="field">
            <label>Height factor</label>
            <input type="number" min="0.01" max="20" step="0.01" value={factorY} onChange={(e) => setFactorY(+e.target.value)} />
          </div>
          <div className="field">
            <label>Target height (px)</label>
            <input type="number" min="1" max="16384" placeholder="— use factor —" value={pxY} onChange={(e) => setPxY(e.target.value)} />
          </div>
        </div>
      )}
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
