import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getImageDimensions } from '../utils/image.js';

export const atlasMeta = {
  id: 'atlas',
  label: 'Atlas Packer',
  small: 'pack sprites into a sheet',
  icon: '🗂️',
  needsMagick: true,
  batchMode: true,
  desc: 'Packs all loaded PNG sprites into a single texture atlas. Grid mode: set N×M cells — cell size is auto-derived from the largest sprite plus padding. Tile mode: set exact cell dimensions — grid is auto-computed from sprite count. Sprites can be pre-scaled with any resampling filter before packing.'
};

export function AtlasPackerTool() {
  const [mode, setMode] = useState('grid');
  const [cols, setCols] = useState(5);
  const [rows, setRows] = useState(5);
  const [tileW, setTileW] = useState(128);
  const [tileH, setTileH] = useState(128);
  const [scale, setScale] = useState(1.0);
  const [padding, setPadding] = useState(0);
  const [filter, setFilter] = useState('Lanczos');
  const [maxW, setMaxW] = useState(4096);
  const [maxH, setMaxH] = useState(4096);
  const [outName, setOutName] = useState('atlas');
  const { log, setProgressLabel, registerRunner } = useApp();

  const settingsRef = useRef({});
  settingsRef.current = { mode, cols, rows, tileW, tileH, scale, padding, filter, maxW, maxH, outName };

  useEffect(() => {
    registerRunner(atlasMeta.id, {
      outName: () => (settingsRef.current.outName || 'atlas').trim() + '.png',
      run: async (_u, _n, _f, allFiles) => {
        if (!allFiles.length) throw new Error('No files loaded');
        const { mode, scale, filter, padding, maxW, maxH } = settingsRef.current;
        const doScale = Math.abs(scale - 1.0) >= 0.001;

        log(`Processing ${allFiles.length} sprite(s)${doScale ? ` — scale ×${scale} (${filter})` : ''}…`, 'info');
        const sprites = [];
        for (let i = 0; i < allFiles.length; i++) {
          const { name, file } = allFiles[i];
          setProgressLabel(`scaling ${i + 1}/${allFiles.length}`);
          try {
            let uint8 = new Uint8Array(await file.arrayBuffer());
            if (doScale) {
              const orig = await getImageDimensions(uint8);
              const nw = Math.max(1, Math.round(orig.w * scale));
              const nh = Math.max(1, Math.round(orig.h * scale));
              const r = await window._Magick.Call(
                [{ name: 's.png', content: uint8 }],
                ['convert', 's.png', '-filter', filter, '-resize', `${nw}x${nh}!`, '+repage', 'o.png']
              );
              if (!r || !r.length) throw new Error('Magick scale returned nothing');
              uint8 = new Uint8Array(await r[0].blob.arrayBuffer());
            }
            const dims = await getImageDimensions(uint8);
            sprites.push({ name, uint8, w: dims.w, h: dims.h });
            log(`  ${name}: ${dims.w}×${dims.h}px`);
          } catch (e) {
            log(`✗ ${name}: ${e.message}`, 'err');
          }
        }
        if (!sprites.length) throw new Error('All sprites failed — nothing to pack');

        let c, r, cellW, cellH;
        const maxSW = Math.max(...sprites.map((s) => s.w));
        const maxSH = Math.max(...sprites.map((s) => s.h));

        if (mode === 'grid') {
          c = Math.max(1, settingsRef.current.cols || 5);
          r = Math.max(1, settingsRef.current.rows || 5);
          cellW = maxSW + 2 * padding;
          cellH = maxSH + 2 * padding;
          if (sprites.length > c * r)
            log(`⚠ ${sprites.length} sprites but only ${c * r} cells (${c}×${r}) — ${sprites.length - c * r} will be clipped`, 'err');
        } else {
          cellW = Math.max(1, settingsRef.current.tileW || 128);
          cellH = Math.max(1, settingsRef.current.tileH || 128);
          c = Math.max(1, Math.ceil(Math.sqrt(sprites.length)));
          r = Math.max(1, Math.ceil(sprites.length / c));
        }

        const atlasW = c * cellW, atlasH = r * cellH;
        log(`Grid: ${c}×${r}  Cell: ${cellW}×${cellH}px  Atlas: ${atlasW}×${atlasH}px`, 'info');
        if (atlasW > maxW || atlasH > maxH)
          log(`⚠ Atlas (${atlasW}×${atlasH}px) exceeds max limit (${maxW}×${maxH}px)`, 'err');

        setProgressLabel('compositing…');
        const inputs = sprites.map((s, i) => ({ name: `i${i}.png`, content: s.uint8 }));
        const cmd = ['convert', '-size', `${atlasW}x${atlasH}`, 'xc:transparent', '-background', 'none'];
        for (let i = 0; i < sprites.length; i++) {
          const col = i % c, row = Math.floor(i / c);
          if (row >= r) break;
          const x = col * cellW + Math.round((cellW - sprites[i].w) / 2);
          const y = row * cellH + Math.round((cellH - sprites[i].h) / 2);
          cmd.push(`i${i}.png`, '-geometry', `+${x}+${y}`, '-composite');
        }
        cmd.push('atlas.png');

        const res = await window._Magick.Call(inputs, cmd);
        if (!res || !res.length) throw new Error('Composite call returned no output');
        log(`✓ Done — ${atlasW}×${atlasH}px atlas, ${Math.min(sprites.length, c * r)} sprites packed`, 'ok');
        return res[0].blob;
      }
    });
    return () => registerRunner(atlasMeta.id, null);
  }, [registerRunner, log, setProgressLabel]);

  return (
    <>
      <div className="field">
        <label>Grid mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="grid">Fixed grid — N × M cells (cell size = largest sprite + padding)</option>
          <option value="tile">Fixed tile size — specify cell W × H in px (grid auto-computed)</option>
        </select>
      </div>
      {mode === 'grid' ? (
        <div className="field-row">
          <div className="field">
            <label>Columns</label>
            <input type="number" min="1" max="64" value={cols} onChange={(e) => setCols(+e.target.value)} />
          </div>
          <div className="field">
            <label>Rows</label>
            <input type="number" min="1" max="64" value={rows} onChange={(e) => setRows(+e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="field-row">
          <div className="field">
            <label>Tile width (px)</label>
            <input type="number" min="1" max="4096" value={tileW} onChange={(e) => setTileW(+e.target.value)} />
          </div>
          <div className="field">
            <label>Tile height (px)</label>
            <input type="number" min="1" max="4096" value={tileH} onChange={(e) => setTileH(+e.target.value)} />
          </div>
        </div>
      )}
      <div className="field-row">
        <div className="field">
          <label>Scale factor</label>
          <input type="number" min="0.01" max="20" step="0.01" value={scale} onChange={(e) => setScale(+e.target.value)} />
        </div>
        <div className="field">
          <label>Padding (px per side)</label>
          <input type="number" min="0" max="512" value={padding} onChange={(e) => setPadding(+e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Resampling filter (used when scale ≠ 1.0)</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="Lanczos">Lanczos — sharpest, best for photos &amp; icons</option>
          <option value="Mitchell">Mitchell — smooth, great for mixed content</option>
          <option value="Catrom">Catmull-Rom — sharp edges, slight ringing</option>
          <option value="Box">Box (Nearest) — pixel-art / hard edges</option>
          <option value="Triangle">Triangle (Bilinear) — fast, mild softening</option>
          <option value="Gaussian">Gaussian — very soft, good for blur-down</option>
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Max atlas width (px)</label>
          <input type="number" min="64" max="16384" value={maxW} onChange={(e) => setMaxW(+e.target.value)} />
        </div>
        <div className="field">
          <label>Max atlas height (px)</label>
          <input type="number" min="64" max="16384" value={maxH} onChange={(e) => setMaxH(+e.target.value)} />
        </div>
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
