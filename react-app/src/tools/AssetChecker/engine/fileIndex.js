// fileIndex — builds searchable views over the ingested file set.
// Each ingested entry is { relPath, name, file, size, ext, dir, segments }.

export function buildIndex(entries) {
  const byPath = new Map();
  const byExt = new Map();
  const byDir = new Map();
  const byBase = new Map(); // base name without extension → entries

  for (const e of entries) {
    byPath.set(e.relPath, e);
    if (!byExt.has(e.ext)) byExt.set(e.ext, []);
    byExt.get(e.ext).push(e);
    if (!byDir.has(e.dir)) byDir.set(e.dir, []);
    byDir.get(e.dir).push(e);
    const base = e.name.replace(/\.[^.]+$/, '');
    const key = (e.dir + '/' + base).toLowerCase();
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(e);
  }

  return {
    entries,
    byPath,
    byExt,
    byDir,
    byBase,

    has(p) { return byPath.has(p); },
    hasCi(p) {
      const lower = p.toLowerCase();
      for (const k of byPath.keys()) if (k.toLowerCase() === lower) return k;
      return null;
    },
    findInFolder(folder, predicate) {
      const list = byDir.get(folder) || [];
      return predicate ? list.filter(predicate) : list;
    },
    listFolders() {
      return [...byDir.keys()].sort();
    },
    listTopFolders() {
      const set = new Set();
      for (const e of entries) {
        const top = e.segments[0] || '';
        if (top) set.add(top);
      }
      return [...set].sort();
    }
  };
}

export function makeEntry(relPath, file) {
  const cleanedRel = relPath.replace(/^\/+/, '');
  const segments = cleanedRel.split('/');
  const name = segments[segments.length - 1];
  const dir = segments.slice(0, -1).join('/');
  const ext = detectExt(name);
  return {
    relPath: cleanedRel,
    name,
    file,
    size: file.size,
    ext,
    dir,
    segments
  };
}

// Treat ".atlas.txt" as an atlas (some Spine exporters add the .txt suffix).
function detectExt(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.atlas.txt')) return 'atlas';
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}
