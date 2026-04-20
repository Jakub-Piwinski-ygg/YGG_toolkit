import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const greyToAlphaMeta = {
  id: 'greyalpha',
  label: 'Grey to Alpha',
  small: 'luminance → alpha channel',
  icon: '◑',
  needsMagick: false,
  batchMode: false,
  desc: 'Converts a greyscale texture so that its luminance becomes the alpha channel. The RGB output channels are set to white (or kept original). Bright pixels → opaque; dark pixels → transparent. Use the scale slider to amplify or reduce the effect (0 = fully transparent, 1 = 1:1, 10 = tenfold).'
};

export function GreyToAlphaTool() {
  const [scale, setScale] = useState(1.0);
  const [rgbMode, setRgbMode] = useState('white');
  const { inputFiles, registerRunner } = useApp();

  const settingsRef = useRef({ scale, rgbMode });
  settingsRef.current = { scale, rgbMode };

  useEffect(() => {
    registerRunner(greyToAlphaMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_alpha.png',
      run: async (_u, _n, file) => {
        const { scale, rgbMode } = settingsRef.current;
        const keepRGB = rgbMode === 'original';
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
              const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
              const alpha = Math.min(255, Math.max(0, Math.round(lum * scale)));
              if (!keepRGB) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }
              d[i + 3] = alpha;
            }
            ctx.putImageData(imgData, 0, 0);
            c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
          img.src = url;
        });
      }
    });
    return () => registerRunner(greyToAlphaMeta.id, null);
  }, [registerRunner]);

  const previewText = inputFiles.length
    ? `Alpha = luminance × ${scale.toFixed(1)}  ·  clamped to 0–255`
    : 'load a greyscale PNG to preview';

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>
            Alpha Scale — <span style={{ color: 'var(--accent)' }}>{scale.toFixed(1)}</span>
          </label>
          <input type="range" min="0" max="10" step="0.1" value={scale} onChange={(e) => setScale(+e.target.value)} />
        </div>
        <div className="field">
          <label>Output RGB</label>
          <select value={rgbMode} onChange={(e) => setRgbMode(e.target.value)}>
            <option value="white">White (255, 255, 255)</option>
            <option value="original">Keep original colours</option>
          </select>
        </div>
      </div>
      <div className="info-pill">{previewText}</div>
    </>
  );
}
