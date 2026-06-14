// WebMExportDialog — render the active timeline to a .webm video.
//
// Deterministic, opaque capture: PixiViewport.exportWebM() drives the scene
// frame-by-frame (0 → duration) at native stage resolution and records it via
// MediaRecorder. Settings persist in localStorage so they're tuned once.

import { useEffect, useRef, useState } from 'react';
import { pickWebmMime } from '../engine/webmExport.js';

const LS_KEY = 'ygg-toolkit:scene-webm-export:v1';

const QUALITY_OPTIONS = [
  ['high', 'High (~16 Mbps)', 16_000_000],
  ['medium', 'Medium (~8 Mbps)', 8_000_000],
  ['low', 'Low (~4 Mbps)', 4_000_000]
];

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

export function WebMExportDialog({ scene, viewportRef, onClose, log }) {
  const stage = scene.stage.orientations[scene.stage.activeOrientation];
  const stageDur = scene.stage?.duration || 5;
  const saved = loadSettings();

  const [fps, setFps] = useState(saved.fps || scene.stage?.fps || 30);
  const [quality, setQuality] = useState(saved.quality || 'high');
  const [scale, setScale] = useState(saved.scale || 1);
  const [bg, setBg] = useState(saved.bg || '#000000');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { frame, total }
  const [result, setResult] = useState(null);      // { fileName, ... } | { error }
  const abortRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const supported = !!pickWebmMime();

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ fps, quality, scale, bg })); } catch { /* quota */ }
  }, [fps, quality, scale, bg]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const outW = Math.max(2, Math.round(stage.w * Number(scale)));
  const outH = Math.max(2, Math.round(stage.h * Number(scale)));
  const totalFrames = Math.max(1, Math.ceil(stageDur * Number(fps)));

  const runExport = async () => {
    setBusy(true);
    setResult(null);
    setProgress({ frame: 0, total: totalFrames });
    const signal = { aborted: false };
    abortRef.current = signal;
    try {
      const bitrate = (QUALITY_OPTIONS.find((q) => q[0] === quality) || [])[2];
      const out = await viewportRef.current?.exportWebM({
        fps: Number(fps),
        durationSec: stageDur,
        scale: Number(scale),
        backgroundColor: parseInt(bg.slice(1), 16) || 0,
        bitrate,
        onProgress: setProgress,
        signal
      });
      if (!out) throw new Error('Export unavailable — the viewport is not ready.');
      const fileName = `${(scene.name || 'scene').replace(/[^\w.-]+/g, '_')}.webm`;
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
        log?.('WebM export cancelled', 'warn');
      } else {
        console.error(err);
        log?.(`WebM export failed: ${err.message}`, 'err');
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

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Export WebM video</strong>
          <div style={{ flex: 1 }} />
          <button className="scene-btn scene-btn--ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>

        {!supported ? (
          <div style={{ color: '#ff7878', fontSize: 12, margin: '8px 0' }}>
            This browser can't record WebM. Use Chrome or Firefox.
          </div>
        ) : (
          <>
            <Row label="Frame rate" title="Frames rendered per second of timeline">
              <select className="scene-toolbar-select" value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={busy}>
                {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </Row>

            <Row label="Quality" title="Target video bitrate">
              <select className="scene-toolbar-select" value={quality} onChange={(e) => setQuality(e.target.value)} disabled={busy}>
                {QUALITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>

            <Row label="Resolution" title="Output size relative to the stage resolution">
              <select className="scene-toolbar-select" value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={busy}>
                {SCALE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>

            <Row label="Background" title="WebM is opaque — choose the fill behind transparent areas">
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} disabled={busy} style={{ width: 48, height: 28, padding: 0, border: 'none', background: 'none' }} />
            </Row>

            <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', margin: '10px 0' }}>
              Renders the active timeline (0 → {stageDur.toFixed(2)}s) of the {scene.stage.activeOrientation} stage.
              Output: <strong>{outW}×{outH}</strong>, {totalFrames} frames. Opaque background
              (transparency isn't preserved). Spine, spinner and PNG layers are captured;
              video layers may not be frame-accurate.
            </div>

            {progress && (
              <div style={{ margin: '10px 0' }}>
                <div style={{ height: 6, background: 'var(--line, #2a313b)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent, #4f9eff)', transition: 'width .1s' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', marginTop: 4 }}>
                  rendering frame {progress.frame} / {progress.total} ({pct}%)
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
                  disabled={!scene.layers.length}
                  title={scene.layers.length ? '' : 'Add a layer first'}
                >▶ Export .webm</button>
              )}
              <button className="scene-btn" onClick={onClose} disabled={busy}>close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
