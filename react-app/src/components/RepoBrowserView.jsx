import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useRepoBrowser } from '../context/RepoBrowserContext.jsx';
import {
  IMG_EXTS,
  IMG_FULL_EXTS,
  SOUND_EXTS,
  authBlobUrl,
  authHeaders,
  detectProvider,
  formatSize,
  listDir,
  rawUrl,
  runPool,
  stripPrefix,
  timeAgo
} from '../utils/repoBrowser.js';
import { triggerDownload } from '../utils/download.js';
import { Lightbox } from './Lightbox.jsx';
import { SpinePlayer } from './SpinePlayer.jsx';
import { findSpineInTree, collectTextureCandidates } from '../utils/spine/index.js';

function LazyImg({ provider, baseUrl, token, repo, path, alt, blobCache }) {
  const [src, setSrc] = useState(token ? '' : rawUrl(provider, baseUrl, repo, path));
  const ref = useRef(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            io.disconnect();
            authBlobUrl(provider, token, baseUrl, repo, path, blobCache)
              .then((u) => { if (!cancelled) setSrc(u); })
              .catch(() => { if (!cancelled) setSrc(''); });
            break;
          }
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [path, provider, baseUrl, token, repo, blobCache]);
  return (
    <img
      ref={ref}
      src={src || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'}
      alt={alt}
      loading="lazy"
      className="cb-thumb"
    />
  );
}

function highlightMatch(text, query) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="gs-hit">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

