// Virtual FileSystemDirectoryHandle backed by a flat list of File objects.
//
// Why: the File System Access API (window.showDirectoryPicker,
// FileSystemDirectoryHandle) is Chromium-only. Firefox and Safari cannot
// produce a real directory handle. But every browser can produce a flat
// `File[]` with `webkitRelativePath` populated — either via
//   <input type="file" webkitdirectory>
// or via drag-and-drop using `DataTransferItem.webkitGetAsEntry()`.
//
// This module wraps that flat list in an object that quacks like
// FileSystemDirectoryHandle for the operations Scene Studio actually uses:
//   - h.kind === 'directory'
//   - h.name
//   - h.entries()       async iterator over [name, childHandle]
//   - h.getDirectoryHandle(name)
//   - h.getFileHandle(name)        returns { kind:'file', name, getFile() }
//
// The virtual handle is READ-ONLY (no createWritable). Callers that need
// to write back must check `handle.writable === true` before attempting.

const VIRTUAL_MARK = Symbol.for('sceneStudio.virtualHandle');

/**
 * Build a virtual root directory handle from a flat list of File objects.
 * Each file's `webkitRelativePath` (or `relativePath`) determines its
 * position in the tree. Files with empty relative paths are placed at the
 * root.
 *
 * @param {Iterable<File>} files
 * @param {string} [name='workspace']  display name for the root
 * @returns {object} virtual directory handle
 */
export function makeVirtualRootHandle(files, name) {
  const root = makeDir(name || 'workspace');
  for (const file of files) {
    const rel = file.webkitRelativePath || file.relativePath || file.name;
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length) continue;
    // Strip the leading folder name if every file shares it. We can't tell
    // here, so just place everything under its full relative path; the root
    // handle's `name` is purely cosmetic.
    insertFile(root, parts, file);
  }
  // Many <input webkitdirectory> implementations include the picked folder
  // as the first path segment for every file. Detect and collapse that so
  // the tree shown to the user starts at the picked folder's content, not
  // its container.
  collapseSingleLeadingDir(root);
  return root;
}

function makeDir(name) {
  const dirs = new Map();
  const files = new Map();
  const handle = {
    [VIRTUAL_MARK]: true,
    kind: 'directory',
    name,
    writable: false,
    // Subtree storage (private)
    _dirs: dirs,
    _files: files,
    async getDirectoryHandle(childName, opts) {
      const existing = dirs.get(childName);
      if (existing) return existing;
      if (opts?.create) {
        const created = makeDir(childName);
        dirs.set(childName, created);
        return created;
      }
      throw notFound(childName);
    },
    async getFileHandle(childName) {
      const f = files.get(childName);
      if (!f) throw notFound(childName);
      return {
        kind: 'file',
        name: childName,
        getFile: async () => f,
        async createWritable() { throw new Error('Virtual handle is read-only — workspace was opened via Firefox/Safari fallback.'); }
      };
    },
    entries() {
      // Async iterator yielding [name, childHandle] for both dirs and files.
      const dirEntries = Array.from(dirs.entries());
      const fileEntries = Array.from(files.entries()).map(([n, f]) => [n, {
        kind: 'file',
        name: n,
        getFile: async () => f
      }]);
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

function insertFile(root, parts, file) {
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    if (!cursor._dirs.has(seg)) cursor._dirs.set(seg, makeDir(seg));
    cursor = cursor._dirs.get(seg);
  }
  cursor._files.set(parts[parts.length - 1], file);
}

function collapseSingleLeadingDir(root) {
  // If the root has exactly one child directory and no files, hoist that
  // directory's contents up so the user sees their picked folder's content
  // at the top level. Repeat once at most (some pickers wrap twice).
  //
  // We MUTATE the existing Maps in place because the handle's
  // getDirectoryHandle / getFileHandle / entries methods close over them.
  // Reassigning handle._dirs would leave the methods looking at the old,
  // now-empty Map.
  for (let pass = 0; pass < 2; pass++) {
    if (root._files.size !== 0 || root._dirs.size !== 1) break;
    const [onlyName, onlyDir] = root._dirs.entries().next().value;
    root.name = onlyName;
    root._dirs.clear();
    for (const [k, v] of onlyDir._dirs) root._dirs.set(k, v);
    for (const [k, v] of onlyDir._files) root._files.set(k, v);
  }
}

function notFound(name) {
  const err = new Error(`'${name}' not found`);
  err.name = 'NotFoundError';
  return err;
}

export function isVirtualHandle(h) {
  return !!(h && h[VIRTUAL_MARK]);
}

/**
 * Walk a DataTransferItemList and return a flat File[] with
 * `webkitRelativePath` populated. Works in every browser that supports
 * `DataTransferItem.webkitGetAsEntry()` — i.e. Chrome, Firefox, Safari,
 * Edge. The File System Access API is NOT required.
 *
 * @param {DataTransferItemList} items
 * @returns {Promise<File[]>}
 */
export async function readFolderDropAsFiles(items) {
  const out = [];
  const tasks = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (!entry) {
      const f = item.getAsFile?.();
      if (f) {
        if (!f.relativePath) Object.defineProperty(f, 'relativePath', { value: f.name });
        out.push(f);
      }
      continue;
    }
    tasks.push(walkEntry(entry, '', out));
  }
  await Promise.all(tasks);
  return out;
}

async function walkEntry(entry, prefix, sink) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const rel = prefix + file.name;
    if (!file.webkitRelativePath) {
      // File System Entry API doesn't populate webkitRelativePath; stash
      // it on a non-enumerable property so consumer code can read it.
      try { Object.defineProperty(file, 'relativePath', { value: rel }); } catch { /* frozen file */ }
    }
    sink.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      all.push(...batch);
    } while (batch.length > 0);
    await Promise.all(all.map((child) => walkEntry(child, prefix + entry.name + '/', sink)));
  }
}
