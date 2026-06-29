// Virtual FileSystemDirectoryHandle backed by a GitHub / GitLab repo tree.
//
// Why: Scene Studio's whole loading layer (scanProjectAssets,
// loadProjectFromHandle, resolveAssetUrl, saveProject) only relies on the
// FileSystemDirectoryHandle DUCK-TYPE — kind/name/entries()/getDirectoryHandle/
// getFileHandle().getFile(). `virtualHandle.js` already exploits this for the
// Firefox/Safari File[] fallback. This module does the same, but the leaf
// files are fetched LAZILY over the network from a repo (auth headers via
// utils/repoBrowser), so an artist can open a repo folder AS the workspace.
//
// The handle is READ-ONLY (writable:false) so saveProject/saveScene fall back
// to a download. Re-linking on session restore is driven by `repoMeta` (a
// fully-serializable descriptor — no token, no tree).
//
// Sibling: engine/virtualHandle.js (same skeleton, but local File leaves).

import { authBlobUrl } from '../../../utils/repoBrowser.js';

const REPO_MARK = Symbol.for('sceneStudio.repoHandle');

export function isRepoHandle(h) {
  return !!(h && h[REPO_MARK]);
}

/**
 * Build a read-only repo-backed root directory handle from an already-fetched
 * flat tree (`utils/repoBrowser.fetchTree` output: `[{path,type,size}]`),
 * scoped to `subPath`. Files under `subPath` are re-rooted (the prefix is
 * stripped) so the chosen folder becomes the handle root.
 *
 * @param {object} p
 * @param {'github'|'gitlab'} p.provider
 * @param {string} p.token
 * @param {string} p.baseUrl
 * @param {object} p.repo      normalized repo { owner, name, fullName, defaultBranch, ... }
 * @param {string} [p.subPath] folder within the repo to use as the root
 * @param {Array<{path:string,type:string,size:number}>} p.tree
 * @param {object} [p.blobCache] shared blob: URL cache (RepoBrowser blobCacheRef.current)
 * @returns {object} virtual directory handle
 */
export function makeRepoRootHandle({ provider, token, baseUrl, repo, subPath = '', tree, blobCache }) {
  if (!repo || !Array.isArray(tree)) throw new Error('makeRepoRootHandle: repo + tree required');
  const cache = blobCache || {};
  const branch = repo.defaultBranch || 'main';
  const sub = normPath(subPath);
  const prefix = sub ? sub + '/' : '';

  // Lazy leaf fetcher: full repo path → File. authBlobUrl does the
  // authenticated fetch + caches a blob: URL keyed `fullName|path` (shared
  // with the Content Browser); we re-fetch that same-origin blob: URL to wrap
  // the bytes in a File so callers get .text() and a Blob for createObjectURL.
  const fetchFile = async (repoPath, name) => {
    const url = await authBlobUrl(provider, token, baseUrl, repo, repoPath, cache);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Repo fetch ' + resp.status + ' — ' + repoPath);
    const blob = await resp.blob();
    return new File([blob], name, { type: blob.type });
  };

  const rootName = sub ? sub.split('/').pop() : (repo.name || 'workspace');
  const root = makeDir(rootName, fetchFile);

  for (const item of tree) {
    if (item.type !== 'blob') continue; // dirs are derived from blob paths
    const path = item.path;
    if (prefix && !path.startsWith(prefix)) continue;
    const rel = prefix ? path.slice(prefix.length) : path;
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length) continue;
    insertFile(root, parts, path);
  }

  root.repoMeta = {
    kind: 'repo',
    provider,
    baseUrl,
    repo: {
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      defaultBranch: branch,
      isPrivate: repo.isPrivate,
      canWrite: !!repo.canWrite
    },
    subPath: sub
  };
  return root;
}

function makeDir(name, fetchFile) {
  const dirs = new Map();
  const files = new Map(); // childName → full repo path
  const handle = {
    [REPO_MARK]: true,
    kind: 'directory',
    name,
    writable: false,
    _dirs: dirs,
    _files: files,
    _fetchFile: fetchFile,
    async getDirectoryHandle(childName, opts) {
      const existing = dirs.get(childName);
      if (existing) return existing;
      if (opts?.create) throw readOnlyError();
      throw notFound(childName);
    },
    async getFileHandle(childName, opts) {
      if (opts?.create) throw readOnlyError();
      const repoPath = files.get(childName);
      if (repoPath === undefined) throw notFound(childName);
      return makeFileHandle(childName, repoPath, fetchFile);
    },
    entries() {
      const dirEntries = Array.from(dirs.entries());
      const fileEntries = Array.from(files.entries()).map(([n, repoPath]) => [
        n,
        makeFileHandle(n, repoPath, fetchFile)
      ]);
      const all = [...dirEntries, ...fileEntries];
      let i = 0;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (i >= all.length) return { value: undefined, done: true };
          return { value: all[i++], done: false };
        }
      };
    }
  };
  return handle;
}

function makeFileHandle(name, repoPath, fetchFile) {
  return {
    kind: 'file',
    name,
    getFile: async () => fetchFile(repoPath, name),
    async createWritable() { throw readOnlyError(); }
  };
}

function insertFile(root, parts, repoPath) {
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    if (!cursor._dirs.has(seg)) cursor._dirs.set(seg, makeDir(seg, cursor._fetchFile));
    cursor = cursor._dirs.get(seg);
  }
  cursor._files.set(parts[parts.length - 1], repoPath);
}

function normPath(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).join('/');
}

function readOnlyError() {
  return new Error('Repo workspace is read-only — saves download (or use Commit to repo).');
}

function notFound(name) {
  const err = new Error(`'${name}' not found`);
  err.name = 'NotFoundError';
  return err;
}
