// Shared GitHub/GitLab API helpers used by both ContentBrowser (art) and
// SoundBrowser tabs. Keeping them here so both tools agree on auth flow,
// URL shapes, and tree shape.

export const IMG_EXTS = /\.(png|jpg|jpeg|webp|gif|svg|bmp|ico)$/i;
export const IMG_FULL_EXTS = /\.(png|jpg|jpeg|webp|gif|svg|bmp|tga|psd|tiff|tif|ico)$/i;
export const SOUND_EXTS = /\.(wav|mp3|ogg|flac|aac|m4a|wma|opus|aiff|aif)$/i;

export const LS_KEY = 'ygg_gh_config_react';

export function detectProvider(token) {
  if (!token) return null;
  if (token.startsWith('glpat-')) return 'gitlab';
  if (token.startsWith('ghp_') || token.startsWith('github_pat_')) return 'github';
  if (/^[A-Za-z0-9_-]{20}$/.test(token)) return 'gitlab';
  return null;
}

export function authHeaders(provider, token) {
  if (!token) return {};
  return provider === 'gitlab'
    ? { 'PRIVATE-TOKEN': token }
    : { Authorization: 'Bearer ' + token };
}

export function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

export function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return d + 'd ago';
  if (d < 365) return Math.floor(d / 30) + 'mo ago';
  return Math.floor(d / 365) + 'y ago';
}

export function stripPrefix(name, prefix) {
  if (!prefix || !name.startsWith(prefix)) return name;
  let rest = name.slice(prefix.length);
  if (rest.startsWith('-') || rest.startsWith('_') || rest.startsWith('.')) rest = rest.slice(1);
  return rest || name;
}

export async function fetchRepos(provider, token, baseUrl, searchPrefix) {
  const headers = authHeaders(provider, token);
  if (provider === 'gitlab') {
    const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
    const all = [];
    let page = 1;
    const sp = searchPrefix ? '&search=' + encodeURIComponent(searchPrefix) : '';
    while (true) {
      const r = await fetch(
        `${base}/api/v4/projects?membership=true&min_access_level=10&per_page=100&order_by=last_activity_at${sp}&page=${page}`,
        { headers }
      );
      if (!r.ok) {
        if (r.status === 401) throw new Error('401 — token rejected');
        if (r.status === 403) throw new Error('403 — need read_api scope');
        throw new Error('GitLab API ' + r.status);
      }
      const data = await r.json();
      if (!data.length) break;
      for (const x of data)
        all.push({
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
    for (const x of data)
      all.push({
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
  return searchPrefix
    ? all.filter((r) => r.name.startsWith(searchPrefix) || r.fullName.includes(searchPrefix))
    : all;
}

export async function fetchTree(provider, token, baseUrl, repo) {
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
  const r = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json', ...headers } }
  );
  if (!r.ok) throw new Error('GitHub tree ' + r.status);
  return ((await r.json()).tree || []).map((i) => ({
    path: i.path,
    type: i.type === 'tree' ? 'tree' : 'blob',
    size: i.size || 0
  }));
}

export function listDir(prefix, tree, typeFilter) {
  if (!tree) return { folders: [], files: [] };
  const norm = prefix ? prefix.replace(/\/$/, '') + '/' : '';
  const folderSet = new Set();
  const files = [];
  for (const item of tree) {
    if (norm && !item.path.startsWith(norm)) continue;
    if (
      !norm &&
      item.type === 'blob' &&
      !item.path.includes('/') &&
      (!typeFilter || typeFilter(item.path))
    ) {
      files.push({ name: item.path, path: item.path, size: item.size || 0 });
      continue;
    }
    if (!norm && item.path.includes('/')) {
      folderSet.add(item.path.split('/')[0]);
      continue;
    }
    const rest = item.path.slice(norm.length);
    if (!rest) continue;
    const si = rest.indexOf('/');
    if (si !== -1) folderSet.add(rest.slice(0, si));
    else if (item.type === 'blob' && (!typeFilter || typeFilter(item.path))) {
      files.push({ name: rest, path: item.path, size: item.size || 0 });
    }
  }
  const folders = [...folderSet]
    .sort()
    .map((name) => {
      const fp = (norm || '') + name + '/';
      let count = 0;
      for (const it of tree)
        if (it.type === 'blob' && it.path.startsWith(fp) && (!typeFilter || typeFilter(it.path)))
          count++;
      return { name, path: (norm || '') + name, count };
    })
    .filter((f) => f.count > 0);
  // Collapse single-child folder chains
  const collapsed = folders.map((f) => {
    let p = f.path,
      n = f.name;
    while (true) {
      const sub = listDir(p, tree, typeFilter);
      if (sub.folders.length === 1 && sub.files.length === 0) {
        p = sub.folders[0].path;
        n += '/' + sub.folders[0].name;
      } else break;
    }
    return { name: n, path: p, count: f.count };
  });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders: collapsed, files };
}

export function rawUrl(provider, baseUrl, repo, path) {
  const branch = repo.defaultBranch || 'main';
  if (provider === 'gitlab') {
    const base = (baseUrl || 'https://gitlab.yggdrasil.lan').replace(/\/$/, '');
    const projId = encodeURIComponent(repo.fullName);
    return `${base}/api/v4/projects/${projId}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;
  }
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(branch)}/${path}`;
}

export async function authBlobUrl(provider, token, baseUrl, repo, path, cache) {
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
    url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branch)}`;
    headers = { ...authHeaders(provider, token), Accept: 'application/vnd.github.raw' };
  }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('Fetch ' + r.status);
  const blob = await r.blob();
  const u = URL.createObjectURL(blob);
  cache[key] = u;
  return u;
}

// Run an async worker over `items` with bounded concurrency. shouldAbort() is
// polled between items so a long scan can be cancelled mid-flight.
export async function runPool(items, worker, concurrency = 8, shouldAbort) {
  let idx = 0;
  const next = () => (idx < items.length ? items[idx++] : null);
  const runners = [];
  for (let i = 0; i < concurrency; i++) {
    runners.push(
      (async () => {
        while (true) {
          if (shouldAbort && shouldAbort()) break;
          const item = next();
          if (item == null) break;
          try {
            await worker(item);
          } catch {
            /* skip failed item */
          }
        }
      })()
    );
  }
  await Promise.all(runners);
}
