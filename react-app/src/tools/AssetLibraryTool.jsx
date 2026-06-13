import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { useApp } from '../context/AppContext.jsx';
import { triggerDownload } from '../utils/download.js';

export const assetLibraryMeta = {
  id: 'assetlibrary',
  label: 'Asset Library',
  small: 'reusable textures & sequences',
  icon: '🧱',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc: 'Browse the team\'s reusable texture library (noise, gradients, trails, patterns, UI bits…). Hover a tile for details and downloads; sequences preview as animated thumbnails and download as a ZIP of PNG frames. New assets are imported via docs/ASSET_LIBRARY_IMPORT.md.'
};

// Base URL respects Vite's `base` config — same pattern as TemplatesTool.
const LIB_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/assetLibrary/';
const DEFAULT_SEQ_FPS = 4;
const MIN_SEQ_FPS = 0.1;
const MAX_SEQ_FPS = 30;
const GRID_SEQ_PREVIEW_FRAMES = 12;

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

// All alt-format conversions go through ImageMagick WASM — canvas round-trips
// premultiply alpha and corrupt straight-alpha channels (see CLAUDE.md).
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

const ALT_FORMATS = [
  { id: 'webp', label: 'WebP', args: ['-quality', '100', '-define', 'webp:lossless=true'] },
  { id: 'jpg', label: 'JPG (flattened)', args: ['-background', 'white', '-flatten', '-quality', '95'] },
  { id: 'tga', label: 'TGA', args: [] },
  { id: 'bmp', label: 'BMP', args: [] }
];

