import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { useApp } from '../context/AppContext.jsx';
import { triggerDownload } from '../utils/download.js';

export const assetLibraryMeta = {
  id: 'assetlibrary',
  label: 'Texture Library',
  small: 'reusable textures & sequences',
  icon: '🧱',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc: 'Browse the team\'s reusable texture library (noise, gradients, trails, patterns, UI bits…). Hover a tile for details and downloads; sequence frames can be browsed and downloaded individually from the preview window. New assets are imported via docs/ASSET_LIBRARY_IMPORT.md.'
};

const LIB_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/assetLibrary/';
const DEFAULT_SEQ_FPS = 4;
const MIN_SEQ_FPS = 0.1;
const MAX_SEQ_FPS = 30;
const GRID_SEQ_PREVIEW_FRAMES = 12;
const PREVIEW_FPS_KEY = 'textureLibrary.previewFps';
const LEGACY_PREVIEW_FPS_KEY = 'assetLibrary.previewFps';

function clampSeqFps(v) {
  if (!Number.isFinite(v)) return DEFAULT_SEQ_FPS;
  return Math.min(MAX_SEQ_FPS, Math.max(MIN_SEQ_FPS, v));
}

function sampleFrames(list, max) {
  if (list.length <= max) return list;
  const picked = [];
  const used = new Set();
  const last = list.length - 1;
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i / (max - 1)) * last);
    if (used.has(idx)) continue;
    used.add(idx);
    picked.push(list[idx]);
  }
  return picked;
}

function fmtBytes(n) {
  if (!(n >= 0)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function pathBaseName(path) {
  const base = (path || '').split('/').pop();
  return base || path || 'file';
}

function triggerBlobDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 7000);
}

function frameFileName(entryName, idx, slug) {
  const fromZip = pathBaseName(entryName);
  if (fromZip) return fromZip;
  return `${slug || 'sequence'}_${String(idx + 1).padStart(4, '0')}.png`;
}

function replaceExt(name, ext) {
  const base = (name || '').replace(/\.[^./\\]+$/, '');
  return `${base || 'output'}.${ext}`;
}

async function convertViaMagick(pngUrl, outName, extraArgs = []) {
  const res = await fetch(pngUrl);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const r = await window._Magick.Call(
    [{ name: 'input.png', content: bytes }],
    ['convert', 'input.png', ...extraArgs, outName]
  );
  if (!r || !r.length) throw new Error('no output from ImageMagick');
  return r[0].blob;
}

async function convertPngBlackAsAlpha(pngUrl) {
  const res = await fetch(pngUrl);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const srcBlob = await res.blob();
  const srcUrl = URL.createObjectURL(srcBlob);

  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('2D context unavailable');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, c.width, c.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            d[i] = 255;
            d[i + 1] = 255;
            d[i + 2] = 255;
            d[i + 3] = Math.min(255, Math.max(0, Math.round(lum)));
          }
          ctx.putImageData(imgData, 0, 0);
          c.toBlob((blob) => {
            if (!blob) {
              reject(new Error('toBlob failed'));
              return;
            }
            resolve(blob);
          }, 'image/png');
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = srcUrl;
    });
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

const ALT_FORMATS = [
  { id: 'webp', label: 'WebP', args: ['-quality', '100', '-define', 'webp:lossless=true'] },
  { id: 'jpg', label: 'JPG (flattened)', args: ['-background', 'white', '-flatten', '-quality', '95'] },
  { id: 'tga', label: 'TGA', args: [] },
  { id: 'bmp', label: 'BMP', args: [] }
];

