import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { triggerDownload } from '../utils/download.js';

export const contentBrowserMeta = {
  id: 'contentbrowser',
  label: 'Content Browser',
  small: 'browse git repos for art',
  icon: '📦',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  desc: 'Browse your GitHub or GitLab repositories for images and send them straight to the Art Tools. Paste a personal access token (provider auto-detected), optionally set a repo prefix, then pick a repo to navigate its tree. Private assets are fetched via authenticated blob URLs. Press RUN to rescan the repo list.'
};

const IMG_EXTS = /\.(png|jpg|jpeg|webp|gif|svg|bmp|ico)$/i;
const LS_KEY = 'ygg_gh_config_react';

function detectProvider(token) {
  if (!token) return null;
  if (token.startsWith('glpat-')) return 'gitlab';
  if (token.startsWith('ghp_') || token.startsWith('github_pat_')) return 'github';
  if (/^[A-Za-z0-9_-]{20}$/.test(token)) return 'gitlab';
  return null;
}

function authHeaders(provider, token) {
  if (!token) return {};
  return provider === 'gitlab' ? { 'PRIVATE-TOKEN': token } : { Authorization: 'Bearer ' + token };
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return d + 'd ago';
  if (d < 365) return Math.floor(d / 30) + 'mo ago';
  return Math.floor(d / 365) + 'y ago';
}

function stripPrefix(name, prefix) {
  if (!prefix || !name.startsWith(prefix)) return name;
  let rest = name.slice(prefix.length);
  if (rest.startsWith('-') || rest.startsWith('_') || rest.startsWith('.')) rest = rest.slice(1);
  return rest || name;
}

async function fetchRepos(provider, token, baseUrl, searchPrefix) {
  const headers = authHeaders(provider, token);
  if (provider === 'gitlab') {
    const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
    const all = [];
    let page = 1;
    const sp = searchPrefix ? '&search=' + encodeURIComponent(searchPrefix) : '';
    while (true) {
      const r = await fetch(`${base}/api/v4/projects?membership=true&min_access_level=10&per_page=100&order_by=last_activity_at${sp}&page=${page}`, { headers });
      if (!r.ok) {
        if (r.status === 401) throw new Error('401 — token rejected');
        if (r.status === 403) throw new Error('403 — need read_api scope');
        throw new Error('GitLab API ' + r.status);
      }
      const data = await r.json();
      if (!data.length) break;
      for (const x of data) all.push({
        owner: x.namespace?.full_path || '',
        name: x.path,
        fullName: x.path_with_namespace,
        description: x.description || '',
        updatedAt: x.last_activity_at,
        defaultBranch: x.default_branch || 'main',
        isPrivate: x.visibility !== 'public'
      });
      if (data.length < 100) break;
      page++;
    }
    return searchPrefix ? all.filter((r) => r.name.startsWith(searchPrefix)) : all;
  }
  // github
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', ...headers }
    });
    if (!r.ok) {
      if (r.status === 401) throw new Error('Bad GitHub PAT');
      throw new Error('GitHub API ' + r.status);
    }
    const data = await r.json();
    if (!data.length) break;
    for (const x of data) all.push({
      owner: x.owner.login,
      name: x.name,
      fullName: x.full_name,
      description: x.description || '',
      updatedAt: x.updated_at,
      defaultBranch: x.default_branch || 'main',
      isPrivate: x.private
    });
    if (data.length < 100) break;
    page++;
  }
  return searchPrefix ? all.filter((r) => r.name.startsWith(searchPrefix) || r.fullName.includes(searchPrefix)) : all;
}

