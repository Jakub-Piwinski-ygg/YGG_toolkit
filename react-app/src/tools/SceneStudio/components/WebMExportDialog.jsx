// WebMExportDialog — render a chosen timeline or scenario to a video file.
//
// Deterministic, opaque capture: PixiViewport.exportVideo() drives the scene
// frame-by-frame (0 → duration) at native stage resolution. WebM and (where the
// browser supports it) MP4 record via MediaRecorder; MP4 on Chrome/Firefox
// falls back to ffmpeg.wasm. Settings persist in localStorage.

import { useEffect, useMemo, useRef, useState } from 'react';
import { pickWebmMime, pickVideoMime } from '../engine/webmExport.js';
import { ColorPicker } from '../../../components/ColorPicker.jsx';

const LS_KEY = 'ygg-toolkit:scene-webm-export:v2';

// WebM bitrate presets (videoBitsPerSecond) and the MP4 ffmpeg CRF they map to.
const QUALITY_OPTIONS = [
  ['high', 'High', 16_000_000, 18],
  ['medium', 'Medium', 8_000_000, 22],
  ['low', 'Low', 4_000_000, 26]
];

const FORMAT_OPTIONS = [['webm', 'WebM (VP9/VP8)'], ['mp4', 'MP4 (H.264)']];
const FPS_OPTIONS = [15, 24, 30, 60];
const SCALE_OPTIONS = [[1, '100% (native)'], [0.5, '50%'], [0.25, '25%']];

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};
const panelStyle = {
  width: 480, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto',
  background: 'var(--bg2, #15191f)', border: '1px solid var(--line, #2a313b)',
  borderRadius: 8, padding: '18px 20px', boxShadow: '0 18px 60px rgba(0,0,0,0.5)'
};
// T11 "watch the render" mode: exportVideo() drives the SAME live canvas the
// editor shows (PixiViewport.exportVideo resizes/renders onto app.canvas
// in place — see its "enter export mode" block) — the render was never
// actually hidden, only BURIED behind this dialog's full-screen opaque
// overlay. While watching, shrink the dialog to a small non-blocking HUD
// pinned in a corner instead of a fullscreen scrim, so the scene view (and
// its live capture) is unobstructed. Settings stay locked during export
// either way — only the overlay's shape/position changes.
const watchOverlayStyle = {
  position: 'fixed', top: 16, right: 16, zIndex: 1000,
  background: 'transparent', pointerEvents: 'none',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end'
};
const watchPanelStyle = {
  width: 280, maxWidth: '80vw',
  background: 'var(--bg2, #15191f)', border: '1px solid var(--line, #2a313b)',
  borderRadius: 8, padding: '10px 14px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
  pointerEvents: 'auto'
};
const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' };
const labelStyle = { width: 150, fontSize: 12, color: 'var(--muted, #8a93a3)', flexShrink: 0 };

