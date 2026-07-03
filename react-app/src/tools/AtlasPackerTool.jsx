import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getImageDimensions, scaleImageWasm } from '../utils/image.js';
import { WIN_LAYOUT, WIN_COLS, buildMapping } from './atlasWinFont.js';
import { NumberField } from '../components/NumberField.jsx';

export const atlasMeta = {
  id: 'atlas',
  label: 'Atlas Packer',
  small: 'pack sprites into a sheet',
  icon: '🗂️',
  needsMagick: true,
  batchMode: true,
  desc: 'Packs all loaded PNG sprites into a single texture atlas. Grid mode: set N×M cells — cell size is auto-derived from the largest sprite plus padding. Tile mode: set exact cell dimensions — grid is auto-computed from sprite count. Sprites can be pre-scaled with any resampling filter before packing. Win Font mode: maps individually-delivered character sprites (0.png, comma.png, dollar.png…) onto the Scene Studio win-number layout (8 cols × 256px cells) — trim the output to only the rows used when just digits are delivered. Note: the "kr" currency is two cells — deliver k.png and r.png separately.'
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
  const [winCell, setWinCell] = useState(256);
  const [winTrim, setWinTrim] = useState(true);
  const [winVAlign, setWinVAlign] = useState('bottom');
  const [winOverrides, setWinOverrides] = useState({});
  const { log, setProgressLabel, registerRunner, inputFiles } = useApp();

  const settingsRef = useRef({});
  settingsRef.current = { mode, cols, rows, tileW, tileH, scale, padding, filter, maxW, maxH, outName, winCell, winTrim, winVAlign, winOverrides };

  // Win Font mapping preview — same buildMapping the runner uses, so preview and output can't disagree
  const mapping = useMemo(
    () => (mode === 'winfont' ? buildMapping(inputFiles, winOverrides) : []),
    [mode, inputFiles, winOverrides]
  );
  const urlByName = useMemo(() => new Map(inputFiles.map((f) => [f.name, f.url])), [inputFiles]);
  const okCount = mapping.filter((m) => m.status === 'ok').length;
  const maxIdx = mapping.reduce((mx, m) => (m.status === 'ok' ? Math.max(mx, m.index) : mx), -1);
  const rowsUsed = maxIdx >= 0 ? Math.ceil((maxIdx + 1) / WIN_COLS) : 0;

  const changeMode = (v) => {
    if (v === 'winfont' && outName.trim() === 'atlas') setOutName('font_win');
    if (v !== 'winfont' && outName.trim() === 'font_win') setOutName('atlas');
    setMode(v);
  };

  useEffect(() => {
    // Win Font mode: place each sprite in its DEFAULT_CHAR_LAYOUT cell (8 cols row-major)
    const runWinFont = async (allFiles) => {
      const { winCell, winTrim, winVAlign, winOverrides, padding, filter } = settingsRef.current;
      const cell = Math.max(4, Math.round(winCell) || 256);

      const mapping = buildMapping(allFiles, winOverrides);
      for (const m of mapping) {
        if (m.status === 'none') log(`⚠ ${m.name}: no glyph detected — skipped (assign one in the mapping list)`, 'err');
        else if (m.status === 'dup') log(`⚠ ${m.name}: glyph '${m.glyph}' already taken by an earlier file — skipped`, 'err');
        else if (m.status === 'skip') log(`  ${m.name}: skipped (manual)`);
      }
      const placed = mapping.filter((m) => m.status === 'ok');
      if (!placed.length) throw new Error('No files matched a glyph — check names or assign them manually');

      const fileByName = new Map(allFiles.map((f) => [f.name, f.file]));
      const sprites = [];
      for (let i = 0; i < placed.length; i++) {
        const { name, glyph, index } = placed[i];
        setProgressLabel(`loading ${i + 1}/${placed.length}`);
        try {
          const uint8 = new Uint8Array(await fileByName.get(name).arrayBuffer());
          const dims = await getImageDimensions(uint8);
          sprites.push({ name, glyph, index, uint8, w: dims.w, h: dims.h });
          log(`  ${name} → '${glyph}' cell ${index}: ${dims.w}×${dims.h}px`);
        } catch (e) {
          log(`✗ ${name}: ${e.message}`, 'err');
        }
      }
      if (!sprites.length) throw new Error('All sprites failed — nothing to pack');

      // ONE downscale-only factor from the largest sprite — preserves relative glyph proportions
      const avail = Math.max(1, cell - 2 * padding);
      const fit = Math.min(1, avail / Math.max(...sprites.map((s) => s.w)), avail / Math.max(...sprites.map((s) => s.h)));
      if (fit < 1) {
        log(`Fit: uniform ×${fit.toFixed(3)} (${filter}) so the largest sprite fits ${avail}px`, 'info');
        for (let i = 0; i < sprites.length; i++) {
          setProgressLabel(`fitting ${i + 1}/${sprites.length}`);
          const sp = sprites[i];
          const scaled = await scaleImageWasm(sp.uint8, Math.max(1, Math.round(sp.w * fit)), Math.max(1, Math.round(sp.h * fit)), filter);
          sp.uint8 = new Uint8Array(await scaled.arrayBuffer());
          const dims = await getImageDimensions(sp.uint8);
          sp.w = dims.w; sp.h = dims.h;
        }
      }

      const maxIdx = Math.max(...sprites.map((sp) => sp.index));
      const usedRows = Math.ceil((maxIdx + 1) / WIN_COLS);
      const atlasW = WIN_COLS * cell;
      const atlasH = (winTrim ? usedRows : 8) * cell;
      log(`Win font: ${WIN_COLS} cols × ${cell}px cells, ${usedRows} row(s) used${winTrim ? ' (trimmed)' : ''} — atlas ${atlasW}×${atlasH}px`, 'info');

      setProgressLabel('compositing…');
      const inputs = sprites.map((sp, i) => ({ name: `i${i}.png`, content: sp.uint8 }));
      const cmd = ['convert', '-size', `${atlasW}x${atlasH}`, 'xc:transparent', '-background', 'none'];
      sprites.forEach((sp, i) => {
        const col = sp.index % WIN_COLS, row = Math.floor(sp.index / WIN_COLS);
        const x = col * cell + Math.round((cell - sp.w) / 2);
        const y = row * cell + (winVAlign === 'bottom' ? cell - padding - sp.h : Math.round((cell - sp.h) / 2));
        cmd.push(`i${i}.png`, '-geometry', `+${x}+${y}`, '-composite');
      });
      cmd.push('atlas.png');

      const res = await window._Magick.Call(inputs, cmd);
      if (!res || !res.length) throw new Error('Composite call returned no output');
      log(`✓ Done — ${atlasW}×${atlasH}px win-font atlas, ${sprites.length} glyph(s) placed`, 'ok');
      return res[0].blob;
    };

    registerRunner(atlasMeta.id, {
      outName: () => (settingsRef.current.outName || 'atlas').trim() + '.png',
      run: async (_u, _n, _f, allFiles) => {
        if (!allFiles.length) throw new Error('No files loaded');
        if (settingsRef.current.mode === 'winfont') return runWinFont(allFiles);
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
              const scaled = await scaleImageWasm(uint8, nw, nh, filter);
              uint8 = new Uint8Array(await scaled.arrayBuffer());
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
        <select value={mode} onChange={(e) => changeMode(e.target.value)}>
          <option value="grid">Fixed grid — N × M cells (cell size = largest sprite + padding)</option>
          <option value="tile">Fixed tile size — specify cell W × H in px (grid auto-computed)</option>
          <option value="winfont">Win Font — Scene Studio number atlas (8 cols, char layout)</option>
        </select>
      </div>
      {mode === 'grid' && (
        <div className="field-row">
          <div className="field">
            <label>Columns</label>
            <NumberField min={1} max={64} value={cols} onChange={(v) => setCols(v)} />
          </div>
          <div className="field">
            <label>Rows</label>
            <NumberField min={1} max={64} value={rows} onChange={(v) => setRows(v)} />
          </div>
        </div>
      )}
      {mode === 'tile' && (
        <div className="field-row">
          <div className="field">
            <label>Tile width (px)</label>
            <NumberField min={1} max={4096} value={tileW} onChange={(v) => setTileW(v)} />
          </div>
          <div className="field">
            <label>Tile height (px)</label>
            <NumberField min={1} max={4096} value={tileH} onChange={(v) => setTileH(v)} />
          </div>
        </div>
      )}
      {mode === 'winfont' && (
        <>
          <div className="field-row">
            <div className="field">
              <label>Cell size (px)</label>
              <NumberField min={4} max={1024} value={winCell} onChange={(v) => setWinCell(v)} />
            </div>
            <div className="field">
              <label>Glyph V-align in cell</label>
              <select value={winVAlign} onChange={(e) => setWinVAlign(e.target.value)}>
                <option value="bottom">Bottom — baseline-like (right for trimmed . and ,)</option>
                <option value="center">Center — for sprites sharing one canvas size</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={winTrim}
                onChange={(e) => setWinTrim(e.target.checked)}
                style={{ marginRight: '6px', verticalAlign: 'middle' }}
              />
              Trim height to used rows (digits only → 2048×512 instead of full 2048×2048)
            </label>
          </div>
        </>
      )}
      <div className="field-row">
        {mode !== 'winfont' && (
          <div className="field">
            <label>Scale factor</label>
            <NumberField min={0.01} max={20} step={0.01} value={scale} onChange={(v) => setScale(v)} />
          </div>
        )}
        <div className="field">
          <label>Padding (px per side)</label>
          <NumberField min={0} max={512} value={padding} onChange={(v) => setPadding(v)} />
        </div>
      </div>
      <div className="field">
        <label>Resampling filter ({mode === 'winfont' ? 'used when sprites are fit-scaled down' : 'used when scale ≠ 1.0'})</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="Lanczos">Lanczos — sharpest, best for photos &amp; icons</option>
          <option value="Mitchell">Mitchell — smooth, great for mixed content</option>
          <option value="Catrom">Catmull-Rom — sharp edges, slight ringing</option>
          <option value="Box">Box (Nearest) — pixel-art / hard edges</option>
          <option value="Triangle">Triangle (Bilinear) — fast, mild softening</option>
          <option value="Gaussian">Gaussian — very soft, good for blur-down</option>
        </select>
      </div>
      {mode !== 'winfont' && (
        <div className="field-row">
          <div className="field">
            <label>Max atlas width (px)</label>
            <NumberField min={64} max={16384} value={maxW} onChange={(v) => setMaxW(v)} />
          </div>
          <div className="field">
            <label>Max atlas height (px)</label>
            <NumberField min={64} max={16384} value={maxH} onChange={(v) => setMaxH(v)} />
          </div>
        </div>
      )}
      {mode === 'winfont' && (
        <div className="field">
          <label>
            Glyph mapping — {okCount}/{inputFiles.length} mapped · rows used {rowsUsed} · output {WIN_COLS * winCell}×{(winTrim ? rowsUsed : 8) * winCell}px
          </label>
          <div className="fp-letter-list">
            {mapping.map((m) => (
              <div
                key={m.name}
                className={'wf-map-row' + (m.status === 'none' ? ' wf-none' : m.status === 'dup' ? ' wf-dup' : '')}
                title={m.status === 'dup' ? `duplicate — '${m.glyph}' is already taken by an earlier file` : m.name}
              >
                <img className="fp-letter-thumb" src={urlByName.get(m.name)} alt="" />
                <span className="wf-map-name">{m.name}</span>
                <select
                  className="fp-letter-select"
                  value={m.glyph || ''}
                  onChange={(e) => setWinOverrides((p) => ({ ...p, [m.name]: e.target.value }))}
                >
                  <option value="">— skip —</option>
                  {[...WIN_LAYOUT].map((ch, i) => (
                    <option key={ch} value={ch}>{ch} · cell {i}</option>
                  ))}
                </select>
              </div>
            ))}
            {!mapping.length && <div className="wf-map-empty">load character PNGs to see the mapping</div>}
          </div>
        </div>
      )}
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
