// Detect ingest mode from the dropped folder structure.
// - 'full'    : top folder name === config.structure.rootFolderName (e.g. unity_export)
// - 'element' : top folder name matches elementFolderPattern (e.g. 01_Smile)
// - 'loose'   : anything else — single asset / mixed bag, no structure rules

import { compileRegex } from './regex.js';

export const MODE_FULL = 'full';
export const MODE_ELEMENT = 'element';
export const MODE_LOOSE = 'loose';

export const MODE_LABEL = {
  full: 'Full project (strict)',
  element: 'Single element (lenient)',
  loose: 'Loose assets (file checks only)'
};

export function detectMode(index, config) {
  const tops = index.listTopFolders();
  const struct = config?.structure || {};
  const rootName = struct.rootFolderName || 'unity_export';
  const elemPatternSrc = struct.elementFolderPattern || '^[0-9]+[_\\-]';
  let elemRe;
  try { elemRe = compileRegex(elemPatternSrc); } catch { elemRe = /^[0-9]+[_\-]/; }

  if (tops.length === 1) {
    const t = tops[0];
    if (t.toLowerCase() === rootName.toLowerCase()) return MODE_FULL;
    if (elemRe.test(t)) return MODE_ELEMENT;
  }
  return MODE_LOOSE;
}

// Path of the "element root" relative to drop root, given mode.
//   FULL:    unity_export/01_Foo/...   → element root = "unity_export/01_Foo"
//   ELEMENT: 01_Foo/...                → element root = "01_Foo"
//   LOOSE:   no element roots
export function listElementRoots(index, mode, config) {
  const struct = config?.structure || {};
  const elemPatternSrc = struct.elementFolderPattern || '^[0-9]+[_\\-]';
  let elemRe;
  try { elemRe = compileRegex(elemPatternSrc); } catch { elemRe = /^[0-9]+[_\-]/; }

  if (mode === MODE_LOOSE) return [];
  if (mode === MODE_ELEMENT) {
    return [index.listTopFolders()[0]];
  }
  // MODE_FULL: list direct children of the root folder that match the element pattern
  const root = index.listTopFolders()[0];
  if (!root) return [];
  const set = new Set();
  for (const e of index.entries) {
    if (e.segments[0] !== root) continue;
    const child = e.segments[1];
    if (child && elemRe.test(child)) set.add(`${root}/${child}`);
  }
  return [...set].sort();
}
