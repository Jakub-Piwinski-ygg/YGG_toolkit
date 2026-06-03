// Scene persistence: load/save scene.json + asset resolution.
//
// Two modes share one file format:
//   - Quick mode: assets[].src is `data:...base64`. Self-contained.
//   - Scaffold mode: assets[].src is a relative path from projectRoot.
//
// Scaffold mode uses the File System Access API. The directory handle is
// kept in memory for the session; restoring it across reloads is a Chrome-
// only feature backed by IndexedDB and is deferred to a later phase.

import { validateScene } from './sceneModel.js';
import { bakePathToKeys, isPathChannel } from './animation/keyframes.js';

const PRETTY_JSON_INDENT = 2;
const SCENE_SCAN_MAX_DEPTH = 12;
const SCENE_SCAN_SKIP_DIRS = new Set([
  'Library', 'Logs', 'Temp', 'obj', 'Build', 'Builds', 'UserSettings',
  'node_modules', '.git', '.idea', '.vs', '.gradle'
]);

export function isFsAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function isDropDirectorySupported() {
  return typeof window !== 'undefined' && typeof DataTransferItem !== 'undefined'
    && typeof DataTransferItem.prototype?.getAsFileSystemHandle === 'function';
}

export function isFilePickerSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

/**
 * Read a File as base64 data URL.
 * @param {File|Blob} file
 * @param {string} [mime]
 * @returns {Promise<string>}
 */
export async function fileToDataUrl(file, mime) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    if (mime && file instanceof Blob) r.readAsDataURL(new Blob([file], { type: mime }));
    else r.readAsDataURL(file);
  });
}

/**
 * Save a scene to JSON. In scaffold mode (rootHandle provided + supported),
 * writes `scene.json` inside the picked folder. Otherwise triggers a browser
 * download.
 *
 * @param {object} scene
 * @param {FileSystemDirectoryHandle|null} rootHandle
 * @returns {Promise<{mode:'scaffold'|'download', path?:string}>}
 */
/**
 * Bake path-mode position channels down to plain x/y keys for the saved
 * scene.json. The baked `keys` are written ALONGSIDE the `path` source: the
 * game engine reads the plain `keys` (no arc-length math needed), while the
 * toolkit re-opens the editable `path` (normalizeChannels prefers path mode
 * and ignores the redundant keys on load).
 */
export function bakePathsForExport(scene) {
  if (!scene?.flow?.tracks) return scene;
  let changed = false;
  const tracks = scene.flow.tracks.map((tr) => {
    if (!tr.clips?.length) return tr;
    const clips = tr.clips.map((c) => {
      const pos = c.channels?.position;
      if (!isPathChannel(pos)) return c;
      const baked = bakePathToKeys(pos, c.duration, pos.path?.bakeFps || 30);
      if (!baked?.keys?.length) return c;
      changed = true;
      return { ...c, channels: { ...c.channels, position: { ...pos, keys: baked.keys } } };
    });
    return { ...tr, clips };
  });
  return changed ? { ...scene, flow: { ...scene.flow, tracks } } : scene;
}

