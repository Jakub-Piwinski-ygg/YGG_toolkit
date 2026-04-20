import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { freshBytes } from '../utils/image.js';

export const slotMachineMeta = {
  id: 'slotmachine',
  label: 'Slot Machine',
  small: 'spin & preview simulator',
  icon: '🎰',
  needsMagick: true,
  batchMode: false,
  needsFiles: false,
  desc: 'Preview a slot machine with your own symbols, background, frames and HUD. Hit BUILD MACHINE to preprocess blur via ImageMagick WASM, then click anywhere to spin.'
};

const LAYER_KEYS = ['bg', 'frameBack', 'frameFront', 'hud'];
const LAYER_TITLES = { bg: 'Background', frameBack: 'Frame — Behind', frameFront: 'Frame — Front', hud: 'HUD Overlay (topmost)' };

function defaultConfig() {
  return {
    reelCount: 5, rowCount: 4,
    symbolW: 200, symbolH: 200, symbolScale: 1.0,
    boardScale: 1.0, boardOffX: 0, boardOffY: 0,
    displayW: 1920, displayH: 1080,
    spinDirection: 1,
    spinDuration: 1200, stopOffset: 200, spinSpeed: 60,
    spinAccelMs: 150,
    blurDelay: 0,
    blurEnabled: true,
    blurSigma: 20, blurEdgeFeather: 5
  };
}

function defaultLayer() { return { name: null, img: null, scale: 1.0, offX: 0, offY: 0 }; }

async function makeBlurWasm(img, cellW, cellH, symScale, sigma, feather) {
  const tmp = document.createElement('canvas');
  tmp.width = cellW; tmp.height = cellH;
  const tctx = tmp.getContext('2d');
  const sw = img.naturalWidth * symScale, sh = img.naturalHeight * symScale;
  tctx.drawImage(img, cellW / 2 - sw / 2, cellH / 2 - sh / 2, sw, sh);
  const uint8 = await new Promise((res) => {
    tmp.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png');
  });
  const blurArg = `0x${sigma}+90`;

  const r1 = await window._Magick.Call(
    [{ name: 'input.png', content: uint8 }],
    ['convert', 'input.png', '-motion-blur', blurArg, 'blurred.png']
  );
  if (!r1 || !r1.length) throw new Error('Motion blur failed');
  const blurred = r1[0].blob;

  const r2 = await window._Magick.Call(
    [{ name: 'blurred.png', content: await freshBytes(blurred) }],
    ['convert', 'blurred.png', '-alpha', 'off', '-fill', 'white', '-colorize', '100',
      '-shave', `${feather}x${feather}`, '-bordercolor', 'black', '-border', `${feather}x${feather}`,
      '-blur', `0x${feather}`, '-level', '20%,80%', 'mask.png']
  );
  if (!r2 || !r2.length) throw new Error('Mask failed');
  const mask = r2[0].blob;

  const r3 = await window._Magick.Call(
    [{ name: 'blurred.png', content: await freshBytes(blurred) }],
    ['convert', 'blurred.png', '-alpha', 'extract', 'orig_alpha.png']
  );
  if (!r3 || !r3.length) throw new Error('Alpha extract failed');
  const alpha = r3[0].blob;

  const r4 = await window._Magick.Call(
    [{ name: 'orig_alpha.png', content: await freshBytes(alpha) }, { name: 'mask.png', content: await freshBytes(mask) }],
    ['convert', 'orig_alpha.png', 'mask.png', '-compose', 'Multiply', '-composite', 'combined_alpha.png']
  );
  if (!r4 || !r4.length) throw new Error('Alpha multiply failed');
  const cAlpha = r4[0].blob;

  const r5 = await window._Magick.Call(
    [{ name: 'blurred.png', content: await freshBytes(blurred) }, { name: 'combined_alpha.png', content: await freshBytes(cAlpha) }],
    ['convert', 'blurred.png', 'combined_alpha.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'output.png']
  );
  if (!r5 || !r5.length) throw new Error('Final composite failed');

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(r5[0].blob);
    const out = new Image();
    out.onload = () => resolve(out);
    out.onerror = () => reject(new Error('Could not load blurred image'));
    out.src = url;
  });
}

