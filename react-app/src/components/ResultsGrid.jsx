import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext.jsx';
import { triggerDownload } from '../utils/download.js';

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

const ALT_FORMATS = [
  { id: 'png', label: 'PNG', args: [] },
  { id: 'webp', label: 'WebP', args: ['-quality', '100', '-define', 'webp:lossless=true'] },
  { id: 'jpg', label: 'JPG (flattened)', args: ['-background', 'white', '-flatten', '-quality', '95'] },
  { id: 'tga', label: 'TGA', args: [] },
  { id: 'bmp', label: 'BMP', args: [] }
];

function fmtBytes(n) {
  if (!(n >= 0)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function replaceExt(name, ext) {
  const base = (name || '').replace(/\.[^./\\]+$/, '');
  return `${base || 'output'}.${ext}`;
}

function triggerBlobDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 7000);
}

async function convertViaMagick(srcUrl, outName, extraArgs = []) {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const r = await window._Magick.Call(
    [{ name: 'input.png', content: bytes }],
    ['convert', 'input.png', ...extraArgs, outName]
  );
  if (!r || !r.length) throw new Error('no output from ImageMagick');
  return r[0].blob;
}

function ResultLightbox({ file, files, onNavigate, onClose, magickReady, log }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyFmt, setBusyFmt] = useState(null);
  const isImg = IMG_RE.test(file.name);
  const idx = files.findIndex((f) => f.name === file.name);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNavigate(1);
      else if (e.key === 'ArrowLeft') onNavigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate]);

  useEffect(() => {
    setMenuOpen(false);
    setBusyFmt(null);
  }, [file.name]);

  const downloadMain = () => triggerDownload(file.url, file.name);

  const downloadAlt = async (fmt) => {
    if (busyFmt) return;
    setBusyFmt(fmt.id);
    try {
      const blob = await convertViaMagick(file.url, `output.${fmt.id}`, fmt.args);
      triggerBlobDownload(blob, replaceExt(file.name, fmt.id));
      setMenuOpen(false);
    } catch (err) {
      log(`${file.name} → ${fmt.id}: ${err.message || err}`, 'err');
    } finally {
      setBusyFmt(null);
    }
  };

  return (
    <div className="rl-lightbox" onClick={onClose}>
      <div className="rl-inner" onClick={(e) => e.stopPropagation()}>
        <div className="rl-preview">
          {files.length > 1 && (
            <button type="button" className="rl-nav rl-nav-prev" title="Previous (←)" onClick={() => onNavigate(-1)}>‹</button>
          )}
          {isImg ? (
            <img className="rl-img" src={file.url} alt={file.name} />
          ) : (
            <div className="rl-noimg">
              <span className="rl-ext">{file.name.split('.').pop().toUpperCase()}</span>
              <span>no inline preview</span>
            </div>
          )}
          {files.length > 1 && (
            <button type="button" className="rl-nav rl-nav-next" title="Next (→)" onClick={() => onNavigate(1)}>›</button>
          )}
        </div>
        <div className="rl-meta">
          <div className="rl-name">{file.name}</div>
          <div className="rl-sub">
            {fmtBytes(file.blob?.size)}
            {files.length > 1 ? ` · ${idx + 1} / ${files.length}` : ''}
          </div>

          <div className="rl-dl-wrap">
            <div className="rl-dl-row">
              <button type="button" className="rl-dl-main" title="Download original output" onClick={downloadMain}>
                ⬇ DOWNLOAD
              </button>
              {isImg && (
                <button
                  type="button"
                  className="rl-dl-caret"
                  title="Download as another format"
                  onClick={() => setMenuOpen((v) => !v)}
                >▾</button>
              )}
            </div>
            {menuOpen && isImg && (
              <div className="rl-menu">
                {ALT_FORMATS.map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    className="rl-menu-item"
                    disabled={!magickReady || !!busyFmt}
                    title={magickReady ? `Convert → ${fmt.label} in your browser` : 'waiting for ImageMagick WASM…'}
                    onClick={() => downloadAlt(fmt)}
                  >
                    {busyFmt === fmt.id ? `${fmt.label} — converting…` : fmt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="rl-close" onClick={onClose}>✕ close (Esc)</button>
        </div>
      </div>

      <style>{`
        .rl-lightbox{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);padding:2rem}
        .rl-inner{display:flex;gap:1.1rem;width:min(1600px,96vw);height:90vh;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem;align-items:stretch}
        .rl-preview{position:relative;flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-width:0}
        .rl-img{width:100%;height:100%;object-fit:contain;background:repeating-conic-gradient(#262626 0% 25%,#1d1d1d 0% 50%) 0 0/16px 16px;border-radius:4px;min-width:0}
        .rl-noimg{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;width:100%;height:100%;background:var(--surface2);border-radius:4px;font-family:var(--font-mono);font-size:.72rem;color:var(--muted)}
        .rl-ext{font-size:1.3rem;font-weight:700;color:var(--accent2)}
        .rl-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:2.2rem;height:2.2rem;border-radius:50%;background:rgba(0,0,0,.55);border:1px solid var(--border);color:#fff;font-size:1.4rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .rl-nav:hover{background:rgba(0,0,0,.8);border-color:var(--accent2)}
        .rl-nav-prev{left:.4rem}
        .rl-nav-next{right:.4rem}
        .rl-meta{display:flex;flex-direction:column;gap:.55rem;font-family:var(--font-mono);font-size:.7rem;color:var(--text);width:min(340px,30vw)}
        .rl-name{font-size:.85rem;font-weight:600;color:var(--accent2);word-break:break-all}
        .rl-sub{color:var(--muted)}
        .rl-dl-wrap{display:flex;flex-direction:column;gap:.4rem;align-self:flex-start;max-width:100%;margin-top:.3rem}
        .rl-dl-row{display:flex;gap:1px;align-self:flex-start}
        .rl-dl-main{font-family:var(--font-mono);font-size:.7rem;font-weight:600;padding:.45rem .85rem;background:#2ea043;color:#fff;border:0;border-radius:4px 0 0 4px;cursor:pointer}
        .rl-dl-main:hover{background:#3fb950}
        .rl-dl-caret{font-family:var(--font-mono);font-size:.7rem;padding:.45rem .55rem;background:#26863a;color:#fff;border:0;border-radius:0 4px 4px 0;cursor:pointer}
        .rl-dl-caret:hover{background:#3fb950}
        .rl-menu{display:flex;flex-direction:column;min-width:12rem;background:var(--surface);border:1px solid var(--border);border-radius:5px;overflow:hidden}
        .rl-menu-item{font-family:var(--font-mono);font-size:.66rem;text-align:left;padding:.45rem .7rem;background:transparent;border:0;border-bottom:1px solid var(--border);color:var(--text);cursor:pointer}
        .rl-menu-item:last-child{border-bottom:0}
        .rl-menu-item:hover:not(:disabled){background:var(--surface2);color:var(--accent2)}
        .rl-menu-item:disabled{opacity:.45;cursor:default}
        .rl-close{margin-top:auto;align-self:flex-start;font-family:var(--font-mono);font-size:.68rem;padding:.4rem .8rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--muted);cursor:pointer}
        .rl-close:hover{color:var(--text);border-color:var(--accent2)}
        @media (max-width: 1100px){
          .rl-inner{flex-direction:column;height:auto;max-height:92vh;overflow:auto;padding:.85rem}
          .rl-preview{width:100%;height:60vh;flex:0 0 auto}
          .rl-img,.rl-noimg{width:100%;height:100%;max-height:60vh}
          .rl-meta{width:100%}
          .rl-close{margin-top:.4rem}
        }
      `}</style>
    </div>
  );
}

export function ResultsGrid() {
  const { outputFiles, magickReady, log } = useApp();
  const [lightbox, setLightbox] = useState(null);

  // Keep the open lightbox pointing at a still-present file (outputs can be
  // cleared or promoted while it's open).
  useEffect(() => {
    if (lightbox && !outputFiles.some((f) => f.name === lightbox.name)) {
      setLightbox(null);
    }
  }, [outputFiles, lightbox]);

  if (!outputFiles.length) {
    return <div className="empty-state">processed images will appear here</div>;
  }

  const navigate = (dir) => {
    if (!lightbox) return;
    const idx = outputFiles.findIndex((f) => f.name === lightbox.name);
    if (idx === -1) return;
    const next = (idx + dir + outputFiles.length) % outputFiles.length;
    setLightbox(outputFiles[next]);
  };

  return (
    <div className="results-grid">
      <AnimatePresence initial={false}>
        {outputFiles.map((f) => {
          const isImg = IMG_RE.test(f.name);
          return (
            <motion.div
              key={f.name}
              className="result-card"
              onClick={() => setLightbox(f)}
              title="Click to preview"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18 }}
            >
              {isImg ? (
                <img src={f.url} alt={f.name} loading="lazy" />
              ) : (
                <div className="result-non-image">
                  <span className="result-ext">{f.name.split('.').pop().toUpperCase()}</span>
                  <span className="result-hint">click to preview</span>
                </div>
              )}
              <div className="rc-label">{f.name}</div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {lightbox && (
        <ResultLightbox
          file={lightbox}
          files={outputFiles}
          onNavigate={navigate}
          onClose={() => setLightbox(null)}
          magickReady={magickReady}
          log={log}
        />
      )}
    </div>
  );
}