export function RepoBrowserView({ mode }) {
  const { addFiles, log, setCurrentTool } = useApp();
  const rb = useRepoBrowser();
  const {
    provider, baseUrl, token, prefix, setPrefix,
    authed, repos, reposLoaded, loadingRepos, doFetchRepos, disconnect, saveConfig,
    selectedRepo, tree, loadingTree, currentPath, setCurrentPath, error,
    globalSearch, setGlobalSearch, treeCacheRef, blobCacheRef, selectRepo
  } = rb;

  const [repoFilter, setRepoFilter] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // {query, scanRepos}
  const [lightbox, setLightbox] = useState(null);   // {src, name, path, repo}
  const [spinePlay, setSpinePlay] = useState(null); // {name, dir, jsonPath, atlasPath, textures}

  const isImage = mode === 'art';
  const filterRe = isImage ? IMG_FULL_EXTS : SOUND_EXTS;
  const previewableRe = isImage ? IMG_EXTS : SOUND_EXTS;
  const matchPath = (p) => filterRe.test(p);
  const tabLabel = isImage ? 'images' : 'sounds';
  const tabSingular = isImage ? 'image' : 'sound';

  const filteredRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      (stripPrefix(r.name, prefix) + ' ' + r.fullName + ' ' + r.description).toLowerCase().includes(q)
    );
  }, [repos, repoFilter, prefix]);

  const listing = useMemo(() => {
    if (!tree) return { folders: [], files: [] };
    const q = fileSearch.trim().toLowerCase();
    if (q) {
      const files = [];
      for (const it of tree) {
        if (it.type === 'blob' && matchPath(it.path) && it.path.toLowerCase().includes(q)) {
          files.push({
            name: it.path.split('/').pop(),
            path: it.path,
            size: it.size || 0,
            fullPath: it.path
          });
        }
      }
      return { folders: [], files };
    }
    return listDir(currentPath, tree, matchPath);
  }, [tree, currentPath, fileSearch, mode]); // eslint-disable-line

  // Spine triplets visible in the current directory (art mode only, no active search)
  const spineList = useMemo(() => {
    if (!isImage || !tree || fileSearch) return [];
    return findSpineInTree(tree, currentPath || '');
  }, [tree, currentPath, fileSearch, isImage]);

  const breadcrumb = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    const out = [];
    let acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      out.push({ label: p, path: acc });
    }
    return out;
  }, [currentPath]);

  // ── Single-repo file actions ────────────────────────────────────────────
  const resolveUrl = async (path) => {
    if (!selectedRepo) return null;
    return token
      ? await authBlobUrl(provider, token, baseUrl, selectedRepo, path, blobCacheRef.current)
      : rawUrl(provider, baseUrl, selectedRepo, path);
  };

  const sendToArtTools = async (path, name, repo) => {
    const r = repo || selectedRepo;
    if (!r) return;
    try {
      const url = token
        ? await authBlobUrl(provider, token, baseUrl, r, path, blobCacheRef.current)
        : rawUrl(provider, baseUrl, r, path);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      addFiles([file]);
      log(`✓ ${name} → Art Tools`, 'ok');
    } catch (e) {
      log('✗ Send failed: ' + e.message, 'err');
    }
  };

  const downloadFile = async (path, name, repo) => {
    const r = repo || selectedRepo;
    if (!r) return;
    try {
      const url = token
        ? await authBlobUrl(provider, token, baseUrl, r, path, blobCacheRef.current)
        : rawUrl(provider, baseUrl, r, path);
      triggerDownload(url, name);
    } catch (e) {
      log('✗ Download failed: ' + e.message, 'err');
    }
  };

  const openLightbox = async (path, name, repo) => {
    const r = repo || selectedRepo;
    if (!r) return;
    try {
      const url = token
        ? await authBlobUrl(provider, token, baseUrl, r, path, blobCacheRef.current)
        : rawUrl(provider, baseUrl, r, path);
      setLightbox({ src: url, name, path, repo: r });
    } catch (e) {
      log('✗ Could not load image: ' + e.message, 'err');
    }
  };

  // ── Cross-repo global search ────────────────────────────────────────────
  const startGlobalSearch = (query, scanRepos) => {
    const gs = {
      query: query.toLowerCase(),
      rawQuery: query,
      mode,
      running: true,
      cancelled: false,
      scanned: 0,
      total: scanRepos.length,
      matches: 0,
      results: [],
      startedAt: Date.now()
    };
    setGlobalSearch(gs);
    log(`Scanning ${scanRepos.length} repos for "${query}"…`, 'info');
    const typeFilter = isImage ? (p) => IMG_FULL_EXTS.test(p) : (p) => SOUND_EXTS.test(p);
    const local = gs;
    runPool(
      scanRepos,
      async (repo) => {
        if (local.cancelled) return;
        try {
          let t = treeCacheRef.current[repo.fullName];
          if (!t) {
            const headers = authHeaders(provider, token);
            const branch = repo.defaultBranch || 'main';
            if (provider === 'gitlab') {
              const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
              const projId = encodeURIComponent(repo.fullName);
              let page = 1;
              let all = [];
              while (true) {
                const r = await fetch(
                  `${base}/api/v4/projects/${projId}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=100&page=${page}`,
                  { headers }
                );
                if (!r.ok) throw new Error('tree ' + r.status);
                const items = await r.json();
                if (!items.length) break;
                all = all.concat(items);
                const np = r.headers.get('x-next-page');
                if (!np || parseInt(np) <= page) break;
                page = parseInt(np);
              }
              t = all.map((i) => ({ path: i.path, type: i.type === 'tree' ? 'tree' : 'blob', size: 0 }));
            } else {
              const r = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
                { headers: { Accept: 'application/vnd.github+json', ...headers } }
              );
              if (!r.ok) throw new Error('tree ' + r.status);
              t = ((await r.json()).tree || []).map((i) => ({
                path: i.path,
                type: i.type === 'tree' ? 'tree' : 'blob',
                size: i.size || 0
              }));
            }
            treeCacheRef.current[repo.fullName] = t;
          }
          if (local.cancelled) return;
          const hits = [];
          for (const item of t) {
            if (item.type === 'blob' && typeFilter(item.path) && item.path.toLowerCase().includes(local.query))
              hits.push(item.path);
          }
          if (hits.length) {
            local.results.push({ repo, files: hits.sort() });
            local.matches += hits.length;
          }
        } catch {
          /* skip */
        }
        local.scanned++;
        // Trigger re-render
        setGlobalSearch({ ...local });
      },
      8,
      () => local.cancelled
    ).then(() => {
      local.running = false;
      const dur = ((Date.now() - local.startedAt) / 1000).toFixed(1);
      log(
        local.cancelled
          ? `✗ Scan cancelled (${local.scanned}/${local.total}, ${local.matches} matches)`
          : `✓ Scan complete: ${local.matches} matches in ${local.results.length} repos (${dur}s)`,
        local.cancelled ? 'err' : 'ok'
      );
      setGlobalSearch({ ...local });
    });
  };

  const promptGlobalSearch = () => {
    const q = globalQuery.trim();
    if (!q) return;
    let scanRepos = repos;
    if (prefix) scanRepos = scanRepos.filter((r) => r.name.startsWith(prefix));
    if (!scanRepos.length) {
      log('No repos to search', 'err');
      return;
    }
    setConfirmModal({ query: q, scanRepos });
  };

  const cancelGlobalSearch = () => {
    if (!globalSearch) return;
    globalSearch.cancelled = true;
    setGlobalSearch({ ...globalSearch });
  };

  const closeGlobalSearch = () => {
    if (globalSearch?.running) globalSearch.cancelled = true;
    setGlobalSearch(null);
  };

  // Open a search hit's repo with the query pre-filled in the file search
  const openHitRepo = async (repo) => {
    setGlobalSearch(null);
    setFileSearch(globalSearch?.rawQuery || '');
    await selectRepo(repo);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (!authed) {
    return <AuthPanel rb={rb} />;
  }

  return (
    <div className="cb-wrap">
      <div className="cb-connected">
        <span className="cb-dot" /> Connected — {provider}
        <button className="btn cb-disconnect-btn" onClick={disconnect}>Disconnect</button>
      </div>

      <div className="cb-toolbar">
        <div className="field" style={{ flex: 1 }}>
          <label>Repo prefix</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => { setPrefix(e.target.value); saveConfig({ prefix: e.target.value }); }}
            placeholder="e.g. slot-"
          />
        </div>
        <button className="btn" onClick={doFetchRepos} disabled={loadingRepos}>
          {loadingRepos ? '…' : '↻ Rescan'}
        </button>
      </div>

      {error && <div className="cb-error">{error}</div>}

      {globalSearch ? (
        <GlobalSearchView
          gs={globalSearch}
          mode={mode}
          previewableRe={previewableRe}
          onCancel={cancelGlobalSearch}
          onClose={closeGlobalSearch}
          onOpenRepo={openHitRepo}
          onLightbox={openLightbox}
          onSend={sendToArtTools}
          onDownload={downloadFile}
          provider={provider}
          baseUrl={baseUrl}
          token={token}
          blobCacheRef={blobCacheRef}
        />
      ) : !selectedRepo ? (
        <>
          <div className="gs-toolbar">
            <input
              className="cb-search"
              type="text"
              placeholder={reposLoaded ? `Filter ${repos.length} repos…` : 'Press Rescan to load repos…'}
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="cb-search"
              type="text"
              placeholder={`🔎 Search all ${tabLabel} across repos…`}
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') promptGlobalSearch(); }}
              style={{ flex: 1 }}
              disabled={!reposLoaded}
            />
            <button
              className="btn"
              onClick={promptGlobalSearch}
              disabled={!reposLoaded || !globalQuery.trim()}
              title="Scan all repos for this filename"
            >
              Search
            </button>
          </div>
          {loadingRepos ? (
            <div className="cb-empty">Scanning repositories…</div>
          ) : !reposLoaded ? (
            <div className="cb-empty">Press Rescan to load your repositories.</div>
          ) : filteredRepos.length === 0 ? (
            <div className="cb-empty">{repoFilter ? `No repos match "${repoFilter}"` : 'No repos found'}</div>
          ) : (
            <div className="cb-repo-grid">
              {filteredRepos.map((r) => (
                <button key={r.fullName} className="cb-repo-card" onClick={() => selectRepo(r)}>
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
            <button className="btn cb-back-btn" onClick={rb.backToRepos}>← Repos</button>
            <span className="cb-repo-title">
              {selectedRepo.isPrivate ? '🔒' : '📦'} {stripPrefix(selectedRepo.name, prefix)}
            </span>
          </div>

          <input
            className="cb-search"
            type="text"
            placeholder={tree ? `Search all ${tabLabel} in ${selectedRepo.name}…` : 'Loading tree…'}
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

              {spineList.length > 0 && (
                <SpineGrid
                  items={spineList}
                  onPlay={(s) =>
                    setSpinePlay({
                      ...s,
                      textures: collectTextureCandidates(tree, s.dir),
                    })
                  }
                />
              )}

              {listing.files.length > 0 && (
                isImage ? (
                  <ImageGrid
                    files={listing.files}
                    fileSearch={fileSearch}
                    selectedRepo={selectedRepo}
                    provider={provider}
                    baseUrl={baseUrl}
                    token={token}
                    blobCacheRef={blobCacheRef}
                    onLightbox={openLightbox}
                    onSend={sendToArtTools}
                    onDownload={downloadFile}
                  />
                ) : (
                  <SoundGrid
                    files={listing.files}
                    selectedRepo={selectedRepo}
                    provider={provider}
                    baseUrl={baseUrl}
                    token={token}
                    blobCacheRef={blobCacheRef}
                    resolveUrl={resolveUrl}
                    onDownload={downloadFile}
                  />
                )
              )}

              {!listing.folders.length && !listing.files.length && (
                <div className="cb-empty">{fileSearch ? `No ${tabLabel} match "${fileSearch}"` : `No ${tabSingular} files here`}</div>
              )}

              <div className="cb-status-bar">
                <span>
                  {listing.folders.length} folder{listing.folders.length !== 1 ? 's' : ''} · {listing.files.length} file{listing.files.length !== 1 ? 's' : ''}{token ? ' · 🔒' : ''}
                </span>
                {isImage && listing.files.length > 0 && (
                  <button
                    className="btn cb-add-all-btn"
                    onClick={() => {
                      listing.files.forEach((f) => sendToArtTools(f.path, f.name));
                      setCurrentTool('converter');
                    }}
                  >
                    + Add all to Art Tools
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Confirm modal for global scan */}
      {confirmModal && (
        <ConfirmScanModal
          query={confirmModal.query}
          scanRepos={confirmModal.scanRepos}
          prefix={prefix}
          tabLabel={tabLabel}
          treeCacheRef={treeCacheRef}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => {
            const { query, scanRepos } = confirmModal;
            setConfirmModal(null);
            startGlobalSearch(query, scanRepos);
          }}
        />
      )}

      {/* Spine player */}
      <SpinePlayer
        open={!!spinePlay}
        spec={spinePlay}
        resolveUrl={resolveUrl}
        onClose={() => setSpinePlay(null)}
      />

      {/* Lightbox */}
      <Lightbox
        open={!!lightbox}
        src={lightbox?.src}
        name={lightbox?.name}
        onClose={() => setLightbox(null)}
        onDownload={lightbox ? () => triggerDownload(lightbox.src, lightbox.name) : null}
        onSendToTools={
          isImage && lightbox
            ? () => sendToArtTools(lightbox.path, lightbox.name, lightbox.repo)
            : null
        }
      />
    </div>
  );
}

function SpineGrid({ items, onPlay }) {
  return (
    <div className="sp-grid">
      <div className="sp-grid-label">🦴 Spine · {items.length}</div>
      <div className="sp-grid-row">
        {items.map((s) => (
          <button
            key={s.jsonPath}
            className="sp-grid-card"
            onClick={() => onPlay(s)}
            title={s.jsonPath}
          >
            <span className="sp-grid-icon">🦴</span>
            <span className="sp-grid-name">{s.name}</span>
            <span className="sp-grid-play">▶ Preview</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AuthPanel({ rb }) {
  const { token, setToken, baseUrl, setBaseUrl, prefix, setPrefix, error, connect } = rb;
  const [showToken, setShowToken] = useState(false);
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
          <button
            type="button"
            className="btn"
            onClick={() => setShowToken((v) => !v)}
            style={{ padding: '.35rem .5rem', fontSize: '.58rem' }}
          >
            👁
          </button>
        </div>
      </div>
      {detectProvider(token.trim()) !== 'github' && (
        <div className="field">
          <label>GitLab URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://gitlab.yggdrasil.lan"
          />
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
      <button className="btn btn-primary" onClick={connect}>→ Connect</button>
    </div>
  );
}

function ImageGrid({
  files, fileSearch, selectedRepo, provider, baseUrl, token, blobCacheRef,
  onLightbox, onSend, onDownload
}) {
  return (
    <div className="cb-image-grid">
      {files.map((f) => (
        <div key={f.path} className="cb-image-card" onClick={() => onLightbox(f.path, f.name, selectedRepo)}>
          <LazyImg
            provider={provider}
            baseUrl={baseUrl}
            token={token}
            repo={selectedRepo}
            path={f.path}
            alt={f.name}
            blobCache={blobCacheRef.current}
          />
          <div className="cb-image-label">
            <span className="cb-image-name" title={f.path}>
              {fileSearch && f.fullPath ? f.fullPath : f.name}
            </span>
            <span className="cb-image-actions">
              <button
                className="cb-icon-btn cb-icon-add"
                title="Add to Art Tools"
                onClick={(e) => { e.stopPropagation(); onSend(f.path, f.name, selectedRepo); }}
              >
                +
              </button>
              <button
                className="cb-icon-btn"
                title="Download"
                onClick={(e) => { e.stopPropagation(); onDownload(f.path, f.name, selectedRepo); }}
              >
                ↓
              </button>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SoundGrid({ files, selectedRepo, provider, baseUrl, token, resolveUrl, onDownload }) {
  return (
    <div className="sb-list">
      {files.map((f) => (
        <SoundRow
          key={f.path}
          file={f}
          selectedRepo={selectedRepo}
          provider={provider}
          baseUrl={baseUrl}
          token={token}
          resolveUrl={resolveUrl}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}

function SoundRow({ file, selectedRepo, provider, baseUrl, token, resolveUrl, onDownload }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const isPrivate = !!token;
  const ext = file.name.split('.').pop().toUpperCase();

  const handlePlay = async () => {
    if (audioUrl) return;
    setLoading(true);
    try {
      const u = await resolveUrl(file.path);
      setAudioUrl(u);
    } catch {
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  // For public repos we can use the raw URL directly in <audio src>
  const directUrl = !isPrivate ? rawUrl(provider, baseUrl, selectedRepo, file.path) : null;

  return (
    <div className="sb-row">
      <div className="sb-row-meta">
        <span className="sb-row-name" title={file.path}>{file.name}</span>
        <span className="sb-row-info">{ext} {formatSize(file.size)}</span>
      </div>
      {isPrivate ? (
        audioUrl ? (
          <audio controls preload="auto" src={audioUrl} autoPlay />
        ) : (
          <button className="btn sb-play-btn" onClick={handlePlay} disabled={loading}>
            {loading ? '…' : '▶ Play'}
          </button>
        )
      ) : (
        <audio controls preload="none" src={directUrl} />
      )}
      <button
        className="sb-dl-btn"
        title="Download"
        onClick={(e) => { e.stopPropagation(); onDownload(file.path, file.name, selectedRepo); }}
      >
        ↓
      </button>
    </div>
  );
}

function ConfirmScanModal({ query, scanRepos, prefix, tabLabel, treeCacheRef, onCancel, onConfirm }) {
  const cached = scanRepos.filter((r) => treeCacheRef.current[r.fullName]).length;
  const needFetch = scanRepos.length - cached;
  const eta = Math.max(1, Math.ceil((needFetch / 8) * 1.5));
  return (
    <div className="gs-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="gs-modal">
        <div className="gs-modal-title">Search across repos?</div>
        <div className="gs-modal-body">
          Scan <strong>{scanRepos.length}</strong> repo{scanRepos.length !== 1 ? 's' : ''} for {tabLabel} matching <strong>"{query}"</strong>.<br />
          {cached ? `${cached} cached · ` : ''}{needFetch} need fetching → ~{eta}s estimated.<br />
          {prefix && <span style={{ color: '#666' }}>Limited to prefix "{prefix}"</span>}
        </div>
        <div className="gs-modal-actions">
          <button className="gs-btn" onClick={onCancel}>Cancel</button>
          <button className="gs-btn primary" onClick={onConfirm} autoFocus>Start scan</button>
        </div>
      </div>
    </div>
  );
}

function GlobalSearchView({
  gs, mode, previewableRe, onCancel, onClose, onOpenRepo, onLightbox, onSend, onDownload,
  provider, baseUrl, token, blobCacheRef
}) {
  const [collapsed, setCollapsed] = useState({});
  const isImage = mode === 'art';
  const pct = gs.total ? (gs.scanned / gs.total) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.68rem' }}>
          Results for <span style={{ color: 'var(--accent)' }}>"{gs.rawQuery}"</span>
        </span>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          {gs.running && <button className="gs-btn danger" onClick={onCancel}>Cancel scan</button>}
          <button className="gs-btn" onClick={onClose}>← Back to repos</button>
        </div>
      </div>
      <div className="gs-progress">
        <div className="gs-progress-label">
          <span>{gs.scanned} / {gs.total} repos · <span style={{ color: 'var(--accent)' }}>{gs.matches}</span> matches</span>
          <span>{gs.running ? 'scanning…' : gs.cancelled ? 'cancelled' : 'done'}</span>
        </div>
        <div className="gs-progress-bar"><div className="gs-progress-fill" style={{ width: pct + '%' }} /></div>
      </div>

      <div className="gs-results">
        {gs.results.map((group) => {
          const isCollapsed = collapsed[group.repo.fullName];
          return (
            <div key={group.repo.fullName} className={`gs-group${isCollapsed ? '' : ' expanded'}`}>
              <div
                className="gs-group-header"
                onClick={() => setCollapsed((c) => ({ ...c, [group.repo.fullName]: !c[group.repo.fullName] }))}
              >
                <span className="gs-caret">▸</span>
                <span className="gs-repo-name" title={group.repo.fullName}>{group.repo.name}</span>
                <span className="gs-count">{group.files.length}</span>
                <button
                  className="gs-open-repo"
                  onClick={(e) => { e.stopPropagation(); onOpenRepo(group.repo); }}
                  title="Open this repo with filter applied"
                >
                  Open →
                </button>
              </div>
              <div className="gs-group-body">
                {isImage ? (
                  <div className="cb-image-grid">
                    {group.files.map((p) => {
                      const name = p.split('/').pop();
                      const canPrev = previewableRe.test(name);
                      return (
                        <div
                          key={p}
                          className="cb-image-card"
                          onClick={() => canPrev && onLightbox(p, name, group.repo)}
                        >
                          {canPrev ? (
                            <LazyImg
                              provider={provider}
                              baseUrl={baseUrl}
                              token={token}
                              repo={group.repo}
                              path={p}
                              alt={name}
                              blobCache={blobCacheRef.current}
                            />
                          ) : (
                            <div style={{ width: '100%', height: 110, background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: '.55rem', color: '#444', fontFamily: 'var(--font-mono)' }}>
                                {name.split('.').pop().toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className="cb-image-label">
                            <span className="cb-image-name" title={p}>{highlightMatch(p, gs.rawQuery)}</span>
                            <span className="cb-image-actions">
                              <button
                                className="cb-icon-btn cb-icon-add"
                                title="Add to Art Tools"
                                onClick={(e) => { e.stopPropagation(); onSend(p, name, group.repo); }}
                              >
                                +
                              </button>
                              <button
                                className="cb-icon-btn"
                                title="Download"
                                onClick={(e) => { e.stopPropagation(); onDownload(p, name, group.repo); }}
                              >
                                ↓
                              </button>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="sb-list">
                    {group.files.map((p) => {
                      const name = p.split('/').pop();
                      return (
                        <div className="sb-row" key={p}>
                          <div className="sb-row-meta">
                            <span className="sb-row-name" title={p}>{highlightMatch(p, gs.rawQuery)}</span>
                            <span className="sb-row-info">{name.split('.').pop().toUpperCase()}</span>
                          </div>
                          <button
                            className="btn sb-play-btn"
                            onClick={(e) => { e.stopPropagation(); onLightbox(p, name, group.repo); }}
                            title="Open in repo"
                          >
                            Open
                          </button>
                          <button
                            className="sb-dl-btn"
                            onClick={(e) => { e.stopPropagation(); onDownload(p, name, group.repo); }}
                          >
                            ↓
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!gs.running && !gs.results.length && <div className="gs-empty">No matches found.</div>}
      </div>
    </div>
  );
}