async function fetchTree(provider, token, baseUrl, repo) {
  const headers = authHeaders(provider, token);
  const branch = repo.defaultBranch || 'main';
  if (provider === 'gitlab') {
    const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
    const projId = encodeURIComponent(repo.fullName);
    let page = 1;
    let all = [];
    while (true) {
      const r = await fetch(`${base}/api/v4/projects/${projId}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=100&page=${page}`, { headers });
      if (!r.ok) throw new Error('GitLab tree ' + r.status);
      const items = await r.json();
      if (!items.length) break;
      all = all.concat(items);
      const np = r.headers.get('x-next-page');
      if (!np || parseInt(np) <= page) break;
      page = parseInt(np);
    }
    return all.map((i) => ({ path: i.path, type: i.type === 'tree' ? 'tree' : 'blob', size: 0 }));
  }
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json', ...headers }
  });
  if (!r.ok) throw new Error('GitHub tree ' + r.status);
  return ((await r.json()).tree || []).map((i) => ({ path: i.path, type: i.type === 'tree' ? 'tree' : 'blob', size: i.size || 0 }));
}

function listDir(prefix, tree, typeFilter) {
  if (!tree) return { folders: [], files: [] };
  const norm = prefix ? prefix.replace(/\/$/, '') + '/' : '';
  const folderSet = new Set();
  const files = [];
  for (const item of tree) {
    if (norm && !item.path.startsWith(norm)) continue;
    if (!norm && item.type === 'blob' && !item.path.includes('/') && (!typeFilter || typeFilter(item.path))) {
      files.push({ name: item.path, path: item.path, size: item.size || 0 });
      continue;
    }
    if (!norm && item.path.includes('/')) { folderSet.add(item.path.split('/')[0]); continue; }
    const rest = item.path.slice(norm.length);
    if (!rest) continue;
    const si = rest.indexOf('/');
    if (si !== -1) folderSet.add(rest.slice(0, si));
    else if (item.type === 'blob' && (!typeFilter || typeFilter(item.path))) {
      files.push({ name: rest, path: item.path, size: item.size || 0 });
    }
  }
  const folders = [...folderSet].sort().map((name) => {
    const fp = (norm || '') + name + '/';
    let count = 0;
    for (const it of tree) if (it.type === 'blob' && it.path.startsWith(fp) && (!typeFilter || typeFilter(it.path))) count++;
    return { name, path: (norm || '') + name, count };
  }).filter((f) => f.count > 0);
  // Collapse single-child folder chains
  const collapsed = folders.map((f) => {
    let p = f.path, n = f.name;
    while (true) {
      const sub = listDir(p, tree, typeFilter);
      if (sub.folders.length === 1 && sub.files.length === 0) { p = sub.folders[0].path; n += '/' + sub.folders[0].name; }
      else break;
    }
    return { name: n, path: p, count: f.count };
  });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders: collapsed, files };
}

