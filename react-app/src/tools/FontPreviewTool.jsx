import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const fontPreviewMeta = {
  id: 'fontpreview',
  label: 'Image Font Preview',
  small: 'simulate engine text layout',
  icon: '🗒️',
  needsMagick: false,
  batchMode: true,
  desc: 'Simulates how the ImageText engine component will stitch sprite images into a word. Assign a PNG to each letter position, set size and character offset to match your Unity config, then hit RUN to export the preview.'
};

async function renderToCanvas(targetCanvas, letterNames, inputFiles, size, characterOffset, bgTop, bgBot, canvasW, canvasH) {
  const imageCache = {};
  const uniqueNames = [...new Set(letterNames.filter(Boolean))];
  await Promise.all(uniqueNames.map((name) => {
    const entry = inputFiles.find((f) => f.name === name);
    if (!entry) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { imageCache[name] = img; resolve(); };
      img.onerror = () => reject(new Error('Failed to load ' + name));
      img.src = entry.url;
    });
  }));

  let totalWidth = 0, totalHeight = 0;
  const letterLayouts = [];

  for (let i = 0; i < letterNames.length; i++) {
    const name = letterNames[i];
    if (!name || !imageCache[name]) {
      letterLayouts.push(null);
      continue;
    }
    const img = imageCache[name];
    const scale = size / img.naturalHeight;
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const x = totalWidth + characterOffset * i;
    letterLayouts.push({ img, drawW, drawH, x });
    totalWidth += drawW;
    totalHeight = Math.max(totalHeight, drawH);
  }

  const centeredLayouts = letterLayouts.map((l) => (l ? { ...l, x: l.x - totalWidth / 2 } : null));

  let containerScale = 1;
  if (totalWidth > canvasW || totalHeight > canvasH) {
    containerScale = Math.min(canvasW / totalWidth, canvasH / totalHeight);
  }

  targetCanvas.width = canvasW;
  targetCanvas.height = canvasH;
  const ctx = targetCanvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
  grad.addColorStop(0, bgTop);
  grad.addColorStop(1, bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.scale(containerScale, containerScale);
  for (const l of centeredLayouts) {
    if (!l) continue;
    ctx.drawImage(l.img, l.x, -l.drawH / 2, l.drawW, l.drawH);
  }
  ctx.restore();
}

