import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const converterMeta = {
  id: 'converter',
  label: 'Convert',
  small: 'image & video → image',
  icon: '🔄',
  needsMagick: false,
  batchMode: true,
  desc: 'Convert images between PNG / JPG / WebP using the browser\'s native canvas encoder. WebM and MP4 inputs are decoded via <video> — pick frames by normalized time (0–1) or by frame index (requires FPS).'
};

const STILL_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const VIDEO_RE = /\.(webm|mp4|mov|m4v)$/i;

const FORMATS = {
  png:  { mime: 'image/png',  ext: 'png',  lossy: false },
  jpg:  { mime: 'image/jpeg', ext: 'jpg',  lossy: true },
  webp: { mime: 'image/webp', ext: 'webp', lossy: true }
};

function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? name : name.slice(0, i);
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`toBlob(${mime}) failed`))),
      mime,
      quality
    );
  });
}

async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode failed'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function openVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = url;
  await new Promise((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error('video load failed'));
  });
  // Some browsers need a play+pause to get the first frame painted reliably.
  try { await v.play(); v.pause(); } catch { /* fine if it throws */ }
  return { video: v, url };
}

function seekVideo(video, t) {
  return new Promise((resolve, reject) => {
    const onSeek = () => { video.removeEventListener('seeked', onSeek); resolve(); };
    const onErr = () => { video.removeEventListener('error', onErr); reject(new Error('seek failed')); };
    video.addEventListener('seeked', onSeek);
    video.addEventListener('error', onErr);
    // Nudge by a tiny epsilon if we're already at the requested time so 'seeked' fires.
    const target = Math.max(0, Math.min(video.duration || 0, t));
    video.currentTime = Math.abs(video.currentTime - target) < 1e-6 ? target + 1e-3 : target;
  });
}

