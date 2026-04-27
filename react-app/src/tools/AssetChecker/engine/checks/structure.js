import { mkFinding } from '../findings.js';
import { compileRegex } from '../regex.js';
import { MODE_FULL, MODE_ELEMENT, MODE_LOOSE } from '../mode.js';
import { findSpineExports } from '../spineTriplet.js';

const CAT = '1. Folder structure';

export async function run(ctx) {
  const { index, config, mode, elementRoots } = ctx;
  const findings = [];
  const cfg = config.structure || {};

  // 1.4 reference / wip leak — runs in every mode
  const refRegexes = (cfg.referenceFilePatterns || [])
    .map((s) => { try { return compileRegex(s); } catch { return null; } })
    .filter(Boolean);
  let refLeaks = 0;
  for (const e of index.entries) {
    if (refRegexes.some((r) => r.test(e.name))) {
      refLeaks++;
      findings.push(mkFinding({
        ruleId: 'structure.referenceLeak',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [e.relPath],
        message: `Reference / concept file in export folder: ${e.name}`
      }));
    }
  }
  if (refLeaks === 0 && refRegexes.length) {
    findings.push(mkFinding({
      ruleId: 'structure.refLeakClean',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [],
      message: 'No reference / concept / WIP files leaked into export folders.'
    }));
  }

  if (mode === MODE_LOOSE) {
    findings.push(mkFinding({
      ruleId: 'structure.modeLoose',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [],
      message: 'Loose-asset mode — folder structure rules skipped; running file-level checks only.'
    }));
    return findings;
  }

  // ---- FULL / ELEMENT mode ----
  const subs = cfg.elementSubfolders || {};
  const subRequired = !!cfg.elementSubfoldersRequired;

  if (mode === MODE_FULL) {
    const root = index.listTopFolders()[0];
    findings.push(mkFinding({
      ruleId: 'structure.modeFull',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [root + '/'],
      message: `Full-project mode — root "${root}" detected; running strict checks.`
    }));

    // Any direct child of root that doesn't match element pattern → flag
    let elemPatternRe;
    try { elemPatternRe = compileRegex(cfg.elementFolderPattern || '^[0-9]+[_\\-]'); }
    catch { elemPatternRe = /^[0-9]+[_\-]/; }
    const directChildren = new Set();
    for (const e of index.entries) {
      if (e.segments[0] === root && e.segments.length > 1) directChildren.add(e.segments[1]);
    }
    for (const c of directChildren) {
      if (!elemPatternRe.test(c)) {
        findings.push(mkFinding({
          ruleId: 'structure.unknownFolder',
          severity: 'warn',
          priority: 2,
          category: CAT,
          paths: [`${root}/${c}/`],
          message: `Direct child of "${root}" doesn't look like an element folder (expected NN_Name).`
        }));
      }
    }
    if (elementRoots.length === 0) {
      findings.push(mkFinding({
        ruleId: 'structure.noElements',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [root + '/'],
        message: `No element folders (matching ${cfg.elementFolderPattern}) found under "${root}".`
      }));
    } else {
      findings.push(mkFinding({
        ruleId: 'structure.elementsFound',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: elementRoots.map((r) => r + '/'),
        message: `Found ${elementRoots.length} element folder${elementRoots.length === 1 ? '' : 's'}.`
      }));
    }
  } else {
    // ELEMENT mode
    findings.push(mkFinding({
      ruleId: 'structure.modeElement',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [elementRoots[0] + '/'],
      message: `Single-element mode — "${elementRoots[0]}" detected; subfolders are optional.`
    }));
  }

  // For each element root, check the canonical subfolders
  const dirsLower = new Set(index.listFolders().map((d) => d.toLowerCase()));
  const hasDir = (full) => {
    const lower = full.toLowerCase();
    if (dirsLower.has(lower)) return true;
    for (const e of index.entries) {
      if (e.relPath.toLowerCase().startsWith(lower + '/')) return true;
    }
    return false;
  };

  for (const eroot of elementRoots) {
    const presentSubs = [];
    const missingSubs = [];
    for (const [key, rel] of Object.entries(subs)) {
      const full = `${eroot}/${rel}`;
      if (hasDir(full)) presentSubs.push({ key, rel, full });
      else missingSubs.push({ key, rel, full });
    }

    if (presentSubs.length) {
      findings.push(mkFinding({
        ruleId: 'structure.elementSubfoldersPresent',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: presentSubs.map((p) => p.full + '/'),
        message: `${eroot}: found subfolders → ${presentSubs.map((p) => p.rel).join(', ')}.`
      }));
    }

    if (missingSubs.length && (mode === MODE_FULL && subRequired)) {
      findings.push(mkFinding({
        ruleId: 'structure.elementSubfolderMissing',
        severity: 'warn',
        priority: 2,
        category: CAT,
        paths: missingSubs.map((m) => m.full + '/'),
        message: `${eroot}: missing subfolders → ${missingSubs.map((m) => m.rel).join(', ')}.`
      }));
    } else if (missingSubs.length) {
      findings.push(mkFinding({
        ruleId: 'structure.elementSubfolderAbsent',
        severity: 'info',
        priority: 4,
        category: CAT,
        paths: missingSubs.map((m) => m.full + '/'),
        message: `${eroot}: optional subfolders not present → ${missingSubs.map((m) => m.rel).join(', ')}.`
      }));
    }
  }

  // ---- Content-location validation ----
  // Verify each kind of file is in its expected sub-location.
  const expected = cfg.expectedLocations || {};
  const elementRootSet = new Set(elementRoots);

  // Helper: figure out which element root a path lives under, if any.
  const elementOf = (relPath) => {
    for (const r of elementRoots) {
      if (relPath === r || relPath.startsWith(r + '/')) return r;
    }
    return null;
  };

  const checkLocation = (entry, kind, friendly) => {
    const expectedKey = expected[kind];
    if (!expectedKey) return;
    const eroot = elementOf(entry.relPath);
    if (!eroot) {
      findings.push(mkFinding({
        ruleId: 'structure.outsideElementRoot',
        severity: 'warn',
        priority: 2,
        category: CAT,
        paths: [entry.relPath],
        message: `${friendly} is outside any element folder.`
      }));
      return false;
    }
    const expectedDir = expectedKey === 'elementRoot' ? eroot : `${eroot}/${subs[expectedKey] || ''}`;
    if (entry.dir.toLowerCase() === expectedDir.toLowerCase()) return true;
    if (expectedKey === 'elementRoot' && entry.dir.toLowerCase() === eroot.toLowerCase()) return true;
    findings.push(mkFinding({
      ruleId: 'structure.wrongLocation',
      severity: 'warn',
      priority: 2,
      category: CAT,
      paths: [entry.relPath],
      message: `${friendly} should live under ${expectedDir.replace(eroot, '(element)')}, but is in ${entry.dir.replace(eroot, '(element)') || '(element root)'}.`,
      data: { suggestion: { from: entry.relPath, to: `${expectedDir}/${entry.name}`, reason: 'expected location from naming convention' } }
    }));
    return false;
  };

  // Spine triplets: any .json with a sibling atlas (incl. .atlas.txt)
  const triplets = findSpineExports(index);
  let spinePassCount = 0;
  for (const t of triplets) {
    if (checkLocation(t.json, 'spineExport', `Spine export "${t.json.name}"`)) spinePassCount++;
    if (t.atlas) checkLocation(t.atlas, 'spineExport', `Atlas "${t.atlas.name}"`);
  }
  if (triplets.length && spinePassCount === triplets.length) {
    findings.push(mkFinding({
      ruleId: 'structure.spineLocationOk',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: triplets.map((t) => t.json.relPath),
      message: `All ${triplets.length} Spine export(s) live in the expected Export/Animation location.`
    }));
  }

  // .spine sources
  const spineSources = index.byExt.get('spine') || [];
  let sourcePassCount = 0;
  for (const s of spineSources) {
    if (checkLocation(s, 'spineSource', `Spine source "${s.name}"`)) sourcePassCount++;
  }
  if (spineSources.length && sourcePassCount === spineSources.length) {
    findings.push(mkFinding({
      ruleId: 'structure.spineSourceLocationOk',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: spineSources.map((s) => s.relPath),
      message: `All ${spineSources.length} .spine source(s) live in the expected Source/AnimationSources location.`
    }));
  }

  // PSDs
  const psds = index.byExt.get('psd') || [];
  for (const p of psds) checkLocation(p, 'psd', `PSD "${p.name}"`);

  return findings;
}