function SequenceFramePlayer({ asset, fps, log }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [frameUrls, setFrameUrls] = useState([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const frameUrlsRef = useRef([]);

  useEffect(() => {
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
        const pngs = Object.values(zip.files)
          .filter((f) => !f.dir && /\.png$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        if (pngs.length === 0) throw new Error('sequence ZIP contains no PNG frames');

        const urls = [];
        for (const f of pngs) {
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
  }, [asset.file, asset.slug, log]);

  useEffect(() => {
    if (frameUrls.length < 2) return;
    const hz = clampSeqFps(fps);
    const timer = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % frameUrls.length);
    }, 1000 / hz);
    return () => window.clearInterval(timer);
  }, [frameUrls, fps]);

  if (loading) return <div className="al-lb-loading">Loading sequence frames…</div>;
  if (error) return <div className="al-lb-loading al-err">Sequence preview unavailable: {error}</div>;
  if (frameUrls.length === 0) return <div className="al-lb-loading al-err">No frames found.</div>;

  return <img className="al-lb-img" src={frameUrls[frameIdx]} alt={asset.name} />;
}

function SequenceThumb({ asset, fps, log, playing }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [frameUrls, setFrameUrls] = useState([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [inView, setInView] = useState(false);
  const hostRef = useRef(null);
  const frameUrlsRef = useRef([]);

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
        const pngs = Object.values(zip.files)
          .filter((f) => !f.dir && /\.png$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
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
        log(`Sequence thumbnail ${asset.slug}: ${msg}`, 'err');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      cleanupUrls();
    };
  }, [asset.file, asset.slug, inView, log]);

  useEffect(() => {
    if (!inView || !playing || frameUrls.length < 2) return;
    const hz = clampSeqFps(fps);
    const timer = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % frameUrls.length);
    }, 1000 / hz);
    return () => window.clearInterval(timer);
  }, [frameUrls, fps, inView, playing]);

  return (
    <div ref={hostRef} className="al-thumb al-thumb-seq" aria-label={asset.name}>
      {frameUrls.length > 0 && !error ? (
        <img src={frameUrls[frameIdx]} alt={asset.name} />
      ) : (
        <div className="al-thumb-seq-placeholder">{loading ? 'loading…' : 'preview unavailable'}</div>
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
    triggerDownload(LIB_BASE + asset.file, asset.file.split('/').pop());
  };

  const downloadOriginal = (e) => {
    e.stopPropagation();
    onCloseMenu();
    triggerDownload(LIB_BASE + asset.origFile, asset.origFile.split('/').pop());
  };

  const downloadAlt = async (e, fmt) => {
    e.stopPropagation();
    if (busyFmt) return;
    setBusyFmt(fmt.id);
    try {
      const blob = await convertViaMagick(LIB_BASE + asset.file, `output.${fmt.id}`, fmt.args);
      triggerDownload(URL.createObjectURL(blob), `${asset.slug}.${fmt.id}`);
      onCloseMenu();
    } catch (err) {
      log(`${asset.slug} → ${fmt.id}: ${err.message || err}`, 'err');
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

function Lightbox({ asset, license, onClose, seqPreviewFps, onSeqPreviewFpsChange, log }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!asset) return null;
  const seq = asset.type === 'sequence';
  const imgSrc = LIB_BASE + asset.file;
  const previewFps = clampSeqFps(seqPreviewFps);
  const speedInputId = `al-seq-speed-${asset.slug || 'preview'}`;

  return (
    <div className="al-lightbox" onClick={onClose}>
      <div className="al-lb-inner" onClick={(e) => e.stopPropagation()}>
        {seq
          ? <SequenceFramePlayer asset={asset} fps={previewFps} log={log} />
          : <img className="al-lb-img" src={imgSrc} alt={asset.name} />}
        <div className="al-lb-meta">
          <div className="al-lb-name">{asset.name}</div>
          <div>{asset.w}×{asset.h}{seq ? ` · ${asset.frames} frames @ ${asset.fps}fps` : ''}</div>
          {seq && (
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
              <div className="al-speed-hint">Grid previews animate only on hover.</div>
            </div>
          )}
          <div>original format: {(asset.origFormat || 'png').toUpperCase()} · {fmtBytes(asset.origBytes ?? asset.bytes)}</div>
          <div>download size: {fmtBytes(asset.bytes)}{seq ? ' (ZIP of PNG frames)' : ' (PNG)'}</div>
          <div>source: {asset.source}</div>
          {asset.tags?.length > 0 && <div>tags: {asset.tags.join(', ')}</div>}
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
  const [openMenu, setOpenMenu] = useState(null); // slug of the tile with an open format menu
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
        log(`Asset Library: ${m.assets.length} assets in ${m.categories.length} categories.`, 'ok');
        loggedRef.current = true;
      }
    } catch (e) {
      setLoadState('err');
      setLoadErr(e.message || String(e));
      log(`Asset Library: ${e.message || e}`, 'err');
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Close any open format menu when clicking anywhere outside a tile.
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('assetLibrary.previewFps');
      if (saved != null) setSeqPreviewFps(clampSeqFps(Number(saved)));
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('assetLibrary.previewFps', String(seqPreviewFps));
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

  // Group into sections — one per category in manifest order ("All" view),
  // or a single section when a category chip is active.
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

      {loadState === 'loading' && <div className="al-empty">loading library…</div>}
      {loadState === 'err' && (
        <div className="al-empty al-err">
          Failed to load library: {loadErr}. Did the first import run? (public/assetLibrary/manifest.json)
        </div>
      )}
      {loadState === 'ok' && visible.length === 0 && (
        <div className="al-empty">
          {assets.length === 0
            ? 'Library is empty — run the import routine (docs/ASSET_LIBRARY_IMPORT.md).'
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
        .al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem}
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
        .al-lb-inner{display:flex;gap:1.2rem;max-width:min(1100px,92vw);max-height:86vh;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem;align-items:center}
        .al-lb-img{max-width:60vw;max-height:80vh;object-fit:contain;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;border-radius:4px;min-width:0}
        .al-lb-loading{display:flex;align-items:center;justify-content:center;max-width:60vw;max-height:80vh;min-width:280px;min-height:280px;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;border-radius:4px;font-family:var(--font-mono);font-size:.72rem;color:var(--muted);padding:1rem;text-align:center}
        .al-lb-meta{display:flex;flex-direction:column;gap:.45rem;font-family:var(--font-mono);font-size:.7rem;color:var(--text);min-width:14rem;max-width:20rem}
        .al-lb-name{font-size:.85rem;font-weight:600;color:var(--accent2)}
        .al-speed-wrap{display:flex;flex-direction:column;gap:.35rem;padding:.5rem .55rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px}
        .al-speed-label{font-size:.64rem;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
        .al-speed-row{display:flex;align-items:center;gap:.45rem}
        .al-speed-input{width:4.6rem;padding:.28rem .4rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:.68rem}
        .al-speed-input:focus{outline:none;border-color:var(--accent)}
        .al-speed-unit{font-size:.64rem;color:var(--muted)}
        .al-speed-hint{font-size:.62rem;color:var(--muted)}
        @media (max-width: 980px){
          .al-bar{gap:.5rem}
          .al-seq-speed{width:100%;justify-content:flex-start}
        }
        .al-lb-lic a{color:var(--accent2)}
        .al-lb-close{margin-top:.6rem;align-self:flex-start;font-family:var(--font-mono);font-size:.68rem;padding:.4rem .8rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--muted);cursor:pointer}
        .al-lb-close:hover{color:var(--text);border-color:var(--accent2)}
      `}</style>
    </div>
  );
}
