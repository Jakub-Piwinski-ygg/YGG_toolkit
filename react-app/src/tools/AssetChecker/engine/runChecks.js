import { run as runStructure } from './checks/structure.js';
import { run as runNaming } from './checks/naming.js';
import { run as runSpine } from './checks/spineJson.js';
import { run as runAtlas } from './checks/atlas.js';
import { run as runImages } from './checks/images.js';
import { run as runCoverage } from './checks/coverage.js';
import { run as runBakedText } from './checks/bakedText.js';
import { sortFindings } from './findings.js';

// Default fail-severity for every emitted ruleId. Used both as the baseline
// when applying config.ruleSeverity overrides and as the source of truth for
// "what severity would this be if it failed" on pass findings.
//
// Pass ruleIds are mapped to their corresponding fail rule via PASS_TO_FAIL.
// When we emit a pass finding the engine attaches data.passOf so the UI can
// render a small would-be-severity badge next to the ✓ icon.
const DEFAULT_FAIL_SEVERITY = {
  'structure.missingTopFolder':       'error',
  'structure.missingSpineSource':     'warn',
  'structure.referenceLeak':          'warn',
  'structure.unknownFolder':          'info',
  'structure.spineLocationMismatch':  'warn',
  'structure.psdLocationMismatch':    'info',
  'naming.disallowedChars':           'warn',
  'naming.forbiddenSuffix':           'warn',
  'naming.upperCaseExtension':        'warn',
  'naming.spineTripletMismatch':      'warn',
  'naming.atlasPageMissing':          'error',
  'naming.boneTextPrefix':            'warn',
  'coverage.symbolAnimMissing':       'error',
  'coverage.symbolStaticMissing':     'warn',
  'coverage.requiredStaticMissing':   'warn',
  'coverage.winSeqAnimMissing':       'warn',
  'coverage.previewMissing':          'warn',
  'spine.versionMismatch':            'error',
  'spine.mockTextInExport':           'error',
  'spine.textBoneDecoration':         'info',
  'coverage.buttonOutsideFolder':     'warn',
  'spine.budgetExceeded':             'info',
  'spine.budgetOutlier':              'info',
  'spine.animationLint':              'warn',
  'spine.attachmentUnresolved':       'warn',
  'atlas.nonPot':                     'warn',
  'atlas.sizeCap':                    'error',
  'atlas.tooManyPages':               'warn',
  'atlas.lowFillRatio':               'info',
  'atlas.unusedRegion':               'info',
  'image.fileSize':                   'warn',
  'image.nonPot':                     'warn',
  'image.bgNonCanonical':             'info',
  'image.axisTooLarge':               'warn',
  'image.categoryAxisExceeded':       'warn',
  'image.almostEmptyAlpha':           'warn',
  'image.excessivePadding':           'info',
  'bakedText.attachmentName':         'warn',
  'consistency.spineVersionDrift':    'error'
};

// pass ruleId → corresponding fail ruleId (used to derive data.passOf).
const PASS_TO_FAIL = {
  'spine.rule4_1Pass': 'spine.versionMismatch',
  'spine.rule4_2Pass': 'spine.mockTextInExport',
  'spine.rule4_3Pass': 'naming.boneTextPrefix',
  'spine.rule4_5Pass': 'spine.budgetExceeded',
  'spine.rule4_7Pass': 'spine.animationLint',
  'spine.rule4_8Pass': 'spine.attachmentUnresolved',
  'spine.budgetPercentileOk': 'spine.budgetOutlier',
  'atlas.allRegionsUsed':   'atlas.unusedRegion',
  'atlas.withinBudget':     'atlas.sizeCap',
  'atlas.fillRatioOk':      'atlas.lowFillRatio',
  'image.fileSizeOk':       'image.fileSize',
  'image.allPot':           'image.nonPot',
  'naming.allClean':        'naming.disallowedChars',
  'coverage.symbolsComplete':         'coverage.symbolAnimMissing',
  'coverage.previewOk':               'coverage.previewMissing',
  'coverage.requiredStaticsPresent':  'coverage.requiredStaticMissing',
  'coverage.buttonsLocated':          'coverage.buttonOutsideFolder',
  'structure.refLeakClean':           'structure.referenceLeak',
  'structure.spineLocationOk':        'structure.spineLocationMismatch',
  'structure.spineSourceLocationOk':  'structure.missingSpineSource',
  'consistency.spineVersionConsistent': 'consistency.spineVersionDrift'
};

const SEV_PRIORITY = { error: 1, warn: 2, info: 4, pass: 5 };

function applySeverityConfig(findings, config) {
  const overrides = (config && config.ruleSeverity) || {};
  for (const f of findings) {
    if (f.severity === 'pass') {
      // Skip when richer displays already convey severity (gauge / matrix).
      if (f.data && (f.data.gauge || f.data.kind === 'matrix')) continue;
      const failRule = PASS_TO_FAIL[f.ruleId];
      if (!failRule) continue;
      const sev = overrides[failRule] || DEFAULT_FAIL_SEVERITY[failRule];
      if (sev) f.data = { ...(f.data || {}), passOf: sev };
    } else if (overrides[f.ruleId]) {
      f.severity = overrides[f.ruleId];
      f.priority = SEV_PRIORITY[f.severity] ?? f.priority;
    }
  }
}
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
  applySeverityConfig(all, config);
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