function useLoadedImage(name, inputFiles) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!name) { setImg(null); return; }
    const entry = inputFiles.find((f) => f.name === name);
    if (!entry) { setImg(null); return; }
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = entry.url;
  }, [name, inputFiles]);
  return img;
}

export function SlotMachineTool() {
  const [numSymbols, setNumSymbols] = useState(6);
  const [symbols, setSymbols] = useState(() => Array.from({ length: 6 }, () => ({ name: null })));
  const [layers, setLayers] = useState(() => ({ bg: defaultLayer(), frameBack: defaultLayer(), frameFront: defaultLayer(), hud: defaultLayer() }));
  const [config, setConfig] = useState(defaultConfig());
  const [building, setBuilding] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [machineReady, setMachineReady] = useState(false);

  const { inputFiles, log, registerRunner } = useApp();
  const canvasRef = useRef(null);

  // Mutable runtime state
  const runtimeRef = useRef({
    reels: [],
    animFrame: null,
    spinning: false,
    symbolImages: {},
    layerImages: {},
    blurredCanvases: {},
    blurSig: null,
    config: defaultConfig()
  });
  runtimeRef.current.config = config;

  // Load symbol images into runtime cache
  useEffect(() => {
    const rt = runtimeRef.current;
    const nextCache = {};
    let pending = 0;
    symbols.forEach((s, i) => {
      if (!s.name) return;
      const entry = inputFiles.find((f) => f.name === s.name);
      if (!entry) return;
      if (rt.symbolImages[i]?.name === s.name) {
        nextCache[i] = rt.symbolImages[i];
        return;
      }
      pending++;
      const img = new Image();
      img.onload = () => {
        nextCache[i] = { name: s.name, img };
        pending--;
        if (pending === 0) { rt.symbolImages = { ...nextCache }; drawMachine(); }
      };
      img.src = entry.url;
    });
    if (pending === 0) {
      rt.symbolImages = nextCache;
      drawMachine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, inputFiles]);

  // Load layer images into runtime cache
  useEffect(() => {
    const rt = runtimeRef.current;
    const nextCache = {};
    let pending = 0;
    LAYER_KEYS.forEach((k) => {
      const L = layers[k];
      if (!L.name) return;
      const entry = inputFiles.find((f) => f.name === L.name);
      if (!entry) return;
      if (rt.layerImages[k]?.name === L.name) {
        nextCache[k] = rt.layerImages[k];
        return;
      }
      pending++;
      const img = new Image();
      img.onload = () => {
        nextCache[k] = { name: L.name, img };
        pending--;
        if (pending === 0) { rt.layerImages = { ...nextCache }; drawMachine(); }
      };
      img.src = entry.url;
    });
    if (pending === 0) {
      rt.layerImages = nextCache;
      drawMachine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, inputFiles]);

  // Prune dropped file references
  useEffect(() => {
    setSymbols((prev) => prev.map((s) => (s.name && !inputFiles.find((f) => f.name === s.name) ? { name: null } : s)));
    setLayers((prev) => {
      const next = { ...prev };
      for (const k of LAYER_KEYS) {
        if (next[k].name && !inputFiles.find((f) => f.name === next[k].name)) {
          next[k] = { ...next[k], name: null };
        }
      }
      return next;
    });
  }, [inputFiles]);

  // Sync symbol count
  useEffect(() => {
    setSymbols((prev) => {
      const n = Math.max(1, Math.min(20, numSymbols));
      const next = prev.slice(0, n);
      while (next.length < n) next.push({ name: null });
      return next;
    });
  }, [numSymbols]);

  const validIndices = () => Object.keys(runtimeRef.current.symbolImages).map(Number).filter((i) => runtimeRef.current.symbolImages[i]?.img);
  const randIdx = (v) => { const vi = v || validIndices(); return vi[Math.floor(Math.random() * vi.length)]; };
  const buildStrip = (len) => { const v = validIndices(); const strip = []; for (let i = 0; i < len; i++) strip.push(randIdx(v)); return strip; };

  const drawLayer = (ctx, layerKey, W, H) => {
    const rt = runtimeRef.current;
    const L = layers[layerKey];
    const imgInfo = rt.layerImages[layerKey];
    if (!imgInfo?.img) return;
    const dw = imgInfo.img.naturalWidth * L.scale;
    const dh = imgInfo.img.naturalHeight * L.scale;
    ctx.drawImage(imgInfo.img, W / 2 - dw / 2 + L.offX, H / 2 - dh / 2 + L.offY, dw, dh);
  };

  const drawSymInCell = (ctx, symIdx, cellX, cellY, cellW, cellH, isBlurred, reelSpinStart) => {
    const rt = runtimeRef.current;
    const sym = rt.symbolImages[symIdx];
    if (!sym?.img) return;
    const c = rt.config;
    const delayPast = c.blurDelay <= 0 || (performance.now() - (reelSpinStart || 0)) >= c.blurDelay;
    if (isBlurred && delayPast && rt.blurredCanvases[symIdx]) {
      ctx.drawImage(rt.blurredCanvases[symIdx], cellX, cellY, cellW, cellH);
      return;
    }
    const sc = c.symbolScale;
    const sw = sym.img.naturalWidth * sc;
    const sh = sym.img.naturalHeight * sc;
    ctx.drawImage(sym.img, cellX + cellW / 2 - sw / 2, cellY + cellH / 2 - sh / 2, sw, sh);
  };

  const drawMachine = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rt = runtimeRef.current;
    const c = rt.config;
    const ctx = canvas.getContext('2d');
    const W = c.displayW, H = c.displayH;
    const reelAreaW = c.symbolW * c.reelCount;
    const reelAreaH = c.symbolH * c.rowCount;
    canvas.width = W;
    canvas.height = H;

    ctx.clearRect(0, 0, W, H);

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (rt.layerImages.bg?.img) drawLayer(ctx, 'bg', W, H);
    else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#12121f'); g.addColorStop(1, '#060609');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawLayer(ctx, 'frameBack', W, H);
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.translate(W / 2 + c.boardOffX, H / 2 + c.boardOffY);
    ctx.scale(c.boardScale, c.boardScale);
    const rx0 = -reelAreaW / 2, ry0 = -reelAreaH / 2;
    for (let r = 0; r < rt.reels.length && r < c.reelCount; r++) {
      const reel = rt.reels[r];
      const isBlurred = reel.state === 'spinning' || reel.state === 'decelerating';
      const rx = rx0 + r * c.symbolW;
      ctx.save();
      ctx.beginPath(); ctx.rect(rx, ry0, c.symbolW, reelAreaH); ctx.clip();
      const pixMod = reel.scrollY % c.symbolH;
      if (c.spinDirection === 1) {
        const bottomIdx = Math.floor(reel.scrollY / c.symbolH);
        for (let row = -1; row <= c.rowCount; row++) {
          const sp = ((bottomIdx - row) % reel.strip.length + reel.strip.length) % reel.strip.length;
          const sy = ry0 + row * c.symbolH + pixMod;
          if (sy + c.symbolH < ry0 || sy > ry0 + reelAreaH) continue;
          drawSymInCell(ctx, reel.strip[sp], rx, sy, c.symbolW, c.symbolH, isBlurred, reel.spinStartTime || 0);
        }
      } else {
        const topIdx = Math.floor(reel.scrollY / c.symbolH);
        for (let row = -1; row <= c.rowCount; row++) {
          const sp = ((topIdx + row) % reel.strip.length + reel.strip.length) % reel.strip.length;
          const sy = ry0 + row * c.symbolH - pixMod;
          if (sy + c.symbolH < ry0 || sy > ry0 + reelAreaH) continue;
          drawSymInCell(ctx, reel.strip[sp], rx, sy, c.symbolW, c.symbolH, isBlurred, reel.spinStartTime || 0);
        }
      }
      if (r > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(rx + 0.75, ry0); ctx.lineTo(rx + 0.75, ry0 + reelAreaH); ctx.stroke();
      }
      ctx.restore();
    }
    const midY = ry0 + Math.floor(c.rowCount / 2) * c.symbolH;
    ctx.strokeStyle = 'rgba(255,118,46,0.18)'; ctx.lineWidth = 2;
    ctx.strokeRect(rx0 + 1, midY + 1, reelAreaW - 2, c.symbolH - 2);
    ctx.strokeStyle = 'rgba(255,118,46,0.06)'; ctx.lineWidth = 1;
    ctx.strokeRect(rx0, ry0, reelAreaW, reelAreaH);
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawLayer(ctx, 'frameFront', W, H);
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawLayer(ctx, 'hud', W, H);
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, layers]);

  useEffect(() => { drawMachine(); }, [drawMachine]);

  const initReels = () => {
    const rt = runtimeRef.current;
    const c = rt.config;
    const INIT = Math.max(64, c.rowCount * 14);
    rt.reels = [];
    for (let r = 0; r < c.reelCount; r++) {
      rt.reels.push({ strip: buildStrip(INIT), scrollY: 0, speed: 0, state: 'idle', stopScrollY: 0, spinStartTime: 0 });
    }
  };

  const extendStrip = (reel, needed) => {
    while (reel.strip.length <= needed + 28) reel.strip.push(randIdx());
  };

  const stopReel = (r) => {
    const rt = runtimeRef.current;
    const reel = rt.reels[r];
    if (!reel || reel.state === 'stopped') return;
    const c = rt.config;
    const extra = (3 + Math.floor(Math.random() * 4)) * c.symbolH;
    const rawTarget = reel.scrollY + reel.speed * 30 + extra;
    reel.stopScrollY = Math.ceil(rawTarget / c.symbolH) * c.symbolH;
    extendStrip(reel, Math.floor(reel.stopScrollY / c.symbolH) + c.rowCount + 8);
    reel.state = 'decelerating';
  };

  const animLoop = () => {
    const rt = runtimeRef.current;
    if (!canvasRef.current) return;
    const c = rt.config;
    let anyActive = false;
    for (const reel of rt.reels) {
      if (reel.state === 'idle' || reel.state === 'stopped') continue;
      anyActive = true;
      if (reel.state === 'spinning') {
        const elapsed = performance.now() - (reel.spinStartTime || 0);
        const accelFrac = c.spinAccelMs > 0 ? Math.min(1, elapsed / c.spinAccelMs) : 1;
        reel.speed = c.spinSpeed * accelFrac;
        reel.scrollY += reel.speed;
        extendStrip(reel, Math.floor(reel.scrollY / c.symbolH) + c.rowCount + 8);
      } else if (reel.state === 'decelerating') {
        const remaining = reel.stopScrollY - reel.scrollY;
        if (remaining <= 0.5) {
          reel.scrollY = reel.stopScrollY; reel.speed = 0; reel.state = 'stopped';
          if (rt.reels.every((r2) => r2.state === 'stopped' || r2.state === 'idle')) {
            rt.spinning = false; setIsSpinning(false);
          }
          continue;
        }
        const ts = Math.max(1.2, remaining / 20);
        reel.speed = reel.speed * 0.88 + ts * 0.12;
        reel.speed = Math.max(reel.speed, 1.2);
        reel.scrollY += reel.speed;
        if (reel.scrollY >= reel.stopScrollY) {
          reel.scrollY = reel.stopScrollY; reel.speed = 0; reel.state = 'stopped';
          if (rt.reels.every((r2) => r2.state === 'stopped' || r2.state === 'idle')) {
            rt.spinning = false; setIsSpinning(false);
          }
        }
      }
    }
    drawMachine();
    if (anyActive) rt.animFrame = requestAnimationFrame(animLoop);
  };

  const doSpin = () => {
    const rt = runtimeRef.current;
    if (rt.spinning) return;
    if (!validIndices().length) { log('✗ Assign at least one symbol', 'err'); return; }
    if (!rt.reels.length) { log('✗ Build machine first', 'err'); return; }
    rt.spinning = true;
    setIsSpinning(true);
    const c = rt.config;
    const now = performance.now();
    for (const reel of rt.reels) { reel.state = 'spinning'; reel.speed = 0; reel.spinStartTime = now; }
    for (let r = 0; r < rt.reels.length; r++) setTimeout(() => stopReel(r), c.spinDuration + r * c.stopOffset);
    if (rt.animFrame) cancelAnimationFrame(rt.animFrame);
    animLoop();
  };

  const buildMachine = async () => {
    const rt = runtimeRef.current;
    const c = rt.config;
    const valid = validIndices();
    if (!valid.length) { log('✗ Assign at least one symbol first', 'err'); throw new Error('No symbols assigned'); }
    if (!window._Magick) { log('✗ ImageMagick WASM not ready yet', 'err'); throw new Error('WASM not ready'); }

    setBuilding(true);
    try {
      if (!c.blurEnabled) {
        rt.blurredCanvases = {}; rt.blurSig = null;
        log('— Blur disabled — skipping pre-process', 'info');
      } else {
        const symNames = Object.keys(rt.symbolImages).sort().map((k) => rt.symbolImages[k]?.name || '');
        const blurSig = [c.blurSigma, c.blurEdgeFeather, c.symbolScale, ...symNames].join('|');
        if (blurSig === rt.blurSig && Object.keys(rt.blurredCanvases).length) {
          log('✓ Blur cache valid — skipping re-process', 'info');
        } else {
          rt.blurredCanvases = {};
          const todo = Object.entries(rt.symbolImages).filter(([, v]) => v?.img);
          log(`⏳ Building blurred symbols (${todo.length}) via ImageMagick…`, 'info');
          for (const [i, sym] of todo) {
            try {
              log(`  processing symbol ${+i + 1}: ${sym.name || '?'}`);
              rt.blurredCanvases[+i] = await makeBlurWasm(sym.img, c.symbolW, c.symbolH, c.symbolScale, c.blurSigma, c.blurEdgeFeather);
            } catch (e) {
              log(`  ✗ symbol ${+i + 1} blur failed: ${e.message}`, 'err');
            }
          }
          rt.blurSig = blurSig;
          log('✓ Blur pre-processing done', 'ok');
        }
      }

      if (rt.animFrame) cancelAnimationFrame(rt.animFrame);
      rt.spinning = false;
      initReels();
      drawMachine();
      setMachineReady(true);
      log('🎰 Machine ready — click preview to spin!', 'ok');
    } finally {
      setBuilding(false);
    }
  };

  useEffect(() => {
    registerRunner(slotMachineMeta.id, {
      outName: () => 'slot_preview.png',
      run: async () => {
        await buildMachine();
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not available');
        return new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
        });
      }
    });
    return () => registerRunner(slotMachineMeta.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerRunner, symbols, layers, config]);

  // Cleanup on unmount
  useEffect(() => () => {
    const rt = runtimeRef.current;
    if (rt.animFrame) cancelAnimationFrame(rt.animFrame);
  }, []);

  const updateConfig = (key, val) => setConfig((prev) => ({ ...prev, [key]: val }));
  const updateLayer = (key, field, val) => setLayers((prev) => ({ ...prev, [key]: { ...prev[key], [field]: val } }));

  const calcText = useMemo(() => {
    const bw = Math.round(config.symbolW * config.reelCount);
    const bh = Math.round(config.symbolH * config.rowCount);
    const sbw = Math.round(bw * config.boardScale);
    const sbh = Math.round(bh * config.boardScale);
    return `Board: ${bw}×${bh} px → ×${config.boardScale.toFixed(2)} = ${sbw}×${sbh} px · Canvas: ${config.displayW}×${config.displayH} px`;
  }, [config]);

  const LayerBlock = ({ layerKey }) => {
    const L = layers[layerKey];
    return (
      <div className="sm-layer-block">
        <span className="sm-block-title">{LAYER_TITLES[layerKey]}</span>
        <select value={L.name || ''} onChange={(e) => updateLayer(layerKey, 'name', e.target.value || null)} className="sm-select">
          <option value="">— none —</option>
          {inputFiles.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <label className="sm-small-lbl" style={{ minWidth: 38 }}>Scale</label>
          <input type="range" min="0" max="3" step="0.01" value={Math.min(3, L.scale)} onChange={(e) => updateLayer(layerKey, 'scale', +e.target.value)} style={{ flex: 1 }} />
          <input type="number" min="0" max="20" step="0.05" value={L.scale} onChange={(e) => updateLayer(layerKey, 'scale', +e.target.value)} className="sm-num-sm" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.35rem' }}>
          <div className="field"><label>Off X</label><input type="number" value={L.offX} onChange={(e) => updateLayer(layerKey, 'offX', +e.target.value)} /></div>
          <div className="field"><label>Off Y</label><input type="number" value={L.offY} onChange={(e) => updateLayer(layerKey, 'offY', +e.target.value)} /></div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Symbol library */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
        <span className="sm-section-title">Symbol library</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <label className="sm-small-lbl">Count</label>
          <input type="number" min="1" max="20" value={numSymbols} onChange={(e) => setNumSymbols(+e.target.value || 1)} className="sm-num-sm" />
        </div>
      </div>
      <div className="sm-symbol-grid">
        {inputFiles.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.65rem', color: '#444', padding: '.5rem', textAlign: 'center', gridColumn: 'span 2' }}>
            Load PNG files first.
          </div>
        ) : (
          symbols.map((s, i) => {
            const entry = s.name ? inputFiles.find((f) => f.name === s.name) : null;
            return (
              <div key={i} className="sm-symbol-row">
                {entry ? <img src={entry.url} className="sm-symbol-thumb" alt="" />
                  : <div className="sm-symbol-thumb-empty">?</div>}
                <select value={s.name || ''} onChange={(e) => {
                  const v = e.target.value || null;
                  setSymbols((prev) => prev.map((x, j) => (j === i ? { name: v } : x)));
                }} className="sm-select-compact">
                  <option value="">—</option>
                  {inputFiles.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </div>
            );
          })
        )}
      </div>

      <div className="sm-hr" />

      <LayerBlock layerKey="bg" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.55rem' }}>
        <LayerBlock layerKey="frameBack" />
        <LayerBlock layerKey="frameFront" />
      </div>
      <LayerBlock layerKey="hud" />

      <div className="sm-hr" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '.5rem' }}>
        <div className="field"><label>Reels</label><input type="number" min="1" max="9" value={config.reelCount} onChange={(e) => updateConfig('reelCount', +e.target.value || 1)} /></div>
        <div className="field"><label>Rows</label><input type="number" min="1" max="8" value={config.rowCount} onChange={(e) => updateConfig('rowCount', +e.target.value || 1)} /></div>
        <div className="field"><label>Cell W</label><input type="number" min="16" max="512" value={config.symbolW} onChange={(e) => updateConfig('symbolW', +e.target.value || 16)} /></div>
        <div className="field"><label>Cell H</label><input type="number" min="16" max="512" value={config.symbolH} onChange={(e) => updateConfig('symbolH', +e.target.value || 16)} /></div>
      </div>
      <div className="field">
        <label>Symbol scale in cell — <span style={{ color: 'var(--accent)' }}>{config.symbolScale.toFixed(2)}</span></label>
        <input type="range" min="0" max="3" step="0.01" value={config.symbolScale} onChange={(e) => updateConfig('symbolScale', +e.target.value)} />
      </div>

      <div className="sm-hr" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
        <div className="field"><label>Canvas W (px)</label><input type="number" min="200" max="3840" value={config.displayW} onChange={(e) => updateConfig('displayW', +e.target.value || 200)} /></div>
        <div className="field"><label>Canvas H (px)</label><input type="number" min="200" max="2160" value={config.displayH} onChange={(e) => updateConfig('displayH', +e.target.value || 200)} /></div>
      </div>
      <div className="field">
        <label>Board scale — <span style={{ color: 'var(--accent)' }}>{config.boardScale.toFixed(2)}</span></label>
        <input type="range" min="0" max="3" step="0.01" value={config.boardScale} onChange={(e) => updateConfig('boardScale', +e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
        <div className="field"><label>Board offset X</label><input type="number" value={config.boardOffX} onChange={(e) => updateConfig('boardOffX', +e.target.value)} /></div>
        <div className="field"><label>Board offset Y</label><input type="number" value={config.boardOffY} onChange={(e) => updateConfig('boardOffY', +e.target.value)} /></div>
      </div>
      <div className="info-pill">{calcText}</div>

      <div className="sm-hr" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
        <div className="field">
          <label>Spin direction</label>
          <select value={config.spinDirection} onChange={(e) => updateConfig('spinDirection', +e.target.value)}>
            <option value={1}>↓ Down</option>
            <option value={-1}>↑ Up</option>
          </select>
        </div>
        <div className="field"><label>Spin duration (ms)</label><input type="number" min="300" max="15000" step="100" value={config.spinDuration} onChange={(e) => updateConfig('spinDuration', +e.target.value)} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
        <div className="field"><label>Stop offset/reel (ms)</label><input type="number" min="0" max="3000" step="50" value={config.stopOffset} onChange={(e) => updateConfig('stopOffset', +e.target.value)} /></div>
        <div className="field"><label>Accel ramp (ms, 0=instant)</label><input type="number" min="0" max="2000" step="10" value={config.spinAccelMs} onChange={(e) => updateConfig('spinAccelMs', +e.target.value)} /></div>
      </div>
      <div className="field">
        <label>Spin speed (px/frame) — <span style={{ color: 'var(--accent)' }}>{config.spinSpeed}</span></label>
        <input type="range" min="5" max="200" step="1" value={config.spinSpeed} onChange={(e) => updateConfig('spinSpeed', +e.target.value)} />
      </div>

      <div className="sm-hr" />

      <label className="sm-checkbox-row">
        <input type="checkbox" checked={config.blurEnabled} onChange={(e) => updateConfig('blurEnabled', e.target.checked)} />
        Enable motion blur (requires rebuild)
      </label>
      <div className="field"><label>Blur start delay (ms after spin)</label><input type="number" min="0" max="5000" step="10" value={config.blurDelay} onChange={(e) => updateConfig('blurDelay', +e.target.value)} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
        <div className="field"><label>Sigma / strength</label><input type="number" min="1" max="100" value={config.blurSigma} onChange={(e) => updateConfig('blurSigma', +e.target.value)} /></div>
        <div className="field"><label>Edge feather (px)</label><input type="number" min="0" max="100" value={config.blurEdgeFeather} onChange={(e) => updateConfig('blurEdgeFeather', +e.target.value)} /></div>
      </div>

      <div className="sm-hr" />

      <div className="sm-preview-wrap">
        <canvas
          ref={canvasRef}
          onClick={() => { if (machineReady && !isSpinning) doSpin(); }}
          className="sm-preview-canvas"
          style={{ cursor: machineReady ? 'pointer' : 'default' }}
          title={machineReady ? 'Click to spin' : 'Hit BUILD MACHINE then click to spin'}
        />
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            className="btn btn-primary"
            disabled={!machineReady || isSpinning}
            onClick={doSpin}
            style={{ fontSize: '.88rem', padding: '.6rem 2.2rem' }}
          >
            {isSpinning ? '⏳ spinning…' : '🎰 SPIN'}
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.6rem', color: '#444' }}>
            {building ? 'building blur cache…' : (machineReady ? 'or click anywhere in preview' : 'press RUN to build machine')}
          </span>
        </div>
      </div>
    </>
  );
}
