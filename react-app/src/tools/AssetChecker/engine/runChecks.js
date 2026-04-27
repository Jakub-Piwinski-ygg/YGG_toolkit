import { run as runStructure } from './checks/structure.js';
import { run as runNaming } from './checks/naming.js';
import { run as runSpine } from './checks/spineJson.js';
import { run as runAtlas } from './checks/atlas.js';
import { run as runImages } from './checks/images.js';
import { run as runCoverage } from './checks/coverage.js';
import { run as runBakedText } from './checks/bakedText.js';
import { sortFindings } from './findings.js';
import { buildIndex } from './fileIndex.js';
import { detectMode, listElementRoots, MODE_LOOSE, MODE_LABEL } from './mode.js';

const PIPELINE = [
  ['structure', runStructure],
  ['naming',    runNaming],
  ['atlas',     runAtlas],
  ['spine',     runSpine],
  ['images',    runImages],
  ['coverage',  runCoverage],
  ['bakedText', runBakedText]
];

export async function runAllChecks({ entries, config, hints, onProgress }) {
  const index = buildIndex(entries);
  const mode = detectMode(index, config);
  const elementRoots = listElementRoots(index, mode, config);
  const ctx = { index, config, hints, mode, elementRoots };

  const all = [];
  let i = 0;
  for (const [name, fn] of PIPELINE) {
    onProgress?.(`${name} (${++i}/${PIPELINE.length})`);
    try {
      const res = await fn(ctx);
      for (const f of res) {
        if (!f.hint && hints && hints[f.ruleId]) f.hint = hints[f.ruleId];
        all.push(f);
      }
    } catch (e) {
      all.push({
        uid: -i,
        ruleId: 'engine.checkError',
        severity: 'error',
        priority: 1,
        category: '0. Engine',
        paths: [],
        message: `Check "${name}" failed: ${e.message || e}`,
        hint: 'This is a bug in the checker itself, not the asset drop.'
      });
    }
  }
  for (const f of all) {
    if (!f.hint && hints && hints[f.ruleId]) f.hint = hints[f.ruleId];
  }
  return {
    findings: sortFindings(all),
    summary: buildSummary(all, index, mode, elementRoots)
  };
}

function buildSummary(findings, index, mode, elementRoots) {
  let totalBytes = 0;
  for (const e of index.entries) totalBytes += e.size;
  const counts = { error: 0, warn: 0, info: 0, pass: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return {
    fileCount: index.entries.length,
    totalBytes,
    folderCount: index.listFolders().length,
    pngCount: (index.byExt.get('png') || []).length,
    jsonCount: (index.byExt.get('json') || []).length,
    atlasCount: (index.byExt.get('atlas') || []).length,
    counts,
    mode,
    modeLabel: MODE_LABEL[mode],
    elementRoots
  };
}
