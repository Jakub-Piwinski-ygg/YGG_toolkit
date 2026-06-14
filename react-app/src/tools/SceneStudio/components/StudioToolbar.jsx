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
  onNewProject,
  projectScenes = [],
  activeSceneId = null,
  onSelectScene,
  onNewScene,
  onNewVariant,
  onToggleOrientation,
  overlayMode = 'behind',
  onSetOverlayMode,
  defaultEase = 'auto',
  onSetDefaultEase,
  livePreview = true,
  onToggleLivePreview,
  studioMode = 'animate',
  onSetStudioMode,
  busy,
  rootDropSupported = false,
  rootDropHover = false,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onUnityExport,
  onWebMExport,
  onAddSpinner
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
      <select
        className="scene-toolbar-select scene-scene-picker"
        value={activeSceneId && projectScenes.some((s) => s.id === activeSceneId) ? activeSceneId : ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new__') onNewScene?.();
          else if (v === '__variant__') onNewVariant?.();
          else if (v) onSelectScene?.(v);
        }}
        disabled={busy}
        title="Switch scene within the project"
      >
        {projectScenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.variantOf ? '↳ ' : ''}{s.name}
          </option>
        ))}
        <option value="__new__">＋ new scene…</option>
        <option value="__variant__">⎘ duplicate as variant…</option>
      </select>
      <div className="scene-toolbar-mode" role="group" aria-label="Studio mode">
        <button
          className={'scene-btn scene-mode-btn' + (studioMode === 'setup' ? ' scene-btn--primary' : '')}
          onClick={() => onSetStudioMode?.('setup')}
          title="Setup mode — position each object's default pose per orientation. No timeline."
        >
          ⚙ setup
        </button>
        <button
          className={'scene-btn scene-mode-btn' + (studioMode === 'animate' ? ' scene-btn--primary' : '')}
          onClick={() => onSetStudioMode?.('animate')}
          title="Animate mode — create timelines and keyframe objects over time."
        >
          ▶ animate
        </button>
      </div>

      <div className="scene-toolbar-spacer" />

      <span className="scene-toolbar-tag">
        {scene.stage.activeOrientation === 'landscape'
          ? `${scene.stage.orientations.landscape.w}×${scene.stage.orientations.landscape.h}`
          : `${scene.stage.orientations.portrait.w}×${scene.stage.orientations.portrait.h}`}
      </span>
      <button className="scene-btn" onClick={onToggleOrientation} title="Switch orientation">
        {scene.stage.activeOrientation === 'landscape' ? '▭ landscape' : '▯ portrait'}
      </button>
      <select
        className="scene-toolbar-select"
        value={overlayMode}
        onChange={(e) => onSetOverlayMode?.(e.target.value)}
        title="Stage frame: behind objects (dark fill) or above objects (transparent interior)"
      >
        <option value="behind">□ frame behind</option>
        <option value="above">■ frame above</option>
      </select>
      <select
        className="scene-toolbar-select"
        value={defaultEase}
        onChange={(e) => onSetDefaultEase?.(e.target.value)}
        title="Tangent mode applied to newly created keyframes"
      >
        <option value="auto">⌇ new: smooth</option>
        <option value="flat">⎯ new: flat</option>
        <option value="linear">╱ new: linear</option>
      </select>

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

      <div className="scene-toolbar-divider" />
      <button
        className="scene-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >↶</button>
      <button
        className="scene-btn"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
      >↷</button>

      <button className="scene-btn scene-btn--ghost" onClick={onNewProject} disabled={busy} title="New project (will prompt to save)">new</button>
      <button className="scene-btn" onClick={onLoad} disabled={busy}>open…</button>
      <button className="scene-btn scene-btn--primary" onClick={onSave} disabled={busy}>save</button>
      <button
        className="scene-btn"
        onClick={onAddSpinner}
        disabled={busy}
        title="Add a Spinner (slot reel machine) object via the setup wizard"
      >🎰 spinner</button>
      <button
        className="scene-btn"
        onClick={onWebMExport}
        disabled={busy || !scene.layers.length}
        title="Export the active timeline as a .webm video (deterministic, native resolution)"
      >▶ webm</button>
      <button
        className="scene-btn"
        onClick={onUnityExport}
        disabled={busy || !scene.layers.length}
        title="Export the scene as a .unitypackage: assets + import settings, prefab per canvas, baked animation, Timeline builder"
      >⇪ unity</button>
    </div>
  );
}
