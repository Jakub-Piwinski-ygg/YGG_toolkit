import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const webpMeta = {
  id: 'webp',
  label: 'Convert to WebP',
  small: 'png → webp via canvas',
  icon: '📷',
  needsMagick: false,
  batchMode: false,
  desc: "Converts PNG files to WebP using the browser's built-in Canvas encoder — no WASM needed. WebP is typically 25–34% smaller than PNG."
};

export function WebPTool() {
  const [quality, setQuality] = useState(80);
  const [lossless, setLossless] = useState(false);
  const { registerRunner } = useApp();

  // Keep a live ref so the registered runner always sees fresh settings
  // without re-registering (and tearing down) on every slider tick.
  const settingsRef = useRef({ quality, lossless });
  settingsRef.current = { quality, lossless };

  useEffect(() => {
    registerRunner(webpMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '.webp',
      run: async (_uint8, _name, file) => {
        const { quality, lossless } = settingsRef.current;
        return new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            c.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
              'image/webp',
              lossless ? 1.0 : quality / 100
            );
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image load failed'));
          };
          img.src = url;
        });
      }
    });
    return () => registerRunner(webpMeta.id, null);
  }, [registerRunner]);

  return (
    <div className="field-row">
      <div className="field">
        <label>
          Quality — <span style={{ color: 'var(--accent)' }}>{quality}</span>
        </label>
        <input
          type="range"
          min="1"
          max="100"
          value={quality}
          onChange={(e) => setQuality(+e.target.value)}
        />
      </div>
      <div className="field">
        <label>Mode</label>
        <select
          value={lossless ? '1' : '0'}
          onChange={(e) => setLossless(e.target.value === '1')}
        >
          <option value="0">Lossy (smaller file)</option>
          <option value="1">Lossless (max quality)</option>
        </select>
      </div>
    </div>
  );
}
