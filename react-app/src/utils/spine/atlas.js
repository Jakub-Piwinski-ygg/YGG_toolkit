// Atlas page classifier — distinguishes page-name lines from region-name lines.
// Page-only attrs: format / filter / repeat / pma.  Region-only: rotate / xy / orig / offset / index / bounds.
const PAGE_ATTRS = /^(format|filter|repeat|pma)\s*:/;
const REGION_ATTRS = /^(rotate|xy|orig|offset|index|bounds)\s*:/;

function classifyBlock(lines, startI) {
  for (let i = startI + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const t = line.trim();
    if (PAGE_ATTRS.test(t)) return 'page';
    if (REGION_ATTRS.test(t)) return 'region';
    if (!/^\s/.test(line) && !t.includes(':')) return 'region';
  }
  return 'region';
}

// Returns [{lineIndex, name}] for every texture-page entry in the atlas.
// Handles all atlas variants: 3.x / 4.x, with or without extensions,
// with or without subdirectory components in page names.
export function findAtlasPages(atlasText) {
  const lines = atlasText.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s/.test(line)) continue;       // indented → attribute line
    const trimmed = line.trim();
    if (trimmed.includes(':')) continue;  // attribute, not a name
    if (classifyBlock(lines, i) === 'page') {
      out.push({ lineIndex: i, name: trimmed });
    }
  }
  return out;
}

export function extractAtlasPages(atlasText) {
  return findAtlasPages(atlasText).map((p) => p.name);
}

// Given an atlas page name and an array of {path, relName} texture candidates,
// return the best-matching candidate or null.
//
// Matching priority (most-specific first):
//   1. relName === pageName (exact, including extension)
//   2. relName (no ext) === pageName (no ext)
//   3. relName basename === pageName basename
//   4. relName basename (no ext) === pageName basename (no ext)
//   5. Suffix-match of relName against pageName (subdir prefix in page name)
//   6. Single-candidate shortcut — when there is only one image in the folder,
//      it must be the texture regardless of naming.
export function resolvePageToFile(pageName, candidates) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]; // structural certainty

  const stripExt = (s) => s.replace(/\.(png|webp|jpg|jpeg)$/i, '');
  const basename = (s) => s.split('/').pop();

  const pFull = pageName;
  const pNoExt = stripExt(pageName);
  const pBase = basename(pageName);
  const pBaseNoExt = stripExt(pBase);

  const matchers = [
    (c) => c.relName === pFull,
    (c) => stripExt(c.relName) === pNoExt,
    (c) => basename(c.relName) === pBase,
    (c) => stripExt(basename(c.relName)) === pBaseNoExt,
    (c) => stripExt(c.relName).endsWith('/' + pNoExt),
    (c) => stripExt(basename(c.relName)).includes(pBaseNoExt),
  ];

  for (const fn of matchers) {
    const hit = candidates.find(fn);
    if (hit) return hit;
  }
  return null;
}
