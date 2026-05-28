import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useRepoBrowser } from '../context/RepoBrowserContext.jsx';
import { RepoBrowserView } from '../components/RepoBrowserView.jsx';

export const repoContentBrowserMeta = {
  id: 'repocontent',
  label: 'Repo Content Browser',
  small: 'browse repos for art or audio',
  icon: '📦',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc: 'Browse your GitHub or GitLab repositories for art (PNG/PSD/JPG/WebP) or audio (OGG/MP3/WAV). Pick the content type from the top of the panel, then paste a personal access token (provider auto-detected), optionally set a repo prefix, then pick a repo to navigate its tree. Use the global search to scan all repos for a filename.'
};

const MODES = [
  { id: 'art', label: 'Art', icon: '🎨', hint: 'images & PSDs' },
  { id: 'sounds', label: 'Sounds', icon: '🔊', hint: 'audio files' }
];

export function RepoContentBrowserTool() {
  const { registerRunner } = useApp();
  const { authed, doFetchRepos } = useRepoBrowser();
  const [mode, setMode] = useState('art');

  useEffect(() => {
    registerRunner(repoContentBrowserMeta.id, {
      outName: () => '',
      run: async () => {
        if (authed) await doFetchRepos();
        return null;
      }
    });
    return () => registerRunner(repoContentBrowserMeta.id, null);
  }, [registerRunner, authed, doFetchRepos]);

  return (
    <div className="repocontent-wrap">
      <div className="repocontent-mode-row" role="tablist" aria-label="Content type">
        <div className="repocontent-mode-label">Browsing:</div>
        <div className="repocontent-mode-tabs">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={`repocontent-mode-tab${mode === m.id ? ' active' : ''}`}
              onClick={() => setMode(m.id)}
              title={m.hint}
            >
              <span className="repocontent-mode-icon">{m.icon}</span>
              <span>{m.label}</span>
              <span className="repocontent-mode-hint">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Remount the view when mode changes so its internal state (filters,
          current path, search) starts fresh for the new content type. */}
      <RepoBrowserView key={mode} mode={mode} />

      <style>{`
        .repocontent-wrap{display:flex;flex-direction:column;gap:.6rem;min-height:0;flex:1}
        .repocontent-mode-row{display:flex;align-items:center;gap:.7rem;padding:.55rem .7rem;background:var(--surface);border:1px solid var(--border);border-radius:5px}
        .repocontent-mode-label{font-family:var(--font-mono);font-size:.68rem;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
        .repocontent-mode-tabs{display:flex;gap:.4rem;flex:1}
        .repocontent-mode-tab{display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .9rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--muted);font-family:var(--font-mono);font-size:.78rem;cursor:pointer;transition:border-color .15s ease,color .15s ease,background .15s ease}
        .repocontent-mode-tab:hover{color:var(--text);border-color:var(--accent2)}
        .repocontent-mode-tab.active{background:var(--accent);border-color:var(--accent);color:#1a1a1a;font-weight:600}
        .repocontent-mode-icon{font-size:.95rem}
        .repocontent-mode-hint{font-size:.62rem;color:inherit;opacity:.65;margin-left:.25rem}
        .repocontent-mode-tab.active .repocontent-mode-hint{opacity:.8}
      `}</style>
    </div>
  );
}