export function FontPreviewTool() {
  const [length, setLength] = useState(4);
  const [letters, setLetters] = useState(Array(4).fill(null));
  const [size, setSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [canvasW, setCanvasW] = useState(800);
  const [bgTop, setBgTop] = useState('#1a1a2e');
  const [bgBot, setBgBot] = useState('#16213e');
  const previewRef = useRef(null);
  const { inputFiles, registerRunner } = useApp();

  const settingsRef = useRef({});
  settingsRef.current = { size, offset, canvasW, bgTop, bgBot, letters, length, inputFiles };

  useEffect(() => {
    setLetters((prev) => {
      const next = prev.slice(0, length);
      while (next.length < length) next.push(null);
      return next;
    });
  }, [length]);

  // Prune letters that reference removed files
  useEffect(() => {
    setLetters((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (a && !inputFiles.find((f) => f.name === a)) { changed = true; return null; }
        return a;
      });
      return changed ? next : prev;
    });
  }, [inputFiles]);

  useEffect(() => {
    registerRunner(fontPreviewMeta.id, {
      outName: () => 'font_preview.png',
      run: async (_u, _n, _f, allFiles) => {
        const { size, offset, canvasW, bgTop, bgBot, letters, length } = settingsRef.current;
        const chosen = letters.slice(0, length);
        if (!chosen.some(Boolean)) throw new Error('No letters assigned — assign at least one PNG to a letter slot');
        const canvasH = Math.round(size * 2.5);
        const off = document.createElement('canvas');
        await renderToCanvas(off, chosen, allFiles, size, offset, bgTop, bgBot, canvasW, canvasH);
        return new Promise((resolve, reject) => {
          off.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
        });
      }
    });
    return () => registerRunner(fontPreviewMeta.id, null);
  }, [registerRunner]);

  // Update live preview when anything changes
  const updatePreview = useCallback(async () => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const chosen = letters.slice(0, length);
    const assigned = chosen.filter(Boolean);
    if (!assigned.length) {
      canvas.width = 200; canvas.height = 60;
      const ctx = canvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 60);
      g.addColorStop(0, bgTop);
      g.addColorStop(1, bgBot);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 200, 60);
      return;
    }
    try {
      await renderToCanvas(canvas, chosen, inputFiles, size, offset, bgTop, bgBot, 1800, Math.round(size * 4));
    } catch { /* ignore */ }
  }, [letters, length, size, offset, bgTop, bgBot, inputFiles]);

  useEffect(() => { updatePreview(); }, [updatePreview]);

  const setLetter = (i, val) => {
    setLetters((prev) => prev.map((x, idx) => (idx === i ? (val || null) : x)));
  };

  return (
    <>
      <div className="fp-controls-row">
        <div className="field">
          <label>Letter Size (px)</label>
          <input type="number" min="1" max="2048" value={size} onChange={(e) => setSize(+e.target.value || 1)} />
        </div>
        <div className="field">
          <label>Character Offset</label>
          <input type="number" step="0.5" value={offset} onChange={(e) => setOffset(+e.target.value || 0)} />
        </div>
        <div className="field">
          <label>Canvas Width (px)</label>
          <input type="number" min="64" max="4096" value={canvasW} onChange={(e) => setCanvasW(+e.target.value || 64)} />
        </div>
      </div>

      <div className="fp-gradient-row">
        <div className="fp-color-field">
          <label>Background — Top</label>
          <div className="fp-color-swatch" style={{ position: 'relative' }}>
            <div className="fp-color-dot" style={{ background: bgTop }} />
            <span className="fp-color-val">{bgTop}</span>
            <input type="color" value={bgTop} onChange={(e) => setBgTop(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </div>
        </div>
        <div className="fp-color-field">
          <label>Background — Bottom</label>
          <div className="fp-color-swatch" style={{ position: 'relative' }}>
            <div className="fp-color-dot" style={{ background: bgBot }} />
            <span className="fp-color-val">{bgBot}</span>
            <input type="color" value={bgBot} onChange={(e) => setBgBot(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
          </div>
        </div>
      </div>

      <div className="fp-letter-builder">
        <div className="fp-letter-builder-header">
          <span>Letter sequence</span>
          <div className="fp-length-row">
            <label>Length</label>
            <input type="number" min="1" max="32" value={length}
              onChange={(e) => setLength(Math.max(1, Math.min(32, +e.target.value || 1)))} />
          </div>
        </div>
        <div className="fp-letter-list">
          {inputFiles.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.68rem', color: '#444', padding: '.5rem', textAlign: 'center' }}>
              Load PNG files first, then configure the sequence above.
            </div>
          ) : (
            letters.map((assigned, i) => {
              const entry = assigned ? inputFiles.find((f) => f.name === assigned) : null;
              return (
                <div key={i} className="fp-letter-row">
                  <span className="fp-letter-idx">{i + 1}</span>
                  <select className="fp-letter-select" value={assigned || ''} onChange={(e) => setLetter(i, e.target.value)}>
                    <option value="">— unassigned —</option>
                    {inputFiles.map((f) => (
                      <option key={f.name} value={f.name}>{f.name}</option>
                    ))}
                  </select>
                  {entry ? (
                    <img src={entry.url} className="fp-letter-thumb" alt="" />
                  ) : (
                    <div className="fp-letter-thumb-empty"><span style={{ fontSize: '.7rem', color: '#333' }}>?</span></div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="fp-preview-panel">
        <div className="fp-preview-label">live preview</div>
        <div className="fp-preview-canvas-wrap">
          <canvas ref={previewRef} width={200} height={60}
            style={{ maxWidth: '100%', maxHeight: 600, borderRadius: 4, display: 'block' }} />
        </div>
      </div>
    </>
  );
}
