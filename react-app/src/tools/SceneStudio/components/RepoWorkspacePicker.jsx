// RepoWorkspacePicker — modal for opening a GitHub/GitLab repo folder AS the
// Scene Studio workspace. Reuses the shared RepoBrowser auth/state (so the
// connection is shared with the Repo Content Browser) and the listDir folder
// navigation, but keeps its OWN folder-nav cursor (not rb.currentPath, which
// belongs to the Content Browser). On confirm it emits a selection descriptor;
// SceneStudioInner builds the repo-backed handle and links it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRepoBrowser } from '../../../context/RepoBrowserContext.jsx';
import {
  detectProvider,
  fetchBranches,
  fetchTree,
  listDir,
  stripPrefix,
  timeAgo
} from '../../../utils/repoBrowser.js';

export function RepoWorkspacePicker({ open, onClose, onConfirm }) {
  const rb = useRepoBrowser();
  const [showToken, setShowToken] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const [path, setPath] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchTree, setBranchTree] = useState(null); // tree for a non-default branch
  const [loadingBranchTree, setLoadingBranchTree] = useState(false);

  const repoKey = rb.selectedRepo?.fullName || '';
  const defaultBranch = rb.selectedRepo?.defaultBranch || 'main';

  // Auto-load the repo list once when the modal is open + authed.
  useEffect(() => {
    if (open && rb.authed && !rb.reposLoaded && !rb.loadingRepos) rb.doFetchRepos();
  }, [open, rb.authed, rb.reposLoaded, rb.loadingRepos, rb.doFetchRepos]);

  // When the selected repo changes, reset branch/path and load its branches.
  useEffect(() => {
    if (!rb.selectedRepo) return;
    setBranch(defaultBranch);
    setBranchTree(null);
    setPath('');
    let cancelled = false;
    setLoadingBranches(true);
    fetchBranches(rb.provider, rb.token, rb.baseUrl, rb.selectedRepo)
      .then((bs) => { if (!cancelled) setBranches(bs); })
      .catch(() => { if (!cancelled) setBranches([defaultBranch]); })
      .finally(() => { if (!cancelled) setLoadingBranches(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoKey]);

  const isDefaultBranch = !rb.selectedRepo || branch === defaultBranch;
  const effectiveTree = isDefaultBranch ? rb.tree : branchTree;
  const treeLoading = rb.loadingTree || loadingBranchTree;

  const handleBranchChange = useCallback(async (newBranch) => {
    setBranch(newBranch);
    setPath('');
    if (!rb.selectedRepo || newBranch === defaultBranch) { setBranchTree(null); return; }
    setLoadingBranchTree(true);
    try {
      const repoForBranch = { ...rb.selectedRepo, defaultBranch: newBranch };
      setBranchTree(await fetchTree(rb.provider, rb.token, rb.baseUrl, repoForBranch));
    } catch {
      setBranchTree([]);
    } finally {
      setLoadingBranchTree(false);
    }
  }, [rb.selectedRepo, rb.provider, rb.token, rb.baseUrl, defaultBranch]);

  const listing = useMemo(() => listDir(path, effectiveTree, null), [path, effectiveTree]);
  const breadcrumb = useMemo(() => {
    if (!path) return [];
    const parts = path.split('/').filter(Boolean);
    const out = [];
    let acc = '';
    for (const p of parts) { acc = acc ? acc + '/' + p : p; out.push({ label: p, path: acc }); }
    return out;
  }, [path]);

  const filteredRepos = useMemo(() => {
    if (!repoFilter) return rb.repos;
    const q = repoFilter.toLowerCase();
    return rb.repos.filter((r) => r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q));
  }, [rb.repos, repoFilter]);

  const handleConfirm = useCallback(() => {
    if (!rb.selectedRepo || !effectiveTree) return;
    onConfirm({
      provider: rb.provider,
      token: rb.token,
      baseUrl: rb.baseUrl,
      repo: { ...rb.selectedRepo, defaultBranch: branch },
      subPath: path,
      tree: effectiveTree
    });
  }, [rb.selectedRepo, rb.provider, rb.token, rb.baseUrl, branch, path, effectiveTree, onConfirm]);

  if (!open) return null;

  return (
    <div className="scene-confirm-overlay" onClick={onClose}>
      <div className="scene-repo-picker" onClick={(e) => e.stopPropagation()}>
        <div className="scene-repo-picker-head">
          <span className="scene-confirm-title">🌐 Open REMOTE workspace</span>
          <div className="scene-repo-head-actions">
            {rb.authed && (
              <button
                className="scene-btn scene-btn--ghost scene-btn--sm"
                onClick={rb.disconnect}
                title="Disconnect this token — lets you connect with a different key"
              >⏏ Disconnect</button>
            )}
            <button className="scene-btn scene-btn--ghost scene-btn--sm" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Step 1 — connect */}
        {!rb.authed ? (
          <div className="scene-repo-auth">
            <label className="scene-repo-field-label">Access token</label>
            <div className="scene-repo-token-row">
              <input
                type={showToken ? 'text' : 'password'}
                value={rb.token}
                placeholder="glpat-… or ghp_…"
                onChange={(e) => rb.setToken(e.target.value)}
                className="scene-repo-input"
              />
              <button className="scene-btn scene-btn--sm" onClick={() => setShowToken((v) => !v)}>👁</button>
            </div>
            {detectProvider(rb.token.trim()) !== 'github' && (
              <>
                <label className="scene-repo-field-label">GitLab URL</label>
                <input
                  type="text"
                  value={rb.baseUrl}
                  onChange={(e) => rb.setBaseUrl(e.target.value)}
                  placeholder="https://gitlab.yggdrasil.lan"
                  className="scene-repo-input"
                />
              </>
            )}
            <div className="scene-repo-hint">
              Provider is auto-detected. Shared with the Repo Content Browser.
            </div>
            {rb.error && <div className="scene-repo-error">{rb.error}</div>}
            <button className="scene-btn scene-btn--primary" onClick={rb.connect}>→ Connect</button>
          </div>
        ) : !rb.selectedRepo ? (
          /* Step 2 — pick repo */
          <div className="scene-repo-body">
            <div className="scene-repo-toolbar">
              <input
                type="text"
                className="scene-repo-input"
                placeholder="Filter repositories…"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
              />
              <button className="scene-btn scene-btn--sm" onClick={rb.doFetchRepos} disabled={rb.loadingRepos}>↻ Rescan</button>
            </div>
            {rb.loadingRepos ? (
              <div className="scene-repo-empty">Scanning repositories…</div>
            ) : !rb.reposLoaded ? (
              <div className="scene-repo-empty">Press Rescan to load your repositories.</div>
            ) : filteredRepos.length === 0 ? (
              <div className="scene-repo-empty">{repoFilter ? `No repos match "${repoFilter}"` : 'No repos found'}</div>
            ) : (
              <div className="scene-repo-grid">
                {filteredRepos.map((r) => (
                  <button key={r.fullName} className="scene-repo-card" onClick={() => rb.selectRepo(r)}>
                    <span className="scene-repo-card-icon">{r.isPrivate ? '🔒' : '📦'}</span>
                    <span className="scene-repo-card-name">{r.name}</span>
                    {r.canWrite && <span className="scene-repo-card-write" title="Token can commit to this repo">✎</span>}
                    {r.updatedAt && <span className="scene-repo-card-age">{timeAgo(r.updatedAt)}</span>}
                  </button>
                ))}
              </div>
            )}
            {rb.error && <div className="scene-repo-error">{rb.error}</div>}
          </div>
        ) : (
          /* Step 3 — branch + folder, confirm */
          <div className="scene-repo-body">
            <div className="scene-repo-toolbar">
              <button className="scene-btn scene-btn--sm" onClick={rb.backToRepos}>← Repos</button>
              <span className="scene-repo-title">
                {rb.selectedRepo.isPrivate ? '🔒' : '📦'} {rb.selectedRepo.name}
              </span>
              <label className="scene-repo-branch">
                branch
                <select
                  className="scene-toolbar-select"
                  value={branch}
                  disabled={loadingBranches}
                  onChange={(e) => handleBranchChange(e.target.value)}
                >
                  {branches.length === 0 && <option value={branch}>{branch}</option>}
                  {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            </div>

            {treeLoading ? (
              <div className="scene-repo-empty">Loading tree…</div>
            ) : !effectiveTree ? (
              <div className="scene-repo-empty">{rb.error || 'Tree not loaded'}</div>
            ) : (
              <>
                <div className="scene-repo-breadcrumb">
                  <button className="scene-repo-crumb" onClick={() => setPath('')}>root</button>
                  {breadcrumb.map((b) => (
                    <span key={b.path}>
                      <span className="scene-repo-crumb-sep">/</span>
                      <button className="scene-repo-crumb" onClick={() => setPath(b.path)}>{b.label}</button>
                    </span>
                  ))}
                </div>
                {listing.folders.length > 0 ? (
                  <div className="scene-repo-folder-grid">
                    {listing.folders.map((f) => (
                      <button key={f.path} className="scene-repo-folder-card" onClick={() => setPath(f.path)}>
                        <span className="scene-repo-folder-icon">📁</span>
                        <span className="scene-repo-folder-label">{f.name}</span>
                        <span className="scene-repo-folder-count">{f.count}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="scene-repo-empty">No sub-folders here.</div>
                )}
              </>
            )}

            <div className="scene-repo-confirm-row">
              <span className="scene-repo-target" title={path || 'repository root'}>
                {path ? `/${path}` : '/ (repository root)'}
              </span>
              <button
                className="scene-btn scene-btn--primary"
                onClick={handleConfirm}
                disabled={!effectiveTree || treeLoading}
              >
                Use this folder as workspace
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
