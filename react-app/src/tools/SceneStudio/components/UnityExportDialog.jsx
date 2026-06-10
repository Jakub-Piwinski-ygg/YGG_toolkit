// UnityExportDialog — Phase 4.2 export-settings menu + runner.
// Per-category Unity import settings (compression, straight alpha), prefab
// variant, spine runtime GUIDs. Settings persist in localStorage so they
// are tuned once per team, not per export.

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_UNITY_SETTINGS, exportUnityPackage } from '../unity/exportUnityPackage.js';

const LS_KEY = 'ygg-toolkit:scene-unity-export:v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_UNITY_SETTINGS };
    return { ...DEFAULT_UNITY_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_UNITY_SETTINGS };
  }
}

const COMPRESSION_OPTIONS = [
  ['none', 'Uncompressed (default)'],
  ['normal', 'Compressed'],
  ['hq', 'Compressed HQ'],
  ['lq', 'Compressed LQ']
];

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};

const panelStyle = {
  width: 560, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto',
  background: 'var(--bg2, #15191f)', border: '1px solid var(--line, #2a313b)',
  borderRadius: 8, padding: '18px 20px', boxShadow: '0 18px 60px rgba(0,0,0,0.5)'
};

const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' };
const labelStyle = { width: 180, fontSize: 12, color: 'var(--muted, #8a93a3)', flexShrink: 0 };