export async function saveScene(scene, rootHandle) {
  const rel = normalizeRelPath(scene?.projectRoot || '');
  const sceneForSave = { ...bakePathsForExport(scene), projectRoot: rel || null };
  const text = JSON.stringify(sceneForSave, null, PRETTY_JSON_INDENT);
  // Writable scaffold-mode save needs both a real (writable) handle AND a
  // browser that supports the FS Access API. Virtual handles from the
  // Firefox / Safari fallback are read-only — they fall through to the
  // download path below.
  const canWrite = rootHandle
    && isFsAccessSupported()
    && rootHandle.writable !== false
    && typeof rootHandle.getFileHandle === 'function';
  if (canWrite) {
    try {
      const sceneDir = await resolveSceneDirectory(rootHandle, rel || null, true);
      const fileHandle = await sceneDir.getFileHandle('scene.json', { create: true });
      if (typeof fileHandle.createWritable === 'function') {
        const w = await fileHandle.createWritable();
        await w.write(text);
        await w.close();
        return { mode: 'scaffold', path: rel ? `${rel}/scene.json` : 'scene.json' };
      }
    } catch (e) {
      // Fall through to download — surface in console for diagnosis.
      console.warn('[SceneStudio] in-place save failed, falling back to download', e);
    }
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(scene.name || 'scene').replace(/[\\/:*?"<>|]/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { mode: 'download' };
}

/**
 * Pick a project folder via FS Access API. Returns null when the user
 * cancels the dialog or when FS Access is unsupported. Any other error
 * (security/permission/etc.) is rethrown so the caller can log it instead
 * of silently appearing to do nothing.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function pickProjectRoot() {
  if (!isFsAccessSupported()) {
    throw new Error('File System Access API not available — use Chrome or Edge over HTTPS / localhost.');
  }
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e?.name === 'AbortError') return null; // user cancelled
    throw e;
  }
}

/**
 * Try to read a dropped directory as a File System Access handle.
 * Works in Chromium-based browsers that expose
 * DataTransferItem#getAsFileSystemHandle.
 *
 * @param {DragEvent} e
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function getDroppedDirectoryHandle(e) {
  const items = Array.from(e?.dataTransfer?.items || []);
  for (const item of items) {
    if (item.kind !== 'file' || typeof item.getAsFileSystemHandle !== 'function') continue;
    try {
      const h = await item.getAsFileSystemHandle();
      if (h?.kind === 'directory') return h;
    } catch {
      // ignore invalid item and continue
    }
  }
  return null;
}

/**
 * Try to load scene.json from a directory handle. Returns null if absent.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<object|null>}
 */
export async function loadSceneFromHandle(rootHandle) {
  const candidates = [];
  const direct = await tryReadSceneAt(rootHandle, '');
  if (direct) candidates.push(direct);
  if (!direct) {
    await collectSceneCandidates(rootHandle, '', 0, candidates);
  }
  if (!candidates.length) return null;
  const picked = pickBestSceneCandidate(candidates);
  const scene = validateScene(JSON.parse(picked.text));
  // Anchor the scene to where it was discovered relative to the picked root,
  // so selecting parent folders (e.g. Art) and child folders (_Game) can
  // load the same scene + assets.
  scene.projectRoot = picked.dirPath || null;
  return scene;
}

/**
 * Scan a project root for ALL scene files: every `*.json` that parses and
 * looks like a YGG scene. Returns `[{ relPath, dirPath, name, file }]` sorted
 * by path. Used to populate the scene-switch dropdown.
 */
export async function scanProjectScenes(rootHandle, opts = {}) {
  if (!rootHandle) return [];
  const out = [];
  await collectJsonScenes(rootHandle, '', 0, out, opts);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

async function collectJsonScenes(dirHandle, relDir, depth, out, opts) {
  if (!dirHandle || depth > SCENE_SCAN_MAX_DEPTH) return;
  if (opts.signal?.aborted) return;
  let iter;
  try { iter = dirHandle.entries(); } catch { return; }
  try {
    for await (const [name, h] of iter) {
      if (opts.signal?.aborted) return;
      if (name.startsWith('.')) continue;
      if (h.kind === 'file') {
        if (!name.toLowerCase().endsWith('.json')) continue;
        try {
          const file = await h.getFile();
          const parsed = JSON.parse(await file.text());
          const looksScene = parsed && typeof parsed === 'object' && (
            (typeof parsed.$schema === 'string' && parsed.$schema.startsWith('ygg-scene/'))
            || (parsed.stage && typeof parsed.stage === 'object' && Array.isArray(parsed.layers))
          );
          if (!looksScene) continue;
          const scene = validateScene(parsed); // throws on bad schema
          const fileRel = relDir ? `${relDir}/${name}` : name;
          out.push({
            relPath: normalizeRelPath(fileRel),
            dirPath: normalizeRelPath(relDir),
            name: scene.name || name.replace(/\.json$/i, ''),
            file: name
          });
        } catch { /* not a scene / unreadable — skip */ }
        continue;
      }
      if (h.kind === 'directory') {
        if (SCENE_SCAN_SKIP_DIRS.has(name)) continue;
        const child = relDir ? `${relDir}/${name}` : name;
        await collectJsonScenes(h, child, depth + 1, out, opts);
      }
    }
  } catch { /* ignore transient read failures */ }
}

/**
 * Load a specific scene by its relative path from the project root. Anchors
 * `scene.projectRoot` to the file's directory so assets resolve correctly.
 */
export async function loadSceneByRelPath(rootHandle, relPath) {
  if (!rootHandle || !relPath) return null;
  const parts = splitRelPath(relPath);
  const fileName = parts.pop();
  let dir = rootHandle;
  for (const seg of parts) dir = await dir.getDirectoryHandle(seg);
  const fh = await dir.getFileHandle(fileName);
  const f = await fh.getFile();
  const scene = validateScene(JSON.parse(await f.text()));
  scene.projectRoot = normalizeRelPath(parts.join('/')) || null;
  return scene;
}

/**
 * Load a scene from a user-picked JSON file (quick mode).
 * @returns {Promise<object|null>}
 */
export async function loadSceneFromFile() {
  if (isFilePickerSupported()) {
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        types: [{ description: 'Scene JSON', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
    } catch {
      return null;
    }
    const file = await handles[0].getFile();
    return validateScene(JSON.parse(await file.text()));
  }
  // Fallback: hidden <input type=file>
  return await new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(validateScene(JSON.parse(await file.text())));
      } catch (e) {
        alert(`Failed to load scene: ${e.message || e}`);
        resolve(null);
      }
    };
    inp.click();
  });
}

/**
 * Resolve an asset src to an object URL that Pixi can load.
 *
 * If src is a data URL → return as-is (Pixi accepts data URLs).
 * If src is a relative path + rootHandle is available → walk the dir handle,
 *   read the File, return URL.createObjectURL(file).
 *
 * Returns null if the asset cannot be resolved.
 *
 * @param {string} src
 * @param {FileSystemDirectoryHandle|null} rootHandle
 * @returns {Promise<{url:string, file?:File}|null>}
 */
export async function resolveAssetUrl(src, rootHandle, sceneBasePath = null) {
  if (typeof src !== 'string') return null;
  if (src.startsWith('data:')) return { url: src };
  if (!rootHandle) return null;

  for (const relPath of buildResolutionCandidates(src, sceneBasePath)) {
    const file = await resolveAssetFile(relPath, rootHandle, null);
    if (file) return { url: URL.createObjectURL(file), file };
  }
  return null;
}

/**
 * Resolve a relative path in project root and return File.
 * Returns null when not found.
 */
export async function resolveAssetFile(relPath, rootHandle, sceneBasePath = null) {
  if (!rootHandle || !relPath || typeof relPath !== 'string') return null;
  for (const candidate of buildResolutionCandidates(relPath, sceneBasePath)) {
    const file = await resolveFileAt(rootHandle, candidate);
    if (file) return file;
  }
  return null;
}

function splitRelPath(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean);
}