function readZipPngEntries(zip) {
  return Object.values(zip.files)
    .filter((f) => !f.dir && /\.png$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function useSequenceFrames(asset, enabled, log) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [frames, setFrames] = useState([]);
  const frameUrlsRef = useRef([]);

  useEffect(() => {
    let cancelled = false;

    const cleanupUrls = () => {
      for (const u of frameUrlsRef.current) URL.revokeObjectURL(u);
      frameUrlsRef.current = [];
    };

    if (!enabled || !asset?.file) {
      cleanupUrls();
      setLoading(false);
      setError(null);
      setFrames([]);
      return () => {
        cancelled = true;
        cleanupUrls();
      };
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      setFrames([]);
      cleanupUrls();
      try {
        const res = await fetch(LIB_BASE + asset.file, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`sequence ZIP: ${res.status}`);
        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        const pngs = readZipPngEntries(zip);
        if (pngs.length === 0) throw new Error('sequence ZIP contains no PNG frames');

        const loaded = [];
        for (let i = 0; i < pngs.length; i++) {
          const entry = pngs[i];
          const blob = await entry.async('blob');
          if (cancelled) {
            for (const f of loaded) URL.revokeObjectURL(f.url);
            return;
          }
          loaded.push({
            name: frameFileName(entry.name, i, asset.slug),
            bytes: blob.size,
            url: URL.createObjectURL(blob)
          });
        }

        if (cancelled) {
          for (const f of loaded) URL.revokeObjectURL(f.url);
          return;
        }

        frameUrlsRef.current = loaded.map((f) => f.url);
        setFrames(loaded);
      } catch (e) {
        if (cancelled) return;
        const msg = e.message || String(e);
        setError(msg);
        log(`Sequence preview ${asset.slug}: ${msg}`, 'err');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      cleanupUrls();
    };
  }, [asset?.file, asset?.slug, enabled, log]);

  return { loading, error, frames };
}

function SequenceThumb({ asset, fps, log, playing }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [frameUrls, setFrameUrls] = useState([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [inView, setInView] = useState(false);
  const hostRef = useRef(null);
  const frameUrlsRef = useRef([]);
  const logRef = useRef(log);
  logRef.current = log;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new window.IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setInView(true);
      },
      { rootMargin: '200px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;

    const cleanupUrls = () => {
      for (const u of frameUrlsRef.current) URL.revokeObjectURL(u);
      frameUrlsRef.current = [];
    };

    const load = async () => {
      setLoading(true);
      setError(null);
      setFrameIdx(0);
      setFrameUrls([]);
      cleanupUrls();
      try {
        const res = await fetch(LIB_BASE + asset.file, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`sequence ZIP: ${res.status}`);
        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        const pngs = readZipPngEntries(zip);
        if (pngs.length === 0) throw new Error('sequence ZIP contains no PNG frames');

        const sampled = sampleFrames(pngs, GRID_SEQ_PREVIEW_FRAMES);
        const urls = [];
        for (const f of sampled) {
          const blob = await f.async('blob');
          if (cancelled) {
            for (const u of urls) URL.revokeObjectURL(u);
            return;
          }
          urls.push(URL.createObjectURL(blob));
        }

        if (cancelled) {
          for (const u of urls) URL.revokeObjectURL(u);
          return;
        }

        frameUrlsRef.current = urls;
        setFrameUrls(urls);
      } catch (e) {
        if (cancelled) return;
        const msg = e.message || String(e);
        setError(msg);
        logRef.current(`Sequence thumbnail ${asset.slug}: ${msg}`, 'err');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      cleanupUrls();
    };
  }, [asset.file, asset.slug, inView]);

  useEffect(() => {
    if (!inView || !playing || frameUrls.length < 2) return;
    const hz = clampSeqFps(fps);
    const timer = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % frameUrls.length);
    }, 1000 / hz);
    return () => window.clearInterval(timer);
  }, [frameUrls, fps, inView, playing]);

  useEffect(() => {
    if (!playing) setFrameIdx(0);
  }, [playing]);

  return (
    <div ref={hostRef} className="al-thumb al-thumb-seq" aria-label={asset.name}>
      {frameUrls.length > 0 && !error ? (
        <img src={frameUrls[frameIdx]} alt={asset.name} />
      ) : (
        <div className="al-thumb-seq-placeholder">{error ? 'preview unavailable' : 'loading…'}</div>
      )}
    </div>
  );
}

