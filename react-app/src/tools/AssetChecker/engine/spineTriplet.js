// Find Spine exports across the index, tolerating:
//   - .atlas vs .atlas.txt (handled in fileIndex.makeEntry)
//   - sibling atlas with a different base name (flagged separately)
//   - multi-skeleton: many .json + one atlas in same dir is valid
//     (Symbols are the canonical case — every symbol has its own skeleton
//     but they all share a single atlas to keep draw calls down).
//
// Returns: [{ json, atlas, baseMismatch, multiSkeleton, sharedAtlasJsonCount }, ...]

export function findSpineExports(index) {
  const jsons = index.byExt.get('json') || [];

  // Pre-count jsons per directory that have at least one atlas sibling.
  const jsonsPerDir = new Map();
  for (const j of jsons) {
    const dirAtlases = (index.byDir.get(j.dir) || []).filter((e) => e.ext === 'atlas');
    if (!dirAtlases.length) continue;
    jsonsPerDir.set(j.dir, (jsonsPerDir.get(j.dir) || 0) + 1);
  }

  const out = [];
  for (const j of jsons) {
    const dirAtlases = (index.byDir.get(j.dir) || []).filter((e) => e.ext === 'atlas');
    if (!dirAtlases.length) continue;
    const base = j.name.replace(/\.json$/i, '').toLowerCase();
    let atlas = dirAtlases.find((a) => {
      const aBase = a.name.replace(/\.atlas\.txt$/i, '').replace(/\.atlas$/i, '').toLowerCase();
      return aBase === base;
    });
    let baseMismatch = false;
    let multiSkeleton = false;
    const sharedAtlasJsonCount = jsonsPerDir.get(j.dir) || 1;

    if (!atlas) {
      atlas = dirAtlases[0];
      // Multi-skeleton-with-shared-atlas pattern: many .json + 1 atlas → valid.
      if (sharedAtlasJsonCount > 1 && dirAtlases.length === 1) {
        multiSkeleton = true;
      } else {
        baseMismatch = true;
      }
    }
    out.push({ json: j, atlas, baseMismatch, multiSkeleton, sharedAtlasJsonCount });
  }
  return out;
}

// Skip per-asset checks for raw / WIP files under any Source/ folder.
export function isUnderSource(entry) {
  return entry.segments.some((s) => s.toLowerCase() === 'source');
}

// Preview folder detection — accept "Preview" or "Previews" (case-insensitive)
export function isUnderPreview(entry) {
  return entry.segments.some((s) => /^previews?$/i.test(s));
}
