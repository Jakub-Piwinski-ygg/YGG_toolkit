// WorkspaceLockOverlay — full-cover gate shown over the studio body when no
// project workspace is linked. The body behind it is greyed out + made
// non-interactive (see .scene-studio-body--locked) so the only available action
// is loading a workspace folder from this centered panel.

import { useRef } from 'react';
import { isFsAccessSupported } from '../engine/persist.js';

export function WorkspaceLockOverlay({
  onPickRoot,
  onPickFolderFallback, // (File[]) => void — Firefox / Safari fallback
  onPickRepo,           // () => void — open the remote (GitHub/GitLab) picker
  busy = false,
  pickError = null,
  onDismissPickError
}) {
  const fallbackInputRef = useRef(null);
  const supported = isFsAccessSupported();

  return (
    <div className="scene-workspace-lock">
      <div className="scene-workspace-lock-panel">
        <div className="scene-workspace-lock-icon">📁</div>
        <div className="scene-workspace-lock-title">No Workspace Loaded</div>
        <div className="scene-workspace-lock-sub">
          {supported
            ? 'Pick your project folder from Explorer to start building scenes.'
            : 'Pick a project folder — Firefox / Safari fallback uses a read-only snapshot (scene.json saves go to Downloads).'}
        </div>
        {supported ? (
          <button
            className="scene-btn scene-workspace-lock-btn"
            onClick={onPickRoot}
            disabled={busy}
          >
            {busy ? '⏳ opening picker…' : '📁 Open LOCAL folder workspace'}
          </button>
        ) : (
          <label className={'scene-btn scene-workspace-lock-btn' + (busy ? ' scene-btn--disabled' : '')}>
            <input
              ref={fallbackInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (fallbackInputRef.current) fallbackInputRef.current.value = '';
                if (files.length) onPickFolderFallback?.(files);
              }}
              disabled={busy}
            />
            {busy ? '⏳ loading…' : '📁 Open LOCAL folder workspace'}
          </label>
        )}
        {onPickRepo && (
          <>
            <div className="scene-workspace-lock-or">or</div>
            <button
              className="scene-btn scene-workspace-lock-btn scene-workspace-lock-btn--remote"
              onClick={onPickRepo}
              disabled={busy}
            >
              🌐 Open REMOTE workspace
            </button>
          </>
        )}
        <div className="scene-workspace-lock-hint">…or drop a project folder onto the toolbar.</div>
        {pickError && (
          <div className="scene-workspace-cta-error">
            <span className="scene-workspace-cta-error-msg">⚠ {pickError}</span>
            <button className="scene-btn scene-btn--ghost" onClick={onDismissPickError}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}
