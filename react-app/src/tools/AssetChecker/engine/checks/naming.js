import { mkFinding } from '../findings.js';
import { folderMatches } from '../regex.js';
import { suggestCleanName, suggestRemoveSuffix, suggestLowercaseExt, suggestPrefix } from '../suggest.js';
import { isUnderSource, isUnderPreview } from '../spineTriplet.js';

const CAT = '2. Naming';

export async function run(ctx) {
  const { index, config } = ctx;
  const findings = [];
  const cfg = config.naming || {};
  const allowedRe = cfg.allowedCharsRegex ? new RegExp(cfg.allowedCharsRegex) : null;
  const forbid = cfg.forbiddenSuffixes || [];

  // Track folders that already have a "spaces / disallowed chars" finding so we
  // don't spam every file inside them with the same complaint.
  const flaggedFolders = new Set();
  if (allowedRe) {
    for (const e of index.entries) {
      for (let i = 0; i < e.segments.length - 1; i++) {
        const seg = e.segments[i];
        if (!allowedRe.test(seg) && !flaggedFolders.has(seg)) {
          flaggedFolders.add(seg);
          const cleanedSeg = suggestCleanName(seg) || seg;
          findings.push(mkFinding({
            ruleId: 'naming.disallowedChars',
            severity: 'warn',
            priority: 2,
            category: CAT,
            paths: [e.segments.slice(0, i + 1).join('/') + '/'],
            message: `Folder name contains disallowed characters: "${seg}"`,
            data: cleanedSeg !== seg ? { suggestion: { from: seg, to: cleanedSeg, reason: 'normalized (rule-based)' } } : null
          }));
        }
      }
    }
  }

  for (const e of index.entries) {
    // Skip naming checks for files in Source/ (WIP) and Preview/ (own rules in coverage)
    if (isUnderSource(e) || isUnderPreview(e)) continue;

    // 2.1 disallowed chars — file name only (folder names handled above, deduped)
    if (allowedRe && !allowedRe.test(e.name)) {
      const clean = suggestCleanName(e.name);
      findings.push(mkFinding({
        ruleId: 'naming.disallowedChars',
        severity: 'warn',
        priority: 2,
        category: CAT,
        paths: [e.relPath],
        message: `Filename contains disallowed characters: ${e.name}`,
        data: clean ? { suggestion: { from: e.name, to: clean, reason: 'normalized (rule-based)' } } : null
      }));
    }
    // 2.5 forbidden suffix
    for (const suf of forbid) {
      const baseNoExt = e.name.replace(/\.[^.]+$/, '');
      if (baseNoExt.toLowerCase().endsWith(suf.toLowerCase())) {
        const cleaned = suggestRemoveSuffix(e.name, suf);
        findings.push(mkFinding({
          ruleId: 'naming.forbiddenSuffix',
          severity: 'warn',
          priority: 2,
          category: CAT,
          paths: [e.relPath],
          message: `Filename has forbidden suffix "${suf}": ${e.name}`,
          data: cleaned ? { suggestion: { from: e.name, to: cleaned, reason: `strip "${suf}" suffix` } } : null
        }));
      }
    }
    // 2.3 lowercase ext
    if (cfg.lowercaseExtensions !== false) {
      const lc = suggestLowercaseExt(e.name);
      if (lc) {
        findings.push(mkFinding({
          ruleId: 'naming.upperCaseExtension',
          severity: 'warn',
          priority: 3,
          category: CAT,
          paths: [e.relPath],
          message: `Extension is not lowercase: ${e.name}`,
          data: { suggestion: { from: e.name, to: lc, reason: 'lowercase extension' } }
        }));
      }
    }
  }

  // 2.4 required prefix per folder
  const prefMap = cfg.folderPrefixes || {};
  for (const [folder, prefixes] of Object.entries(prefMap)) {
    const list = index.entries.filter((e) => folderMatches(e.segments[0], folder) && (e.ext === 'png' || e.ext === 'jpg'));
    for (const e of list) {
      const lname = e.name.toLowerCase();
      if (!prefixes.some((p) => lname.startsWith(p.toLowerCase()))) {
        const suggestion = suggestPrefix(e.name, prefixes);
        findings.push(mkFinding({
          ruleId: 'naming.missingPrefix',
          severity: 'warn',
          priority: 3,
          category: CAT,
          paths: [e.relPath],
          message: `${folder}/ asset is missing required prefix (${prefixes.join(' / ')}): ${e.name}`,
          data: suggestion ? { suggestion: { from: e.name, to: suggestion, reason: `add "${prefixes[0]}" prefix from naming convention` } } : null
        }));
      }
    }
  }

  // 2.6 spine triplet name match (case-sensitive)
  const jsons = index.byExt.get('json') || [];
  for (const j of jsons) {
    const base = j.name.replace(/\.json$/i, '');
    const atlasPath = `${j.dir}/${base}.atlas`;
    const ciHit = index.hasCi(atlasPath);
    if (!ciHit) continue; // not a spine triplet
    if (ciHit !== atlasPath) {
      findings.push(mkFinding({
        ruleId: 'naming.spineTripletMismatch',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [j.relPath, ciHit],
        message: `Spine triplet base names differ in case: ${j.name} vs ${ciHit.split('/').pop()}`
      }));
    }
    const pngPath = `${j.dir}/${base}.png`;
    const ciPng = index.hasCi(pngPath);
    if (ciPng && ciPng !== pngPath) {
      findings.push(mkFinding({
        ruleId: 'naming.spineTripletMismatch',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [j.relPath, ciPng],
        message: `Spine PNG name differs in case: expected ${pngPath.split('/').pop()}, got ${ciPng.split('/').pop()}`
      }));
    }
  }

  if (findings.length === 0 && index.entries.length > 0) {
    findings.push(mkFinding({
      ruleId: 'naming.allClean',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [],
      message: `All ${index.entries.length} filenames pass naming-convention checks.`
    }));
  }

  return findings;
}