function normalizeRelPath(path) {
  return splitRelPath(path).join('/');
}

function buildResolutionCandidates(src, sceneBasePath) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const n = normalizeRelPath(v);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  push(src);
  const base = normalizeRelPath(sceneBasePath || '');
  if (base) push(`${base}/${src}`);
  return out;
}

async function resolveSceneDirectory(rootHandle, relPath, create) {
  const parts = splitRelPath(relPath);
  let h = rootHandle;
  for (const seg of parts) {
    h = await h.getDirectoryHandle(seg, create ? { create: true } : undefined);
  }
  return h;
}

async function resolveFileAt(rootHandle, relPath) {
  const segments = splitRelPath(relPath);
  if (!segments.length) return null;
  try {
    let h = rootHandle;
    for (let i = 0; i < segments.length - 1; i++) {
      h = await h.getDirectoryHandle(segments[i]);
    }
    const fh = await h.getFileHandle(segments[segments.length - 1]);
    return await fh.getFile();
  } catch {
    return null;
  }
}

async function tryReadSceneAt(rootHandle, relDir) {
  try {
    const dir = await resolveSceneDirectory(rootHandle, relDir, false);
    const fh = await dir.getFileHandle('scene.json');
    const file = await fh.getFile();
    return { dirPath: normalizeRelPath(relDir), text: await file.text() };
  } catch {
    return null;
  }
}

async function collectSceneCandidates(dirHandle, relDir, depth, out) {
  if (!dirHandle || depth > SCENE_SCAN_MAX_DEPTH) return;
  let iter;
  try {
    iter = dirHandle.entries();
  } catch {
    return;
  }
  try {
    for await (const [name, h] of iter) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'file') {
        if (name.toLowerCase() !== 'scene.json') continue;
        try {
          const file = await h.getFile();
          out.push({ dirPath: normalizeRelPath(relDir), text: await file.text() });
        } catch {
          /* ignore unreadable candidate */
        }
        continue;
      }
      if (h.kind === 'directory') {
        if (SCENE_SCAN_SKIP_DIRS.has(name)) continue;
        const child = relDir ? `${relDir}/${name}` : name;
        await collectSceneCandidates(h, child, depth + 1, out);
      }
    }
  } catch {
    /* ignore transient read failures */
  }
}

function pickBestSceneCandidate(candidates) {
  const score = (c) => {
    const segs = splitRelPath(c.dirPath);
    const last = segs[segs.length - 1] || '';
    const hasGame = segs.some((s) => s.toLowerCase() === '_game');
    const lastIsGame = last.toLowerCase() === '_game';
    return [lastIsGame ? 0 : hasGame ? 1 : 2, segs.length, c.dirPath];
  };
  return [...candidates].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] < sb[i]) return -1;
      if (sa[i] > sb[i]) return 1;
    }
    return 0;
  })[0];
}
