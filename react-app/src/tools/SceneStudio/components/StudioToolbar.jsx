// StudioToolbar — top strip with scene name, save/load, project root pick,
// orientation toggle.

import { isFsAccessSupported } from '../engine/persist.js';

export function StudioToolbar({
  scene,
  onRename,
  rootHandle,
  onPickRoot,
  onPickFolderFallback,
  onClearRoot,
  onSave,
  onLoad,
  onToggleOrientation,
  livePreview = true,
  onToggleLivePreview,
  busy,
  rootDropSupported = false,
  rootDropHover = false,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop
}) {
  const supported = isFsAccessSupported();
  const handleFallbackInput = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) onPickFolderFallback?.(files);
  };
  return (
    <div className="scene-toolbar">
      <input
        className="scene-toolbar-name"
        type="text"
        value={scene.name}
        onChange={(e) => onRename(e.target.value)}
        placeholder="scene name"
      />
      <div className="scene-toolbar-spacer" />

      <span className="scene-toolbar-tag">
        {scene.stage.activeOrientation === 'landscape'
          ? `${scene.stage.orientations.landscape.w}×${scene.stage.orientations.landscape.h}`
          : `${scene.stage.orientations.portrait.w}×${scene.stage.orientations.portrait.h}`}
      </span>
      <button className="scene-btn" onClick={onToggleOrientation} title="Switch orientation">
        {scene.stage.activeOrientation === 'landscape' ? '▭ landscape' : '▯ portrait'}
      </button>

      <button
        className={'scene-btn' + (livePreview ? ' scene-btn--primary' : '')}
        onClick={onToggleLivePreview}
        title={livePreview
          ? 'Live preview ON — Spine animations + video play continuously. Click to freeze.'
          : 'Live preview OFF — Spine animations are paused. Click to resume.'}
      >
        {livePreview ? '● live' : '◯ frozen'}
      </button>

      <div className="scene-toolbar-divider" />

      {rootHandle ? (
        <>
          <span
            className={'scene-toolbar-tag scene-root-drop-target' + (rootDropHover ? ' active' : '')}
            title="Drop folder here to replace linked root"
            onDragOver={onRootDragOver}
            onDragLeave={onRootDragLeave}
            onDrop={onRootDrop}
          >
            📁 {rootHandle.name}{rootHandle.writable === false ? ' (read-only)' : ''}
          </span>
          <button className="scene-btn scene-btn--ghost" onClick={onClearRoot} title="Unlink project folder">✕</button>
        </>
      ) : (
        <div
          className={'scene-root-drop-slot' + (rootDropHover ? ' active' : '')}
          onDragOver={onRootDragOver}
          onDragLeave={onRootDragLeave}
          onDrop={onRootDrop}
          title="Drop project folder here"
        >
          {supported ? (
            <button className="scene-btn" onClick={onPickRoot} title="Pick the Unity project folder">
              📁 pick project root
            </button>
          ) : (
            <label className="scene-btn" title="Pick a project folder (Firefox / Safari read-only fallback)">
              <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                style={{ display: 'none' }}
                onChange={handleFallbackInput}
                disabled={busy}
              />
              📁 pick project root
            </label>
          )}
          <span className="scene-root-drop-hint">or drop folder</span>
        </div>
      )}

      {!rootHandle && (
        <span
          className="scene-toolbar-tag"
          title={supported
            ? 'Tip: drag a project folder from Explorer onto the folder slot or the Assets panel.'
            : 'Firefox / Safari fallback: workspace opens read-only (folder picked via webkitdirectory). scene.json saves are downloaded.'}
        >
          {supported ? 'drop on folder slot' : 'read-only workspace (Firefox / Safari)'}
        </span>
      )}

      <button className="scene-btn" onClick={onLoad} disabled={busy}>open…</button>
      <button className="scene-btn scene-btn--primary" onClick={onSave} disabled={busy}>save</button>
    </div>
  );
}