function rawUrl(provider, baseUrl, repo, path) {
  const branch = repo.defaultBranch || 'main';
  if (provider === 'gitlab') {
    const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
    const projId = encodeURIComponent(repo.fullName);
    return `${base}/api/v4/projects/${projId}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;
  }
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(branch)}/${path}`;
}

async function authBlobUrl(provider, token, baseUrl, repo, path, cache) {
  const key = repo.fullName + '|' + path;
  if (cache[key]) return cache[key];
  const branch = repo.defaultBranch || 'main';
  let url, headers;
  if (provider === 'gitlab') {
    const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
    const projId = encodeURIComponent(repo.fullName);
    url = `${base}/api/v4/projects/${projId}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;
    headers = authHeaders(provider, token);
  } else {
    url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
    headers = { ...authHeaders(provider, token), Accept: 'application/vnd.github.raw' };
  }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('Fetch ' + r.status);
  const blob = await r.blob();
  const u = URL.createObjectURL(blob);
  cache[key] = u;
  return u;
}

export function ContentBrowserTool() {
  const { addFiles, log, setCurrentTool, registerRunner } = useApp();

  const [provider, setProvider] = useState('gitlab');
  const [baseUrl, setBaseUrl] = useState('https://gitlab.yggdrasil.lan');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [authed, setAuthed] = useState(false);

  const [repos, setRepos] = useState([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [selectedRepo, setSelectedRepo] = useState(null);
  const [tree, setTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [error, setError] = useState('');

  const blobCacheRef = useRef({});

  // Load from localStorage
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s.provider) setProvider(s.provider);
      if (s.baseUrl) setBaseUrl(s.baseUrl);
      if (s.token) { setToken(s.token); setAuthed(true); }
      if (s.prefix) setPrefix(s.prefix);
    } catch { /* ignore */ }
  }, []);

  const saveConfig = useCallback((patch) => {
    try {
      const current = { provider, baseUrl, token, prefix };
      localStorage.setItem(LS_KEY, JSON.stringify({ ...current, ...patch }));
    } catch { /* ignore */ }
  }, [provider, baseUrl, token, prefix]);

  const doFetchRepos = useCallback(async () => {
    if (!token) { setError('Enter an access token first'); return; }
    setLoadingRepos(true); setError('');
    log(`Scanning repos${prefix ? ' matching "' + prefix + '"' : ''}…`, 'info');
    try {
      const rs = await fetchRepos(provider, token, baseUrl, prefix);
      setRepos(rs);
      setReposLoaded(true);
      log(`✓ ${rs.length} repo${rs.length !== 1 ? 's' : ''} found`, 'ok');
    } catch (e) {
      setError(e.message);
      log('✗ ' + e.message, 'err');
    } finally {
      setLoadingRepos(false);
    }
  }, [provider, token, baseUrl, prefix, log]);

  // Register runner so RUN rescans repos
  useEffect(() => {
    registerRunner(contentBrowserMeta.id, {
      outName: () => '',
      run: async () => { if (authed) await doFetchRepos(); return null; }
    });
    return () => registerRunner(contentBrowserMeta.id, null);
  }, [registerRunner, doFetchRepos, authed]);

  const handleConnect = () => {
    const t = token.trim();
    if (!t) { setError('Paste a token first'); return; }
    const det = detectProvider(t);
    if (det) setProvider(det);
    setAuthed(true);
    saveConfig({ token: t, provider: det || provider });
    setTimeout(doFetchRepos, 0);
  };

  const handleDisconnect = () => {
    setAuthed(false); setToken(''); setRepos([]); setReposLoaded(false);
    setSelectedRepo(null); setTree(null); setCurrentPath('');
    blobCacheRef.current = {};
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  };

  const handleSelectRepo = async (repo) => {
    setSelectedRepo(repo); setTree(null); setCurrentPath(''); setFileSearch('');
    setLoadingTree(true); setError('');
    log(`Loading tree for ${repo.fullName}…`, 'info');
    try {
      const t = await fetchTree(provider, token, baseUrl, repo);
      setTree(t);
      log(`✓ ${t.length} items`, 'ok');
    } catch (e) {
      setError(e.message);
      log('✗ ' + e.message, 'err');
    } finally {
      setLoadingTree(false);
    }
  };

  const filteredRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => (stripPrefix(r.name, prefix) + ' ' + r.fullName + ' ' + r.description).toLowerCase().includes(q));
  }, [repos, repoFilter, prefix]);

  const listing = useMemo(() => {
    if (!tree) return { folders: [], files: [] };
    const q = fileSearch.trim().toLowerCase();
    if (q) {
      const files = [];
      for (const it of tree) {
        if (it.type === 'blob' && IMG_EXTS.test(it.path) && it.path.toLowerCase().includes(q)) {
          files.push({ name: it.path.split('/').pop(), path: it.path, size: it.size || 0, fullPath: it.path });
        }
      }
      return { folders: [], files };
    }
    return listDir(currentPath, tree, (p) => IMG_EXTS.test(p));
  }, [tree, currentPath, fileSearch]);

  const breadcrumb = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    const out = [];
    let acc = '';
    for (const p of parts) { acc = acc ? acc + '/' + p : p; out.push({ label: p, path: acc }); }
    return out;
  }, [currentPath]);

  const sendToArtTools = async (path, name) => {
    if (!selectedRepo) return;
    try {
      const url = token
        ? await authBlobUrl(provider, token, baseUrl, selectedRepo, path, blobCacheRef.current)
        : rawUrl(provider, baseUrl, selectedRepo, path);
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      addFiles([file]);
      log(`✓ ${name} → Art Tools`, 'ok');
    } catch (e) {
      log('✗ Send failed: ' + e.message, 'err');
    }
  };

  const downloadFile = async (path, name) => {
    if (!selectedRepo) return;
    try {
      const url = token
        ? await authBlobUrl(provider, token, baseUrl, selectedRepo, path, blobCacheRef.current)
        : rawUrl(provider, baseUrl, selectedRepo, path);
      triggerDownload(url, name);
    } catch (e) {
      log('✗ Download failed: ' + e.message, 'err');
    }
  };

  // Lazy-load image thumbnails (private mode fetches via auth blob)
  const LazyImg = ({ path, alt }) => {
    const [src, setSrc] = useState(token ? '' : rawUrl(provider, baseUrl, selectedRepo, path));
    const imgRef = useRef(null);
    useEffect(() => {
      if (!token) return;
      let cancelled = false;
      const el = imgRef.current;
      if (!el) return;
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            io.disconnect();
            authBlobUrl(provider, token, baseUrl, selectedRepo, path, blobCacheRef.current)
              .then((u) => { if (!cancelled) setSrc(u); })
              .catch(() => { if (!cancelled) setSrc(''); });
            break;
          }
        }
      }, { rootMargin: '200px' });
      io.observe(el);
      return () => { cancelled = true; io.disconnect(); };
    }, [path]);
    return <img ref={imgRef} src={src || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'} alt={alt} loading="lazy" className="cb-thumb" />;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="cb-auth-panel">
        <div className="cb-auth-title">🔑 Connect to Git</div>
        <div className="field">
          <label>Access Token</label>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              placeholder="glpat-… or ghp_…"
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => setShowToken((v) => !v)} style={{ padding: '.35rem .5rem', fontSize: '.58rem' }}>
              👁
            </button>
          </div>
        </div>
        {detectProvider(token.trim()) !== 'github' && (
          <div className="field">
            <label>GitLab URL</label>
            <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.yggdrasil.lan" />
          </div>
        )}
        <div className="field">
          <label>Repo prefix (optional)</label>
          <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. slot-" />
        </div>
        <div className="cb-auth-hint">
          Paste a token — provider is auto-detected.<br />
          <code>glpat-…</code> → GitLab &nbsp;|&nbsp; <code>ghp_…</code> → GitHub<br />
          Scope: <code>read_api</code> (GitLab) or <code>Contents: Read-only</code> (GitHub)
        </div>
        {error && <div className="cb-error">{error}</div>}
        <button className="btn btn-primary" onClick={handleConnect}>→ Connect</button>
      </div>
    );
  }

  return (
    <div className="cb-wrap">
      <div className="cb-connected">
        <span className="cb-dot" /> Connected — {provider}
        <button className="btn cb-disconnect-btn" onClick={handleDisconnect}>Disconnect</button>
      </div>

      <div className="cb-toolbar">
        <div className="field" style={{ flex: 1 }}>
          <label>Repo prefix</label>
          <input type="text" value={prefix} onChange={(e) => { setPrefix(e.target.value); saveConfig({ prefix: e.target.value }); }} placeholder="e.g. slot-" />
        </div>
        <button className="btn" onClick={doFetchRepos} disabled={loadingRepos}>
          {loadingRepos ? '…' : '↻ Rescan'}
        </button>
      </div>

      {error && <div className="cb-error">{error}</div>}

      {!selectedRepo ? (
        <>
          <input
            className="cb-search"
            type="text"
            placeholder={reposLoaded ? `Filter ${repos.length} repos…` : 'Press Rescan to load repos…'}
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
          />
          {loadingRepos ? (
            <div className="cb-empty">Scanning repositories…</div>
          ) : !reposLoaded ? (
            <div className="cb-empty">Press Rescan to load your repositories.</div>
          ) : filteredRepos.length === 0 ? (
            <div className="cb-empty">{repoFilter ? `No repos match "${repoFilter}"` : 'No repos found'}</div>
          ) : (
            <div className="cb-repo-grid">
              {filteredRepos.map((r) => (
                <button key={r.fullName} className="cb-repo-card" onClick={() => handleSelectRepo(r)}>
                  <span className="cb-repo-icon">{r.isPrivate ? '🔒' : '📦'}</span>
                  <span className="cb-repo-name">{stripPrefix(r.name, prefix)}</span>
                  {r.description && <span className="cb-repo-desc">{r.description}</span>}
                  {r.updatedAt && <span className="cb-repo-age">{timeAgo(r.updatedAt)}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="cb-status-bar">
            {reposLoaded && <span>{filteredRepos.length} of {repos.length} repo{repos.length !== 1 ? 's' : ''}</span>}
          </div>
        </>
      ) : (
        <>
          <div className="cb-repo-header">
            <button className="btn cb-back-btn" onClick={() => { setSelectedRepo(null); setTree(null); }}>← Repos</button>
            <span className="cb-repo-title">
              {selectedRepo.isPrivate ? '🔒' : '📦'} {stripPrefix(selectedRepo.name, prefix)}
            </span>
          </div>

          <input
            className="cb-search"
            type="text"
            placeholder={tree ? `Search all images in ${selectedRepo.name}…` : 'Loading tree…'}
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            disabled={!tree}
          />

          {loadingTree ? (
            <div className="cb-empty">Loading tree…</div>
          ) : !tree ? (
            <div className="cb-empty">{error || 'Tree not loaded'}</div>
          ) : (
            <>
              {!fileSearch && (
                <div className="cb-breadcrumb">
                  <button className="cb-crumb" onClick={() => setCurrentPath('')}>root</button>
                  {breadcrumb.map((b) => (
                    <span key={b.path}>
                      <span className="cb-crumb-sep">/</span>
                      <button className="cb-crumb" onClick={() => setCurrentPath(b.path)}>{b.label}</button>
                    </span>
                  ))}
                </div>
              )}

              {listing.folders.length > 0 && (
                <div className="cb-folder-grid">
                  {listing.folders.map((f) => (
                    <button key={f.path} className="cb-folder-card" onClick={() => setCurrentPath(f.path)}>
                      <span className="cb-folder-icon">📁</span>
                      <span className="cb-folder-label">{f.name}</span>
                      <span className="cb-folder-count">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}

              {listing.files.length > 0 && (
                <div className="cb-image-grid">
                  {listing.files.map((f) => (
                    <div key={f.path} className="cb-image-card">
                      <LazyImg path={f.path} alt={f.name} />
                      <div className="cb-image-label">
                        <span className="cb-image-name" title={f.path}>{fileSearch && f.fullPath ? f.fullPath : f.name}</span>
                        <span className="cb-image-actions">
                          <button className="cb-icon-btn cb-icon-add" title="Add to Art Tools" onClick={() => sendToArtTools(f.path, f.name)}>+</button>
                          <button className="cb-icon-btn" title="Download" onClick={() => downloadFile(f.path, f.name)}>↓</button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!listing.folders.length && !listing.files.length && (
                <div className="cb-empty">{fileSearch ? `No images match "${fileSearch}"` : 'No image files here'}</div>
              )}

              <div className="cb-status-bar">
                <span>{listing.folders.length} folder{listing.folders.length !== 1 ? 's' : ''} · {listing.files.length} file{listing.files.length !== 1 ? 's' : ''}{token ? ' · 🔒' : ''}</span>
                {listing.files.length > 0 && (
                  <button className="btn cb-add-all-btn" onClick={() => { listing.files.forEach((f) => sendToArtTools(f.path, f.name)); setCurrentTool('webp'); }}>
                    + Add all to Art Tools
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