function AssetCard({ asset, license, menuOpen, onToggleMenu, onCloseMenu, onOpenLightbox, magickReady, log, seqPreviewFps }) {
  const [busyFmt, setBusyFmt] = useState(null);
  const [hovered, setHovered] = useState(false);
  const seq = asset.type === 'sequence';
  const mainLabel = seq ? '⬇ ZIP' : '⬇ PNG';
  const mainTitle = seq
    ? `Download ${asset.frames} PNG frames as ZIP`
    : 'Download as PNG (max quality)';

  const downloadMain = (e) => {
    e.stopPropagation();
    triggerDownload(LIB_BASE + asset.file, pathBaseName(asset.file));
  };

  const downloadOriginal = (e) => {
    e.stopPropagation();
    if (!asset.origFile) return;
    onCloseMenu();
    triggerDownload(LIB_BASE + asset.origFile, pathBaseName(asset.origFile));
  };

  const downloadAlt = async (e, fmt) => {
    e.stopPropagation();
    if (busyFmt) return;
    setBusyFmt(fmt.id);
    try {
      const blob = await convertViaMagick(LIB_BASE + asset.file, `output.${fmt.id}`, fmt.args);
      triggerBlobDownload(blob, `${asset.slug}.${fmt.id}`);
      onCloseMenu();
    } catch (err) {
      log(`${asset.slug} → ${fmt.id}: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  const downloadBlackAsAlpha = async (e) => {
    e.stopPropagation();
    if (busyFmt) return;
    setBusyFmt('png-black-alpha');
    try {
      const blob = await convertPngBlackAsAlpha(LIB_BASE + asset.file);
      triggerBlobDownload(blob, `${asset.slug}_black_as_alpha.png`);
      onCloseMenu();
    } catch (err) {
      log(`${asset.slug} → png black as alpha: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  const downloadPreview = (e) => {
    e.stopPropagation();
    onCloseMenu();
    triggerDownload(LIB_BASE + asset.thumb, `${asset.slug}-preview.webp`);
  };

  return (
    <div
      className={`al-tile ${menuOpen ? 'al-pin' : ''}`}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={() => onOpenLightbox(asset)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenLightbox(asset); }}
    >
      {seq
        ? <SequenceThumb asset={asset} fps={seqPreviewFps} log={log} playing={hovered || menuOpen} />
        : <img className="al-thumb" loading="lazy" src={LIB_BASE + asset.thumb} alt={asset.name} />}
      {seq && <span className="al-seq-badge">▶ seq</span>}
      <div className="al-overlay">
        <div className="al-info">
          <div className="al-info-name">{asset.name}</div>
          <div>{asset.w}×{asset.h}{seq ? ` · ${asset.frames} frames @ ${asset.fps}fps` : ''}</div>
          <div>orig: {(asset.origFormat || 'png').toUpperCase()} · {fmtBytes(asset.origBytes ?? asset.bytes)}</div>
          {license && <div className="al-info-lic">{license.label}</div>}
        </div>
        <div className="al-dl-row" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="al-dl-main" title={mainTitle} onClick={downloadMain}>
            {mainLabel}
          </button>
          <button
            type="button"
            className="al-dl-caret"
            title="More formats"
            onClick={(e) => { e.stopPropagation(); onToggleMenu(asset.slug); }}
          >▾</button>
        </div>
        {menuOpen && (
          <div className="al-menu" onClick={(e) => e.stopPropagation()}>
            {seq ? (
              <button type="button" className="al-menu-item" onClick={downloadPreview}>
                Animated WebP preview
              </button>
            ) : (
              <>
                {asset.origFile && (
                  <button type="button" className="al-menu-item" onClick={downloadOriginal}>
                    Original ({(asset.origFormat || '?').toUpperCase()} · {fmtBytes(asset.origBytes)})
                  </button>
                )}
                <button
                  type="button"
                  className="al-menu-item"
                  disabled={!!busyFmt}
                  onClick={downloadBlackAsAlpha}
                >
                  {busyFmt === 'png-black-alpha' ? 'PNG black as alpha — converting…' : 'PNG black as alpha'}
                </button>
                {ALT_FORMATS.filter((f) => f.id !== (asset.origFormat || 'png')).map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    className="al-menu-item"
                    disabled={!magickReady || !!busyFmt}
                    title={magickReady ? `Convert PNG → ${fmt.label} in your browser` : 'waiting for ImageMagick WASM…'}
                    onClick={(e) => downloadAlt(e, fmt)}
                  >
                    {busyFmt === fmt.id ? `${fmt.label} — converting…` : fmt.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Lightbox({ asset, license, onClose, seqPreviewFps, onSeqPreviewFpsChange, log, magickReady }) {
  const [busyFmt, setBusyFmt] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [frameMenuIdx, setFrameMenuIdx] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [frameGridHover, setFrameGridHover] = useState(false);
  const safeAsset = asset || { slug: 'preview', type: 'texture', file: '', name: '', w: 0, h: 0, bytes: 0, fps: 0, frames: 0, source: '', tags: [] };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setMenuOpen(false);
    setBusyFmt(null);
    setFrameMenuIdx(null);
    setFrameIdx(0);
    setFrameGridHover(false);
  }, [safeAsset.slug]);

  const seq = safeAsset.type === 'sequence';
  const imgSrc = LIB_BASE + safeAsset.file;
  const previewFps = clampSeqFps(seqPreviewFps);
  const speedInputId = `al-seq-speed-${safeAsset.slug || 'preview'}`;
  const { loading: seqLoading, error: seqError, frames } = useSequenceFrames(safeAsset, seq, log);

  useEffect(() => {
    if (seq && frameIdx >= frames.length && frames.length > 0) setFrameIdx(0);
  }, [seq, frameIdx, frames.length]);

  useEffect(() => {
    if (!seq || frames.length < 2 || frameGridHover) return;
    const hz = clampSeqFps(previewFps);
    const timer = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % frames.length);
    }, 1000 / hz);
    return () => window.clearInterval(timer);
  }, [seq, frames, previewFps, frameGridHover]);

  const activeFrame = seq && frames.length > 0 ? frames[frameIdx % frames.length] : null;

  const downloadMain = () => {
    triggerDownload(LIB_BASE + safeAsset.file, pathBaseName(safeAsset.file));
  };

  const downloadOriginal = () => {
    if (!safeAsset.origFile) return;
    triggerDownload(LIB_BASE + safeAsset.origFile, pathBaseName(safeAsset.origFile));
    setMenuOpen(false);
  };

  const downloadAlt = async (fmt) => {
    if (busyFmt) return;
    setBusyFmt(fmt.id);
    try {
      const blob = await convertViaMagick(LIB_BASE + safeAsset.file, `output.${fmt.id}`, fmt.args);
      triggerBlobDownload(blob, `${safeAsset.slug}.${fmt.id}`);
      setMenuOpen(false);
    } catch (err) {
      log(`${safeAsset.slug} → ${fmt.id}: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  const downloadBlackAsAlpha = async () => {
    if (busyFmt) return;
    setBusyFmt('png-black-alpha');
    try {
      const blob = await convertPngBlackAsAlpha(LIB_BASE + safeAsset.file);
      triggerBlobDownload(blob, `${safeAsset.slug}_black_as_alpha.png`);
      setMenuOpen(false);
    } catch (err) {
      log(`${safeAsset.slug} → png black as alpha: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  const downloadFrameAlt = async (frame, fmt) => {
    if (!frame || busyFmt) return;
    const busyId = `frame-${frame.name}-${fmt.id}`;
    setBusyFmt(busyId);
    try {
      const blob = await convertViaMagick(frame.url, `output.${fmt.id}`, fmt.args);
      triggerBlobDownload(blob, replaceExt(frame.name, fmt.id));
      setFrameMenuIdx(null);
    } catch (err) {
      log(`${safeAsset.slug}/${frame.name} → ${fmt.id}: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  const downloadFrameBlackAsAlpha = async (frame) => {
    if (!frame || busyFmt) return;
    const busyId = `frame-${frame.name}-png-black-alpha`;
    setBusyFmt(busyId);
    try {
      const blob = await convertPngBlackAsAlpha(frame.url);
      triggerBlobDownload(blob, replaceExt(frame.name, 'png'));
      setFrameMenuIdx(null);
    } catch (err) {
      log(`${safeAsset.slug}/${frame.name} → png black as alpha: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  return (
    <div className="al-lightbox" onClick={onClose}>
      <div className="al-lb-inner" onClick={(e) => e.stopPropagation()}>
        <div className="al-lb-preview">
          {seq ? (
            seqLoading
              ? <div className="al-lb-loading">Loading sequence frames…</div>
              : seqError
                ? <div className="al-lb-loading al-err">Sequence preview unavailable: {seqError}</div>
                : activeFrame
                  ? <img className="al-lb-img" src={activeFrame.url} alt={`${safeAsset.name} frame ${frameIdx + 1}`} />
                  : <div className="al-lb-loading al-err">No frames found.</div>
          ) : (
            <img className="al-lb-img" src={imgSrc} alt={safeAsset.name} />
          )}
        </div>
        <div className="al-lb-meta">
          <div className="al-lb-name">{safeAsset.name}</div>
          <div>{safeAsset.w}×{safeAsset.h}{seq ? ` · ${safeAsset.frames} frames @ ${safeAsset.fps}fps` : ''}</div>

          {seq ? (
            <>
              <div className="al-lb-actions">
                <button type="button" className="al-lb-action al-lb-action-main" onClick={downloadMain}>
                  ⬇ ZIP
                </button>
                <button
                  type="button"
                  className="al-lb-action"
                  disabled={!activeFrame}
                  onClick={() => activeFrame && triggerDownload(activeFrame.url, activeFrame.name)}
                >
                  ⬇ current PNG
                </button>
              </div>
              <div className="al-speed-wrap">
                <label className="al-speed-label" htmlFor={speedInputId}>Preview speed</label>
                <div className="al-speed-row">
                  <input
                    id={speedInputId}
                    className="al-speed-input"
                    type="number"
                    min={MIN_SEQ_FPS}
                    max={MAX_SEQ_FPS}
                    step="0.1"
                    value={previewFps}
                    onChange={(e) => onSeqPreviewFpsChange(e.target.value)}
                  />
                  <span className="al-speed-unit">fps</span>
                </div>
                <div className="al-speed-hint">Preview loads all frames on open so you can browse and download each frame below.</div>
              </div>
              <div className="al-seq-browser">
                <div className="al-seq-frames-head">Sequence frames ({frames.length || safeAsset.frames || 0})</div>
                {seqLoading && <div className="al-seq-frames-empty">Loading frames…</div>}
                {!seqLoading && seqError && <div className="al-seq-frames-empty al-err">Sequence frames unavailable: {seqError}</div>}
                {!seqLoading && !seqError && frames.length === 0 && <div className="al-seq-frames-empty al-err">No frames found.</div>}
                {!seqLoading && !seqError && frames.length > 0 && (
                  <div
                    className="al-seq-frames-grid"
                    onMouseEnter={() => setFrameGridHover(true)}
                    onMouseLeave={() => setFrameGridHover(false)}
                    onClick={() => setFrameMenuIdx(null)}
                  >
                    {frames.map((frame, idx) => (
                      <div key={`${frame.name}-${idx}`} className={`al-seq-frame-card ${idx === frameIdx ? 'al-seq-frame-card-on' : ''}`}>
                        <button
                          type="button"
                          className="al-seq-frame-preview"
                          onMouseEnter={() => setFrameIdx(idx)}
                          onFocus={() => setFrameIdx(idx)}
                          onClick={() => setFrameIdx(idx)}
                        >
                          <img src={frame.url} loading="lazy" alt={`${safeAsset.name} frame ${idx + 1}`} />
                          <span className="al-seq-frame-idx">#{idx + 1}</span>
                        </button>
                        <div className="al-seq-frame-row">
                          <span className="al-seq-frame-name" title={frame.name}>{frame.name}</span>
                          <div className="al-seq-frame-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="al-seq-frame-dl"
                              title={`Download ${frame.name}`}
                              onClick={() => triggerDownload(frame.url, frame.name)}
                            >
                              PNG
                            </button>
                            <button
                              type="button"
                              className="al-seq-frame-caret"
                              title="More frame formats"
                              onClick={() => setFrameMenuIdx((cur) => (cur === idx ? null : idx))}
                            >▾</button>
                            {frameMenuIdx === idx && (
                              <div className="al-seq-frame-menu">
                                <button
                                  type="button"
                                  className="al-menu-item"
                                  disabled={!!busyFmt}
                                  onClick={() => downloadFrameBlackAsAlpha(frame)}
                                >
                                  {busyFmt === `frame-${frame.name}-png-black-alpha`
                                    ? 'PNG black as alpha — converting…'
                                    : 'PNG black as alpha'}
                                </button>
                                {ALT_FORMATS.map((fmt) => (
                                  <button
                                    key={`${frame.name}-${fmt.id}`}
                                    type="button"
                                    className="al-menu-item"
                                    disabled={!magickReady || !!busyFmt}
                                    title={magickReady ? `Convert PNG → ${fmt.label} in your browser` : 'waiting for ImageMagick WASM…'}
                                    onClick={() => downloadFrameAlt(frame, fmt)}
                                  >
                                    {busyFmt === `frame-${frame.name}-${fmt.id}` ? `${fmt.label} — converting…` : fmt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="al-seq-frame-size">{fmtBytes(frame.bytes)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="al-lb-dl-wrap">
              <div className="al-dl-row al-lb-dl-row">
                <button type="button" className="al-dl-main" title="Download as PNG (max quality)" onClick={downloadMain}>
                  ⬇ PNG
                </button>
                <button
                  type="button"
                  className="al-dl-caret"
                  title="More formats"
                  onClick={() => setMenuOpen((v) => !v)}
                >▾</button>
              </div>
              {menuOpen && (
                <div className="al-menu al-lb-menu">
                  {safeAsset.origFile && (
                    <button type="button" className="al-menu-item" onClick={downloadOriginal}>
                      Original ({(safeAsset.origFormat || '?').toUpperCase()} · {fmtBytes(safeAsset.origBytes)})
                    </button>
                  )}
                  <button
                    type="button"
                    className="al-menu-item"
                    disabled={!!busyFmt}
                    onClick={downloadBlackAsAlpha}
                  >
                    {busyFmt === 'png-black-alpha' ? 'PNG black as alpha — converting…' : 'PNG black as alpha'}
                  </button>
                  {ALT_FORMATS.filter((f) => f.id !== (safeAsset.origFormat || 'png')).map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      className="al-menu-item"
                      disabled={!magickReady || !!busyFmt}
                      title={magickReady ? `Convert PNG → ${fmt.label} in your browser` : 'waiting for ImageMagick WASM…'}
                      onClick={() => downloadAlt(fmt)}
                    >
                      {busyFmt === fmt.id ? `${fmt.label} — converting…` : fmt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>original format: {(safeAsset.origFormat || 'png').toUpperCase()} · {fmtBytes(safeAsset.origBytes ?? safeAsset.bytes)}</div>
          <div>download size: {fmtBytes(safeAsset.bytes)}{seq ? ' (ZIP of PNG frames)' : ' (PNG)'}</div>
          <div>source: {safeAsset.source}</div>
          {safeAsset.tags?.length > 0 && <div>tags: {safeAsset.tags.join(', ')}</div>}
          {license && (
            <div className="al-lb-lic">
              license: {license.file
                ? <a href={LIB_BASE + license.file} target="_blank" rel="noreferrer">{license.label}</a>
                : license.label}
            </div>
          )}
          <button type="button" className="al-lb-close" onClick={onClose}>✕ close (Esc)</button>
        </div>
      </div>
    </div>
  );
}

export function AssetLibraryTool() {
  const { log, magickReady } = useApp();
  const [manifest, setManifest] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ok | err
  const [loadErr, setLoadErr] = useState(null);
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [seqPreviewFps, setSeqPreviewFps] = useState(DEFAULT_SEQ_FPS);
  const loggedRef = useRef(false);

  const loadAll = async () => {
    setLoadState('loading');
    setLoadErr(null);
    try {
      const res = await fetch(LIB_BASE + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
      const m = await res.json();
      setManifest(m);
      setLoadState('ok');
      if (!loggedRef.current) {
        log(`Texture Library: ${m.assets.length} assets in ${m.categories.length} categories.`, 'ok');
        loggedRef.current = true;
      }
    } catch (e) {
      setLoadState('err');
      setLoadErr(e.message || String(e));
      log(`Texture Library: ${e.message || e}`, 'err');
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(PREVIEW_FPS_KEY) || window.localStorage.getItem(LEGACY_PREVIEW_FPS_KEY);
      if (saved != null) setSeqPreviewFps(clampSeqFps(Number(saved)));
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PREVIEW_FPS_KEY, String(seqPreviewFps));
    } catch {
      // ignore storage failures
    }
  }, [seqPreviewFps]);

  const assets = manifest?.assets || [];
  const categories = manifest?.categories || [];
  const licenses = manifest?.licenses || {};
  const hasSequence = useMemo(() => assets.some((a) => a.type === 'sequence'), [assets]);

  const counts = useMemo(() => {
    const c = { all: assets.length };
    for (const a of assets) c[a.category] = (c[a.category] || 0) + 1;
    return c;
  }, [assets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (cat !== 'all' && a.category !== cat) return false;
      if (!q) return true;
      return [a.name, a.slug, a.source, a.category, ...(a.tags || [])]
        .some((s) => (s || '').toLowerCase().includes(q));
    });
  }, [assets, cat, query]);

  const sections = useMemo(() => {
    const byCat = new Map();
    for (const a of visible) {
      if (!byCat.has(a.category)) byCat.set(a.category, []);
      byCat.get(a.category).push(a);
    }
    return categories
      .filter((c) => byCat.has(c.id))
      .map((c) => ({ cat: c, assets: byCat.get(c.id) }));
  }, [visible, categories]);

  return (
    <div className="al-root">
      <div className="al-bar">
        <div className="al-chips">
          <button
            type="button"
            className={`al-chip ${cat === 'all' ? 'al-chip-on' : ''}`}
            onClick={() => setCat('all')}
          >All <span className="al-count">{counts.all || 0}</span></button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`al-chip ${cat === c.id ? 'al-chip-on' : ''}`}
              onClick={() => setCat(c.id)}
            >{c.icon} {c.label} <span className="al-count">{counts[c.id] || 0}</span></button>
          ))}
        </div>
        <div className="al-search">
          <input
            type="search"
            placeholder="Filter by name, tag, source…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {query && <button type="button" className="al-search-clear" onClick={() => setQuery('')}>×</button>}
        </div>
        {hasSequence && (
          <div className="al-seq-speed">
            <span className="al-seq-speed-label">Preview speed</span>
            <input
              className="al-seq-speed-input"
              type="number"
              min={MIN_SEQ_FPS}
              max={MAX_SEQ_FPS}
              step="0.1"
              value={seqPreviewFps}
              onChange={(e) => setSeqPreviewFps(clampSeqFps(Number(e.target.value)))}
            />
            <span className="al-seq-speed-unit">fps</span>
          </div>
        )}
        <button className="btn" type="button" onClick={loadAll} title="Reload manifest">↻</button>
      </div>

      {loadState === 'loading' && <div className="al-empty">loading texture library…</div>}
      {loadState === 'err' && (
        <div className="al-empty al-err">
          Failed to load texture library: {loadErr}. Did the first import run? (public/assetLibrary/manifest.json)
        </div>
      )}
      {loadState === 'ok' && visible.length === 0 && (
        <div className="al-empty">
          {assets.length === 0
            ? 'Texture library is empty — run the import routine (docs/ASSET_LIBRARY_IMPORT.md).'
            : 'Nothing matches the current filter.'}
        </div>
      )}

      {sections.map(({ cat: c, assets: list }) => (
        <section key={c.id} className="al-section">
          <h3 className="al-section-title">{c.icon} {c.label} <span className="al-count">{list.length}</span></h3>
          <div className="al-grid">
            {list.map((a) => (
              <AssetCard
                key={a.slug}
                asset={a}
                license={licenses[a.license]}
                menuOpen={openMenu === a.slug}
                onToggleMenu={(slug) => setOpenMenu((cur) => (cur === slug ? null : slug))}
                onCloseMenu={() => setOpenMenu(null)}
                onOpenLightbox={setLightbox}
                magickReady={magickReady}
                log={log}
                seqPreviewFps={seqPreviewFps}
              />
            ))}
          </div>
        </section>
      ))}

      {lightbox && (
        <Lightbox
          asset={lightbox}
          license={licenses[lightbox.license]}
          onClose={() => setLightbox(null)}
          seqPreviewFps={seqPreviewFps}
          onSeqPreviewFpsChange={(value) => setSeqPreviewFps(clampSeqFps(Number(value)))}
          log={log}
          magickReady={magickReady}
        />
      )}

      <style>{`
        .al-root{display:flex;flex-direction:column;gap:1rem;padding:0 1rem 1.5rem}
        .al-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;padding:.7rem .2rem;background:var(--bg);border-bottom:1px solid var(--border);margin:0 -1rem;padding-left:1.2rem;padding-right:1.2rem}
        .al-chips{display:flex;gap:.35rem;flex-wrap:wrap;flex:1;min-width:0}
        .al-chip{font-family:var(--font-mono);font-size:.72rem;padding:.4rem .7rem;background:var(--surface);border:1px solid var(--border);border-radius:99px;color:var(--muted);cursor:pointer;white-space:nowrap;transition:border-color .15s,color .15s}
        .al-chip:hover{border-color:var(--accent2);color:var(--text)}
        .al-chip-on{border-color:var(--accent);color:var(--accent);background:var(--surface2)}
        .al-count{opacity:.55;font-size:.62rem;margin-left:.15rem}
        .al-search{position:relative;display:flex;align-items:center}
        .al-search input{width:220px;padding:.45rem .7rem;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-family:var(--font-mono);font-size:.72rem;outline:none}
        .al-search input:focus{border-color:var(--accent)}
        .al-search input::-webkit-search-cancel-button{display:none}
        .al-search-clear{position:absolute;right:.4rem;background:transparent;border:0;color:var(--muted);font-size:1rem;cursor:pointer}
        .al-seq-speed{display:flex;align-items:center;gap:.45rem;padding:.3rem .5rem;background:var(--surface);border:1px solid var(--border);border-radius:5px}
        .al-seq-speed-label{font-family:var(--font-mono);font-size:.62rem;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
        .al-seq-speed-input{width:4.5rem;padding:.28rem .38rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:.66rem}
        .al-seq-speed-input:focus{outline:none;border-color:var(--accent)}
        .al-seq-speed-unit{font-family:var(--font-mono);font-size:.62rem;color:var(--muted)}
        .al-section{display:flex;flex-direction:column;gap:.55rem}
        .al-section-title{font-family:var(--font-mono);font-size:.8rem;color:var(--accent2);margin:.3rem 0 0;letter-spacing:.05em}
        .al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:.6rem}
        .al-tile{position:relative;aspect-ratio:1/1;border:1px solid var(--border);border-radius:6px;overflow:hidden;cursor:pointer;outline:none;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;transition:border-color .15s}
        .al-tile:hover,.al-tile:focus,.al-tile.al-pin{border-color:var(--accent)}
        .al-thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
        .al-thumb-seq{display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px}
        .al-thumb-seq img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
        .al-thumb-seq-placeholder{font-family:var(--font-mono);font-size:.62rem;color:var(--muted);text-align:center;padding:.5rem}
        .al-seq-badge{position:absolute;top:.4rem;right:.4rem;font-family:var(--font-mono);font-size:.58rem;padding:.12rem .4rem;background:rgba(0,0,0,.65);border:1px solid var(--border);border-radius:3px;color:var(--accent2);pointer-events:none}
        .al-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:.5rem;background:linear-gradient(to bottom,rgba(0,0,0,.55),transparent 38%,transparent 60%,rgba(0,0,0,.6));opacity:0;transition:opacity .12s ease}
        .al-tile:hover .al-overlay,.al-tile:focus .al-overlay,.al-tile.al-pin .al-overlay{opacity:1}
        .al-info{font-family:var(--font-mono);font-size:.6rem;line-height:1.5;color:#ddd;text-shadow:0 1px 2px rgba(0,0,0,.9);pointer-events:none}
        .al-info-name{font-size:.7rem;font-weight:600;color:#fff}
        .al-info-lic{color:var(--accent2)}
        .al-dl-row{display:flex;gap:1px;align-self:flex-start}
        .al-dl-main{font-family:var(--font-mono);font-size:.68rem;font-weight:600;padding:.42rem .75rem;background:#2ea043;color:#fff;border:0;border-radius:4px 0 0 4px;cursor:pointer}
        .al-dl-main:hover{background:#3fb950}
        .al-dl-caret{font-family:var(--font-mono);font-size:.68rem;padding:.42rem .5rem;background:#26863a;color:#fff;border:0;border-radius:0 4px 4px 0;cursor:pointer}
        .al-dl-caret:hover{background:#3fb950}
        .al-menu{position:absolute;bottom:2.6rem;left:.5rem;z-index:5;display:flex;flex-direction:column;min-width:11rem;background:var(--surface);border:1px solid var(--border);border-radius:5px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.5)}
        .al-menu-item{font-family:var(--font-mono);font-size:.66rem;text-align:left;padding:.45rem .7rem;background:transparent;border:0;border-bottom:1px solid var(--border);color:var(--text);cursor:pointer}
        .al-menu-item:last-child{border-bottom:0}
        .al-menu-item:hover:not(:disabled){background:var(--surface2);color:var(--accent2)}
        .al-menu-item:disabled{opacity:.45;cursor:default}
        .al-empty{padding:2rem;text-align:center;font-family:var(--font-mono);font-size:.74rem;color:var(--muted);border:1px dashed var(--border);border-radius:6px}
        .al-err{color:var(--accent3,#ff6b3d)}
        .al-lightbox{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.78);padding:2rem}
        .al-lb-inner{display:flex;gap:1.1rem;width:min(1600px,96vw);height:90vh;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem;align-items:stretch}
        .al-lb-preview{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-width:0}
        .al-lb-img{width:100%;height:100%;object-fit:contain;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;border-radius:4px;min-width:0}
        .al-lb-loading{display:flex;align-items:center;justify-content:center;max-width:62vw;max-height:84vh;min-width:280px;min-height:280px;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;border-radius:4px;font-family:var(--font-mono);font-size:.72rem;color:var(--muted);padding:1rem;text-align:center}
        .al-lb-meta{display:flex;flex-direction:column;gap:.45rem;font-family:var(--font-mono);font-size:.7rem;color:var(--text);width:min(450px,34vw);max-height:84vh;min-height:0}
        .al-lb-name{font-size:.85rem;font-weight:600;color:var(--accent2)}
        .al-lb-actions{display:flex;gap:.45rem;flex-wrap:wrap}
        .al-lb-action{font-family:var(--font-mono);font-size:.67rem;padding:.4rem .72rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer}
        .al-lb-action:disabled{opacity:.5;cursor:default}
        .al-lb-action:hover:not(:disabled){border-color:var(--accent2);color:var(--accent2)}
        .al-lb-action-main{background:#2ea043;border-color:#2ea043;color:#fff}
        .al-lb-action-main:hover{background:#3fb950;border-color:#3fb950;color:#fff}
        .al-lb-dl-wrap{display:flex;flex-direction:column;gap:.4rem;align-self:flex-start;max-width:100%}
        .al-lb-dl-row{align-self:flex-start}
        .al-lb-menu{position:static;bottom:auto;left:auto;min-width:12rem;max-width:100%;box-shadow:none}
        .al-speed-wrap{display:flex;flex-direction:column;gap:.35rem;padding:.5rem .55rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px}
        .al-speed-label{font-size:.64rem;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
        .al-speed-row{display:flex;align-items:center;gap:.45rem}
        .al-speed-input{width:4.6rem;padding:.28rem .4rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:.68rem}
        .al-speed-input:focus{outline:none;border-color:var(--accent)}
        .al-speed-unit{font-size:.64rem;color:var(--muted)}
        .al-speed-hint{font-size:.62rem;color:var(--muted)}
        .al-seq-browser{display:flex;flex-direction:column;gap:.35rem;min-height:0}
        .al-seq-frames-head{font-size:.64rem;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
        .al-seq-frames-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.45rem;max-height:35vh;overflow:auto;padding-right:.2rem}
        .al-seq-frame-card{display:flex;flex-direction:column;gap:.32rem;padding:.34rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px}
        .al-seq-frame-card-on{border-color:var(--accent2)}
        .al-seq-frame-preview{position:relative;display:block;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;padding:0;cursor:pointer}
        .al-seq-frame-preview img{width:100%;aspect-ratio:1/1;object-fit:contain;display:block}
        .al-seq-frame-idx{position:absolute;left:.25rem;top:.25rem;font-size:.56rem;padding:.08rem .25rem;border-radius:3px;background:rgba(0,0,0,.72);color:#fff}
        .al-seq-frame-row{display:flex;align-items:center;gap:.3rem}
        .al-seq-frame-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.6rem;color:var(--muted)}
        .al-seq-frame-actions{position:relative;display:flex;align-items:center;gap:1px}
        .al-seq-frame-dl{font-family:var(--font-mono);font-size:.58rem;padding:.18rem .4rem;background:#2ea043;border:0;border-radius:3px;color:#fff;cursor:pointer}
        .al-seq-frame-dl:hover{background:#3fb950}
        .al-seq-frame-caret{font-family:var(--font-mono);font-size:.58rem;padding:.18rem .32rem;background:#26863a;border:0;border-radius:3px;color:#fff;cursor:pointer}
        .al-seq-frame-caret:hover{background:#3fb950}
        .al-seq-frame-menu{position:absolute;right:0;top:100%;margin-top:.25rem;z-index:8;display:flex;flex-direction:column;min-width:10.2rem;background:var(--surface);border:1px solid var(--border);border-radius:5px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.5)}
        .al-seq-frame-size{font-size:.56rem;color:var(--muted)}
        .al-seq-frames-empty{padding:.6rem .5rem;text-align:center;font-size:.64rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--muted)}
        .al-lb-lic a{color:var(--accent2)}
        .al-lb-close{margin-top:.4rem;align-self:flex-start;font-family:var(--font-mono);font-size:.68rem;padding:.4rem .8rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--muted);cursor:pointer}
        .al-lb-close:hover{color:var(--text);border-color:var(--accent2)}
        @media (max-width: 1100px){
          .al-lb-inner{flex-direction:column;height:auto;max-height:92vh;overflow:auto;padding:.85rem}
          .al-lb-preview{width:100%;height:55vh;flex:0 0 auto}
          .al-lb-img,.al-lb-loading{width:100%;height:100%;max-width:100%;max-height:55vh}
          .al-lb-meta{width:100%;max-width:none;max-height:none;overflow:visible}
          .al-seq-frames-grid{max-height:34vh;grid-template-columns:repeat(3,minmax(0,1fr))}
        }
        @media (max-width: 980px){
          .al-bar{gap:.5rem}
          .al-seq-speed{width:100%;justify-content:flex-start}
          .al-search{width:100%}
          .al-search input{width:100%}
          .al-lightbox{padding:1rem}
          .al-seq-frames-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
      `}</style>
    </div>
  );
}