function Row({ label, title, children }) {
  return (
    <div style={rowStyle} title={title}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

export function UnityExportDialog({ scene, rootHandle, sceneBasePath, onClose, log }) {
  const [settings, setSettings] = useState(loadSettings);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null); // { warnings, stats, fileName }
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* quota */ }
  }, [settings]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const set = (key) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setSettings((s) => ({ ...s, [key]: v }));
  };

  const hasSpine = scene.assets.some((a) => a.type === 'spine' && scene.layers.some((l) => l.assetId === a.id));
  const hasVideo = scene.assets.some((a) => a.type === 'video' && scene.layers.some((l) => l.assetId === a.id));
  const ui = settings.variant !== 'world';

  const runExport = async () => {
    setBusy(true);
    setResult(null);
    try {
      const out = await exportUnityPackage({
        scene, rootHandle, sceneBasePath,
        settings: { ...settings, packageName: settings.packageName || scene.name },
        onProgress: setProgress
      });
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = out.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setResult(out);
      log?.(`Scene Studio: exported ${out.fileName} (${out.stats.files} files, ${out.stats.canvases} canvas prefab${out.stats.canvases === 1 ? '' : 's'})`, 'ok');
      for (const w of out.warnings) log?.(`Unity export: ${w}`, 'warn');
    } catch (err) {
      console.error(err);
      log?.(`Unity export failed: ${err.message}`, 'err');
      setResult({ error: err.message, warnings: [], stats: null });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Export to Unity (.unitypackage)</strong>
          <div style={{ flex: 1 }} />
          <button className="scene-btn scene-btn--ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <Row label="Package / root folder" title="Becomes Assets/<name>/ inside the package">
          <input
            className="scene-toolbar-name" style={{ flex: 1 }}
            type="text" value={settings.packageName}
            placeholder={scene.name}
            onChange={set('packageName')}
          />
        </Row>

        <Row label="Prefab variant" title="UI: RectTransform + UI.Image + SkeletonGraphic (drop under a Canvas). World: SpriteRenderer + SkeletonAnimation.">
          <select className="scene-toolbar-select" value={settings.variant} onChange={set('variant')}>
            <option value="ui">UI canvas (Image + SkeletonGraphic)</option>
            <option value="world">World (SpriteRenderer + SkeletonAnimation)</option>
          </select>
        </Row>

        {!ui && (
          <Row label="Pixels per unit">
            <input className="scene-toolbar-name" style={{ width: 90 }} type="number" min="1"
              value={settings.pixelsPerUnit} onChange={(e) => set('pixelsPerUnit')(Number(e.target.value) || 100)} />
          </Row>
        )}

        <Row label="Bake fps" title="Timeline keyframes are baked at this rate (visually identical to the studio preview)">
          <select className="scene-toolbar-select" value={settings.bakeFps} onChange={(e) => set('bakeFps')(Number(e.target.value))}>
            <option value={15}>15</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </Row>

        <div style={{ borderTop: '1px solid var(--line, #2a313b)', margin: '12px 0 6px', paddingTop: 8, fontSize: 12, color: 'var(--muted, #8a93a3)' }}>
          Texture import settings (.meta)
        </div>

        <Row label="Static PNGs" title="Single sprite, straight alpha. Default: no compression.">
          <select className="scene-toolbar-select" value={settings.staticCompression} onChange={set('staticCompression')}>
            {COMPRESSION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>

        {hasSpine && (
          <Row label="Spine textures" title="Imported for the spine-unity runtime, straight alpha">
            <select className="scene-toolbar-select" value={settings.spineCompression} onChange={set('spineCompression')}>
              {COMPRESSION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
        )}

        <Row label="Alpha is transparency">
          <input type="checkbox" checked={settings.alphaIsTransparency} onChange={set('alphaIsTransparency')} />
        </Row>

        {hasVideo && (
          <Row label="Include videos">
            <input type="checkbox" checked={settings.includeVideos} onChange={set('includeVideos')} />
          </Row>
        )}

        {hasSpine && (
          <>
            <div style={{ borderTop: '1px solid var(--line, #2a313b)', margin: '12px 0 6px', paddingTop: 8, fontSize: 12, color: 'var(--muted, #8a93a3)' }}>
              Spine runtime script GUID — prefilled with the official spine-unity (4.x) value, which
              matches UPM and unitypackage installs. Only change it for a custom/forked runtime
              (copy <code>guid:</code> from the .cs.meta).
            </div>
            {ui ? (
              <Row label="SkeletonGraphic.cs guid">
                <input className="scene-toolbar-name" style={{ flex: 1, fontFamily: 'monospace' }} type="text"
                  value={settings.spineGraphicGuid} onChange={set('spineGraphicGuid')} placeholder="32 hex chars" />
              </Row>
            ) : (
              <Row label="SkeletonAnimation.cs guid">
                <input className="scene-toolbar-name" style={{ flex: 1, fontFamily: 'monospace' }} type="text"
                  value={settings.spineAnimationGuid} onChange={set('spineAnimationGuid')} placeholder="32 hex chars" />
              </Row>
            )}
          </>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted, #8a93a3)', margin: '10px 0' }}>
          The package contains: assets in a Unity scaffold with import-ready .meta files, one prefab per
          canvas (PlayableDirector + Animator + YggScenePlayer), a baked .anim of all object animation,
          and editor scripts — in Unity use the <em>Build Unity Timeline</em> button on the prefab to
          generate the TimelineAsset, then ▶ Play in play mode.
        </div>

        {result?.error && (
          <div style={{ color: '#ff7878', fontSize: 12, margin: '8px 0' }}>✗ {result.error}</div>
        )}
        {result && !result.error && (
          <div style={{ fontSize: 12, margin: '8px 0' }}>
            <div style={{ color: '#7dd87d' }}>✓ {result.fileName} downloaded ({result.stats.files} files, {result.stats.canvases} prefab{result.stats.canvases === 1 ? '' : 's'})</div>
            {result.warnings.map((w, i) => <div key={i} style={{ color: '#e8c468' }}>⚠ {w}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="scene-btn scene-btn--primary" onClick={runExport} disabled={busy}>
            {busy ? (progress || 'exporting…') : '⇪ Export .unitypackage'}
          </button>
          <button className="scene-btn" onClick={onClose} disabled={busy}>close</button>
        </div>
      </div>
    </div>
  );
}
