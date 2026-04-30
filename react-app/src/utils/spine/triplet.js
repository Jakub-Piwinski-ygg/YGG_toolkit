// Locate Spine triplets (json + atlas + textures) inside a flat repo tree.

// Find all (json, atlas) pairs that share the same directory.
// dirOnly — if set, only considers items inside that exact directory.
export function findSpineInTree(tree, dirOnly) {
  const byDir = new Map();
  for (const it of tree) {
    if (it.type !== 'blob') continue;
    const slash = it.path.lastIndexOf('/');
    const dir = slash < 0 ? '' : it.path.slice(0, slash);
    if (dirOnly != null && dir !== dirOnly) continue;
    const name = slash < 0 ? it.path : it.path.slice(slash + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({ path: it.path, name });
  }

  const out = [];
  for (const [dir, files] of byDir) {
    const jsons = files.filter((f) => /\.json$/i.test(f.name));
    const atlases = files.filter((f) => /\.atlas(\.txt)?$/i.test(f.name));
    if (!jsons.length || !atlases.length) continue;
    for (const j of jsons) {
      const base = j.name.replace(/\.json$/i, '').toLowerCase();
      let atlas = atlases.find(
        (a) => a.name.replace(/\.atlas\.txt$/i, '').replace(/\.atlas$/i, '').toLowerCase() === base
      );
      if (!atlas && atlases.length === 1) atlas = atlases[0]; // shared-atlas multi-skeleton
      if (!atlas) continue;
      out.push({ name: j.name.replace(/\.json$/i, ''), dir, jsonPath: j.path, atlasPath: atlas.path });
    }
  }
  return out;
}

// Collect all image files under `dir` (recursive) from a flat repo tree.
// Returns [{path, relName}] where relName is relative to `dir` —
// the form Spine atlases typically reference.
export function collectTextureCandidates(tree, dir) {
  const prefix = dir ? dir + '/' : '';
  const out = [];
  for (const it of tree) {
    if (it.type !== 'blob') continue;
    if (!/\.(png|webp|jpg|jpeg)$/i.test(it.path)) continue;
    if (prefix && !it.path.startsWith(prefix)) continue;
    out.push({ path: it.path, relName: it.path.slice(prefix.length) });
  }
  return out;
}