async function grabFrame(video, t) {
  await seekVideo(video, t);
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

function buildFrameTimes(opts, duration) {
  const { extractMode, addressing, fps, time, frame, count, startN, endN, startF, endF, step } = opts;

  const toTime = (idx) => Math.max(0, Math.min(duration, idx / fps));
  const clampN = (n) => Math.max(0, Math.min(1, n)) * duration;

  if (extractMode === 'single') {
    if (addressing === 'normalized') return [{ t: clampN(time), label: `t${time.toFixed(3)}` }];
    return [{ t: toTime(frame), label: `f${frame}` }];
  }

  // multiple
  if (addressing === 'normalized') {
    const n = Math.max(1, Math.floor(count));
    const a = Math.max(0, Math.min(1, startN));
    const b = Math.max(0, Math.min(1, endN));
    if (n === 1) return [{ t: clampN(a), label: `t${a.toFixed(3)}` }];
    const out = [];
    for (let i = 0; i < n; i++) {
      const norm = a + (b - a) * (i / (n - 1));
      out.push({ t: clampN(norm), label: `t${norm.toFixed(3)}` });
    }
    return out;
  }
  // multiple + frame index — range with step
  const s = Math.max(0, Math.floor(startF));
  const e = Math.max(s, Math.floor(endF));
  const st = Math.max(1, Math.floor(step));
  const out = [];
  for (let f = s; f <= e; f += st) out.push({ t: toTime(f), label: `f${f}` });
  return out;
}

export function ConverterTool() {
  const { inputFiles, registerRunner, log, setProgressLabel } = useApp();

  const [format, setFormat] = useState('webp');
  const [quality, setQuality] = useState(90);
  const [lossless, setLossless] = useState(false);

  const [extractMode, setExtractMode] = useState('multiple'); // single | multiple
  const [addressing, setAddressing] = useState('normalized'); // normalized | frame
  const [fps, setFps] = useState(30);

  // Single-frame inputs
  const [time, setTime] = useState(0.5);
  const [frame, setFrame] = useState(0);

  // Multiple-frame inputs
  const [count, setCount] = useState(10);
  const [startN, setStartN] = useState(0.0);
  const [endN, setEndN] = useState(1.0);
  const [startF, setStartF] = useState(0);
  const [endF, setEndF] = useState(60);
  const [step, setStep] = useState(1);

  const hasVideo = useMemo(
    () => inputFiles.some((f) => VIDEO_RE.test(f.name)),
    [inputFiles]
  );

  const settingsRef = useRef({});
  settingsRef.current = {
    format, quality, lossless,
    extractMode, addressing, fps,
    time, frame, count, startN, endN, startF, endF, step
  };

  useEffect(() => {
    registerRunner(converterMeta.id, {
      outName: () => 'converted',
      run: async (_u, _n, _f, allFiles) => {
        const s = settingsRef.current;
        const fmt = FORMATS[s.format] || FORMATS.png;
        const q = fmt.mime === 'image/webp' && s.lossless ? 1.0 : s.quality / 100;
        const outputs = [];

        for (let i = 0; i < allFiles.length; i++) {
          const { name, file } = allFiles[i];
          setProgressLabel(`${i + 1} / ${allFiles.length} — ${name}`);

          if (VIDEO_RE.test(name)) {
            let openedUrl = null;
            let video = null;
            try {
              const r = await openVideo(file);
              video = r.video; openedUrl = r.url;
              const times = buildFrameTimes(s, video.duration);
              if (!times.length) {
                log(`✗ ${name}: no frames selected`, 'err');
                continue;
              }
              for (const { t, label } of times) {
                try {
                  const canvas = await grabFrame(video, t);
                  const blob = await canvasToBlob(canvas, fmt.mime, q);
                  outputs.push({ name: `${stripExt(name)}_${label}.${fmt.ext}`, blob });
                } catch (e) {
                  log(`✗ ${name} @ ${label}: ${e.message || e}`, 'err');
                }
              }
            } catch (e) {
              log(`✗ ${name}: ${e.message || e}`, 'err');
            } finally {
              if (video) { video.removeAttribute('src'); video.load?.(); }
              if (openedUrl) URL.revokeObjectURL(openedUrl);
            }
          } else if (STILL_RE.test(name)) {
            try {
              const canvas = await decodeImage(file);
              const blob = await canvasToBlob(canvas, fmt.mime, q);
              outputs.push({ name: `${stripExt(name)}.${fmt.ext}`, blob });
            } catch (e) {
              log(`✗ ${name}: ${e.message || e}`, 'err');
            }
          } else {
            log(`✗ ${name}: unsupported input format`, 'err');
          }
        }
        return outputs;
      }
    });
    return () => registerRunner(converterMeta.id, null);
  }, [registerRunner, log, setProgressLabel]);

  const fmt = FORMATS[format];
  const showQuality = fmt.lossy && !(format === 'webp' && lossless);

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Output format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="png">PNG (lossless)</option>
            <option value="jpg">JPG (lossy, no alpha)</option>
            <option value="webp">WebP</option>
          </select>
        </div>
        {format === 'webp' && (
          <div className="field">
            <label>Mode</label>
            <select value={lossless ? '1' : '0'} onChange={(e) => setLossless(e.target.value === '1')}>
              <option value="0">Lossy (smaller file)</option>
              <option value="1">Lossless (max quality)</option>
            </select>
          </div>
        )}
      </div>

      {showQuality && (
        <div className="field-row">
          <div className="field">
            <label>Quality — <span style={{ color: 'var(--accent)' }}>{quality}</span></label>
            <input type="range" min="1" max="100" value={quality} onChange={(e) => setQuality(+e.target.value)} />
          </div>
        </div>
      )}

      {hasVideo && (
        <>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: '.7rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Video frame extraction
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Frames</label>
              <select value={extractMode} onChange={(e) => setExtractMode(e.target.value)}>
                <option value="single">Single frame</option>
                <option value="multiple">Multiple frames</option>
              </select>
            </div>
            <div className="field">
              <label>Address by</label>
              <select value={addressing} onChange={(e) => setAddressing(e.target.value)}>
                <option value="normalized">Normalized time (0–1)</option>
                <option value="frame">Frame index</option>
              </select>
            </div>
          </div>

          {addressing === 'frame' && (
            <div className="field-row">
              <div className="field">
                <label>FPS</label>
                <input type="number" min="1" step="1" value={fps} onChange={(e) => setFps(+e.target.value || 1)} />
              </div>
            </div>
          )}

          {extractMode === 'single' && addressing === 'normalized' && (
            <div className="field-row">
              <div className="field">
                <label>Time — <span style={{ color: 'var(--accent)' }}>{time.toFixed(3)}</span></label>
                <input type="range" min="0" max="1" step="0.001" value={time} onChange={(e) => setTime(+e.target.value)} />
              </div>
            </div>
          )}
          {extractMode === 'single' && addressing === 'frame' && (
            <div className="field-row">
              <div className="field">
                <label>Frame</label>
                <input type="number" min="0" step="1" value={frame} onChange={(e) => setFrame(+e.target.value || 0)} />
              </div>
            </div>
          )}

          {extractMode === 'multiple' && addressing === 'normalized' && (
            <div className="field-row">
              <div className="field">
                <label>Count</label>
                <input type="number" min="1" step="1" value={count} onChange={(e) => setCount(+e.target.value || 1)} />
              </div>
              <div className="field">
                <label>Start (0–1)</label>
                <input type="number" min="0" max="1" step="0.01" value={startN} onChange={(e) => setStartN(+e.target.value || 0)} />
              </div>
              <div className="field">
                <label>End (0–1)</label>
                <input type="number" min="0" max="1" step="0.01" value={endN} onChange={(e) => setEndN(+e.target.value || 0)} />
              </div>
            </div>
          )}
          {extractMode === 'multiple' && addressing === 'frame' && (
            <div className="field-row">
              <div className="field">
                <label>Start frame</label>
                <input type="number" min="0" step="1" value={startF} onChange={(e) => setStartF(+e.target.value || 0)} />
              </div>
              <div className="field">
                <label>End frame</label>
                <input type="number" min="0" step="1" value={endF} onChange={(e) => setEndF(+e.target.value || 0)} />
              </div>
              <div className="field">
                <label>Step</label>
                <input type="number" min="1" step="1" value={step} onChange={(e) => setStep(+e.target.value || 1)} />
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