function Row({ label, title, children }) {
  return (
    <div style={rowStyle} title={title}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

export function WebMExportDialog({ scene, viewportRef, sources, makeFrameProvider, onClose, log }) {
  const stage = scene.stage.orientations[scene.stage.activeOrientation];
  const saved = loadSettings();

  // Flatten the source options (timelines, then scenarios). Default to the
  // active timeline so a plain "export" still does the obvious thing.
  const sourceList = useMemo(() => {
    const tls = sources?.timelines || [];
    const scs = sources?.scenarios || [];
    return [
      ...tls.map((t) => ({ ...t, key: `timeline:${t.id}`, group: 'Timeline' })),
      ...scs.map((s) => ({ ...s, key: `scenario:${s.id}`, group: 'Scenario' }))
    ];
  }, [sources]);

  const defaultSourceKey = useMemo(() => {
    const active = (sources?.timelines || []).find((t) => t.id === scene.activeTimelineId);
    return active ? `timeline:${active.id}` : (sourceList[0]?.key || '');
  }, [sources, scene.activeTimelineId, sourceList]);

  const [sourceKey, setSourceKey] = useState(saved.sourceKey && sourceList.some((s) => s.key === saved.sourceKey) ? saved.sourceKey : defaultSourceKey);
  useEffect(() => {
    if (!sourceList.some((s) => s.key === sourceKey)) setSourceKey(defaultSourceKey);
  }, [sourceList, sourceKey, defaultSourceKey]);
  const source = sourceList.find((s) => s.key === sourceKey) || sourceList[0] || null;

  const [format, setFormat] = useState(FORMAT_OPTIONS.some(([v]) => v === saved.format) ? saved.format : 'webm');
  const [fps, setFps] = useState(saved.fps || scene.stage?.fps || 30);
  const [quality, setQuality] = useState(saved.quality || 'high');
  const [scale, setScale] = useState(saved.scale || 1);
  const [bg, setBg] = useState(saved.bg || '#000000');
  // T11: default ON — exportVideo() already renders onto the live viewport
  // canvas in place, so "watching" just means not burying it behind this
  // dialog's full-screen overlay while it plays.
  const [watchRender, setWatchRender] = useState(saved.watchRender !== false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { frame, total, phase? }
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const webmSupported = !!pickWebmMime();
  const mp4Native = !!pickVideoMime('mp4');
  const supported = format === 'webm' ? webmSupported : true; // mp4 always has the ffmpeg fallback

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ sourceKey, format, fps, quality, scale, bg, watchRender })); } catch { /* quota */ }
  }, [sourceKey, format, fps, quality, scale, bg, watchRender]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const dur = Math.max(0.1, source?.duration || scene.stage?.duration || 5);
  const outW = Math.max(2, Math.round(stage.w * Number(scale)));
  const outH = Math.max(2, Math.round(stage.h * Number(scale)));
  const totalFrames = Math.max(1, Math.ceil(dur * Number(fps)));

  const runExport = async () => {
    if (!source) { setResult({ error: 'Pick something to export.' }); return; }
    setBusy(true);
    setResult(null);
    setProgress({ frame: 0, total: totalFrames });
    const signal = { aborted: false };
    abortRef.current = signal;
    try {
      const preset = QUALITY_OPTIONS.find((q) => q[0] === quality) || QUALITY_OPTIONS[0];
      const out = await viewportRef.current?.exportVideo({
        format,
        fps: Number(fps),
        durationSec: dur,
        scale: Number(scale),
        backgroundColor: parseInt(bg.slice(1), 16) || 0,
        bitrate: preset[2],
        crf: preset[3],
        frameProvider: makeFrameProvider?.(source),
        onProgress: setProgress,
        signal
      });
      if (!out) throw new Error('Export unavailable — the viewport is not ready.');
      const ext = out.format === 'mp4' ? 'mp4' : 'webm';
      const base = `${(scene.name || 'scene')}_${source.name}`.replace(/[^\w.-]+/g, '_');
      const fileName = `${base}.${ext}`;
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const mb = (out.blob.size / 1048576).toFixed(1);
      setResult({ fileName, mb, ...out });
      log?.(`Scene Studio: exported ${fileName} (${out.width}×${out.height}, ${out.frames} frames @ ${out.fps}fps, ${mb} MB)`, 'ok');
    } catch (err) {
      if (err?.message === 'cancelled') {
        log?.('Video export cancelled', 'warn');
      } else {
        console.error(err);
        log?.(`Video export failed: ${err.message}`, 'err');
        setResult({ error: err.message });
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancel = () => { if (abortRef.current) abortRef.current.aborted = true; };
  const pct = progress && progress.total ? Math.round((progress.frame / progress.total) * 100) : 0;

  // T11: while exporting with "watch the render" on, don't bury the live
  // canvas behind the full settings dialog — show a small non-blocking HUD
  // with the same progress readout instead. Settings are locked during
  // export regardless, so nothing here needs to differ except the shell.
  if (busy && watchRender) {
    return (
      <div style={watchOverlayStyle}>
        <div style={watchPanelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>Rendering {source?.name || 'video'}…</strong>
          </div>
          <div style={{ height: 6, background: 'var(--line, #2a313b)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent, #4f9eff)', transition: 'width .1s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', marginTop: 4 }}>
            {progress?.phase ? `${progress.phase} — ` : ''}frame {progress?.frame ?? 0} / {progress?.total ?? totalFrames} ({pct}%)
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="scene-btn scene-btn--sm" onClick={cancel}>cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Export video</strong>
          <div style={{ flex: 1 }} />
          <button className="scene-btn scene-btn--ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <Row label="Source" title="Which timeline or scenario to render">
          <select className="scene-toolbar-select" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} disabled={busy}>
            {!sourceList.length && <option value="">— nothing to export —</option>}
            {(sources?.timelines || []).length > 0 && (
              <optgroup label="Timelines">
                {sources.timelines.map((t) => (
                  <option key={`timeline:${t.id}`} value={`timeline:${t.id}`}>{t.name} ({t.duration.toFixed(2)}s)</option>
                ))}
              </optgroup>
            )}
            {(sources?.scenarios || []).length > 0 && (
              <optgroup label="Scenarios">
                {sources.scenarios.map((s) => (
                  <option key={`scenario:${s.id}`} value={`scenario:${s.id}`} disabled={!s.ok}>
                    {s.name}{s.ok ? ` (${s.duration.toFixed(2)}s)` : ' — invalid'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Row>

        <Row label="Format" title="Container & codec">
          <select className="scene-toolbar-select" value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>
            {FORMAT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>

        <Row label="Frame rate" title="Frames rendered per second of timeline">
          <select className="scene-toolbar-select" value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={busy}>
            {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
        </Row>

        <Row label="Quality" title={format === 'mp4' ? 'x264 CRF (lower = larger/better)' : 'Target video bitrate'}>
          <select className="scene-toolbar-select" value={quality} onChange={(e) => setQuality(e.target.value)} disabled={busy}>
            {QUALITY_OPTIONS.map(([v, l, br, crf]) => (
              <option key={v} value={v}>{l}{format === 'mp4' ? ` (CRF ${crf})` : ` (~${(br / 1_000_000)} Mbps)`}</option>
            ))}
          </select>
        </Row>

        <Row label="Resolution" title="Output size relative to the stage resolution">
          <select className="scene-toolbar-select" value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={busy}>
            {SCALE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>

        <Row label="Background" title="Output is opaque — choose the fill behind transparent areas">
          <ColorPicker value={bg} onChange={setBg} disabled={busy} title="Background fill" />
        </Row>

        <Row label="Watch the render" title="Exporting drives the same live scene view you already see — this just stops the export dialog from covering it while it plays">
          <label className="scene-field scene-field--check" style={{ margin: 0 }}>
            <input type="checkbox" checked={watchRender} onChange={(e) => setWatchRender(e.target.checked)} disabled={busy} />
            <span>show the scene view while exporting</span>
          </label>
        </Row>

        <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', margin: '10px 0' }}>
          Renders <strong>{source ? source.name : '—'}</strong> (0 → {dur.toFixed(2)}s) of the {scene.stage.activeOrientation} stage.
          Output: <strong>{outW}×{outH}</strong>, {totalFrames} frames. Opaque background.
          {format === 'mp4' && !mp4Native && ' MP4 uses ffmpeg.wasm (first run downloads the encoder from CDN).'}
          {format === 'webm' && !webmSupported && ' This browser can’t record WebM — try MP4 or use Chrome/Firefox.'}
        </div>

        {progress && (
          <div style={{ margin: '10px 0' }}>
            <div style={{ height: 6, background: 'var(--line, #2a313b)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent, #4f9eff)', transition: 'width .1s' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', marginTop: 4 }}>
              {progress.phase ? `${progress.phase} — ` : ''}frame {progress.frame} / {progress.total} ({pct}%)
            </div>
          </div>
        )}

        {result?.error && (
          <div style={{ color: '#ff7878', fontSize: 12, margin: '8px 0' }}>✗ {result.error}</div>
        )}
        {result && !result.error && (
          <div style={{ color: '#7dd87d', fontSize: 12, margin: '8px 0' }}>
            ✓ {result.fileName} downloaded ({result.width}×{result.height}, {result.frames} frames, {result.mb} MB)
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          {busy ? (
            <button className="scene-btn" onClick={cancel}>cancel</button>
          ) : (
            <button
              className="scene-btn scene-btn--primary"
              onClick={runExport}
              disabled={!scene.layers.length || !source || !supported}
              title={!scene.layers.length ? 'Add a layer first' : (!source ? 'Nothing to export' : '')}
            >▶ Export {format === 'mp4' ? '.mp4' : '.webm'}</button>
          )}
          <button className="scene-btn" onClick={onClose} disabled={busy}>close</button>
        </div>
      </div>
    </div>
  );
}
