import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const rgbaMeta = {
  id: 'rgba',
  label: 'RGBA Mask Combiner',
  small: 'pack textures into channels',
  icon: '🎨',
  needsMagick: false,
  batchMode: true,
  desc: 'Packs up to 4 greyscale PNG textures into a single RGBA image — one texture per channel. Perfect for PBR mask maps (metallic, roughness, AO, height).'
};

const CH_COLOR = { R: '#ff4455', G: '#44ff88', B: '#4499ff', A: '#cccccc' };
const CH_HINT = { R: 'e.g. Metallic', G: 'e.g. Roughness', B: 'e.g. AO', A: 'e.g. Height' };

function toGrey(entry) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const g = new Uint8Array(c.width * c.height);
      for (let i = 0; i < g.length; i++)
        g[i] = Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
      resolve({ grey: g, w: c.width, h: c.height });
    };
    img.onerror = () => reject(new Error('Failed to load ' + entry.name));
    img.src = entry.url;
  });
}

export function RgbaMaskTool() {
  const [slots, setSlots] = useState({ R: null, G: null, B: null, A: null });
  const [outName, setOutName] = useState('mask_rgba');
  const { inputFiles, registerRunner } = useApp();

  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const outNameRef = useRef(outName);
  outNameRef.current = outName;

  // Prune slots when files that they reference disappear
  useEffect(() => {
    setSlots((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const ch of ['R', 'G', 'B', 'A']) {
        if (next[ch] && !inputFiles.find((f) => f.name === next[ch])) {
          next[ch] = null;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [inputFiles]);

  useEffect(() => {
    registerRunner(rgbaMeta.id, {
      outName: () => {
        const base = (outNameRef.current || 'mask_rgba').trim();
        return (base || 'mask_rgba') + '.png';
      },
      run: async (_u, _n, _f, allFiles) => {
        const cur = slotsRef.current;
        const ch = {};
        let refW = 0, refH = 0;
        for (const k of ['R', 'G', 'B', 'A']) {
          if (cur[k]) {
            const entry = allFiles.find((f) => f.name === cur[k]);
            if (!entry) throw new Error(`Channel ${k}: "${cur[k]}" not found`);
            ch[k] = await toGrey(entry);
            if (!refW) { refW = ch[k].w; refH = ch[k].h; }
          }
        }
        if (!refW) throw new Error('No channels assigned — assign at least one texture to a slot');
        const canvas = document.createElement('canvas');
        canvas.width = refW;
        canvas.height = refH;
        const ctx = canvas.getContext('2d');
        const out = ctx.createImageData(refW, refH);
        const data = out.data;
        for (let i = 0; i < refW * refH; i++) {
          data[i * 4] = ch.R ? ch.R.grey[i] : 0;
          data[i * 4 + 1] = ch.G ? ch.G.grey[i] : 0;
          data[i * 4 + 2] = ch.B ? ch.B.grey[i] : 0;
          data[i * 4 + 3] = ch.A ? ch.A.grey[i] : 255;
        }
        ctx.putImageData(out, 0, 0);
        return new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
        });
      }
    });
    return () => registerRunner(rgbaMeta.id, null);
  }, [registerRunner]);

  const setSlot = (ch, val) => setSlots((s) => ({ ...s, [ch]: val || null }));

  return (
    <>
      <div className="rgba-slots-grid">
        {['R', 'G', 'B', 'A'].map((ch) => {
          const col = CH_COLOR[ch];
          const file = slots[ch];
          const entry = file ? inputFiles.find((x) => x.name === file) : null;
          return (
            <div key={ch} className="rgba-slot" style={{ '--ch-color': col }}>
              <div className="slot-header">
                <span
                  className="slot-badge"
                  style={{ background: col + '1a', color: col, borderColor: col + '44' }}
                >
                  {ch}
                </span>
                <span className="slot-hint">{CH_HINT[ch]}</span>
              </div>
              <div className="slot-preview">
                {entry ? (
                  <img src={entry.url} className="slot-thumb" alt={file} />
                ) : (
                  <div className="slot-empty-thumb">
                    <span style={{ fontSize: '1.5rem', opacity: 0.18 }}>🖼️</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.56rem', color: '#333', marginTop: '.25rem' }}>
                      unassigned
                    </span>
                  </div>
                )}
              </div>
              <select
                className="slot-select"
                value={file || ''}
                onChange={(e) => setSlot(ch, e.target.value)}
              >
                <option value="">— none / zero fill —</option>
                {inputFiles.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div className="field">
        <label>Output filename</label>
        <input type="text" value={outName} onChange={(e) => setOutName(e.target.value)} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.6rem', color: '#555', marginTop: '.2rem', display: 'block' }}>
          .png appended automatically
        </span>
      </div>
    </>
  );
}
