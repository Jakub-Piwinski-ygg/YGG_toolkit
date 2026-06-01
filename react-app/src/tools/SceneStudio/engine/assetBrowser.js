const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

// Unity / IDE / VCS noise. Walking these can take tens of seconds on big
// projects and never contains art. Names match the directory entry name
// (case-sensitive — Unity creates these exactly).
const SKIP_DIRS = new Set([
  'Library', 'Logs', 'Temp', 'obj', 'Build', 'Builds', 'UserSettings',
  'node_modules', '.git', '.idea', '.vs', '.gradle'
]);

function kind(name) {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.atlas(\.txt)?$/i.test(name)) return 'atlas';
  if (/\.png$/i.test(name)) return 'png';
  if (VIDEO_EXT.test(name)) return 'video';
  return null;
}

function base(name) {
  return name.replace(/\.atlas\.txt$/i, '').replace(/\.(json|atlas|png)$/i, '');
}

/**
 * Scan project root and return grouped entries for the Asset Browser.
 * Spine grouping supports shared atlas+texture pattern (many .json using one pair).
 *
 * Resilient: a directory that fails to read (permission, deleted between
 * walks) is logged and skipped — the rest of the tree still loads.
 */
export async function scanProjectAssets(rootHandle, opts = {}) {
  if (!rootHandle) return [];
  const { onProgress, signal } = opts;
  const byDir = new Map();
  const errors = [];
  let visited = 0;

  const walk = async (dirHandle, relDir = '', depth = 0) => {
    if (signal?.aborted) return;
    if (depth > 12) return; // sanity
    let entries;
    try {
      entries = dirHandle.entries();
    } catch (e) {
      errors.push({ path: relDir, error: e });
      return;
    }
    try {
      for await (const [name, h] of entries) {
        if (signal?.aborted) return;
        if (name.startsWith('.')) continue;
        if (h.kind === 'directory') {
          if (SKIP_DIRS.has(name)) continue;
          const child = relDir ? `${relDir}/${name}` : name;
          try {
            await walk(h, child, depth + 1);
          } catch (e) {
            errors.push({ path: child, error: e });
          }
        } else {
          const filePath = relDir ? `${relDir}/${name}` : name;
          const k = kind(name);
          if (!k) continue;
          if (name.toLowerCase() === 'scene.json') continue;
          if (!byDir.has(relDir)) byDir.set(relDir, []);
          byDir.get(relDir).push({ name, path: filePath, kind: k });
          visited++;
          if (onProgress && visited % 50 === 0) onProgress(visited);
        }
      }
    } catch (e) {
      errors.push({ path: relDir, error: e });
    }
  };

  await walk(rootHandle, '');

  const out = [];
  for (const [folder, files] of byDir.entries()) {
    const jsons = files.filter((f) => f.kind === 'json');
    const atlases = files.filter((f) => f.kind === 'atlas');
    const pngs = files.filter((f) => f.kind === 'png');
    const videos = files.filter((f) => f.kind === 'video');

    const atlasByBase = new Map(atlases.map((f) => [base(f.name), f]));
    const pngByBase = new Map(pngs.map((f) => [base(f.name), f]));
    const loneAtlas = atlases.length === 1 ? atlases[0] : null;
    const lonePng = pngs.length === 1 ? pngs[0] : null;

    const usedPng = new Set();
    const usedAtlas = new Set();

    for (const j of jsons) {
      const b = base(j.name);
      const a = atlasByBase.get(b) || loneAtlas;
      const p = pngByBase.get(b) || lonePng;
      if (a && p) {
        out.push({
          id: `spine:${j.path}`,
          type: 'spine',
          name: b,
          folder,
          jsonPath: j.path,
          atlasPath: a.path,
          texturePath: p.path
        });
        usedAtlas.add(a.path);
        usedPng.add(p.path);
      }
    }

    for (const p of pngs) {
      if (usedPng.has(p.path)) continue;
      out.push({ id: `png:${p.path}`, type: 'png', name: p.name, folder, path: p.path });
    }
    for (const v of videos) {
      out.push({ id: `video:${v.path}`, type: 'video', name: v.name, folder, path: v.path });
    }
  }

  out.sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name));

  if (errors.length && typeof console !== 'undefined') {
    console.warn(`[SceneStudio] asset scan skipped ${errors.length} folder(s):`, errors.slice(0, 5));
  }
  return out;
}
